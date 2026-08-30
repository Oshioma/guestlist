// I KNOW MORE ABOUT THIS — member corrections queue for admin review.
// Published history is never overwritten directly.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { track } from '@/lib/analytics';

const FIELDS = ['date', 'venue', 'promoter', 'lineup', 'title', 'story', 'image', 'other'];

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    const archiveEventId = String(body.archiveEventId ?? '');
    const field = FIELDS.includes(body.field) ? body.field : 'other';
    const suggestion = typeof body.suggestion === 'string' ? body.suggestion.trim() : '';
    if (!suggestion || suggestion.length > 1000) {
      return NextResponse.json({ error: 'Tell us what you know (up to 1000 characters)' }, { status: 400 });
    }
    const event = await queryOne(
      `select 1 from archive_events where id = $1 and status = 'published'`, [archiveEventId]);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    await query(
      `insert into archive_corrections (member_id, archive_event_id, field, suggestion)
       values ($1, $2, $3, $4)`,
      [member.id, archiveEventId, field, suggestion]);
    await track('archive_correction', { memberId: member.id, metadata: { archive_event_id: archiveEventId, field } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
