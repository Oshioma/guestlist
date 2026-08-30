// Club Messenger housekeeping: presence is temporal data, so old rows are
// closed out and eventually deleted. Call daily from cron:
//
//   0 6 * * *  curl -s -X POST https://guestlist.net/api/jobs/club-cleanup \
//                -H "Authorization: Bearer $SUPPLY_CRON_SECRET"
//
// Expired-but-open rows are already invisible everywhere (every query
// checks expires_at), so this job is hygiene, not a security boundary.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';

function secretMatches(header: string | null): boolean {
  const secret = process.env.SUPPLY_CRON_SECRET;
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get('authorization'))) {
    const member = await getCurrentMember();
    if (member?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  const closed = await query<{ id: string }>(
    `update event_presence set left_at = expires_at, updated_at = now()
      where left_at is null and expires_at < now() returning id`
  );
  const oldPresence = await query<{ id: string }>(
    `delete from event_presence where arrived_at < now() - interval '30 days' returning id`
  );
  const oldMessages = await query<{ id: string }>(
    `delete from event_room_messages
      where created_at < now() - interval '30 days' and report_count = 0 returning id`
  );
  const oldPings = await query<{ id: string }>(
    `delete from club_pings where created_at < now() - interval '30 days' returning id`
  );
  const oldNotifications = await query<{ id: string }>(
    `delete from notifications where created_at < now() - interval '60 days' returning id`
  );
  return NextResponse.json({
    ok: true,
    closed: closed.length,
    deleted: {
      presence: oldPresence.length,
      messages: oldMessages.length,
      pings: oldPings.length,
      notifications: oldNotifications.length,
    },
  });
}
