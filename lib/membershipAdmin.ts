// ADMIN → a paying member's money. Two things, both deliberate, both
// through Stripe, both written to the billing ledger with who and why:
//
//   cancel  — end the subscription when the paid month runs out (normal) or
//             right now (no further access). The subscription Stripe hands
//             back is applied straight away, so the site does not wait on
//             the webhook; when the webhook does arrive it applies the same
//             state again harmlessly.
//   refund  — send some or all of the last payment back. Never more than is
//             left of it: earlier refunds of the same invoice are read from
//             the ledger and subtracted.
//
// Nothing here is ever automatic. An admin presses a button, confirms, and
// the member is told in plain words.

import { AuthError } from './auth';
import { query, queryOne } from './db';
import { audit } from './audit';
import { track } from './analytics';
import { queueMemberTransactional } from './email';
import { applyStripeSubscription, formatPence, getMembership, recordBillingEvent, type Membership } from './membership';
import { cancelSubscription, createRefund, latestPaidInvoice } from './stripe';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

type Actor = { id: string; display_name: string };

async function stripeMembership(memberId: string): Promise<Membership & { stripe_subscription_id: string }> {
  const m = await getMembership(memberId);
  if (!m || m.billing_source !== 'stripe' || !m.stripe_subscription_id) {
    throw new AuthError(400, 'This membership is not billed through Stripe');
  }
  return m as Membership & { stripe_subscription_id: string };
}

async function memberEmail(memberId: string): Promise<{ email: string; display_name: string } | null> {
  return queryOne<{ email: string; display_name: string }>(`select email, display_name from members where id = $1`, [memberId]);
}

const day = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

export async function adminCancelStripeMembership(
  memberId: string, actor: Actor, opts: { when: 'period_end' | 'now'; note?: string | null }
): Promise<{ outcome: 'cancelled_now' | 'ends_at_period_end' | 'already'; endsAt: string | null }> {
  const m = await stripeMembership(memberId);
  if (m.status === 'cancelled' || m.status === 'expired') return { outcome: 'already', endsAt: m.current_period_end };
  if (opts.when === 'period_end' && m.cancel_at_period_end) return { outcome: 'already', endsAt: m.current_period_end };

  const sub = await cancelSubscription(m.stripe_subscription_id, opts.when);
  await applyStripeSubscription(memberId, sub);
  const after = await getMembership(memberId);
  const endsAt = opts.when === 'now' ? null : after?.current_period_end ?? m.current_period_end;
  await recordBillingEvent({
    stripeEventId: `admin:cancel:${sub.id}:${opts.when}:${Date.now()}`,
    type: opts.when === 'now' ? 'admin.subscription_cancelled_now' : 'admin.subscription_cancel_at_period_end',
    memberId, membershipId: m.id,
    payload: { subscription: sub.id, by: actor.id, note: opts.note ?? null, ends_at: endsAt },
  });
  await audit('membership_changed', { actorId: actor.id, detail: { memberId, action: 'stripe_cancel', when: opts.when, note: opts.note ?? null } });
  await track('membership_cancelled', { memberId, metadata: { via: 'admin', when: opts.when } });

  const who = await memberEmail(memberId);
  if (who) {
    await queueMemberTransactional({
      memberId, email: who.email, emailType: 'notification:membership_cancelled',
      subject: opts.when === 'now' ? 'Your Guestlist membership has ended' : 'Your Guestlist membership will end',
      body: opts.when === 'now'
        ? 'Your membership has been ended today and you will not be charged again. If this is a surprise, reply to this email and we will sort it out.'
        : `Your membership will not renew. You keep everything until ${day(endsAt) ?? 'the end of your paid month'}, and you will not be charged again.`,
      ctaLabel: 'YOUR MEMBERSHIP', ctaUrl: `${SITE}/you/membership`,
      dedupeKey: `membership-cancel:${memberId}:${opts.when}:${sub.id}`,
    });
  }
  return { outcome: opts.when === 'now' ? 'cancelled_now' : 'ends_at_period_end', endsAt };
}

export type RefundRecord = { id: string; amount_pence: number; currency: string; at: string; invoice: string | null };

export async function memberRefunds(memberId: string): Promise<RefundRecord[]> {
  return query<RefundRecord>(
    `select stripe_event_id as id, amount_pence, coalesce(currency, 'GBP') as currency, processed_at::text as at, payload->>'invoice' as invoice
       from membership_billing_events
      where member_id = $1 and event_type = 'admin.refund' and amount_pence is not null
      order by processed_at desc`,
    [memberId]
  );
}

export async function adminRefundLastPayment(
  memberId: string, actor: Actor, opts: { amountPence?: number | null; note?: string | null }
): Promise<{ refundId: string; amountPence: number; currency: string; remainingPence: number; invoice: string }> {
  const m = await stripeMembership(memberId);
  const invoice = await latestPaidInvoice(m.stripe_subscription_id);
  if (!invoice) throw new AuthError(404, 'No paid invoice to refund yet');
  if (!invoice.payment_intent && !invoice.charge) throw new AuthError(400, 'Stripe has no payment on that invoice to refund');

  const already = await queryOne<{ n: number }>(
    `select coalesce(sum(amount_pence), 0)::int as n from membership_billing_events
      where member_id = $1 and event_type = 'admin.refund' and payload->>'invoice' = $2`,
    [memberId, invoice.id]
  );
  const remaining = invoice.amount_paid - (already?.n ?? 0);
  if (remaining <= 0) throw new AuthError(409, 'That payment has already been refunded in full');
  const requested = opts.amountPence == null ? remaining : Math.floor(opts.amountPence);
  if (!Number.isFinite(requested) || requested <= 0) throw new AuthError(400, 'Enter an amount to refund');
  if (requested > remaining) throw new AuthError(400, `Only ${formatPence(remaining, invoice.currency.toUpperCase())} of that payment is left to refund`);

  const refund = await createRefund({
    paymentIntent: invoice.payment_intent, charge: invoice.charge, amountPence: requested,
    idempotencyKey: `refund:${invoice.id}:${already?.n ?? 0}:${requested}`,
    reason: 'requested_by_customer',
  });
  const currency = (refund.currency ?? invoice.currency).toUpperCase();
  await recordBillingEvent({
    stripeEventId: `refund:${refund.id}`, type: 'admin.refund', memberId, membershipId: m.id,
    amountPence: refund.amount, currency,
    payload: { refund: refund.id, invoice: invoice.id, payment_intent: invoice.payment_intent, by: actor.id, note: opts.note ?? null, status: refund.status },
  });
  await audit('membership_changed', { actorId: actor.id, detail: { memberId, action: 'stripe_refund', refundId: refund.id, amountPence: refund.amount, invoice: invoice.id, note: opts.note ?? null } });

  const who = await memberEmail(memberId);
  if (who) {
    await queueMemberTransactional({
      memberId, email: who.email, emailType: 'notification:membership_refund',
      subject: `We’ve refunded ${formatPence(refund.amount, currency)}`,
      body: `${formatPence(refund.amount, currency)} is on its way back to the card you paid with. Banks usually show it within 5–10 days. Your membership itself has not changed unless we have told you separately.`,
      ctaLabel: 'YOUR MEMBERSHIP', ctaUrl: `${SITE}/you/membership`,
      dedupeKey: `membership-refund:${refund.id}`,
    });
  }
  return { refundId: refund.id, amountPence: refund.amount, currency, remainingPence: remaining - refund.amount, invoice: invoice.id };
}
