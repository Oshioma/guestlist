// ASK TOOLS — the controlled boundary between Ask and the database. Every
// fact Ask can state flows through these functions; the AI never touches
// SQL, permissions, or privacy. All social context reuses the existing
// per-viewer predicates (eventSocialContext, attendance visibility).

import { query, queryOne } from '../db';
import { weekendWindow, getRecommendedEvents, reasonText } from '../recommend';
import { eventSocialContext, type EventSocialContext } from '../scene';
import { heatForEvents } from '../heat';
import { tasteProfile } from '../taste';
import { attendanceVisibleSql } from '../archive/core';
import type { AskDate, AskIntent } from './types';

export type AskEventRow = {
  id: string;
  title: string;
  slug: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  city: string | null;
  venue_name: string | null;
  price_from: string | null;
  price_to: string | null;
  currency: string | null;
  primary_image_url: string | null;
  event_type: string;
  listing_status: string;
  going_count: number;
  genres: string[];
};

// Resolve a natural date to a concrete window in the city's timezone (never
// assume UK time). Falls back to UTC when the city has no known timezone.
export async function cityTimezone(city: string | null): Promise<string> {
  if (!city) return 'UTC';
  const row = await queryOne<{ timezone: string | null }>(
    `select timezone from locations
      where kind in ('city','destination') and lower(name) = lower($1) and timezone is not null
      limit 1`, [city]);
  if (row?.timezone) return row.timezone;
  const ev = await queryOne<{ timezone: string }>(
    `select timezone from events where lower(city) = lower($1) and timezone is not null
      order by start_at desc limit 1`, [city]);
  return ev?.timezone ?? 'UTC';
}

function localNowParts(tz: string): { dow: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dow: dowMap[get('weekday')] ?? new Date().getUTCDay(),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export function resolveDateWindow(date: AskDate | null, tz: string): { from: Date; to: Date } {
  const now = new Date();
  if (!date) return { from: now, to: new Date(now.getTime() + 14 * 86400_000) };
  switch (date.kind) {
    case 'tonight': return { from: now, to: new Date(now.getTime() + 24 * 3600_000) };
    case 'tomorrow': return { from: new Date(now.getTime() + 12 * 3600_000), to: new Date(now.getTime() + 48 * 3600_000) };
    case 'weekend': return weekendWindow(now);
    case 'next_weekend': {
      const w = weekendWindow(new Date(now.getTime() + 7 * 86400_000));
      return w;
    }
    case 'day': {
      const { dow } = localNowParts(tz);
      let ahead = (date.dow - dow + 7) % 7;
      if (ahead === 0) ahead = /* today still counts as the next one */ 0;
      const from = new Date(now.getTime() + ahead * 86400_000);
      from.setUTCHours(0, 0, 0, 0);
      const start = ahead === 0 ? now : from;
      return { from: start, to: new Date(from.getTime() + 36 * 3600_000) };
    }
    case 'iso': return {
      from: new Date(`${date.date}T00:00:00Z`),
      to: new Date(`${date.date}T23:59:59Z`),
    };
    case 'next_month': return {
      from: new Date(now.getTime() + 7 * 86400_000),
      to: new Date(now.getTime() + 45 * 86400_000),
    };
    case 'window': return { from: now, to: new Date(now.getTime() + date.days * 86400_000) };
  }
}

// The main deterministic search over live events. Extends the V2G
// queryGuestlist predicate set with price, after-hours, and size.
export async function searchEvents(
  intent: AskIntent,
  opts: { limit?: number; city?: string | null } = {}
): Promise<AskEventRow[]> {
  const city = opts.city ?? intent.city;
  const tz = await cityTimezone(city);
  const { from, to } = resolveDateWindow(intent.date, tz);
  const limit = Math.min(opts.limit ?? 12, 25);
  const genre = intent.genres[0] ?? null;

  return query<AskEventRow>(
    `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
            e.city, v.name as venue_name, e.price_from::text, e.price_to::text, e.currency,
            e.primary_image_url, e.event_type, e.listing_status,
            (select count(*)::int from member_event_actions a
              where a.event_id = e.id and a.rsvp = 'going') as going_count,
            coalesce((select array_agg(g.name order by g.name) from event_genres eg
                        join genres g on g.id = eg.genre_id where eg.event_id = e.id), '{}') as genres
       from events e
       left join venues v on v.id = e.venue_id
      where e.status = 'live' and e.listing_status not in ('cancelled', 'postponed')
        and coalesce(e.end_at, e.start_at + interval '6 hours') > now()
        and e.start_at between $1 and $2
        and ($3::text is null or lower(e.city) = lower($3))
        and ($4::text is null or exists (
              select 1 from event_genres eg2 join genres g2 on g2.id = eg2.genre_id
               where eg2.event_id = e.id
                 and (lower(g2.name) = lower($4) or g2.slug = lower($4)
                      or exists (select 1 from genres parent
                                  where parent.id = g2.parent_genre_id
                                    and (lower(parent.name) = lower($4) or parent.slug = lower($4))))))
        and ($5::boolean is not true or extract(hour from e.start_at at time zone e.timezone) >= 23
             or extract(hour from e.start_at at time zone e.timezone) < 5)
        and ($6::boolean is not true or extract(hour from e.start_at at time zone e.timezone) between 8 and 17)
        and ($7::int is null or extract(hour from coalesce(e.end_at, e.start_at + interval '6 hours')
              at time zone e.timezone) between $7 and 11
             or extract(hour from e.start_at at time zone e.timezone) >= 21)
        and ($8::numeric is null or e.price_from is null or e.price_from <= $8)
        and ($9::text is distinct from 'small' or e.event_type <> 'festival')
      order by e.start_at
      limit $10`,
    [from, to, city, genre,
     intent.lateNight ?? null, intent.daytime ?? null, intent.afterHour ?? null,
     intent.priceMax ?? null, intent.sizePref ?? null, limit]
  );
}

// Privacy-safe social overlay for a short list of events.
export async function socialOverlay(
  viewerId: string | null,
  eventIds: string[]
): Promise<Map<string, EventSocialContext>> {
  const out = new Map<string, EventSocialContext>();
  if (!viewerId) return out;
  for (const id of eventIds.slice(0, 8)) {
    out.set(id, await eventSocialContext(viewerId, id));
  }
  return out;
}

// Momentum, explained — never a bare score (public Heat is V2I).
export async function momentumNotes(eventIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const heat = await heatForEvents(eventIds);
  for (const [id, h] of heat) {
    const bits: string[] = [];
    if (h.signals.goingLast6h >= 2) bits.push(`${h.signals.goingLast6h} marked Going in the last six hours`);
    if (h.signals.ticketClicks24h >= 3) bits.push('ticket clicks are above its recent baseline');
    if (h.signals.hereNow >= 2) bits.push('people are checked in right now');
    if (bits.length) out.set(id, `Picking up — ${bits.join(' and ')}.`);
  }
  return out;
}

// Member context Ask may use — every field already permission-scoped to the
// member themself.
export type AskMemberContext = {
  homeCity: string | null;
  travel: { city: string; from: string | null; to: string | null }[];
  topGenres: string[];
};

export async function memberAskContext(memberId: string): Promise<AskMemberContext> {
  const [home, travel, taste] = await Promise.all([
    queryOne<{ name: string | null }>(
      `select coalesce(l.name, m.home_city) as name from members m
         left join locations l on l.id = m.home_location_id where m.id = $1`, [memberId]),
    query<{ city: string; from: string | null; to: string | null }>(
      `select l.name as city, tp.start_date::text as from, tp.end_date::text as to
         from travel_plans tp join locations l on l.id = tp.location_id
        where tp.member_id = $1 and coalesce(tp.end_date, tp.start_date) >= current_date
        order by tp.start_date limit 4`, [memberId]),
    tasteProfile(memberId, 4),
  ]);
  return {
    homeCity: home?.name ?? null,
    travel,
    topGenres: [...taste.explicit, ...taste.inferred].slice(0, 5).map((g) => g.name),
  };
}

// Personalised picks with existing explainable reasons.
export async function personalPicks(memberId: string, opts: { from?: Date; to?: Date; limit?: number }) {
  const recs = await getRecommendedEvents(memberId, {
    limit: opts.limit ?? 6, from: opts.from ?? null, to: opts.to ?? null,
  });
  return recs.map((r) => ({ ...r, reasonTexts: r.reasons.slice(0, 2).map(reasonText) }));
}

// Archive lookups — published history only, attendance through the
// standard visibility predicate.
export type AskArchiveRow = {
  id: string; title: string; slug: string; display_date: string;
  date_precision: string; year: number | null; city: string | null;
  venue_name: string | null; i_was_there: number;
};

export async function archiveLookup(
  q: { text: string | null; year: number | null },
  viewerId: string | null,
  limit = 6
): Promise<AskArchiveRow[]> {
  const words = q.text ? q.text.toLowerCase().replace(/[^a-z0-9 &']/g, ' ').trim().split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) // years match separately, not in the LIKE
      && !['the', 'was', 'what', 'happening', 'around', 'show', 'old', 'nights', 'and'].includes(w)) : [];
  const like = words.length ? `%${words.join('%')}%` : null;
  return query<AskArchiveRow>(
    `select e.id, e.title, e.slug, e.display_date, e.date_precision, e.year, e.city,
            e.venue_name,
            (select count(*)::int from archive_attendance a join members am on am.id = a.member_id
              where a.archive_event_id = e.id
                and ${viewerId ? attendanceVisibleSql('$4') : `(a.visibility = 'public'
                  and coalesce((select mp.profile_public from member_privacy mp where mp.member_id = am.id), true))`}
            ) as i_was_there
       from archive_events e
      where e.status = 'published'
        and ($1::text is null or lower(e.title) like $1 or lower(coalesce(e.venue_name,'')) like $1
             or lower(coalesce(e.promoter_name,'')) like $1
             or exists (select 1 from archive_event_artists aa
                         where aa.archive_event_id = e.id and lower(aa.artist_name) like $1))
        and ($2::int is null or e.year between $2 - 2 and $2 + 2)
      order by e.year nulls last, e.title
      limit $3`,
    viewerId ? [like, q.year, limit, viewerId] : [like, q.year, limit]
  );
}

// PAST → PRESENT — deterministic lineage. Connects the member's own
// I Was There nights + marked scene history to current events through
// shared artists, promoter names, venue lineage, and genres. Only states
// connections that exist in Guestlist data.
export type PastPresentPick = {
  event: AskEventRow;
  connections: string[]; // human-readable, data-backed
};

export async function pastToPresent(
  memberId: string,
  opts: { city?: string | null; from?: Date; to?: Date; limit?: number } = {}
): Promise<PastPresentPick[]> {
  const rows = await query<AskEventRow & {
    shared_artists: string[]; shared_promoter: string | null; lineage_entities: string[]; shared_genres: string[];
  }>(
    `with my_past as (
       select ae.id, ae.promoter_name from archive_attendance a
         join archive_events ae on ae.id = a.archive_event_id and ae.status = 'published'
        where a.member_id = $1
     ),
     my_artists as (
       select distinct lower(aa.artist_name) as name from archive_event_artists aa
        where aa.archive_event_id in (select id from my_past)
     ),
     my_genres as (
       select distinct aeg.genre_id from archive_event_genres aeg
        where aeg.archive_event_id in (select id from my_past)
     ),
     my_entities as (
       select entity_id from member_scene_history where member_id = $1
       union
       select aee.entity_id from archive_event_entities aee
        where aee.archive_event_id in (select id from my_past)
     ),
     lineage as (
       select entity_id from my_entities
       union
       select l.to_entity from scene_entity_links l where l.from_entity in (select entity_id from my_entities)
       union
       select l.from_entity from scene_entity_links l where l.to_entity in (select entity_id from my_entities)
     )
     select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone, e.city,
            v.name as venue_name, e.price_from::text, e.price_to::text, e.currency,
            e.primary_image_url, e.event_type, e.listing_status,
            (select count(*)::int from member_event_actions a2
              where a2.event_id = e.id and a2.rsvp = 'going') as going_count,
            coalesce((select array_agg(g.name order by g.name) from event_genres eg
                        join genres g on g.id = eg.genre_id where eg.event_id = e.id), '{}') as genres,
            coalesce((select array_agg(distinct ar.name) from event_artists ea
                        join artists ar on ar.id = ea.artist_id
                       where ea.event_id = e.id and lower(ar.name) in (select name from my_artists)), '{}') as shared_artists,
            (select p.name from promoters p
              where p.id = e.promoter_id
                and lower(p.name) in (select distinct lower(promoter_name) from my_past where promoter_name is not null)
            ) as shared_promoter,
            coalesce((select array_agg(distinct se.name) from scene_entities se
              where se.id in (select entity_id from lineage)
                and (lower(se.name) = lower(coalesce(v.name, ''))
                     or lower(se.name) = lower(coalesce((select p2.name from promoters p2 where p2.id = e.promoter_id), '')))
            ), '{}') as lineage_entities,
            coalesce((select array_agg(distinct g3.name) from event_genres eg3
                        join genres g3 on g3.id = eg3.genre_id
                       where eg3.event_id = e.id and eg3.genre_id in (select genre_id from my_genres)), '{}') as shared_genres
       from events e
       left join venues v on v.id = e.venue_id
      where e.status = 'live' and e.listing_status not in ('cancelled', 'postponed')
        and coalesce(e.end_at, e.start_at + interval '6 hours') > now()
        and e.start_at between $2 and $3
        and ($4::text is null or lower(e.city) = lower($4))
      limit 60`,
    [memberId, opts.from ?? new Date(), opts.to ?? new Date(Date.now() + 30 * 86400_000), opts.city ?? null]
  );

  const picks: PastPresentPick[] = [];
  for (const r of rows) {
    const connections: string[] = [];
    if (r.shared_artists.length) {
      connections.push(`${r.shared_artists.slice(0, 2).join(' and ')} played nights you marked in the archive`);
    }
    if (r.shared_promoter) connections.push(`Same promoter as nights you were at: ${r.shared_promoter}`);
    if (r.lineage_entities.length) connections.push(`Connected to ${r.lineage_entities[0]} from your scene history`);
    if (!connections.length && r.shared_genres.length >= 1) {
      connections.push(`Matches the ${r.shared_genres.slice(0, 2).join(' / ')} nights you were at`);
    }
    if (connections.length) picks.push({ event: r, connections });
  }
  picks.sort((a, b) => b.connections.length - a.connections.length);
  return picks.slice(0, opts.limit ?? 3);
}
