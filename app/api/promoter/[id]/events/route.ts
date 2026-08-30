// Verified promoters create their own events. High-authority but not
// unrestricted: dates validated, URLs sanitised, duplicates still flagged
// (a flagged event goes to review rather than publishing).

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requirePromoterRole } from '@/lib/promoterAuth';
import { createEvent, validateEventInput, type EventInput } from '@/lib/adminEvents';
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member, promoter } = await requirePromoterRole(id, 'editor');
    const body = (await req.json().catch(() => ({}))) as EventInput;

    const input: EventInput = {
      ...body,
      // Ownership is forced server-side — a promoter creates only their own
      // events, and curation flags stay with Guestlist.
      promoterId: promoter.id,
      featured: false,
      worthTravelling: false,
      ticketUrl: sanitizeHttpUrl(body.ticketUrl),
      primaryImageUrl: sanitizeHttpUrl(body.primaryImageUrl),
      sourceUrl: sanitizeHttpUrl(body.sourceUrl),
      // Verified promoter events publish directly when clean; createEvent
      // downgrades to needs_review when a duplicate is suspected.
      status: 'live',
    };
    const problem = validateEventInput(input);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const result = await createEvent(input, member.id);
    await audit('event_created', {
      actorId: member.id, promoterId: promoter.id, eventId: result.id,
      detail: { status: result.status, possibleDuplicateOf: result.possibleDuplicateOf },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
