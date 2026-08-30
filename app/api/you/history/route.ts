// Rave history: WHERE DID YOU RAVE? Add an existing scene entity (or a new
// pending one via "Can't find it? Add it"), rough years, and what you were
// into. New entities go through admin moderation + conservative dedupe.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { addHistory, findOrCreateSceneEntity, myHistory } from '@/lib/scene';
import { countryCodeFor } from '@/lib/locations';
import { track } from '@/lib/analytics';

const ENTITY_TYPES = ['club', 'venue', 'promoter', 'party', 'festival', 'scene', 'city'];

function parseYear(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null;
}

export async function GET() {
  try {
    const member = await requireMember();
    return NextResponse.json({ history: await myHistory(member.id) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));

    let entityId = typeof body.entityId === 'string' ? body.entityId : null;
    let entityCreated = false;

    if (!entityId && body.newEntity && typeof body.newEntity === 'object') {
      const ne = body.newEntity;
      const name = typeof ne.name === 'string' ? ne.name.trim() : '';
      const entityType = ENTITY_TYPES.includes(ne.entityType) ? ne.entityType : 'club';
      if (name.length < 2 || name.length > 120) {
        return NextResponse.json({ error: 'Give the place a real name' }, { status: 400 });
      }
      const { entity, created } = await findOrCreateSceneEntity(
        {
          name,
          entityType,
          city: typeof ne.city === 'string' ? ne.city.slice(0, 80) : null,
          countryCode: countryCodeFor(typeof ne.country === 'string' ? ne.country : null),
          countryName: typeof ne.country === 'string' ? ne.country.slice(0, 80) : null,
          activeFromYear: parseYear(ne.activeFromYear),
          activeToYear: parseYear(ne.activeToYear),
        },
        member.id,
        member.role === 'admin'
      );
      entityId = entity.id;
      entityCreated = created;
      if (created) {
        await track('scene_entity_added', {
          memberId: member.id,
          metadata: { entity_id: entity.id, entity_type: entityType, status: entity.status },
        });
      }
    }

    if (!entityId) return NextResponse.json({ error: 'Pick a place or add a new one' }, { status: 400 });
    const exists = await query(`select 1 from scene_entities where id = $1`, [entityId]);
    if (!exists.length) return NextResponse.json({ error: 'Place not found' }, { status: 404 });

    const fromYear = parseYear(body.fromYear);
    const toYear = parseYear(body.toYear);
    if (fromYear && toYear && toYear < fromYear) {
      return NextResponse.json({ error: 'Years are the wrong way round' }, { status: 400 });
    }
    const genreIds = Array.isArray(body.genreIds)
      ? body.genreIds.filter((g: unknown) => typeof g === 'string')
      : [];
    await addHistory(member.id, entityId, fromYear, toYear ?? fromYear, genreIds);
    await track('history_added', {
      memberId: member.id, metadata: { entity_id: entityId, created_entity: entityCreated },
    });
    return NextResponse.json({ ok: true, history: await myHistory(member.id), entityCreated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    await query(
      `delete from member_scene_history where id = $1 and member_id = $2`,
      [String(body.historyId ?? ''), member.id]
    );
    return NextResponse.json({ ok: true, history: await myHistory(member.id) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
