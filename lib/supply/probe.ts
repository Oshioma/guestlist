// PROBE: fetch one URL the way the scanner would, and again with a browser
// user agent, then report what the scanner would have made of it. Shared by
// the per-source "Test fetch" diagnostic and by the discovery workbench,
// where a candidate has to survive this before anyone adds it as a source.
//
// The browser-user-agent request exists only to diagnose user-agent
// filtering; the scanner itself never masquerades as a browser.

import { parse } from 'node-html-parser';
import { safeFetch, type SafeFetchResult } from './safeFetch';
import { identifyCandidateLinks, identifyEmbeddedLinks, parseFeedLinks, looksLikeFeed, looksLikeSitemap, walkSitemap, canonicaliseCandidateUrl, findSitemapEvents, looksClientRendered } from './scanner';
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

  // What the scanner would make of the successful bot response. Read exactly
  // the way scanSource reads it, so the test and the scan cannot disagree —
  // an admin who is told "4 candidates via HTML" and then gets 40 events out
  // of the same URL has been told a lie by a diagnostic.
  let method: 'rss' | 'html' | 'sitemap' | null = null;
  let found: string[] = [];
  let embedded = 0;
  let sampleUrls: string[] = [];
  if (asBot.ok) {
    if (looksLikeSitemap(asBot.body)) {
      // Somebody pointed the source straight at a sitemap. Read it as one:
      // XML has no <a href> in it, so the HTML reader finds nothing and the
      // site looks empty when in fact it handed us its whole event list.
      // walkSitemap is what the scan uses, index-stepping included, so the
      // two cannot disagree.
      method = 'sitemap';
      const walked = await walkSitemap(asBot, safeFetch, supplyConfig.scan.delayBetweenFetchesMs);
      found = walked.found;
      sampleUrls = walked.sample;
    } else if (looksLikeFeed(asBot.contentType, asBot.body)) {
      method = 'rss';
      found = parseFeedLinks(asBot.body, asBot.finalUrl);
    } else {
      method = 'html';
      found = identifyCandidateLinks(asBot.body, asBot.finalUrl);
      // How much of that came from the page's embedded data rather than its
      // markup — the difference between "this page hides its listings" and
      // "this page shipped them, just not as links".
      const inMarkup = new Set(found);
      embedded = identifyEmbeddedLinks(asBot.body, asBot.finalUrl).filter((u) => inMarkup.has(u)).length;
    }
  }
  const candidates: number | null = asBot.ok ? found.length : null;

  // The URLs themselves, not just how many. Four candidates on a page full of
  // events is a mystery until you can see that all four are the site's own
  // navigation — at which point the answer is obvious.
  const candidateUrls = found.slice(0, 8);

  // Only ever asked of HTML. A sitemap is XML: it has no shell to be empty.
  const clientRendered = asBot.ok && method === 'html' && looksClientRendered(asBot.body);

  // WE ALREADY FETCHED THIS PAGE TWICE. Until now we only compared the two
  // status codes, which catches a site that BLOCKS our bot and misses the
  // more common thing a big site does: serve it a different page. Same 200,
  // same content type, a shell instead of the listings. Reading both bodies
  // costs nothing and is the difference between "this page renders in the
  // browser" and "this page renders in the browser FOR US".
  //
  // Knowing is not doing: the scanner still never masquerades as a browser.
  // But an admin cannot decide what to do about a wall nobody has named.
  let browserCandidates: number | null = null;
  if (asBrowser.ok && method === 'html') {
    browserCandidates = identifyCandidateLinks(asBrowser.body, asBrowser.finalUrl).length;
  }
  // A couple more links is noise — a nav that differs, a cookie banner. A
  // page of listings against a handful is a different page.
  const servesBrowsersMore =
    browserCandidates !== null && browserCandidates >= 5 && browserCandidates >= (candidates ?? 0) * 3;

  const result: ProbeResult = {
    target, bot: toProbe(asBot), browser: toProbe(asBrowser), method, candidates,
    candidateUrls, clientRendered, embedded, sampleUrls, browserCandidates,
    servesBrowsersMore,
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
  //
  // A HANDFUL of candidates counts as none here. A big listing page that
  // yields four links has not given us its listings — it has given us its
  // navigation, and the four look like events only because "programme" is in
  // the path. Checking the sitemap in that case is what turns "4 candidates,
  // 0 events" from a dead end into an answer.
  const FEW = 5;
  // Nothing to offer when the target already IS a sitemap — pointing an admin
  // at the sitemap of the sitemap they just gave us is not help.
  const worthSitemap = method !== 'sitemap' && !embedded && (!asBot.ok || (candidates ?? 0) < FEW || clientRendered);
  if (opts.findListingOnMiss && worthSitemap && origin) {
    await new Promise((r) => setTimeout(r, supplyConfig.scan.delayBetweenFetchesMs));
    const sitemap = await findSitemapEvents(origin, safeFetch);
    // A sitemap we could read but which held no event pages is not a rescue.
    // Keep what it listed, though — it says more about the site than silence.
    if (sitemap && !sitemap.found) {
      return { ...result, sampleUrls: sitemap.sample ?? sampleUrls };
    }
    if (sitemap) {
      // Nothing readable on the page: the sitemap IS the source.
      if ((candidates ?? 0) === 0) {
        return {
          target: sitemap.url,
          bot: { ok: true, status: 200, code: null, detail: null, ms: 0 },
          browser: result.browser,
          method: 'sitemap',
          candidates: sitemap.found,
          candidateUrls: sitemap.urls?.slice(0, 8) ?? [],
          foundVia: { triedFirst: target, viaSitemap: true },
        };
      }
      // A few candidates and a much richer sitemap: offer it, do not swap it
      // in. The admin was looking at a filtered view; the sitemap is the whole
      // site, and that is their call to make.
      if (sitemap.found > (candidates ?? 0)) {
        return { ...result, sitemapAlternative: { url: sitemap.url, found: sitemap.found } };
      }
    }
  }
  return result;
}
