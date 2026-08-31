// ADD A MIX — members paste a Mixcloud / SoundCloud / YouTube link onto an
// archive night. Reviewed before it appears; admins' own additions publish
// immediately (they are the reviewers).

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { track } from '@/lib/analytics';
import { parseMixUrl } from '@/lib/archive/mixes';

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));

    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
    if (title.length < 2) return NextResponse.json({ error: 'Give the mix a name' }, { status: 400 });
    const artist = typeof body.artist === 'string' ? body.artist.trim().slice(0, 120) || null : null;

    const parsed = parseMixUrl(String(body.url ?? ''));
    if (!parsed) {
      return NextResponse.json(
        { error: 'Paste a Mixcloud, SoundCloud or YouTube link — those play right here on Guestlist' },
        { status: 400 });
    }

    // A mix targets a specific night OR a scene/club directly.
    let eventId: string | null = null;
    let sceneId: string | null = null;
    if (body.archiveEventId) {
      const event = await queryOne<{ id: string }>(
        `select id from archive_events where id = $1 and status <> 'rejected'`,
        [String(body.archiveEventId)]);
      if (!event) return NextResponse.json({ error: 'Night not found' }, { status: 404 });
      eventId = event.id;
    } else if (body.sceneEntityId) {
      const scene = await queryOne<{ id: string }>(
        `select id from scene_entities where id = $1 and status = 'approved'`,
        [String(body.sceneEntityId)]);
      if (!scene) return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
      sceneId = scene.id;
    } else {
      return NextResponse.json({ error: 'A night or a scene is required' }, { status: 400 });
    }

    const status = member.role === 'admin' ? 'published' : 'pending';
    const row = await queryOne<{ id: string }>(
      `insert into archive_mixes
         (archive_event_id, scene_entity_id, title, artist_name, platform, url,
          contributed_by, credit_contributor, status, published_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $9 = 'published' then now() end)
       on conflict do nothing
       returning id`,
      [eventId, sceneId, title, artist, parsed.platform, parsed.canonicalUrl, member.id,
       body.credit !== false, status]);
    if (!row) {
      return NextResponse.json(
        { error: eventId ? 'That mix is already on this night' : 'That mix is already on this scene' },
        { status: 409 });
    }

    await track('archive_contribution', {
      memberId: member.id,
      metadata: { kind: 'mix', id: row.id, platform: parsed.platform },
    });
    return NextResponse.json({
      ok: true,
      id: row.id,
      note: status === 'published'
        ? 'Published.'
        : 'Thanks — the Guestlist team reviews every mix before it appears.',
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
