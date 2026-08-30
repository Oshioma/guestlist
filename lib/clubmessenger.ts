// Club Messenger data layer: friends, presence privacy, room access,
// tonight ranking. All privacy rules live HERE and in the API routes that
// call this module — the server is the security boundary in this stack
// (custom cookie auth + plain Postgres; equivalent RLS policies for a
// future Supabase Auth migration are documented in
// db/supabase_rls_reference.sql).
//
// Definitions:
//   friend            = MUTUAL member follow (both directions in
//                       member_follows with entity_type = 'member').
//   extended network  = people the viewer follows one-way.
//   active presence   = event_presence row with left_at null and
//                       expires_at > now().
//
// Presence visibility (who may see a presence row and its status):
//   'friends'   → owner + mutual friends
//   'event'     → owner + anyone Going or actively present at that event
//   'invisible' → owner only (still counts in nothing public)
// RSVP is never treated as physical presence.

import { query, queryOne } from './db';

export const CLUB_LIMITS = {
  messagesPerMinute: 12,
  pingCooldownMinutes: 10,
  statusMaxLength: 80,
  messageMaxLength: 500,
  presenceFallbackHours: 8,
  presenceGraceHours: 2, // added past event end
  presenceMaxHours: 16,
};

// SQL predicate: can $viewer see presence row alias p (joined to its event)?
// Parameters: viewerParam must be the SAME placeholder index everywhere it
// appears; callers pass the viewer id once and reference via ${viewer}.
export function presenceVisibleSql(viewer: string, p = 'p'): string {
  return `(
    ${p}.member_id = ${viewer}
    or (
      ${p}.visibility = 'friends'
      and exists (select 1 from member_follows f1
                   where f1.member_id = ${viewer} and f1.entity_type = 'member' and f1.entity_id = ${p}.member_id)
      and exists (select 1 from member_follows f2
                   where f2.member_id = ${p}.member_id and f2.entity_type = 'member' and f2.entity_id = ${viewer})
    )
    or (
      ${p}.visibility = 'event'
      and (
        exists (select 1 from member_event_actions v_mea
                 where v_mea.member_id = ${viewer} and v_mea.event_id = ${p}.event_id and v_mea.rsvp = 'going')
        or exists (select 1 from event_presence v_p
                    where v_p.member_id = ${viewer} and v_p.event_id = ${p}.event_id
                      and v_p.left_at is null and v_p.expires_at > now())
      )
    )
  )`;
}

export const PRESENCE_ACTIVE_SQL = (p = 'p') =>
  `${p}.left_at is null and ${p}.expires_at > now()`;

export async function friendIds(memberId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `select f1.entity_id as id
       from member_follows f1
       join member_follows f2
         on f2.member_id = f1.entity_id and f2.entity_type = 'member' and f2.entity_id = f1.member_id
      where f1.member_id = $1 and f1.entity_type = 'member'`,
    [memberId]
  );
  return rows.map((r) => r.id);
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const row = await queryOne(
    `select 1
       from member_follows f1
       join member_follows f2
         on f2.member_id = f1.entity_id and f2.entity_type = 'member' and f2.entity_id = f1.member_id
      where f1.member_id = $1 and f1.entity_type = 'member' and f1.entity_id = $2`,
    [a, b]
  );
  return !!row;
}

export type ActivePresence = {
  id: string;
  event_id: string;
  event_title: string;
  event_slug: string;
  visibility: 'friends' | 'event' | 'invisible';
  status: string | null;
  arrived_at: string;
  expires_at: string;
};

export async function myActivePresence(memberId: string): Promise<ActivePresence | null> {
  return queryOne<ActivePresence>(
    `select p.id, p.event_id, e.title as event_title, e.slug as event_slug,
            p.visibility, p.status, p.arrived_at::text, p.expires_at::text
       from event_presence p join events e on e.id = p.event_id
      where p.member_id = $1 and ${PRESENCE_ACTIVE_SQL('p')}
      order by p.arrived_at desc limit 1`,
    [memberId]
  );
}

// Room access rule (documented in migration 004): Going RSVP, presence at
// the event (active or from tonight), or admin.
export async function canAccessRoom(memberId: string, eventId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const row = await queryOne(
    `select 1 where
       exists (select 1 from member_event_actions mea
                where mea.member_id = $1 and mea.event_id = $2 and mea.rsvp = 'going')
       or exists (select 1 from event_presence p
                   where p.member_id = $1 and p.event_id = $2
                     and p.arrived_at > now() - interval '18 hours')`,
    [memberId, eventId]
  );
  return !!row;
}

export async function assertNotClubSuspended(memberId: string): Promise<void> {
  const row = await queryOne<{ club_suspended_at: string | null }>(
    `select club_suspended_at from members where id = $1`,
    [memberId]
  );
  if (row?.club_suspended_at) {
    const err = new Error('Club Messenger is unavailable for this account') as Error & { status: number };
    err.status = 403;
    throw err;
  }
}

export type PersonRow = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  state: 'here' | 'going';
  status: string | null;
  is_friend: boolean;
  arrived_at: string | null;
};

// People at an event visible to this viewer: friends first, then event-
// visible presence, then Going RSVPs (public per existing Who's Going rules).
export async function peopleAtEvent(viewerId: string, eventId: string): Promise<PersonRow[]> {
  return query<PersonRow>(
    `with here as (
       select p.member_id, p.status, p.arrived_at
         from event_presence p
        where p.event_id = $2 and ${PRESENCE_ACTIVE_SQL('p')}
          and p.visibility <> 'invisible'
          and ${presenceVisibleSql('$1', 'p')}
     )
     select m.id, m.display_name, m.avatar_url,
            case when h.member_id is not null then 'here' else 'going' end as state,
            h.status,
            (h.arrived_at)::text as arrived_at,
            exists (select 1 from member_follows f1
                     join member_follows f2 on f2.member_id = f1.entity_id
                      and f2.entity_type = 'member' and f2.entity_id = f1.member_id
                    where f1.member_id = $1 and f1.entity_type = 'member' and f1.entity_id = m.id) as is_friend
       from members m
       left join here h on h.member_id = m.id
       left join member_event_actions mea
         on mea.member_id = m.id and mea.event_id = $2 and mea.rsvp = 'going'
      where h.member_id is not null or mea.member_id is not null
      order by (h.member_id is not null) desc, m.display_name`,
    [viewerId, eventId]
  );
}

export type TonightEvent = {
  id: string;
  title: string;
  slug: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  city: string | null;
  venue_name: string | null;
  primary_image_url: string | null;
  listing_status: string;
  my_rsvp: string | null;
  friends_here: { id: string; display_name: string; avatar_url: string | null; status: string | null }[];
  friends_going: { id: string; display_name: string; avatar_url: string | null }[];
  event_visible_here: number; // presence visible via 'event' scope (non-friends)
  going_count: number;
};

// The tonight window: events live + listable that overlap "tonight" —
// started up to 12h ago (still running) through starting in the next 24h.
const TONIGHT_WINDOW = `
  e.status = 'live' and e.listing_status <> 'cancelled'
  and e.start_at < now() + interval '24 hours'
  and coalesce(e.end_at, e.start_at + interval '6 hours') > now() - interval '2 hours'
`;

export async function tonightEvents(viewerId: string): Promise<TonightEvent[]> {
  return query<TonightEvent>(
    `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
            e.city, v.name as venue_name, e.primary_image_url, e.listing_status,
            my.rsvp as my_rsvp,
            coalesce(fh.friends, '[]'::json) as friends_here,
            coalesce(fg.friends, '[]'::json) as friends_going,
            coalesce(evh.n, 0) as event_visible_here,
            coalesce(gc.n, 0) as going_count
       from events e
       left join venues v on v.id = e.venue_id
       left join member_event_actions my
         on my.member_id = $1 and my.event_id = e.id
       left join lateral (
         select json_agg(json_build_object('id', m.id, 'display_name', m.display_name,
                  'avatar_url', m.avatar_url, 'status', p.status) order by p.arrived_at) as friends
           from event_presence p join members m on m.id = p.member_id
          where p.event_id = e.id and ${PRESENCE_ACTIVE_SQL('p')}
            and p.visibility <> 'invisible'
            and ${presenceVisibleSql('$1', 'p')}
            and p.member_id <> $1
       ) fh on true
       left join lateral (
         select json_agg(json_build_object('id', m.id, 'display_name', m.display_name,
                  'avatar_url', m.avatar_url)) as friends
           from member_event_actions mea join members m on m.id = mea.member_id
          where mea.event_id = e.id and mea.rsvp = 'going' and mea.member_id <> $1
            and exists (select 1 from member_follows f1
                         join member_follows f2 on f2.member_id = f1.entity_id
                          and f2.entity_type = 'member' and f2.entity_id = f1.member_id
                        where f1.member_id = $1 and f1.entity_type = 'member' and f1.entity_id = mea.member_id)
       ) fg on true
       left join lateral (
         select count(*)::int as n from event_presence p
          where p.event_id = e.id and ${PRESENCE_ACTIVE_SQL('p')}
            and p.visibility <> 'invisible'
            and ${presenceVisibleSql('$1', 'p')}
       ) evh on true
       left join lateral (
         select count(*)::int as n from member_event_actions mea
          where mea.event_id = e.id and mea.rsvp = 'going'
       ) gc on true
      where ${TONIGHT_WINDOW}
      limit 40`,
    [viewerId]
  );
}

export type ActivityItem = {
  kind: 'arrived' | 'going';
  member_id: string;
  display_name: string;
  avatar_url: string | null;
  event_id: string;
  event_title: string;
  event_slug: string;
  at: string;
};

// Activity feed: applies exactly the same visibility predicate as presence
// itself — activity can never leak what the source data would hide.
export async function friendActivity(viewerId: string, limit = 12): Promise<ActivityItem[]> {
  return query<ActivityItem>(
    `(
      select 'arrived' as kind, m.id as member_id, m.display_name, m.avatar_url,
             e.id as event_id, e.title as event_title, e.slug as event_slug,
             p.arrived_at::text as at
        from event_presence p
        join members m on m.id = p.member_id
        join events e on e.id = p.event_id
       where ${PRESENCE_ACTIVE_SQL('p')} and p.visibility <> 'invisible'
         and p.member_id <> $1
         and ${presenceVisibleSql('$1', 'p')}
     )
     union all
     (
      select 'going' as kind, m.id, m.display_name, m.avatar_url,
             e.id, e.title, e.slug, mea.rsvp_at::text as at
        from member_event_actions mea
        join members m on m.id = mea.member_id
        join events e on e.id = mea.event_id
       where mea.rsvp = 'going' and mea.rsvp_at > now() - interval '48 hours'
         and mea.member_id <> $1
         and e.status = 'live' and e.listing_status <> 'cancelled'
         and coalesce(e.end_at, e.start_at + interval '6 hours') > now()
         and exists (select 1 from member_follows f1
                      join member_follows f2 on f2.member_id = f1.entity_id
                       and f2.entity_type = 'member' and f2.entity_id = f1.member_id
                     where f1.member_id = $1 and f1.entity_type = 'member' and f1.entity_id = mea.member_id)
     )
     order by at desc
     limit ${Math.min(limit, 30)}`,
    [viewerId]
  );
}

// Presence expiry default: event end + grace, fallback arrival + 8h,
// clamped to a hard maximum.
export function presenceExpiry(now: Date, endAt: Date | null): Date {
  const grace = CLUB_LIMITS.presenceGraceHours * 3600_000;
  const fallback = new Date(now.getTime() + CLUB_LIMITS.presenceFallbackHours * 3600_000);
  let expiry = endAt && endAt.getTime() > now.getTime()
    ? new Date(endAt.getTime() + grace)
    : fallback;
  const max = new Date(now.getTime() + CLUB_LIMITS.presenceMaxHours * 3600_000);
  if (expiry.getTime() > max.getTime()) expiry = max;
  if (expiry.getTime() <= now.getTime()) expiry = fallback;
  return expiry;
}
