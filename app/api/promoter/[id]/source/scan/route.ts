// SCAN NOW from the promoter dashboard: runs the V2A scanner on the
// promoter's connected source and reports what was found in promoter-
// friendly terms (found / already on Guestlist / new).

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { requirePromoterRole } from '@/lib/promoterAuth';
import { scanSource } from '@/lib/supply/scanner';
import { audit, notifyPromoter } from '@/lib/audit';

export const maxDuration = 300;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member } = await requirePromoterRole(id, 'editor');
    const source = await queryOne<{ id: string; trust: string; failure_count: number }>(
      `select id, trust, failure_count from event_sources where promoter_id = $1 order by created_at asc limit 1`,
      [id]
    );
    if (!source) return NextResponse.json({ error: 'Connect your website first' }, { status: 404 });
    if (source.trust === 'blocked') {
      return NextResponse.json({ error: 'This source is blocked — contact Guestlist' }, { status: 403 });
    }

    const result = await scanSource(source.id);
    await audit('source_scanned', {
      actorId: member.id, promoterId: id, sourceId: source.id,
      detail: {
        status: result.status, candidates: result.candidatesFound,
        new: result.newCandidates, extracted: result.extracted, failed: result.failed,
      },
    });
    if (result.extracted > 0) {
      await notifyPromoter(id, 'events_found', {
        sourceId: source.id,
        payload: { extracted: result.extracted, new: result.newCandidates },
      });
    }
    if (result.status === 'failed') {
      const failures = (source.failure_count ?? 0) + 1;
      if (failures >= 3) {
        await notifyPromoter(id, 'source_failing', { sourceId: source.id, payload: { failures } });
      }
    }

    // Promoter-friendly summary of the queue after this scan.
    const queue = await queryOne<{ pending: number }>(
      `select count(*)::int as pending from events
        where promoter_id = $1 and status in ('new', 'needs_review')`,
      [id]
    );
    return NextResponse.json({
      ok: result.status === 'succeeded',
      found: result.candidatesFound,
      alreadyOnGuestlist: result.duplicates + (result.candidatesFound - result.newCandidates),
      newEvents: result.extracted,
      failed: result.failed,
      pendingReview: queue?.pending ?? 0,
      error: result.error,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
  }
}
