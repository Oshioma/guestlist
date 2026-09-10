// WHAT THE SITE ACTUALLY DID, OUT OF OUR OWN NUMBERS.
//
// Guestlist records what people do — a night looked at, a ticket clicked, a
// night shared, somebody asking to be got in — and until now all of it went
// into one table nobody read. This is the reading.
//
// Everything here comes from the site's own tables. No third party, no tag,
// nothing sent anywhere. Which also fixes the shape of the numbers: a
// pageview count is a vanity number, and "eleven people clicked through to buy
// a ticket for that Friday" is not.
//
// Two honest limits, said on the page rather than buried here:
//
//   1. It counts what is instrumented. A page with no track() call in it is
//      invisible, however many people read it.
//   2. Somebody signed out is a browser, not a person — the anonymous id
//      lives in that browser's localStorage. One person on a laptop and a
//      phone is two, and clearing site data makes a third.

import { query, queryOne } from './db';

export type Window = 7 | 30 | 90;
export const WINDOWS: Window[] = [7, 30, 90];

/** Headline counts for the window, each with the previous window to compare. */
export type Headline = {
  key: string;
  label: string;
  hint: string;
  now: number;
  before: number;
};

type CountRow = { now: number; before: number };

/**
 * One count over the window and the same length before it, so every number
 * arrives with the only context that makes it mean anything: whether it is
 * going up.
 */
async function pair(sql: string, days: number, args: unknown[] = []): Promise<CountRow> {
  const row = await queryOne<CountRow>(
    `select
       (select count(*)::int from (${sql}) t where t.at >= now() - make_interval(days => $1::int)) as now,
       (select count(*)::int from (${sql}) t
         where t.at >= now() - make_interval(days => $1::int * 2)
           and t.at <  now() - make_interval(days => $1::int)) as before`,
    [days, ...args]
  );
  return row ?? { now: 0, before: 0 };
}

export async function headlines(days: number): Promise<Headline[]> {
  const [people, signIns, joined, confirmed, views, tickets, asks, shares] = await Promise.all([
    queryOne<CountRow>(
      `select
         (select count(distinct coalesce(member_id::text, anon_id))::int from analytics_events
           where created_at >= now() - make_interval(days => $1::int)
             and coalesce(member_id::text, anon_id) is not null) as now,
         (select count(distinct coalesce(member_id::text, anon_id))::int from analytics_events
           where created_at >= now() - make_interval(days => $1::int * 2)
             and created_at <  now() - make_interval(days => $1::int)
             and coalesce(member_id::text, anon_id) is not null) as before`, [days]),
    pair(`select created_at as at from analytics_events where event_type = 'signed_in'`, days),
    pair(`select created_at as at from members`, days),
    pair(`select email_verified_at as at from members where email_verified_at is not null`, days),
    pair(`select created_at as at from analytics_events where event_type = 'event_viewed'`, days),
    pair(`select created_at as at from analytics_events where event_type = 'ticket_clicked'`, days),
    pair(`select requested_at as at from member_access_requests`, days),
    pair(`select created_at as at from analytics_events where event_type = 'event_shared'`, days),
  ]);

  const t = (key: string, label: string, hint: string, r: CountRow | null): Headline =>
    ({ key, label, hint, now: r?.now ?? 0, before: r?.before ?? 0 });

  return [
    t('people', 'People', 'Signed-in members and signed-out browsers, counted once each', people),
    t('signIns', 'Sign-ins', 'Somebody coming back', signIns),
    t('joined', 'Joined', 'New accounts', joined),
    t('confirmed', 'Confirmed', 'Email proved — until they do, nobody can find them', confirmed),
    t('views', 'Nights looked at', 'Event pages opened', views),
    t('tickets', 'Ticket clicks', 'Sent on to buy', tickets),
    t('asks', 'Get me in', 'Members asking us to get them in', asks),
    t('shares', 'Shares', 'A night passed on to somebody else', shares),
  ];
}

export type DayRow = { d: string; people: number; sign_ins: number; joined: number };

/** A row per day whether anything happened or not, so a gap reads as a gap. */
export async function byDay(days: number): Promise<DayRow[]> {
  return query<DayRow>(
    `with d as (
       select generate_series(
         date_trunc('day', now()) - make_interval(days => $1::int - 1),
         date_trunc('day', now()), interval '1 day') as day
     )
     select to_char(d.day, 'YYYY-MM-DD') as d,
       (select count(distinct coalesce(a.member_id::text, a.anon_id))::int from analytics_events a
         where a.created_at >= d.day and a.created_at < d.day + interval '1 day'
           and coalesce(a.member_id::text, a.anon_id) is not null) as people,
       (select count(*)::int from analytics_events a
         where a.event_type = 'signed_in'
           and a.created_at >= d.day and a.created_at < d.day + interval '1 day') as sign_ins,
       (select count(*)::int from members m
         where m.created_at >= d.day and m.created_at < d.day + interval '1 day') as joined
     from d order by d.day`,
    [days]
  );
}

export type FunnelStep = { label: string; hint: string; n: number };

/**
 * Not a marketing funnel — the actual sequence Guestlist asks somebody to walk
 * through. Each step is counted in the window, so it is not a cohort: it does
 * not claim the people who joined are the same people who looked.
 */
export async function funnel(days: number): Promise<FunnelStep[]> {
  const row = await queryOne<Record<string, number>>(
    `select
      (select count(distinct coalesce(member_id::text, anon_id))::int from analytics_events
        where created_at >= now() - make_interval(days => $1::int)
          and coalesce(member_id::text, anon_id) is not null) as looked,
      (select count(*)::int from members where created_at >= now() - make_interval(days => $1::int)) as joined,
      (select count(*)::int from members
        where email_verified_at >= now() - make_interval(days => $1::int)) as confirmed,
      (select count(distinct member_id)::int from member_access_requests
        where requested_at >= now() - make_interval(days => $1::int)) as asked,
      (select count(*)::int from event_guestlist_entries
        where source = 'guestlist' and created_at >= now() - make_interval(days => $1::int)) as guestlisted,
      (select count(*)::int from memberships where status in ('active', 'trialing')) as paying`,
    [days]
  );
  const n = (k: string) => row?.[k] ?? 0;
  return [
    { label: 'Looked', hint: 'People who did anything at all', n: n('looked') },
    { label: 'Joined', hint: 'Made an account', n: n('joined') },
    { label: 'Confirmed', hint: 'Proved their email', n: n('confirmed') },
    { label: 'Asked to get in', hint: 'Pressed GET ME IN', n: n('asked') },
    { label: 'Got in', hint: 'On a door list through us', n: n('guestlisted') },
    { label: 'Paying', hint: 'Active memberships, right now', n: n('paying') },
  ];
}

export type ActionRow = { event_type: string; n: number; people: number };

export async function actions(days: number): Promise<ActionRow[]> {
  return query<ActionRow>(
    `select event_type, count(*)::int as n,
            count(distinct coalesce(member_id::text, anon_id))::int as people
       from analytics_events
      where created_at >= now() - make_interval(days => $1::int)
      group by event_type order by n desc`,
    [days]
  );
}

export type NightRow = {
  id: string; title: string; slug: string; city: string | null; start_at: string;
  views: number; tickets: number; shares: number; asks: number; going: number;
};

/** The nights that did something, by what people did about them. */
export async function topNights(days: number): Promise<NightRow[]> {
  return query<NightRow>(
    `select e.id, e.title, e.slug, e.city, e.start_at::text,
            count(*) filter (where a.event_type = 'event_viewed')::int as views,
            count(*) filter (where a.event_type = 'ticket_clicked')::int as tickets,
            count(*) filter (where a.event_type = 'event_shared')::int as shares,
            count(*) filter (where a.event_type = 'get_me_in_requested')::int as asks,
            (select count(*)::int from member_event_actions m
              where m.event_id = e.id and m.rsvp = 'going') as going
       from analytics_events a join events e on e.id = a.event_id
      where a.created_at >= now() - make_interval(days => $1::int)
      group by e.id, e.title, e.slug, e.city, e.start_at
      order by views desc, tickets desc limit 12`,
    [days]
  );
}

export type PageRow = { path: string; n: number; people: number };

export async function topPages(days: number): Promise<PageRow[]> {
  return query<PageRow>(
    `select path, count(*)::int as n,
            count(distinct coalesce(member_id::text, anon_id))::int as people
       from analytics_events
      where created_at >= now() - make_interval(days => $1::int) and path is not null and path <> ''
      group by path order by people desc, n desc limit 15`,
    [days]
  );
}

export type SourceRow = { source: string; people: number; n: number };

/**
 * WHERE THEY CAME FROM.
 *
 * The People number was unreadable on its own: 550 of them and twelve
 * accounts, and no way to tell whether that was Instagram working or a
 * scraper looping. This is the answer to "where".
 *
 * A browser arriving with no referrer is not a mystery, it is the normal
 * case — typed in, opened from a message, a bookmark, or a site that
 * suppresses the header — so it is named "Direct or unknown" rather than
 * being hidden, because it is usually the biggest row and pretending
 * otherwise would make the rest look bigger than it is.
 */
export async function trafficSources(days: number): Promise<SourceRow[]> {
  return query<SourceRow>(
    `select coalesce(referrer_host, 'Direct or unknown') as source,
            count(distinct coalesce(member_id::text, anon_id))::int as people,
            count(*)::int as n
       from analytics_events
      where created_at >= now() - make_interval(days => $1::int)
        and coalesce(member_id::text, anon_id) is not null
      group by 1 order by people desc, n desc limit 15`,
    [days]
  );
}

export type CountryRow = { country: string; people: number };

/** Which countries they were in, as far as the CDN edge knows. */
export async function visitorCountries(days: number): Promise<CountryRow[]> {
  return query<CountryRow>(
    `select country,
            count(distinct coalesce(member_id::text, anon_id))::int as people
       from analytics_events
      where created_at >= now() - make_interval(days => $1::int)
        and country is not null
        and coalesce(member_id::text, anon_id) is not null
      group by country order by people desc limit 15`,
    [days]
  );
}

export type Realness = { people: number; oneHit: number; returned: number; members: number };

/**
 * How much of the People number is a person who looked at more than one thing.
 *
 * A browser that fires exactly one event and is never seen again is what an
 * automated visit looks like — anything that runs JavaScript but keeps no
 * localStorage is a fresh id every single time, so it can inflate the
 * headline without a single human being involved. Saying how many did more
 * than one thing, and how many came back on another day, is the cheapest
 * honest check on whether the big number means anything.
 */
export async function realness(days: number): Promise<Realness> {
  const row = await queryOne<Realness>(
    `with seen as (
       select coalesce(member_id::text, anon_id) as who,
              count(*) as hits,
              count(distinct date_trunc('day', created_at)) as days,
              bool_or(member_id is not null) as is_member
         from analytics_events
        where created_at >= now() - make_interval(days => $1::int)
          and coalesce(member_id::text, anon_id) is not null
        group by 1)
     select count(*)::int as people,
            count(*) filter (where hits = 1)::int as "oneHit",
            count(*) filter (where days > 1)::int as returned,
            count(*) filter (where is_member)::int as members
       from seen`,
    [days]
  );
  return row ?? { people: 0, oneHit: 0, returned: 0, members: 0 };
}

export type PlaceRow = { place: string; n: number };

/** Where the membership is, which is the only map that decides what we chase. */
export async function memberPlaces(): Promise<PlaceRow[]> {
  return query<PlaceRow>(
    `select coalesce(l.name, nullif(trim(m.home_city), ''), 'Not said') as place, count(*)::int as n
       from members m left join locations l on l.id = m.home_location_id
      group by 1 order by n desc limit 12`
  );
}

export type Catalogue = Record<string, number>;

/** What there is to look at, which decides whether any of the above can grow. */
export async function catalogue(): Promise<Catalogue> {
  const row = await queryOne<Catalogue>(
    `select
      (select count(*)::int from events where status = 'live'
        and coalesce(end_at, start_at + interval '6 hours') > now()) as live_events,
      (select count(*)::int from events where status = 'new') as queue_new,
      (select count(*)::int from events where status = 'needs_review') as queue_review,
      (select count(*)::int from event_sources) as sources,
      -- Connected and watched are different things: connecting a promoter's
      -- site says "read this", not "read this every day for ever".
      (select count(*)::int from event_sources where polling_enabled) as sources_watched,
      (select count(*)::int from members) as members,
      (select count(*)::int from members where email_verified_at is not null) as members_confirmed,
      (select count(*)::int from articles where status = 'published') as articles,
      (select count(*)::int from retreats where status = 'live') as retreats,
      (select count(*)::int from membership_waitlist where invited_at is null) as waitlist`
  );
  return row ?? {};
}

/** The day the numbers begin. Anything asked of a window older than this is empty because nothing was recorded, not because nothing happened. */
export async function recordingSince(): Promise<Record<string, string | null>> {
  const row = await queryOne<Record<string, string | null>>(
    `select
      (select min(created_at)::text from analytics_events) as anything,
      (select min(created_at)::text from analytics_events where event_type = 'signed_in') as sign_ins,
      (select min(created_at)::text from members) as members`
  );
  return row ?? {};
}

export type AccountRow = {
  id: string; display_name: string; email: string; slug: string | null;
  city: string | null; role: string; created_at: string;
  verified: boolean; same_connection: number; actions: number;
};

/**
 * Everyone with an account, newest first, with the two things that tell a
 * person from a script.
 *
 * A real signup confirms its address sooner or later and then does something.
 * A scripted one arrives, never confirms, never comes back, and usually
 * arrives beside several others from the same connection — which is why the
 * count of accounts sharing a signup IP is on the row. It is a hint and not a
 * verdict: a flatshare and an office share a connection too, so nothing is
 * ever selected automatically.
 */
export async function accounts(limit = 500): Promise<AccountRow[]> {
  return query<AccountRow>(
    `select m.id, m.display_name, m.email, m.slug, m.role, m.created_at::text,
            coalesce(nullif(trim(m.home_city), ''), l.name) as city,
            (m.email_verified_at is not null) as verified,
            case when m.signup_ip_hash is null then 1 else
              (select count(*)::int from members m2 where m2.signup_ip_hash = m.signup_ip_hash)
            end as same_connection,
            -- Things the MEMBER did. Queueing their welcome email records a
            -- row against them, and an impression is us showing them
            -- something rather than them doing anything — counting either
            -- would give every account that ever existed a score of one and
            -- make this column useless for the job it is here for.
            (select count(*)::int from analytics_events a
              where a.member_id = m.id
                and a.event_type not like 'email\\_%'
                and a.event_type not in ('alert_created', 'recommendation_impression',
                                         'scene_people_impression', 'notification_clicked')) as actions
       from members m
       left join locations l on l.id = m.home_location_id
      order by m.created_at desc limit $1`,
    [limit]
  );
}
