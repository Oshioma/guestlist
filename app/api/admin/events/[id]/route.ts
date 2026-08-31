import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { updateEvent, validateEventInput, type EventInput } from '@/lib/adminEvents';
import { queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    // Deletion is permanent — RSVPs, images, lineups and messenger rooms go
    // with it (all FKs cascade or null out). The audit row records what died.
    const row = await queryOne<{ title: string }>(
      `delete from events where id = $1 returning title`, [id]);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await audit('event_deleted', { actorId: admin.id, detail: { eventId: id, title: row.title } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const input = (await req.json().catch(() => ({}))) as Partial<EventInput>;

    // Full-field updates get full validation; bare status transitions
    // (publish / reject from the review queue) skip it.
    if (input.title !== undefined || input.startAt !== undefined) {
      const existing = await queryOne<{ title: string; start_at: string; event_type: string }>(
        'select title, start_at, event_type from events where id = $1', [id]
      );
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const problem = validateEventInput({
        title: input.title ?? existing.title,
        startAt: input.startAt ?? existing.start_at,
        endAt: input.endAt ?? undefined,
        eventType: input.eventType ?? existing.event_type,
        priceFrom: input.priceFrom,
        priceTo: input.priceTo,
      });
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const result = await updateEvent(id, input);
    if (!result.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
