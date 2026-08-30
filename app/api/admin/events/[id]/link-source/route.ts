// LINK SOURCE: resolve a flagged duplicate by attaching this draft's URL(s)
// as evidence on the canonical event, then rejecting the draft. Nothing is
// merged destructively; provenance is retained.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const draft = await queryOne<{
      id: string; status: string; source_url: string | null;
      canonical_url: string | null; possible_duplicate_of: string | null; source_id: string | null;
    }>(
      `select id, status, source_url, canonical_url, possible_duplicate_of, source_id
         from events where id = $1`,
      [id]
    );
    if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!draft.possible_duplicate_of) {
      return NextResponse.json({ error: 'Event has no duplicate flag to resolve' }, { status: 400 });
    }
    const canonical = await queryOne<{ id: string }>(
      `select id from events where id = $1 and status <> 'rejected'`,
      [draft.possible_duplicate_of]
    );
    if (!canonical) return NextResponse.json({ error: 'Canonical event no longer exists' }, { status: 409 });

    for (const url of [draft.source_url, draft.canonical_url]) {
      if (!url) continue;
      await query(
        `insert into event_source_links (event_id, source_id, url, kind)
         values ($1, $2, $3, 'enrichment') on conflict (event_id, url) do nothing`,
        [canonical.id, draft.source_id, url]
      );
    }
    await query(
      `update events set status = 'rejected', updated_at = now() where id = $1`,
      [draft.id]
    );
    await query(
      `update extractions set event_id = $2, status = 'duplicate_linked', duplicate_of = $2, updated_at = now()
        where event_id = $1`,
      [draft.id, canonical.id]
    );
    return NextResponse.json({ ok: true, linkedTo: canonical.id });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Link failed' }, { status: 500 });
  }
}
