// CLAIM MEMBER OFFER — mints (or re-shows) the member's single-use code.
// Active members only; the code is returned to its owner and nobody else.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requireActiveMember } from '@/lib/membership';
import { claimOffer } from '@/lib/market';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireActiveMember();
    const { id } = await ctx.params;
    const { claim, reused } = await claimOffer(me.id, id);
    return NextResponse.json({ ok: true, claimId: claim.id, reused, url: `/market/claims/${claim.id}` });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Could not claim this offer' }, { status: 500 });
  }
}
