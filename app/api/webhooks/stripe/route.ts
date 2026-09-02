// Stripe → Guestlist. The only way a paid membership changes state.
//
// Verified against the RAW body with the endpoint secret; recorded in an
// append-only ledger keyed by Stripe's event id so a replay is a no-op;
// applied to `memberships`, which every gated action reads afresh.
//
// Handled: checkout.session.completed, customer.subscription.created /
// updated / deleted, invoice.paid, invoice.payment_failed. Anything else
// is acknowledged and ignored (Stripe retries on non-2xx, so we only
// return an error when WE failed, never for an event we do not care about).

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import {
  applyStripeSubscription, getMembership, memberIdForStripeCustomer, recordBillingEvent, rememberStripeCustomer,
} from '@/lib/membership';
import { getSubscription, verifyWebhookSignature, type StripeSubscription } from '@/lib/stripe';
import { track } from '@/lib/analytics';
import { queueMemberTransactional } from '@/lib/email';
import { welcomeNewMember } from '@/lib/membershipWelcome';

export const runtime = 'nodejs';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

async function resolveMember(obj: Record<string, unknown>): Promise<string | null> {
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  if (meta.member_id) return meta.member_id;
  if (typeof obj.client_reference_id === 'string') return obj.client_reference_id;
  const customer = typeof obj.customer === 'string' ? obj.customer : null;
  if (customer) return memberIdForStripeCustomer(customer);
  return null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
  }
  if (!event?.id || !event?.type) return NextResponse.json({ error: 'Bad payload' }, { status: 400 });

  try {
    const obj = event.data?.object ?? {};
    const memberId = await resolveMember(obj);

    // Ledger first: if this id has been seen, the work is already done.
    const fresh = await recordBillingEvent({
      stripeEventId: event.id,
      type: event.type,
      memberId,
      amountPence: typeof obj.amount_paid === 'number' ? obj.amount_paid : typeof obj.amount_due === 'number' ? obj.amount_due : null,
      currency: typeof obj.currency === 'string' ? obj.currency.toUpperCase() : null,
      payload: { id: obj.id, customer: obj.customer, subscription: obj.subscription, status: obj.status },
    });
    if (!fresh) return NextResponse.json({ ok: true, duplicate: true });

    switch (event.type) {
      case 'checkout.session.completed': {
        if (!memberId) break;
        const customer = typeof obj.customer === 'string' ? obj.customer : null;
        if (customer) await rememberStripeCustomer(memberId, customer);
        const subId = typeof obj.subscription === 'string' ? obj.subscription : null;
        if (subId) {
          const sub = await getSubscription(subId);
          const change = await applyStripeSubscription(memberId, sub);
          if (change.after === 'active' || change.after === 'trialing') {
            if (change.before !== 'active' && change.before !== 'trialing') {
              await track('membership_started', { memberId, metadata: { via: 'checkout' } });
              await welcomeNewMember(memberId);
            }
          }
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        if (!memberId) break;
        const sub = obj as unknown as StripeSubscription;
        const change = await applyStripeSubscription(memberId, sub);
        const nowMember = change.after === 'active' || change.after === 'trialing';
        const wasMember = change.before === 'active' || change.before === 'trialing';
        if (nowMember && !wasMember) {
          await track('membership_started', { memberId, metadata: { via: event.type } });
          await welcomeNewMember(memberId);
        } else if (change.after === 'cancelled' && change.before !== 'cancelled') {
          await track('membership_cancelled', { memberId });
        } else if (change.after === 'expired' && change.before !== 'expired') {
          await track('membership_expired', { memberId });
        } else if (change.after === 'past_due' && change.before !== 'past_due') {
          await track('membership_payment_failed', { memberId });
        }
        break;
      }
      case 'invoice.paid': {
        if (!memberId) break;
        const subId = typeof obj.subscription === 'string' ? obj.subscription : null;
        if (subId) await applyStripeSubscription(memberId, await getSubscription(subId));
        const reason = typeof obj.billing_reason === 'string' ? obj.billing_reason : '';
        await track(reason === 'subscription_create' ? 'membership_started' : 'membership_renewed',
          { memberId, metadata: { amount_pence: obj.amount_paid ?? null, reason } });
        break;
      }
      case 'invoice.payment_failed': {
        if (!memberId) break;
        const subId = typeof obj.subscription === 'string' ? obj.subscription : null;
        if (subId) await applyStripeSubscription(memberId, await getSubscription(subId));
        await track('membership_payment_failed', { memberId });
        const m = await queryOne<{ email: string }>(`select email from members where id = $1`, [memberId]);
        const membership = await getMembership(memberId);
        if (m && membership?.stripe_customer_id) {
          await queueMemberTransactional({
            memberId, email: m.email,
            emailType: 'notification:membership_payment',
            subject: 'Your Guestlist membership payment didn’t go through',
            body: 'No drama — update your card and everything carries on. Your benefits stay on while we retry.',
            ctaLabel: 'UPDATE PAYMENT', ctaUrl: `${SITE}/you/membership`,
            dedupeKey: `membership-payment-failed:${event.id}`,
          });
        }
        break;
      }
      default:
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('stripe webhook failed', event.type, err);
    // Let Stripe retry: our ledger row exists, so the retry will be treated
    // as a duplicate unless we clear it. Clear it so the retry re-applies.
    await queryOne(`delete from membership_billing_events where stripe_event_id = $1 returning id`, [event.id]).catch(() => null);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
