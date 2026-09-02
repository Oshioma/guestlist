// GUESTLIST MEMBERSHIP — who is a member, and what that is worth.
//
// The database is the only source of truth. Nothing the browser sends can
// make somebody a member; every gated action calls requireActiveMember() and
// reads the memberships table afresh. Stripe tells us what changed through
// signed webhooks (see app/api/webhooks/stripe) and we write it here.
//
// lib/auth.ts is deliberately untouched: it knows who you are, this module
// knows whether you are a member.

import { AuthError, getCurrentMember, type Member } from './auth';
import { query, queryOne } from './db';
import { track } from './analytics';
import { audit } from './audit';
import { stripeConfigured, stripePriceId, type StripeSubscription } from './stripe';

export type MembershipStatus = 'incomplete' | 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
export type BillingSource = 'stripe' | 'complimentary' | 'lifetime' | 'manual';

export const BILLING_SOURCES: BillingSource[] = ['stripe', 'complimentary', 'lifetime', 'manual'];

export type Plan = {
  id: string;
  code: string;
  name: string;
  price_pence: number;
  currency: string;
  interval: 'month' | 'year';
  stripe_price_id: string | null;
};

export type Membership = {
  id: string;
  member_id: string;
  plan_id: string;
  status: MembershipStatus;
  billing_source: BillingSource;
  granted_by_member_id: string | null;
  grant_note: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  member_since: string | null;
};

export const MEMBERSHIP_COLUMNS = `id, member_id, plan_id, status, billing_source, granted_by_member_id, grant_note,
            stripe_customer_id, stripe_subscription_id,
            current_period_start::text, current_period_end::text, cancel_at_period_end,
            cancelled_at::text, member_since::text`;

export const DEFAULT_PLAN_CODE = 'member_monthly';

// Billing is ON when Stripe is configured. The membership page exists either
// way — before launch it collects a waitlist.
export function billingEnabled(): boolean {
  return stripeConfigured();
}

export async function getPlan(code = DEFAULT_PLAN_CODE): Promise<Plan | null> {
  return queryOne<Plan>(
    `select id, code, name, price_pence, currency, interval, stripe_price_id
       from membership_plans where code = $1 and active`,
    [code]
  );
}

// The Stripe price to sell. Env wins so a deploy can switch price without a
// database change; the plan row is the fallback.
export async function sellablePriceId(plan: Plan): Promise<string | null> {
  return stripePriceId() ?? plan.stripe_price_id;
}

export function formatPence(pence: number, currency = 'GBP'): string {
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : `${currency} `;
  const whole = pence % 100 === 0;
  return `${sym}${whole ? String(pence / 100) : (pence / 100).toFixed(2)}`;
}

export async function getMembership(memberId: string): Promise<Membership | null> {
  return queryOne<Membership>(
    `select ${MEMBERSHIP_COLUMNS} from memberships where member_id = $1`,
    [memberId]
  );
}

// Benefits stay on while the subscription is good, and through Stripe's
// retry window on a failed payment (past_due) until the paid period runs out.
// A gifted membership is on until its expiry (none = open-ended); a lifetime
// one has no expiry at all.
export function membershipIsActive(m: Membership | null): boolean {
  if (!m) return false;
  const periodOpen = !m.current_period_end || new Date(m.current_period_end).getTime() > Date.now();
  if (m.billing_source === 'lifetime') return m.status === 'active';
  if (m.billing_source === 'complimentary' || m.billing_source === 'manual') {
    return m.status === 'active' && periodOpen;
  }
  if (m.status === 'active' || m.status === 'trialing') return true;
  if (m.status === 'past_due' && m.current_period_end) return periodOpen;
  return false;
}

// What a person reads about their own membership. Never the raw enum.
export function membershipLabel(m: Membership | null): string {
  if (!m) return 'Not a member';
  if (membershipIsActive(m)) {
    if (m.billing_source === 'lifetime') return 'Lifetime member';
    if (m.billing_source !== 'stripe') return 'Member (with our compliments)';
    if (m.cancel_at_period_end) return 'Active · ends at period end';
    if (m.status === 'past_due') return 'Active · payment needs attention';
    return m.status === 'trialing' ? 'Trial' : 'Active';
  }
  if (m.status === 'past_due') return 'Payment failed';
  if (m.status === 'cancelled') return 'Cancelled';
  if (m.billing_source !== 'stripe' && m.status === 'active') return 'Expired';
  return m.status === 'expired' ? 'Expired' : 'Not active';
}

export async function isActiveMember(memberId: string): Promise<boolean> {
  return membershipIsActive(await getMembership(memberId));
}

export type MemberWithMembership = Member & { membership: Membership | null; isMember: boolean };

export async function currentMemberWithMembership(): Promise<MemberWithMembership | null> {
  const member = await getCurrentMember();
  if (!member) return null;
  const membership = await getMembership(member.id);
  return { ...member, membership, isMember: membershipIsActive(membership) };
}

// Server-side gate for every member-only action.
export async function requireActiveMember(): Promise<MemberWithMembership> {
  const me = await currentMemberWithMembership();
  if (!me) throw new AuthError(401, 'Sign in required');
  if (!me.isMember) throw new AuthError(403, 'Guestlist membership required');
  return me;
}

// "Member since 2026" — the year, never the day, on public surfaces.
export function memberSinceYear(m: Membership | null): number | null {
  if (!m?.member_since) return null;
  return new Date(m.member_since).getUTCFullYear();
}

// --- Writes from Stripe ------------------------------------------------------

function toStatus(s: StripeSubscription['status']): MembershipStatus {
  switch (s) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'past_due': return 'past_due';
    case 'unpaid': return 'past_due';
    case 'canceled': return 'cancelled';
    case 'incomplete_expired': return 'expired';
    case 'paused': return 'expired';
    default: return 'incomplete';
  }
}

const ts = (n: number | undefined | null) => (n ? new Date(n * 1000) : null);

// Upsert our membership row from a Stripe subscription. Returns the change
// so the caller can track it. Idempotent: applying the same subscription
// twice changes nothing.
export async function applyStripeSubscription(
  memberId: string,
  sub: StripeSubscription,
  planCode = DEFAULT_PLAN_CODE
): Promise<{ before: MembershipStatus | null; after: MembershipStatus; membershipId: string }> {
  const plan = await getPlan(planCode);
  if (!plan) throw new Error(`Unknown membership plan ${planCode}`);
  const status = toStatus(sub.status);
  const item = sub.items?.data?.[0];
  const periodStart = ts(sub.current_period_start ?? item?.current_period_start);
  const periodEnd = ts(sub.current_period_end ?? item?.current_period_end);
  const existing = await getMembership(memberId);
  const becomesMember = status === 'active' || status === 'trialing';

  // A gift is ours to take away, not Stripe's: a lapsed or cancelled Stripe
  // subscription must never switch off a complimentary or lifetime member.
  // Only remember the Stripe ids in that case.
  const gifted = existing && existing.billing_source !== 'stripe' && membershipIsActive(existing);
  if (gifted && !becomesMember) {
    await query(
      `update memberships set stripe_customer_id = coalesce($2, stripe_customer_id),
              stripe_subscription_id = $3, updated_at = now()
        where member_id = $1`,
      [memberId, sub.customer, sub.id]
    );
    return { before: existing.status, after: existing.status, membershipId: existing.id };
  }

  const row = await queryOne<{ id: string }>(
    `insert into memberships
       (member_id, plan_id, status, billing_source, stripe_customer_id, stripe_subscription_id,
        current_period_start, current_period_end, cancel_at_period_end, cancelled_at, member_since)
     values ($1, $2, $3, 'stripe', $4, $5, $6, $7, $8, $9, case when $10 then now() else null end)
     on conflict (member_id) do update set
       plan_id = excluded.plan_id,
       status = excluded.status,
       billing_source = 'stripe',
       granted_by_member_id = null,
       grant_note = null,
       stripe_customer_id = coalesce(excluded.stripe_customer_id, memberships.stripe_customer_id),
       stripe_subscription_id = excluded.stripe_subscription_id,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       cancelled_at = excluded.cancelled_at,
       member_since = coalesce(memberships.member_since, excluded.member_since),
       updated_at = now()
     returning id`,
    [
      memberId, plan.id, status, sub.customer, sub.id,
      periodStart, periodEnd, !!sub.cancel_at_period_end, ts(sub.canceled_at),
      becomesMember,
    ]
  );
  return { before: existing?.status ?? null, after: status, membershipId: row!.id };
}

// Stripe's customer id is the key for the Billing Portal; remember it as soon
// as Checkout hands it back, even before the subscription is confirmed.
export async function rememberStripeCustomer(memberId: string, customerId: string): Promise<void> {
  const plan = await getPlan();
  if (!plan) return;
  await query(
    `insert into memberships (member_id, plan_id, status, stripe_customer_id)
     values ($1, $2, 'incomplete', $3)
     on conflict (member_id) do update set
       stripe_customer_id = coalesce(memberships.stripe_customer_id, excluded.stripe_customer_id),
       updated_at = now()`,
    [memberId, plan.id, customerId]
  );
}

export async function memberIdForStripeCustomer(customerId: string): Promise<string | null> {
  const row = await queryOne<{ member_id: string }>(
    `select member_id from memberships where stripe_customer_id = $1`, [customerId]);
  return row?.member_id ?? null;
}

// Append-only ledger; the unique stripe_event_id makes replays a no-op.
export async function recordBillingEvent(opts: {
  stripeEventId: string;
  type: string;
  memberId?: string | null;
  membershipId?: string | null;
  amountPence?: number | null;
  currency?: string | null;
  payload: unknown;
}): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `insert into membership_billing_events
       (stripe_event_id, event_type, member_id, membership_id, amount_pence, currency, payload)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (stripe_event_id) do nothing
     returning id`,
    [opts.stripeEventId, opts.type, opts.memberId ?? null, opts.membershipId ?? null,
     opts.amountPence ?? null, opts.currency ?? null, JSON.stringify(opts.payload ?? {})]
  );
  return !!row;
}

// GRANT MEMBERSHIP — DJs, promoters, journalists, partners, competition
// winners, early members. Optional expiry; lifetime never expires. Audited,
// and it never touches a live Stripe subscription's billing.
export async function grantMembership(
  memberId: string,
  actorId: string,
  opts: { source: Exclude<BillingSource, 'stripe'>; expiresAt?: Date | null; note?: string | null }
): Promise<void> {
  const plan = await getPlan();
  if (!plan) throw new Error('No membership plan');
  const expires = opts.source === 'lifetime' ? null : (opts.expiresAt ?? null);
  await query(
    `insert into memberships
       (member_id, plan_id, status, billing_source, granted_by_member_id, grant_note,
        current_period_start, current_period_end, member_since)
     values ($1, $2, 'active', $3, $4, $5, now(), $6, now())
     on conflict (member_id) do update set
       status = 'active',
       billing_source = excluded.billing_source,
       granted_by_member_id = excluded.granted_by_member_id,
       grant_note = excluded.grant_note,
       current_period_start = now(),
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = false,
       cancelled_at = null,
       member_since = coalesce(memberships.member_since, now()),
       updated_at = now()`,
    [memberId, plan.id, opts.source, actorId, opts.note ?? null, expires]
  );
  await audit('membership_changed', {
    actorId, detail: { memberId, action: 'grant', source: opts.source, expiresAt: expires, note: opts.note ?? null },
  });
  await track('membership_started', { memberId, metadata: { via: 'admin', source: opts.source } });
}

// Take a gift back. A Stripe subscription is cancelled through Stripe, never
// here — the webhook will tell us.
export async function revokeMembership(memberId: string, actorId: string, note?: string | null): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update memberships set status = 'cancelled', cancelled_at = now(), current_period_end = now(), updated_at = now()
      where member_id = $1 and billing_source <> 'stripe' returning id`,
    [memberId]
  );
  if (!rows.length) return false;
  await audit('membership_changed', { actorId, detail: { memberId, action: 'revoke', note: note ?? null } });
  await track('membership_cancelled', { memberId, metadata: { via: 'admin' } });
  return true;
}

// --- Waitlist ------------------------------------------------------------------

export async function joinWaitlist(email: string, memberId: string | null, source = 'membership_page'): Promise<'joined' | 'already'> {
  const clean = email.trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new AuthError(400, 'Enter a valid email address');
  const row = await queryOne<{ id: string }>(
    `insert into membership_waitlist (email, member_id, source) values ($1, $2, $3)
     on conflict (lower(email)) do nothing returning id`,
    [clean, memberId, source]
  );
  if (row) await track('membership_waitlist_joined', { memberId, metadata: { source } });
  return row ? 'joined' : 'already';
}

export async function isOnWaitlist(memberId: string): Promise<boolean> {
  return !!(await queryOne(`select 1 from membership_waitlist where member_id = $1`, [memberId]));
}
