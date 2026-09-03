// GRANT MEMBERSHIP — and take it back. DJs, promoters, journalists, partners,
// competition winners: ours to give without a card.
//
// Paying members are handled through Stripe, deliberately, one press at a
// time: cancel_stripe (at the end of the paid month, or now) and refund
// (some or all of the last payment). Both audited; neither automatic.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { grantMembership, revokeMembership, type BillingSource } from '@/lib/membership';
import { adminCancelStripeMembership, adminRefundLastPayment } from '@/lib/membershipAdmin';
import { StripeError } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const target = typeof body.memberId === 'string'
      ? await queryOne<{ id: string }>(`select id from members where id = $1`, [body.memberId])
      : typeof body.email === 'string'
        ? await queryOne<{ id: string }>(`select id from members where lower(email) = lower($1)`, [body.email.trim()])
        : null;
    if (!target) return NextResponse.json({ error: 'No Guestlist account with that email' }, { status: 404 });

    if (action === 'grant') {
      const source = (['complimentary', 'lifetime', 'manual'] as const).find((s) => s === body.source) ?? 'complimentary';
      const expires = typeof body.expiresAt === 'string' && body.expiresAt && !Number.isNaN(Date.parse(body.expiresAt))
        ? new Date(body.expiresAt) : null;
      if (expires && expires.getTime() < Date.now()) return NextResponse.json({ error: 'Expiry is in the past' }, { status: 400 });
      await grantMembership(target.id, admin.id, {
        source: source as Exclude<BillingSource, 'stripe'>,
        expiresAt: expires,
        note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null,
      });
      return NextResponse.json({ ok: true });
    }
    if (action === 'revoke') {
      const ok = await revokeMembership(target.id, admin.id, typeof body.note === 'string' ? body.note : null);
      if (!ok) return NextResponse.json({ error: 'This membership is billed through Stripe — cancel it there' }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (action === 'cancel_stripe') {
      const when = body.when === 'now' ? 'now' : 'period_end';
      const result = await adminCancelStripeMembership(target.id, admin, { when, note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === 'refund') {
      const amount = body.amountPence == null || body.amountPence === '' ? null : Number(body.amountPence);
      if (amount != null && (!Number.isFinite(amount) || amount <= 0)) return NextResponse.json({ error: 'Enter an amount in pence, or leave blank for the full payment' }, { status: 400 });
      const result = await adminRefundLastPayment(target.id, admin, { amountPence: amount, note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null });
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof StripeError) return NextResponse.json({ error: err.status === 503 ? err.message : `Stripe said: ${err.message}` }, { status: err.status === 503 ? 503 : err.status >= 500 ? 502 : err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
