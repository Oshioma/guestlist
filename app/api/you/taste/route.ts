// Member music taste: explicit genres (what you told us) + inferred
// (what your behaviour suggests). Explicit is member-controlled; inferred
// is shown transparently and never overwrites explicit choices.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { setExplicitGenres, tasteProfile } from '@/lib/taste';
import { track } from '@/lib/analytics';

export async function GET() {
  try {
    const member = await requireMember();
    const [profile, genres] = await Promise.all([
      tasteProfile(member.id),
      query(
        `select g.id, g.name, g.slug, g.parent_genre_id
           from genres g where g.active
          order by coalesce(g.parent_genre_id::text, g.id::text), g.sort_order, g.name`
      ),
    ]);
    return NextResponse.json({ ...profile, allGenres: genres });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    const genreIds = Array.isArray(body.genreIds)
      ? body.genreIds.filter((g: unknown) => typeof g === 'string')
      : [];
    await setExplicitGenres(member.id, genreIds);
    await track('taste_updated', { memberId: member.id, metadata: { count: genreIds.length } });
    const profile = await tasteProfile(member.id);
    return NextResponse.json({ ok: true, ...profile });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
