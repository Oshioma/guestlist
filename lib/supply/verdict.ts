// The shape of a fetch probe and the plain-English verdict an admin reads.
// Pure — no server imports — so both the admin table and the discovery
// workbench can render the same sentence for the same result.

export type FetchProbe = {
  ok: boolean;
  status: number | null;
  code: string | null;
  detail: string | null;
  ms: number;
};

export type ProbeResult = {
  target: string;
  bot: FetchProbe;
  browser: FetchProbe;
  method: 'rss' | 'html' | 'sitemap' | null;
  candidates: number | null;
  // The first few links we actually took as candidates. "4 candidates" on a
  // page full of events is a mystery; the four URLs are the answer — they are
  // usually the site's own navigation, which says the listings are not in the
  // HTML at all.
  candidateUrls?: string[];
  // The page ships an empty results container and a client-side template: its
  // listings are fetched by JavaScript and are not in the HTML at all. Not a
  // guess — see looksClientRendered in lib/supply/scanner.
  clientRendered?: boolean;
  // How many of the candidates were read out of the page's embedded data
  // rather than its markup. A client-rendered page that still handed us its
  // event list is a success, not a warning.
  embedded?: number;
  // What a sitemap DID contain, when none of it looked like event pages.
  // Shown so the shape of the site's URLs is visible instead of guessed at.
  sampleUrls?: string[];
  // The same page read again with a browser user agent. Both requests were
  // already being made; only the status codes were ever compared.
  browserCandidates?: number | null;
  // The browser got a real listing and we got a shell. Same 200, different
  // page — a wall that a status-code comparison walks straight past.
  servesBrowsersMore?: boolean;
  // Links that were the page itself under a different filter. Dropped, but
  // counted: they are the difference between an empty page and a page whose
  // only "event links" were its own tabs.
  ownFilters?: number;
  // Child sitemaps we could not read, with the reason. A sitemap we failed to
  // fetch is not a sitemap with no events in it, and the two must not be
  // reported as the same thing.
  skippedSitemaps?: string[];
  // A sitemap the site declared in robots.txt that answered when the one we
  // were pointed at did not. Named, because the admin should move the source
  // to it rather than rely on us finding it again every scan.
  declaredSitemap?: string | null;
  // A sitemap with more event pages than the listing page gave us. Offered
  // rather than substituted: the admin was looking at a filtered view, and the
  // sitemap is the whole site.
  sitemapAlternative?: { url: string; found: number };
  // Set when the URL we were given was a miss and we found the real listing
  // page from the site's homepage instead. `target` is then the page that
  // worked, and this records the one that did not.
  foundVia?: { triedFirst: string; viaSitemap?: boolean };
};

export const probeLabel = (p: FetchProbe) =>
  p.ok ? `HTTP ${p.status}` : `${p.code}${p.detail ? ` (${p.detail})` : ''}`;

// Turn the two probes into the sentence an admin actually needs.
export function testVerdict(t: ProbeResult): { text: string; bad: boolean } {
  // Said before anything else, because it changes what every other sentence
  // would mean: the page we are describing is not the page you are looking at.
  if (t.servesBrowsersMore) {
    return {
      text: `This site serves us a different page from the one you see: ${t.browserCandidates} event links with a browser user agent, ${t.candidates ?? 0} for GuestlistBot — same HTTP 200 both times, so nothing looked wrong until now. It is not JavaScript, it is the site choosing. Its sitemap is the honest way in${t.sitemapAlternative ? `: use ${t.sitemapAlternative.url}, which lists ${t.sitemapAlternative.found} event pages` : ', if it has one with event pages in it'}.`,
      bad: true,
    };
  }
  if (t.bot.ok && (t.candidates ?? 0) > 0) {
    return {
      text: t.declaredSitemap
        ? `OK — the sitemap you gave us holds no event pages, but the site declares another one in its robots.txt: ${t.declaredSitemap}, with ${t.candidates} event page${t.candidates === 1 ? '' : 's'}. Scans will use it. Set it as the source URL to make that explicit.`
        : t.foundVia?.viaSitemap
        ? `OK via the sitemap — the listing page gave us nothing (JavaScript, or it blocks our bot), but ${t.target} lists ${t.candidates} event page${t.candidates === 1 ? '' : 's'}. Scans will use it.`
        : t.foundVia
          ? `OK — that URL was a dead end, but the site's listing page is ${t.target}, with ${t.candidates} candidate event link${t.candidates === 1 ? '' : 's'}. Add uses the working one.`
          : t.embedded
            ? `OK — ${t.candidates} candidate event link${t.candidates === 1 ? '' : 's'}, ${t.embedded} of them read out of the data the page ships with rather than its markup. This page builds its listings in the browser, but it was served the answer alongside the shell, so there is nothing to chase. Scan it to see how many become events.`
          : t.clientRendered
            ? `This page builds its listings in the browser — the event list is empty in the HTML we are served, so the ${t.candidates} link${t.candidates === 1 ? '' : 's'} we found ${t.candidates === 1 ? 'is' : 'are'} its own navigation.${t.sitemapAlternative ? ` Its sitemap lists ${t.sitemapAlternative.found} event pages: use ${t.sitemapAlternative.url} instead.` : ' Try the site\u2019s sitemap, or a page that lists events without filtering.'}`
            : t.sitemapAlternative
            ? `Only ${t.candidates} candidate link${t.candidates === 1 ? '' : 's'} in the raw HTML — this page builds its listings in the browser, so most of what you can see is not in what we can read. Its sitemap lists ${t.sitemapAlternative.found} event pages: use ${t.sitemapAlternative.url} instead.`
            : `OK — ${t.candidates} candidate event link${t.candidates === 1 ? '' : 's'} via ${t.method?.toUpperCase()}. Scan it to see how many become events.`,
      bad: !t.embedded && (!!t.sitemapAlternative || !!t.clientRendered),
    };
  }
  if (t.bot.ok) {
    // Naming the method matters: a zero-candidate RSS result means the saved
    // feed is the problem, not the listing page's markup.
    return {
      text:
        t.method === 'rss'
          ? 'Reachable, but this feed contains no event links — it is probably a generic blog or news feed. Clear the feed URL below so scans use the listing page again.'
          : t.method === 'sitemap'
          ? `This is a sitemap, and we read it as one — including the section sitemaps it points at and any others the site declares in its robots.txt — but none of the URLs we could read look like event pages.${t.sampleUrls?.length ? ` They look like this: ${t.sampleUrls.slice(0, 5).join(', ')}.` : ''}${t.skippedSitemaps?.length ? ` ${t.skippedSitemaps.length} section sitemap${t.skippedSitemaps.length === 1 ? '' : 's'} could not be read at all: ${t.skippedSitemaps.slice(0, 3).join(', ')}.` : ''} Point the source at the sitemap for the programme section, if the site has one.`
          : t.clientRendered
            ? `Reachable, but this page builds its listings in the browser — the event list is empty in the HTML we are served.${t.ownFilters ? ` The only event-shaped links on it are ${t.ownFilters} of its own filter tabs.` : ''} Use the site\u2019s sitemap, or a page that lists events without filtering.`
            : t.ownFilters
            ? `Reachable, but the only event-shaped links on this page are ${t.ownFilters} of its own filter tabs — the same page again, re-queried. The listings themselves are not in the HTML we are served.`
            : 'Reachable, but no event links found in the raw HTML — the page may render its listings with JavaScript, or its link paths are unrecognised',
      bad: true,
    };
  }
  if (t.browser.ok) {
    return {
      text: `The site filters by user agent: GuestlistBot got ${probeLabel(t.bot)} while a browser user agent got ${probeLabel(t.browser)}`,
      bad: true,
    };
  }
  return {
    text: `Unreachable with both user agents (bot: ${probeLabel(t.bot)}, browser: ${probeLabel(t.browser)}) — wrong URL, or the site blocks this server's IP`,
    bad: true,
  };
}
