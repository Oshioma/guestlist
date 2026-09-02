// A member putting their name down for a drop.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requireActiveMember } from '@/lib/membership';
import { claimDrop } from '@/lib/drops';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireActiveMember();
    const { id } = await ctx.params;
    const outcome = await claimDrop(me.id, id);
    return NextResponse.json({ ok: outcome !== 'full', outcome });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
