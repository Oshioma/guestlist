// Presence: "I'M HERE" / leave / visibility / status.
// Manual only — no GPS, no location tracking. Arriving auto-promotes the
// member's RSVP to Going (being in the room implies going), but an RSVP is
// never treated as presence in the other direction.

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { AuthError, requireMember } from '@/lib/auth';
import { track } from '@/lib/analytics';
import {
  CLUB_LIMITS,
  assertNotClubSuspended,
  myActivePresence,
  presenceExpiry,
} from '@/lib/clubmessenger';

const VISIBILITIES = ['friends', 'event', 'invisible'] as const;
type Visibility = (typeof VISIBILITIES)[number];

// Notify mutual friends that this member arrived — respecting their
// notification preferences (friend_arrivals defaults to ON with no row) and
// never for an invisible arrival. A 12h dedupe window stops re-arrivals at
// the same event from spamming.
async function notifyFriendsOfArrival(memberId: string, eventId: string) {
  await query(
    `insert into notifications (member_id, type, actor_member_id, event_id)
     select f1.member_id, 'friend_arrived', $1, $2
       from member_follows f1
       join member_follows f2
         on f2.member_id = $1 and f2.entity_type = 'member' and f2.entity_id = f1.member_id
       left join notification_preferences np on np.member_id = f1.member_id
      where f1.entity_type = 'member' and f1.entity_id = $1
        and coalesce(np.friend_arrivals, true)
        and not exists (
          select 1 from notifications n
           where n.member_id = f1.member_id and n.type = 'friend_arrived'
             and n.actor_member_id = $1 and n.event_id = $2
             and n.created_at > now() - interval '12 hours')`,
    [memberId, eventId]
  );
}

export async function GET() {
  try {
    const member = await requireMember();
    return NextResponse.json({ presence: await myActivePresence(member.id) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    await assertNotClubSuspended(member.id);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const eventId = String(body.eventId ?? '');

    if (!['arrive', 'leave', 'visibility', 'status'].includes(action)) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const event = await queryOne<{ id: string; end_at: Date | null; start_at: Date }>(
      `select id, start_at, end_at from events
        where id = $1 and status = 'live' and listing_status <> 'cancelled'`,
      [eventId]
    );
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    if (action === 'arrive') {
      // Check-in only makes sense around event time: from 24h before start
      // until (end + grace) after.
      const now = new Date();
      const start = new Date(event.start_at);
      const end = event.end_at ? new Date(event.end_at) : new Date(start.getTime() + 6 * 3600_000);
      if (start.getTime() > now.getTime() + 24 * 3600_000) {
        return NextResponse.json({ error: 'Too early to check in to this event' }, { status: 400 });
      }
      if (end.getTime() + CLUB_LIMITS.presenceGraceHours * 3600_000 < now.getTime()) {
        return NextResponse.json({ error: 'This event has already ended' }, { status: 400 });
      }

      const visibility: Visibility = VISIBILITIES.includes(body.visibility)
        ? body.visibility
        : 'friends';
      const status = normalizeStatus(body.status);
      const expires = presenceExpiry(now, event.end_at ? new Date(event.end_at) : null);

      // One active presence at a time: leave anywhere else first.
      await query(
        `update event_presence set left_at = now(), updated_at = now()
          where member_id = $1 and event_id <> $2 and left_at is null and expires_at > now()`,
        [member.id, eventId]
      );
      await query(
        `insert into event_presence (member_id, event_id, arrived_at, expires_at, visibility, status)
         values ($1, $2, now(), $3, $4, $5)
         on conflict (member_id, event_id) do update set
           arrived_at = now(), expires_at = $3, left_at = null,
           visibility = $4, status = $5, updated_at = now()`,
        [member.id, eventId, expires, visibility, status]
      );
      // Being here implies going — promote the RSVP (never the reverse).
      await query(
        `insert into member_event_actions (member_id, event_id, rsvp, rsvp_at, updated_at)
         values ($1, $2, 'going', now(), now())
         on conflict (member_id, event_id) do update set
           rsvp = 'going',
           rsvp_at = case when member_event_actions.rsvp is distinct from 'going' then now()
                          else member_event_actions.rsvp_at end,
           updated_at = now()`,
        [member.id, eventId]
      );
      await track('presence_started', {
        memberId: member.id, eventId, metadata: { visibility },
      });
      if (visibility !== 'invisible') {
        await notifyFriendsOfArrival(member.id, eventId);
      }
      return NextResponse.json({ ok: true, presence: await myActivePresence(member.id) });
    }

    // The remaining actions operate on an existing presence row.
    const presence = await queryOne<{ id: string; visibility: Visibility }>(
      `select id, visibility from event_presence
        where member_id = $1 and event_id = $2 and left_at is null and expires_at > now()`,
      [member.id, eventId]
    );
    if (!presence) {
      return NextResponse.json({ error: 'You are not checked in here' }, { status: 400 });
    }

    if (action === 'leave') {
      await query(
        `update event_presence set left_at = now(), updated_at = now() where id = $1`,
        [presence.id]
      );
      await track('presence_ended', { memberId: member.id, eventId });
      return NextResponse.json({ ok: true, presence: null });
    }

    if (action === 'visibility') {
      const visibility = body.visibility as Visibility;
      if (!VISIBILITIES.includes(visibility)) {
        return NextResponse.json({ error: 'Unknown visibility' }, { status: 400 });
      }
      await query(
        `update event_presence set visibility = $2, updated_at = now() where id = $1`,
        [presence.id, visibility]
      );
      await track('presence_visibility_changed', {
        memberId: member.id, eventId,
        metadata: { from: presence.visibility, to: visibility },
      });
      // Coming out of invisible counts as arriving, for friends who missed it.
      if (presence.visibility === 'invisible' && visibility !== 'invisible') {
        await notifyFriendsOfArrival(member.id, eventId);
      }
      return NextResponse.json({ ok: true, presence: await myActivePresence(member.id) });
    }

    // action === 'status'
    const status = normalizeStatus(body.status);
    await query(
      `update event_presence set status = $2, updated_at = now() where id = $1`,
      [presence.id, status]
    );
    return NextResponse.json({ ok: true, presence: await myActivePresence(member.id) });
  } catch (err) {
    if (err instanceof AuthError || (err instanceof Error && 'status' in err)) {
      const status = (err as Error & { status: number }).status;
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, CLUB_LIMITS.statusMaxLength);
  return trimmed.length ? trimmed : null;
}
