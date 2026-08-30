// "Where are you?" pings.
// POST { toMemberId, eventId }        → send a ping
// POST { pingId, response }           → answer one (venue-relative text)
//
// Privacy: you can only ping a MUTUAL friend whose presence at the event is
// visible to you right now — the visibility predicate here is the same one
// that decides whether you can see them at all, so a ping can never be used
// to probe hidden presence.

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { AuthError, requireMember } from '@/lib/auth';
import { track } from '@/lib/analytics';
import {
  CLUB_LIMITS,
  PRESENCE_ACTIVE_SQL,
  areFriends,
  assertNotClubSuspended,
  presenceVisibleSql,
} from '@/lib/clubmessenger';

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    await assertNotClubSuspended(member.id);
    const body = await req.json().catch(() => ({}));

    // --- Respond to a ping -------------------------------------------------
    if (typeof body.pingId === 'string' && body.pingId) {
      const response =
        typeof body.response === 'string' ? body.response.trim().slice(0, CLUB_LIMITS.statusMaxLength) : '';
      if (!response) return NextResponse.json({ error: 'Response required' }, { status: 400 });
      const ping = await queryOne<{ id: string; event_id: string; from_member: string }>(
        `update club_pings set responded_at = now(), response = $2
          where id = $1 and to_member = $3 and responded_at is null
          returning id, event_id, from_member`,
        [body.pingId, response, member.id]
      );
      if (!ping) return NextResponse.json({ error: 'Ping not found' }, { status: 404 });
      await track('ping_response', { memberId: member.id, eventId: ping.event_id });
      return NextResponse.json({ ok: true });
    }

    // --- Send a ping -------------------------------------------------------
    const toMemberId = String(body.toMemberId ?? '');
    const eventId = String(body.eventId ?? '');
    if (!toMemberId || !eventId || toMemberId === member.id) {
      return NextResponse.json({ error: 'Invalid ping' }, { status: 400 });
    }
    if (!(await areFriends(member.id, toMemberId))) {
      return NextResponse.json({ error: 'You can only ping friends' }, { status: 403 });
    }
    // Their presence at this event must be active AND visible to the sender.
    const visible = await queryOne(
      `select 1 from event_presence p
        where p.member_id = $2 and p.event_id = $3
          and ${PRESENCE_ACTIVE_SQL('p')} and p.visibility <> 'invisible'
          and ${presenceVisibleSql('$1', 'p')}`,
      [member.id, toMemberId, eventId]
    );
    if (!visible) {
      return NextResponse.json({ error: 'They are not visibly here right now' }, { status: 403 });
    }
    // Cooldown per (sender, target).
    const recent = await queryOne(
      `select 1 from club_pings
        where from_member = $1 and to_member = $2
          and created_at > now() - make_interval(mins => $3)`,
      [member.id, toMemberId, CLUB_LIMITS.pingCooldownMinutes]
    );
    if (recent) {
      return NextResponse.json(
        { error: `You already pinged them — give it ${CLUB_LIMITS.pingCooldownMinutes} minutes` },
        { status: 429 }
      );
    }

    await query(
      `insert into club_pings (from_member, to_member, event_id) values ($1, $2, $3)`,
      [member.id, toMemberId, eventId]
    );
    // Notification, honoring the target's pings preference (default on).
    await query(
      `insert into notifications (member_id, type, actor_member_id, event_id)
       select $1, 'friend_pinged_you', $2, $3
        where coalesce((select pings from notification_preferences where member_id = $1), true)`,
      [toMemberId, member.id, eventId]
    );
    await track('ping_sent', { memberId: member.id, eventId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError || (err instanceof Error && 'status' in err)) {
      const status = (err as Error & { status: number }).status;
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
