// Admin decisions on pending event-association claims.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    const claim = await queryOne<{ id: string; event_id: string; promoter_id: string; status: string }>(
      `select id, event_id, promoter_id, status from event_claims where id = $1`, [id]
    );
    if (!claim) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (claim.status !== 'pending') return NextResponse.json({ error: 'Already decided' }, { status: 409 });

    if (action === 'approve') {
      await query(
        `update event_claims set status = 'approved', decided_by = $2, decided_at = now() where id = $1`,
        [id, admin.id]
      );
      await query(
        `update events set promoter_id = $2, updated_at = now() where id = $1 and promoter_id is null`,
        [claim.event_id, claim.promoter_id]
      );
    } else if (action === 'reject') {
      await query(
        `update event_claims set status = 'rejected', decided_by = $2, decided_at = now() where id = $1`,
        [id, admin.id]
      );
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    await audit('event_claim_decided', {
      actorId: admin.id, promoterId: claim.promoter_id, eventId: claim.event_id,
      detail: { claimId: id, action },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
