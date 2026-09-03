// Promoter dashboard → Guestlist members asking for your events.
//
//   GET   the open asks for this promoter's upcoming events
//   POST  { action: 'guestlist' | 'cant', requestId }
//
// "guestlist" puts the member on the real door list and sends their pass;
// "cant" hands the request back to the Guestlist desk, which may still
// find another way in. Editors and up.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requirePromoterRole } from '@/lib/promoterAuth';
import { promoterActOnRequest, promoterOpenAsks } from '@/lib/accessRequests';

function fail(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { promoter } = await requirePromoterRole(id, 'analyst');
    return NextResponse.json({ asks: await promoterOpenAsks(promoter.id) });
  } catch (err) { return fail(err); }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member, promoter } = await requirePromoterRole(id, 'editor');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action === 'guestlist' ? 'guestlist' : body.action === 'cant' ? 'cant' : null;
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    if (!action || !requestId) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    const result = await promoterActOnRequest({ id: promoter.id, name: promoter.name }, { id: member.id, display_name: member.display_name }, requestId, action);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) { return fail(err); }
}
