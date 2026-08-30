// Save / Interested / Going actions for one event.
// One row per (member, event); the row is removed when nothing remains set.

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { AuthError, requireMember } from '@/lib/auth';
import { track } from '@/lib/analytics';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const event = await queryOne<{ id: string; status: string }>(
      `select id, status from events where id = $1`,
      [id]
    );
    if (!event || (event.status !== 'live' && member.role !== 'admin')) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const hasSaved = typeof body.saved === 'boolean';
    const rsvpValid =
      body.rsvp === null || body.rsvp === 'interested' || body.rsvp === 'going';
    const hasRsvp = 'rsvp' in body && rsvpValid;
    if (!hasSaved && !hasRsvp) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const prev = await queryOne<{ saved_at: string | null; rsvp: string | null }>(
      `select saved_at, rsvp from member_event_actions where member_id = $1 and event_id = $2`,
      [member.id, id]
    );

    const nextSaved = hasSaved ? (body.saved as boolean) : !!prev?.saved_at;
    const nextRsvp = hasRsvp ? (body.rsvp as 'interested' | 'going' | null) : (prev?.rsvp ?? null);

    if (!nextSaved && !nextRsvp) {
      await query(
        `delete from member_event_actions where member_id = $1 and event_id = $2`,
        [member.id, id]
      );
    } else {
      await query(
        `insert into member_event_actions (member_id, event_id, saved_at, rsvp, rsvp_at, updated_at)
         values ($1, $2, $3, $4, case when $4::rsvp_status is null then null else now() end, now())
         on conflict (member_id, event_id) do update set
           saved_at = case when $5 then coalesce(member_event_actions.saved_at, now()) else null end,
           rsvp = $4,
           rsvp_at = case
             when $4::rsvp_status is null then null
             when member_event_actions.rsvp is distinct from $4 then now()
             else member_event_actions.rsvp_at end,
           updated_at = now()`,
        [member.id, id, nextSaved ? new Date() : null, nextRsvp, nextSaved]
      );
    }

    // Analytics for what actually changed.
    if (hasSaved && nextSaved !== !!prev?.saved_at) {
      await track(nextSaved ? 'event_saved' : 'event_unsaved', {
        memberId: member.id, eventId: id,
      });
    }
    if (hasRsvp && nextRsvp !== (prev?.rsvp ?? null)) {
      await track(
        nextRsvp === 'going' ? 'going' : nextRsvp === 'interested' ? 'interested' : 'rsvp_cleared',
        { memberId: member.id, eventId: id }
      );
      // Attribution: Going set from a Club Messenger surface gets its own row.
      if (nextRsvp === 'going' && body.source === 'clubmessenger') {
        await track('going_from_clubmessenger', { memberId: member.id, eventId: id });
      }
    }

    return NextResponse.json({ ok: true, saved: nextSaved, rsvp: nextRsvp });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
