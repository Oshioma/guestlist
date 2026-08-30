// HIDE / NOT FOR ME — negative recommendation feedback. Excludes the event
// from this member's recommendations and feeds the taste model. DELETE
// undoes it.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { track } from '@/lib/analytics';

const REASONS = ['wrong_music', 'too_far', 'bad_date', 'not_this_promoter', 'other'];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await ctx.params;
    const event = await queryOne(`select 1 from events where id = $1`, [id]);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const kind = body.kind === 'not_for_me' ? 'not_for_me' : 'hide';
    const reason = REASONS.includes(body.reason) ? body.reason : null;
    await query(
      `insert into event_feedback (member_id, event_id, kind, reason)
       values ($1, $2, $3, $4)
       on conflict (member_id, event_id) do update set kind = $3, reason = $4, created_at = now()`,
      [member.id, id, kind, reason]
    );
    await track(kind === 'hide' ? 'event_hidden' : 'event_not_for_me', {
      memberId: member.id, eventId: id, metadata: reason ? { reason } : {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await ctx.params;
    await query(`delete from event_feedback where member_id = $1 and event_id = $2`, [member.id, id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
