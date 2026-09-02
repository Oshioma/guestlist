// The GET ME IN desk: every action on one request. Admin only, audited.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { adminActOnRequest, type AdminAction, type AdminActionBody } from '@/lib/accessRequests';

const ACTIONS: AdminAction[] = [
  'reviewing', 'contact_promoter', 'log_outreach', 'confirm_free', 'offer_discount',
  'purchase', 'waitlist', 'decline', 'attended', 'note', 'reopen', 'cancel',
  'link_event', 'import_event', 'assign_promoter', 'message_member', 'answer',
];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({})) as AdminActionBody & { action?: string };
    const action = ACTIONS.find((a) => a === body.action);
    if (!action) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    const result = await adminActOnRequest(id, admin, action, body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
