// BEING FINDABLE.
//
// Guestlist reads other people's sitemaps to discover their nights
// (lib/supply/scanner.ts) and published none of its own. Every event page on
// the site shared one title — "Guestlist" — and one description, so a hundred
// nights produced a hundred identical search results and a hundred identical
// link previews.
//
// This is the shared half of fixing that: one place that knows the site's
// address, how to turn a night into a title, and how to describe it to a
// search engine in the vocabulary search engines actually read.

import type { Metadata } from 'next';

export const SITE_URL = (process.env.SITE_URL ?? 'https://www.guestlist.net').replace(/\/$/, '');
export const SITE_NAME = 'Guestlist';

/** A path becomes an absolute URL; an absolute URL is left alone. */
export function absolute(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/**
 * Search results and link previews cut long text mid-word and leave it
 * dangling. Better to cut it ourselves, at a word, and say so with an
 * ellipsis.
 */
export function clamp(text: string | null | undefined, max: number): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:!?-]+$/, '')}…`;
}

/**
 * One page's metadata, built the same way every time.
 *
 * The canonical matters more here than on most sites: an event is reachable
 * with ?src= tracking on it from every share, and without a canonical each of
 * those is a separate page to a crawler, splitting whatever authority the
 * night has between them.
 */
export function pageMeta(opts: {
  title: string;
  description?: string | null;
  path: string;
  image?: string | null;
  type?: 'website' | 'article';
  publishedTime?: string | null;
  noIndex?: boolean;
}): Metadata {
  const url = absolute(opts.path)!;
  const image = absolute(opts.image);
  const description = clamp(opts.description, 300) ?? undefined;
  return {
    title: opts.title,
    description,
    alternates: { canonical: url },
    robots: opts.noIndex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: opts.title,
      description,
      url,
      siteName: SITE_NAME,
      type: opts.type ?? 'website',
      ...(opts.publishedTime ? { publishedTime: opts.publishedTime } : {}),
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: opts.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Structured data.
//
// This is the part that decides whether a night can appear in the "events near
// you" panel rather than as a blue link on page four. Google reads schema.org
// Event; we hold every field it asks for and were publishing none of them.
// ---------------------------------------------------------------------------

type EventForSchema = {
  title: string; slug: string; short_description: string | null;
  start_at: string; end_at: string | null;
  city: string | null; country: string | null;
  price_from: string | null; price_to: string | null; currency: string | null;
  primary_image_url: string | null;
  ticket_url?: string | null;
  description?: string | null;
  venue?: {
    name: string; address: string | null; city: string | null;
    country: string | null; latitude: number | null; longitude: number | null;
  } | null;
  venue_name?: string | null;
  lineup?: { name: string }[];
  genres?: { name: string }[];
};

/**
 * A night, in the vocabulary a search engine reads.
 *
 * MusicEvent rather than Event where there is a lineup, because that is what
 * these are and the richer type earns the richer result. Anything we do not
 * actually know is left out rather than guessed at — a wrong price or a made
 * up address in structured data is worse than none, because it is the version
 * people see before they ever reach the page.
 */
export function eventSchema(e: EventForSchema): Record<string, unknown> {
  const venueName = e.venue?.name ?? e.venue_name ?? null;
  const city = e.venue?.city ?? e.city;
  const country = e.venue?.country ?? e.country;

  const location = venueName
    ? {
        '@type': 'Place',
        name: venueName,
        ...(e.venue?.address || city || country
          ? {
              address: {
                '@type': 'PostalAddress',
                ...(e.venue?.address ? { streetAddress: e.venue.address } : {}),
                ...(city ? { addressLocality: city } : {}),
                ...(country ? { addressCountry: country } : {}),
              },
            }
          : {}),
        ...(e.venue?.latitude != null && e.venue?.longitude != null
          ? { geo: { '@type': 'GeoCoordinates', latitude: e.venue.latitude, longitude: e.venue.longitude } }
          : {}),
      }
    : city
      ? { '@type': 'Place', name: city,
          address: { '@type': 'PostalAddress', addressLocality: city,
                     ...(country ? { addressCountry: country } : {}) } }
      : null;

  const price = e.price_from != null ? Number(e.price_from) : null;
  const offers = e.ticket_url
    ? {
        '@type': 'Offer',
        url: e.ticket_url,
        ...(price != null && Number.isFinite(price)
          ? { price: String(price), priceCurrency: e.currency ?? 'GBP' }
          : {}),
        availability: 'https://schema.org/InStock',
      }
    : null;

  const performers = (e.lineup ?? []).slice(0, 12)
    .map((a) => ({ '@type': 'PerformingGroup', name: a.name }));

  return {
    '@context': 'https://schema.org',
    '@type': performers.length ? 'MusicEvent' : 'Event',
    name: e.title,
    url: `${SITE_URL}/events/${e.slug}`,
    startDate: e.start_at,
    ...(e.end_at ? { endDate: e.end_at } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(clamp(e.description ?? e.short_description, 400)
      ? { description: clamp(e.description ?? e.short_description, 400) } : {}),
    ...(absolute(e.primary_image_url) ? { image: [absolute(e.primary_image_url)] } : {}),
    ...(location ? { location } : {}),
    ...(offers ? { offers } : {}),
    ...(performers.length ? { performer: performers } : {}),
    organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  };
}

/** The site itself, so a brand search shows the name and a search box. */
export function organisationSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/events?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}
