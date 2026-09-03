// ADMIN cancel / refund through Stripe, with Stripe stubbed at the fetch
// boundary and the real local database underneath.
//
//   set -a && . ./.env.local && set +a && npm run verify:refund

import pg from 'pg';

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_stub';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (text: string, params: unknown[] = []) => db.query(text, params).then((r) => r.rows);
let passed = 0; const failures: string[] = [];
const check = (name: string, cond: unknown) => { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failures.push(name); console.log(`  ✗ ${name}`); } };
const expectError = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as { status?: number; message: string }; } };

const [nadia] = await q(`select id from members where email = 'dev-nadia@example.com'`);
const [jules] = await q(`select id from members where email = 'dev-jules@example.com'`);
const [oshi] = await q(`select id, display_name from members where email = 'oshi@guestlist.net'`);
const [plan] = await q(`select id from membership_plans where code = 'member_monthly'`);
for (const id of [nadia.id, jules.id]) {
  await q(`delete from membership_billing_events where member_id = $1`, [id]);
  await q(`delete from memberships where member_id = $1`, [id]);
  await q(`delete from email_outbox where member_id = $1 and email_type in ('notification:membership_cancelled','notification:membership_refund')`, [id]);
}
const periodEnd = new Date(Date.now() + 20 * 86400 * 1000);
await q(`insert into memberships (member_id, plan_id, status, billing_source, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, member_since)
         values ($1, $2, 'active', 'stripe', 'cus_ref', 'sub_ref', now() - interval '10 days', $3, now() - interval '10 days')`, [nadia.id, plan.id, periodEnd]);
await q(`insert into membership_billing_events (stripe_event_id, event_type, member_id, amount_pence, currency, payload) values ('evt_paid_1', 'invoice.paid', $1, 3000, 'GBP', '{}')`, [nadia.id]);
await q(`insert into memberships (member_id, plan_id, status, billing_source, current_period_end, member_since) values ($1, $2, 'active', 'complimentary', now() + interval '30 days', now())`, [jules.id, plan.id]);

// The stand-in Stripe.
const calls: { method: string; path: string; body: string }[] = [];
const sub = (over: Record<string, unknown>) => ({ id: 'sub_ref', customer: 'cus_ref', status: 'active', current_period_end: Math.floor(periodEnd.getTime() / 1000), cancel_at_period_end: false, canceled_at: null, items: { data: [{ price: { id: 'price_x' }, current_period_end: Math.floor(periodEnd.getTime() / 1000) }] }, ...over });
let refunds = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input)); const method = init?.method ?? 'GET'; const body = String(init?.body ?? '');
  calls.push({ method, path: url.pathname + url.search, body });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/v1/subscriptions/sub_ref' && method === 'POST') return json(sub({ cancel_at_period_end: /cancel_at_period_end=true/.test(body) }));
  if (url.pathname === '/v1/subscriptions/sub_ref' && method === 'DELETE') return json(sub({ status: 'canceled', canceled_at: Math.floor(Date.now() / 1000), cancel_at_period_end: false }));
  if (url.pathname === '/v1/invoices') return json({ data: [{ id: 'in_ref', amount_paid: 3000, currency: 'gbp', created: 1, payment_intent: 'pi_ref', charge: 'ch_ref', status: 'paid' }] });
  if (url.pathname === '/v1/refunds' && method === 'POST') { refunds++; const amount = Number(new URLSearchParams(body).get('amount')); return json({ id: `re_${refunds}`, amount, currency: 'gbp', status: 'succeeded', payment_intent: 'pi_ref', charge: 'ch_ref' }); }
  return json({ error: { message: `unexpected ${method} ${url.pathname}` } }, 404);
}) as typeof fetch;

const { adminCancelStripeMembership, adminRefundLastPayment, memberRefunds } = await import('../lib/membershipAdmin');
const actor = { id: oshi.id, display_name: oshi.display_name };
const outbox = (type: string) => q(`select count(*)::int as n from email_outbox where member_id = $1 and email_type = $2`, [nadia.id, type]).then((r) => r[0].n);

console.log('\n— Refund —');
check('a complimentary member cannot be refunded', (await expectError(() => adminRefundLastPayment(jules.id, actor, {})))?.status === 400);
check('more than the payment is refused before Stripe is asked', (await expectError(() => adminRefundLastPayment(nadia.id, actor, { amountPence: 3500 })))?.status === 400 && refunds === 0);
const part = await adminRefundLastPayment(nadia.id, actor, { amountPence: 1000, note: 'goodwill' });
check('partial refund goes to Stripe against the invoice’s payment', part.amountPence === 1000 && part.remainingPence === 2000 && calls.some((c) => c.path === '/v1/refunds' && /payment_intent=pi_ref/.test(c.body) && /amount=1000/.test(c.body)));
check('refund written to the ledger with who and why', (await q(`select amount_pence, payload->>'by' as by, payload->>'note' as note from membership_billing_events where stripe_event_id = 'refund:re_1'`))[0]?.note === 'goodwill');
check('member emailed about the refund', (await outbox('notification:membership_refund')) === 1);
const rest = await adminRefundLastPayment(nadia.id, actor, {});
check('blank amount refunds what is left, not the whole invoice again', rest.amountPence === 2000 && rest.remainingPence === 0);
check('a third refund is refused (409) with nothing sent to Stripe', (await expectError(() => adminRefundLastPayment(nadia.id, actor, {})))?.status === 409 && refunds === 2);
check('member page lists both refunds', (await memberRefunds(nadia.id)).map((r) => r.amount_pence).sort().join(',') === '1000,2000');
check('idempotency keys differ per refund', new Set(calls.filter((c) => c.path === '/v1/refunds').map((c) => c.body)).size === 2);

console.log('\n— Cancel —');
check('a complimentary member cannot be cancelled here', (await expectError(() => adminCancelStripeMembership(jules.id, actor, { when: 'now' })))?.status === 400);
const soft = await adminCancelStripeMembership(nadia.id, actor, { when: 'period_end', note: 'asked by email' });
const [m1] = await q(`select status, cancel_at_period_end from memberships where member_id = $1`, [nadia.id]);
check('cancel at period end: still active, flagged to end, Stripe told', soft.outcome === 'ends_at_period_end' && m1.status === 'active' && m1.cancel_at_period_end === true && calls.some((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_ref' && /cancel_at_period_end=true/.test(c.body)));
check('ledger + email for the cancellation', (await q(`select count(*)::int as n from membership_billing_events where member_id = $1 and event_type = 'admin.subscription_cancel_at_period_end'`, [nadia.id]))[0].n === 1 && (await outbox('notification:membership_cancelled')) === 1);
check('asking again for period end is a no-op', (await adminCancelStripeMembership(nadia.id, actor, { when: 'period_end' })).outcome === 'already');
const hard = await adminCancelStripeMembership(nadia.id, actor, { when: 'now' });
const [m2] = await q(`select status from memberships where member_id = $1`, [nadia.id]);
check('cancel now: Stripe DELETE, membership cancelled immediately', hard.outcome === 'cancelled_now' && m2.status === 'cancelled' && calls.some((c) => c.method === 'DELETE' && c.path === '/v1/subscriptions/sub_ref'));
check('second email for ending now (different dedupe key)', (await outbox('notification:membership_cancelled')) === 2);
check('cancelling a cancelled membership is a no-op', (await adminCancelStripeMembership(nadia.id, actor, { when: 'now' })).outcome === 'already');
check('every action audited', (await q(`select count(*)::int as n from audit_log where action = 'membership_changed' and detail->>'memberId' = $1 and detail->>'action' in ('stripe_refund','stripe_cancel')`, [nadia.id]))[0].n === 4);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log(` - ${f}`)); }
await db.end();
process.exit(failures.length ? 1 : 0);
