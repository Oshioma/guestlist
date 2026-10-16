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
  modifiedTime?: string | null;
  authors?: string[];
  noIndex?: boolean;
  // A feed this page is the human-readable version of. Feed readers and
  // browser extensions find a feed through this link, not by guessing paths.
  feed?: { url: string; title: string };
}): Metadata {
  const url = absolute(opts.path)!;
  const image = absolute(opts.image);
  const description = clamp(opts.description, 300) ?? undefined;
  return {
    title: opts.title,
    description,
    alternates: {
      canonical: url,
      ...(opts.feed ? { types: { 'application/rss+xml': [{ url: absolute(opts.feed.url)!, title: opts.feed.title }] } } : {}),
    },
    robots: opts.noIndex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: opts.title,
      description,
      url,
      siteName: SITE_NAME,
      type: opts.type ?? 'website',
      ...(opts.publishedTime ? { publishedTime: opts.publishedTime } : {}),
      ...(opts.modifiedTime ? { modifiedTime: opts.modifiedTime } : {}),
      ...(opts.authors?.length ? { authors: opts.authors } : {}),
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
  listing_status?: string | null;
  promoter?: { name: string; slug: string | null } | null;
};

// What a promoter has told us about the night, in the words Google reads.
// Without this every night said EventScheduled — including the ones the page
// itself announces as CANCELLED, which is the version people saw in search.
// A sold-out night is still going ahead; it is the tickets that have gone
// (offers.availability, below).
const EVENT_STATUS: Record<string, string> = {
  confirmed: 'https://schema.org/EventScheduled',
  sold_out: 'https://schema.org/EventScheduled',
  postponed: 'https://schema.org/EventPostponed',
  rescheduled: 'https://schema.org/EventRescheduled',
  cancelled: 'https://schema.org/EventCancelled',
};

export function schemaEventStatus(listingStatus: string | null | undefined): string {
  return EVENT_STATUS[listingStatus ?? 'confirmed'] ?? EVENT_STATUS.confirmed;
}

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

  // A price only means something with its currency. Plenty of the nights we
  // read abroad come with a number and no currency, and calling a Berlin
  // "15" fifteen pounds is precisely the made-up detail this avoids — so a
  // price whose currency we do not know is left out, not defaulted to GBP.
  const price = e.price_from != null ? Number(e.price_from) : null;
  const offers = e.ticket_url
    ? {
        '@type': 'Offer',
        url: e.ticket_url,
        ...(price != null && Number.isFinite(price) && e.currency
          ? { price: String(price), priceCurrency: e.currency }
          : {}),
        availability: e.listing_status === 'sold_out'
          ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      }
    : null;

  // Who is putting the night on. Google wants an organizer and treats the
  // site that lists a night as a poor answer, so the promoter comes first,
  // with the page that is theirs on Guestlist. Guestlist only stands in when
  // nobody has claimed the night.
  const organizer = e.promoter?.name
    ? {
        '@type': 'Organization',
        name: e.promoter.name,
        ...(e.promoter.slug ? { url: `${SITE_URL}/promoters/${e.promoter.slug}` } : {}),
      }
    : { '@type': 'Organization', name: SITE_NAME, url: SITE_URL };

  const performers = (e.lineup ?? []).slice(0, 12)
    .map((a) => ({ '@type': 'PerformingGroup', name: a.name }));

  return {
    '@context': 'https://schema.org',
    '@type': performers.length ? 'MusicEvent' : 'Event',
    name: e.title,
    url: `${SITE_URL}/events/${e.slug}`,
    startDate: e.start_at,
    ...(e.end_at ? { endDate: e.end_at } : {}),
    eventStatus: schemaEventStatus(e.listing_status),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(clamp(e.description ?? e.short_description, 400)
      ? { description: clamp(e.description ?? e.short_description, 400) } : {}),
    ...(absolute(e.primary_image_url) ? { image: [absolute(e.primary_image_url)] } : {}),
    ...(location ? { location } : {}),
    ...(offers ? { offers } : {}),
    ...(performers.length ? { performer: performers } : {}),
    organizer,
  };
}

/** The wordmark, as the publisher logo search engines show beside a piece. */
export const SITE_LOGO = `${SITE_URL}/brand/Guestlist_purple_300dpi.png`;

/**
 * A date as ISO 8601, whatever shape it arrived in. Article timestamps are
 * typed as strings and arrive from pg as Date objects, so both are handled
 * rather than trusting the type; anything unreadable is left out, not guessed.
 */
export function isoDate(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

type ArticleForSchema = {
  title: string; slug: string; subtitle: string | null; excerpt: string | null;
  hero_image_url: string | null;
  published_at: string | Date | null; updated_at: string | Date | null;
  author_name: string;
  // Null when the writer's profile is not public: a link to a page that 404s
  // is worse than no link, and it would announce a profile they chose to hide.
  author_url?: string | null;
  section_slug: string; section_name: string;
  tags?: string[];
};

/**
 * A piece of writing, in the vocabulary a search engine reads.
 *
 * Without it a search engine guesses the headline, the date and who wrote it
 * from the page, and gets the date wrong often enough to matter — a piece
 * about last summer's festival dated as today's news. An Event Feature is
 * reporting on a night that happened, so it is a NewsArticle; a Balance piece
 * is an essay or a reflection, so it is a plain Article. The publisher is
 * Guestlist, with its logo, because that is whose name the piece goes out
 * under once the desk has published it.
 */
export function articleSchema(a: ArticleForSchema): Record<string, unknown> {
  const url = `${SITE_URL}/balance/${a.slug}`;
  const description = clamp(a.excerpt || a.subtitle, 300);
  const image = absolute(a.hero_image_url);
  const published = isoDate(a.published_at);
  const modified = isoDate(a.updated_at) ?? published;
  return {
    '@context': 'https://schema.org',
    '@type': a.section_slug === 'events' ? 'NewsArticle' : 'Article',
    headline: clamp(a.title, 110) ?? a.title,
    ...(description ? { description } : {}),
    ...(image ? { image: [image] } : {}),
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
    author: { '@type': 'Person', name: a.author_name, ...(a.author_url ? { url: a.author_url } : {}) },
    publisher: {
      '@type': 'Organization', name: SITE_NAME, url: SITE_URL,
      logo: { '@type': 'ImageObject', url: SITE_LOGO },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    articleSection: a.section_name,
    ...(a.tags?.length ? { keywords: a.tags.join(', ') } : {}),
  };
}

/**
 * Structured data as the body of a <script> tag. JSON.stringify leaves "<"
 * alone, so a headline containing "</script>" would end the tag early and
 * the rest of it would be read as HTML — escaping it keeps the JSON identical
 * to a parser and inert to the page.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
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
