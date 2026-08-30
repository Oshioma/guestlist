// Edit an owned event (editor+). The event must belong to this promoter —
// checked server-side — and promoters cannot touch Guestlist curation
// fields (featured, worth_travelling) or moderation status directly;
// lifecycle changes go through the /moderate route.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requireOwnEvent, requirePromoterRole } from '@/lib/promoterAuth';
import { updateEvent, validateEventInput, type EventInput } from '@/lib/adminEvents';
import { queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

function sanitizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const PROMOTER_EDITABLE = new Set([
  'title', 'shortDescription', 'description', 'startAt', 'endAt', 'timezone',
  'venueId', 'city', 'country', 'latitude', 'longitude', 'eventType',
  'ticketUrl', 'priceFrom', 'priceTo', 'currency', 'primaryImageUrl',
  'genreSlugs', 'lineup',
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const { id, eventId } = await ctx.params;
    const { member, promoter } = await requirePromoterRole(id, 'editor');
    const event = await requireOwnEvent(promoter.id, eventId);

    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input: Partial<EventInput> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (PROMOTER_EDITABLE.has(k)) (input as Record<string, unknown>)[k] = v;
    }
    if ('ticketUrl' in input) input.ticketUrl = sanitizeHttpUrl(input.ticketUrl);
    if ('primaryImageUrl' in input) input.primaryImageUrl = sanitizeHttpUrl(input.primaryImageUrl);

    if (input.title !== undefined || input.startAt !== undefined || input.endAt !== undefined) {
      const existing = await queryOne<{ title: string; start_at: string; event_type: string; timezone: string }>(
        `select title, start_at, event_type, timezone from events where id = $1`, [eventId]
      );
      const problem = validateEventInput({
        title: input.title ?? existing!.title,
        startAt: input.startAt ?? existing!.start_at,
        endAt: input.endAt ?? undefined,
        timezone: input.timezone ?? existing!.timezone,
        eventType: input.eventType ?? existing!.event_type,
        priceFrom: input.priceFrom,
        priceTo: input.priceTo,
      });
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const rescheduled = input.startAt !== undefined;
    const result = await updateEvent(eventId, input);
    if (!result.ok) return NextResponse.json({ error: 'Update failed' }, { status: 400 });

    await audit(rescheduled ? 'event_rescheduled' : 'event_edited', {
      actorId: member.id, promoterId: promoter.id, eventId,
      detail: { fields: Object.keys(input), was: event.listing_status },
    });
    if (rescheduled && event.listing_status === 'postponed') {
      const { query } = await import('@/lib/db');
      await query(`update events set listing_status = 'rescheduled' where id = $1`, [eventId]);
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
