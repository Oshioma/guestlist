// Admin control over a promoter account: suspend / unsuspend / un-verify.

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

    const promoter = await queryOne<{ id: string; claim_status: string }>(
      `select id, claim_status from promoters where id = $1`, [id]
    );
    if (!promoter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (action === 'suspend') {
      await query(`update promoters set claim_status = 'suspended', updated_at = now() where id = $1`, [id]);
      await audit('promoter_suspended', { actorId: admin.id, promoterId: id });
      return NextResponse.json({ ok: true });
    }
    if (action === 'unsuspend') {
      await query(`update promoters set claim_status = 'verified', updated_at = now() where id = $1`, [id]);
      await audit('promoter_unsuspended', { actorId: admin.id, promoterId: id });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
