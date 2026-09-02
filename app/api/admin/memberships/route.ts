// GRANT MEMBERSHIP — and take it back. DJs, promoters, journalists, partners,
// competition winners: ours to give without a card. Stripe subscriptions are
// never touched here; those end through Stripe and arrive by webhook.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { grantMembership, revokeMembership, type BillingSource } from '@/lib/membership';

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
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
