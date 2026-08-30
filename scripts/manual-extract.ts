// MANUAL real-world extraction spot-check — NOT part of CI (live websites
// change; automated tests use fixtures only).
//
// Runs the real pipeline against a small number of publicly accessible
// independent event/promoter pages, respectfully: one listing fetch per
// site, at most two candidate extractions, 1.5s between requests, honest
// GuestlistBot user agent.
//
// This dev container forces outbound HTTPS through a local egress proxy, so
// this harness injects a proxy-aware fetcher (undici ProxyAgent) in front of
// the pipeline. URL validation still runs; production safeFetch itself is
// covered by the fixture suite.
//
// Usage: npx tsx scripts/manual-extract.ts <url> [url…]
//        npx tsx scripts/manual-extract.ts --scan <listing-url>

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ProxyAgent, fetch as ufetch } from 'undici';
import { validateUrl, type SafeFetchResult, type SafeFetchOptions } from '@/lib/supply/safeFetch';
import { supplyConfig } from '@/lib/supply/config';
import { runExtractionPipeline } from '@/lib/supply/pipeline';
import { identifyCandidateLinks, looksLikeFeed, parseFeedLinks } from '@/lib/supply/scanner';
import { inspectPage } from '@/lib/supply/structured';

const root = path.resolve(__dirname, '..');
if (existsSync(path.join(root, '.env.local'))) {
  for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const proxy = process.env.HTTPS_PROXY ? new ProxyAgent(process.env.HTTPS_PROXY) : undefined;

const proxyFetcher = async (url: string, _opts?: SafeFetchOptions): Promise<SafeFetchResult> => {
  const started = Date.now();
  const validated = validateUrl(url);
  if (!validated.ok) return { ...validated, ms: Date.now() - started };
  try {
    const res = await ufetch(url, {
      dispatcher: proxy,
      redirect: 'follow',
      signal: AbortSignal.timeout(supplyConfig.fetch.timeoutMs),
      headers: {
        'User-Agent': supplyConfig.fetch.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5',
      },
    });
    const finalValidated = validateUrl(res.url || url);
    if (!finalValidated.ok) return { ...finalValidated, ms: Date.now() - started };
    if (res.status === 404 || res.status === 410) {
      return { ok: false, code: 'not_found', detail: `HTTP ${res.status}`, status: res.status, ms: Date.now() - started };
    }
    if ([401, 403, 429, 451].includes(res.status)) {
      return { ok: false, code: 'blocked_by_site', detail: `HTTP ${res.status}`, status: res.status, ms: Date.now() - started };
    }
    if (!res.ok) {
      return { ok: false, code: 'fetch_failed', detail: `HTTP ${res.status}`, status: res.status, ms: Date.now() - started };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > supplyConfig.fetch.maxBytes) {
      return { ok: false, code: 'too_large', detail: `${buf.length} bytes`, ms: Date.now() - started };
    }
    return {
      ok: true, status: res.status, finalUrl: res.url || url,
      contentType: res.headers.get('content-type') ?? '',
      body: buf.toString('utf8'), ms: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, code: 'fetch_failed', detail: err instanceof Error ? err.message : 'unknown', ms: Date.now() - started };
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const scanMode = args[0] === '--scan';
  const urls = scanMode ? args.slice(1) : args;
  if (!urls.length) {
    console.log('Usage: npx tsx scripts/manual-extract.ts [--scan] <url> [url…]');
    process.exit(1);
  }

  for (const url of urls) {
    console.log(`\n=== ${url} ===`);
    if (scanMode) {
      const fetched = await proxyFetcher(url);
      if (!fetched.ok) {
        console.log(`  fetch: ${fetched.code} (${fetched.detail})`);
        continue;
      }
      console.log(`  fetched ${fetched.body.length} bytes in ${fetched.ms}ms (${fetched.contentType.split(';')[0]})`);
      const isFeed = looksLikeFeed(fetched.contentType, fetched.body);
      const candidates = isFeed
        ? parseFeedLinks(fetched.body, fetched.finalUrl)
        : identifyCandidateLinks(fetched.body, fetched.finalUrl);
      console.log(`  method: ${isFeed ? 'rss' : 'html'} — ${candidates.length} candidate event links`);
      candidates.slice(0, 8).forEach((c) => console.log(`    • ${c}`));
      for (const candidate of candidates.slice(0, 2)) {
        await sleep(1500);
        await extractOne(candidate);
      }
    } else {
      await extractOne(url);
    }
    await sleep(1500);
  }
  process.exit(0);
}

async function extractOne(url: string) {
  console.log(`  → extracting ${url}`);
  const fetched = await proxyFetcher(url);
  if (!fetched.ok) {
    console.log(`    fetch: ${fetched.code} (${fetched.detail})`);
    return;
  }
  const page = inspectPage(fetched.body, fetched.finalUrl);
  console.log(`    structured Event data: ${page.structuredDataFound ? 'YES (JSON-LD)' : 'no'}`);
  console.log(`    title: ${page.title ? `"${page.title.value}" [${page.title.source}]` : '—'}`);
  console.log(`    start: ${page.startAt?.value ?? '—'}  end: ${page.endAt?.value ?? '—'}`);
  console.log(`    venue: ${page.venueName?.value ?? '—'}  city: ${page.city?.value ?? '—'}  country: ${page.country?.value ?? '—'}`);
  console.log(`    performers: ${page.performers.length ? page.performers.slice(0, 6).join(', ') : '—'}`);
  console.log(`    ticket: ${page.ticketUrl?.value ?? '—'}`);
  console.log(`    image: ${page.imageUrl?.value ? 'yes' : '—'}  canonical: ${page.canonicalUrl ? 'yes' : '—'}  feeds: ${page.feedUrls.length}`);
  const outcome = await runExtractionPipeline(url, { fetcher: proxyFetcher, scanKind: 'manual' });
  console.log(`    pipeline: ${outcome.status}${outcome.eventId ? ` → event ${outcome.eventId}` : ''}${outcome.duplicateOf ? ` (dup of ${outcome.duplicateOf})` : ''}`);
}

main();
