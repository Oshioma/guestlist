// Manage or cancel — through Stripe's Billing Portal, which is the billing
// provider's supported mechanism. Guestlist never edits card details.

import { NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { billingEnabled, getMembership } from '@/lib/membership';
import { createPortalSession, StripeError } from '@/lib/stripe';
import { track } from '@/lib/analytics';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

export async function POST() {
  try {
    if (!billingEnabled()) return NextResponse.json({ error: 'Billing is not switched on yet' }, { status: 503 });
    const member = await requireMember();
    const membership = await getMembership(member.id);
    if (!membership?.stripe_customer_id) {
      return NextResponse.json({ error: 'There is no billing account to manage for this membership' }, { status: 400 });
    }
    const session = await createPortalSession({ customerId: membership.stripe_customer_id, returnUrl: `${SITE}/you/membership` });
    await track('membership_portal_opened', { memberId: member.id });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (err instanceof AuthError || err instanceof StripeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
