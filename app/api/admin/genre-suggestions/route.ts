// Admin resolution of unknown genre suggestions from the classifier.
// Actions operate on every pending suggestion with the same (case-
// insensitive) term:
//   map     — tag the source events with an EXISTING taxonomy genre
//   create  — explicit admin decision to add a genre, then map onto it
//   dismiss — drop the term
// AI never creates genres; only this admin action can.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { slugify } from '@/lib/util';

async function tagEvents(term: string, genreId: string, parentId: string | null) {
  // Tag each suggestion's event with the chosen genre (and its parent, as
  // the pipeline does for subgenres), carrying the suggestion confidence.
  await query(
    `insert into event_genres (event_id, genre_id, source, confidence)
     select gs.event_id, $2, 'ai', coalesce(gs.confidence, 60)
       from genre_suggestions gs
      where lower(gs.suggested_name) = lower($1) and gs.status = 'pending' and gs.event_id is not null
     on conflict (event_id, genre_id) do nothing`,
    [term, genreId]
  );
  if (parentId) {
    await query(
      `insert into event_genres (event_id, genre_id, source, confidence)
       select gs.event_id, $2, 'ai', greatest(1, coalesce(gs.confidence, 60) - 5)
         from genre_suggestions gs
        where lower(gs.suggested_name) = lower($1) and gs.status = 'pending' and gs.event_id is not null
       on conflict (event_id, genre_id) do nothing`,
      [term, parentId]
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const term = String(body.term ?? '').trim();
    const action = String(body.action ?? '');
    if (!term) return NextResponse.json({ error: 'Missing term' }, { status: 400 });

    const pending = await queryOne<{ n: number }>(
      `select count(*)::int as n from genre_suggestions
        where lower(suggested_name) = lower($1) and status = 'pending'`,
      [term]
    );
    if (!pending?.n) return NextResponse.json({ error: 'No pending suggestions for that term' }, { status: 404 });

    if (action === 'dismiss') {
      await query(
        `update genre_suggestions set status = 'dismissed'
          where lower(suggested_name) = lower($1) and status = 'pending'`,
        [term]
      );
      return NextResponse.json({ ok: true });
    }

    if (action === 'map') {
      const slug = String(body.genreSlug ?? '');
      const genre = await queryOne<{ id: string; parent_genre_id: string | null }>(
        `select id, parent_genre_id from genres where slug = $1 and active`,
        [slug]
      );
      if (!genre) return NextResponse.json({ error: 'Unknown target genre' }, { status: 400 });
      await tagEvents(term, genre.id, genre.parent_genre_id);
      await query(
        `update genre_suggestions set status = 'mapped'
          where lower(suggested_name) = lower($1) and status = 'pending'`,
        [term]
      );
      return NextResponse.json({ ok: true, mappedTo: slug });
    }

    if (action === 'create') {
      const name = String(body.name ?? term).trim().slice(0, 80);
      if (!name) return NextResponse.json({ error: 'A genre name is required' }, { status: 400 });
      const parentSlug = String(body.parentSlug ?? '') || null;
      let parentId: string | null = null;
      if (parentSlug) {
        const parent = await queryOne<{ id: string }>(
          `select id from genres where slug = $1 and parent_genre_id is null and active`,
          [parentSlug]
        );
        if (!parent) return NextResponse.json({ error: 'Parent must be an existing top-level genre' }, { status: 400 });
        parentId = parent.id;
      }
      const slug = slugify(name);
      const clash = await queryOne(`select 1 from genres where slug = $1`, [slug]);
      if (clash) {
        return NextResponse.json({ error: 'A genre with that slug already exists — use MAP instead' }, { status: 409 });
      }
      const genre = await queryOne<{ id: string }>(
        `insert into genres (name, slug, parent_genre_id, sort_order)
         values ($1, $2, $3, (select coalesce(max(sort_order), 0) + 1 from genres))
         returning id`,
        [name, slug, parentId]
      );
      await tagEvents(term, genre!.id, parentId);
      await query(
        `update genre_suggestions set status = 'mapped'
          where lower(suggested_name) = lower($1) and status = 'pending'`,
        [term]
      );
      return NextResponse.json({ ok: true, created: slug }, { status: 201 });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
