// Stripe, the way this codebase talks to Resend: one provider boundary, plain
// fetch, no SDK. Three things cross it — a Checkout session to start paying,
// a Billing Portal session to manage or cancel, and signed webhooks coming
// back. Everything else about a membership is decided from our own database.
//
// Without STRIPE_SECRET_KEY nothing here is reachable: the membership page
// shows COMING SOON and collects a waitlist instead.

import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.stripe.com/v1';
// Pinned so the shape of subscription objects does not shift under us.
const API_VERSION = '2024-06-20';

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function stripePriceId(): string | null {
  return process.env.STRIPE_PRICE_MEMBERSHIP_MONTHLY || null;
}

export class StripeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Stripe takes application/x-www-form-urlencoded with bracketed nesting
// (metadata[member_id]=…). Flatten a small object into that.
function encode(params: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') out.push(...encode(item as Record<string, unknown>, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      out.push(...encode(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

export async function stripeRequest<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, unknown> = {},
  opts: { idempotencyKey?: string } = {}
): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError(503, 'Payments are not switched on yet');
  const body = encode(params).join('&');
  const url = method === 'GET' && body ? `${API}${path}?${body}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': API_VERSION,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
    },
    ...(method === 'POST' ? { body } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new StripeError(res.status, data.error?.message ?? `Stripe ${res.status}`);
  }
  return data;
}

// --- Objects we read -------------------------------------------------------

export type StripeSubscription = {
  id: string;
  customer: string;
  status: 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  metadata?: Record<string, string>;
  items?: { data: { price?: { id: string }; current_period_end?: number; current_period_start?: number }[] };
};

export async function getSubscription(id: string): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`);
}

// Stripe's Managed Payments (Stripe as merchant of record, collecting tax
// on our behalf) is switched on by default for newer accounts and refuses
// any product without a tax code. Guestlist is the merchant here: our own
// database is the source of truth, the webhook expects a plain subscription,
// and receipts and refunds are ours. So it is off unless deliberately
// turned on — and then the product needs a tax code in Stripe.
export function managedPaymentsEnabled(): boolean {
  return /^(1|true|yes)$/i.test((process.env.STRIPE_MANAGED_PAYMENTS ?? '').trim());
}

export async function createCheckoutSession(opts: {
  priceId: string;
  memberId: string;
  email: string;
  customerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  return stripeRequest<{ id: string; url: string }>('POST', '/checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    client_reference_id: opts.memberId,
    ...(opts.customerId ? { customer: opts.customerId } : { customer_email: opts.email }),
    allow_promotion_codes: true,
    metadata: { member_id: opts.memberId },
    subscription_data: { metadata: { member_id: opts.memberId } },
    ...(managedPaymentsEnabled() ? {} : { managed_payments: { enabled: false } }),
  });
}

// --- Admin actions on a subscription ---------------------------------------

// Stripe's own two ways to stop a subscription: flag it to end when the paid
// period runs out, or end it this second.
export async function cancelSubscription(id: string, when: 'period_end' | 'now'): Promise<StripeSubscription> {
  return when === 'now'
    ? stripeRequest<StripeSubscription>('DELETE', `/subscriptions/${encodeURIComponent(id)}`)
    : stripeRequest<StripeSubscription>('POST', `/subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: true });
}

export type StripeInvoice = {
  id: string; amount_paid: number; currency: string; created: number;
  payment_intent: string | null; charge: string | null; status: string;
};

export async function latestPaidInvoice(subscriptionId: string): Promise<StripeInvoice | null> {
  const res = await stripeRequest<{ data: StripeInvoice[] }>('GET', '/invoices', { subscription: subscriptionId, status: 'paid', limit: 1 });
  return res.data?.[0] ?? null;
}

export type StripeRefund = { id: string; amount: number; currency: string; status: string; payment_intent: string | null; charge: string | null };

export async function createRefund(opts: { paymentIntent?: string | null; charge?: string | null; amountPence: number; idempotencyKey: string; reason?: string }): Promise<StripeRefund> {
  return stripeRequest<StripeRefund>('POST', '/refunds', {
    ...(opts.paymentIntent ? { payment_intent: opts.paymentIntent } : { charge: opts.charge }),
    amount: opts.amountPence,
    ...(opts.reason ? { reason: opts.reason } : {}),
  }, { idempotencyKey: opts.idempotencyKey });
}

export async function createPortalSession(opts: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
  return stripeRequest<{ url: string }>('POST', '/billing_portal/sessions', {
    customer: opts.customerId,
    return_url: opts.returnUrl,
  });
}

// --- Webhooks --------------------------------------------------------------

// Stripe signs `${timestamp}.${rawBody}` with the endpoint secret and sends
// `t=…,v1=…[,v1=…]`. Verify against the RAW body, never a re-serialised one.
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  ) as Record<string, string>;
  const t = parts.t;
  if (!t || !/^\d+$/.test(t)) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const candidates = header.split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  return candidates.some((sig) =>
    sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}

// Used by the verification script to sign a fixture the way Stripe would.
export function signWebhookPayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}
