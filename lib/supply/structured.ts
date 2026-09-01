// Structured-data-first page inspection: JSON-LD (schema.org Event),
// OpenGraph, standard meta tags, canonical URL — plus cleaned page text for
// the AI to interpret where structure is missing. All values extracted here
// carry provenance so moderation can show where each field came from.

import { parse, HTMLElement } from 'node-html-parser';
import type { FieldSource } from './schema';
import { pickPageImage } from './images';

export type StructuredField<T> = { value: T; source: FieldSource; confidence: number };

export type PageInspection = {
  canonicalUrl: string | null;
  title: StructuredField<string> | null;
  description: StructuredField<string> | null;
  startAt: StructuredField<string> | null; // ISO or date-time string as found
  endAt: StructuredField<string> | null;
  venueName: StructuredField<string> | null;
  venueAddress: StructuredField<string> | null;
  city: StructuredField<string> | null;
  country: StructuredField<string> | null;
  imageUrl: StructuredField<string> | null;
  ticketUrl: StructuredField<string> | null;
  priceFrom: StructuredField<number> | null;
  priceTo: StructuredField<number> | null;
  currency: StructuredField<string> | null;
  performers: string[]; // from JSON-LD performer entries
  organizerName: StructuredField<string> | null;
  organizerUrl: string | null;
  eventTypeHint: string | null; // schema.org subtype, e.g. Festival
  genres: string[]; // schema.org Event.genre values, when present
  // schema.org eventStatus mapped to Guestlist listing states.
  eventStatusHint: 'cancelled' | 'postponed' | 'rescheduled' | null;
  feedUrls: string[]; // RSS/Atom alternates advertised by the page
  structuredDataFound: boolean; // a schema.org Event was present
  cleanedText: string; // stripped page content for AI use
  jsonLdRaw: unknown[]; // parsed JSON-LD blocks (for debugging/tests)
};

type JsonLdEvent = Record<string, unknown>;

const EVENT_TYPES_LD = new Set([
  'Event', 'MusicEvent', 'Festival', 'DanceEvent', 'SocialEvent', 'ExhibitionEvent',
]);

function asArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function findJsonLdEvents(root: HTMLElement): { events: JsonLdEvent[]; raw: unknown[] } {
  const events: JsonLdEvent[] = [];
  const raw: unknown[] = [];
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent);
    } catch {
      continue; // malformed JSON-LD is common; ignore the block
    }
    raw.push(parsed);
    const queue = asArray(parsed);
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      const obj = node as JsonLdEvent;
      if (Array.isArray(obj['@graph'])) queue.push(...(obj['@graph'] as unknown[]));
      const types = asArray(obj['@type']).map((t) => String(t));
      if (types.some((t) => EVENT_TYPES_LD.has(t))) events.push(obj);
    }
  }
  return { events, raw };
}

function ldPlace(ev: JsonLdEvent): {
  name: string | null; address: string | null; city: string | null; country: string | null;
} {
  const loc = asArray(ev.location)[0] as JsonLdEvent | undefined;
  if (!loc || typeof loc !== 'object') return { name: null, address: null, city: null, country: null };
  const name = str(loc.name);
  const addr = loc.address as JsonLdEvent | string | undefined;
  if (typeof addr === 'string') {
    return { name, address: addr.trim() || null, city: null, country: null };
  }
  if (addr && typeof addr === 'object') {
    return {
      name,
      address: str(addr.streetAddress),
      city: str(addr.addressLocality),
      country: str(addr.addressCountry) ?? str((addr.addressCountry as JsonLdEvent | undefined)?.name),
    };
  }
  return { name, address: null, city: null, country: null };
}

function ldOffers(ev: JsonLdEvent): {
  ticketUrl: string | null; priceFrom: number | null; priceTo: number | null; currency: string | null;
} {
  const offers = asArray(ev.offers)
    .filter((o) => o && typeof o === 'object') as JsonLdEvent[];
  let ticketUrl: string | null = null;
  let priceFrom: number | null = null;
  let priceTo: number | null = null;
  let currency: string | null = null;
  for (const o of offers) {
    ticketUrl ||= str(o.url);
    const p = Number(o.price ?? (o.priceSpecification as JsonLdEvent | undefined)?.price);
    if (Number.isFinite(p)) {
      priceFrom = priceFrom == null ? p : Math.min(priceFrom, p);
      priceTo = priceTo == null ? p : Math.max(priceTo, p);
    }
    const low = Number(o.lowPrice);
    const high = Number(o.highPrice);
    if (Number.isFinite(low)) priceFrom = priceFrom == null ? low : Math.min(priceFrom, low);
    if (Number.isFinite(high)) priceTo = priceTo == null ? high : Math.max(priceTo, high);
    currency ||= str(o.priceCurrency)?.toUpperCase() ?? null;
  }
  if (priceFrom != null && priceTo != null && priceTo < priceFrom) [priceFrom, priceTo] = [priceTo, priceFrom];
  return { ticketUrl, priceFrom, priceTo, currency };
}

function meta(root: HTMLElement, ...selectors: string[]): string | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    const content = el?.getAttribute('content');
    if (content?.trim()) return content.trim();
  }
  return null;
}

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'svg', 'iframe', 'nav', 'footer', 'header',
  'form', 'aside', 'template', 'link', 'button',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[aria-hidden="true"]',
  '.cookie', '.cookies', '#cookie-banner', '.cookie-banner', '.gdpr', '.consent',
  '.nav', '.navbar', '.menu', '.footer', '.header', '.social-links', '.newsletter',
];

export function cleanPageText(root: HTMLElement, maxChars: number): string {
  const clone = parse(root.outerHTML); // work on a copy
  for (const sel of STRIP_SELECTORS) {
    try {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    } catch {
      /* selector not supported — skip */
    }
  }
  const main = clone.querySelector('main') ?? clone.querySelector('article') ?? clone;
  const text = main.structuredText
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Drop short repeated boilerplate lines (menus rendered as text).
  const seen = new Map<string, number>();
  const lines = text.split('\n').filter((line) => {
    const key = line.trim().toLowerCase();
    if (key.length === 0) return true;
    if (key.length < 30) {
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return n <= 2;
    }
    return true;
  });
  return lines.join('\n').slice(0, maxChars);
}

export function inspectPage(html: string, pageUrl: string, maxTextChars = 14000): PageInspection {
  const root = parse(html, { blockTextElements: { script: true, style: true } });
  const { events: ldEvents, raw } = findJsonLdEvents(root);
  const ld = ldEvents[0];

  const abs = (u: string | null): string | null => {
    if (!u) return null;
    try {
      const url = new URL(u, pageUrl);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    } catch {
      return null;
    }
  };

  const canonical =
    abs(root.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null) ??
    abs(meta(root, 'meta[property="og:url"]'));

  const f = <T>(value: T | null, source: FieldSource, confidence: number): StructuredField<T> | null =>
    value == null ? null : { value, source, confidence };

  // Field priority: JSON-LD → OpenGraph → meta/page.
  const ogTitle = meta(root, 'meta[property="og:title"]');
  const docTitle = root.querySelector('title')?.textContent?.trim() || null;
  const title =
    f(str(ld?.name), 'json-ld', 97) ?? f(ogTitle, 'opengraph', 85) ?? f(docTitle, 'meta', 65);

  const ogDesc = meta(root, 'meta[property="og:description"]', 'meta[name="description"]');
  const description = f(str(ld?.description), 'json-ld', 92) ?? f(ogDesc, 'meta', 70);

  const startAt = f(str(ld?.startDate), 'json-ld', 96);
  const endAt = f(str(ld?.endDate), 'json-ld', 94);

  const place = ld ? ldPlace(ld) : { name: null, address: null, city: null, country: null };
  const offers = ld ? ldOffers(ld) : { ticketUrl: null, priceFrom: null, priceTo: null, currency: null };

  const performers = ld
    ? asArray(ld.performer)
        .map((p) => (typeof p === 'string' ? p : str((p as JsonLdEvent)?.name)))
        .filter((n): n is string => !!n)
    : [];

  const organizer = ld ? (asArray(ld.organizer)[0] as JsonLdEvent | undefined) : undefined;
  const organizerName =
    organizer && typeof organizer === 'object' ? f(str(organizer.name), 'json-ld', 90) : null;
  const organizerUrl =
    organizer && typeof organizer === 'object' ? abs(str(organizer.url)) : null;

  const ogImage = abs(meta(root, 'meta[property="og:image"]', 'meta[property="og:image:url"]',
    'meta[property="og:image:secure_url"]', 'meta[name="twitter:image"]',
    'meta[property="twitter:image"]', 'meta[name="twitter:image:src"]'));
  const ldImageRaw = asArray(ld?.image)[0] as string | JsonLdEvent | undefined;
  const ldImage = ld
    ? abs(
        str(ldImageRaw) ??
          str((ldImageRaw as JsonLdEvent | undefined)?.url) ??
          // schema.org ImageObject says contentUrl; plenty of sites use it.
          str((ldImageRaw as unknown as { contentUrl?: unknown } | undefined)?.contentUrl)
      )
    : null;
  // When the metadata says nothing, read the page. Most promoter sites never
  // set og:image, and an event with no flyer is the one thing people notice.
  const pageImage = ldImage || ogImage ? null : pickPageImage(html, pageUrl);
  const imageUrl =
    f(ldImage, 'json-ld', 92) ??
    f(ogImage, 'opengraph', 80) ??
    f(pageImage?.url ?? null, 'page', 55);

  const feedUrls = root
    .querySelectorAll('link[rel="alternate"]')
    .filter((l) => /rss|atom/i.test(l.getAttribute('type') ?? ''))
    .map((l) => abs(l.getAttribute('href') ?? null))
    .filter((u): u is string => !!u);

  const ldTypes = ld ? asArray(ld['@type']).map(String) : [];
  const eventTypeHint = ldTypes.find((t) => t !== 'Event') ?? null;

  // schema.org Event.genre: string, array, or slash/comma-separated list.
  const genres = ld
    ? asArray(ld.genre)
        .map((g) => str(g))
        .filter((g): g is string => !!g)
        .flatMap((g) => g.split(/[,/|]/))
        .map((g) => g.trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

  const statusRaw = ld ? str(ld.eventStatus)?.toLowerCase() ?? '' : '';
  const eventStatusHint = statusRaw.includes('cancelled') || statusRaw.includes('canceled')
    ? ('cancelled' as const)
    : statusRaw.includes('postponed')
      ? ('postponed' as const)
      : statusRaw.includes('rescheduled')
        ? ('rescheduled' as const)
        : null;

  return {
    canonicalUrl: canonical,
    title,
    description,
    startAt,
    endAt,
    venueName: f(place.name, 'json-ld', 94),
    venueAddress: f(place.address, 'json-ld', 90),
    city: f(place.city, 'json-ld', 92),
    country: f(place.country, 'json-ld', 88),
    imageUrl,
    ticketUrl: f(abs(offers.ticketUrl), 'json-ld', 92),
    priceFrom: f(offers.priceFrom, 'json-ld', 90),
    priceTo: f(offers.priceTo, 'json-ld', 90),
    currency: f(offers.currency, 'json-ld', 90),
    performers,
    organizerName,
    organizerUrl,
    eventTypeHint,
    genres,
    eventStatusHint,
    feedUrls,
    structuredDataFound: !!ld,
    cleanedText: cleanPageText(root, maxTextChars),
    jsonLdRaw: raw,
  };
}
