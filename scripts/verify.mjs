// End-to-end verification of the Events platform against a running dev
// server + the local database. Exercises the complete journey:
// admin creates → publishes → discovery → filters → detail → interested →
// going → who's going → ticket click recorded → saved persists →
// submissions + dedupe → permissions.
//
// Usage: npm run db:reset && (dev server running) && npm run verify

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

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
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
      const res = await this.fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      return res.status;
    },
  };
}

const anon = client();
const nadia = client();
const admin = client();

// ---------------------------------------------------------------------------
console.log('\n— Discovery (logged out) —');
{
  const res = await anon.fetch('/events');
  const html = await res.text();
  check('/events renders', res.status === 200);
  check('seeded event visible', html.includes('Jungle Mania'));

  const jungle = await (await anon.fetch('/events?genre=jungle')).text();
  check('genre filter includes tagged event', jungle.includes('Jungle Mania'));
  check('genre filter excludes untagged event', !jungle.includes('Night Bureau 012'));

  // Multi-genre event appears under each of its genres.
  for (const g of ['house', 'disco', 'balearic']) {
    const html2 = await (await anon.fetch(`/events?genre=${g}`)).text();
    check(`multi-genre event under ${g}`, html2.includes('Sunset at Casa Balearica'));
  }
  // Selecting a subgenre works; selecting the parent includes subgenre-tagged events.
  const liquid = await (await anon.fetch('/events?genre=liquid')).text();
  check('subgenre filter works', liquid.includes('Liquid Rollers'));
  const ukg = await (await anon.fetch('/events?genre=garage')).text();
  check('parent genre includes subgenre-tagged event', ukg.includes('Thames Pressure'));

  const weekend = await (await anon.fetch('/events?tab=this-weekend')).text();
  check('this weekend tab has content', weekend.includes('eventCard'));
  const fest = await (await anon.fetch('/events?tab=festivals')).text();
  check('festivals tab shows festival + weekender', fest.includes('Ten Cities Festival') && fest.includes('Deep North Weekender'));
  check('festivals tab excludes club nights', !fest.includes('Night Bureau 012'));

  const empty = await (await anon.fetch('/events?genre=jungle&city=Zanzibar')).text();
  check('empty state with suggestions', empty.includes('Nothing matching that yet') && empty.includes('Add an event'));

  const detail = await anon.fetch('/events/rewind-sessions-presents-jungle-mania');
  const dHtml = await detail.text();
  check('event detail renders', detail.status === 200);
  check('detail shows lineup', dHtml.includes('Junglist Mo'));
  check('detail shows promoter', dHtml.includes('Rewind Sessions'));
  check('detail shows genres', dHtml.includes('Jungle'));
  check('detail has tickets CTA', dHtml.includes('Get Tickets'));

  // Edge-case events all render.
  for (const slug of [
    'the-garden-weekender', // multi-day, abroad
    'night-bureau-012', // crosses midnight
    'sunrise-over-kendwa-nye-preview', // no price, no lineup, no promoter
    'trance-communion', // no promoter
    'golden-hour-season-opener', // past event
  ]) {
    const r = await anon.fetch(`/events/${slug}`);
    check(`edge case renders: ${slug}`, r.status === 200);
  }
  const pastHtml = await (await anon.fetch('/events/golden-hour-season-opener')).text();
  check('past event marked and CTA hidden', pastHtml.includes('already happened') && !pastHtml.includes('Get Tickets'));
  check('past event absent from browse', !(await (await anon.fetch('/events')).text()).includes('Season Opener'));

  const draft = await anon.fetch('/events/jungle-mania-rewind-sessions-dupe');
  check('non-live event 404s publicly', draft.status === 404);
}

// ---------------------------------------------------------------------------
console.log('\n— Auth gating (logged out) —');
{
  const someEvent = (await q(`select id from events where slug = 'night-bureau-012'`))[0];
  const act = await anon.fetch(`/api/events/${someEvent.id}/action`, {
    method: 'POST',
    body: JSON.stringify({ rsvp: 'going' }),
  });
  check('action requires auth (401)', act.status === 401);

  const att = await anon.fetch(`/api/events/${someEvent.id}/attendees`);
  const attData = await att.json();
  check('attendees: counts public, list member-only', att.status === 200 && attData.memberOnly && !attData.going);

  const adminApi = await anon.fetch('/api/admin/events', { method: 'POST', body: JSON.stringify({}) });
  check('admin API requires auth', adminApi.status === 401);
  const adminPage = await anon.fetch('/admin/events');
  check('admin pages redirect anonymous', adminPage.status >= 300 && adminPage.status < 400);
}

// ---------------------------------------------------------------------------
console.log("\n— Member journey: interested → going → save → who's going —");
{
  check('member login', (await nadia.login('dev-nadia@example.com')) === 200);
  const nadiaId = (await q(`select id from members where email = 'dev-nadia@example.com'`))[0].id;
  const ev = (await q(`select id, slug from events where slug = 'analogue-love-disco-supper-club'`))[0];

  const r1 = await nadia.fetch(`/api/events/${ev.id}/action`, {
    method: 'POST', body: JSON.stringify({ rsvp: 'interested' }),
  });
  check('mark interested', r1.status === 200);
  let row = (await q(`select rsvp, saved_at from member_event_actions where member_id=$1 and event_id=$2`, [nadiaId, ev.id]))[0];
  check('DB row: interested', row?.rsvp === 'interested');

  const r2 = await nadia.fetch(`/api/events/${ev.id}/action`, {
    method: 'POST', body: JSON.stringify({ rsvp: 'going' }),
  });
  check('change to going', r2.status === 200);
  row = (await q(`select rsvp, saved_at from member_event_actions where member_id=$1 and event_id=$2`, [nadiaId, ev.id]))[0];
  check('DB row: going (single row, no duplicates)', row?.rsvp === 'going');
  const rowCount = (await q(`select count(*)::int as n from member_event_actions where member_id=$1 and event_id=$2`, [nadiaId, ev.id]))[0].n;
  check('exactly one action row per member+event', rowCount === 1);

  const r3 = await nadia.fetch(`/api/events/${ev.id}/action`, {
    method: 'POST', body: JSON.stringify({ saved: true }),
  });
  check('save alongside going', r3.status === 200);
  row = (await q(`select rsvp, saved_at from member_event_actions where member_id=$1 and event_id=$2`, [nadiaId, ev.id]))[0];
  check('DB row: saved + going coexist', row?.rsvp === 'going' && row?.saved_at != null);

  const att = await (await nadia.fetch(`/api/events/${ev.id}/attendees`)).json();
  check("who's going lists the member", att.going?.some((m) => m.id === nadiaId));

  const detailHtml = await (await nadia.fetch(`/events/${ev.slug}`)).text();
  check('attendance count on detail page', /\d+ Guestlist member/.test(detailHtml));

  // Analytics rows written server-side for the actions.
  const acts = await q(
    `select event_type from analytics_events where member_id=$1 and event_id=$2 order by id`,
    [nadiaId, ev.id]
  );
  const types = acts.map((a) => a.event_type);
  check('analytics: interested/going/saved recorded',
    types.includes('interested') && types.includes('going') && types.includes('event_saved'),
    `got: ${types.join(',')}`);

  // Clearing RSVP but keeping save leaves the row; clearing both removes it.
  await nadia.fetch(`/api/events/${ev.id}/action`, { method: 'POST', body: JSON.stringify({ rsvp: null }) });
  row = (await q(`select rsvp, saved_at from member_event_actions where member_id=$1 and event_id=$2`, [nadiaId, ev.id]))[0];
  check('clear rsvp keeps saved row', row && row.rsvp === null && row.saved_at != null);
  await nadia.fetch(`/api/events/${ev.id}/action`, { method: 'POST', body: JSON.stringify({ saved: false }) });
  const gone = (await q(`select 1 from member_event_actions where member_id=$1 and event_id=$2`, [nadiaId, ev.id])).length;
  check('clearing everything removes the row', gone === 0);

  // Restore a saved state and confirm it persists across a fresh page load.
  await nadia.fetch(`/api/events/${ev.id}/action`, { method: 'POST', body: JSON.stringify({ saved: true }) });
  const browse = await (await nadia.fetch('/events')).text();
  check('saved state persists into browse render', browse.includes('saveBtn saved') || browse.includes('saved'));
}

// ---------------------------------------------------------------------------
console.log('\n— Outbound ticket clicks —');
{
  const ev = (await q(`select id, ticket_url from events where slug = 'liquid-rollers'`))[0];
  const before = (await q(`select count(*)::int as n from analytics_events where event_type='ticket_clicked' and event_id=$1`, [ev.id]))[0].n;
  const res = await nadia.fetch(`/out/${ev.id}`);
  check('outbound click redirects to official ticket URL',
    res.status === 302 && res.headers.get('location') === ev.ticket_url);
  const after = (await q(`select count(*)::int as n from analytics_events where event_type='ticket_clicked' and event_id=$1`, [ev.id]))[0].n;
  check('ticket click recorded in DB', after === before + 1);
}

// ---------------------------------------------------------------------------
console.log('\n— Client tracking API —');
{
  const ev = (await q(`select id from events where slug = 'liquid-rollers'`))[0];
  const ok = await anon.fetch('/api/track', {
    method: 'POST',
    body: JSON.stringify({ type: 'event_viewed', eventId: ev.id, path: '/events/liquid-rollers' }),
  });
  check('event_viewed accepted', ok.status === 200);
  const viewed = (await q(`select count(*)::int as n from analytics_events where event_type='event_viewed' and event_id=$1`, [ev.id]))[0].n;
  check('event_viewed stored', viewed >= 1);
  const spoof = await anon.fetch('/api/track', {
    method: 'POST',
    body: JSON.stringify({ type: 'ticket_clicked', eventId: ev.id }),
  });
  check('server-only types rejected from client', spoof.status === 400);
}

// ---------------------------------------------------------------------------
// V2A: submissions run the real extraction pipeline. A local fixture server
// (allowed via SUPPLY_FETCH_ALLOW_HOSTS=127.0.0.1 on the app server, dev/
// test only) provides deterministic pages — no live websites in CI.
console.log('\n— Paste-link submission (real extraction) + duplicate protection —');
{
  const { createServer } = await import('node:http');
  const futureDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const fixturePage = (title) => `<!doctype html><html><head><title>${title}</title>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'MusicEvent', name: title,
    startDate: `${futureDate}T21:00:00+01:00`,
    location: { '@type': 'Place', name: 'The Boiler Yard', address: { '@type': 'PostalAddress', addressLocality: 'London', addressCountry: 'United Kingdom' } },
    offers: { '@type': 'Offer', url: 'https://tickets.example/verify', price: '15', priceCurrency: 'GBP' },
  })}</script></head><body><main>${title}</main></body></html>`;
  const fixtures = createServer((req, res) => {
    if (req.url?.startsWith('/events/')) {
      const slug = req.url.split('/').pop().split('?')[0];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fixturePage(`Verify Fixture ${slug}`));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => fixtures.listen(4581, '127.0.0.1', r));

  const url = 'http://127.0.0.1:4581/events/verify-night';
  const r1 = await (await nadia.fetch('/api/submissions', {
    method: 'POST', body: JSON.stringify({ url }),
  })).json();
  check('submission extracts and creates draft', r1.ok && r1.outcome === 'created');
  check('friendly summary returned (no confidence/AI internals)',
    Array.isArray(r1.found) && r1.found[0]?.includes('Verify Fixture') &&
    !JSON.stringify(r1).match(/confidence|extraction|json-ld/i));
  const draft = (await q(
    `select status, source_type, source_url, ticket_url, city, confidence_score from events where source_url=$1`,
    [url]))[0];
  check('draft queued for review as member_submission',
    ['new', 'needs_review'].includes(draft?.status) && draft?.source_type === 'member_submission');
  check('real fields extracted (city + separated ticket URL)',
    draft?.city === 'London' && draft?.ticket_url === 'https://tickets.example/verify');
  const ex = (await q(`select status, field_sources from extractions where url=$1`, [url]))[0];
  check('extraction recorded with JSON-LD provenance',
    ex?.status === 'succeeded' && ex?.field_sources?.title === 'json-ld');
  const sub = (await q(`select status, event_id from event_submissions where url=$1`, [url]))[0];
  check('submission row processed + linked', sub?.status === 'processed' && !!sub?.event_id);

  const r2 = await (await nadia.fetch('/api/submissions', {
    method: 'POST', body: JSON.stringify({ url }),
  })).json();
  check('same URL flagged as duplicate, no second draft', r2.outcome === 'duplicate');
  const n = (await q(`select count(*)::int as n from events where source_url=$1`, [url]))[0].n;
  check('only one event for the URL', n === 1);

  const bad = await nadia.fetch('/api/submissions', {
    method: 'POST', body: JSON.stringify({ url: 'not a url' }),
  });
  check('invalid URL rejected', bad.status === 400);

  const subAnalytics = (await q(`select count(*)::int as n from analytics_events where event_type='event_submitted'`))[0].n;
  check('event_submitted tracked', subAnalytics >= 2);

  // Abuse protection: the member limit kicks in within a reasonable number
  // of rapid submissions.
  let got429 = false;
  for (let i = 0; i < 12 && !got429; i++) {
    const res = await nadia.fetch('/api/submissions', {
      method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:4581/events/rl-${i}` }),
    });
    if (res.status === 429) got429 = true;
  }
  check('rate limit protects public submissions (429)', got429);

  fixtures.close();
}

// ---------------------------------------------------------------------------
console.log('\n— Admin journey: create → publish → edit → unpublish —');
{
  check('admin login', (await admin.login('oshi@guestlist.net')) === 200);

  // Member must NOT be able to use admin APIs.
  const forbidden = await nadia.fetch('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({ title: 'x', startAt: new Date().toISOString(), eventType: 'other' }),
  });
  check('member blocked from admin API (403)', forbidden.status === 403);

  const start = new Date(Date.now() + 21 * 86400 * 1000);
  const end = new Date(start.getTime() + 8 * 3600 * 1000);
  const createRes = await admin.fetch('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Verification Test Night',
      shortDescription: 'Created by the automated verification run.',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timezone: 'Europe/London',
      city: 'London',
      country: 'United Kingdom',
      eventType: 'club_night',
      ticketUrl: 'https://example.com/tickets/verification-test-night',
      priceFrom: 10,
      currency: 'GBP',
      genreSlugs: ['techno', 'breaks'],
      lineup: ['Test Artist One', 'Test Artist Two'],
      status: 'new',
    }),
  });
  const created = await createRes.json();
  check('admin creates event (status new)', createRes.status === 201 && created.status === 'new');

  // Not yet live → not in discovery.
  let browse = await (await anon.fetch('/events?genre=techno')).text();
  check('unpublished event hidden from discovery', !browse.includes('Verification Test Night'));

  const pub = await admin.fetch(`/api/admin/events/${created.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'live' }),
  });
  check('admin publishes', pub.status === 200);
  browse = await (await anon.fetch('/events?genre=techno')).text();
  check('published event appears in discovery under its genre', browse.includes('Verification Test Night'));
  const detail = await anon.fetch(`/events/${created.slug}`);
  const dHtml = await detail.text();
  check('published detail page live with lineup', detail.status === 200 && dHtml.includes('Test Artist One'));

  // Duplicate protection on admin/importer create: same title+date+city.
  const dupRes = await admin.fetch('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Verification Test Night',
      startAt: start.toISOString(),
      city: 'London',
      eventType: 'club_night',
      status: 'live', // requested live, must be downgraded
    }),
  });
  const dup = await dupRes.json();
  check('near-duplicate forced to needs_review', dup.status === 'needs_review' && !!dup.possibleDuplicateOf);

  const edit = await admin.fetch(`/api/admin/events/${created.id}`, {
    method: 'PATCH', body: JSON.stringify({ title: 'Verification Test Night (Edited)' }),
  });
  check('admin edits title', edit.status === 200);
  const edited = (await q(`select title from events where id=$1`, [created.id]))[0];
  check('edit persisted', edited.title === 'Verification Test Night (Edited)');

  const unpub = await admin.fetch(`/api/admin/events/${created.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'new' }),
  });
  check('admin unpublishes', unpub.status === 200);
  const gone = await anon.fetch(`/events/${created.slug}`);
  check('unpublished event 404s publicly again', gone.status === 404);
  const adminPreview = await admin.fetch(`/events/${created.slug}`);
  check('admin can still preview unpublished event', adminPreview.status === 200);

  // Admin queue pages render with the possible-duplicate flag.
  const queue = await (await admin.fetch('/admin/events?state=needs_review')).text();
  check('needs-review queue shows possible duplicate', queue.includes('Possible duplicate'));
  const pastQueue = await admin.fetch('/admin/events?state=past');
  check('past queue renders', pastQueue.status === 200);
}

// ---------------------------------------------------------------------------
console.log('\n— Sources admin —');
{
  const add = await admin.fetch('/api/admin/sources', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Verification Source',
      url: 'https://example.com/verification-source',
      sourceType: 'independent_calendar',
    }),
  });
  check('admin adds source', add.status === 201);
  const dup = await admin.fetch('/api/admin/sources', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Verification Source again',
      url: 'https://example.com/verification-source',
      sourceType: 'blog_publication',
    }),
  });
  check('duplicate source URL rejected (409)', dup.status === 409);
  const memberAdd = await nadia.fetch('/api/admin/sources', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', url: 'https://example.com/x', sourceType: 'other' }),
  });
  check('member blocked from sources API', memberAdd.status === 403);
  const page = await (await admin.fetch('/admin/sources')).text();
  check('sources page lists source', page.includes('Verification Source'));

  // Two tabs: a brand new source belongs on the workbench, never in the
  // live list, until it is polling and producing events.
  check('workbench tab shows the new source', page.includes('Workbench'));
  const live = await (await admin.fetch('/admin/sources?view=live')).text();
  check('live tab renders', live.includes('Live &amp; polling') || live.includes('Live & polling'));
  check('untested source is not in the live tab', !live.includes('Verification Source'));

  // Discovery: admin-only, and it will not call the model without a country.
  const memberDiscover = await nadia.fetch('/api/admin/sources/discover', {
    method: 'POST', body: JSON.stringify({ country: 'United Kingdom' }),
  });
  check('member blocked from discovery (403)', memberDiscover.status === 403);
  const noCountry = await admin.fetch('/api/admin/sources/discover', {
    method: 'POST', body: JSON.stringify({ country: '' }),
  });
  check('discovery requires a country (400)', noCountry.status === 400);

  // Testing a candidate URL before it is a source: the same probe the saved
  // sources get, run against a local fixture so no live site is touched.
  const memberTest = await nadia.fetch('/api/admin/sources/test-url', {
    method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:4582/events' }),
  });
  check('member blocked from test-url (403)', memberTest.status === 403);
  const badUrl = await admin.fetch('/api/admin/sources/test-url', {
    method: 'POST', body: JSON.stringify({ url: 'not-a-url' }),
  });
  check('test-url rejects a non-URL (400)', badUrl.status === 400);

  const { createServer } = await import('node:http');
  const listing = createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><main>
        <a href="/events/candidate-one">Candidate One — 2030-05-01</a>
        <a href="/events/candidate-two">Candidate Two — 2030-05-02</a>
      </main></body></html>`);
    } else if (req.url === '/') {
      // The homepage a rescue would read: its nav points at the real listing.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><nav><a href="/about">About</a><a href="/events">Agenda</a></nav></body></html>`);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => listing.listen(4582, '127.0.0.1', r));
  const good = await (await admin.fetch('/api/admin/sources/test-url', {
    method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:4582/events' }),
  })).json();
  check('test-url finds event links on a good candidate', good.bot?.ok === true && good.candidates >= 2,
        JSON.stringify(good));

  // A guessed listing path is a near miss more often than a dead venue: the
  // homepage is asked where its agenda lives before we write the site off.
  const missed = await (await admin.fetch('/api/admin/sources/test-url', {
    method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:4582/en/agenda' }),
  })).json();
  check('a 404 listing path is rescued from the homepage',
        missed.target === 'http://127.0.0.1:4582/events' && missed.candidates >= 2
        && missed.foundVia?.triedFirst === 'http://127.0.0.1:4582/en/agenda', JSON.stringify(missed));

  const dead = await (await admin.fetch('/api/admin/sources/test-url', {
    method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:4583/nope' }),
  })).json();
  check('a genuinely dead candidate stays dead', dead.bot?.ok !== true || dead.candidates === 0,
        JSON.stringify(dead));
  listing.close();

  // A source earns its schedule by producing an event, not by being added.
  const polls = await q(
    `select polling_enabled from event_sources where url = 'https://example.com/verification-source'`
  );
  check('a newly added source does not poll until it proves itself', polls[0]?.polling_enabled === false);

  // The scheduled scan runs on GET too, because that is what Vercel Cron
  // sends — but only for an admin or the cron secret.
  const cronAnon = await fetch(`${BASE}/api/jobs/scan-sources`);
  check('scheduled scan rejects an anonymous GET', cronAnon.status === 401);
  const cronAdmin = await admin.fetch('/api/jobs/scan-sources');
  check('scheduled scan runs for an admin GET', cronAdmin.status === 200);
}

// ---------------------------------------------------------------------------
console.log('\n— Forgotten password —');
{
  // A member of its own, so resetting a password does not sign out the
  // shared fixtures the rest of this file is still using.
  const email = `reset-${Date.now()}@example.com`;
  const guest = client();
  await guest.fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'first-password-1', displayName: 'Reset Tester', homeCity: 'London' }),
  });

  const forgotPage = await (await fetch(`${BASE}/forgot`)).text();
  check('the forgot page explains the old Guestlist', forgotPage.includes('old Guestlist'));
  check('and offers creating an account instead', forgotPage.includes('Create an account'));
  const loginPage = await (await fetch(`${BASE}/login`)).text();
  check('login links to the reset flow', loginPage.includes('/forgot'));

  // The reply must never reveal whether an address is a member: Guestlist is
  // a members' club, and "no such account" would let anyone check who is on it.
  const known = await anon.fetch('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
  const unknown = await anon.fetch('/api/auth/forgot', {
    method: 'POST', body: JSON.stringify({ email: 'nobody-at-all@example.com' }),
  });
  check('a known address gets a bland confirmation', known.status === 200);
  check('an unknown address is answered identically', unknown.status === 200);
  check('the two replies are byte-identical', (await known.text()) === (await unknown.text()));
  check('an empty address is rejected',
        (await anon.fetch('/api/auth/forgot', { method: 'POST', body: JSON.stringify({}) })).status === 400);

  const rows = await q(
    `select pr.token_hash, pr.used_at, pr.expires_at > now() as live
       from password_resets pr join members m on m.id = pr.member_id
      where m.email = $1 order by pr.created_at desc`, [email]
  );
  check('a reset was recorded for the real member', rows.length === 1);
  check('the stored token is a sha256 hash, not the token itself',
        /^[0-9a-f]{64}$/.test(rows[0]?.token_hash ?? ''));
  check('it is live and unused', rows[0]?.live === true && rows[0]?.used_at === null);
  check('nothing was recorded for the unknown address',
        (await q(`select count(*)::int as n from password_resets pr
                    join members m on m.id = pr.member_id where m.email = $1`,
                 ['nobody-at-all@example.com']))[0].n === 0);

  const mail = await q(
    `select body_text from email_outbox
      where email_type = 'transactional_password_reset' order by created_at desc limit 1`
  );
  check('a reset email was queued', mail.length === 1);
  const token = (mail[0]?.body_text ?? '').match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1];
  check('the email carries a reset link', !!token);

  check('a made-up token is refused',
        (await anon.fetch('/api/auth/reset', {
          method: 'POST', body: JSON.stringify({ token: 'not-a-real-token', password: 'longenough1' }),
        })).status === 410);
  check('a short password is refused',
        (await anon.fetch('/api/auth/reset', {
          method: 'POST', body: JSON.stringify({ token, password: 'short' }),
        })).status === 400);

  const resetter = client();
  check('the reset succeeds',
        (await resetter.fetch('/api/auth/reset', {
          method: 'POST', body: JSON.stringify({ token, password: 'a-brand-new-password' }),
        })).status === 200);
  check('and signs you straight in', (await resetter.fetch('/you')).status === 200);
  check('the same link cannot be used twice',
        (await anon.fetch('/api/auth/reset', {
          method: 'POST', body: JSON.stringify({ token, password: 'another-password-1' }),
        })).status === 410);

  check('the old password no longer works',
        (await client().login(email, 'first-password-1')) === 401);
  check('the new password does',
        (await client().login(email, 'a-brand-new-password')) === 200);
  check('every other session was signed out by the reset',
        (await guest.fetch('/you')).status !== 200);
}

// ---------------------------------------------------------------------------
// A missing table once took the whole homepage down with a server-side
// exception, and nothing said so until visitors found it.
console.log('\n— Database audit + homepage resilience —');
{
  const page = await admin.fetch('/admin/schema');
  check('admin database page renders', page.status === 200);
  const body = await page.text();
  check('a fully migrated database reports as up to date',
        body.includes('Up to date'), body.slice(0, 300));
  const asMember = await nadia.fetch('/admin/schema');
  check('members cannot see the database audit', asMember.status !== 200);

  // The homepage must survive a secondary section failing. Renaming the
  // table GuestlistNow reads reproduces exactly the outage we had.
  await q(`alter table homepage_feed_suppressions rename to homepage_feed_suppressions_gone`);
  try {
    const home = await fetch(`${BASE}/`);
    check('homepage still renders when a section’s table is missing', home.status === 200);
    const html = await home.text();
    check('the events people came for are still on the page',
          html.includes('On Guestlist now') || html.includes('cardGrid'));
    const audit = await (await admin.fetch('/admin/schema')).text();
    check('the audit names the missing table',
          audit.includes('homepage_feed_suppressions') && audit.includes('Behind'));
  } finally {
    await q(`alter table homepage_feed_suppressions_gone rename to homepage_feed_suppressions`);
  }
  const recovered = await fetch(`${BASE}/`);
  check('homepage still fine once the table is back', recovered.status === 200);
}

// ---------------------------------------------------------------------------
console.log('\n— Signup flow —');
{
  const fresh = client();
  const su = await fresh.fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      email: `verify-${Date.now()}@example.com`,
      password: 'password123',
      displayName: 'Verify Bot',
      homeCity: 'London',
    }),
  });
  check('signup works', su.status === 200);
  const events = await fresh.fetch('/events');
  check('new member sees events signed in', events.status === 200);

  // A member with no slug would have every link to their profile point at
  // /members/null, so signup must mint one.
  const [signedUp] = await q(
    `select id, slug, display_name from members where display_name = 'Verify Bot' order by created_at desc limit 1`);
  check('signup generates a profile slug',
    !!signedUp?.slug && signedUp.slug.startsWith('verify-bot-'));
  check('that profile page resolves',
    (await fresh.fetch(`/members/${signedUp.slug}`)).status === 200);

  // Members can rename themselves; the slug follows so the old name does
  // not linger in the profile URL.
  const rename = await fresh.fetch('/api/you/settings', {
    method: 'PATCH', body: JSON.stringify({ profile: { displayName: 'Verifybot' } }),
  });
  const [renamed] = await q(
    `select display_name, slug from members where id = $1`, [signedUp.id]);
  check('member can change their display name',
    rename.status === 200 && renamed.display_name === 'Verifybot');
  check('slug follows the new name, dropping the old one',
    renamed.slug.startsWith('verifybot-') && !renamed.slug.includes('verify-bot'));
  check('a one-character name is rejected',
    (await fresh.fetch('/api/you/settings', {
      method: 'PATCH', body: JSON.stringify({ profile: { displayName: 'x' } }),
    })).status === 400);

  // Sourced images die over time. Whether a URL is dead can only be known in
  // the browser, so EventImage swaps in the genre art there (screenshotted);
  // what is checkable here is that the card is served through that component
  // and that a missing image already falls back server-side.
  {
    await q(`update events set primary_image_url = 'https://example.invalid/dead.jpg'
              where slug = 'rewind-sessions-presents-jungle-mania'`);
    const dead = await (await anon.fetch('/events?genre=jungle')).text();
    check('a card with a dead image URL still renders',
      dead.includes('Rewind Sessions presents Jungle Mania'));
    await q(`update events set primary_image_url = null
              where slug = 'rewind-sessions-presents-jungle-mania'`);
    const none = await (await anon.fetch('/events?genre=jungle')).text();
    check('an event with no image falls back to genre art',
      none.includes('Rewind Sessions presents Jungle Mania') && none.includes('genreArt'));

    // No image and no genre either: the event type still beats a blank box.
    await q(`update events set primary_image_url = null where slug = 'the-garden-weekender'`);
    await q(`delete from event_genres
              where event_id = (select id from events where slug = 'the-garden-weekender')`);
    const typed = await (await anon.fetch('/events?tab=festivals')).text();
    check('an event with no image and no genre falls back to its type',
      typed.includes('The Garden Weekender') && typed.includes('WEEKENDER'));
  }

  // Admin can drop optional sections out of the nav without a deploy; the
  // pages stay reachable by URL.
  {
    check('non-admin cannot change site settings',
      (await fresh.fetch('/api/admin/site', {
        method: 'PATCH', body: JSON.stringify({ nav: { explore: false } }),
      })).status === 403);

    const off = await admin.fetch('/api/admin/site', {
      method: 'PATCH', body: JSON.stringify({ nav: { explore: false, people: false } }),
    });
    check('admin turns Explore and People off', off.status === 200);
    const hidden = await (await anon.fetch('/events')).text();
    check('both vanish from the nav',
      !hidden.includes('>Explore</a>') && !hidden.includes('>People</a>'));
    check('the pages still load by URL',
      (await anon.fetch('/explore')).status === 200);

    await admin.fetch('/api/admin/site', {
      method: 'PATCH', body: JSON.stringify({ nav: { explore: true, people: true } }),
    });
    const back = await (await anon.fetch('/events')).text();
    check('turning them back on restores the nav', back.includes('>Explore</a>'));
  }

  const you = await (await fresh.fetch('/you')).text();
  check('the You page offers the display-name field', you.includes('id="displayName"'));
  const header = await (await fresh.fetch('/events')).text();
  check('header no longer carries the + Add Event nav link',
    !header.includes('+ Add Event'));
  check('events page carries the big Add an event panel',
    header.includes('addEventCta') && header.includes('+ Add an event'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
await db.end();
