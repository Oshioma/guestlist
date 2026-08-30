// City health — is Guestlist actually useful in this city yet?
// Lightweight, internal, deterministic. Not exposed as public labels.

import { query } from './db';

export type CityHealth = {
  location_id: string;
  name: string;
  slug: string;
  country_code: string | null;
  country_name: string | null;
  upcoming_events: number;
  active_promoters: number;
  active_venues: number;
  trusted_sources: number;
  members: number;
  views_30d: number;
  saves_30d: number;
  going_30d: number;
  ticket_clicks_30d: number;
  status: 'seeding' | 'live' | 'strong';
};

export const CITY_HEALTH_THRESHOLDS = {
  live: { upcomingEvents: 3 },
  strong: { upcomingEvents: 10, engagement30d: 25 }, // views+saves+going+clicks
} as const;

export function cityStatus(h: Omit<CityHealth, 'status'>): CityHealth['status'] {
  const t = CITY_HEALTH_THRESHOLDS;
  const engagement = h.views_30d + h.saves_30d + h.going_30d + h.ticket_clicks_30d;
  if (h.upcoming_events >= t.strong.upcomingEvents && engagement >= t.strong.engagement30d) {
    return 'strong';
  }
  if (h.upcoming_events >= t.live.upcomingEvents) return 'live';
  return 'seeding';
}

export async function cityHealth(): Promise<CityHealth[]> {
  const rows = await query<Omit<CityHealth, 'status'>>(
    `select l.id as location_id, l.name, l.slug, l.country_code, l.country_name,
            coalesce(ev.n, 0) as upcoming_events,
            coalesce(pr.n, 0) as active_promoters,
            coalesce(ve.n, 0) as active_venues,
            coalesce(src.n, 0) as trusted_sources,
            coalesce(me.n, 0) as members,
            coalesce(an.views, 0) as views_30d,
            coalesce(an.saves, 0) as saves_30d,
            coalesce(an.going, 0) as going_30d,
            coalesce(an.clicks, 0) as ticket_clicks_30d
       from locations l
       left join lateral (
         select count(*)::int as n from events e
          where e.location_id = l.id and e.status = 'live'
            and e.listing_status <> 'cancelled' and e.start_at > now()
       ) ev on true
       left join lateral (
         select count(distinct e.promoter_id)::int as n from events e
          where e.location_id = l.id and e.status = 'live' and e.start_at > now()
            and e.promoter_id is not null
       ) pr on true
       left join lateral (
         select count(distinct e.venue_id)::int as n from events e
          where e.location_id = l.id and e.status = 'live' and e.start_at > now()
            and e.venue_id is not null
       ) ve on true
       left join lateral (
         select count(distinct es.id)::int as n
           from event_sources es
           left join promoters p on p.id = es.promoter_id
           left join venues v2 on v2.id = es.venue_id
           left join events pe on pe.promoter_id = p.id and pe.location_id = l.id
           left join events ve2 on ve2.venue_id = v2.id and ve2.location_id = l.id
          where es.trust in ('trusted', 'new') and es.polling_enabled
            and (pe.id is not null or ve2.id is not null)
       ) src on true
       left join lateral (
         select count(*)::int as n from members m where m.home_location_id = l.id
       ) me on true
       left join lateral (
         select
           count(*) filter (where a.event_type = 'event_viewed')::int as views,
           count(*) filter (where a.event_type = 'event_saved')::int as saves,
           count(*) filter (where a.event_type = 'going')::int as going,
           count(*) filter (where a.event_type = 'ticket_clicked')::int as clicks
           from analytics_events a
           join events e2 on e2.id = a.event_id
          where e2.location_id = l.id and a.created_at > now() - interval '30 days'
       ) an on true
      where l.kind in ('city', 'destination')
      order by ev.n desc, me.n desc, l.name`
  );
  return rows.map((r) => ({ ...r, status: cityStatus(r) }));
}
