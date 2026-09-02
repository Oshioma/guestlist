// ASK GUESTLIST — any event, anywhere; +1s; sold-out help; recommendations.
// Active members only. Links are stored, never fetched here.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requireActiveMember } from '@/lib/membership';
import { createAskRequest, friendlyState, type AskInput } from '@/lib/accessRequests';
import { queryOne } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const me = await requireActiveMember();
    const body = await req.json().catch(() => ({})) as AskInput;
    const out = await createAskRequest(me, body);
    const row = await queryOne<{ status: string; member_message: string | null; entry_status: string | null; slug: string | null }>(
      `select r.status, r.member_message, g.status as entry_status, e.slug
         from member_access_requests r
         left join event_guestlist_entries g on g.id = r.guestlist_entry_id
         left join events e on e.id = r.event_id
        where r.id = $1`, [out.requestId]);
    return NextResponse.json({
      ok: true,
      kind: out.kind,
      requestId: out.requestId,
      matched: out.kind === 'requested' ? out.matched?.confidence ?? null : 'url',
      eventSlug: row?.slug ?? null,
      friendly: row ? friendlyState(row.status as never, row.member_message, row.entry_status) : null,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Could not send your request' }, { status: 500 });
  }
}
