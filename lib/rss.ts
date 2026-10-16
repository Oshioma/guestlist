// THE WRITING, FOR PEOPLE WHO READ IN A FEED READER.
//
// Balance and the Event Features had no feed, so the readers most likely to
// follow a small publication — the ones who still keep a feed reader — had
// no way to, and nothing could syndicate it either.
//
// The builder is a pure function, articles in and XML out, so what a feed
// reader receives can be tested without a database or a server: the escaping
// is exactly the part that breaks silently, as one ampersand in a headline
// makes the whole document invalid and most readers then show nothing.

import { SITE_NAME, SITE_URL, absolute } from './seo';

/** Where the feed lives, and what the pages that advertise it call it. */
export const WRITING_FEED = { url: '/balance/rss.xml', title: `${SITE_NAME} · Balance and Event Features` };

export type FeedArticle = {
  slug: string; title: string; subtitle: string | null; excerpt: string | null;
  author_name: string; section_name: string;
  published_at: string | Date | null;
  hero_image_url?: string | null;
  tags?: string[];
};

/** The five characters XML reserves, and nothing else touched. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not allowed in XML 1.0 at all, escaped or not,
    // and one pasted in from a word processor would invalidate the feed.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * RSS 2.0 wants RFC 822 dates ("Fri, 16 Oct 2026 09:30:00 GMT"), which is what
 * toUTCString produces. ISO dates are the commonest mistake in hand-built
 * feeds, and several readers then sort every item as if it were published now.
 */
export function rfc822(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toUTCString();
}

export function articlesRss(articles: FeedArticle[], opts: {
  title?: string; description?: string; path?: string; feedPath?: string; now?: Date;
} = {}): string {
  const link = absolute(opts.path ?? '/balance')!;
  const self = absolute(opts.feedPath ?? '/balance/rss.xml')!;
  // The channel's date is the newest piece's, so an unchanged feed reads as
  // unchanged; "now" only when there is nothing in it yet.
  const newest = articles.map((a) => rfc822(a.published_at)).find(Boolean)
    ?? (opts.now ?? new Date()).toUTCString();
  const items = articles.map((a) => {
    const url = `${SITE_URL}/balance/${encodeURIComponent(a.slug)}`;
    const date = rfc822(a.published_at);
    const description = a.excerpt || a.subtitle;
    const image = absolute(a.hero_image_url);
    return [
      '    <item>',
      `      <title>${escapeXml(a.title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      ...(date ? [`      <pubDate>${date}</pubDate>`] : []),
      `      <dc:creator>${escapeXml(a.author_name)}</dc:creator>`,
      `      <category>${escapeXml(a.section_name)}</category>`,
      ...(a.tags ?? []).map((t) => `      <category>${escapeXml(t)}</category>`),
      ...(description ? [`      <description>${escapeXml(description)}</description>`] : []),
      ...(image ? [`      <enclosure url="${escapeXml(image)}" length="0" type="${imageType(image)}"/>`] : []),
      '    </item>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escapeXml(opts.title ?? `${SITE_NAME} · Balance and Event Features`)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(opts.description ?? 'Ideas, experiences and perspectives from the Guestlist community, and the nights, written up.')}</description>`,
    '    <language>en-gb</language>',
    `    <lastBuildDate>${newest}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

// An enclosure must say what it is. Hero images are mostly JPEGs; the others
// are named for what their address ends in.
function imageType(url: string): string {
  const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
}
