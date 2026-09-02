// Central configuration for the Event Supply Engine. Every threshold and
// limit lives here (env-overridable) — no magic numbers scattered in code.

const num = (env: string | undefined, fallback: number) => {
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
};

export const supplyConfig = {
  fetch: {
    timeoutMs: num(process.env.SUPPLY_FETCH_TIMEOUT_MS, 12_000),
    maxBytes: num(process.env.SUPPLY_FETCH_MAX_BYTES, 2_000_000),
    // Sitemaps are the exception to the page budget. 2MB is generous for a
    // web page and small for a list of every URL on a large site — the
    // sitemap protocol itself allows 50MB and 50,000 URLs per file. A
    // programme sitemap that overran the page budget was being dropped
    // silently, which reads as "this site has no events".
    maxSitemapBytes: num(process.env.SUPPLY_SITEMAP_MAX_BYTES, 15_000_000),
    maxRedirects: num(process.env.SUPPLY_FETCH_MAX_REDIRECTS, 5),
    userAgent:
      process.env.SUPPLY_USER_AGENT ??
      'GuestlistBot/1.0 (+https://guestlist.net; event discovery; contact info@guestlist.net)',
    // DEV/TEST ONLY: comma-separated hostnames exempt from the private-
    // address block, so fixture servers on 127.0.0.1 can be fetched in
    // automated tests. NEVER set in production.
    allowHosts: (process.env.SUPPLY_FETCH_ALLOW_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  ai: {
    // Extraction runs at volume; default to the fast/cheap model and let
    // deployments upgrade via env if quality demands it.
    model: process.env.EXTRACTION_AI_MODEL ?? 'claude-haiku-4-5-20251001',
    maxTokens: num(process.env.EXTRACTION_AI_MAX_TOKENS, 2_000),
    // Max characters of cleaned page text sent to the model.
    maxContentChars: num(process.env.EXTRACTION_AI_MAX_CONTENT_CHARS, 14_000),
  },

  // Duplicate scoring thresholds (0–100).
  dedupe: {
    possible: num(process.env.SUPPLY_DUP_POSSIBLE, 50),
    likely: num(process.env.SUPPLY_DUP_LIKELY, 85),
  },

  // Conservative auto-publish gate. ALL conditions must hold; anything else
  // goes to review. Only sources with trust = 'trusted' ever qualify.
  autoPublish: {
    minOverallConfidence: num(process.env.SUPPLY_AUTO_PUBLISH_CONFIDENCE, 85),
    minTitleConfidence: num(process.env.SUPPLY_AUTO_PUBLISH_TITLE, 90),
    minDateConfidence: num(process.env.SUPPLY_AUTO_PUBLISH_DATE, 90),
    minLocationConfidence: num(process.env.SUPPLY_AUTO_PUBLISH_LOCATION, 75),
  },

  // Public submission abuse protection (see /api/submissions).
  rateLimit: {
    memberPerHour: num(process.env.SUPPLY_SUBMISSIONS_PER_MEMBER_HOUR, 10),
    anonPerIpPerHour: num(process.env.SUPPLY_SUBMISSIONS_PER_IP_HOUR, 5),
  },

  scan: {
    // Hard caps so a scan can never become an uncontrolled crawl.
    maxCandidatesPerScan: num(process.env.SUPPLY_SCAN_MAX_CANDIDATES, 40),
    maxExtractionsPerScan: num(process.env.SUPPLY_SCAN_MAX_EXTRACTIONS, 10),
    // Small politeness delay between fetches to the same source.
    delayBetweenFetchesMs: num(process.env.SUPPLY_SCAN_DELAY_MS, 1_000),
  },
};
