// TEST FETCH: admin diagnostic for one saved source. Fetches the scanner's
// target twice — once as GuestlistBot (the scanner's real identity) and once
// with a browser user agent — so an admin can tell WHY a source fails: dead
// URL, user-agent filtering, IP-level blocking, or a JS-rendered page with no
// links in the HTML. The probe itself lives in lib/supply/probe so the
// discovery workbench tests unsaved candidates exactly the same way.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { probeTarget } from '@/lib/supply/probe';
import { candidateCap } from '@/lib/supply/scanner';

export const maxDuration = 60;

export type { FetchProbe } from '@/lib/supply/probe';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const source = await queryOne<{ url: string; feed_url: string | null; max_candidates: number | null }>(
      `select url, feed_url, max_candidates from event_sources where id = $1`,
      [id]
    );
    if (!source) return NextResponse.json({ error: 'Source not found' }, { status: 404 });

    // Same target AND the same ceiling the scanner would use. A test that
    // stops at forty while the scan takes three hundred is a test that
    // reports a truncation the scan will not have.
    return NextResponse.json(await probeTarget(source.feed_url ?? source.url, {
      limit: candidateCap(source),
    }));
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
