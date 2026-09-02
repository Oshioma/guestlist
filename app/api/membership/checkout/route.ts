// JOIN GUESTLIST — start a Stripe Checkout for the monthly membership.
// Only reachable once billing is switched on; before that the membership
// page collects a waitlist instead.

import { NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { billingEnabled, getMembership, getPlan, membershipIsActive, sellablePriceId } from '@/lib/membership';
import { createCheckoutSession, StripeError } from '@/lib/stripe';
import { track } from '@/lib/analytics';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

export async function POST() {
  try {
    if (!billingEnabled()) return NextResponse.json({ error: 'Membership opens soon — join the waitlist' }, { status: 503 });
    const member = await requireMember();
    const membership = await getMembership(member.id);
    if (membershipIsActive(membership)) return NextResponse.json({ url: `${SITE}/you/membership`, already: true });
    const plan = await getPlan();
    const priceId = plan ? await sellablePriceId(plan) : null;
    if (!plan || !priceId) return NextResponse.json({ error: 'Membership price is not configured' }, { status: 503 });

    const session = await createCheckoutSession({
      priceId,
      memberId: member.id,
      email: member.email,
      customerId: membership?.stripe_customer_id ?? null,
      successUrl: `${SITE}/membership/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${SITE}/membership?cancelled=1`,
    });
    await track('membership_checkout_started', { memberId: member.id, metadata: { plan: plan.code } });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (err instanceof AuthError || err instanceof StripeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
