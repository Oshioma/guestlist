// SSRF-hardened server-side fetcher for the Event Supply Engine.
//
// Guarantees:
//   * http/https only
//   * hostname blocklist (localhost, .local, .internal, cloud metadata names)
//   * every DNS answer is validated against loopback / private / link-local /
//     CGNAT / multicast / reserved / metadata ranges (IPv4 + IPv6, including
//     IPv4-mapped and NAT64-embedded addresses)
//   * validation happens inside the socket's own `lookup`, so the address we
//     vetted is the address we connect to (no resolve-then-fetch TOCTOU)
//   * redirects are followed manually, each target re-validated, capped
//   * response size capped while streaming; timeout enforced; content-type
//     restricted to HTML/XML/feed/JSON
//   * clear Guestlist user agent; no auth/anti-bot bypassing — a 401/403/429
//     is reported as blocked_by_site, never retried harder.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { supplyConfig } from './config';

export type SafeFetchFailureCode =
  | 'invalid_url'
  | 'unsafe_url'
  | 'fetch_failed'
  | 'not_found'
  | 'blocked_by_site'
  | 'too_large'
  | 'unsupported_content';

export type SafeFetchResult =
  | { ok: true; status: number; finalUrl: string; contentType: string; body: string; ms: number }
  | { ok: false; code: SafeFetchFailureCode; detail: string; status?: number; ms: number };

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  // Diagnostics only (admin test-fetch): override the User-Agent for this
  // one request. The scanner itself always fetches as GuestlistBot.
  userAgent?: string;
  // TEST ONLY: hostnames allowed to resolve to otherwise-blocked addresses,
  // so fixtures can run on 127.0.0.1. Never set from request-derived data.
  allowHostsForTests?: string[];
};

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata.goog']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const BLOCKED_V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],       // private
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local (incl. 169.254.169.254 metadata)
  ['172.16.0.0', 12],    // private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],   // private
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 3],      // multicast + reserved + broadcast (224.0.0.0–255.255.255.255)
];

export function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

export function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/%.*$/, ''); // strip zone id
  // IPv4-mapped / NAT64-embedded → validate embedded IPv4 (dotted form).
  const v4Match = lower.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match && (lower.startsWith('::ffff:') || lower.startsWith('64:ff9b:'))) {
    return isBlockedIPv4(v4Match[1]);
  }
  // Hex form of the same (URL parsing normalises ::ffff:127.0.0.1 to
  // ::ffff:7f00:1): expand the last 32 bits back to dotted IPv4.
  const hexMapped = lower.match(/^(?:::ffff|64:ff9b:):([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isBlockedIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  if (lower === '::' || lower === '::1') return true;
  const firstWord = parseInt(lower.split(':')[0] || '0', 16);
  if ((firstWord & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((firstWord & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstWord & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (lower.startsWith('2001:db8')) return true;    // documentation
  if (lower.startsWith('fd00:ec2')) return true;    // AWS IMDSv6
  return false;
}

export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) return isBlockedIPv4(address);
  if (net.isIP(address) === 6) return isBlockedIPv6(address);
  return true; // not an IP at all — refuse
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;
  // IP literals (including bracketed IPv6, handled by URL parsing upstream).
  if (net.isIP(h)) return isBlockedAddress(h);
  return false;
}

export function validateUrl(
  raw: string,
  opts: SafeFetchOptions = {}
): { ok: true; url: URL } | { ok: false; code: SafeFetchFailureCode; detail: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid_url', detail: 'Not a parseable URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'invalid_url', detail: `Unsupported protocol ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, code: 'unsafe_url', detail: 'Credentials in URL are not allowed' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (opts.allowHostsForTests?.includes(host)) return { ok: true, url };
  if (isBlockedHostname(host)) {
    return { ok: false, code: 'unsafe_url', detail: `Blocked host ${url.hostname}` };
  }
  return { ok: true, url };
}

const ACCEPTED_CONTENT_TYPES =
  /^(text\/html|application\/xhtml\+xml|text\/xml|application\/xml|application\/rss\+xml|application\/atom\+xml|application\/json|application\/ld\+json|text\/plain)/i;

// dns.lookup wrapper that rejects any answer in a blocked range. Used as the
// socket's own lookup so validation and connection share one resolution.
function makeSafeLookup(allowHosts: string[] | undefined) {
  return (
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void
  ) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, undefined as any);
      const list = addresses as dns.LookupAddress[];
      if (!list?.length) {
        return callback(Object.assign(new Error('No DNS answers'), { code: 'ENOTFOUND' }), undefined as any);
      }
      const allowed = allowHosts?.includes(hostname)
        ? list
        : list.filter((a) => !isBlockedAddress(a.address));
      if (allowed.length !== list.length || allowed.length === 0) {
        // Any blocked answer poisons the set — a rebinding-friendly host is
        // not somewhere we fetch from.
        return callback(
          Object.assign(new Error('GUESTLIST_BLOCKED_ADDRESS'), { code: 'GUESTLIST_BLOCKED' }),
          undefined as any
        );
      }
      const first = allowed[0];
      if ((options as { all?: boolean }).all) return callback(null, allowed as any);
      callback(null, first.address, first.family);
    });
  };
}

function requestOnce(
  url: URL,
  opts: Required<Pick<SafeFetchOptions, 'timeoutMs' | 'maxBytes'>> & SafeFetchOptions
): Promise<
  | { kind: 'response'; status: number; headers: http.IncomingHttpHeaders; body: string }
  | { kind: 'error'; code: SafeFetchFailureCode; detail: string; status?: number }
> {
  return new Promise((resolve) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'GET',
        lookup: makeSafeLookup(opts.allowHostsForTests) as never,
        headers: {
          'User-Agent': opts.userAgent ?? supplyConfig.fetch.userAgent,
          Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en-GB,en;q=0.8',
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;

        // Redirects are handled by the caller (target re-validation).
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({
            kind: 'response',
            status,
            headers: res.headers,
            body: '',
          });
        }
        if (status === 404 || status === 410) {
          res.resume();
          return resolve({ kind: 'error', code: 'not_found', detail: `HTTP ${status}`, status });
        }
        if (status === 401 || status === 403 || status === 429 || status === 451) {
          res.resume();
          return resolve({ kind: 'error', code: 'blocked_by_site', detail: `HTTP ${status}`, status });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return resolve({ kind: 'error', code: 'fetch_failed', detail: `HTTP ${status}`, status });
        }

        const contentType = String(res.headers['content-type'] ?? '');
        if (contentType && !ACCEPTED_CONTENT_TYPES.test(contentType)) {
          res.destroy();
          return resolve({
            kind: 'error', code: 'unsupported_content',
            detail: `Content-Type ${contentType.split(';')[0]}`, status,
          });
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy();
          return resolve({ kind: 'error', code: 'too_large', detail: `Declared ${declared} bytes`, status });
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            res.destroy();
            resolve({ kind: 'error', code: 'too_large', detail: `Exceeded ${opts.maxBytes} bytes`, status });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            kind: 'response',
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', () => {
          resolve({ kind: 'error', code: 'fetch_failed', detail: 'Response stream error', status });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('timeout'), { code: 'GUESTLIST_TIMEOUT' }));
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'GUESTLIST_BLOCKED' || err.message === 'GUESTLIST_BLOCKED_ADDRESS') {
        return resolve({ kind: 'error', code: 'unsafe_url', detail: 'Resolves to a blocked address' });
      }
      if (err.code === 'GUESTLIST_TIMEOUT') {
        return resolve({ kind: 'error', code: 'fetch_failed', detail: 'Timed out' });
      }
      resolve({ kind: 'error', code: 'fetch_failed', detail: err.code ?? err.message });
    });
    req.end();
  });
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const started = Date.now();
  const opts = {
    timeoutMs: options.timeoutMs ?? supplyConfig.fetch.timeoutMs,
    maxBytes: options.maxBytes ?? supplyConfig.fetch.maxBytes,
    maxRedirects: options.maxRedirects ?? supplyConfig.fetch.maxRedirects,
    ...options,
    allowHostsForTests: [
      ...(options.allowHostsForTests ?? []),
      ...supplyConfig.fetch.allowHosts,
    ],
  };

  let current = validateUrl(rawUrl, opts);
  if (!current.ok) return { ...current, ms: Date.now() - started };

  let url = current.url;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const res = await requestOnce(url, opts);
    if (res.kind === 'error') return { ok: false, ...res, ms: Date.now() - started };

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) {
        return { ok: false, code: 'fetch_failed', detail: 'Redirect without Location', ms: Date.now() - started };
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return { ok: false, code: 'fetch_failed', detail: 'Unparseable redirect target', ms: Date.now() - started };
      }
      // Every redirect target goes through the full validation again — a
      // safe public URL redirecting into private space is rejected.
      const revalidated = validateUrl(next.toString(), opts);
      if (!revalidated.ok) return { ...revalidated, ms: Date.now() - started };
      url = revalidated.url;
      if (hop === opts.maxRedirects) {
        return { ok: false, code: 'fetch_failed', detail: 'Too many redirects', ms: Date.now() - started };
      }
      continue;
    }

    return {
      ok: true,
      status: res.status,
      finalUrl: url.toString(),
      contentType: String(res.headers['content-type'] ?? ''),
      body: res.body,
      ms: Date.now() - started,
    };
  }
  return { ok: false, code: 'fetch_failed', detail: 'Too many redirects', ms: Date.now() - started };
}
