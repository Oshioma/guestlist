// Marking an arrival. Reading a pass takes only the link; changing one takes
// a signed-in member of that promoter's team, because a check-in is a claim
// about what happened at a door.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requirePromoterRole } from '@/lib/promoterAuth';
import { doorPass, toggleCheckIn } from '@/lib/doorPass';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const pass = await doorPass(token);
    if (!pass) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await requirePromoterRole(pass.promoterId, 'analyst');
    if (pass.status !== 'confirmed') {
      return NextResponse.json({ error: 'This pass is not confirmed' }, { status: 400 });
    }
    const { checkedInAt } = await toggleCheckIn(pass.entryId);
    return NextResponse.json({ ok: true, checkedInAt });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
