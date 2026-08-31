// Constrained source scanning: KNOWN SOURCE PAGE → EVENT LINKS, never a
// crawler. One fetch of the source page (or its feed), deterministic
// candidate-link identification, seen-URL memory, hard caps, politeness
// delay, per-scan metrics.

import { parse } from 'node-html-parser';
import { query, queryOne } from '@/lib/db';
import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from './safeFetch';
import { runExtractionPipeline, type PipelineContext } from './pipeline';
import { supplyConfig } from './config';

export type SourceRow = {
  id: string;
  name: string;
  url: string;
  feed_url: string | null;
  source_type: string;
  active: boolean;
  trust: string;
  polling_enabled: boolean;
  poll_frequency_hours: number;
  last_checked_at: string | null;
};

const EVENT_PATH_HINT =
  /\/(events?|whats?-?on|what-s-on|listings?|gigs?|parties|party|nights?|programme|program|lineup|agenda|tickets?|e)\/[^/]/i;
const NON_EVENT_PATH =
  /\/(login|signin|signup|register|account|cart|basket|checkout|privacy|terms|cookies|about|contact|jobs|careers|press|faq|search|tag|category|wp-admin|admin)\b/i;
const DATE_TEXT = /\b(\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})\b/i;

export function canonicaliseCandidateUrl(raw: string, baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  // Strip tracking params; keep functional ones.
  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (!/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(k)) params.set(k, v);
  }
  url.search = params.toString() ? `?${params.toString()}` : '';
  return url.toString();
}

export function identifyCandidateLinks(html: string, pageUrl: string): string[] {
  const root = parse(html);
  const base = new URL(pageUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  const pageCanonical = canonicaliseCandidateUrl(pageUrl, pageUrl);

  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const canonical = canonicaliseCandidateUrl(href, pageUrl);
    if (!canonical || canonical === pageCanonical || seen.has(canonical)) continue;
    let url: URL;
    try {
      url = new URL(canonical);
    } catch {
      continue;
    }
    if (NON_EVENT_PATH.test(url.pathname)) continue;

    const sameSite = url.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '');
    const pathLooksEventy = EVENT_PATH_HINT.test(url.pathname);
    const text = `${a.structuredText} ${a.getAttribute('aria-label') ?? ''} ${a.getAttribute('title') ?? ''}`;
    const textLooksDated = DATE_TEXT.test(text);

    // Deterministic signals only: event-like path anywhere, or a same-site
    // link whose visible text carries a date.
    if (pathLooksEventy || (sameSite && textLooksDated)) {
      seen.add(canonical);
      out.push(canonical);
      if (out.length >= supplyConfig.scan.maxCandidatesPerScan) break;
    }
  }
  return out;
}

export function looksLikeFeed(contentType: string, body: string): boolean {
  if (/rss|atom|xml/i.test(contentType) && /<(rss|feed)[\s>]/i.test(body)) return true;
  return /^\s*(<\?xml[^>]*\?>)?\s*<(rss|feed)[\s>]/i.test(body);
}

// Regex-based feed parsing: <link> is a void element to HTML parsers, so an
// HTML parser silently loses RSS link text — plain pattern matching over the
// XML is the reliable route for the two well-known shapes.
export function parseFeedLinks(xml: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string | null | undefined) => {
    const decoded = u?.trim().replace(/&amp;/g, '&').replace(/^<!\[CDATA\[(.*)\]\]>$/s, '$1').trim();
    const canonical = decoded && canonicaliseCandidateUrl(decoded, baseUrl);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  };
  // RSS 2.0: <item>…<link>url</link>… (fall back to a URL-shaped <guid>)
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const item = m[0];
    const link = item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]
      ?? item.match(/<guid[^>]*>(https?:\/\/[\s\S]*?)<\/guid>/i)?.[1];
    push(link);
    if (out.length >= supplyConfig.scan.maxCandidatesPerScan) return out;
  }
  // Atom: <entry>…<link href="url"/>… (prefer rel="alternate")
  for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const entry = m[0];
    const links = [...entry.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi)];
    const alternate = links.find((l) => /rel=["']alternate["']/i.test(l[0]) || !/rel=/i.test(l[0]));
    push(alternate?.[1] ?? links[0]?.[1]);
    if (out.length >= supplyConfig.scan.maxCandidatesPerScan) return out;
  }
  return out;
}

export type ScanContext = Pick<PipelineContext, 'ai' | 'fetcher' | 'fetchOptions'> & {
  delayMs?: number;
};

export type ScanResult = {
  scanId: string;
  status: 'succeeded' | 'failed';
  method: 'rss' | 'html' | null;
  candidatesFound: number;
  newCandidates: number;
  extracted: number;
  failed: number;
  duplicates: number;
  error: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function scanSource(sourceId: string, ctx: ScanContext = {}): Promise<ScanResult> {
  const source = await queryOne<SourceRow>(
    `select id, name, url, feed_url, source_type, active, trust, polling_enabled,
            poll_frequency_hours, last_checked_at::text
       from event_sources where id = $1`,
    [sourceId]
  );
  if (!source) throw new Error('Source not found');

  const scan = await queryOne<{ id: string }>(
    `insert into source_scans (source_id) values ($1) returning id`,
    [sourceId]
  );
  const scanId = scan!.id;
  const fetcher = ctx.fetcher ?? safeFetch;

  const finish = async (r: Omit<ScanResult, 'scanId'>): Promise<ScanResult> => {
    await query(
      `update source_scans set status = $2, method = $3, candidates_found = $4,
              new_candidates = $5, extracted = $6, failed = $7, duplicates = $8,
              error = $9, finished_at = now()
        where id = $1`,
      [scanId, r.status, r.method, r.candidatesFound, r.newCandidates, r.extracted, r.failed, r.duplicates, r.error]
    );
    await query(
      `update event_sources set last_checked_at = now(),
              last_success_at = case when $2 then now() else last_success_at end,
              failure_count = case when $2 then 0 else failure_count + 1 end,
              events_found = events_found + $3,
              updated_at = now()
        where id = $1`,
      [sourceId, r.status === 'succeeded', r.extracted]
    );
    return { scanId, ...r };
  };

  if (!source.active || source.trust === 'blocked') {
    return finish({
      status: 'failed', method: null, candidatesFound: 0, newCandidates: 0,
      extracted: 0, failed: 0, duplicates: 0,
      error: source.trust === 'blocked' ? 'Source is blocked' : 'Source is paused',
    });
  }

  // Prefer a known feed; otherwise the listing page.
  const target = source.feed_url ?? source.url;
  const fetched = await fetcher(target, {
    ...ctx.fetchOptions,
    accept: 'application/rss+xml,application/atom+xml,text/html,application/xhtml+xml,application/xml;q=0.9',
  });
  if (!fetched.ok) {
    return finish({
      status: 'failed', method: null, candidatesFound: 0, newCandidates: 0,
      extracted: 0, failed: 0, duplicates: 0,
      error: `${fetched.code}: ${fetched.detail}`,
    });
  }

  let method: 'rss' | 'html';
  let candidates: string[];
  if (looksLikeFeed(fetched.contentType, fetched.body)) {
    method = 'rss';
    candidates = parseFeedLinks(fetched.body, fetched.finalUrl);
  } else {
    method = 'html';
    candidates = identifyCandidateLinks(fetched.body, fetched.finalUrl);
    // An advertised feed is a FALLBACK, not an upgrade. Only look at one when
    // the listing page itself yielded nothing: sites routinely advertise a
    // generic blog or news feed, and adopting one while the page was working
    // would permanently redirect every later scan to an empty feed. Gating on
    // an empty page also keeps the probe fetch off the healthy path.
    if (!source.feed_url && candidates.length === 0) {
      const root = parse(fetched.body);
      const feed = root
        .querySelectorAll('link[rel="alternate"]')
        .find((l) => /rss|atom/i.test(l.getAttribute('type') ?? ''))
        ?.getAttribute('href');
      const feedAbs = feed && canonicaliseCandidateUrl(feed, fetched.finalUrl);
      if (feedAbs) {
        await sleep(ctx.delayMs ?? supplyConfig.scan.delayBetweenFetchesMs);
        const probe = await fetcher(feedAbs, {
          ...ctx.fetchOptions,
          accept: 'application/rss+xml,application/atom+xml,application/xml;q=0.9',
        });
        const feedCandidates =
          probe.ok && looksLikeFeed(probe.contentType, probe.body)
            ? parseFeedLinks(probe.body, probe.finalUrl).length
            : 0;
        if (feedCandidates > 0) {
          await query(`update event_sources set feed_url = $2 where id = $1`, [sourceId, feedAbs]);
        }
      }
    }
  }

  // Which candidates are new for this source?
  const seenRows = candidates.length
    ? await query<{ url: string; extraction_id: string | null }>(
        `select url, extraction_id from source_seen_urls where source_id = $1 and url = any($2)`,
        [sourceId, candidates]
      )
    : [];
  const seenSet = new Set(seenRows.map((r) => r.url));
  const newCandidates = candidates.filter((u) => !seenSet.has(u));

  // SEEN IS NOT PROCESSED. Every candidate is recorded below, but only
  // maxExtractionsPerScan of them run per scan — so eligibility has to mean
  // "no extraction attempted yet", not "never seen before". Keying off seen
  // alone stranded every candidate past the cap forever: they were marked seen
  // on the first scan, counted as old on the next, and never extracted.
  // A URL that already has an extraction (succeeded OR failed) stays skipped;
  // failures are re-run deliberately from the supply log.
  const attempted = new Set(
    seenRows.filter((r) => r.extraction_id !== null).map((r) => r.url)
  );
  // Freshly discovered candidates go first, then the backlog, each in page
  // order. A URL whose extraction threw records no extraction_id and so
  // returns here next scan; putting new links ahead of it keeps one
  // persistently broken page from consuming the whole per-scan budget.
  const pending = [
    ...candidates.filter((u) => !seenSet.has(u)),
    ...candidates.filter((u) => seenSet.has(u) && !attempted.has(u)),
  ];

  for (const url of candidates) {
    await query(
      `insert into source_seen_urls (source_id, url) values ($1, $2)
       on conflict (source_id, url) do update set last_seen_at = now()`,
      [sourceId, url]
    );
  }

  let extracted = 0;
  let failedCount = 0;
  let duplicates = 0;
  const toProcess = pending.slice(0, supplyConfig.scan.maxExtractionsPerScan);
  for (let i = 0; i < toProcess.length; i++) {
    if (i > 0) await sleep(ctx.delayMs ?? supplyConfig.scan.delayBetweenFetchesMs);
    try {
      const outcome = await runExtractionPipeline(toProcess[i], {
        sourceId, scanKind: 'source_scan', ai: ctx.ai,
        fetcher: ctx.fetcher, fetchOptions: ctx.fetchOptions,
      });
      await query(
        `update source_seen_urls set extraction_id = $3 where source_id = $1 and url = $2`,
        [sourceId, toProcess[i], outcome.extractionId]
      );
      if (outcome.status === 'succeeded' || outcome.status === 'possible_duplicate') extracted++;
      else if (outcome.status === 'duplicate_linked') duplicates++;
      else failedCount++;
    } catch {
      failedCount++;
    }
  }

  return finish({
    status: 'succeeded', method,
    candidatesFound: candidates.length, newCandidates: newCandidates.length,
    extracted, failed: failedCount, duplicates, error: null,
  });
}

// Scan every source whose polling schedule is due. Designed to be called
// from a cron-hit job endpoint — no browser involved.
export async function scanDueSources(ctx: ScanContext = {}): Promise<{ scanned: number; results: ScanResult[] }> {
  const due = await query<{ id: string }>(
    `select id from event_sources
      where active and polling_enabled and trust <> 'blocked'
        and (last_checked_at is null or last_checked_at < now() - make_interval(hours => poll_frequency_hours))
      order by last_checked_at asc nulls first
      limit 20`
  );
  const results: ScanResult[] = [];
  for (const s of due) {
    try {
      results.push(await scanSource(s.id, ctx));
    } catch {
      /* per-source failures are recorded on the scan rows */
    }
  }
  return { scanned: due.length, results };
}
