// YOUR MEMORY OF THIS NIGHT — short, human, author-controlled. Not a
// forum: one short memory per post, editable/deletable by its author,
// reportable by anyone.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { track } from '@/lib/analytics';

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));

    if (typeof body.reportMemoryId === 'string' && body.reportMemoryId) {
      const memory = await queryOne(
        `select 1 from archive_memories where id = $1 and status = 'visible'`, [body.reportMemoryId]);
      if (!memory) return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
      await query(
        `insert into archive_memory_reports (memory_id, reporter_id, reason)
         values ($1, $2, $3) on conflict do nothing`,
        [body.reportMemoryId, member.id,
         typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : null]);
      await query(
        `update archive_memories set report_count =
           (select count(*) from archive_memory_reports where memory_id = $1) where id = $1`,
        [body.reportMemoryId]);
      return NextResponse.json({ ok: true });
    }

    const archiveEventId = String(body.archiveEventId ?? '');
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text || text.length > 500) {
      return NextResponse.json({ error: 'Memories are 1–500 characters' }, { status: 400 });
    }
    const event = await queryOne(
      `select 1 from archive_events where id = $1 and status = 'published'`, [archiveEventId]);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const existing = await queryOne<{ id: string }>(
      `select id from archive_memories where member_id = $1 and archive_event_id = $2 and status = 'visible'`,
      [member.id, archiveEventId]);
    if (existing) {
      await query(
        `update archive_memories set body = $2, updated_at = now() where id = $1`,
        [existing.id, text]);
    } else {
      await query(
        `insert into archive_memories (member_id, archive_event_id, body) values ($1, $2, $3)`,
        [member.id, archiveEventId, text]);
      await track('memory_added', { memberId: member.id, metadata: { archive_event_id: archiveEventId } });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    await query(
      `delete from archive_memories where id = $1 and member_id = $2`,
      [String(body.memoryId ?? ''), member.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
