// Report a room message. One report per member per message; report_count is
// recomputed from the reports table so it can't drift.

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { AuthError, requireMember } from '@/lib/auth';
import { canAccessRoom } from '@/lib/clubmessenger';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ eventId: string; messageId: string }> }
) {
  try {
    const member = await requireMember();
    const { eventId, messageId } = await ctx.params;
    if (!(await canAccessRoom(member.id, eventId, member.role === 'admin'))) {
      return NextResponse.json({ error: 'Room access required' }, { status: 403 });
    }
    const message = await queryOne(
      `select 1 from event_room_messages where id = $1 and event_id = $2 and deleted_at is null`,
      [messageId, eventId]
    );
    if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 300)
        : null;

    await query(
      `insert into room_message_reports (message_id, reporter_id, reason)
       values ($1, $2, $3) on conflict (message_id, reporter_id) do nothing`,
      [messageId, member.id, reason]
    );
    await query(
      `update event_room_messages set report_count =
         (select count(*) from room_message_reports where message_id = $1)
       where id = $1`,
      [messageId]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
