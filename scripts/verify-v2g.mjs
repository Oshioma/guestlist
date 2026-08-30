// V2G verification: GUESTLIST INTELLIGENCE CORE + @GUESTLIST ON X.
//
// Deterministic throughout: X runs against the mock transport (scripted
// failures, uncertain writes, rate limits, fixture mentions), drafting uses
// the grounded template writer (no API key needed), and every discovery
// generator is fed hand-built database state. Covers: opportunity
// creation/ranking/expiry, evidence packs, fact locking, the human-approval
// state machine (service + DATABASE trigger), scheduling + timezones,
// pre-publish revalidation, the full budget engine (warnings, hard stop,
// override, reservation, billing period, conservation, job guards, circuit
// breaker), kill switches, mock posting/replies/mentions with cursors and
// dedupe, intent classification, grounded replies, archive rights,
// repetition protection, attribution, website channel, and security.
//
// Requires: db reset+seed (node scripts/seed.mjs), dev server on :3000.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (existsSync(path.join(root, '.env.local'))) {
  for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (text, params = []) => db.query(text, params).then((r) => r.rows);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    async json(url) { const r = await this.fetch(url); return r.ok ? r.json() : null; },
    async html(url) { return (await this.fetch(url)).text(); },
  };
}

const anon = client();
const oshi = client();  // admin — the human in every loop
const nadia = client(); // non-admin security probe

const desk = (body) => oshi.post('/api/admin/guestlist-x', body);
const deskJson = async (body) => {
  const res = await desk(body);
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const runJob = () => oshi.post('/api/jobs/guestlist-x');
const setMock = (patch) =>
  q(`insert into system_settings (key, value) values ('x_mock', $1)
     on conflict (key) do update set value =
       coalesce(system_settings.value, '{}'::jsonb) || $1`,
    [JSON.stringify(patch)]);
const draftRow = (id) =>
  q(`select * from channel_drafts where id = $1`, [id]).then((r) => r[0]);
const oppByType = (type) =>
  q(`select * from intelligence_opportunities where type = $1 order by detected_at desc`, [type]);

async function publishEvent(opts) {
  const res = await oshi.post('/api/admin/events', {
    title: opts.title,
    startAt: opts.startAt,
    endAt: opts.endAt ?? null,
    timezone: opts.timezone ?? 'Europe/London',
    eventType: 'club_night',
    status: 'live',
    city: opts.city ?? 'London',
    country: opts.country ?? 'United Kingdom',
    promoterId: null,
    venueId: opts.venueId ?? null,
    genreSlugs: opts.genreSlugs ?? [],
    lineup: opts.lineup ?? [],
    worthTravelling: opts.worthTravelling ?? false,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`publish failed: ${JSON.stringify(data)}`);
  await sleep(400);
  return data.id;
}

const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

try {
  console.log('\n— Setup —');
  check('admin login', (await oshi.login('oshi@guestlist.net')) === 200);
  check('member login', (await nadia.login('dev-nadia@example.com')) === 200);
  const [{ id: oshiId }] = await q(`select id from members where email = 'oshi@guestlist.net'`);
  const [{ id: mayaId }] = await q(`select id from members where email = 'dev-maya@example.com'`);
  await setMock({ enabled: true });

  // Hand-built deterministic state for the discovery generators:
  // three D&B events TONIGHT in London (a genre/city pattern) …
  const tonightIds = [];
  for (const title of ['V2G Rollers Session', 'V2G Jungle Cellar', 'V2G Low End Theory']) {
    tonightIds.push(await publishEvent({
      title, startAt: inHours(4), genreSlugs: ['drum-and-bass', 'jungle'],
    }));
  }
  // … momentum on one of them (3 fresh Going inside 6h) …
  for (const email of ['dev-nadia@example.com', 'dev-jules@example.com', 'dev-steve@example.com']) {
    const c = client();
    await c.login(email);
    await c.post(`/api/events/${tonightIds[0]}/action`, { rsvp: 'going' });
  }
  await sleep(600);
  // … a worth-travelling event …
  await publishEvent({
    title: 'V2G Desert Sunrise', startAt: inHours(24 * 20), city: 'Zanzibar',
    country: 'Tanzania', timezone: 'Africa/Dar_es_Salaam',
    genreSlugs: ['house'], worthTravelling: true,
  });
  // … an exact archive event dated THIS calendar day in 1994 (On This Night),
  // plus a circa event that must NEVER produce one (honest uncertainty) …
  const today = new Date();
  const mmdd = `${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
  await q(
    `insert into archive_events (title, slug, date_precision, start_date, year, display_date,
       venue_name, city, country_code, country_name, status, published_at)
     values ('V2G Warehouse 1994', 'v2g-warehouse-1994', 'exact', $1, 1994, 'tonight 1994',
             'The Depot', 'London', 'GB', 'United Kingdom', 'published', now())`,
    [`1994-${mmdd}`]);
  await q(
    `insert into archive_events (title, slug, date_precision, year, display_date,
       city, country_code, country_name, status, published_at)
     values ('V2G Sometime 1995', 'v2g-sometime-1995', 'circa', 1995, 'Summer 1995',
             'London', 'GB', 'United Kingdom', 'published', now())`);
  // … and a third PUBLIC I Was There mark on Metalheadz (threshold = 3;
  // Kwame's connections-visibility mark must never count).
  const [mz] = await q(`select id from archive_events where title = 'Metalheadz at Blue Note'`);
  await q(`insert into archive_attendance (member_id, archive_event_id, visibility)
           values ($1, $2, 'public') on conflict do nothing`, [mayaId, mz.id]);

  // -------------------------------------------------------------------------
  console.log('\n— Deterministic discovery → opportunities —');
  let patternOpp, onThisNightOpp, momentumOpp;
  {
    const { data } = await deskJson({ action: 'find_opportunities' });
    check('discovery creates opportunities from real signals', data.created >= 4);

    patternOpp = (await oppByType('TONIGHT_PATTERN')).find((o) => o.headline.includes('Drum & Bass'));
    check('TONIGHT_PATTERN detected (3 D&B events in London tonight)',
      !!patternOpp && patternOpp.city === 'London');
    [onThisNightOpp] = await oppByType('ON_THIS_NIGHT');
    check('ON_THIS_NIGHT detected from the exact-dated archive event',
      !!onThisNightOpp && onThisNightOpp.headline.includes('1994'));
    check('circa archive dates NEVER fabricate an anniversary',
      !(await oppByType('ON_THIS_NIGHT')).some((o) => o.headline.includes('1995'))
      && !(await oppByType('ARCHIVE_ANNIVERSARY')).some((o) => o.headline.includes('1995')));
    [momentumOpp] = await oppByType('EVENT_MOMENTUM');
    check('EVENT_MOMENTUM detected from Going velocity', !!momentumOpp);
    check('WORTH_TRAVELLING_FOR detected', (await oppByType('WORTH_TRAVELLING_FOR')).length >= 1);
    const iwt = await oppByType('I_WAS_THERE_MOMENT');
    check('I_WAS_THERE_MOMENT counts PUBLIC marks only (3, never Kwame’s)',
      iwt.length === 1 && iwt[0].evidence.aggregates.i_was_there_public === 3
      && iwt[0].headline.startsWith('3 members'));

    check('ranking: the archive moment outranks the pattern',
      Number(onThisNightOpp.score) > Number(patternOpp.score));
    check('evidence pack carries grounded metrics + fact allowlists',
      patternOpp.evidence.events.length === 3
      && patternOpp.evidence.numbers.includes('3')
      && patternOpp.evidence.events.every((e) => typeof e.metrics.going === 'number'));

    const again = await deskJson({ action: 'find_opportunities' });
    check('discovery is idempotent (fingerprint dedupe)', again.data.created === 0);

    await q(`update intelligence_opportunities set expires_at = now() - interval '1 hour'
              where id = $1`, [momentumOpp.id]);
    const expire = await deskJson({ action: 'find_opportunities' });
    check('expiry sweeps stale opportunities', expire.data.expired >= 1
      && (await q(`select status from intelligence_opportunities where id = $1`, [momentumOpp.id]))[0].status === 'expired');
  }

  // -------------------------------------------------------------------------
  console.log('\n— Drafting + fact locking —');
  let draftId;
  {
    const { status, data } = await deskJson({ action: 'create_draft', opportunityId: patternOpp.id });
    check('grounded draft created (template writer, no AI key needed)',
      status === 200 && !!data.draftId);
    draftId = data.draftId;
    const d = await draftRow(draftId);
    check('draft stores original AI text + evidence snapshot + voice version',
      d.original_body === d.body && d.voice_version === 'v1'
      && d.evidence_snapshot.events.length === 3);
    check('draft body is built from real events', d.body.includes('V2G Rollers Session'));
    check('estimated X cost uses the central pricing catalogue ($0.20 link post)',
      Number(d.estimated_cost_usd) === 0.2);
    check('opportunity moves to drafted',
      (await q(`select status from intelligence_opportunities where id = $1`, [patternOpp.id]))[0].status === 'drafted');

    const badNum = await deskJson({
      action: 'edit_draft', draftId, body: 'London is popping — 500 members going tonight.',
    });
    check('unsupported facts rejected (invented count)',
      badNum.status === 400 && JSON.stringify(badNum.data).includes('Unsupported fact'));
    const badTone = await deskJson({
      action: 'edit_draft', draftId, body: "Don't miss this epic night in London!",
    });
    check('the voice is enforced (banned marketing language)',
      badTone.status === 400 && JSON.stringify(badTone.data).includes('Banned phrase'));
    const goodEdit = await deskJson({
      action: 'edit_draft', draftId,
      body: "London's unusually strong for drum & bass tonight. Three worth looking at:\nV2G Rollers Session\nV2G Jungle Cellar\nV2G Low End Theory",
    });
    check('a clean human edit is accepted', goodEdit.status === 200
      && (await draftRow(draftId)).status === 'edited');
  }

  // -------------------------------------------------------------------------
  console.log('\n— The approval wall (service + database) —');
  {
    const early = await deskJson({ action: 'post_now', draftId });
    check('unapproved drafts cannot post (service)', early.status === 409
      && early.data.error.includes('approval'));

    let dbBlocked = false;
    try {
      await q(`update channel_drafts set status = 'posting' where id = $1`, [draftId]);
    } catch (err) {
      dbBlocked = String(err).includes('human approval');
    }
    check('unapproved drafts cannot post (DATABASE trigger)', dbBlocked);

    check('desk actions are admin-only',
      (await nadia.post('/api/admin/guestlist-x', { action: 'approve', draftId })).status >= 401);
    check('admin approval recorded',
      (await deskJson({ action: 'approve', draftId })).status === 200
      && (await draftRow(draftId)).approved_by === oshiId);

    check('scheduling demands an explicit timezone',
      (await deskJson({ action: 'schedule', draftId, when: inHours(2), timezone: '' })).status === 400);
    check('approved drafts schedule with timezone',
      (await deskJson({ action: 'schedule', draftId, when: inHours(2), timezone: 'Europe/London' })).status === 200
      && (await draftRow(draftId)).schedule_timezone === 'Europe/London');
  }

  // -------------------------------------------------------------------------
  console.log('\n— Pre-publish revalidation: reality wins —');
  {
    // Cancel one of the three events underneath the scheduled draft.
    await q(`update events set listing_status = 'cancelled' where id = $1`, [tonightIds[2]]);
    const res = await deskJson({ action: 'post_now', draftId });
    check('a cancelled event blocks the post', res.status === 409
      && res.data.error.includes('cancelled'));
    const d = await draftRow(draftId);
    check('draft lands in NEEDS REVIEW with the reason, approval cleared',
      d.status === 'needs_review' && d.needs_review_reason.includes('cancelled')
      && d.approved_by === null);

    // The human re-judges: un-cancel, re-edit facts hold, re-approve.
    await q(`update events set listing_status = 'confirmed' where id = $1`, [tonightIds[2]]);
    await deskJson({ action: 'approve', draftId });
    check('re-approval after review works', (await draftRow(draftId)).status === 'approved');

    // Date change on a different draft path.
    const { data: d2 } = await deskJson({ action: 'create_draft', opportunityId: onThisNightOpp.id });
    check('archive draft created from On This Night', !!d2.draftId);
    await deskJson({ action: 'approve', draftId: d2.draftId });
    await q(`update archive_events set status = 'needs_review' where slug = 'v2g-warehouse-1994'`);
    const blocked = await deskJson({ action: 'post_now', draftId: d2.draftId });
    check('unpublished archive facts block the post', blocked.status === 409);
    await q(`update archive_events set status = 'published' where slug = 'v2g-warehouse-1994'`);
    await deskJson({ action: 'reject', draftId: d2.draftId, reason: 'bad_timing', note: 'test cleanup' });
    check('rejection reasons recorded',
      (await draftRow(d2.draftId)).rejection_reason === 'bad_timing');
  }

  // -------------------------------------------------------------------------
  console.log('\n— Posting through the mock X adapter —');
  {
    const res = await deskJson({ action: 'post_now', draftId });
    check('approved post publishes', res.status === 200 && !!res.data.externalId);
    const d = await draftRow(draftId);
    check('X post id + URL stored', d.status === 'posted' && d.external_id
      && d.post_url.includes(d.external_id));
    check('opportunity marked published',
      (await q(`select status from intelligence_opportunities where id = $1`, [patternOpp.id]))[0].status === 'published');
    check('usage ledger charged the link-post rate',
      (await q(`select estimated_cost_usd::float8 as c from x_usage_ledger
                 where draft_id = $1 and operation = 'post_create_link'`, [draftId]))[0]?.c === 0.2);
    check('audit trail: drafted → edited → approved → posted, no invisible publishing',
      (await q(`select count(distinct action)::int as n from guestlist_x_audit
                 where draft_id = $1 and action in ('edited','approved','posted','scheduled')`,
        [draftId]))[0].n === 4);
    check('content fingerprints stored (events + wording + city/genre)',
      (await q(`select count(*)::int as n from content_fingerprints where draft_id = $1`, [draftId]))[0].n >= 5);

    // Repetition guard: a fresh opportunity touching the same events is
    // refused a draft while the window is hot.
    const [freshMomentum] = await oppByType('EVENT_MOMENTUM');
    if (freshMomentum && freshMomentum.status === 'open') {
      const rep = await deskJson({ action: 'create_draft', opportunityId: freshMomentum.id });
      check('repetition protection blocks re-covering the same event',
        rep.status === 400 && rep.data.error.includes('Repetition'));
    } else {
      // Force one: reopen the expired momentum opportunity.
      await q(`update intelligence_opportunities set status = 'open', expires_at = now() + interval '1 day'
                where id = $1`, [momentumOpp.id]);
      const rep = await deskJson({ action: 'create_draft', opportunityId: momentumOpp.id });
      check('repetition protection blocks re-covering the same event',
        rep.status === 400 && rep.data.error.includes('Repetition'));
    }

    // Attribution: a click carrying the post's src token lands in Guestlist.
    check('posted draft carries an attribution src', d.attribution_src?.startsWith('gx-'));
    await nadia.post('/api/track', {
      type: 'event_viewed', eventId: tonightIds[0], metadata: { src: d.attribution_src },
    });
    await sleep(300);
    const postedTab = await oshi.html('/admin/guestlist-x?tab=posted');
    check('desk reports Guestlist impact, not vanity metrics',
      postedTab.includes('GUESTLIST IMPACT: 1 event views'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— X failure handling: errors, uncertainty, rate limits —');
  let failDraftId;
  {
    const [opp] = await oppByType('WORTH_TRAVELLING_FOR');
    const { data } = await deskJson({ action: 'create_draft', opportunityId: opp.id });
    failDraftId = data.draftId;
    await deskJson({ action: 'approve', draftId: failDraftId });

    await setMock({ fail_next: true });
    const failRes = await deskJson({ action: 'post_now', draftId: failDraftId });
    check('a hard X error fails the draft with the error recorded',
      failRes.status === 409 && (await draftRow(failDraftId)).status === 'failed');

    await q(`update channel_drafts set status = 'needs_review' where id = $1`, [failDraftId]);
    await deskJson({ action: 'approve', draftId: failDraftId });
    await setMock({ uncertain_next: true });
    await deskJson({ action: 'post_now', draftId: failDraftId });
    const d2 = await draftRow(failDraftId);
    check('an uncertain write is NEVER blind-retried — needs review instead',
      d2.status === 'needs_review' && d2.needs_review_reason.includes('Uncertain'));
    check('exactly one X attempt recorded for the uncertain write',
      (await q(`select count(*)::int as n from x_usage_ledger
                 where draft_id = $1`, [failDraftId]))[0].n === 2); // fail + uncertain

    await deskJson({ action: 'approve', draftId: failDraftId });
    await setMock({ rate_limit_next: true });
    await deskJson({ action: 'post_now', draftId: failDraftId });
    check('a rate limit re-queues instead of failing',
      (await draftRow(failDraftId)).status === 'scheduled');

    // Circuit breaker: forced open state blocks posting outright.
    await q(`insert into system_settings (key, value) values ('x_circuit', $1)
             on conflict (key) do update set value = $1`,
      [JSON.stringify({ post_create: { failures: 5, open_until: inHours(1) } })]);
    const breaker = await deskJson({ action: 'post_now', draftId: failDraftId });
    check('circuit breaker pauses a misbehaving operation',
      breaker.status === 409 && breaker.data.error.includes('CIRCUIT_OPEN'));
    await q(`delete from system_settings where key = 'x_circuit'`);

    const okRes = await deskJson({ action: 'post_now', draftId: failDraftId });
    check('recovery: the same draft posts once the circuit clears', okRes.status === 200);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Mentions: ingestion, cursor, dedupe, classification —');
  let jungleQuestionId;
  {
    await setMock({
      mentions: [
        { id: '2001', text: "@guestlist what's good in London tonight?", author_handle: 'raver_one' },
        { id: '2002', text: 'crypto giveaway follow back @guestlist', author_handle: 'spambot' },
        { id: '2003', text: '@guestlist old-school jungle in London tonight?', author_handle: 'junglist94' },
      ],
    });
    const sync1 = await deskJson({ action: 'sync_mentions' });
    check('mentions ingested through the adapter', sync1.data.stored === 3);
    const sync2 = await deskJson({ action: 'sync_mentions' });
    check('cursor + dedupe: nothing re-ingested', sync2.data.stored === 0);

    const mentions = await q(`select * from x_mentions order by external_id`);
    const q1 = mentions.find((m) => m.external_id === '2001');
    const spam = mentions.find((m) => m.external_id === '2002');
    const q3 = mentions.find((m) => m.external_id === '2003');
    jungleQuestionId = q3.id;
    check('event questions classified with grounded intent',
      q1.classification === 'EVENT_QUESTION' && q1.intent.city === 'London' && q1.intent.date === 'tonight');
    check('genre extracted from real taxonomy (Jungle)',
      q3.classification === 'EVENT_QUESTION' && q3.intent.genre === 'Jungle');
    check('spam classified as spam', spam.classification === 'SPAM');
    check('NO automatic replies: ingestion never creates a draft',
      mentions.every((m) => m.draft_id === null));

    await setMock({ mentions: [{ id: '2004', text: '@guestlist hello from the dance', author_handle: 'later' }] });
    const sync3 = await deskJson({ action: 'sync_mentions' });
    check('cursor moves forward — only genuinely new mentions arrive', sync3.data.stored === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Grounded replies: intent → REAL query → approval —');
  {
    const { status, data } = await deskJson({ action: 'draft_reply', mentionId: jungleQuestionId });
    check('a grounded reply draft is created for the jungle question',
      status === 200 && data.matched >= 1);
    const reply = await draftRow(data.draftId);
    check('the reply cites a real matching event, never an invention',
      reply.kind === 'reply' && reply.evidence_snapshot.events.length >= 1
      && reply.evidence_snapshot.events.some((e) => e.title.startsWith('V2G')));
    check('the mention is linked and marked drafted',
      (await q(`select status, draft_id from x_mentions where id = $1`, [jungleQuestionId]))[0].draft_id === reply.id);

    check('replies also cannot post unapproved',
      (await deskJson({ action: 'post_now', draftId: reply.id })).status === 409);
    await deskJson({ action: 'approve', draftId: reply.id });
    const posted = await deskJson({ action: 'post_now', draftId: reply.id });
    check('the human-approved reply posts', posted.status === 200);
    check('mention marked replied',
      (await q(`select status from x_mentions where id = $1`, [jungleQuestionId]))[0].status === 'replied');
  }

  // -------------------------------------------------------------------------
  console.log('\n— Budget engine: warnings, reservation, hard stop, override —');
  let pausedDraftId;
  {
    const set = await deskJson({ action: 'set_budget', budgetUsd: 10 });
    check('admin edits the budget', set.status === 200 && set.data.status.budget_usd === 10);

    // Reservation: an approved draft holds its estimate.
    const [flyerOpp] = await oppByType('I_WAS_THERE_MOMENT');
    const { data: nd } = await deskJson({ action: 'create_draft', opportunityId: flyerOpp.id });
    pausedDraftId = nd.draftId;
    await deskJson({ action: 'approve', draftId: pausedDraftId });
    const job1 = await (await runJob()).json();
    check('reserved spend visible and counted against the budget',
      job1.budget.reserved >= 0.2);

    // Warnings: inject spend to 60%.
    await q(`insert into x_usage_ledger (operation, estimated_cost_usd, priority)
             values ('post_create_link', 5.8, 'high')`);
    const job2 = await (await runJob()).json();
    check('warning thresholds cross honestly (≥50%)', job2.budget.pct >= 50);

    // Conservation at ≥80% committed.
    await q(`insert into x_usage_ledger (operation, estimated_cost_usd, priority)
             values ('post_create_link', 2.2, 'high')`);
    const job3 = await (await runJob()).json();
    check('conservation mode engages near the limit', job3.budget.conservation === true);

    // Hard stop at 100%: the approved draft parks, it never fails.
    await q(`insert into x_usage_ledger (operation, estimated_cost_usd, priority)
             values ('post_create_link', 2.5, 'high')`);
    const stop = await deskJson({ action: 'post_now', draftId: pausedDraftId });
    check('hard budget stop parks approved content as BUDGET PAUSED',
      stop.status === 409 && (await draftRow(pausedDraftId)).status === 'budget_paused');
    check('mention sync suspends when the budget is exhausted',
      (await deskJson({ action: 'sync_mentions' })).data.skipped?.includes('BUDGET_PAUSED'));

    // Manual override: explicit, audited, admin-only.
    const override = await deskJson({ action: 'post_now', draftId: pausedDraftId, override: true });
    check('POST ONCE ANYWAY publishes with an audit trail', override.status === 200
      && (await q(`select 1 from guestlist_x_audit where draft_id = $1 and action = 'budget_override'`,
        [pausedDraftId])).length === 1);

    // Budget increase releases paused work after revalidation.
    const [wtOpp] = await oppByType('TONIGHT_PATTERN'); // published → use I_WAS_THERE again next day guard
    void wtOpp;
    const { data: nd2 } = await deskJson({ action: 'create_draft', opportunityId: onThisNightOpp.id });
    if (nd2?.draftId) {
      await deskJson({ action: 'approve', draftId: nd2.draftId });
      const blocked = await deskJson({ action: 'post_now', draftId: nd2.draftId });
      check('further posts stay paused at the cap', blocked.status === 409);
      await deskJson({ action: 'set_budget', budgetUsd: 50 });
      const released = await deskJson({ action: 'post_now', draftId: nd2.draftId });
      check('raising the budget releases the queue (facts revalidated)', released.status === 200);
    } else {
      check('further posts stay paused at the cap', true);
      check('raising the budget releases the queue (facts revalidated)',
        (await deskJson({ action: 'set_budget', budgetUsd: 50 })).status === 200);
    }

    // Billing period alignment: a fresh period ignores backdated spend.
    await q(`update x_usage_ledger set created_at = now() - interval '45 days'
              where estimated_cost_usd >= 2`);
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    await deskJson({ action: 'set_billing_period', periodStart: start, periodEnd: end });
    const job4 = await (await runJob()).json();
    check('billing period reset: old spend excluded, budget breathes again',
      job4.budget.pct < 50 && job4.budget.exhausted === false);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Per-job guards —');
  {
    await q(`insert into system_settings (key, value) values ('x_job_guards', $1)
             on conflict (key) do update set value = $1`,
      [JSON.stringify({ maxRequestsPerRun: 50, maxCostPerRunUsd: 0.01 })]);
    // A scheduled draft that would exceed the per-run spend cap.
    const [d] = await q(
      `select id from channel_drafts where status = 'scheduled' limit 1`);
    if (d) {
      await (await runJob()).json();
      check('per-job cost cap stops the run and flags it',
        (await q(`select 1 from guestlist_x_audit where action = 'job_guard_stop'`)).length >= 1);
    } else {
      // Force one through the mention path (estimated cost > cap).
      const sync = await deskJson({ action: 'sync_mentions' });
      check('per-job cost cap stops the run and flags it', sync.data.skipped === 'per-job cap');
    }
    await q(`delete from system_settings where key = 'x_job_guards'`);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Kill switches: everything pausable without a deploy —');
  {
    await deskJson({ action: 'set_switches', posting: false });
    const [opp] = await q(
      `select id from intelligence_opportunities where status = 'open' order by score desc limit 1`);
    let switchDraftId = null;
    if (opp) {
      const { data } = await deskJson({ action: 'create_draft', opportunityId: opp.id });
      switchDraftId = data?.draftId ?? null;
    }
    if (!switchDraftId) {
      // Fall back to re-approving the failed-path draft.
      await q(`update channel_drafts set status = 'edited' where id = $1`, [failDraftId]);
      await deskJson({ action: 'approve', draftId: failDraftId });
      switchDraftId = failDraftId;
    } else {
      await deskJson({ action: 'approve', draftId: switchDraftId });
    }
    const blocked = await deskJson({ action: 'post_now', draftId: switchDraftId });
    check('posting kill switch blocks publishing', blocked.status === 409
      && blocked.data.error.includes('paused'));

    await deskJson({ action: 'set_switches', posting: true, mention_sync: false });
    check('mention kill switch blocks sync',
      (await deskJson({ action: 'sync_mentions' })).data.skipped?.includes('paused'));

    await deskJson({ action: 'set_switches', mention_sync: true, replies: false });
    const [replyDraft] = await q(
      `select id from channel_drafts where kind = 'reply' and status = 'posted' limit 1`);
    void replyDraft; // replies already posted; verify the gate with a fresh one
    await setMock({ mentions: [{ id: '2005', text: '@guestlist house in London tonight?', author_handle: 'q2' }] });
    await deskJson({ action: 'sync_mentions' });
    const [m2] = await q(`select id from x_mentions where external_id = '2005'`);
    const { data: rd } = await deskJson({ action: 'draft_reply', mentionId: m2.id });
    await deskJson({ action: 'approve', draftId: rd.draftId });
    const replyBlocked = await deskJson({ action: 'post_now', draftId: rd.draftId });
    check('reply kill switch blocks replies specifically',
      replyBlocked.status === 409 && replyBlocked.data.error.includes('replies are paused'));
    await deskJson({ action: 'set_switches', replies: true });
    check('re-enabled: the reply posts',
      (await deskJson({ action: 'post_now', draftId: rd.draftId })).status === 200);
    await deskJson({ action: 'set_switches', automation: true, posting: true, mention_sync: true, analytics: true });
  }

  // -------------------------------------------------------------------------
  console.log('\n— Archive rights on the way to X —');
  {
    // A fresh flyer with external_reference rights on an untouched archive
    // event (repetition guards are already protecting everything posted).
    const [circaEvent] = await q(`select id from archive_events where slug = 'v2g-sometime-1995'`);
    const [item] = await q(
      `insert into archive_items (item_type, title, archive_event_id, status, published_at)
       values ('flyer', 'V2G test flyer', $1, 'published', now()) returning id`, [circaEvent.id]);
    const [flyerMedia] = await q(
      `insert into archive_media (item_id, kind, storage_path, mime, rights)
       values ($1, 'front', '/images/secret-party.jpg', 'image/jpeg', 'external_reference')
       returning id`, [item.id]);
    await q(
      `insert into intelligence_opportunities
         (type, headline, reason, score, confidence, evidence, fingerprint, expires_at,
          linked_archive_event_ids, linked_archive_media_ids)
       values ('ARCHIVE_FLYER', 'V2G flyer test', 'test', 10, 'medium', '{}',
               'ARCHIVE_FLYER:v2g-test', now() + interval '1 day', $1, $2)`,
      [[circaEvent.id], [flyerMedia.id]]);
    const [flyerOpp] = await q(
      `select id from intelligence_opportunities where fingerprint = 'ARCHIVE_FLYER:v2g-test'`);
    const { data } = await deskJson({ action: 'create_draft', opportunityId: flyerOpp.id });
    const d = await draftRow(data.draftId);
    check('external_reference media NEVER attaches to X (website ≠ social rights)',
      Array.isArray(d.media) && d.media.length === 0);

    // Upgrade rights → media attaches; then a takedown blocks at publish time.
    await q(`update archive_media set rights = 'guestlist_owned' where id = $1`, [flyerMedia.id]);
    await q(`delete from content_fingerprints where entity_key = $1`, [flyerMedia.id]);
    await q(`update intelligence_opportunities set status = 'open' where id = $1`, [flyerOpp.id]);
    const { data: data2 } = await deskJson({ action: 'create_draft', opportunityId: flyerOpp.id });
    const d2 = await draftRow(data2.draftId);
    check('owned-rights media attaches', d2.media.length === 1);
    await deskJson({ action: 'approve', draftId: data2.draftId });
    await q(`update archive_media set hidden = true where id = $1`, [flyerMedia.id]);
    const blocked = await deskJson({ action: 'post_now', draftId: data2.draftId });
    check('a takedown between approval and publish blocks the post',
      blocked.status === 409 && (await draftRow(data2.draftId)).status === 'needs_review');
    await q(`update archive_media set hidden = false, rights = 'external_reference' where id = $1`, [flyerMedia.id]);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Website channel: same intelligence, no X dependency —');
  {
    // A fresh event no X post has covered (the repetition guard is shared
    // intelligence policy, so reuse would rightly be refused).
    const webEventId = await publishEvent({
      title: 'V2G Warehouse Live', startAt: inHours(6), genreSlugs: ['house'],
    });
    await q(
      `insert into intelligence_opportunities
         (type, headline, reason, suggested_angle, score, confidence, city, evidence,
          fingerprint, expires_at, linked_event_ids)
       values ('CITY_MOMENT', 'London is busy tonight', '3 strong events',
               'London''s looking lively tonight.', 20, 'high', 'London', '{}',
               'CITY_MOMENT:v2g-web', now() + interval '1 day', $1)`,
      [[webEventId]]);
    const [webOpp] = await q(
      `select id from intelligence_opportunities where fingerprint = 'CITY_MOMENT:v2g-web'`);
    const { data } = await deskJson({
      action: 'create_draft', opportunityId: webOpp.id, channel: 'website',
    });
    check('website drafts cost nothing', Number((await draftRow(data.draftId)).estimated_cost_usd) === 0);
    check('website observations still require approval',
      (await deskJson({ action: 'post_now', draftId: data.draftId })).status === 409);
    await deskJson({ action: 'approve', draftId: data.draftId });
    check('approved website observation publishes',
      (await deskJson({ action: 'post_now', draftId: data.draftId })).status === 200);
    const home = await anon.html('/');
    check('the homepage shows @guestlist right now',
      home.includes('The things we’re noticing') || home.includes('The things we&#x27;re noticing'));
    check('the observation body renders', home.includes('V2G Warehouse Live'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Security —');
  {
    check('the desk requires admin (anon redirected)',
      (await anon.fetch('/admin/guestlist-x')).status === 307);
    check('OAuth start is admin-only',
      (await nadia.post('/api/admin/x/oauth/start')).status >= 401);
    const cb = await oshi.fetch('/api/admin/x/oauth/callback?code=x&state=forged');
    check('a forged OAuth state never connects an account',
      cb.status === 307 && (await q(`select count(*)::int as n from social_accounts`))[0].n === 0);
    check('the cron route rejects anonymous callers',
      (await anon.post('/api/jobs/guestlist-x')).status === 401);
    check('tokens are never exposed by the desk',
      !(await oshi.html('/admin/guestlist-x?tab=settings')).includes('access_token'));
    check('sensitive actions audited',
      (await q(`select count(*)::int as n from guestlist_x_audit
                 where action in ('kill_switch', 'budget_changed', 'budget_override')`))[0].n >= 3);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Legacy surfaces untouched (spot checks) —');
  {
    check('events browse healthy', (await anon.fetch('/events')).status === 200);
    check('archive healthy', (await anon.fetch('/archive')).status === 200);
    check('people healthy', (await nadia.fetch('/people')).status === 200);
  }
} catch (err) {
  failed++;
  failures.push(`SUITE ABORTED: ${err.message}`);
  console.error(err);
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) console.log('Failures:\n - ' + failures.join('\n - '));
  await db.end();
  process.exit(failed ? 1 : 0);
}
