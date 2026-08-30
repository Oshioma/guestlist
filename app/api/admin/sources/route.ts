import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { SOURCE_TYPES, cleanGenreIds, cleanPlace } from '@/lib/util';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim();
    const url = String(body.url ?? '').trim();
    const sourceType = String(body.sourceType ?? '');

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!SOURCE_TYPES.some((t) => t.value === sourceType)) {
      return NextResponse.json({ error: 'Choose a source type' }, { status: 400 });
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      return NextResponse.json({ error: 'A valid URL is required' }, { status: 400 });
    }

    const dup = await queryOne('select 1 from event_sources where url = $1', [url]);
    if (dup) return NextResponse.json({ error: 'That URL is already a source' }, { status: 409 });

    const row = await queryOne<{ id: string }>(
      `insert into event_sources (source_type, name, url, promoter_id, venue_id, notes, city, country)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [sourceType, name, url, body.promoterId || null, body.venueId || null, body.notes || null,
       cleanPlace(body.city), cleanPlace(body.country)]
    );
    const genreIds = cleanGenreIds(body.genreIds);
    if (genreIds.length) {
      await query(
        `insert into event_source_genres (source_id, genre_id)
         select $1, g.id from genres g where g.id = any($2::uuid[])
         on conflict do nothing`,
        [row!.id, genreIds]
      );
    }
    return NextResponse.json({ ok: true, id: row!.id }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
