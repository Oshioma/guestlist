// The welcome page's fallback: when the webhook never arrives, the page
// asks Stripe about the Checkout session and activates the member itself.
// Stripe is stubbed at the fetch boundary; the database is real.
//
//   set -a && . ./.env.local && set +a && npm run verify:reconcile

import pg from 'pg';

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_stub';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (text: string, params: unknown[] = []) => db.query(text, params).then((r) => r.rows);

let passed = 0; const failures: string[] = [];
const check = (name: string, cond: unknown) => { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failures.push(name); console.log(`  ✗ ${name}`); } };

const [nadia] = await q(`select id from members where email = 'dev-nadia@example.com'`);
const [jules] = await q(`select id from members where email = 'dev-jules@example.com'`);
await q(`delete from membership_billing_events where member_id in ($1, $2)`, [nadia.id, jules.id]);
await q(`delete from memberships where member_id in ($1, $2)`, [nadia.id, jules.id]);

// A fake Stripe: two sessions, one paid and one abandoned, one subscription.
const period = Math.floor(Date.now() / 1000) + 30 * 86400;
const stripe: Record<string, unknown> = {
  '/v1/checkout/sessions/cs_paid': { id: 'cs_paid', mode: 'subscription', status: 'complete', payment_status: 'paid', client_reference_id: nadia.id, customer: 'cus_recon', subscription: 'sub_recon', metadata: { member_id: nadia.id } },
  '/v1/checkout/sessions/cs_open': { id: 'cs_open', mode: 'subscription', status: 'open', payment_status: 'unpaid', client_reference_id: nadia.id, customer: null, subscription: null, metadata: { member_id: nadia.id } },
  '/v1/subscriptions/sub_recon': { id: 'sub_recon', customer: 'cus_recon', status: 'active', current_period_end: period, cancel_at_period_end: false, canceled_at: null, metadata: { member_id: nadia.id }, items: { data: [{ price: { id: 'price_stub' }, current_period_end: period }] } },
};
let calls = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.stripe.com') throw new Error(`unexpected fetch ${url}`);
  calls++;
  const body = stripe[url.pathname];
  return new Response(JSON.stringify(body ?? { error: { message: 'No such object' } }), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const { reconcileCheckoutSession } = await import('../lib/stripeReconcile');

console.log('\n— Welcome page reconcile (webhook never arrived) —');
const a = await reconcileCheckoutSession(nadia.id, 'cs_paid');
check('paid session activates the membership', a.outcome === 'activated');
const [m] = await q(`select status, billing_source, stripe_customer_id, stripe_subscription_id from memberships where member_id = $1`, [nadia.id]);
check('membership row is active · stripe with customer and subscription', m?.status === 'active' && m.billing_source === 'stripe' && m.stripe_customer_id === 'cus_recon' && m.stripe_subscription_id === 'sub_recon');
check('ledger entry under the session id', (await q(`select event_type from membership_billing_events where stripe_event_id = 'reconcile:cs_paid'`))[0]?.event_type === 'checkout.session.reconciled');
check('welcome email queued once', (await q(`select count(*)::int as n from email_outbox where member_id = $1 and email_type = 'notification:membership_welcome'`, [nadia.id]))[0].n === 1);
check('membership_started tracked via welcome_reconcile', (await q(`select count(*)::int as n from analytics_events where event_type = 'membership_started' and member_id = $1 and metadata->>'via' = 'welcome_reconcile'`, [nadia.id]))[0].n === 1);
const before = calls;
const b = await reconcileCheckoutSession(nadia.id, 'cs_paid');
check('a refresh is a no-op (ledger)', b.outcome === 'already' && calls === before + 1);
check('still exactly one welcome email', (await q(`select count(*)::int as n from email_outbox where member_id = $1 and email_type = 'notification:membership_welcome'`, [nadia.id]))[0].n === 1);
check('an unpaid session does nothing', (await reconcileCheckoutSession(nadia.id, 'cs_open')).outcome === 'unpaid'
  && (await q(`select count(*)::int as n from membership_billing_events where stripe_event_id = 'reconcile:cs_open'`))[0].n === 0);
check('another member cannot claim the session', (await reconcileCheckoutSession(jules.id, 'cs_paid')).outcome === 'not_yours'
  && (await q(`select count(*)::int as n from memberships where member_id = $1`, [jules.id]))[0].n === 0);
check('a made-up id is refused before Stripe is asked', (await reconcileCheckoutSession(nadia.id, 'not-a-session')).outcome === 'error');
check('an unknown session is an error, not a crash', (await reconcileCheckoutSession(nadia.id, 'cs_missing')).outcome === 'error');
delete process.env.STRIPE_SECRET_KEY;
check('billing off → nothing happens', (await reconcileCheckoutSession(nadia.id, 'cs_paid')).outcome === 'off');

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log(` - ${f}`)); }
await db.end();
process.exit(failures.length ? 1 : 0);
