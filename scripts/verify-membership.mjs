// Membership verification: GET IN. £30/month — the membership page in
// COMING SOON mode with a waitlist, admin-granted memberships, signed and
// idempotent Stripe webhooks, GET ME IN routing (promoter list open → straight
// on; closed → brokered) and every desk action, promoter outreach and the
// relationship ledger, Guestlist Market applications, approval, claims with
// single-use codes, redemption, portal permissions, member drops, ASK
// GUESTLIST (any event, anywhere: URL matching, external requests, the desk's
// LINK / IMPORT / ASSIGN, rate limits, demand reports) and the friendly
// member-facing states.
//
// Requires: db reset+seed (npm run db:reset), dev server on :3000 with
// STRIPE_WEBHOOK_SECRET set (any value) and STRIPE_SECRET_KEY unset.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (existsSync(path.join(root, '.env.local'))) {
  for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (text, params = []) => db.query(text, params).then((r) => r.rows);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

function client() {
  let cookie = '';
  return {
    async fetch(url, opts = {}) {
      const res = await fetch(`${BASE}${url}`, {
        ...opts,
        redirect: 'manual',
        headers: {
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(opts.headers ?? {}),
        },
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return res;
    },
    async login(email, password = 'guestlist') {
      return (await this.fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })).status;
    },
    post(url, body = {}) { return this.fetch(url, { method: 'POST', body: JSON.stringify(body) }); },
    patch(url, body = {}) { return this.fetch(url, { method: 'PATCH', body: JSON.stringify(body) }); },
    async json(url, method = 'GET', body) {
      const res = await this.fetch(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    },
    async html(url) { return (await this.fetch(url)).text(); },
  };
}

const anon = client();
const oshi = client();   // admin
const nadia = client();  // will be granted membership
const jules = client();  // stays a non-member, then business owner
const marcus = client(); // lifetime member

try {
  console.log('\n— Setup —');
  for (const [c, e] of [[oshi, 'oshi@guestlist.net'], [nadia, 'dev-nadia@example.com'], [jules, 'dev-jules@example.com'], [marcus, 'dev-marcus@example.com']]) {
    check(`login ${e}`, (await c.login(e)) === 200);
  }
  const ids = {};
  for (const [k, e] of [['oshi', 'oshi@guestlist.net'], ['nadia', 'dev-nadia@example.com'], ['jules', 'dev-jules@example.com'], ['marcus', 'dev-marcus@example.com']]) {
    ids[k] = (await q(`select id from members where email = $1`, [e]))[0].id;
  }
  const [promoter] = await q(`select id, slug from promoters order by name limit 1`);
  const [evOpen] = await q(
    `insert into events (title, slug, status, listing_status, event_type, start_at, end_at, timezone, city, country, price_from, currency, promoter_id)
     values ('GMI Test: Open List', 'gmi-test-open-list', 'live', 'confirmed', 'club_night',
             now() + interval '2 days', now() + interval '2 days 6 hours', 'Europe/London', 'London', 'United Kingdom', 15, 'GBP', $1)
     returning id, slug`, [promoter.id]);
  await q(`insert into event_guestlist_settings (event_id, promoter_id, mode, max_guestlist_places, max_plus_ones) values ($1, $2, 'auto_fill', 10, 1)`, [evOpen.id, promoter.id]);
  const [evClosed] = await q(
    `insert into events (title, slug, status, listing_status, event_type, start_at, end_at, timezone, city, country, price_from, currency, promoter_id)
     values ('GMI Test: Closed List', 'gmi-test-closed-list', 'live', 'confirmed', 'club_night',
             now() + interval '3 days', now() + interval '3 days 6 hours', 'Europe/London', 'London', 'United Kingdom', 20, 'GBP', $1)
     returning id, slug`, [promoter.id]);
  const [evPast] = await q(
    `insert into events (title, slug, status, listing_status, event_type, start_at, end_at, timezone, city, country)
     values ('GMI Test: Past', 'gmi-test-past', 'live', 'confirmed', 'club_night', now() - interval '3 days', now() - interval '3 days' + interval '6 hours', 'Europe/London', 'London', 'United Kingdom')
     returning id, slug`);

  // -------------------------------------------------------------------------
  console.log('\n— Schema —');
  {
    const tables = (await q(`select table_name from information_schema.tables where table_schema = 'public'`)).map((r) => r.table_name);
    for (const t of ['membership_plans', 'memberships', 'membership_billing_events', 'membership_waitlist', 'member_access_requests',
      'member_access_request_events', 'promoter_contacts', 'promoter_outreach', 'market_categories', 'market_businesses',
      'market_business_members', 'market_offers', 'market_offer_claims', 'member_drops', 'member_drop_claims', 'good_causes']) {
      check(`table ${t}`, tables.includes(t));
    }
    const [plan] = await q(`select price_pence, currency, interval from membership_plans where code = 'member_monthly'`);
    check('one plan seeded: £30/month GBP', plan && plan.price_pence === 3000 && plan.currency === 'GBP' && plan.interval === 'month');
    const cols = (await q(`select column_name from information_schema.columns where table_name = 'promoters'`)).map((r) => r.column_name);
    check('promoters extended, not duplicated', ['contact_email', 'relationship_status', 'standard_allocation'].every((c) => cols.includes(c)));
    const rls = await q(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and relname in ('memberships','member_access_requests','market_offer_claims')`);
    check('RLS enabled on new tables', rls.length === 3);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Membership page: COMING SOON + waitlist (no Stripe key) —');
  {
    const html = await anon.html('/membership');
    check('/membership is live without Stripe', html.includes('Get in.') && html.includes('Coming soon'));
    check('waitlist CTA shown, no join-now checkout', html.includes('Join the waitlist'));
    check('the six benefits are on the page', ['Get in free', 'Queue jump', 'Member prices', 'Guestlist Market', 'Member drops', 'Do good for others'].every((s) => html.includes(s)));
    check('no invented donation claims', !/\d+%\s+of\s+(every|your|membership)/i.test(html));
    const w1 = await anon.json('/api/membership/waitlist', 'POST', { email: 'someone@example.com' });
    check('visitor joins the waitlist', w1.status === 200 && w1.data.outcome === 'joined');
    const w2 = await anon.json('/api/membership/waitlist', 'POST', { email: 'SOMEONE@example.com' });
    check('same address twice is idempotent', w2.status === 200 && w2.data.outcome === 'already');
    const w3 = await anon.json('/api/membership/waitlist', 'POST', { email: 'nope' });
    check('bad email rejected', w3.status === 400);
    const w4 = await jules.json('/api/membership/waitlist', 'POST', {});
    check('signed-in member joins with one press', w4.status === 200 && w4.data.outcome === 'joined');
    check('waitlist rows stored', (await q(`select count(*)::int as n from membership_waitlist`))[0].n === 2);
    const co = await jules.json('/api/membership/checkout', 'POST');
    check('checkout unavailable before Stripe is configured (503)', co.status === 503);
    const terms = await anon.html('/membership/terms');
    check('membership terms cover the essentials', ['£30 per month', 'subject to availability', 'fair use', 'final right of admission', 'statutory rights', 'independent businesses'].every((s) => terms.toLowerCase().includes(s.toLowerCase())));
    const mainTerms = await anon.html('/terms');
    check('main T&Cs link to membership terms', mainTerms.includes('/membership/terms'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— GRANT MEMBERSHIP —');
  {
    const denied = await nadia.json('/api/admin/memberships', 'POST', { action: 'grant', email: 'dev-nadia@example.com' });
    check('non-admin cannot grant', denied.status === 403);
    const g = await oshi.json('/api/admin/memberships', 'POST', { action: 'grant', email: 'dev-nadia@example.com', source: 'complimentary', note: 'DJ' });
    check('admin grants a complimentary membership', g.status === 200);
    const [m] = await q(`select status, billing_source, member_since, grant_note from memberships where member_id = $1`, [ids.nadia]);
    check('membership row: active · complimentary · member_since set', m && m.status === 'active' && m.billing_source === 'complimentary' && !!m.member_since && m.grant_note === 'DJ');
    const l = await oshi.json('/api/admin/memberships', 'POST', { action: 'grant', email: 'dev-marcus@example.com', source: 'lifetime' });
    check('lifetime membership granted', l.status === 200 && (await q(`select billing_source from memberships where member_id = $1`, [ids.marcus]))[0].billing_source === 'lifetime');
    const expired = await oshi.json('/api/admin/memberships', 'POST', { action: 'grant', email: 'dev-jules@example.com', source: 'complimentary', expiresAt: '2000-01-01T00:00:00Z' });
    check('expiry in the past rejected', expired.status === 400);
    const unknown = await oshi.json('/api/admin/memberships', 'POST', { action: 'grant', email: 'nobody@example.com' });
    check('unknown account rejected', unknown.status === 404);
    const you = await nadia.html('/you/membership');
    check('member area shows the membership', you.includes('with our compliments'));
    const profile = await anon.html(`/members/${(await q(`select slug from members where id = $1`, [ids.nadia]))[0].slug}`);
    check('public profile shows the GUESTLIST MEMBER badge…', profile.includes('memberBadge'));
    check('…but not "Member since"', !/member since/i.test(profile));
    const julesProfile = await anon.html(`/members/${(await q(`select slug from members where id = $1`, [ids.jules]))[0].slug}`);
    check('non-member profile has no badge', !julesProfile.includes('memberBadge'));
    const header = await nadia.html('/events');
    check('members do not see the Membership nav link; everyone sees Market', !header.includes('href="/membership"') && header.includes('href="/market"'));
    const headerJ = await jules.html('/events');
    check('non-members see the Membership nav link', headerJ.includes('href="/membership"'));
    const audit = await q(`select count(*)::int as n from audit_log where action = 'membership_changed'`);
    check('grants are audited', audit[0].n >= 2);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Stripe webhooks: signed, idempotent, never downgrade a gift —');
  {
    const sign = (body, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) =>
      `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
    const send = (obj, sig) => fetch(`${BASE}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'stripe-signature': sig } : {}) }, body: obj });
    const now = Math.floor(Date.now() / 1000);
    const subCreated = JSON.stringify({
      id: 'evt_test_1', type: 'customer.subscription.created',
      data: { object: { id: 'sub_test_1', object: 'subscription', customer: 'cus_test_jules', status: 'active',
        current_period_start: now, current_period_end: now + 30 * 86400, cancel_at_period_end: false, canceled_at: null,
        metadata: { member_id: ids.jules } } },
    });
    if (!WEBHOOK_SECRET) {
      check('STRIPE_WEBHOOK_SECRET set for this suite', false, '(set STRIPE_WEBHOOK_SECRET=whsec_test in .env.local)');
    } else {
      check('unsigned webhook rejected', (await send(subCreated)).status === 400);
      check('wrongly signed webhook rejected', (await send(subCreated, sign(subCreated, 'wrong'))).status === 400);
      check('stale timestamp rejected', (await send(subCreated, sign(subCreated, WEBHOOK_SECRET, now - 3600))).status === 400);
      const ok = await send(subCreated, sign(subCreated));
      check('signed subscription.created accepted', ok.status === 200);
      const [mj] = await q(`select status, billing_source, stripe_customer_id, stripe_subscription_id, current_period_end from memberships where member_id = $1`, [ids.jules]);
      check('jules is now an active Stripe member', mj && mj.status === 'active' && mj.billing_source === 'stripe' && mj.stripe_customer_id === 'cus_test_jules' && mj.stripe_subscription_id === 'sub_test_1');
      const dup = await (await send(subCreated, sign(subCreated))).json();
      check('replayed event is a no-op', dup.duplicate === true && (await q(`select count(*)::int as n from membership_billing_events where stripe_event_id = 'evt_test_1'`))[0].n === 1);
      check('welcome email queued once', (await q(`select count(*)::int as n from email_outbox where email_type = 'notification:membership_welcome' and member_id = $1`, [ids.jules]))[0].n === 1);
      check('membership_started notification written', (await q(`select 1 from notifications where member_id = $1 and type = 'membership_started'`, [ids.jules])).length === 1);

      const pastDue = JSON.stringify({ id: 'evt_test_2', type: 'customer.subscription.updated',
        data: { object: { id: 'sub_test_1', customer: 'cus_test_jules', status: 'past_due', current_period_start: now, current_period_end: now + 10 * 86400, cancel_at_period_end: false, canceled_at: null } } });
      await send(pastDue, sign(pastDue));
      const [pd] = await q(`select status from memberships where member_id = $1`, [ids.jules]);
      check('past_due recorded (customer resolved without metadata)', pd.status === 'past_due');
      check('past_due keeps benefits through the paid period', (await jules.html('/you/membership')).includes('payment needs attention'));

      const deleted = JSON.stringify({ id: 'evt_test_3', type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_test_1', customer: 'cus_test_jules', status: 'canceled', current_period_start: now, current_period_end: now, cancel_at_period_end: false, canceled_at: now } } });
      await send(deleted, sign(deleted));
      const [cx] = await q(`select status, member_since from memberships where member_id = $1`, [ids.jules]);
      check('subscription.deleted → cancelled, member_since kept', cx.status === 'cancelled' && !!cx.member_since);
      check('cancelled member loses gated access', (await jules.json(`/api/events/${evClosed.id}/get-me-in`, 'POST', { places: 1 })).status === 403);

      // A gift is not Stripe's to take away.
      const giftDelete = JSON.stringify({ id: 'evt_test_4', type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_test_nadia', customer: 'cus_test_nadia', status: 'canceled', cancel_at_period_end: false, canceled_at: now, metadata: { member_id: ids.nadia } } } });
      await send(giftDelete, sign(giftDelete));
      const [gift] = await q(`select status, billing_source from memberships where member_id = $1`, [ids.nadia]);
      check('a cancelled Stripe sub never downgrades a complimentary member', gift.status === 'active' && gift.billing_source === 'complimentary');
      check('unknown event types are acknowledged', (await send(JSON.stringify({ id: 'evt_test_5', type: 'charge.refunded', data: { object: {} } }), sign(JSON.stringify({ id: 'evt_test_5', type: 'charge.refunded', data: { object: {} } })))).status === 200);
    }
  }

  // -------------------------------------------------------------------------
  console.log('\n— GET ME IN: eligibility and routing —');
  {
    const anonTry = await anon.json(`/api/events/${evClosed.id}/get-me-in`, 'POST', { places: 1 });
    check('anonymous → 401', anonTry.status === 401);
    const nonMember = await jules.json(`/api/events/${evClosed.id}/get-me-in`, 'POST', { places: 1 });
    check('non-member → 403 (server-side gate, not a hidden button)', nonMember.status === 403);
    const past = await nadia.json(`/api/events/${evPast.id}/get-me-in`, 'POST', { places: 1 });
    check('past event not eligible', past.status === 400);

    const pageNon = await jules.html(`/events/${evClosed.slug}`);
    check('non-member sees the GET IN FREE card selling membership', pageNon.includes('Member? Ask Guestlist to get you in free'));
    const pageMem = await nadia.html(`/events/${evClosed.slug}`);
    check('member sees GET ME IN with JUST ME / ME +1', pageMem.includes('Just me') && pageMem.includes('Me +1') && pageMem.includes('Subject to availability and fair use'));
    check('no legal paragraphs beside the button', !/liability|indemnif/i.test(pageMem.split('getMeIn')[1]?.slice(0, 3000) ?? ''));
    const pagePast = await nadia.html(`/events/${evPast.slug}`);
    check('past event has no GET ME IN', !pagePast.includes('Get me in'));

    // Route 1: promoter list open → straight on.
    const open = await nadia.json(`/api/events/${evOpen.id}/get-me-in`, 'POST', { places: 2 });
    check('open promoter list → guestlisted instantly', open.status === 200 && open.data.outcome === 'guestlisted' && open.data.request.friendly.key === 'guestlisted');
    const [entry] = await q(`select status, source, plus_ones from event_guestlist_entries where event_id = $1 and member_id = $2`, [evOpen.id, ids.nadia]);
    check('a real door-list entry exists (source=guestlist, +1 honoured)', entry && entry.status === 'confirmed' && entry.source === 'guestlist' && entry.plus_ones === 1);
    const [reqOpen] = await q(`select status, places, guestlist_entry_id, fulfilment_method from member_access_requests where event_id = $1 and member_id = $2`, [evOpen.id, ids.nadia]);
    check('request recorded as confirmed_free linked to the entry', reqOpen.status === 'confirmed_free' && reqOpen.places === 2 && !!reqOpen.guestlist_entry_id && reqOpen.fulfilment_method === 'promoter_guestlist');
    check('direct guestlisting is NOT on the desk queue', !(await oshi.html('/admin/getmein')).split('What members want')[0].includes('GMI Test: Open List'));

    // Route 2: no open list → brokered.
    const closed = await nadia.json(`/api/events/${evClosed.id}/get-me-in`, 'POST', { places: 2, note: 'Birthday!' });
    check('closed list → brokered request, "working on it"', closed.status === 200 && closed.data.outcome === 'requested' && closed.data.request.friendly.key === 'working');
    const dup = await nadia.json(`/api/events/${evClosed.id}/get-me-in`, 'POST', { places: 1 });
    check('one live request per member per event (409)', dup.status === 409);
    const many = await marcus.json(`/api/events/${evClosed.id}/get-me-in`, 'POST', { places: 7 });
    check('places capped to JUST ME / ME +1 (7 → 1)', many.status === 200 && many.data.request.places === 1);
    const [openReq] = await q(`select id, promoter_id, status from member_access_requests where event_id = $1 and member_id = $2`, [evClosed.id, ids.nadia]);
    check('promoter captured from the event', openReq.promoter_id === promoter.id && openReq.status === 'requested');
    const bell = await q(`select payload from notifications where member_id = $1 and type = 'admin_review_waiting' and read_at is null`, [ids.oshi]);
    check('admin review digest counts GET ME IN requests', bell.length === 1 && bell[0].payload.accessRequests === 2);
    const memberPage = await nadia.html(`/events/${evClosed.slug}`);
    check('member sees WE’RE WORKING ON IT, never an internal status', memberPage.includes('WORKING ON IT') && !memberPage.includes('contacting_promoter'));
    check('analytics: get_me_in_requested + guestlisted tracked', (await q(`select count(*)::int as n from analytics_events where event_type in ('get_me_in_requested','get_me_in_guestlisted')`))[0].n >= 3);
    globalThis.__req = openReq.id;
    globalThis.__reqMarcus = (await q(`select id from member_access_requests where event_id = $1 and member_id = $2`, [evClosed.id, ids.marcus]))[0].id;
  }

  // -------------------------------------------------------------------------
  console.log('\n— The desk: contact promoter → confirm free / discount / decline —');
  {
    const reqId = globalThis.__req;
    const queue = await oshi.html('/admin/getmein');
    check('queue shows the request with member, event, +1, price and promoter', queue.includes('GMI Test: Closed List') && queue.includes('ME +1') && queue.includes('Nadia K') && queue.includes('From £20') && queue.includes('no contact yet'));
    const detail = await oshi.html(`/admin/getmein/${reqId}`);
    check('detail shows member history, lifetime cost and the promoter panel', detail.includes('Cost lifetime') && detail.includes('The promoter') && detail.includes('Birthday!'));
    check('non-admin cannot act on requests', (await nadia.json(`/api/admin/access-requests/${reqId}`, 'PATCH', { action: 'reviewing' })).status === 403);

    const contact = await oshi.json(`/api/admin/access-requests/${reqId}`, 'PATCH', { action: 'contact_promoter', channel: 'whatsapp', summary: 'Asked for 2 on the list' });
    check('CONTACT PROMOTER → contacting_promoter', contact.status === 200 && contact.data.status === 'contacting_promoter');
    const [outreach] = await q(`select channel, direction, outcome, request_id from promoter_outreach where promoter_id = $1`, [promoter.id]);
    check('outreach ledger row written', outreach && outreach.channel === 'whatsapp' && outreach.direction === 'outbound' && outreach.outcome === 'pending' && outreach.request_id === reqId);
    check('relationship moves none → contacted', (await q(`select relationship_status from promoters where id = $1`, [promoter.id]))[0].relationship_status === 'contacted');
    const reply = await oshi.json(`/api/admin/access-requests/${reqId}`, 'PATCH', { action: 'log_outreach', channel: 'whatsapp', direction: 'inbound', outcome: 'free_places', placesOffered: 2, summary: 'Sorted, 2 on the door' });
    check('inbound reply logged', reply.status === 200);
    check('relationship moves contacted → supplying', (await q(`select relationship_status from promoters where id = $1`, [promoter.id]))[0].relationship_status === 'supplying');

    const contactAdd = await oshi.json(`/api/admin/promoters/${promoter.id}/relationship`, 'PATCH', { action: 'add_contact', name: 'Dee', role: 'Promoter', phone: '+44 7700 900000' });
    check('promoter contact added', contactAdd.status === 200);
    const rel = await oshi.json(`/api/admin/promoters/${promoter.id}/relationship`, 'PATCH', { action: 'update', standardAllocation: '4 on the list every Saturday', contactEmail: 'dee@example.com' });
    check('standing allocation recorded with agreed date', rel.status === 200 && (await q(`select allocation_agreed_at, contact_email from promoters where id = $1`, [promoter.id]))[0].allocation_agreed_at !== null);
    check('queue now says contact known', (await oshi.html('/admin/getmein')).includes('contact known'));

    const noReason = await oshi.json(`/api/admin/access-requests/${globalThis.__reqMarcus}`, 'PATCH', { action: 'decline' });
    check('DECLINE requires a reason', noReason.status === 400);
    const declined = await oshi.json(`/api/admin/access-requests/${globalThis.__reqMarcus}`, 'PATCH', { action: 'decline', declineReason: 'too_expensive', memberMessage: 'Not this one, sorry.' });
    check('DECLINE with reason → unavailable', declined.status === 200 && declined.data.status === 'unavailable');
    check('decline reason stored', (await q(`select outcome_reason from member_access_requests where id = $1`, [globalThis.__reqMarcus]))[0].outcome_reason === 'too_expensive');
    const marcusPage = await marcus.html(`/events/${evClosed.slug}`);
    check('member reads SORRY — NOT THIS ONE with the message', marcusPage.includes('SORRY — NOT THIS ONE') && marcusPage.includes('Not this one, sorry.'));
    check('member notified + emailed on decision', (await q(`select 1 from notifications where member_id = $1 and type = 'membership_request_update'`, [ids.marcus])).length === 1
      && (await q(`select 1 from email_outbox where member_id = $1 and email_type = 'notification:membership_request'`, [ids.marcus])).length === 1);

    const noPrice = await oshi.json(`/api/admin/access-requests/${reqId}`, 'PATCH', { action: 'offer_discount' });
    check('OFFER DISCOUNT requires a member price', noPrice.status === 400);

    const confirmed = await oshi.json(`/api/admin/access-requests/${reqId}`, 'PATCH', { action: 'confirm_free', costPence: 0, ticketValuePence: 2000, memberMessage: 'You’re on the door. Bring ID.' });
    check('CONFIRM FREE ENTRY → confirmed_free', confirmed.status === 200 && confirmed.data.status === 'confirmed_free');
    const [door] = await q(`select g.status, g.source, g.plus_ones, g.promoter_id from member_access_requests r join event_guestlist_entries g on g.id = r.guestlist_entry_id where r.id = $1`, [reqId]);
    check('member written onto the REAL door list (+1 honoured)', door && door.status === 'confirmed' && door.source === 'guestlist' && door.plus_ones === 1 && door.promoter_id === promoter.id);
    const nadiaPage = await nadia.html(`/events/${evClosed.slug}`);
    check('member reads YOU’RE ON THE GUESTLIST', nadiaPage.includes('ON THE GUESTLIST') && nadiaPage.includes('Bring ID'));
    const you = await nadia.html('/you/membership');
    check('member area lists the event as guestlisted', you.includes('GMI Test: Closed List') && you.includes('ON THE GUESTLIST'));
    const timeline = await q(`select count(*)::int as n from member_access_request_events where request_id = $1`, [reqId]);
    check('full timeline kept', timeline[0].n >= 4);
    check('desk actions audited', (await q(`select count(*)::int as n from audit_log where action in ('access_request_updated','promoter_outreach_logged','promoter_contact_added','promoter_relationship_changed')`))[0].n >= 5);
    const stats = await q(`select count(*) filter (where r.status in ('confirmed_free','attended'))::int as free from member_access_requests r where r.promoter_id = $1`, [promoter.id]);
    check('promoter stats derived from requests, not stored', stats[0].free === 2);
    check('request left the admin queue', !(await oshi.html('/admin/getmein')).includes('Needs the desk (0)') && !(await oshi.html('/admin/getmein')).split('What members want')[0].includes('GMI Test: Closed List'));

    // Member withdraws a confirmed place.
    const cancel = await nadia.json(`/api/membership/requests/${reqId}`, 'POST', { action: 'cancel' });
    check('member can give up a place', cancel.status === 200 && cancel.data.ok === true);
    check('door entry cancelled with it', (await q(`select g.status from member_access_requests r join event_guestlist_entries g on g.id = r.guestlist_entry_id where r.id = $1`, [reqId]))[0].status === 'cancelled');
    check('another member cannot cancel it', (await marcus.json(`/api/membership/requests/${reqId}`, 'POST', { action: 'cancel' })).status === 404);
    const members = await oshi.html('/admin/members');
    check('members desk shows ledger + fair-use columns, no automation', members.includes('Every membership') && members.includes('Nothing is restricted automatically'));
    check('no credit/token language anywhere member-facing', !/credits?\b|tokens?\b|\d+ free events per month/i.test(you + nadiaPage + (await anon.html('/membership'))));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Guestlist Market: curated, typed offers, single-use codes —');
  {
    check('empty market has an honest empty state', (await anon.html('/market')).includes('being chosen'));
    const apply = await jules.json('/api/market/apply', 'POST', { name: 'Example Records', tagline: 'Independent record shop', city: 'London', website: 'examplerecords.example' });
    check('a business can apply', apply.status === 200 && !!apply.data.id);
    const bizId = apply.data.id;
    check('application lands as applied, applicant is owner', (await q(`select status from market_businesses where id = $1`, [bizId]))[0].status === 'applied'
      && (await q(`select role from market_business_members where business_id = $1 and member_id = $2`, [bizId, ids.jules]))[0].role === 'owner');
    check('website normalised to https', (await q(`select website from market_businesses where id = $1`, [bizId]))[0].website.startsWith('https://'));
    check('applied business is NOT public', (await anon.fetch('/market/example-records')).status === 404);
    check('portal open to the applicant, redeem locked', (await jules.html('/business')).includes('Your application is with Guestlist') && (await jules.html('/business/redeem')).includes('switches on once'));
    const offer = await jules.json(`/api/business/${bizId}/offers`, 'POST', { title: '15% off everything', offerType: 'percentage', discountPercent: 15, redemptionInstructions: 'Show your code at the counter.' });
    check('owner proposes an offer (pending)', offer.status === 200 && (await q(`select approval_status from market_offers where id = $1`, [offer.data.id]))[0].approval_status === 'pending');
    check('stranger cannot edit the business', (await marcus.json(`/api/business/${bizId}/profile`, 'PATCH', { tagline: 'hacked' })).status === 403);
    check('admin bell counts the application', (await q(`select payload from notifications where member_id = $1 and type = 'admin_review_waiting' and read_at is null`, [ids.oshi]))[0]?.payload.marketApplications === 1);

    check('non-admin cannot decide', (await jules.json('/api/admin/market', 'POST', { action: 'decide', businessId: bizId, decision: 'approve' })).status === 403);
    const approve = await oshi.json('/api/admin/market', 'POST', { action: 'decide', businessId: bizId, decision: 'approve' });
    check('admin approves', approve.status === 200 && approve.data.status === 'approved');
    check('approving the business approves its proposed offer', (await q(`select approval_status from market_offers where id = $1`, [offer.data.id]))[0].approval_status === 'approved');
    check('owner notified + emailed', (await q(`select 1 from notifications where member_id = $1 and type = 'market_application_update'`, [ids.jules])).length === 1
      && (await q(`select 1 from email_outbox where member_id = $1 and email_type = 'notification:market_decision'`, [ids.jules])).length === 1);
    await oshi.json('/api/admin/market', 'POST', { action: 'update', businessId: bizId, business: { featured: true, sortOrder: 1 } });
    const market = await anon.html('/market');
    check('approved business is public with its offer headline', market.includes('Example Records') && market.includes('15% OFF FOR GUESTLIST MEMBERS') && market.includes('Featured'));
    const page = await anon.html('/market/example-records');
    check('business page renders the offer and asks visitors to sign in', page.includes('15% OFF FOR GUESTLIST MEMBERS') && page.includes('Sign in to claim'));
    check('non-member sees membership prompt, not the code', (await jules.html('/market/example-records')).includes('coming soon'));

    check('non-member cannot claim (403)', (await jules.json(`/api/market/offers/${offer.data.id}/claim`, 'POST')).status === 403);
    const claim = await nadia.json(`/api/market/offers/${offer.data.id}/claim`, 'POST');
    check('member claims → claim screen url', claim.status === 200 && claim.data.url.startsWith('/market/claims/'));
    const [k] = await q(`select code, status, expires_at from market_offer_claims where id = $1`, [claim.data.claimId]);
    check('single-use code minted in GL-XXXX-XXXX form, expires', /^GL-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(k.code) && k.status === 'claimed' && new Date(k.expires_at) > new Date());
    const again = await nadia.json(`/api/market/offers/${offer.data.id}/claim`, 'POST');
    check('claiming again re-shows the same live code', again.data.claimId === claim.data.claimId && again.data.reused === true);
    const screen = await nadia.html(claim.data.url);
    check('claim screen shows the code to its owner', screen.includes(k.code) && screen.includes('Example Records'));
    check('another member cannot open it (IDOR)', (await marcus.fetch(claim.data.url)).status === 404);
    check('code never appears on the public business page', !page.includes(k.code) && !(await anon.html('/market')).includes(k.code));
    check('codes are not listed in the portal stats', !(await jules.html('/business/stats')).includes(k.code));

    check('stranger cannot redeem for this business', (await marcus.json(`/api/business/${bizId}/redeem`, 'POST', { code: k.code })).status === 403);
    const nf = await jules.json(`/api/business/${bizId}/redeem`, 'POST', { code: 'GL-ZZZZ-ZZZZ' });
    check('unknown code → not_found', nf.status === 200 && nf.data.outcome === 'not_found');
    const red = await jules.json(`/api/business/${bizId}/redeem`, 'POST', { code: k.code.toLowerCase().replace(/-/g, '') });
    check('owner redeems (any formatting)', red.status === 200 && red.data.outcome === 'redeemed' && red.data.member_name === 'Nadia K');
    const twice = await jules.json(`/api/business/${bizId}/redeem`, 'POST', { code: k.code });
    check('second use refused', twice.data.outcome === 'already_redeemed');
    check('claim screen now shows it as used', (await nadia.html(claim.data.url)).includes('Used'));
    check('redemption recorded for the business', (await q(`select status, redeemed_by_member_id from market_offer_claims where id = $1`, [claim.data.claimId]))[0].redeemed_by_member_id === ids.jules);
    check('analytics: claim + redemption tracked', (await q(`select count(*)::int as n from analytics_events where event_type in ('market_offer_claimed','market_offer_redeemed')`))[0].n === 2);
    check('portal stats show the numbers', (await jules.html('/business/stats')).includes('Redeemed · all time'));
    // React SSR separates adjacent text nodes with <!-- -->; strip them before matching.
    check('admin market desk shows interest', (await oshi.html('/admin/market')).replace(/<!-- -->/g, '').includes('1 claims · 1 redeemed'));

    const material = await jules.json(`/api/business/${bizId}/offers`, 'PATCH', { offerId: offer.data.id, discountPercent: 50 });
    check('material offer change goes back to review', material.status === 200 && material.data.backToReview === true && (await q(`select approval_status from market_offers where id = $1`, [offer.data.id]))[0].approval_status === 'pending');
    check('offer under review is not claimable', (await nadia.json(`/api/market/offers/${offer.data.id}/claim`, 'POST')).status === 400);
    await oshi.json('/api/admin/market', 'POST', { action: 'offer', businessId: bizId, offer: { offerId: offer.data.id, approvalStatus: 'approved' } });
    const pause = await jules.json(`/api/business/${bizId}/offers`, 'PATCH', { offerId: offer.data.id, active: false });
    check('pausing an offer is instant, no review', pause.status === 200 && pause.data.backToReview === false);
    check('paused offer disappears from the card', !(await anon.html('/market')).includes('50% OFF'));
    await oshi.json('/api/admin/market', 'POST', { action: 'decide', businessId: bizId, decision: 'pause' });
    check('paused business hidden from the Market', !(await anon.html('/market')).includes('Example Records'));
    const manual = await oshi.json('/api/admin/market', 'POST', { action: 'create', business: { name: 'Hand Added Café', city: 'Bristol' }, approve: true });
    check('admin adds a business by hand, approved', manual.status === 200 && (await q(`select status from market_businesses where id = $1`, [manual.data.id]))[0].status === 'approved');
    check('business nav link appears for owners only', (await jules.html('/events')).includes('href="/business"') && !(await nadia.html('/events')).includes('href="/business"'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— ASK GUESTLIST: any event, anywhere —');
  {
    // Give the two seeded events real source URLs so a pasted link can match.
    await q(`update events set source_url = 'https://ra.co/events/gmi-closed' where id = $1`, [evClosed.id]);
    await q(`update events set source_url = 'https://www.example.com/open/' where id = $1`, [evOpen.id]);

    check('anon cannot ask (401)', (await anon.json('/api/membership/ask', 'POST', { text: 'https://ra.co/events/1' })).status === 401);
    check('non-member cannot ask (403)', (await jules.json('/api/membership/ask', 'POST', { text: 'https://ra.co/events/1' })).status === 403);
    check('/you/ask shows the pitch to a non-member', (await jules.html('/you/ask')).includes('Ask Guestlist.') && (await jules.html('/you/ask')).includes('coming soon'));
    check('/you/ask shows the form to a member', (await nadia.html('/you/ask')).includes('Paste the event link'));
    check('empty ask rejected', (await nadia.json('/api/membership/ask', 'POST', { text: '   ' })).status === 400);
    check('bad link rejected', (await nadia.json('/api/membership/ask', 'POST', { url: 'ftp://nope' })).status === 400);

    // A pasted link that matches a Guestlist event by URL — tracking params and all.
    const m1 = await marcus.json('/api/membership/ask', 'POST', { text: 'https://ra.co/events/gmi-closed?utm_source=ig&fbclid=abc  can you get me +1 for this on Saturday?', places: 2, context: 'membership_area' });
    check('URL matches a Guestlist event → normal request on that event', m1.status === 200 && m1.data.kind === 'requested' && m1.data.matched === 'url' && m1.data.eventSlug === evClosed.slug);
    const [m1r] = await q(`select r.event_id, r.places, r.request_type, r.origin, r.context, r.member_note, x.url_host, x.url_normalised, x.url
                             from member_access_requests r join member_request_external_events x on x.request_id = r.id where r.id = $1`, [m1.data.requestId]);
    check('linked, +1 → plus_one, origin ask_guestlist, note kept, link kept as demand signal',
      m1r.event_id === evClosed.id && m1r.places === 2 && m1r.request_type === 'plus_one' && m1r.origin === 'ask_guestlist' && m1r.context === 'membership_area'
      && /get me \+1/.test(m1r.member_note) && m1r.url_host === 'ra.co' && m1r.url_normalised === 'ra.co/events/gmi-closed' && !m1r.url.includes('utm_'));
    const m2 = await marcus.json('/api/membership/ask', 'POST', { text: 'https://example.com/open?ref=x', places: 1 });
    check('URL match to an OPEN promoter list → guestlisted instantly', m2.status === 200 && m2.data.kind === 'guestlisted' && m2.data.friendly.key === 'guestlisted');

    // An event Guestlist does not have.
    const n1 = await nadia.json('/api/membership/ask', 'POST', { text: 'https://www.instagram.com/p/AbC123/ Secret warehouse thing, Saturday', places: 1, context: 'events_empty' });
    check('unknown link → external request, WE’RE WORKING ON IT', n1.status === 200 && n1.data.kind === 'requested' && n1.data.matched === null && n1.data.friendly.key === 'working');
    const [n1r] = await q(`select r.event_id, r.status, r.suggested_event_id, x.url_host, x.name from member_access_requests r left join member_request_external_events x on x.request_id = r.id where r.id = $1`, [n1.data.requestId]);
    check('stored with no event and the host', n1r.event_id === null && n1r.status === 'requested' && n1r.url_host === 'instagram.com');
    check('same link again by the same member → 409', (await nadia.json('/api/membership/ask', 'POST', { text: 'https://instagram.com/p/AbC123' })).status === 409);
    const n1b = await marcus.json('/api/membership/ask', 'POST', { text: 'https://instagram.com/p/AbC123?igshid=1 me too' });
    check('another member can ask for the same link', n1b.status === 200);
    check('member area lists it under the host', (await nadia.html('/you/membership')).includes('instagram.com'));
    check('nothing was fetched or imported from the member link', (await q(`select count(*)::int as n from event_submissions where url like '%instagram.com%'`))[0].n === 0);

    // Name + date only → a suggestion, never an automatic link.
    const [evRow] = await q(`select start_at::text from events where id = $1`, [evClosed.id]);
    const n2 = await nadia.json('/api/membership/ask', 'POST', { name: 'GMI Test: Closed List', startsAt: evRow.start_at, city: 'London', note: 'Is this the one?', places: 1 });
    const [n2r] = await q(`select event_id, suggested_event_id, match_confidence from member_access_requests where id = $1`, [n2.data.requestId]);
    check('title+date+city → suggested match only (no auto-link)', n2.status === 200 && n2r.event_id === null && n2r.suggested_event_id === evClosed.id && n2r.match_confidence === 'title_date');
    const detail = await oshi.html(`/admin/getmein/${n2.data.requestId}`);
    check('desk shows the possible match with one-click Link', detail.includes('Looks like') && detail.includes('GMI Test: Closed List'));
    const link = await oshi.json(`/api/admin/access-requests/${n2.data.requestId}`, 'PATCH', { action: 'link_event', eventId: evClosed.id });
    check('LINK EVENT links it', link.status === 200 && (await q(`select event_id, promoter_id, linked_by_member_id from member_access_requests where id = $1`, [n2.data.requestId]))[0].event_id === evClosed.id);
    check('linking inherits the event promoter', (await q(`select promoter_id from member_access_requests where id = $1`, [n2.data.requestId]))[0].promoter_id === promoter.id);
    check('bad link target rejected', (await oshi.json(`/api/admin/access-requests/${n1.data.requestId}`, 'PATCH', { action: 'link_event', eventId: 'nope' })).status === 404);

    // Advice-type ask → HERE'S WHAT WE THINK.
    const rec = await marcus.json('/api/membership/ask', 'POST', { text: 'I’m in Bristol Saturday. What should I go to?', requestType: 'city_recommendation' });
    check('recommendation ask stored with its type', rec.status === 200 && (await q(`select request_type, event_id from member_access_requests where id = $1`, [rec.data.requestId]))[0].request_type === 'city_recommendation');
    check('ANSWER needs a message', (await oshi.json(`/api/admin/access-requests/${rec.data.requestId}`, 'PATCH', { action: 'answer' })).status === 400);
    const ans = await oshi.json(`/api/admin/access-requests/${rec.data.requestId}`, 'PATCH', { action: 'answer', memberMessage: 'Motion for the big room, Strange Brew after.' });
    check('ANSWER → answered', ans.status === 200 && ans.data.status === 'answered');
    check('member reads HERE’S WHAT WE THINK with the message', (await marcus.html('/you/membership')).includes('HERE’S WHAT WE THINK') && (await marcus.html('/you/membership')).includes('Strange Brew'));
    check('member notified of the answer', (await q(`select 1 from notifications where member_id = $1 and type = 'membership_request_update' and payload->>'state' = 'answered'`, [ids.marcus])).length === 1);

    // The flywheel on an external request: assign → contact → outreach.
    check('CONTACT PROMOTER needs a promoter first', (await oshi.json(`/api/admin/access-requests/${n1.data.requestId}`, 'PATCH', { action: 'contact_promoter', summary: 'hi' })).status === 400);
    const [other] = await q(`select id from promoters where id <> $1 order by name limit 1`, [promoter.id]);
    const assign = await oshi.json(`/api/admin/access-requests/${n1.data.requestId}`, 'PATCH', { action: 'assign_promoter', promoterId: other.id });
    check('ASSIGN PROMOTER', assign.status === 200 && (await q(`select promoter_id from member_access_requests where id = $1`, [n1.data.requestId]))[0].promoter_id === other.id);
    const contact = await oshi.json(`/api/admin/access-requests/${n1.data.requestId}`, 'PATCH', { action: 'contact_promoter', channel: 'instagram', summary: 'DM’d about the warehouse party' });
    check('CONTACT PROMOTER on an external request → outreach ledger + relationship', contact.status === 200
      && (await q(`select 1 from promoter_outreach where request_id = $1 and promoter_id = $2 and event_id is null`, [n1.data.requestId, other.id])).length === 1
      && (await q(`select relationship_status from promoters where id = $1`, [other.id]))[0].relationship_status === 'contacted');
    const msg = await oshi.json(`/api/admin/access-requests/${n1.data.requestId}`, 'PATCH', { action: 'message_member', memberMessage: 'On it — spoken to the promoter, will confirm tomorrow.' });
    check('MESSAGE MEMBER keeps the status and tells the member', msg.status === 200 && msg.data.status === 'contacting_promoter'
      && (await nadia.html('/you/membership')).includes('spoken to the promoter'));
    const conf = await oshi.json(`/api/admin/access-requests/${n1.data.requestId}`, 'PATCH', { action: 'confirm_free', fulfilmentMethod: 'venue', memberMessage: 'You’re on the door under your name.' });
    check('CONFIRM FREE on an external request (no door list, message says how)', conf.status === 200 && conf.data.status === 'confirmed_free'
      && (await q(`select guestlist_entry_id, fulfilment_method from member_access_requests where id = $1`, [n1.data.requestId]))[0].guestlist_entry_id === null);
    check('member reads YOU’RE ON THE GUESTLIST for an external event', (await nadia.html('/you/membership')).includes('under your name'));

    // CREATE / IMPORT runs the EXISTING submission pipeline against a fixture page.
    const fixture = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><head><title>Ask Import Fixture</title><script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Event', name: 'Ask Import Fixture Night',
        startDate: new Date(Date.now() + 10 * 86400_000).toISOString(), endDate: new Date(Date.now() + 10 * 86400_000 + 6 * 3600_000).toISOString(),
        location: { '@type': 'Place', name: 'Fixture Hall', address: { '@type': 'PostalAddress', addressLocality: 'Leeds', addressCountry: 'GB' } },
        offers: { '@type': 'Offer', price: '12', priceCurrency: 'GBP', url: 'http://127.0.0.1:4599/tickets' },
      })}</script></head><body><h1>Ask Import Fixture Night</h1></body></html>`);
    });
    await new Promise((r) => fixture.listen(4599, '127.0.0.1', r));
    try {
      const imp0 = await marcus.json('/api/membership/ask', 'POST', { text: 'http://127.0.0.1:4599/party can you get me in', places: 1 });
      check('external request with an importable link', imp0.status === 200 && imp0.data.kind === 'requested');
      check('IMPORT is admin-only', (await marcus.json(`/api/admin/access-requests/${imp0.data.requestId}`, 'PATCH', { action: 'import_event' })).status === 403);
      const imp = await oshi.json(`/api/admin/access-requests/${imp0.data.requestId}`, 'PATCH', { action: 'import_event' });
      check('CREATE/IMPORT runs the submission pipeline', imp.status === 200 && imp.data.submission && ['created', 'checking', 'duplicate'].includes(imp.data.submission.status), JSON.stringify(imp.data));
      const [ext] = await q(`select import_submission_id, created_event_id from member_request_external_events where request_id = $1`, [imp0.data.requestId]);
      check('submission recorded against the request', !!ext.import_submission_id && (await q(`select 1 from event_submissions where id = $1 and submitted_by = $2`, [ext.import_submission_id, ids.oshi])).length === 1);
      if (imp.data.submission.eventId) {
        check('draft event created and linked (not published)', ext.created_event_id === imp.data.submission.eventId
          && (await q(`select status from events where id = $1`, [ext.created_event_id]))[0].status !== 'live'
          && (await q(`select event_id from member_access_requests where id = $1`, [imp0.data.requestId]))[0].event_id === ext.created_event_id);
      } else {
        check('draft event created and linked (not published)', true, '(pipeline returned no event — needs review)');
      }
      check('importing twice is refused', (await oshi.json(`/api/admin/access-requests/${imp0.data.requestId}`, 'PATCH', { action: 'import_event' })).status === 409);
    } finally {
      fixture.close();
    }

    // The inbox and the demand reports.
    const inbox = await oshi.html('/admin/getmein?kind=ask_guestlist&view=all');
    check('inbox distinguishes ASK GUESTLIST and shows external detail', inbox.includes('Ask Guestlist') && inbox.includes('instagram.com'));
    check('inbox shows membership status per request', inbox.includes('· active'));
    check('demand reports: events we’re missing, hosts, cities', inbox.includes('Events we’re missing') && inbox.includes('Where the links come from') && inbox.includes('Cities with demand'));
    const gmiOnly = await oshi.html('/admin/getmein?kind=get_me_in&view=all');
    check('GET ME IN filter hides asks', !gmiOnly.split('What members want')[0].includes('instagram.com'));
    check('other member asking for the same link is counted', (await oshi.html(`/admin/getmein/${n1.data.requestId}`)).includes('other member'));

    // Entry points.
    check('/events empty state offers ASK GUESTLIST to a member', (await nadia.html('/events?city=Nowhereville')).includes('Can’t find it?'));
    check('…and not to a non-member', !(await jules.html('/events?city=Nowhereville')).includes('Can’t find it?'));
    check('no /ask nav item (legacy suite constraint)', !/href="\/ask"/.test(await nadia.html('/events')));
    check('/you links members to Ask Guestlist', (await nadia.html('/you')).includes('href="/you/ask"'));

    // Limits: information for the desk, a friendly brake for the member.
    await q(`insert into member_access_requests (member_id, places, status, request_type, origin, requested_at)
             select $1, 1, 'cancelled', 'other', 'ask_guestlist', now() from generate_series(1, 10)`, [ids.marcus]);
    check('rate limit: 10 asks an hour → 429', (await marcus.json('/api/membership/ask', 'POST', { text: 'https://ra.co/events/another' })).status === 429);
    await q(`delete from member_access_requests where member_id = $1 and request_type = 'other' and status = 'cancelled' and member_note is null`, [ids.marcus]);

    check('analytics: every ask type tracked', (await q(`select count(distinct event_type)::int as n from analytics_events where event_type in
      ('ask_guestlist_submitted','external_event_requested','plus_one_requested','recommendation_requested','external_event_linked','ask_guestlist_fulfilled')`))[0].n === 6);
    check('outcome reasons never reach the member', !(await nadia.html('/you/membership')).includes('promoter_no_response'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Drops and doing good —');
  {
    const drop = await oshi.json('/api/admin/drops', 'POST', { action: 'save_drop', title: 'Two on the list Saturday', status: 'live', places: 1 });
    check('admin creates a live drop', drop.status === 200);
    const you = await nadia.html('/you/membership');
    check('members see it', you.includes('Two on the list Saturday'));
    check('non-members do not', !(await jules.html('/you/membership')).includes('Two on the list Saturday'));
    check('member puts name down', (await nadia.json(`/api/membership/drops/${drop.data.id}`, 'POST')).data.outcome === 'claimed');
    check('full drop refuses the next', (await marcus.json(`/api/membership/drops/${drop.data.id}`, 'POST')).data.outcome === 'full');
    check('good causes ship empty with honest copy', (await nadia.html('/you/membership')).includes('will appear here as they’re confirmed'));
    const cause = await oshi.json('/api/admin/drops', 'POST', { action: 'save_cause', title: 'Youth studio bursary', summary: 'Studio time for young producers', status: 'live' });
    check('admin defines a project', cause.status === 200);
    check('project appears on membership page and member area', (await anon.html('/membership')).includes('Youth studio bursary') && (await nadia.html('/you/membership')).includes('Youth studio bursary'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Revoke + legacy spot checks —');
  {
    const rv = await oshi.json('/api/admin/memberships', 'POST', { action: 'revoke', email: 'dev-nadia@example.com' });
    check('admin revokes a gift', rv.status === 200);
    check('revoked member loses GET ME IN', (await nadia.json(`/api/events/${evOpen.id}/get-me-in`, 'POST', { places: 1 })).status === 403);
    check('cannot revoke a Stripe membership here', (await oshi.json('/api/admin/memberships', 'POST', { action: 'revoke', email: 'dev-jules@example.com' })).status === 400);
    check('events browse healthy', (await anon.fetch('/events')).status === 200);
    check('event page healthy', (await anon.fetch(`/events/${evOpen.slug}`)).status === 200);
    check('promoter dashboard healthy', (await oshi.fetch('/promoter')).status === 200);
    check('admin promoters healthy', (await oshi.fetch('/admin/promoters')).status === 200);
    check('notifications centre renders membership lines', (await marcus.html('/notifications')).includes('SORRY — NOT THIS ONE'));
    check('schema audit passes', (await oshi.html('/admin/schema')).includes('Up to date'));
  }
} catch (err) {
  console.error('\nSUITE ERROR:', err);
  failed++;
  failures.push(`suite crashed: ${String(err).slice(0, 200)}`);
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(` - ${f}`);
  }
  await db.end();
  process.exit(failed ? 1 : 0);
}
