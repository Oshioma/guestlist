// The numbers the desk runs on. All derived from the tables that already
// carry the facts (memberships, billing events, access requests, claims) —
// no separate analytics system. Everything here is information for a
// person; nothing here restricts anybody automatically.

import { FAIR_USE_WATCH } from './accessRequests';
import { query, queryOne } from './db';
import { formatPence, membershipIsActive, membershipLabel, type BillingSource, type Membership, type MembershipStatus } from './membership';

export type MembershipOverview = {
  paying: number; complimentary: number; trialing: number; past_due: number;
  new_30d: number; cancelled_30d: number; churn_pct: number | null;
  mrr_pence: number; revenue_30d_pence: number; waitlist: number;
};

export async function membershipOverview(): Promise<MembershipOverview> {
  const row = await queryOne<Omit<MembershipOverview, 'churn_pct'>>(
    `select
       (select count(*)::int from memberships m where m.billing_source = 'stripe' and m.status in ('active','past_due')
          and (m.status = 'active' or m.current_period_end > now())) as paying,
       (select count(*)::int from memberships m where m.billing_source <> 'stripe' and m.status = 'active'
          and (m.current_period_end is null or m.current_period_end > now())) as complimentary,
       (select count(*)::int from memberships m where m.status = 'trialing') as trialing,
       (select count(*)::int from memberships m where m.status = 'past_due') as past_due,
       (select count(*)::int from memberships m where m.member_since > now() - interval '30 days') as new_30d,
       (select count(*)::int from memberships m where m.cancelled_at > now() - interval '30 days') as cancelled_30d,
       (select coalesce(sum(p.price_pence), 0)::int from memberships m join membership_plans p on p.id = m.plan_id
          where m.billing_source = 'stripe' and m.status in ('active','trialing','past_due')
            and not m.cancel_at_period_end) as mrr_pence,
       (select coalesce(sum(amount_pence), 0)::int from membership_billing_events
          where event_type = 'invoice.paid' and processed_at > now() - interval '30 days') as revenue_30d_pence,
       (select count(*)::int from membership_waitlist w
          where not exists (select 1 from members m join memberships s on s.member_id = m.id
                             where (m.id = w.member_id or lower(m.email) = lower(w.email))
                               and (s.status in ('active','trialing') or (s.billing_source = 'lifetime' and s.status = 'active')))) as waitlist`
  );
  const r = row ?? { paying: 0, complimentary: 0, trialing: 0, past_due: 0, new_30d: 0, cancelled_30d: 0, mrr_pence: 0, revenue_30d_pence: 0, waitlist: 0 };
  const base = r.paying + r.cancelled_30d;
  return { ...r, churn_pct: base > 0 ? Math.round((r.cancelled_30d / base) * 1000) / 10 : null };
}

export type RequestOverview = {
  requests_30d: number; requests_month: number; open: number; decided_30d: number;
  free_30d: number; discounted_30d: number; purchased_30d: number; declined_30d: number;
  fulfilment_rate: number | null; free_rate: number | null; discount_rate: number | null;
  avg_cost_pence: number | null; cost_30d_pence: number; cost_lifetime_pence: number;
  requests_per_member: number | null; direct_guestlist_30d: number;
  by_reason: { reason: string; n: number }[];
  top_events: { id: string; title: string; slug: string; start_at: string; n: number; fulfilled: number }[];
  top_promoters: { id: string; name: string; slug: string; relationship_status: string; requests: number; successes: number }[];
};

export async function requestOverview(): Promise<RequestOverview> {
  const FULFILLED = `('confirmed_free','discounted','purchased_by_guestlist','attended')`;
  const [s, by_reason, top_events, top_promoters, members] = await Promise.all([
    queryOne<Omit<RequestOverview, 'by_reason' | 'top_events' | 'top_promoters' | 'fulfilment_rate' | 'free_rate' | 'discount_rate' | 'avg_cost_pence' | 'requests_per_member'> & { fulfilled_cost_n: number }>(
      `select
         count(*) filter (where requested_at > now() - interval '30 days' and status <> 'cancelled')::int as requests_30d,
         count(*) filter (where requested_at > date_trunc('month', now()) and status <> 'cancelled')::int as requests_month,
         count(*) filter (where status in ('requested','reviewing','contacting_promoter','waitlisted'))::int as open,
         count(*) filter (where decided_at > now() - interval '30 days' and status in ('confirmed_free','discounted','purchased_by_guestlist','attended','unavailable'))::int as decided_30d,
         count(*) filter (where decided_at > now() - interval '30 days' and status in ('confirmed_free','attended'))::int as free_30d,
         count(*) filter (where decided_at > now() - interval '30 days' and status = 'discounted')::int as discounted_30d,
         count(*) filter (where decided_at > now() - interval '30 days' and status = 'purchased_by_guestlist')::int as purchased_30d,
         count(*) filter (where decided_at > now() - interval '30 days' and status = 'unavailable')::int as declined_30d,
         coalesce(sum(guestlist_cost_pence) filter (where decided_at > now() - interval '30 days' and status in ${FULFILLED}), 0)::int as cost_30d_pence,
         coalesce(sum(guestlist_cost_pence) filter (where status in ${FULFILLED}), 0)::int as cost_lifetime_pence,
         count(*) filter (where status in ${FULFILLED})::int as fulfilled_cost_n,
         count(*) filter (where requested_at > now() - interval '30 days' and fulfilment_method = 'promoter_guestlist' and guestlist_entry_id is not null and handled_by_member_id is null)::int as direct_guestlist_30d
       from member_access_requests`
    ),
    query<{ reason: string; n: number }>(
      `select coalesce(outcome_reason, 'other') as reason, count(*)::int as n from member_access_requests
        where status = 'unavailable' group by 1 order by 2 desc`
    ),
    query<RequestOverview['top_events'][number]>(
      `select e.id, e.title, e.slug, e.start_at::text, count(*)::int as n,
              count(*) filter (where r.status in ${FULFILLED})::int as fulfilled
         from member_access_requests r join events e on e.id = r.event_id
        where r.status <> 'cancelled' and r.requested_at > now() - interval '90 days'
        group by e.id order by n desc, e.start_at limit 10`
    ),
    query<RequestOverview['top_promoters'][number]>(
      `select p.id, p.name, p.slug, p.relationship_status, count(*)::int as requests,
              count(*) filter (where r.status in ${FULFILLED})::int as successes
         from member_access_requests r join promoters p on p.id = r.promoter_id
        where r.status <> 'cancelled'
        group by p.id order by successes desc, requests desc limit 10`
    ),
    queryOne<{ n: number }>(
      `select count(*)::int as n from memberships m where m.status in ('active','trialing','past_due')`
    ),
  ]);
  const st = s!;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    ...st,
    fulfilment_rate: pct(st.free_30d + st.discounted_30d + st.purchased_30d, st.decided_30d),
    free_rate: pct(st.free_30d, st.decided_30d),
    discount_rate: pct(st.discounted_30d, st.decided_30d),
    avg_cost_pence: st.fulfilled_cost_n > 0 ? Math.round(st.cost_lifetime_pence / st.fulfilled_cost_n) : null,
    requests_per_member: (members?.n ?? 0) > 0 ? Math.round((st.requests_30d / (members!.n)) * 100) / 100 : null,
    by_reason, top_events, top_promoters,
  };
}

export type MarketOverview = {
  approved: number; applications: number; live_offers: number;
  claims_30d: number; redemptions_30d: number; claims_total: number; redemptions_total: number;
  top_businesses: { id: string; name: string; slug: string; claims: number; redemptions: number; views_30d: number }[];
};

export async function marketOverview(): Promise<MarketOverview> {
  const [s, top_businesses] = await Promise.all([
    queryOne<Omit<MarketOverview, 'top_businesses'>>(
      `select
         (select count(*)::int from market_businesses where status = 'approved') as approved,
         (select count(*)::int from market_businesses where status in ('applied','pending')) as applications,
         (select count(*)::int from market_offers o join market_businesses b on b.id = o.business_id
           where b.status = 'approved' and o.active and o.approval_status = 'approved'
             and (o.valid_from is null or o.valid_from <= now()) and (o.valid_to is null or o.valid_to > now())) as live_offers,
         (select count(*)::int from market_offer_claims where claimed_at > now() - interval '30 days') as claims_30d,
         (select count(*)::int from market_offer_claims where status = 'redeemed' and redeemed_at > now() - interval '30 days') as redemptions_30d,
         (select count(*)::int from market_offer_claims) as claims_total,
         (select count(*)::int from market_offer_claims where status = 'redeemed') as redemptions_total`
    ),
    query<MarketOverview['top_businesses'][number]>(
      `select b.id, b.name, b.slug,
              (select count(*)::int from market_offer_claims k where k.business_id = b.id) as claims,
              (select count(*)::int from market_offer_claims k where k.business_id = b.id and k.status = 'redeemed') as redemptions,
              (select count(*)::int from analytics_events a where a.event_type = 'market_business_viewed'
                 and a.metadata->>'business_id' = b.id::text and a.created_at > now() - interval '30 days') as views_30d
         from market_businesses b where b.status = 'approved'
        order by claims desc, views_30d desc limit 10`
    ),
  ]);
  return { ...(s ?? { approved: 0, applications: 0, live_offers: 0, claims_30d: 0, redemptions_30d: 0, claims_total: 0, redemptions_total: 0 }), top_businesses };
}

// --- The member ledger: one row per membership, with the fair-use picture ----------------------

export type LedgerRow = {
  member_id: string; display_name: string; email: string; slug: string | null;
  membership: Membership; active: boolean; label: string;
  requests_month: number; requests_lifetime: number; free_entries: number; discounts: number; purchased: number;
  declined: number; plus_ones: number; cost_month_pence: number; cost_lifetime_pence: number; paid_pence: number;
  last_paid_pence: number; refunded_pence: number;
  months_member: number; flags: string[];
};

export async function memberLedger(): Promise<LedgerRow[]> {
  const rows = await query<{
    member_id: string; display_name: string; email: string; slug: string | null;
    id: string; plan_id: string; status: MembershipStatus; billing_source: BillingSource;
    granted_by_member_id: string | null; grant_note: string | null; stripe_customer_id: string | null;
    stripe_subscription_id: string | null; current_period_start: string | null; current_period_end: string | null;
    cancel_at_period_end: boolean; cancelled_at: string | null; member_since: string | null;
    requests_month: number; requests_week: number; requests_lifetime: number; free_entries: number; discounts: number; purchased: number;
    declined: number; plus_ones: number; cost_month_pence: number; cost_lifetime_pence: number; paid_pence: number;
    last_paid_pence: number; refunded_pence: number;
  }>(
    `select m.id as member_id, m.display_name, m.email, m.slug,
            s.id, s.plan_id, s.status, s.billing_source, s.granted_by_member_id, s.grant_note, s.stripe_customer_id,
            s.stripe_subscription_id, s.current_period_start::text, s.current_period_end::text, s.cancel_at_period_end,
            s.cancelled_at::text, s.member_since::text,
            count(r.id) filter (where r.requested_at > date_trunc('month', now()) and r.status <> 'cancelled')::int as requests_month,
            count(r.id) filter (where r.requested_at > now() - interval '7 days' and r.status <> 'cancelled')::int as requests_week,
            count(r.id) filter (where r.status <> 'cancelled')::int as requests_lifetime,
            count(r.id) filter (where r.status in ('confirmed_free','attended'))::int as free_entries,
            count(r.id) filter (where r.status = 'discounted')::int as discounts,
            count(r.id) filter (where r.status = 'purchased_by_guestlist')::int as purchased,
            count(r.id) filter (where r.status = 'unavailable')::int as declined,
            count(r.id) filter (where r.places > 1 and r.status <> 'cancelled')::int as plus_ones,
            coalesce(sum(r.guestlist_cost_pence) filter (where r.requested_at > date_trunc('month', now())
              and r.status in ('confirmed_free','discounted','purchased_by_guestlist','attended')), 0)::int as cost_month_pence,
            coalesce(sum(r.guestlist_cost_pence) filter (where r.status in ('confirmed_free','discounted','purchased_by_guestlist','attended')), 0)::int as cost_lifetime_pence,
            (select coalesce(sum(b.amount_pence), 0)::int from membership_billing_events b
              where b.member_id = m.id and b.event_type = 'invoice.paid') as paid_pence,
            (select coalesce(b.amount_pence, 0) from membership_billing_events b
              where b.member_id = m.id and b.event_type = 'invoice.paid' order by b.processed_at desc limit 1) as last_paid_pence,
            (select coalesce(sum(b.amount_pence), 0)::int from membership_billing_events b
              where b.member_id = m.id and b.event_type = 'admin.refund') as refunded_pence
       from memberships s
       join members m on m.id = s.member_id
       left join member_access_requests r on r.member_id = m.id
      group by m.id, s.id
      order by (s.status in ('active','trialing','past_due')) desc, requests_month desc, m.display_name`
  );
  // The average request volume across active members, so "unusual" means
  // unusual for THIS community, not a number picked in advance.
  const active = rows.filter((r) => r.status === 'active' || r.status === 'trialing' || r.status === 'past_due');
  const avgMonth = active.length ? active.reduce((a, r) => a + r.requests_month, 0) / active.length : 0;
  return rows.map((r) => {
    const membership: Membership = {
      id: r.id, member_id: r.member_id, plan_id: r.plan_id, status: r.status, billing_source: r.billing_source,
      granted_by_member_id: r.granted_by_member_id, grant_note: r.grant_note, stripe_customer_id: r.stripe_customer_id,
      stripe_subscription_id: r.stripe_subscription_id, current_period_start: r.current_period_start,
      current_period_end: r.current_period_end, cancel_at_period_end: r.cancel_at_period_end,
      cancelled_at: r.cancelled_at, member_since: r.member_since,
    };
    const months = r.member_since ? Math.max(1, Math.round((Date.now() - new Date(r.member_since).getTime()) / (30.44 * 86400_000))) : 0;
    const flags: string[] = [];
    if (r.requests_week >= FAIR_USE_WATCH.asksPerWeek) flags.push(`${r.requests_week} asks in the last 7 days`);
    if (r.requests_month >= 6) flags.push(`${r.requests_month} requests this month`);
    else if (avgMonth >= 1 && r.requests_month >= Math.max(4, avgMonth * 3)) flags.push('well above the average this month');
    if (r.billing_source === 'stripe' && r.paid_pence > 0 && r.cost_lifetime_pence > r.paid_pence - (r.refunded_pence ?? 0)) flags.push('cost above what they’ve paid');
    if ((r.refunded_pence ?? 0) > 0) flags.push(`refunded ${formatPence(r.refunded_pence)}`);
    if (r.requests_lifetime >= 4 && r.plus_ones === r.requests_lifetime) flags.push('always a +1');
    if (r.status === 'past_due') flags.push('payment failed');
    return {
      member_id: r.member_id, display_name: r.display_name, email: r.email, slug: r.slug,
      membership, active: membershipIsActive(membership), label: membershipLabel(membership),
      requests_month: r.requests_month, requests_lifetime: r.requests_lifetime, free_entries: r.free_entries,
      discounts: r.discounts, purchased: r.purchased, declined: r.declined, plus_ones: r.plus_ones,
      cost_month_pence: r.cost_month_pence, cost_lifetime_pence: r.cost_lifetime_pence, paid_pence: r.paid_pence,
      last_paid_pence: r.last_paid_pence ?? 0, refunded_pence: r.refunded_pence ?? 0,
      months_member: months, flags,
    };
  });
}

// Anyone who has since joined drops off the list: they are a member now, and
// the waitlist is for people we still owe an answer.
export async function waitlistRows(limit = 200): Promise<{ email: string; display_name: string | null; created_at: string; invited_at: string | null; joined: boolean }[]> {
  return query(
    `select w.email, m.display_name, w.created_at::text, w.invited_at::text,
            (s.id is not null and (s.status in ('active','trialing') or (s.billing_source = 'lifetime' and s.status = 'active'))) as joined
       from membership_waitlist w
       left join members m on m.id = w.member_id or lower(m.email) = lower(w.email)
       left join memberships s on s.member_id = m.id
      order by w.created_at desc limit $1`,
    [limit]
  );
}

// --- ASK GUESTLIST: what members want that Guestlist does not have -----------------------------

export type ExternalDemand = {
  asks_total: number; asks_30d: number; external: number; linked: number; created: number;
  fulfilled: number; declined: number; promoters_assigned: number; new_relationships: number;
  by_type: { request_type: string; n: number }[];
  by_host: { host: string; n: number; members: number; fulfilled: number }[];
  by_city: { city: string; n: number }[];
  by_venue: { venue: string; city: string | null; n: number }[];
  by_promoter: { id: string; name: string; slug: string; relationship_status: string; n: number; fulfilled: number }[];
  wanted: { id: string; name: string | null; host: string | null; url: string | null; city: string | null; starts_at: string | null; n: number; status: string; linked: boolean }[];
};

export async function externalDemand(): Promise<ExternalDemand> {
  const FULFILLED = `('confirmed_free','discounted','purchased_by_guestlist','attended','answered')`;
  const [s, by_type, by_host, by_city, by_venue, by_promoter, wanted] = await Promise.all([
    queryOne<Omit<ExternalDemand, 'by_type' | 'by_host' | 'by_city' | 'by_venue' | 'by_promoter' | 'wanted'>>(
      `select
         count(*) filter (where r.origin = 'ask_guestlist' and r.status <> 'cancelled')::int as asks_total,
         count(*) filter (where r.origin = 'ask_guestlist' and r.status <> 'cancelled' and r.requested_at > now() - interval '30 days')::int as asks_30d,
         count(*) filter (where x.request_id is not null and r.status <> 'cancelled')::int as external,
         count(*) filter (where x.request_id is not null and r.event_id is not null and r.match_confidence in ('admin','url'))::int as linked,
         count(*) filter (where x.created_event_id is not null)::int as created,
         count(*) filter (where r.origin = 'ask_guestlist' and r.status in ${FULFILLED})::int as fulfilled,
         count(*) filter (where r.origin = 'ask_guestlist' and r.status = 'unavailable')::int as declined,
         count(*) filter (where r.origin = 'ask_guestlist' and r.promoter_id is not null)::int as promoters_assigned,
         (select count(distinct o.promoter_id)::int from promoter_outreach o
           join member_access_requests r2 on r2.id = o.request_id and r2.origin = 'ask_guestlist'
           where not exists (select 1 from promoter_outreach o2 where o2.promoter_id = o.promoter_id and o2.created_at < o.created_at
                              and o2.request_id in (select id from member_access_requests where origin = 'get_me_in'))) as new_relationships
       from member_access_requests r left join member_request_external_events x on x.request_id = r.id`
    ),
    query<{ request_type: string; n: number }>(
      `select request_type, count(*)::int as n from member_access_requests
        where origin = 'ask_guestlist' and status <> 'cancelled' group by 1 order by 2 desc`),
    query<ExternalDemand['by_host'][number]>(
      `select x.url_host as host, count(*)::int as n, count(distinct r.member_id)::int as members,
              count(*) filter (where r.status in ${FULFILLED})::int as fulfilled
         from member_request_external_events x join member_access_requests r on r.id = x.request_id
        where x.url_host is not null and r.status <> 'cancelled' group by 1 order by 2 desc limit 15`),
    query<{ city: string; n: number }>(
      `select coalesce(e.city, x.city) as city, count(*)::int as n
         from member_access_requests r
         left join events e on e.id = r.event_id
         left join member_request_external_events x on x.request_id = r.id
        where r.origin = 'ask_guestlist' and r.status <> 'cancelled' and coalesce(e.city, x.city) is not null
        group by 1 order by 2 desc limit 15`),
    query<ExternalDemand['by_venue'][number]>(
      `select x.venue_name as venue, x.city, count(*)::int as n
         from member_request_external_events x join member_access_requests r on r.id = x.request_id
        where x.venue_name is not null and r.status <> 'cancelled' group by 1, 2 order by 3 desc limit 15`),
    query<ExternalDemand['by_promoter'][number]>(
      `select p.id, p.name, p.slug, p.relationship_status, count(*)::int as n,
              count(*) filter (where r.status in ${FULFILLED})::int as fulfilled
         from member_access_requests r join promoters p on p.id = r.promoter_id
        where r.origin = 'ask_guestlist' and r.status <> 'cancelled' group by p.id order by n desc limit 15`),
    query<ExternalDemand['wanted'][number]>(
      `select r.id, x.name, x.url_host as host, x.url, x.city, x.starts_at::text, r.status,
              (r.event_id is not null) as linked,
              (select count(*)::int from member_request_external_events x2 join member_access_requests r2 on r2.id = x2.request_id
                where x2.url_normalised = x.url_normalised and r2.status <> 'cancelled') as n
         from member_request_external_events x join member_access_requests r on r.id = x.request_id
        where r.status <> 'cancelled' and r.event_id is null
        order by n desc, r.requested_at desc limit 25`),
  ]);
  return {
    ...(s ?? { asks_total: 0, asks_30d: 0, external: 0, linked: 0, created: 0, fulfilled: 0, declined: 0, promoters_assigned: 0, new_relationships: 0 }),
    by_type, by_host, by_city, by_venue, by_promoter, wanted,
  };
}
