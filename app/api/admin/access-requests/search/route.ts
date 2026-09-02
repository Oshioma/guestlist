// LINK EVENT / ASSIGN PROMOTER pickers for the desk.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { searchEventsForDesk, searchPromotersForDesk } from '@/lib/accessRequests';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const q = req.nextUrl.searchParams.get('q') ?? '';
    const kind = req.nextUrl.searchParams.get('kind') === 'promoters' ? 'promoters' : 'events';
    const results = kind === 'promoters' ? await searchPromotersForDesk(q) : await searchEventsForDesk(q);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
