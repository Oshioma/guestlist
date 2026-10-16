// THE LIST OF EVERYTHING WORTH FINDING.
//
// Guestlist reads other people's sitemaps to discover their nights and had
// none of its own, so nothing here could be crawled reliably. Built from the
// database rather than written by hand, because a night that goes live at
// four in the afternoon should be in the sitemap at four in the afternoon.
//
// Only what is genuinely public goes in. A logged-in surface (the Club
// Messenger, notifications, /you) is not a page a stranger can read, and
// listing it wastes the crawl on a redirect to the login screen.

import type { MetadataRoute } from 'next';
import { query } from '@/lib/db';
import { SITE_URL } from '@/lib/seo';
import { canonicalCountry, countrySlug } from '@/lib/countries';
import { publishedTagSlugs } from '@/lib/articles';

export const revalidate = 3600;

type Row = { path: string; updated: string | null; past?: boolean };

// One sitemap file may hold 50,000 addresses; past that a crawler rejects the
// whole file. Nights get whatever the rest of the site leaves, with headroom.
const MAX_URLS = 50_000;
const HEADROOM = 1_000;
const MAX_EVENT_URLS = 45_000;

const at = (path: string, updated?: string | null, priority = 0.5,
            changeFrequency: 'daily' | 'weekly' | 'monthly' = 'weekly') => ({
  url: `${SITE_URL}${path}`,
  lastModified: updated ? new Date(updated) : new Date(),
  changeFrequency,
  priority,
});

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Every query is wrapped: a sitemap that half-builds is worth far more than
  // one that 500s, because a 500 teaches a crawler to stop asking.
  const safe = async (sql: string, params: unknown[] = []): Promise<Row[]> => {
    try { return await query<Row>(sql, params); } catch { return []; }
  };

  const [events, venues, artists, articles, places, countries, archiveEvents, clubs] = await Promise.all([
    // Every live night, past ones included. It used to stop at sixty days,
    // which dropped a night out of search just as it became the thing people
    // look up — the line-up they saw, the party a friend went to — and those
    // pages still answer that (marked as past). Upcoming nights first, so if
    // the budget below ever bites it is the oldest history that waits.
    safe(`select '/events/' || slug as path, coalesce(updated_at, published_at)::text as updated,
                 coalesce(end_at, start_at + interval '6 hours') <= now() as past
            from events
           where status = 'live' and slug is not null
           order by (coalesce(end_at, start_at + interval '6 hours') > now()) desc, start_at desc
           limit ${MAX_EVENT_URLS}`),
    safe(`select '/venues/' || slug as path, null::text as updated
            from venues where slug is not null limit 2000`),
    safe(`select '/artists/' || slug as path, null::text as updated
            from artists where slug is not null limit 2000`),
    safe(`select '/balance/' || slug as path, coalesce(updated_at, published_at)::text as updated
            from articles where status = 'published' and slug is not null limit 2000`),
    // A city page is only worth crawling if it has something on it.
    safe(`select '/' || l.slug as path, null::text as updated
            from locations l
           where l.slug is not null
             and exists (select 1 from events e
                          where e.location_id = l.id and e.status = 'live'
                            and e.start_at > now() - interval '30 days')
           limit 500`),
    safe(`select distinct country_name as path, null::text as updated
            from locations where country_name is not null limit 300`),
    safe(`select '/archive/events/' || slug as path, null::text as updated
            from archive_events where slug is not null limit 3000`),
    safe(`select '/archive/clubs/' || slug as path, null::text as updated
            from scene_entities where slug is not null and entity_type = 'club' limit 2000`),
  ]);

  // A tag page per tag on a published piece. The address is computed in JS
  // (lib/articles.ts tagSlug), so it cannot be one more SQL string above.
  const tagPaths = await publishedTagSlugs().catch(() => [] as string[]);

  // Countries come back as names ("United Kingdom") and are pages by slug.
  const countryPaths = [...new Set(
    countries
      .map((c) => canonicalCountry(c.path))
      .filter((n): n is string => !!n)
      .map((n) => `/${countrySlug(n)}`)
  )];

  const fixed = [
    at('/', null, 1.0, 'daily'),
    at('/events', null, 0.9, 'daily'),
    at('/events/past', null, 0.5, 'daily'),
    at('/explore', null, 0.7, 'weekly'),
    at('/archive', null, 0.7, 'weekly'),
    at('/balance', null, 0.7, 'weekly'),
    at('/features', null, 0.7, 'weekly'),
    at('/market', null, 0.6, 'weekly'),
    at('/membership', null, 0.6, 'monthly'),
    at('/business', null, 0.4, 'monthly'),
    at('/clips', null, 0.4, 'monthly'),
    at('/terms', null, 0.2, 'monthly'),
    at('/privacy', null, 0.2, 'monthly'),
  ];
  const rest = [
    ...countryPaths.map((p) => at(p, null, 0.7, 'daily')),
    ...places.map((r) => at(r.path, r.updated, 0.7, 'daily')),
    ...articles.map((r) => at(r.path, r.updated, 0.6, 'monthly')),
    ...tagPaths.map((t) => at(`/balance/tag/${encodeURIComponent(t)}`, null, 0.4, 'weekly')),
    ...venues.map((r) => at(r.path, r.updated, 0.5, 'weekly')),
    ...artists.map((r) => at(r.path, r.updated, 0.5, 'weekly')),
    ...clubs.map((r) => at(r.path, r.updated, 0.5, 'monthly')),
    ...archiveEvents.map((r) => at(r.path, r.updated, 0.4, 'monthly')),
  ];
  const eventBudget = Math.max(0, Math.min(MAX_EVENT_URLS, MAX_URLS - HEADROOM - fixed.length - rest.length));
  // A night still to come changes (times, line-up, sold out); one that has
  // happened does not, and saying so saves the crawl for the ones that do.
  const eventUrls = events.slice(0, eventBudget).map((r) => r.past
    ? at(r.path, r.updated, 0.4, 'monthly')
    : at(r.path, r.updated, 0.8, 'daily'));
  return [...fixed, ...eventUrls, ...rest];
}
