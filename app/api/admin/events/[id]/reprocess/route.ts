// REPROCESS: re-run extraction for a draft event from its source URL.
// Live events must be unpublished first — reprocessing never touches
// published content and never auto-publishes.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { runExtractionPipeline } from '@/lib/supply/pipeline';

export const maxDuration = 120;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const event = await queryOne<{ id: string; status: string; source_url: string | null }>(
      `select id, status, source_url from events where id = $1`,
      [id]
    );
    if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!event.source_url) {
      return NextResponse.json({ error: 'Event has no source URL to reprocess from' }, { status: 400 });
    }
    if (event.status === 'live') {
      return NextResponse.json({ error: 'Unpublish before reprocessing a live event' }, { status: 409 });
    }
    const outcome = await runExtractionPipeline(event.source_url, { reprocessEventId: id, scanKind: 'manual' });
    return NextResponse.json({ ok: true, status: outcome.status, extractionId: outcome.extractionId });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Reprocess failed' }, { status: 500 });
  }
}
