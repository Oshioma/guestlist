// Business portal: redeem a member's code at the counter.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requireBusinessRole } from '@/lib/marketAuth';
import { redeemClaim } from '@/lib/market';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member } = await requireBusinessRole(id, 'editor');
    const body = await req.json().catch(() => ({})) as { code?: unknown; note?: unknown };
    const code = typeof body.code === 'string' ? body.code : '';
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) return NextResponse.json({ error: 'Enter the whole code' }, { status: 400 });
    const result = await redeemClaim(id, code, member.id, typeof body.note === 'string' ? body.note : null);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
