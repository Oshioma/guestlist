// PROBE: fetch one URL the way the scanner would, and again with a browser
// user agent, then report what the scanner would have made of it. Shared by
// the per-source "Test fetch" diagnostic and by the discovery workbench,
// where a candidate has to survive this before anyone adds it as a source.
//
// The browser-user-agent request exists only to diagnose user-agent
// filtering; the scanner itself never masquerades as a browser.

import { parse } from 'node-html-parser';
import { safeFetch, type SafeFetchResult } from './safeFetch';
import { identifyCandidateLinks, parseFeedLinks, looksLikeFeed, canonicaliseCandidateUrl, findSitemapEvents } from './scanner';
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

// A suggested listing path is often a near miss — /en/agenda when the site
// uses /agenda. Rather than write the whole venue off on a 404, look at its
// homepage for the link a person would click.
const LISTING_TEXT = /\b(agenda|programma|programme|program|programm|events?|eventi|eventos|evenements?|evenementen|veranstaltungen|serate|soirees?|fiestas|festas|what['\u2019]?s[ -]?on|line[ -]?up|kalender|calendar|shows?|gigs|tickets|biglietti|entradas)\b/i;

export function findListingLink(html: string, baseUrl: string): string | null {
  const root = parse(html);
  const base = new URL(baseUrl);
  let best: { url: string; score: number } | null = null;
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const canonical = href && canonicaliseCandidateUrl(href, baseUrl);
    if (!canonical) continue;
    let url: URL;
    try { url = new URL(canonical); } catch { continue; }
    if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (url.pathname === '/' || url.pathname === base.pathname) continue;
    const pathHit = LISTING_TEXT.test(url.pathname);
    const textHit = LISTING_TEXT.test(a.structuredText ?? '');
    if (!pathHit && !textHit) continue;
    // A matching path is stronger evidence than matching link text, and a
    // short path ("/agenda") beats a deep one ("/en/news/agenda-2019").
    const score = (pathHit ? 2 : 0) + (textHit ? 1 : 0) - url.pathname.split('/').filter(Boolean).length * 0.1;
    if (!best || score > best.score) best = { url: canonical, score };
  }
  return best?.url ?? null;
}

export async function probeTarget(
  target: string,
  opts: { findListingOnMiss?: boolean } = {}
): Promise<ProbeResult> {
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

  const result: ProbeResult = {
    target, bot: toProbe(asBot), browser: toProbe(asBrowser), method, candidates,
  };

  // The page is missing, or it loads but has no event links on it: in both
  // cases the homepage may point at the real listing page.
  const worthRetrying = !asBot.ok ? asBot.status === 404 : candidates === 0;
  const origin = (() => { try { return new URL(target).origin; } catch { return null; } })();
  if (opts.findListingOnMiss && worthRetrying && origin && origin !== target.replace(/\/$/, '')) {
    await new Promise((r) => setTimeout(r, supplyConfig.scan.delayBetweenFetchesMs));
    const home = await safeFetch(origin, { accept: SCANNER_ACCEPT });
    const listing = home.ok ? findListingLink(home.body, home.finalUrl) : null;
    if (listing && listing !== target) {
      await new Promise((r) => setTimeout(r, supplyConfig.scan.delayBetweenFetchesMs));
      const retry = await probeTarget(listing);
      // Only offer the alternative when it is actually better.
      if ((retry.candidates ?? 0) > (candidates ?? 0)) {
        return { ...retry, foundVia: { triedFirst: target } };
      }
    }
  }

  // Last resort, and the only route into a site that renders its listings in
  // JavaScript or refuses our user agent: its sitemap.
  const worthSitemap = !asBot.ok || candidates === 0;
  if (opts.findListingOnMiss && worthSitemap && origin) {
    await new Promise((r) => setTimeout(r, supplyConfig.scan.delayBetweenFetchesMs));
    const sitemap = await findSitemapEvents(origin, safeFetch);
    if (sitemap) {
      return {
        target: sitemap.url,
        bot: { ok: true, status: 200, code: null, detail: null, ms: 0 },
        browser: result.browser,
        method: 'sitemap',
        candidates: sitemap.found,
        foundVia: { triedFirst: target, viaSitemap: true },
      };
    }
  }
  return result;
}
