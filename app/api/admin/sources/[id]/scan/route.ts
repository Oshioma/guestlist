// SCAN NOW: admin-triggered scan of one source.
//
// The POST starts the job and hands back its id; the work runs after the
// response, and the desk watches the row via GET. Holding the request open for
// the whole scan is what left the desk spinning for ever on a big site: the
// browser waited on a function that had already been killed, and no result was
// ever written down.

import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { getScan, runScan, startScan } from '@/lib/supply/scanner';

export const maxDuration = 300;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const scanId = await startScan(id);
    after(async () => {
      // The row carries the outcome either way — a throw here still leaves a
      // 'running' row, which the stale sweep finishes off honestly.
      try { await runScan(id, scanId); } catch (err) { console.error('scan failed', err); }
    });
    return NextResponse.json({ scanId, running: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Scan failed' }, { status: 500 });
  }
}

// Where is it up to? Answers for a scan that is running, one that finished,
// and one that died — the desk never has to guess which it is looking at.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    await ctx.params;
    const scanId = new URL(req.url).searchParams.get('scanId');
    if (!scanId) return NextResponse.json({ error: 'Which scan?' }, { status: 400 });
    const scan = await getScan(scanId);
    return scan ? NextResponse.json(scan) : NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
