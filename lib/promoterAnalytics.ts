// Promoter analytics — real, aggregate data only. No demographics we don't
// collect, no individual viewer identities. Ticket clicks come from the V1
// tracked /out redirect ledger.

import { query, queryOne } from './db';

export type PromoterStats = {
  views: number;
  uniqueViewers: number;
  ticketClicks: number;
  interested: number;
  going: number;
  saves: number;
  followers: number;
  shares: number;
};

export type RangeDays = 7 | 30 | 90 | 365;

const EVENT_OF_PROMOTER = `exists (select 1 from events e where e.id = a.event_id and e.promoter_id = $1)`;

export async function promoterStats(promoterId: string, days: RangeDays): Promise<PromoterStats> {
  const row = await queryOne<Omit<PromoterStats, 'followers'>>(
    `select
       count(*) filter (where a.event_type = 'event_viewed')::int as views,
       count(distinct coalesce(a.member_id::text, a.anon_id))
         filter (where a.event_type = 'event_viewed')::int as "uniqueViewers",
       count(*) filter (where a.event_type = 'ticket_clicked')::int as "ticketClicks",
       count(*) filter (where a.event_type = 'interested')::int as interested,
       count(*) filter (where a.event_type = 'going')::int as going,
       count(*) filter (where a.event_type = 'event_saved')::int as saves,
       count(*) filter (where a.event_type = 'event_shared')::int as shares
     from analytics_events a
     where (a.promoter_id = $1 or ${EVENT_OF_PROMOTER})
       and a.created_at > now() - make_interval(days => $2)`,
    [promoterId, days]
  );
  const followers = await queryOne<{ n: number }>(
    `select count(*)::int as n from member_follows where entity_type = 'promoter' and entity_id = $1`,
    [promoterId]
  );
  return { ...(row as Omit<PromoterStats, 'followers'>), followers: followers?.n ?? 0 };
}

export type EventPerformance = {
  id: string; title: string; slug: string; start_at: string; end_at: string | null;
  timezone: string; primary_image_url: string | null; status: string; listing_status: string;
  city: string | null; venue_name: string | null; ticket_url: string | null;
  possible_duplicate_of: string | null;
  views: number; ticket_clicks: number;
  interested: number; going: number; saved: number;
};

export async function eventPerformance(
  promoterId: string,
  opts: { days?: RangeDays; upcomingOnly?: boolean; limit?: number } = {}
): Promise<EventPerformance[]> {
  const args: unknown[] = [promoterId];
  let rangeCond = 'true';
  if (opts.days) {
    args.push(opts.days);
    rangeCond = `a.created_at > now() - make_interval(days => $${args.length})`;
  }
  return query<EventPerformance>(
    `select e.id, e.title, e.slug, e.start_at, e.end_at, e.timezone, e.primary_image_url,
            e.status, e.listing_status, e.city, e.ticket_url, e.possible_duplicate_of,
            v.name as venue_name,
            coalesce(an.views, 0) as views,
            coalesce(an.clicks, 0) as ticket_clicks,
            coalesce(cur.interested, 0) as interested,
            coalesce(cur.going, 0) as going,
            coalesce(cur.saved, 0) as saved
       from events e
       left join venues v on v.id = e.venue_id
       left join lateral (
         select count(*) filter (where a.event_type = 'event_viewed')::int as views,
                count(*) filter (where a.event_type = 'ticket_clicked')::int as clicks
           from analytics_events a where a.event_id = e.id and ${rangeCond}
       ) an on true
       left join lateral (
         select count(*) filter (where mea.rsvp = 'interested')::int as interested,
                count(*) filter (where mea.rsvp = 'going')::int as going,
                count(*) filter (where mea.saved_at is not null)::int as saved
           from member_event_actions mea where mea.event_id = e.id
       ) cur on true
      where e.promoter_id = $1 and e.status <> 'rejected'
        ${opts.upcomingOnly ? `and coalesce(e.end_at, e.start_at + interval '6 hours') > now()` : ''}
      order by e.start_at ${opts.upcomingOnly ? 'asc' : 'desc'}
      limit ${Math.min(opts.limit ?? 30, 100)}`,
    args
  );
}

// Aggregate audience signals only — never individual identities.
export async function audienceInsights(promoterId: string, days: RangeDays): Promise<{
  topCities: { city: string; n: number }[];
  topGenres: { name: string; n: number }[];
}> {
  const topCities = await query<{ city: string; n: number }>(
    `select m.home_city as city, count(distinct m.id)::int as n
       from analytics_events a
       join members m on m.id = a.member_id
      where (a.promoter_id = $1 or ${EVENT_OF_PROMOTER})
        and a.created_at > now() - make_interval(days => $2)
        and m.home_city is not null
      group by m.home_city
      having count(distinct m.id) >= 2  -- aggregation floor: no city of one
      order by n desc limit 8`,
    [promoterId, days]
  );
  const topGenres = await query<{ name: string; n: number }>(
    `select g.name, count(*)::int as n
       from analytics_events a
       join event_genres eg on eg.event_id = a.event_id
       join genres g on g.id = eg.genre_id
      where ${EVENT_OF_PROMOTER}
        and a.event_type in ('event_viewed', 'interested', 'going', 'ticket_clicked')
        and a.created_at > now() - make_interval(days => $2)
      group by g.name order by n desc limit 8`,
    [promoterId, days]
  );
  return { topCities, topGenres };
}

// Events needing attention in the promoter dashboard.
export async function eventsNeedingAttention(promoterId: string): Promise<
  { id: string; title: string; slug: string; start_at: string; issues: string[] }[]
> {
  const rows = await query<{
    id: string; title: string; slug: string; start_at: string; status: string;
    primary_image_url: string | null; ticket_url: string | null;
    possible_duplicate_of: string | null; venue_id: string | null; city: string | null;
  }>(
    `select id, title, slug, start_at, status, primary_image_url, ticket_url,
            possible_duplicate_of, venue_id, city
       from events
      where promoter_id = $1 and status <> 'rejected'
        and coalesce(end_at, start_at + interval '6 hours') > now()
      order by start_at asc limit 50`,
    [promoterId]
  );
  return rows
    .map((e) => {
      const issues: string[] = [];
      if (e.status === 'new' || e.status === 'needs_review') issues.push('awaiting confirmation');
      if (e.possible_duplicate_of) issues.push('possible duplicate');
      if (!e.primary_image_url) issues.push('missing image');
      if (!e.ticket_url) issues.push('missing ticket link');
      if (!e.venue_id && !e.city) issues.push('missing location');
      return { id: e.id, title: e.title, slug: e.slug, start_at: e.start_at, issues };
    })
    .filter((e) => e.issues.length > 0)
    .slice(0, 12);
}
