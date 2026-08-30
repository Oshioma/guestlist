// I WAS THERE. Simple by design: one tap sets it, optional "I think I was
// there", per-member visibility. Cultural memory, not legal verification.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { track } from '@/lib/analytics';
import { visibleAttendanceCount } from '@/lib/archive/core';

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    const archiveEventId = String(body.archiveEventId ?? '');
    const event = await queryOne(
      `select 1 from archive_events where id = $1 and status = 'published'`, [archiveEventId]);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    if (body.action === 'remove') {
      await query(
        `delete from archive_attendance where member_id = $1 and archive_event_id = $2`,
        [member.id, archiveEventId]);
      await track('i_was_there_removed', { memberId: member.id, metadata: { archive_event_id: archiveEventId } });
    } else {
      const certainty = body.certainty === 'unsure' ? 'unsure' : 'sure';
      const visibility = ['public', 'connections', 'private'].includes(body.visibility)
        ? body.visibility : 'public';
      await query(
        `insert into archive_attendance (member_id, archive_event_id, certainty, visibility)
         values ($1, $2, $3, $4)
         on conflict (member_id, archive_event_id)
           do update set certainty = $3, visibility = $4`,
        [member.id, archiveEventId, certainty, visibility]);
      await track('i_was_there_added', {
        memberId: member.id, metadata: { archive_event_id: archiveEventId, certainty, visibility },
      });
    }
    return NextResponse.json({
      ok: true,
      count: await visibleAttendanceCount(archiveEventId, member.id),
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
