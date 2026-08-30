// RETRY: run a fresh extraction for the same URL (new extraction record;
// the failed one stays in the log for source-quality analysis).

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { runExtractionPipeline } from '@/lib/supply/pipeline';

export const maxDuration = 120;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const extraction = await queryOne<{ url: string; source_id: string | null }>(
      `select url, source_id from extractions where id = $1`,
      [id]
    );
    if (!extraction) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const outcome = await runExtractionPipeline(extraction.url, {
      sourceId: extraction.source_id,
      scanKind: 'manual',
    });
    return NextResponse.json({ ok: true, status: outcome.status, extractionId: outcome.extractionId });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Retry failed' }, { status: 500 });
  }
}
