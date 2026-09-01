// Clear a review queue in one press. The queue is recomputed server-side from
// the state alone — the browser sends a queue name, never a list of events.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { publishQueue } from '@/lib/adminEvents';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const state = body?.state;
    if (state !== 'new' && state !== 'needs_review') {
      return NextResponse.json({ error: 'Only the New and Needs Review queues can be published in bulk' }, { status: 400 });
    }
    return NextResponse.json(await publishQueue(state, admin.id));
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
