// FOLLOWERS — aggregates only, behind the privacy floor. No identities, no
// contact data, nothing exportable. Any team member may view.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requirePromoterRole } from '@/lib/promoterAuth';
import { followerStats } from '@/lib/announcements';
import { track } from '@/lib/analytics';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member } = await requirePromoterRole(id, 'analyst');
    const stats = await followerStats(id);
    await track('promoter_followers_viewed', { memberId: member.id, promoterId: id });
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
