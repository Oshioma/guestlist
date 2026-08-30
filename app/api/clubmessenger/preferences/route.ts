// Notification preferences. Defaults with no row: friend_arrivals ON,
// pings ON, room_messages OFF (room chatter is opt-in only).

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { AuthError, requireMember } from '@/lib/auth';

type Prefs = { friend_arrivals: boolean; pings: boolean; room_messages: boolean };
const DEFAULTS: Prefs = { friend_arrivals: true, pings: true, room_messages: false };

export async function GET() {
  try {
    const member = await requireMember();
    const row = await queryOne<Prefs>(
      `select friend_arrivals, pings, room_messages
         from notification_preferences where member_id = $1`,
      [member.id]
    );
    return NextResponse.json({ preferences: row ?? DEFAULTS });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    const current =
      (await queryOne<Prefs>(
        `select friend_arrivals, pings, room_messages
           from notification_preferences where member_id = $1`,
        [member.id]
      )) ?? DEFAULTS;
    const next: Prefs = {
      friend_arrivals:
        typeof body.friend_arrivals === 'boolean' ? body.friend_arrivals : current.friend_arrivals,
      pings: typeof body.pings === 'boolean' ? body.pings : current.pings,
      room_messages:
        typeof body.room_messages === 'boolean' ? body.room_messages : current.room_messages,
    };
    await query(
      `insert into notification_preferences (member_id, friend_arrivals, pings, room_messages)
       values ($1, $2, $3, $4)
       on conflict (member_id) do update set
         friend_arrivals = $2, pings = $3, room_messages = $4, updated_at = now()`,
      [member.id, next.friend_arrivals, next.pings, next.room_messages]
    );
    return NextResponse.json({ ok: true, preferences: next });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
