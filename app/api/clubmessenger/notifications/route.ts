// In-app notifications: list + mark read. Notifications are created
// server-side only (arrival, ping, room message), never from the client.

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { AuthError, requireMember } from '@/lib/auth';

export async function GET() {
  try {
    const member = await requireMember();
    const notifications = await query(
      `select n.id, n.type, n.created_at::text, n.read_at::text,
              n.event_id, e.title as event_title, e.slug as event_slug,
              n.actor_member_id, a.display_name as actor_name, a.avatar_url as actor_avatar
         from notifications n
         left join events e on e.id = n.event_id
         left join members a on a.id = n.actor_member_id
        where n.member_id = $1
        order by n.created_at desc
        limit 30`,
      [member.id]
    );
    return NextResponse.json({ notifications });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    if (body.markAllRead === true) {
      await query(
        `update notifications set read_at = now() where member_id = $1 and read_at is null`,
        [member.id]
      );
    } else if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((v: unknown) => typeof v === 'string').slice(0, 100);
      if (ids.length) {
        await query(
          `update notifications set read_at = now()
            where member_id = $1 and id = any($2) and read_at is null`,
          [member.id, ids]
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
