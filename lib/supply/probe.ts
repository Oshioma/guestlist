// PROBE: fetch one URL the way the scanner would, and again with a browser
// user agent, then report what the scanner would have made of it. Shared by
// the per-source "Test fetch" diagnostic and by the discovery workbench,
// where a candidate has to survive this before anyone adds it as a source.
//
// The browser-user-agent request exists only to diagnose user-agent
// filtering; the scanner itself never masquerades as a browser.

import { safeFetch, type SafeFetchResult } from './safeFetch';
import { identifyCandidateLinks, parseFeedLinks, looksLikeFeed } from './scanner';
import { supplyConfig } from './config';
import type { FetchProbe, ProbeResult } from './verdict';

export type { FetchProbe, ProbeResult } from './verdict';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SCANNER_ACCEPT =
  'application/rss+xml,application/atom+xml,text/html,application/xhtml+xml,application/xml;q=0.9';

const toProbe = (r: SafeFetchResult): FetchProbe =>
  r.ok
    ? { ok: true, status: r.status, code: null, detail: null, ms: r.ms }
    : { ok: false, status: r.status ?? null, code: r.code, detail: r.detail, ms: r.ms };

export async function probeTarget(target: string): Promise<ProbeResult> {
  const asBot = await safeFetch(target, { accept: SCANNER_ACCEPT });
  await new Promise((r) => setTimeout(r, supplyConfig.scan.delayBetweenFetchesMs));
  const asBrowser = await safeFetch(target, { accept: SCANNER_ACCEPT, userAgent: BROWSER_UA });

  // What the scanner would make of the successful bot response.
  let method: 'rss' | 'html' | null = null;
  let candidates: number | null = null;
  if (asBot.ok) {
    if (looksLikeFeed(asBot.contentType, asBot.body)) {
      method = 'rss';
      candidates = parseFeedLinks(asBot.body, asBot.finalUrl).length;
    } else {
      method = 'html';
      candidates = identifyCandidateLinks(asBot.body, asBot.finalUrl).length;
    }
  }

  return { target, bot: toProbe(asBot), browser: toProbe(asBrowser), method, candidates };
}
