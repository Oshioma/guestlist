// A member withdrawing their own GET ME IN request.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { cancelAccessRequest } from '@/lib/accessRequests';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({})) as { action?: unknown };
    if (body.action !== 'cancel') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    const ok = await cancelAccessRequest(member.id, id);
    return NextResponse.json({ ok });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
