// Event live room chat. Access (documented in migration 004): Going RSVP,
// presence at the event tonight, or admin. Polling endpoint — pass ?after=
// (ISO timestamp) to fetch only newer messages.

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { AuthError, requireMember } from '@/lib/auth';
import { track } from '@/lib/analytics';
import {
  CLUB_LIMITS,
  assertNotClubSuspended,
  canAccessRoom,
} from '@/lib/clubmessenger';

type Ctx = { params: Promise<{ eventId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const member = await requireMember();
    const { eventId } = await ctx.params;
    if (!(await canAccessRoom(member.id, eventId, member.role === 'admin'))) {
      return NextResponse.json({ error: 'Room access requires Going or being here' }, { status: 403 });
    }
    const after = req.nextUrl.searchParams.get('after');
    const afterDate = after ? new Date(after) : null;
    const useAfter = afterDate && !Number.isNaN(afterDate.getTime());
    const messages = await query(
      `select msg.id, msg.body, msg.created_at::text, msg.member_id,
              m.display_name, m.avatar_url
         from event_room_messages msg
         join members m on m.id = msg.member_id
        where msg.event_id = $1 and msg.deleted_at is null
          ${useAfter ? 'and msg.created_at > $2' : ''}
        order by msg.created_at desc
        limit 100`,
      useAfter ? [eventId, afterDate] : [eventId]
    );
    messages.reverse(); // chronological
    return NextResponse.json({ messages, me: member.id });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const member = await requireMember();
    await assertNotClubSuspended(member.id);
    const { eventId } = await ctx.params;

    const event = await queryOne(
      `select 1 from events where id = $1 and status = 'live' and listing_status <> 'cancelled'`,
      [eventId]
    );
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (!(await canAccessRoom(member.id, eventId, member.role === 'admin'))) {
      return NextResponse.json({ error: 'Room access requires Going or being here' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text || text.length > CLUB_LIMITS.messageMaxLength) {
      return NextResponse.json(
        { error: `Message must be 1–${CLUB_LIMITS.messageMaxLength} characters` },
        { status: 400 }
      );
    }

    // Rate limit: per member per room per minute.
    const recent = await queryOne<{ n: number }>(
      `select count(*)::int as n from event_room_messages
        where member_id = $1 and event_id = $2 and created_at > now() - interval '1 minute'`,
      [member.id, eventId]
    );
    if ((recent?.n ?? 0) >= CLUB_LIMITS.messagesPerMinute) {
      return NextResponse.json({ error: 'Slow down — too many messages' }, { status: 429 });
    }

    const inserted = await queryOne<{ id: string; created_at: string }>(
      `insert into event_room_messages (event_id, member_id, body)
       values ($1, $2, $3) returning id, created_at::text`,
      [eventId, member.id, text]
    );
    await track('room_message_sent', { memberId: member.id, eventId });

    // Room-message notifications are OPT-IN (preference defaults to false):
    // only members who turned them on, are part of this room tonight (going
    // or present), and haven't been notified for this room in the last 30
    // minutes. Chatter must never become notification spam.
    await query(
      `insert into notifications (member_id, type, actor_member_id, event_id)
       select np.member_id, 'event_room_message', $1, $2
         from notification_preferences np
        where np.room_messages
          and np.member_id <> $1
          and (
            exists (select 1 from member_event_actions mea
                     where mea.member_id = np.member_id and mea.event_id = $2 and mea.rsvp = 'going')
            or exists (select 1 from event_presence p
                        where p.member_id = np.member_id and p.event_id = $2
                          and p.left_at is null and p.expires_at > now())
          )
          and not exists (
            select 1 from notifications n
             where n.member_id = np.member_id and n.type = 'event_room_message'
               and n.event_id = $2 and n.created_at > now() - interval '30 minutes')`,
      [member.id, eventId]
    );

    return NextResponse.json({
      ok: true,
      message: {
        id: inserted!.id,
        body: text,
        created_at: inserted!.created_at,
        member_id: member.id,
        display_name: member.display_name,
        avatar_url: member.avatar_url,
      },
    });
  } catch (err) {
    if (err instanceof AuthError || (err instanceof Error && 'status' in err)) {
      const status = (err as Error & { status: number }).status;
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
