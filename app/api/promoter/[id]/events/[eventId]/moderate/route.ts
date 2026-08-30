// Event lifecycle actions for a promoter's own events:
//   confirm  — approve an extracted draft (import queue) → publishes unless
//              a duplicate flag stands (that stays with Guestlist admin)
//   ignore   — reject an extracted draft
//   cancel / sold_out / postpone / restore — listing state changes
//   report   — "this event is wrong": duplicate / wrong_promoter flags for
//              admin, with an audit trail

import { NextRequest, NextResponse } from 'next/server';
import { onEventPublished } from '@/lib/alerts';
import { AuthError } from '@/lib/auth';
import { query } from '@/lib/db';
import { requireOwnEvent, requirePromoterRole } from '@/lib/promoterAuth';
import { audit, notifyPromoter } from '@/lib/audit';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const { id, eventId } = await ctx.params;
    const { member, promoter } = await requirePromoterRole(id, 'editor');
    const event = await requireOwnEvent(promoter.id, eventId);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const note = String(body.note ?? '').trim() || null;

    switch (action) {
      case 'confirm': {
        if (event.status === 'live') return NextResponse.json({ ok: true, status: 'live' });
        const dup = await query<{ possible_duplicate_of: string | null }>(
          `select possible_duplicate_of from events where id = $1`, [eventId]
        );
        if (dup[0]?.possible_duplicate_of) {
          // Duplicate resolution stays with Guestlist admin.
          await audit('event_confirmed', {
            actorId: member.id, promoterId: promoter.id, eventId,
            detail: { blocked: 'possible_duplicate' },
          });
          return NextResponse.json(
            { ok: false, error: 'This looks like a duplicate — Guestlist is reviewing it.', status: event.status },
            { status: 409 }
          );
        }
        await query(
          `update events set status = 'live', published_at = coalesce(published_at, now()), updated_at = now()
            where id = $1`,
          [eventId]
        );
        await audit('event_confirmed', { actorId: member.id, promoterId: promoter.id, eventId });
        await notifyPromoter(promoter.id, 'event_published', { eventId });
        void onEventPublished(eventId);
        return NextResponse.json({ ok: true, status: 'live' });
      }
      case 'ignore': {
        if (event.status === 'live') {
          return NextResponse.json({ error: 'Unpublish is a Guestlist admin action — use cancel instead' }, { status: 400 });
        }
        await query(`update events set status = 'rejected', updated_at = now() where id = $1`, [eventId]);
        await audit('event_ignored', { actorId: member.id, promoterId: promoter.id, eventId });
        return NextResponse.json({ ok: true, status: 'rejected' });
      }
      case 'cancel':
      case 'sold_out':
      case 'postpone':
      case 'restore': {
        const listing =
          action === 'cancel' ? 'cancelled' : action === 'sold_out' ? 'sold_out'
          : action === 'postpone' ? 'postponed' : 'confirmed';
        await query(
          `update events set listing_status = $2, updated_at = now() where id = $1`,
          [eventId, listing]
        );
        await audit(
          action === 'cancel' ? 'event_cancelled' : action === 'sold_out' ? 'event_sold_out' : 'event_restored',
          { actorId: member.id, promoterId: promoter.id, eventId, detail: { listing, note } }
        );
        return NextResponse.json({ ok: true, listingStatus: listing });
      }
      case 'report_duplicate':
      case 'report_wrong_promoter': {
        if (action === 'report_wrong_promoter') {
          // Detach and send back to review — never silently reassign.
          await query(
            `update events set promoter_id = null, status = case when status = 'live' then 'needs_review'::event_status else status end,
                    updated_at = now() where id = $1`,
            [eventId]
          );
        } else {
          await query(
            `update events set status = 'needs_review', updated_at = now() where id = $1`,
            [eventId]
          );
        }
        await audit('event_reported', {
          actorId: member.id, promoterId: promoter.id, eventId,
          detail: { kind: action, note },
        });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
