// Event cards for a place — one city, a whole country, or everywhere else.
//
// The city page, the country page and the "elsewhere" shelves all want the
// same card with the same joins; only the WHERE changes. Keeping that in one
// place is what lets a city page say "London, then the rest of the United
// Kingdom, then beyond it" without three copies of the same query drifting
// apart.

import { query } from './db';
import type { EventCard } from './events';

export type PlaceEventFilter = {
  // Events in exactly this location.
  locationId?: string | null;
  // Events anywhere in these countries (raw country_name spellings).
  countryNames?: string[] | null;
  // …but not this location, and not these countries. This is what makes
  // "elsewhere in the country" and "beyond the country" possible.
  excludeLocationId?: string | null;
  excludeCountryNames?: string[] | null;
  limit?: number;
};

const inCountrySql = (param: string) =>
  `(e.country = any(${param}::text[]) or exists (
      select 1 from locations l2 where l2.id = e.location_id and l2.country_name = any(${param}::text[])
    ))`;

export async function placeEventCards(filter: PlaceEventFilter): Promise<EventCard[]> {
  const where: string[] = [
    `e.status = 'live'`,
    `e.listing_status <> 'cancelled'`,
    `coalesce(e.end_at, e.start_at + interval '6 hours') > now()`,
  ];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };

  if (filter.locationId) where.push(`e.location_id = ${arg(filter.locationId)}`);
  if (filter.countryNames?.length) where.push(inCountrySql(arg(filter.countryNames)));
  if (filter.excludeLocationId) where.push(`e.location_id is distinct from ${arg(filter.excludeLocationId)}`);
  if (filter.excludeCountryNames?.length) where.push(`not ${inCountrySql(arg(filter.excludeCountryNames))}`);

  const limit = Math.min(Math.max(filter.limit ?? 24, 1), 120);
  return query<EventCard>(
    `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
            e.city, e.country, e.event_type, e.price_from, e.price_to, e.currency,
            e.primary_image_url, e.worth_travelling, e.featured, e.listing_status,
            v.name as venue_name,
            coalesce((select count(*)::int from member_event_actions mea
                       where mea.event_id = e.id and mea.rsvp = 'going'), 0) as going_count,
            coalesce((select json_agg(json_build_object('name', g.name, 'slug', g.slug))
                        from event_genres eg join genres g on g.id = eg.genre_id
                       where eg.event_id = e.id), '[]'::json) as genres,
            coalesce((select json_agg(json_build_object('display_name', m.display_name, 'avatar_url', m.avatar_url))
                        from member_event_actions mea2 join members m on m.id = mea2.member_id
                       where mea2.event_id = e.id and mea2.rsvp = 'going'), '[]'::json) as going_avatars
       from events e left join venues v on v.id = e.venue_id
      where ${where.join(' and ')}
      order by e.start_at
      limit ${limit}`,
    args
  );
}
