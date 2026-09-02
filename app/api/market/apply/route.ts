// A business asking to join Guestlist Market. Lands as 'applied' for the
// desk to decide; the applicant becomes its owner in the portal.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { applyToMarket, type BusinessPatch } from '@/lib/market';
import { getMemberBusinesses } from '@/lib/marketAuth';

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const mine = await getMemberBusinesses(member.id);
    if (mine.length >= 5) return NextResponse.json({ error: 'You already manage several businesses — talk to us' }, { status: 400 });
    const body = await req.json().catch(() => ({})) as BusinessPatch;
    const created = await applyToMarket(member.id, body);
    return NextResponse.json({ ok: true, ...created });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
