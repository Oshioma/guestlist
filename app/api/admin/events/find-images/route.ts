// Look for the missing flyers across a whole queue. The queue is recomputed
// server-side from its name; the browser never sends a list of events.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { findImagesForQueue } from '@/lib/supply/imageBackfill';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const state = body?.state;
    if (state !== 'new' && state !== 'needs_review' && state !== 'live') {
      return NextResponse.json({ error: 'Unknown queue' }, { status: 400 });
    }
    return NextResponse.json(await findImagesForQueue(state));
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
