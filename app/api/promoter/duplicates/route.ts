// Promoter duplicate resolution: verified promoter teams flag duplicate
// representations of their own events. Safe actions only — destructive
// merges stay with Guestlist admins.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { requirePromoterRole } from '@/lib/promoterAuth';
import { audit } from '@/lib/audit';

const ACTIONS = ['same_event', 'link_source', 'keep_both', 'request_merge'];

export async function GET(req: NextRequest) {
  try {
    const member = await requireMember();
    const promoterId = req.nextUrl.searchParams.get('promoterId') ?? '';
    await requirePromoterRole(promoterId, 'editor');
    const requests = await query(
      `select r.id, r.action, r.status, r.note, r.created_at::text,
              e1.title as event_title, e2.title as duplicate_title
         from event_duplicate_requests r
         join events e1 on e1.id = r.event_id
         join events e2 on e2.id = r.duplicate_of_event_id
        where r.promoter_id = $1
        order by r.created_at desc limit 50`,
      [promoterId]
    );
    return NextResponse.json({ requests });
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
    const promoterId = String(body.promoterId ?? '');
    await requirePromoterRole(promoterId, 'editor');
    const action = String(body.action ?? '');
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    const eventId = String(body.eventId ?? '');
    const duplicateOf = String(body.duplicateOfEventId ?? '');
    // At least one of the pair must belong to this promoter.
    const owns = await queryOne(
      `select 1 from events where id in ($1, $2) and promoter_id = $3`,
      [eventId, duplicateOf, promoterId]
    );
    if (!owns) return NextResponse.json({ error: 'Not your event' }, { status: 403 });
    const both = await query(`select id from events where id in ($1, $2)`, [eventId, duplicateOf]);
    if (both.length !== 2) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const row = await queryOne<{ id: string }>(
      `insert into event_duplicate_requests
         (promoter_id, requested_by, event_id, duplicate_of_event_id, action, note,
          status)
       values ($1, $2, $3, $4, $5, $6,
               case when $5 = 'keep_both' then 'approved' else 'pending' end)
       returning id`,
      [promoterId, member.id, eventId, duplicateOf, action,
       typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null]
    );
    // keep_both is safe: clear any dedupe flag between the pair right away.
    if (action === 'keep_both') {
      await query(
        `update events set possible_duplicate_of = null
          where id in ($1, $2) and possible_duplicate_of in ($1, $2)`,
        [eventId, duplicateOf]
      );
    }
    await audit('event_reported', {
      actorId: member.id, promoterId, eventId,
      detail: { duplicate_request: row!.id, action },
    });
    return NextResponse.json({ ok: true, requestId: row!.id });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
