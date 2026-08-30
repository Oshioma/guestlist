// IS THIS YOUR EVENT? — a verified promoter claims association with an
// unowned event. Strong domain evidence (event source/ticket domain matches
// the promoter's official website) auto-approves; anything else waits for
// admin review. No promoter can grab an event another promoter owns.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { domainOf, requirePromoterRole } from '@/lib/promoterAuth';
import { audit } from '@/lib/audit';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member, promoter } = await requirePromoterRole(id, 'editor');
    const body = await req.json().catch(() => ({}));
    const eventId = String(body.eventId ?? '');
    const evidence = String(body.evidence ?? '').trim() || null;

    const event = await queryOne<{
      id: string; promoter_id: string | null; source_url: string | null;
      canonical_url: string | null; ticket_url: string | null; title: string;
    }>(
      `select id, promoter_id, source_url, canonical_url, ticket_url, title
         from events where id = $1 and status <> 'rejected'`,
      [eventId]
    );
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.promoter_id === promoter.id) {
      return NextResponse.json({ error: 'This is already your event' }, { status: 409 });
    }
    if (event.promoter_id) {
      return NextResponse.json(
        { error: 'This event is already associated with a promoter — contact Guestlist' },
        { status: 409 }
      );
    }
    const existing = await queryOne<{ status: string }>(
      `select status from event_claims where event_id = $1 and promoter_id = $2`,
      [eventId, id]
    );
    if (existing) {
      return NextResponse.json({ error: `You already have a ${existing.status} claim on this event` }, { status: 409 });
    }

    const promoterDomain = domainOf(promoter.website);
    const eventDomains = [event.source_url, event.canonical_url, event.ticket_url]
      .map((u) => domainOf(u))
      .filter(Boolean);
    const autoApprove = !!promoterDomain && eventDomains.includes(promoterDomain);

    await query(
      `insert into event_claims (event_id, promoter_id, member_id, status, evidence, auto_approved, decided_at)
       values ($1, $2, $3, $4, $5, $6, case when $6 then now() end)`,
      [eventId, id, member.id, autoApprove ? 'approved' : 'pending', evidence, autoApprove]
    );
    if (autoApprove) {
      await query(`update events set promoter_id = $2, updated_at = now() where id = $1`, [eventId, id]);
    }
    await audit('event_claimed', {
      actorId: member.id, promoterId: id, eventId,
      detail: { autoApproved: autoApprove, evidence },
    });

    return NextResponse.json({
      ok: true,
      status: autoApprove ? 'approved' : 'pending',
      message: autoApprove
        ? 'Matched via your official website — the event is now linked to you.'
        : 'Claim received — Guestlist will review it.',
    }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
