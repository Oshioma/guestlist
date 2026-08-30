// V2C admin actions in one moderation endpoint:
//   scene entities:  approve_entity / reject_entity (+ optional lineage links)
//   member reports:  resolve_report
//   duplicates:      decide_duplicate (approve/reject; merge hides the dup)

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'approve_entity' || action === 'reject_entity') {
      const row = await queryOne<{ id: string; name: string }>(
        `update scene_entities set status = $2,
                venue_id = coalesce($3, venue_id),
                promoter_id = coalesce($4, promoter_id)
          where id = $1 returning id, name`,
        [String(body.entityId ?? ''), action === 'approve_entity' ? 'approved' : 'rejected',
         typeof body.venueId === 'string' && body.venueId ? body.venueId : null,
         typeof body.promoterId === 'string' && body.promoterId ? body.promoterId : null]
      );
      if (!row) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'merge_entity') {
      // Conservative dedupe cleanup: move history rows to the kept entity,
      // then reject the duplicate.
      const fromId = String(body.entityId ?? '');
      const intoId = String(body.intoEntityId ?? '');
      if (!fromId || !intoId || fromId === intoId) {
        return NextResponse.json({ error: 'Invalid merge' }, { status: 400 });
      }
      const both = await query(`select id from scene_entities where id in ($1, $2)`, [fromId, intoId]);
      if (both.length !== 2) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
      await query(
        `update member_scene_history h set entity_id = $2
          where h.entity_id = $1
            and not exists (select 1 from member_scene_history h2
                             where h2.member_id = h.member_id and h2.entity_id = $2)`,
        [fromId, intoId]
      );
      await query(`delete from member_scene_history where entity_id = $1`, [fromId]);
      await query(`update scene_entities set status = 'rejected' where id = $1`, [fromId]);
      return NextResponse.json({ ok: true });
    }

    if (action === 'resolve_report') {
      const row = await queryOne(
        `update member_reports set status = 'resolved', resolved_by = $2, resolved_at = now()
          where id = $1 and status = 'open' returning id`,
        [String(body.reportId ?? ''), admin.id]
      );
      if (!row) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'decide_duplicate') {
      const approve = body.approve === true;
      const request = await queryOne<{
        id: string; event_id: string; duplicate_of_event_id: string; action: string; promoter_id: string;
      }>(
        `update event_duplicate_requests
            set status = $2, decided_by = $3, decided_at = now()
          where id = $1 and status = 'pending'
          returning id, event_id, duplicate_of_event_id, action, promoter_id`,
        [String(body.requestId ?? ''), approve ? 'approved' : 'rejected', admin.id]
      );
      if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      if (approve && (request.action === 'same_event' || request.action === 'request_merge')) {
        // The duplicate listing is retired; the canonical event stays live.
        // (Full data merges remain a manual admin operation.)
        await query(
          `update events set status = 'rejected', possible_duplicate_of = $2 where id = $1`,
          [request.duplicate_of_event_id, request.event_id]
        );
        await audit('event_ignored', {
          actorId: admin.id, promoterId: request.promoter_id, eventId: request.duplicate_of_event_id,
          detail: { duplicate_request: request.id, kept_event: request.event_id },
        });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
