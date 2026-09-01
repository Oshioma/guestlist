// TEST URL: the same diagnostic as a saved source's "Test fetch", but for a
// URL that is not a source yet. This is the gate on discovery — a suggested
// club is only worth adding once we have fetched its listing page ourselves
// and seen real event links in it.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { probeTarget } from '@/lib/supply/probe';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const raw = String(body.url ?? '').trim();
    let target: string;
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      target = parsed.toString();
    } catch {
      return NextResponse.json({ error: 'A valid http(s) URL is required' }, { status: 400 });
    }
    // safeFetch enforces the private-address and redirect rules; nothing here
    // can reach the internal network.
    return NextResponse.json(await probeTarget(target, { findListingOnMiss: true }));
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Test fetch failed' },
      { status: 500 }
    );
  }
}
