// GET ME IN — from the event page, on a phone, in one press.
// The segment is [id] to match the sibling event routes.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requireActiveMember } from '@/lib/membership';
import { createAccessRequest, liveRequestFor } from '@/lib/accessRequests';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireActiveMember();
    const { id: eventId } = await ctx.params;
    const body = await req.json().catch(() => ({})) as { places?: unknown; note?: unknown };
    const outcome = await createAccessRequest(me, eventId, {
      places: Number(body.places) === 2 ? 2 : 1,
      note: typeof body.note === 'string' ? body.note : null,
    });
    const request = await liveRequestFor(me.id, eventId);
    return NextResponse.json({ ok: true, outcome: outcome.kind, request });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Could not send your request' }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireActiveMember();
    const { id: eventId } = await ctx.params;
    return NextResponse.json({ request: await liveRequestFor(me.id, eventId) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
