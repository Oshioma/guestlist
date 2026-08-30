// Follow / unfollow a promoter, venue, or artist. Uses the member_follows
// relationship created in V1 — this signal feeds For You ranking.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const TABLES: Record<string, string> = { promoter: 'promoters', venue: 'venues', artist: 'artists' };

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    const entityType = String(body.entityType ?? '');
    const entityId = String(body.entityId ?? '');
    const follow = body.follow !== false;

    const table = TABLES[entityType];
    if (!table) return NextResponse.json({ error: 'Unknown entity type' }, { status: 400 });
    const exists = await queryOne(`select 1 from ${table} where id = $1`, [entityId]);
    if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (follow) {
      await query(
        `insert into member_follows (member_id, entity_type, entity_id)
         values ($1, $2, $3) on conflict do nothing`,
        [member.id, entityType, entityId]
      );
    } else {
      await query(
        `delete from member_follows where member_id = $1 and entity_type = $2 and entity_id = $3`,
        [member.id, entityType, entityId]
      );
    }
    const count = await queryOne<{ n: number }>(
      `select count(*)::int as n from member_follows where entity_type = $1 and entity_id = $2`,
      [entityType, entityId]
    );
    return NextResponse.json({ ok: true, following: follow, followers: count?.n ?? 0 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
