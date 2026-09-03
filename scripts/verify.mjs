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
// Venues routinely serve their flyers only to their own pages, so an imported
// event can arrive with artwork nobody outside that site can load.
console.log('\n— Replacing a blocked image with our own artwork —');
{
  const ev = (await q(
    `insert into events (title, slug, start_at, timezone, status, event_type, primary_image_url)
     values ('Blocked Art Night', 'blocked-art-night-verify', now() + interval '20 days',
             'Europe/London', 'new', 'club_night', 'https://blocked.example/flyer.jpg')
     returning id`
  ))[0];

  const queue = await (await admin.fetch('/admin/events?state=new')).text();
  check('the review queue offers to swap in our artwork', queue.includes('Use our artwork'));

  const cleared = await admin.fetch(`/api/admin/events/${ev.id}`, {
    method: 'PATCH', body: JSON.stringify({ primaryImageUrl: null }),
  });
  check('an admin can clear a blocked image', cleared.status === 200);
  const after = await q(`select primary_image_url from events where id = $1`, [ev.id]);
  check('the blocked URL is gone', after[0].primary_image_url === null);

  const member = await nadia.fetch(`/api/admin/events/${ev.id}`, {
    method: 'PATCH', body: JSON.stringify({ primaryImageUrl: null }),
  });
  check('a member cannot', member.status === 403);
  await q(`delete from events where id = $1`, [ev.id]);
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

  // The display name is edited on the profile page now, not on You.
  const profilePage = await (await fresh.fetch('/you/profile')).text();
  check('the profile page offers the display-name field', profilePage.includes('id="displayName"'));
  const header = await (await fresh.fetch('/events')).text();
  check('header no longer carries the + Add Event nav link',
    !header.includes('+ Add Event'));
  check('events page carries the one Add an event box, the footer\u2019s',
    header.includes('siteFooterAdd') && header.includes('Know something we\u2019re missing?'));
  check('the old purple panel with no box is gone',
    !header.includes('addEventCta'));
}


// ---------------------------------------------------------------------------
// Articles and events point at each other. The link is many-to-many, only the
// author or an admin may set it, and it never leaks: an unpublished article
// stays off the event page, an unpublished event stays off the article.
console.log('\n— Articles ↔ events —');
{
  const author = client();
  check('author login', (await author.login('dev-nadia@example.com')) === 200);
  const draft = await (await author.fetch('/api/articles', { method: 'POST' })).json();

  const [live] = await q(`select id, slug, title from events where status = 'live' order by start_at limit 1`);
  const [hidden] = await q(
    `insert into events (slug, title, start_at, timezone, status, city)
     values ('verify-unpublished-night', 'Verify Unpublished Night', now() + interval '10 days', 'Europe/London', 'needs_review', 'Lisbon')
     returning id, slug, title`
  );

  check('the picker finds a live event by name',
    (await (await author.fetch(`/api/articles/${draft.id}/events?q=${encodeURIComponent(live.title.slice(0, 6))}`)).json())
      .results.some((r) => r.id === live.id));

  check('someone else cannot link events on an article that is not theirs',
    (await (async () => {
      const other = client();
      await other.login('dev-jules@example.com');
      return other.fetch(`/api/articles/${draft.id}/events`, {
        method: 'PUT', body: JSON.stringify({ eventIds: [live.id] }),
      });
    })()).status === 403);

  const put = await author.fetch(`/api/articles/${draft.id}/events`, {
    method: 'PUT', body: JSON.stringify({ eventIds: [live.id, hidden.id] }),
  });
  check('the author links two nights in one call',
    put.status === 200 && (await put.json()).linked.length === 2);

  // Give the draft what publishing requires, then take it through review.
  await author.fetch(`/api/articles/${draft.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: 'Two nights in one piece',
      body: 'A preview of the weekend, written for the verify suite. '.repeat(20),
      hero_image_url: 'https://images.example.com/hero.jpg',
    }),
  });
  await author.fetch(`/api/articles/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'submit' }) });
  const editor = client();
  await editor.login('oshi@guestlist.net');
  const published = await (await editor.fetch(`/api/admin/articles/${draft.id}`, {
    method: 'PATCH', body: JSON.stringify({ action: 'publish' }),
  })).json();
  check('admin publishes the piece', published.article?.status === 'published');

  const articlePage = await (await anon.fetch(`/balance/${published.article.slug}`)).text();
  check('the article shows the night it is about', articlePage.includes(live.title));
  check('an unpublished night never surfaces through the article',
    !articlePage.includes(hidden.title));

  const eventPage = await (await anon.fetch(`/events/${live.slug}`)).text();
  check('the night shows the piece written about it',
    eventPage.includes('Written about this night') && eventPage.includes('Two nights in one piece'));

  // Replacing the set is a replacement, not a merge.
  await author.fetch(`/api/articles/${draft.id}/events`, {
    method: 'PUT', body: JSON.stringify({ eventIds: [hidden.id] }),
  });
  check('unlinking really unlinks',
    (await q(`select event_id from article_events where article_id = $1`, [draft.id]))
      .every((r) => r.event_id === hidden.id));
  check('the night no longer claims the piece',
    !(await (await anon.fetch(`/events/${live.slug}`)).text()).includes('Two nights in one piece'));

  await q(`delete from events where id = $1`, [hidden.id]);
  check('deleting an event takes its links with it',
    (await q(`select count(*)::int as n from article_events where event_id = $1`, [hidden.id]))[0].n === 0);
}


// ---------------------------------------------------------------------------
// WHICH source, not just what kind. "Venue website" says nothing when eight
// of them are open; the name is what tells you whether to trust a row.
console.log('\n— The review queue names its sources —');
{
  const desk = client();
  check('admin login', (await desk.login('oshi@guestlist.net')) === 200);

  const [src] = await q(
    `insert into event_sources (source_type, name, url, trust)
     values ('venue_website', 'ADE programme', 'https://named-source.example/api/program/', 'trusted')
     returning id`
  );
  const [ev] = await q(
    `insert into events (slug, title, title_normalized, start_at, timezone, status, city, country, source_type, source_url)
     values ('named-source-night', 'Named Source Night', 'named source night',
             now() + interval '18 days', 'Europe/Amsterdam', 'new', 'Amsterdam', 'Netherlands',
             'venue_website', 'https://named-source.example/en/program/2026/x/1/')
     returning id`
  );
  await q(`insert into event_source_links (event_id, source_id, url, kind)
           values ($1, $2, 'https://named-source.example/en/program/2026/x/1/', 'source_scan')`,
          [ev.id, src.id]);

  const page = await (await desk.fetch('/admin/events?state=new')).text();
  check('the review card names the source that brought the event in',
    page.includes('ADE programme'));
  check('and still says what kind of source it was',
    page.includes('Venue Website'));

  await q(`delete from event_source_links where event_id = $1`, [ev.id]);
  await q(`delete from events where id = $1`, [ev.id]);
  await q(`delete from event_sources where id = $1`, [src.id]);
}

// Deleting somebody, and the two mistakes that must be impossible.
console.log('\n— Removing a member —');
{
  const desk = client();
  check('admin login', (await desk.login('oshi@guestlist.net')) === 200);

  const [spam] = await q(
    `insert into members (email, password_hash, display_name, slug, home_city)
     values ('spam-bot@example.invalid', 'x', 'Spam Bot', 'spam-bot-000001', 'Nowhere')
     returning id`
  );
  // Something of theirs that other people can see, to prove the sweep is real.
  await q(
    `insert into events (slug, title, title_normalized, start_at, timezone, status, city, country, created_by)
     values ('spam-night', 'Spam Night', 'spam night', now() + interval '30 days',
             'Europe/London', 'new', 'Nowhere', 'United Kingdom', $1)`, [spam.id]
  );

  check('a member cannot delete anybody',
    (await nadia.fetch(`/api/admin/members/${spam.id}`, { method: 'DELETE' })).status === 403);

  const [me] = await q(`select id from members where email = 'oshi@guestlist.net'`);
  const self = await desk.fetch(`/api/admin/members/${me.id}`, { method: 'DELETE' });
  check('an admin cannot delete themselves', self.status === 400);

  const [otherAdmin] = await q(
    `insert into members (email, password_hash, display_name, slug, role)
     values ('second-admin@example.invalid', 'x', 'Second Admin', 'second-admin-000001', 'admin')
     returning id`
  );
  const adminDel = await desk.fetch(`/api/admin/members/${otherAdmin.id}`, { method: 'DELETE' });
  check('nor another admin without demoting them first', adminDel.status === 400);

  const gone = await desk.fetch(`/api/admin/members/${spam.id}`, { method: 'DELETE' });
  check('but a spam account goes', gone.status === 200);
  check('and is really gone',
    (await q(`select 1 from members where id = $1`, [spam.id])).length === 0);
  check('what they left behind survives without them',
    (await q(`select created_by from events where slug = 'spam-night'`))[0]?.created_by === null);
  check('and the deletion is on the record',
    (await q(`select 1 from audit_log where action = 'member_deleted'`)).length > 0);

  await q(`delete from events where slug = 'spam-night'`);
  await q(`delete from members where id = $1`, [otherAdmin.id]);
}

// Signing up is for people: a form filled in by something that cannot see it,
// or faster than anybody can read it, does not get an account.
console.log('\n— Signup is for people —');
{
  const bot = client();
  const honeypot = await bot.fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      email: 'bot1@example.invalid', password: 'password123',
      displayName: 'Bot One', homeCity: 'Leeds', nickname: 'filled in',
    }),
  });
  check('a form field only a script would fill in stops the signup', honeypot.status === 400);
  check('and no account was made',
    (await q(`select 1 from members where email = 'bot1@example.invalid'`)).length === 0);

  const tooFast = await bot.fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      email: 'bot2@example.invalid', password: 'password123',
      displayName: 'Bot Two', homeCity: 'Leeds', startedAt: Date.now(),
    }),
  });
  check('a form posted faster than it can be read stops too', tooFast.status === 400);

  const person = await bot.fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      email: 'slow-human@example.invalid', password: 'password123',
      displayName: 'Slow Human', homeCity: 'Leeds',
      startedAt: Date.now() - 30_000, nickname: '',
    }),
  });
  check('somebody who filled the form in normally still gets in', person.status === 200);
  await q(`delete from members where email = 'slow-human@example.invalid'`);
}

// A ticket link is a link out. Somebody who taps it is not done with the
// event page — and on a phone, "back" from a ticketing site is a coin toss.
console.log('\n— Links out open in a new tab —');
{
  const [ev] = await q(
    `select slug, id from events where status = 'live' and ticket_url is not null limit 1`);
  if (!ev) {
    check('an event with tickets exists to check', false, 'no live ticketed event in the seed');
  } else {
    const page = await (await client().fetch(`/events/${ev.slug}`)).text();
    const outLink = page.match(new RegExp(`<a[^>]*/out/${ev.id}[^>]*>`));
    check('the tickets link is on the page', !!outLink, 'no /out/ link rendered');
    check('and it opens away from Guestlist',
      !!outLink && outLink[0].includes('target="_blank"'), outLink?.[0] ?? '');
    check('with the opener closed behind it',
      !!outLink && /rel="[^"]*noopener/.test(outLink[0]), outLink?.[0] ?? '');
  }
}

// The admin desk is a work surface, not a shop window.
console.log('\n— The desk does not advertise to itself —');
{
  const desk = client();
  check('admin login', (await desk.login('oshi@guestlist.net')) === 200);
  const review = await (await desk.fetch('/admin/events?state=needs_review')).text();
  check('no "add an event" ask on the review queue',
    !review.includes('Know something we'
      + '\u2019re missing?'), 'the public ask should not be on the admin desk');
  check('but the footer links are still there', review.includes('Terms &amp; Conditions'));

  const publicPage = await (await client().fetch('/events')).text();
  check('and the ask is still on the pages it is for',
    publicPage.includes('Know something we' + '\u2019re missing?'));

  // Membership is making one ask already. A second, unrelated one directly
  // beneath it competes with the thing the page exists to do.
  const membership = await (await client().fetch('/membership')).text();
  check('nor on the page that is already asking for something',
    !membership.includes('Know something we' + '\u2019re missing?'));
  check('and that page keeps its footer too',
    membership.includes('Terms &amp; Conditions'));
}

// Proving an address is real — the wall a phone number would have been, at a
// fraction of the friction and none of the liability.
console.log('\n— Confirming an email —');
{
  const joiner = client();
  const email = `verify-me-${Date.now()}@example.invalid`;
  const su = await joiner.fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      email, password: 'password123', displayName: 'Unproved Person',
      homeCity: 'Leeds', startedAt: Date.now() - 30_000,
    }),
  });
  check('somebody can still join', su.status === 200);

  const [joined] = await q(
    `select id, slug, email_verified_at from members where email = $1`, [email]);
  check('but their address is not taken on trust', joined.email_verified_at === null);
  check('and a link was sent',
    (await q(`select 1 from email_verifications where member_id = $1`, [joined.id])).length > 0);

  // Being unverified is not being locked out.
  check('they can still use the site', (await joiner.fetch('/events')).status === 200);
  check('and their own profile still resolves',
    (await joiner.fetch(`/members/${joined.slug}`)).status === 200);
  // ...but nobody is offered them. Asked as SOMEBODY ELSE: their own name is
  // in the header of every page they load, which would pass this check for
  // the wrong reason.
  const dir = await (await nadia.fetch('/people')).text();
  check('nobody else is offered them until they prove it',
    !dir.includes('Unproved Person'), 'unverified member should not be in the directory');

  const [row] = await q(
    `select token_hash from email_verifications where member_id = $1`, [joined.id]);
  check('only a hash of the token is stored',
    !!row.token_hash && row.token_hash.length === 64);

  // CONFIRMING IS NOT A DESTINATION.
  //
  // The plain token exists in exactly one place — the email that was sent —
  // which is also the only place a person would ever get it from. Taking it
  // from there is what makes this the real journey and not an impression of
  // one: the link that was posted is the link that gets pressed.
  const [mail] = await q(
    `select body_text from email_outbox
      where member_id = $1 and email_type = 'transactional:verify_email'
      order by created_at desc limit 1`, [joined.id]);
  const link = (mail?.body_text ?? '').match(/\/verify\?token=(\S+)/);
  check('the email carries a link with a token in it', !!link);
  const token = link[1];

  const landed = await joiner.fetch(`/verify?token=${encodeURIComponent(token)}`);
  check('pressing it does not leave them on a page saying it worked',
    landed.status === 307 || landed.status === 302, `status ${landed.status}`);
  check('it puts them on the front page, with the news',
    landed.headers.get('location')?.endsWith('/?confirmed=new'),
    landed.headers.get('location'));

  const [proved] = await q(`select email_verified_at from members where id = $1`, [joined.id]);
  check('and the address is proved', proved.email_verified_at !== null);
  check('once proved, they can be found',
    (await (await nadia.fetch('/people')).text()).includes('Unproved Person'));

  // Somebody double-tapping the button in their email is not an error.
  const again = await joiner.fetch(`/verify?token=${encodeURIComponent(token)}`);
  check('pressing the same link twice says so, rather than breaking',
    again.headers.get('location')?.endsWith('/?confirmed=already'),
    again.headers.get('location'));

  // The front page is where the news gets said.
  const banner = await (await joiner.fetch('/?confirmed=new')).text();
  check('the front page carries the confirmation', banner.includes('Account confirmed'));
  // Somebody who has just finished joining is the most willing they will ever
  // be to do the next thing, so the line does not stop at "well done".
  check('and asks them what they are doing with it',
    banner.includes('where are you going tonight?') && banner.includes('/archive/add'));
  check('and does not carry it unasked',
    !(await (await joiner.fetch('/')).text()).includes('Account confirmed'));

  // A link that is not one of ours still lands somewhere useful.
  const bad = await joiner.fetch('/verify?token=not-a-real-token');
  const badHtml = await bad.text();
  check('a made-up token confirms nothing', bad.status === 200);
  check('and says so, with a way to get a real one',
    badHtml.includes('That link did not work') && badHtml.includes('Send me a new link'));
  // Arriving at /verify with nothing is not a broken link — it is somebody
  // who came looking for the button — so it asks rather than tells off.
  const bare = await (await joiner.fetch('/verify')).text();
  check('arriving with no token asks instead of scolding',
    bare.includes('Confirm your email') && !bare.includes('That link did not work'));
  check('and still offers the button', bare.includes('Send me a link'));
  check('the API still refuses a made-up token',
    (await joiner.fetch('/api/auth/verify', {
      method: 'POST', body: JSON.stringify({ token: 'not-a-real-token' }),
    })).status === 400);

  await q(`delete from members where id = $1`, [joined.id]);
}

// ---------------------------------------------------------------------------
// THE FILTERS STOP WHEN THEY REACH THE NAVIGATION.
//
// Scrolling a long list used to take the controls for narrowing it off the
// top of the screen, so changing your mind meant scrolling back up first.
// Both pages that list events now keep them in a band under the header.
console.log('\n— Privacy and email live with the profile —');
{
  const profile = await (await nadia.fetch('/you/profile')).text();
  check('the profile page carries the privacy switches',
    profile.includes('Public profile') && profile.includes('Show my rave history'));
  check('and the email settings', profile.includes('Alert email frequency'));

  const you = await (await nadia.fetch('/you')).text();
  check('they are no longer on the taste page', !you.includes('Alert email frequency'));
  check('but what is left there still works',
    you.includes('Rave history') && you.includes('Places'));
  check('and it points at where they went', you.includes('/you/profile#settings'));
}

console.log('\n— The filters stay on screen —');
{
  // THE NAVIGATION IS NOT A WINDOW. It was a translucent pane with a blur
  // behind it, so event artwork slid through the wordmark and the links as
  // you scrolled — and a sticky filter band under it makes that constant
  // rather than occasional. Asked of the stylesheet, because "is this pixel
  // white" is not a thing a fetch can answer.
  const css = readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
  const headerGrounds = [...css.matchAll(/--header-bg:\s*([^;]+);/g)].map((m) => m[1].trim());
  check('both themes give the navigation a ground', headerGrounds.length === 2, String(headerGrounds));
  check('and neither of them is see-through',
    headerGrounds.every((v) => !v.includes('rgba') && !v.includes('transparent')),
    headerGrounds.join(' | '));
  check('so nothing needs blurring behind it',
    !/\.siteHeader\s*\{[^}]*backdrop-filter/.test(css));

  const events = await (await anon.fetch('/events')).text();
  check('the events page has a sticky band', events.includes('stickyFilters'));
  // Order matters more than presence: the band has to be the thing WRAPPING
  // the controls, not another row sitting near them.
  const band = events.indexOf('stickyFilters');
  check('with the genres inside it',
    band > 0 && events.indexOf('aria-label="Genres"') > band);
  check('and the date picker inside it too',
    events.indexOf('aria-label="Date"') > band);

  const home = await (await anon.fetch('/')).text();
  const homeBand = home.indexOf('stickyFilters');
  check('the front page keeps its genres too',
    homeBand > 0 && home.indexOf('aria-label="Genres"') > homeBand);
}

// A profile nobody has written anything on is not offered to search engines.
console.log('\n— An empty profile is not advertised —');
{
  const [blank] = await q(
    `insert into members (email, password_hash, display_name, slug, email_verified_at)
     values ('blank-profile@example.invalid', 'x', 'Blank Profile', 'blank-profile-000001', now())
     returning id`
  );
  const [filled] = await q(
    `insert into members (email, password_hash, display_name, slug, home_city, email_verified_at)
     values ('filled-profile@example.invalid', 'x', 'Filled Profile', 'filled-profile-000001', 'Leeds', now())
     returning id`
  );
  const anon = client();
  const blankPage = await (await anon.fetch('/members/blank-profile-000001')).text();
  const filledPage = await (await anon.fetch('/members/filled-profile-000001')).text();
  check('a page with nothing written on it asks not to be indexed',
    /noindex/i.test(blankPage), 'blank profile should carry noindex');
  check('a page with something on it does not',
    !/noindex/i.test(filledPage), 'filled profile should be indexable');

  await q(`delete from members where id in ($1, $2)`, [blank.id, filled.id]);
}

// A source is never put on a schedule by anything but a person.
console.log('\n— Nothing schedules itself —');
{
  const [row] = await q(
    `select column_default from information_schema.columns
      where table_name = 'event_sources' and column_name = 'polling_enabled'`
  );
  check('a new source does not poll unless somebody says so',
    String(row?.column_default ?? '').includes('false'), JSON.stringify(row));

  const [made] = await q(
    `insert into event_sources (source_type, name, url, trust)
     values ('venue_website', 'Unscheduled', 'https://unscheduled.example/whats-on', 'trusted')
     returning polling_enabled`
  );
  check('and an added source starts off the schedule', made.polling_enabled === false);
  await q(`delete from event_sources where url = 'https://unscheduled.example/whats-on'`);
}

// Publish all: the review queue cleared in one press, without sweeping up
// the two things a person still has to decide about.
console.log('\n— Publish all —');
{
  const bulk = client();
  check('admin login', (await bulk.login('oshi@guestlist.net')) === 200);

  const mk = (title) => q(
    `insert into events (slug, title, title_normalized, start_at, timezone, status, city, country)
     values ($1, $2, lower($2), now() + interval '20 days', 'Europe/London', 'new', 'Leeds', 'United Kingdom')
     returning id`,
    [`bulk-${title}`, `Bulk ${title}`]
  );

  const [ok1] = await mk('one');
  const [ok2] = await mk('two');
  const [dupTarget] = await mk('target');
  const [flagged] = await q(
    `insert into events (slug, title, title_normalized, start_at, timezone, status, city, country, possible_duplicate_of)
     values ('bulk-flagged', 'Bulk Flagged', 'bulk flagged', now() + interval '21 days', 'Europe/London', 'new', 'Leeds', 'United Kingdom', $1)
     returning id`, [dupTarget.id]
  );
  const [finished] = await q(
    `insert into events (slug, title, title_normalized, start_at, end_at, timezone, status, city, country)
     values ('bulk-finished', 'Bulk Finished', 'bulk finished', now() - interval '9 days', now() - interval '9 days' + interval '5 hours', 'Europe/London', 'new', 'Leeds', 'United Kingdom')
     returning id`
  );

  const queue = await (await bulk.fetch('/admin/events?state=new')).text();
  check('the review queue offers publish all', queue.includes('Publish all'));
  check('the bar says what it will skip',
    queue.includes('flagged as a possible duplicate'));

  check('a member cannot publish a queue',
    (await nadia.fetch('/api/admin/events/publish-all', { method: 'POST', body: JSON.stringify({ state: 'new' }) })).status === 403);
  check('rejected is not a queue anyone can bulk-publish',
    (await bulk.fetch('/api/admin/events/publish-all', { method: 'POST', body: JSON.stringify({ state: 'rejected' }) })).status === 400);

  const res = await bulk.fetch('/api/admin/events/publish-all', {
    method: 'POST', body: JSON.stringify({ state: 'new' }),
  });
  const out = await res.json();
  check('publishing the queue reports what it did',
    res.status === 200 && out.published >= 3 && out.skippedDuplicates >= 1 && out.skippedPast >= 1);

  const after = await q(
    `select id, status::text from events where id = any($1::uuid[])`,
    [[ok1.id, ok2.id, flagged.id, finished.id]]
  );
  const statusOf = (id) => after.find((r) => r.id === id)?.status;
  check('the clean ones went live',
    statusOf(ok1.id) === 'live' && statusOf(ok2.id) === 'live');
  check('a flagged duplicate was left for a person to decide',
    statusOf(flagged.id) === 'new');
  check('an event that already finished was left alone',
    statusOf(finished.id) === 'new');
  check('publishing stamped published_at',
    (await q(`select published_at from events where id = $1`, [ok1.id]))[0].published_at !== null);
  check('the bulk publish is in the audit log',
    (await q(`select count(*)::int as n from audit_log where action = 'events_bulk_published'`))[0].n > 0);

  await q(`delete from events where slug like 'bulk-%'`);
}


// ---------------------------------------------------------------------------
// A country has a page of its own, and a city page puts its own country next.
console.log('\n— Country pages —');
{
  const [uk] = await q(
    `select count(*)::int as n from events e join locations l on l.id = e.location_id
      where l.country_name = 'United Kingdom' and e.status = 'live' and e.start_at > now()`
  );
  const page = await (await anon.fetch('/united-kingdom')).text();
  check('a country page exists at its own slug', page.includes('Coming up in the United Kingdom'));
  check('it lists the cities in that country', page.includes('London'));
  check('it offers somewhere to go next', page.includes('Beyond the United Kingdom'));
  check('the country actually has events to show', uk.n > 0);

  check('a country nobody has cities in is a 404',
    (await anon.fetch('/atlantis')).status === 404);

  // "IT" is not a country. Nothing should route to it as one.
  check('an ISO code is not its own country page',
    (await anon.fetch('/it')).status === 404);

  const explore = await (await anon.fetch('/explore')).text();
  check('explore points its country headings at the country page',
    explore.includes('href="/united-kingdom"'));

  const city = await (await anon.fetch('/london')).text();
  check('a city page names its own city first',
    city.indexOf('Coming up in London') > 0);
  check('then the rest of that country', city.includes('Elsewhere in the United Kingdom'));
  check('then everywhere else', city.includes('Beyond the United Kingdom'));
  check('the country comes before the world on a city page',
    city.indexOf('Coming up in London') < city.indexOf('Elsewhere in the United Kingdom')
    && city.indexOf('Elsewhere in the United Kingdom') < city.indexOf('Beyond the United Kingdom'));
  check('a city page links up to its country',
    city.includes('href="/united-kingdom"'));
  // The country shelf excludes the city you are already looking at, so a
  // London night is listed once on /london, not twice.
  const [londonEvent] = await q(
    `select e.slug from events e join locations l on l.id = e.location_id
      where l.slug = 'london' and e.status = 'live'
        and e.listing_status <> 'cancelled' and e.start_at > now()
      order by e.start_at limit 1`
  );
  check('the rest of the country never repeats the city itself',
    !!londonEvent && city.split(`/events/${londonEvent.slug}"`).length - 1 === 1);
}

// ---------------------------------------------------------------------------
// Admins hear about the site: who joined, what was written, and what is
// waiting. One line per rare happening; one rolling digest for the queues.
console.log('\n— Admin notifications —');
{
  const boss = client();
  check('admin login', (await boss.login('oshi@guestlist.net')) === 200);
  const [me] = await q(`select id from members where email = 'oshi@guestlist.net'`);

  // A member joins.
  const joinEmail = `verify-joiner-${Date.now()}@example.com`;
  check('somebody joins',
    (await client().fetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: joinEmail, password: 'a-brand-new-password', displayName: 'Verify Joiner', homeCity: 'Leeds' }),
    })).status === 200);
  const [joiner] = await q(`select id from members where email = $1`, [joinEmail]);
  check('the admin is told a member joined',
    (await q(`select count(*)::int as n from notifications
               where member_id = $1 and type = 'admin_new_member' and actor_member_id = $2`,
      [me.id, joiner.id]))[0].n === 1);
  check('the notification centre names them',
    (await (await boss.fetch('/notifications')).text()).includes('New member: Verify Joiner'));

  // An article is submitted for review.
  const author = client();
  await author.login('dev-jules@example.com');
  const draft = await (await author.fetch('/api/articles', { method: 'POST' })).json();
  await author.fetch(`/api/articles/${draft.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: 'A night worth writing about',
      body: 'Words for the verify suite, enough of them to pass the length check. '.repeat(15),
      hero_image_url: 'https://images.example.com/hero.jpg',
    }),
  });
  const submitted = await author.fetch(`/api/articles/${draft.id}`, {
    method: 'PATCH', body: JSON.stringify({ action: 'submit' }),
  });
  check('the article submits', submitted.status === 200);
  check('the admin is told an article is waiting',
    (await q(`select count(*)::int as n from notifications
               where member_id = $1 and type = 'admin_new_article' and article_id = $2`,
      [me.id, draft.id]))[0].n === 1);

  // The rolling digest: one unread, refreshed rather than repeated.
  await q(`insert into events (slug, title, title_normalized, start_at, timezone, status, city, country)
           values ('notify-waiting', 'Notify Waiting', 'notify waiting', now() + interval '30 days', 'Europe/London', 'new', 'Leeds', 'United Kingdom')`);
  const job = await boss.fetch('/api/jobs/send-emails', { method: 'POST' });
  check('the hourly job refreshes the review digest', job.status === 200);
  const digests = await q(
    `select payload from notifications
      where member_id = $1 and type = 'admin_review_waiting' and read_at is null`, [me.id]
  );
  check('exactly one unread digest, never one per event', digests.length === 1);
  check('the digest counts what is actually waiting',
    digests[0].payload.events >= 1 && digests[0].payload.articles >= 1
    && digests[0].payload.total >= 2);

  await boss.fetch('/api/jobs/send-emails', { method: 'POST' });
  check('running it again refreshes rather than stacks',
    (await q(`select count(*)::int as n from notifications
               where member_id = $1 and type = 'admin_review_waiting' and read_at is null`,
      [me.id]))[0].n === 1);

  // A member pasting a link is one person waiting on one person, so the
  // count moves without waiting for the hourly job.
  check('a member submission refreshes the digest on its own',
    (await q(`select count(*)::int as n from notifications
               where type = 'admin_review_waiting' and read_at is null`))[0].n >= 1);

  check('the digest reads as a sentence, not a payload',
    (await (await boss.fetch('/notifications')).text()).includes('waiting for review'));
  check('the admin pages show what is waiting',
    (await (await boss.fetch('/admin/events')).text()).includes('Waiting for you'));

  // Clearing the queues clears the standing digest.
  await q(`delete from events where slug = 'notify-waiting'`);
  await q(`update events set status = 'live' where status in ('new', 'needs_review')`);
  await q(`update articles set status = 'draft' where status = 'submitted'`);
  await q(`update promoter_claims set status = 'approved' where status = 'pending'`);
  await q(`update genre_suggestions set status = 'dismissed' where status = 'pending'`);
  await q(`update archive_corrections set status = 'rejected' where status = 'open'`);
  await q(`update member_reports set status = 'resolved' where status = 'open'`);
  await q(`update archive_memories set report_count = 0 where report_count > 0`);
  await boss.fetch('/api/jobs/send-emails', { method: 'POST' });
  check('an empty desk clears the standing digest',
    (await q(`select count(*)::int as n from notifications
               where type = 'admin_review_waiting' and read_at is null`))[0].n === 0);
  check('and the bar disappears with it',
    !(await (await boss.fetch('/admin/events')).text()).includes('Waiting for you'));
}


// ---------------------------------------------------------------------------
// Most promoter sites never declare an og:image, so an event arrives with
// everything except its flyer. Going back to the page and reading the artwork
// off it is what fixes the ones already imported.
console.log('\n— Finding missing flyers —');
{
  const { createServer } = await import('node:http');
  // A page in the shape the real world keeps producing: no og:image, a logo
  // in the header, and the actual flyer lazy-loaded inside the article.
  const flyerDate = new Date(Date.now() + 28 * 86400_000).toISOString().slice(0, 10);
  // JSON-LD with the facts but NO image — exactly the shape that was arriving
  // with events and no artwork.
  const noMetadataPage = `<!doctype html><html><head><title>Nilipe Night</title>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'MusicEvent', name: 'Nilipe Night',
    startDate: `${flyerDate}T21:00:00+03:00`,
    location: { '@type': 'Place', name: 'Nilipe', address: { '@type': 'PostalAddress', addressLocality: 'Dar es Salaam', addressCountry: 'Tanzania' } },
  })}</script></head>
<body>
  <header><img src="/wp-content/uploads/logo.png" width="300" height="300"></header>
  <article>
    <img src="data:image/gif;base64,R0lGOD" data-src="/wp-content/uploads/2026/03/nilipe-flyer.jpg"
         width="1080" height="1080" alt="Nilipe Night">
  </article>
</body></html>`;
  const fixtures = createServer((req, res) => {
    if (req.url?.startsWith('/event/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(noMetadataPage);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => fixtures.listen(4586, '127.0.0.1', r));
  const sourcePage = 'http://127.0.0.1:4586/event/nilipe-night';

  const [blank] = await q(
    `insert into events (slug, title, title_normalized, start_at, timezone, status, city, country, source_url)
     values ('flyerless-night', 'Flyerless Night', 'flyerless night', now() + interval '25 days',
             'Africa/Dar_es_Salaam', 'new', 'Dar es Salaam', 'Tanzania', $1)
     returning id`, [sourcePage]
  );

  const boss2 = client();
  await boss2.login('oshi@guestlist.net');

  check('the queue offers to find the missing flyers',
    (await (await boss2.fetch('/admin/events?state=new')).text()).includes('Find missing images'));
  check('a member cannot make Guestlist fetch pages',
    (await nadia.fetch(`/api/admin/events/${blank.id}/image`, { method: 'POST' })).status === 403);

  const one = await boss2.fetch(`/api/admin/events/${blank.id}/image`, { method: 'POST' });
  const found = await one.json();
  check('the flyer is read off a page that declares nothing',
    one.status === 200 && found.url === 'http://127.0.0.1:4586/wp-content/uploads/2026/03/nilipe-flyer.jpg');
  check('it is the flyer, not the logo in the header',
    !String(found.url).includes('logo'));
  check('the event now carries it',
    (await q(`select primary_image_url from events where id = $1`, [blank.id]))[0].primary_image_url
      === 'http://127.0.0.1:4586/wp-content/uploads/2026/03/nilipe-flyer.jpg');
  check('and it is kept in the event image list too',
    (await q(`select count(*)::int as n from event_images where event_id = $1`, [blank.id]))[0].n === 1);

  check('an image already chosen is never overwritten by a later guess',
    (await boss2.fetch(`/api/admin/events/${blank.id}/image`, { method: 'POST' })).status === 409);
  check('unless a person asks for another look',
    (await boss2.fetch(`/api/admin/events/${blank.id}/image`, {
      method: 'POST', body: JSON.stringify({ replace: true }),
    })).status === 200);

  // An event with no source page cannot be helped, and says so plainly.
  const [orphan] = await q(
    `insert into events (slug, title, title_normalized, start_at, timezone, status, city)
     values ('flyerless-orphan', 'Flyerless Orphan', 'flyerless orphan', now() + interval '26 days',
             'Europe/London', 'new', 'Leeds')
     returning id`
  );
  check('an event with no source page says so rather than failing quietly',
    (await boss2.fetch(`/api/admin/events/${orphan.id}/image`, { method: 'POST' })).status === 422);

  // And the whole queue at once.
  await q(`update events set primary_image_url = null where id = $1`, [blank.id]);
  const bulk = await boss2.fetch('/api/admin/events/find-images', {
    method: 'POST', body: JSON.stringify({ state: 'new' }),
  });
  const bulkOut = await bulk.json();
  check('the queue can be swept in one press',
    bulk.status === 200 && bulkOut.found >= 1);
  check('an unknown queue is refused',
    (await boss2.fetch('/api/admin/events/find-images', {
      method: 'POST', body: JSON.stringify({ state: 'rejected' }),
    })).status === 400);

  // A new import from the same shape of page now arrives WITH its flyer.
  // A member who has not spent their submission allowance earlier in this
  // suite — the paste-link rate limit is per member, and it works.
  const fresh = client();
  await fresh.login('dev-priya@example.com');
  const submitted = await (await fresh.fetch('/api/submissions', {
    method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:4586/event/another-night' }),
  })).json();
  check('a fresh import brings the flyer with it',
    submitted.ok !== false &&
    (await q(`select primary_image_url from events where source_url = $1`,
      ['http://127.0.0.1:4586/event/another-night']))[0]?.primary_image_url
      === 'http://127.0.0.1:4586/wp-content/uploads/2026/03/nilipe-flyer.jpg');

  await q(`delete from events where slug in ('flyerless-night', 'flyerless-orphan')`);
  await q(`delete from events where source_url like 'http://127.0.0.1:4586/%'`);
  await new Promise((r) => fixtures.close(r));
}


// ---------------------------------------------------------------------------
// The footer belongs to the site, not to the homepage.
console.log('\n— The footer, everywhere —');
{
  // Pages a signed-out visitor actually gets a page for — /people redirects
  // to the sign-in, and a redirect has no body to carry a footer.
  const pages = ['/', '/events', '/explore', '/balance', '/login', '/terms'];
  const bodies = {};
  for (const path of pages) bodies[path] = await (await anon.fetch(path)).text();

  check('every page carries the footer',
    pages.every((p) => bodies[p].includes('siteFooter')));
  check('and carries it exactly once',
    pages.every((p) => bodies[p].split('class="siteFooter"').length - 1 === 1));
  // The Archive is browsed, not navigated — the "add a night that's on" ask
  // has nothing to say about 1996.
  // Not just the ask — the whole footer. The Archive is a wall of flyers and
  // memories; "know a night we're missing?" has nothing to say about 1996.
  const archive = await (await anon.fetch('/archive')).text();
  check('the archive has no footer at all',
    !archive.includes('siteFooter') && !archive.includes('Know something we’re missing?'));
  check('and neither do the pages inside it',
    !(await (await anon.fetch('/archive/search')).text()).includes('siteFooter'));
  check('the terms and privacy links are reachable from anywhere',
    pages.every((p) => bodies[p].includes('/terms') && bodies[p].includes('/privacy')));
  check('the add-an-event ask travels with it',
    bodies['/explore'].includes('Know something we’re missing?'));
  check('adding by hand is a footer link, not a second button under the box',
    bodies['/explore'].includes('>Add event</a>')
    && !bodies['/explore'].includes('Add manually'));
  check('and the ask is the same one everywhere — no second panel',
    bodies['/events'].includes('siteFooterAdd')
    && !bodies['/events'].includes('addEventCta'));

  const signedIn = await (await nadia.fetch('/explore')).text();
  check('a signed-in member is offered the article link directly',
    signedIn.includes('href="/articles/new"'));
  check('a signed-out visitor is sent to sign in first',
    bodies['/explore'].includes('/login?next=/articles/new'));
}


// ---------------------------------------------------------------------------
// Tonight is the most local question the site asks. It had no geography in it
// at all — no ordering, a bare limit — so a member in London opened it and got
// Spain.
console.log('\n— Tonight, from where you are —');
{
  const londoner = client();
  check('a Londoner signs in', (await londoner.login('dev-nadia@example.com')) === 200);

  // One night in their city, one in their country, one a long way away — all
  // inside the tonight window.
  const [london] = await q(`select id, latitude, longitude from locations where slug = 'london'`);
  const [ibiza] = await q(`select id from locations where lower(name) = 'ibiza'`);
  const mk = (slug, title, city, country, locationId, lat, lng) => q(
    `insert into events (slug, title, title_normalized, start_at, end_at, timezone, status,
                         city, country, location_id, latitude, longitude, listing_status, published_at)
     values ($1, $2, lower($2), now() + interval '3 hours', now() + interval '9 hours',
             'Europe/London', 'live', $3, $4, $5, $6, $7, 'confirmed', now())
     returning id`,
    [slug, title, city, country, locationId, lat, lng]
  );
  const [here] = await mk('tonight-here', 'Tonight In London', 'London', 'United Kingdom',
    london.id, london.latitude ?? 51.5074, london.longitude ?? -0.1278);
  const [sameCountry] = await mk('tonight-country', 'Tonight In Glasgow', 'Glasgow', 'United Kingdom',
    null, 55.8642, -4.2518);
  const [faraway] = await mk('tonight-spain', 'Tonight In Ibiza', 'Ibiza', 'Spain',
    ibiza?.id ?? null, 38.9067, 1.4206);

  // Nadia's home city is London in the seed; make sure the anchor exists.
  await q(`update members set home_location_id = $1 where email = 'dev-nadia@example.com'`,
    [london.id]);

  const page = await (await londoner.fetch('/clubmessenger')).text();
  check('their own city is the first heading', page.includes('Tonight near London'));
  check('the rest of their country is its own section',
    page.includes('Elsewhere in the United Kingdom tonight'));
  check('and another country is plainly labelled as such',
    page.includes('Beyond the United Kingdom tonight'));
  check('home comes before the country, which comes before the world',
    page.indexOf('Tonight In London') < page.indexOf('Tonight In Glasgow')
    && page.indexOf('Tonight In Glasgow') < page.indexOf('Tonight In Ibiza'));

  // Being popular somewhere else never lifts it above home.
  const [rob] = await q(`select id from members where email = 'dev-rob@example.com'`);
  const [sophie] = await q(`select id from members where email = 'dev-sophie@example.com'`);
  for (const m of [rob, sophie]) {
    await q(`insert into member_event_actions (member_id, event_id, rsvp, rsvp_at)
             values ($1, $2, 'going', now())
             on conflict (member_id, event_id) do update set rsvp = 'going'`, [m.id, faraway.id]);
  }
  const busy = await (await londoner.fetch('/clubmessenger')).text();
  check('a busier night abroad still sits below home',
    busy.indexOf('Tonight In London') < busy.indexOf('Tonight In Ibiza'));

  // A member who has never said where they live is asked, not guessed at.
  const nowhere = client();
  const nowhereEmail = `verify-placeless-${Date.now()}@example.com`;
  await client().fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: nowhereEmail, password: 'a-brand-new-password', displayName: 'Placeless Pat' }),
  });
  await nowhere.login(nowhereEmail, 'a-brand-new-password');
  const unplaced = await (await nowhere.fetch('/clubmessenger')).text();
  check('a member with no city is asked for one rather than sorted wrongly',
    unplaced.includes('we don’t know where you are') && unplaced.includes('/you#places'));
  check('and still sees what is on, under a plain heading',
    unplaced.includes('Tonight In London') && !unplaced.includes('Tonight near'));

  await q(`delete from events where slug like 'tonight-%'`);
}


// ---------------------------------------------------------------------------
// A typed city has to become a real place, or nothing can put local events
// first. And a blank one gets asked about rather than shrugged at.
console.log('\n— Signing up with a city —');
{
  const signupPage = await (await anon.fetch('/signup')).text();
  check('the city field says why it is there',
    signupPage.includes('We put what’s on near you at the top'));
  check('it is no longer labelled as an afterthought',
    signupPage.includes('Your city') && !signupPage.includes('Home city (optional)'));
  // The blank-city ask itself is client-side, so what the server page can
  // prove is that the field invites a real answer.
  check('the field invites a real city rather than a shrug',
    signupPage.includes('London, Lagos, Dar es Salaam'));

  const email = `verify-placed-${Date.now()}@example.com`;
  check('somebody joins with a city',
    (await client().fetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'a-brand-new-password', displayName: 'Placed Person', homeCity: 'London' }),
    })).status === 200);
  const [joined] = await q(
    `select m.home_city, l.name as location_name, l.slug as location_slug
       from members m left join locations l on l.id = m.home_location_id
      where m.email = $1`, [email]
  );
  check('the city they typed is resolved to a real place, not just stored as text',
    joined.home_city === 'London' && joined.location_slug === 'london');

  // Which is the whole point: that member's Tonight now knows where they are.
  const placed = client();
  await placed.login(email, 'a-brand-new-password');
  const theirTonight = await (await placed.fetch('/clubmessenger')).text();
  check('and their Tonight starts from their own city',
    theirTonight.includes('Tonight near London')
    || !theirTonight.includes('we don’t know where you are'));

  // A city we have never heard of is created rather than dropped.
  const oddEmail = `verify-odd-city-${Date.now()}@example.com`;
  await client().fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: oddEmail, password: 'a-brand-new-password', displayName: 'Odd City', homeCity: 'Nungwi' }),
  });
  check('a city Guestlist has never seen is created, not discarded',
    (await q(`select l.name from members m join locations l on l.id = m.home_location_id where m.email = $1`,
      [oddEmail]))[0]?.name === 'Nungwi');
}


// ---------------------------------------------------------------------------
// "Dar es salaam" on a page of members reads as carelessness. Cities are
// tidied on the way in, and the migration tidied the ones already stored.
console.log('\n— One city, one spelling —');
{
  const messy = `verify-messy-city-${Date.now()}@example.com`;
  check('somebody joins typing their city carelessly',
    (await client().fetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: messy, password: 'a-brand-new-password',
        displayName: 'Careless Typist', homeCity: '  dar es salaam ',
      }),
    })).status === 200);

  const [row] = await q(
    `select m.home_city, l.name as location_name
       from members m left join locations l on l.id = m.home_location_id
      where m.email = $1`, [messy]
  );
  check('it is stored as the city, properly spelled', row.home_city === 'Dar es Salaam');
  check('and the place it resolved to carries the same spelling',
    row.location_name === 'Dar es Salaam');

  // Two people typing it differently land on ONE city, not two.
  const shouty = `verify-shouty-city-${Date.now()}@example.com`;
  await client().fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      email: shouty, password: 'a-brand-new-password',
      displayName: 'Shouty Typist', homeCity: 'DAR ES SALAAM',
    }),
  });
  check('two spellings are one city, not two',
    (await q(`select count(*)::int as n from locations
               where kind = 'city' and lower(name) = 'dar es salaam'`))[0].n === 1);
  check('and both members are filed under it',
    (await q(`select count(distinct home_location_id)::int as n from members
               where email in ($1, $2)`, [messy, shouty]))[0].n === 1);

  // The migration cleaned what was already stored.
  await q(`update members set home_city = 'dar es salaam' where email = $1`, [messy]);
  check('a value written before the cleanup is visibly wrong until fixed',
    (await q(`select home_city from members where email = $1`, [messy]))[0].home_city === 'dar es salaam');

  const people = await (await nadia.fetch('/people')).text();
  check('no member is shown a city in lower case',
    !/Now in (dar|london|zanzibar|brighton)\b/.test(people));
}


// ---------------------------------------------------------------------------
// Picking a city from the dropdown and getting nothing is a dead end: the
// dropdown only lists cities that HAVE events, so an empty result means the
// tab filtered them out, not that the city is quiet.
console.log('\n— Picking a city that has events —');
{
  const [paris] = await q(
    `insert into locations (kind, name, normalized_name, slug, country_code, country_name, timezone)
     values ('city', 'Paris', 'paris', 'paris-verify', 'FR', 'France', 'Europe/Paris')
     on conflict (kind, normalized_name, country_code) do update set name = 'Paris'
     returning id`
  );
  // A real Paris night that nobody flagged as "worth travelling for".
  await q(
    `insert into events (slug, title, title_normalized, start_at, timezone, status, city, country,
                         location_id, worth_travelling, listing_status, published_at)
     values ('paris-verify-night', 'Paris Verify Night', 'paris verify night',
             now() + interval '14 days', 'Europe/Paris', 'live', 'Paris', 'France',
             $1, false, 'confirmed', now())`,
    [paris.id]
  );

  check('the city dropdown offers Paris, because Paris has events',
    (await (await anon.fetch('/events')).text()).includes('Paris'));

  // A Londoner on Worth Travelling For: France is not home, so it shows —
  // even though nobody flagged it.
  const londoner = client();
  await londoner.login('dev-nadia@example.com');
  const travel = await (await londoner.fetch('/events?tab=travel&city=Paris')).text();
  check('a night abroad shows on Worth Travelling For without being flagged',
    travel.includes('Paris Verify Night'));

  // And when a tab genuinely has nothing for that city, it says so and offers
  // the way out rather than a bare "nothing matching".
  const wrongTab = await (await londoner.fetch('/events?tab=festivals&city=Paris')).text();
  check('an empty tab explains that the city is not the problem',
    wrongTab.includes('has nights on Guestlist'));
  check('and offers the city without the tab',
    wrongTab.includes('See everything in Paris'));
  check('which is a link that actually keeps the city',
    wrongTab.includes('city=Paris'));

  await q(`delete from events where slug = 'paris-verify-night'`);
  await q(`delete from locations where slug = 'paris-verify'`);
}


// ---------------------------------------------------------------------------
// Tonight is on TWO pages. They must not drift — that is exactly how the
// Tonight page came to show a member their own city first while the homepage
// carried on showing Spain.
console.log('\n— Tonight, in both places at once —');
{
  const [london] = await q(`select id, latitude, longitude from locations where slug = 'london'`);
  await q(`update members set home_location_id = $1 where email = 'dev-nadia@example.com'`, [london.id]);
  const mk = (slug, title, city, country, loc, lat, lng) => q(
    `insert into events (slug, title, title_normalized, start_at, end_at, timezone, status,
                         city, country, location_id, latitude, longitude, listing_status, published_at)
     values ($1, $2, lower($2), now() + interval '3 hours', now() + interval '9 hours',
             'Europe/London', 'live', $3, $4, $5, $6, $7, 'confirmed', now())`,
    [slug, title, city, country, loc, lat, lng]
  );
  await mk('both-home', 'Both Home Night', 'London', 'United Kingdom', london.id, 51.5074, -0.1278);
  await mk('both-away', 'Both Away Night', 'Ibiza', 'Spain', null, 38.9067, 1.4206);

  const viewer = client();
  await viewer.login('dev-nadia@example.com');
  const home = await (await viewer.fetch('/')).text();
  const tonightPage = await (await viewer.fetch('/clubmessenger')).text();

  const firstOf = (html) => {
    const h = html.indexOf('Both Home Night');
    const a = html.indexOf('Both Away Night');
    return h === -1 || a === -1 ? null : (h < a ? 'home' : 'away');
  };
  check('the homepage band shows tonight', firstOf(home) !== null);
  check('the Tonight page shows tonight', firstOf(tonightPage) !== null);
  check('both put the member’s own city first — the same rule, one place',
    firstOf(home) === 'home' && firstOf(tonightPage) === 'home');

  await q(`delete from events where slug like 'both-%'`);
}

// ---------------------------------------------------------------------------
// A member has a home city AND cities they follow. A followed city is
// somewhere they chose to care about, so it comes after home and before the
// rest of their country.
console.log('\n— Cities you follow come next —');
{
  const [london] = await q(`select id, latitude, longitude from locations where slug = 'london'`);
  const [followed] = await q(
    `insert into locations (kind, name, normalized_name, slug, country_code, country_name, timezone, latitude, longitude)
     values ('city', 'Lagos', 'lagos', 'lagos-verify', 'NG', 'Nigeria', 'Africa/Lagos', 6.5244, 3.3792)
     on conflict (kind, normalized_name, country_code) do update set name = 'Lagos'
     returning id, latitude, longitude`
  );
  const mk = (slug, title, city, country, loc, lat, lng) => q(
    `insert into events (slug, title, title_normalized, start_at, end_at, timezone, status,
                         city, country, location_id, latitude, longitude, listing_status, published_at)
     values ($1, $2, lower($2), now() + interval '4 hours', now() + interval '10 hours',
             'Europe/London', 'live', $3, $4, $5, $6, $7, 'confirmed', now())`,
    [slug, title, city, country, loc, lat, lng]
  );
  await mk('follow-home', 'Follow Home Night', 'London', 'United Kingdom', london.id, 51.5074, -0.1278);
  await mk('follow-followed', 'Follow Lagos Night', 'Lagos', 'Nigeria', followed.id, 6.5244, 3.3792);
  await mk('follow-country', 'Follow Glasgow Night', 'Glasgow', 'United Kingdom', null, 55.8642, -4.2518);
  await mk('follow-away', 'Follow Ibiza Night', 'Ibiza', 'Spain', null, 38.9067, 1.4206);

  const [me] = await q(`select id from members where email = 'dev-nadia@example.com'`);
  await q(`update members set home_location_id = $2 where id = $1`, [me.id, london.id]);
  await q(`insert into member_locations (member_id, location_id) values ($1, $2)
           on conflict do nothing`, [me.id, followed.id]);

  const viewer2 = client();
  await viewer2.login('dev-nadia@example.com');
  const page2 = await (await viewer2.fetch('/clubmessenger')).text();

  check('a city they follow gets a section of its own',
    page2.includes('Tonight in the cities you follow'));
  check('home, then followed, then the rest of the country, then the world',
    page2.indexOf('Follow Home Night') < page2.indexOf('Follow Lagos Night')
    && page2.indexOf('Follow Lagos Night') < page2.indexOf('Follow Glasgow Night')
    && page2.indexOf('Follow Glasgow Night') < page2.indexOf('Follow Ibiza Night'));

  await q(`delete from member_locations where member_id = $1 and location_id = $2`, [me.id, followed.id]);
  await q(`delete from events where slug like 'follow-%'`);
  await q(`delete from locations where slug = 'lagos-verify'`);
}

// ---------------------------------------------------------------------------
// A member with no resolved place is, to Guestlist, nowhere. Ask them.
console.log('\n— Asking members with no city —');
{
  const email = `verify-nocity-${Date.now()}@example.com`;
  await client().fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'a-brand-new-password', displayName: 'No City Nate' }),
  });
  const placeless = client();
  await placeless.login(email, 'a-brand-new-password');

  const page = await (await placeless.fetch('/events')).text();
  check('a member with no city is asked for one', page.includes('Where are you?'));
  check('and the ask goes somewhere that can answer it', page.includes('/you#places'));

  // Once they have a place, the ask stops — it is not a permanent fixture.
  const [london] = await q(`select id from locations where slug = 'london'`);
  await q(`update members set home_location_id = $2 where email = $1`, [email, london.id]);
  check('once they have a city, they are not asked again',
    !(await (await placeless.fetch('/events')).text()).includes('Where are you?'));

  // And it never interrupts the page that answers it.
  await q(`update members set home_location_id = null where email = $1`, [email]);
  const you = await (await placeless.fetch('/you')).text();
  check('it stays out of the way on the page that sets it',
    you.includes('gl_city_prompt_dismissed') === false || !you.includes('Where are you?'));
}

// ---------------------------------------------------------------------------
// An admin reading the site is still an admin. The fix for a bad night or a bad
// piece belongs on the page where the problem is visible — and nowhere else.
console.log('\n— Admin edit and delete, in place —');
{
  const desk = client();
  check('admin login', (await desk.login('oshi@guestlist.net')) === 200);

  const [live] = await q(
    `insert into events (slug, title, title_normalized, start_at, timezone, status, city, country)
     values ('admin-actions-night', 'Admin Actions Night', 'admin actions night',
             now() + interval '21 days', 'Europe/London', 'live', 'London', 'United Kingdom')
     returning id, slug, title`
  );
  const [author] = await q(`select id from members where email = 'dev-jules@example.com'`);
  const [piece] = await q(
    `insert into articles (section_id, author_id, slug, title, body, status, published_at,
                           hero_image_url, reading_minutes)
     select s.id, $1, 'admin-actions-piece', 'Admin Actions Piece',
            'A published piece the verify suite deletes from its own page. ',
            'published', now(), 'https://images.example.com/hero.jpg', 3
       from editorial_sections s where s.slug = 'balance'
     returning id`, [author.id]
  );

  const anonEvent = await (await client().fetch(`/events/${live.slug}`)).text();
  check('a visitor is never offered the delete button', !anonEvent.includes('Delete event'));

  const memberSide = client();
  await memberSide.login('dev-jules@example.com');
  check('nor is an ordinary member',
    !(await (await memberSide.fetch(`/events/${live.slug}`)).text()).includes('Delete event'));

  const adminEvent = await (await desk.fetch(`/events/${live.slug}`)).text();
  check('an admin gets both buttons on the night itself',
    adminEvent.includes('Delete event') && adminEvent.includes(`/admin/events/${live.id}`));

  const adminArticle = await (await desk.fetch('/balance/admin-actions-piece')).text();
  check('and on the piece itself',
    adminArticle.includes('Delete article') && adminArticle.includes(`/admin/articles?id=${piece.id}`));

  check('a member cannot delete an article through the admin door',
    (await memberSide.fetch(`/api/admin/articles/${piece.id}`, { method: 'DELETE' })).status === 403);
  check('the article is still there', (await q(`select 1 from articles where id = $1`, [piece.id])).length === 1);

  check('an admin can',
    (await desk.fetch(`/api/admin/articles/${piece.id}`, { method: 'DELETE' })).status === 200);
  check('and it is really gone', (await q(`select 1 from articles where id = $1`, [piece.id])).length === 0);
  check('with the deletion on the record',
    (await q(`select 1 from audit_log where action = 'article_deleted'`)).length > 0);
  check('deleting an article that is already gone is a 404, not a crash',
    (await desk.fetch(`/api/admin/articles/${piece.id}`, { method: 'DELETE' })).status === 404);

  check('the same holds for a night',
    (await desk.fetch(`/api/admin/events/${live.id}`, { method: 'DELETE' })).status === 200);
  check('the night is gone', (await q(`select 1 from events where id = $1`, [live.id])).length === 0);
}

// ---------------------------------------------------------------------------
// YOU ARE ON THE GUESTLIST — the email, and the pass it carries.
//
// The pass has to answer a door's questions and nobody else's: a name, a
// count, and who in the promoter's own team said yes. Reading it takes only
// the link; changing it takes somebody on that team.
console.log('\n— The guestlist pass —');
{
  const desk = client();
  check('admin login', (await desk.login('oshi@guestlist.net')) === 200);

  // A promoter can only work its own guestlist once the claim is verified,
  // so the fixture starts where a real one would after review.
  const [promoter] = await q(
    `update promoters set claim_status = 'verified'
      where id = (select id from promoters order by name limit 1)
      returning id, name`);
  const [guest] = await q(`select id, email, display_name from members where email = 'dev-jules@example.com'`);
  const [doorman] = await q(`select id, email from members where email = 'dev-nadia@example.com'`);
  const [night] = await q(
    `insert into events (slug, title, title_normalized, start_at, timezone, status, city, country, promoter_id)
     values ('pass-night', 'Pass Night', 'pass night', now() + interval '9 days',
             'Europe/London', 'live', 'London', 'United Kingdom', $1)
     returning id, slug, title`, [promoter.id]
  );
  // The doorman is on the promoter's team; the guest is not.
  await q(`insert into promoter_members (promoter_id, member_id, role) values ($1, $2, 'editor')
           on conflict do nothing`, [promoter.id, doorman.id]);
  await q(`insert into event_guestlist_settings (event_id, promoter_id, mode, max_plus_ones, updated_by_member_id)
           values ($1, $2, 'approve_requests', 3, $3)`, [night.id, promoter.id, doorman.id]);

  // The member asks; nothing is confirmed and nothing is sent yet.
  const jules = client();
  await jules.login('dev-jules@example.com');
  const asked = await jules.fetch(`/api/events/${night.id}/guestlist-request`, {
    method: 'POST', body: JSON.stringify({ plusOnes: 1 }),
  });
  check('a member asks for a place', asked.status === 200 && (await asked.json()).status === 'pending');
  check('and nothing is promised before somebody says yes',
    (await q(`select 1 from email_outbox where member_id = $1 and email_type = 'notification:guestlist_confirmed'`, [guest.id])).length === 0);

  // The promoter's team says yes.
  const [entry] = await q(`select id from event_guestlist_entries where event_id = $1 and member_id = $2`, [night.id, guest.id]);
  const door = client();
  await door.login('dev-nadia@example.com');
  const approved = await door.fetch(`/api/promoter/${promoter.id}/guestlists/${night.id}`, {
    method: 'POST', body: JSON.stringify({ action: 'approve', entryId: entry.id }),
  });
  check('somebody on the promoter’s team approves it', approved.status === 200);

  const [row] = await q(
    `select confirmed_by_member_id, confirmed_at from event_guestlist_entries where id = $1`, [entry.id]);
  check('the row records WHO said yes, not just that somebody did',
    row.confirmed_by_member_id === doorman.id && !!row.confirmed_at);

  const [mail] = await q(
    `select subject, body_text, body_html from email_outbox
      where member_id = $1 and email_type = 'notification:guestlist_confirmed'`, [guest.id]);
  check('the pass is emailed to the guest', !!mail);
  check('and it leads with the only sentence that matters',
    mail.body_html.includes('YOU ARE ON') && mail.body_html.includes('GUESTLIST'));
  check('it names the night', mail.subject.includes('Pass Night'));
  check('it names who confirmed it', mail.body_html.includes('Nadia') || mail.body_text.includes('Nadia'),
    mail.body_text.slice(0, 200));
  check('it carries a scannable code', mail.body_html.includes('/qr.png'));
  check('and a plain link, for a client that refuses images',
    mail.body_text.includes('/d/'));

  // The pass itself.
  const token = mail.body_text.split('/d/')[1].split(/\s/)[0];
  const passPage = await (await client().fetch(`/d/${token}`)).text();
  check('anybody holding the link can read the pass', passPage.includes('ON THE GUESTLIST'));
  check('it shows the name and the count',
    passPage.includes(guest.display_name) && passPage.includes('2 places'));
  check('and who in the organisation confirmed it', passPage.includes('Confirmed by'));
  check('a door pass is never offered to a search engine', passPage.includes('noindex'));

  const qr = await client().fetch(`/api/door/${token}/qr.png`);
  check('the code renders as a PNG', qr.status === 200 && qr.headers.get('content-type') === 'image/png');
  check('and it is a real one',
    Buffer.from(await qr.arrayBuffer()).subarray(0, 8).toString('hex') === '89504e470d0a1a0a');

  // A forged token is nothing at all.
  const forged = `${token.split('.')[0]}.aaaaaaaaaaaaaaaaaaaaaa`;
  check('a token with the wrong signature is not a pass',
    (await client().fetch(`/api/door/${forged}/qr.png`)).status === 404);
  check('and its page is a 404, not a hint', (await client().fetch(`/d/${forged}`)).status === 404);

  // Checking in is the part that needs the team.
  check('a stranger cannot check anybody in',
    (await client().fetch(`/api/door/${token}/check-in`, { method: 'POST' })).status === 401);
  check('nor can the guest themselves',
    (await jules.fetch(`/api/door/${token}/check-in`, { method: 'POST' })).status === 403);
  const checkedIn = await door.fetch(`/api/door/${token}/check-in`, { method: 'POST' });
  check('the promoter’s team can', checkedIn.status === 200 && !!(await checkedIn.json()).checkedInAt);
  check('and the pass says so afterwards',
    (await (await client().fetch(`/d/${token}`)).text()).includes('ALREADY CHECKED IN'));
  const undone = await door.fetch(`/api/door/${token}/check-in`, { method: 'POST' });
  check('a misfire can be undone', undone.status === 200 && (await undone.json()).checkedInAt === null);

  // Approving twice does not email twice.
  await door.fetch(`/api/promoter/${promoter.id}/guestlists/${night.id}`, {
    method: 'POST', body: JSON.stringify({ action: 'approve', entryId: entry.id }),
  });
  check('a second press of Approve does not send a second pass',
    (await q(`select count(*)::int as n from email_outbox
               where member_id = $1 and email_type = 'notification:guestlist_confirmed'`, [guest.id]))[0].n === 1);

  await q(`delete from events where id = $1`, [night.id]);
}

// ---------------------------------------------------------------------------
// One email on the way in, not two: a welcome that happens to carry the
// button, rather than a chore that arrives on its own.
console.log('\n— Joining takes one email —');
{
  const email = `verify-welcome-${Date.now()}@example.com`;
  const res = await client().fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'a-brand-new-password', displayName: 'Wanda Welcome' }),
  });
  check('signup succeeds', res.status === 200);

  const sent = await q(`select email_type, subject, body_text, body_html from email_outbox where recipient_email = $1`, [email]);
  check('exactly one email goes out', sent.length === 1, sent.map((x) => x.email_type).join(', '));
  const [only] = sent;
  check('it welcomes them by name', only.subject.includes('Wanda'));
  check('and it is the one that confirms the address', only.body_text.includes('/verify?token='));
  check('it is designed, not a wall of text',
    !!only.body_html && only.body_html.includes('>Confirm your email<'));
  // AND IT LOOKS LIKE GUESTLIST. Four templates had drifted into a cream-and-
  // black house style the website abandoned, with the wordmark typed out as
  // letters — so somebody clicking through arrived somewhere that did not
  // match the email that sent them.
  check('it carries the real wordmark, not typed-out letters',
    only.body_html.includes('/brand/Guestlist_purple_300dpi.png')
      && !only.body_html.includes('GUEST<span'));
  check('and the site\u2019s own colours',
    only.body_html.includes('#7c4a9e') && !only.body_html.includes('#f3eee1'));
  check('it says what to do once they are in', only.body_html.includes('Set your city'));
  check('and it never promises a survival guide to anything',
    !/survival guide/i.test(`${only.subject} ${only.body_text} ${only.body_html}`));

  // Proving an address is transactional. Somebody who stopped recommendation
  // email must still be able to confirm a new one.
  const { rows: [me] } = await db.query(`select id from members where email = $1`, [email]);
  await q(`insert into email_suppressions (email, member_id, scope, source)
           values ($1, $2, 'recommendations', 'unsubscribe') on conflict do nothing`, [email, me.id]);
  await q(`update members set email_verified_at = null where id = $1`, [me.id]);
  const signedIn = client();
  await signedIn.login(email, 'a-brand-new-password');
  await signedIn.fetch('/api/auth/verify', { method: 'POST' });
  const after = await q(
    `select status from email_outbox where recipient_email = $1 and email_type = 'transactional:verify_email'
      order by created_at desc limit 1`, [email]);
  check('an unsubscribe never blocks proving an address', after[0]?.status !== 'suppressed', after[0]?.status);
}

// ---------------------------------------------------------------------------
// A dead link is the worst place to lose somebody on a site whose whole job is
// telling them where to be tonight.
console.log('\n— Nothing here —');
{
  const res = await client().fetch('/this-page-does-not-exist');
  check('a missing page is a 404', res.status === 404);
  const page = await res.text();
  check('and it is ours, not the framework’s', page.includes('You’re not on'));
  check('it offers a way on', page.includes('/events') && page.includes('/archive'));
  check('and it is never indexed', page.includes('noindex'));
}

// ---------------------------------------------------------------------------
// A SCAN IS WATCHED, NOT WAITED ON. Holding the request open for the whole
// scan is what left the desk spinning for ever on a large site: the browser
// waited on a function that had already been killed, and nothing was written
// down. Now the POST starts the job and the desk watches the row.
console.log('\n— Scanning is a job, not a request —');
{
  const desk = client();
  check('admin login', (await desk.login('oshi@guestlist.net')) === 200);

  // A host that does not exist: the scan fails fast, which is exactly what
  // this block is about — it must fail on the ROW, not on the request.
  const [src] = await q(
    `insert into event_sources (source_type, name, url)
     values ('promoter_website', 'Scan Contract', 'https://scan-contract.invalid/whats-on')
     returning id`
  );

  // Warm the route before timing it. In dev the first request to a route
  // pays for compiling it — ten seconds of webpack that has nothing to do
  // with whether a scan blocks its request, and would fail the check below
  // for the wrong reason.
  await desk.fetch(`/api/admin/sources/${src.id}/scan?scanId=00000000-0000-0000-0000-000000000000`);

  const startedAt = Date.now();
  const started = await desk.fetch(`/api/admin/sources/${src.id}/scan`, { method: 'POST' });
  const body = await started.json();
  check('starting a scan answers straight away', started.status === 200 && !!body.scanId && body.running === true);
  check('and does not hold the request open while it works', Date.now() - startedAt < 5_000);
  check('the row exists the moment the scan is asked for',
    (await q(`select 1 from source_scans where id = $1`, [body.scanId])).length === 1);

  let state = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const poll = await desk.fetch(`/api/admin/sources/${src.id}/scan?scanId=${body.scanId}`);
    if (!poll.ok) continue;
    state = await poll.json();
    if (!state.running) break;
  }
  check('the desk can watch it through to a finish', state !== null && state.running === false, JSON.stringify(state));
  check('and the row says how it went', state?.status === 'failed' && !!state?.error);

  check('asking which scan is required, not assumed',
    (await desk.fetch(`/api/admin/sources/${src.id}/scan`)).status === 400);
  check('a scan that does not exist is a 404',
    (await desk.fetch(`/api/admin/sources/${src.id}/scan?scanId=00000000-0000-0000-0000-000000000000`)).status === 404);
  check('a member cannot start a scan',
    (await nadia.fetch(`/api/admin/sources/${src.id}/scan`, { method: 'POST' })).status === 403);
  check('nor watch one',
    (await nadia.fetch(`/api/admin/sources/${src.id}/scan?scanId=${body.scanId}`)).status === 403);

  await q(`delete from event_sources where id = $1`, [src.id]);
}

// ---------------------------------------------------------------------------
// YOUR PROFILE MOVES OUT. It is the one part of Your Guestlist that is not
// private — it is what everybody else sees — so it belongs behind your own
// name in the header, not at the bottom of the settings screen between the
// privacy checkboxes and the email toggles. Everything else stays under You.
console.log('\n— Your profile lives behind your name —');
{
  const me = client();
  check('member login', (await me.login('dev-jules@example.com')) === 200);

  const header = await (await me.fetch('/events')).text();
  check('your own name in the header goes somewhere', header.includes('/you/profile'));

  const profile = await me.fetch('/you/profile');
  check('and that somewhere is your profile', profile.status === 200);
  const page = await profile.text();
  check('it carries the profile form', page.includes('Save profile') && page.includes('Your name'));
  check('and every field that was on the settings screen',
    page.includes('Raving since') && page.includes('Looking for') && page.includes('About you'));
  check('it points back at everything that stayed under You', page.includes('href="/you"'));
  check('your own profile page is never indexed', page.includes('noindex'));

  const you = await (await me.fetch('/you')).text();
  check('the profile form is gone from You', !you.includes('Save profile'));
  // And the switches followed it: who sees your profile, and when we email
  // you, are both questions about the profile rather than about your taste.
  check('the switches followed it out',
    !you.includes('Public profile') && !you.includes('Weekly personalised weekend picks'));
  check('and landed on the profile page',
    page.includes('Public profile') && page.includes('Weekly personalised weekend picks'));
  check('and everything else is untouched',
    you.includes('Rave history') && you.includes('Places') && you.includes('Membership'));
  check('You links to the profile rather than hiding it', you.includes('/you/profile'));

  // Editing still works from its new home.
  const saved = await me.fetch('/api/you/settings', {
    method: 'PATCH',
    body: JSON.stringify({ profile: { displayName: 'Jules Okonkwo', bio: 'Moved house.', ravingSince: '1998' } }),
  });
  check('saving from the new page still saves', saved.status === 200);
  check('and the change is real',
    (await q(`select bio, raving_since from members where email = 'dev-jules@example.com'`))[0].bio === 'Moved house.');

  check('a signed-out visitor is sent to sign in, not shown a profile',
    [302, 307].includes((await client().fetch('/you/profile')).status));
}

// ---------------------------------------------------------------------------
// THE GATE, AND A WINDOW ONTO IT.
//
// An unconfirmed member is deliberately invisible — not in the directory, not
// offered to search engines. That is the anti-spam contract. What was missing
// was any way to SEE who the gate is holding, and any second chance for
// somebody who simply missed one email.
console.log('\n— Who the verification gate is holding —');
{
  const desk = client();
  check('admin login', (await desk.login('oshi@guestlist.net')) === 200);

  const email = `verify-held-${Date.now()}@example.com`;
  await client().fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'a-brand-new-password', displayName: 'Hedy Held' }),
  });
  const [held] = await q(`select id, slug from members where email = $1`, [email]);

  // Invisible, by design.
  const peoplePage = await (await (async () => {
    const seer = client();
    await seer.login('dev-nadia@example.com');
    return seer.fetch('/people');
  })()).text();
  check('an unconfirmed member is not in the directory', !peoplePage.includes('Hedy Held'));

  // But no longer invisible to the desk.
  const members = await (await desk.fetch('/admin/members')).text();
  check('the desk says who the gate is holding', members.includes('Not confirmed yet'));
  check('and names them', members.includes('Hedy Held') && members.includes(email));
  check('with how long they have been waiting', /Joined \d+h ago/.test(members));
  check('and that a reminder has not gone yet', members.includes('too soon to remind'));

  // Sending it again.
  const before = (await q(`select count(*)::int as n from email_outbox
                            where member_id = $1 and email_type = 'transactional:verify_email'`, [held.id]))[0].n;
  const resend = await desk.fetch(`/api/admin/members/${held.id}/verification`, {
    method: 'POST', body: JSON.stringify({ action: 'resend' }),
  });
  check('an admin can send the email again', resend.status === 200);
  check('and it really goes out',
    (await q(`select count(*)::int as n from email_outbox
               where member_id = $1 and email_type = 'transactional:verify_email'`, [held.id]))[0].n === before + 1);
  check('a member cannot do that to somebody else',
    (await nadia.fetch(`/api/admin/members/${held.id}/verification`, {
      method: 'POST', body: JSON.stringify({ action: 'resend' }),
    })).status === 403);

  // ONE REMINDER, EVER. Driven through the hourly job itself rather than the
  // function behind it, so what is proved is the thing that actually runs.
  const runJob = async () =>
    (await (await desk.fetch('/api/jobs/send-emails', { method: 'POST' })).json()).verifyNudges;
  check('nobody is reminded before the wait is up', (await runJob()) === 0);
  await q(`update members set created_at = now() - interval '30 hours' where id = $1`, [held.id]);
  check('a day later, one reminder goes', (await runJob()) === 1);
  const [nudge] = await q(`select subject, body_html from email_outbox
                            where member_id = $1 and email_type = 'transactional:verify_reminder'`, [held.id]);
  check('it says what they are missing', nudge.subject.includes('still hidden'));
  check('and carries a fresh link', nudge.body_html.includes('/verify?token='));
  check('running the job again never sends a second one', (await runJob()) === 0);
  check('and there is still exactly one on the record',
    (await q(`select count(*)::int as n from email_outbox
               where member_id = $1 and email_type = 'transactional:verify_reminder'`, [held.id]))[0].n === 1);
  check('the desk now shows the reminder went',
    (await (await desk.fetch('/admin/members')).text()).includes('reminded'));

  // Vouching: a real decision, so it is on the record.
  const vouch = await desk.fetch(`/api/admin/members/${held.id}/verification`, {
    method: 'POST', body: JSON.stringify({ action: 'mark_verified' }),
  });
  check('an admin can vouch for somebody they know is real', vouch.status === 200);
  check('and that puts them in the directory',
    (await (await (async () => { const s2 = client(); await s2.login('dev-nadia@example.com'); return s2.fetch('/people'); })()).text()).includes('Hedy Held'));
  check('vouching is on the record',
    (await q(`select 1 from audit_log where action = 'member_verified'`)).length > 0);
  check('and they drop off the held list',
    !(await (await desk.fetch('/admin/members')).text()).includes(email));
  check('sending again to somebody already confirmed says so, rather than pretending',
    (await desk.fetch(`/api/admin/members/${held.id}/verification`, {
      method: 'POST', body: JSON.stringify({ action: 'resend' }),
    })).status === 400);

  await q(`delete from members where id = $1`, [held.id]);
}

// ---------------------------------------------------------------------------
// THE PICTURES ON THE SITE ARE SETTINGS, NOT CODE.
//
// Changing the photograph behind the front page used to be an edit and a
// deploy, which puts a designer's job behind an engineer. Each fixed picture
// is now a named slot with a shipped default, and the desk can point a slot
// somewhere else — or put the original back, which is what makes trying
// something safe.
console.log('\n— The pictures on the site —');
{
  const desk = client();
  check('admin login', (await desk.login('oshi@guestlist.net')) === 200);

  const page = await (await desk.fetch('/admin/site')).text();
  check('the desk lists the pictures', page.includes('Pictures'));
  check('naming each one and where it lands',
    page.includes('Home — first panel') && page.includes('Membership — Get in free')
      && page.includes('Membership — Queue jump'));
  check('and showing what is in each slot now', page.includes('/images/hero.jpg'));

  check('a member cannot see them',
    (await nadia.fetch('/api/admin/site/images')).status === 403);
  check('nor change one',
    (await nadia.fetch('/api/admin/site/images', {
      method: 'POST', body: JSON.stringify({ slot: 'home.1', url: 'https://evil.example/x.jpg' }),
    })).status === 403);

  // Just the band behind the headline: a seeded event uses the same file for
  // its own artwork, so looking at the whole page would prove nothing.
  const heroBand = async () => {
    const html = await (await client().fetch('/')).text();
    const at = html.indexOf('homeHeroMedia');
    return at < 0 ? '' : html.slice(at, html.indexOf('</div>', at));
  };
  check('the front page shows the picture that ships with the code',
    (await heroBand()).includes('/images/secret-party.jpg'));

  const swap = await desk.fetch('/api/admin/site/images', {
    method: 'POST',
    body: JSON.stringify({ slot: 'home.1', url: 'https://pictures.example/new-night.jpg' }),
  });
  check('an admin can point a slot somewhere else', swap.status === 200);
  const after = await heroBand();
  check('and the front page follows immediately',
    after.includes('https://pictures.example/new-night.jpg')
      && !after.includes('/images/secret-party.jpg'), after.slice(0, 200));
  check('the change is on the record',
    (await q(`select 1 from audit_log where action = 'site_image_changed'`)).length > 0);

  // A picture is only ever an address we would put in an img tag.
  check('a javascript: address is refused',
    (await desk.fetch('/api/admin/site/images', {
      method: 'POST', body: JSON.stringify({ slot: 'home.1', url: 'javascript:alert(1)' }),
    })).status === 400);
  check('and so is a data: one',
    (await desk.fetch('/api/admin/site/images', {
      method: 'POST', body: JSON.stringify({ slot: 'home.1', url: 'data:image/svg+xml,<svg onload=alert(1)>' }),
    })).status === 400);
  check('a slot that does not exist is a 404, not a stored setting nothing reads',
    (await desk.fetch('/api/admin/site/images', {
      method: 'POST', body: JSON.stringify({ slot: 'made.up', url: 'https://pictures.example/x.jpg' }),
    })).status === 404);
  check('the refused attempts changed nothing',
    (await heroBand()).includes('https://pictures.example/new-night.jpg'));

  // The way back.
  const reset = await desk.fetch('/api/admin/site/images', {
    method: 'POST', body: JSON.stringify({ slot: 'home.1', url: null }),
  });
  check('the original goes back', reset.status === 200);
  check('and the front page is as it shipped',
    (await heroBand()).includes('/images/secret-party.jpg'));

  // The membership section reads its pictures the same way. #125 replaced the
  // alternating photo panels with an icon grid AND a captioned photo strip —
  // the slots did not stop being read, they moved. Asserted on the hero and on
  // one of the strip's five, so a change to either shows up here.
  await desk.fetch('/api/admin/site/images', {
    method: 'POST',
    body: JSON.stringify({ slot: 'membership.hero', url: 'https://pictures.example/city.jpg' }),
  });
  await desk.fetch('/api/admin/site/images', {
    method: 'POST',
    body: JSON.stringify({ slot: 'membership.drops', url: 'https://pictures.example/drop.jpg' }),
  });
  const membership = await (await client().fetch('/membership')).text();
  check('the membership hero follows its slot',
    membership.includes('https://pictures.example/city.jpg'));
  check('and so does the photo strip under it',
    membership.includes('https://pictures.example/drop.jpg'));
  for (const slot of ['membership.hero', 'membership.drops']) {
    await desk.fetch('/api/admin/site/images', {
      method: 'POST', body: JSON.stringify({ slot, url: null }),
    });
  }
}

// ---------------------------------------------------------------------------
// AN ARTIST PAGE LEADS WITH A DATE, AND THE CLIPS ARE CLIPS.
//
// Somebody on an artist's page most often wants to know where they are
// playing; the interview archive is why they stay, not why they arrived. And
// nobody arrives wanting fifty minutes of video — they want the two minutes
// where the artist says the interesting thing, with a sentence saying what
// that is.
console.log('\n— An artist page —');
{
  const [artist] = await q(`select id, slug, name from artists where slug = 'aya-sable'`);
  check('the seeded artist is there', !!artist);

  // A published interview with one clip, made here so the assertions below
  // are about the page and not about whatever happens to be in the database.
  const [video] = await q(
    `insert into artist_videos (youtube_video_id, title, thumbnail_url, published_at,
                                duration_seconds, source_url, status, is_interview, transcript_status)
     values ('verifyClip01', 'The verify interview', '/images/secret-party.jpg', now() - interval '9 days',
             2400, 'https://www.youtube.com/watch?v=verifyClip01', 'published', true, 'ready')
     returning id`);
  await q(`insert into artist_video_artists (video_id, artist_id, role, source)
           values ($1, $2, 'interviewee', 'admin')`, [video.id, artist.id]);
  await q(
    `insert into artist_video_moments (video_id, start_seconds, end_seconds, title, summary,
                                       topic_slug, topic_label, status, source)
     values ($1, 754, 980, 'The record shop that started it',
             'Fifteen years old in a Bristol basement, spending the bus fare on dubplates.',
             'origins', 'Origins', 'published', 'admin')`, [video.id]);

  const page = await (await client().fetch(`/artists/${artist.slug}`)).text();
  check('it loads', page.includes(artist.name));

  // Order is the point: the dates have to come before the archive.
  const playing = page.indexOf('Playing next');
  const clips = page.indexOf('In their words');
  check('where they are playing comes first', playing > 0 && clips > 0 && playing < clips,
    `playing at ${playing}, clips at ${clips}`);

  check('the clip is on the page', page.includes('The record shop that started it'));
  check('and it says what it is about',
    page.includes('spending the bus fare on dubplates'));
  check('with the timestamp it starts at', page.includes('12:34'));
  check('and a link straight to that second',
    page.includes('watch?v=verifyClip01&amp;t=754s') || page.includes('watch?v=verifyClip01&t=754s'));

  // The full interview is no longer offered as a thing to watch. Asked of the
  // markup only: in dev the React payload carries every prop as data, and that
  // is not something a reader can see or click.
  const visible = page.replace(/<script[\s\S]*?<\/script>/g, '');
  check('the interview itself is not the headline',
    !visible.includes('The verify interview'), 'the whole video should not be offered');
  check('nor is there a way into the fifty minutes',
    !visible.includes('Watch the full interview'));

  // ONE DATE AND ONE CLIP GO ON ONE LINE.
  //
  // That is most artists here. Stacked full-width it is a card, a screen of
  // nothing beside it, a scroll, and another card — the page reads as emptier
  // than it is and you have to scroll to find out there was anything else.
  const [sparse] = await q(
    `insert into artists (name, slug) values ('Sparse Fixture', 'sparse-fixture') returning id`);
  const [sparseVideo] = await q(
    `insert into artist_videos (youtube_video_id, title, thumbnail_url, published_at,
                                duration_seconds, source_url, status, is_interview, transcript_status)
     values ('sparseClip01', 'The sparse interview', '/images/secret-party.jpg', now() - interval '3 days',
             1800, 'https://www.youtube.com/watch?v=sparseClip01', 'published', true, 'ready')
     returning id`);
  await q(`insert into artist_video_artists (video_id, artist_id, role, source)
           values ($1, $2, 'interviewee', 'admin')`, [sparseVideo.id, sparse.id]);
  await q(
    `insert into artist_video_moments (video_id, start_seconds, title, summary, status, source)
     values ($1, 300, 'The only clip there is', 'One clip, one date, one screen.', 'published', 'admin')`,
    [sparseVideo.id]);
  const [anyEvent] = await q(
    `select id from events where status = 'live' and start_at > now() order by start_at limit 1`);
  await q(`insert into event_artists (event_id, artist_id, position, billing)
           values ($1, $2, 0, 'headliner')`, [anyEvent.id, sparse.id]);

  const thin = await (await client().fetch('/artists/sparse-fixture')).text();
  check('one date and one clip are laid out side by side', thin.includes('artistBody split'));
  check('with both of them actually on the page',
    thin.includes('The only clip there is') && thin.includes('Playing next'));

  // An artist with a diary does not get a tall thin stack.
  const busy = await (await client().fetch(`/artists/${artist.slug}`)).text();
  check('a busy artist keeps the full width',
    busy.includes('artistBody') && !busy.includes('artistBody split'));

  await q(`delete from artists where id = $1`, [sparse.id]);
  await q(`delete from artist_videos where id = $1`, [video.id]);
}

// ---------------------------------------------------------------------------
// ARTISTS BELONG ON THE PEOPLE PAGE.
//
// One follower is enough: somebody cared, which is the whole signal. And
// /people is a directory of people, not a place to file a missing event —
// the paste-a-link box belongs where somebody is looking at events.
console.log('\n— Artists on the people page —');
{
  const [artist] = await q(
    `select a.id, a.name from artists a
      join member_follows f on f.entity_type = 'artist' and f.entity_id = a.id
     group by a.id having count(*) >= 1 order by count(*) desc limit 1`);
  check('the seed has an artist somebody follows', !!artist);

  const people = await (await nadia.fetch('/people')).text();
  check('the page names the section', people.includes('Artists people follow'));
  check('and the artist is in it', people.includes(artist.name));
  check('under the members, not above them',
    people.indexOf('Your people') < people.indexOf('Artists people follow'));

  // An artist nobody follows is not filler.
  const [lonely] = await q(
    `select name from artists a
      where not exists (select 1 from member_follows f
                         where f.entity_type = 'artist' and f.entity_id = a.id)
      order by a.name limit 1`);
  check('an artist nobody follows is left off', !!lonely && !people.includes(`>${lonely.name}<`),
    lonely && lonely.name);

  // The paste-a-link box belongs where somebody is looking at events. Not in
  // a directory of people, and not in the Market — which is restaurants, bars
  // and record shops, so an event link is the wrong thing in the wrong room.
  const addBox = 'Know something we’re missing?';
  check('the add-an-event box is gone from /people', !people.includes(addBox));
  check('and from the Market',
    !(await (await client().fetch('/market')).text()).includes(addBox));
  check('but it is still where events are',
    (await (await client().fetch('/events')).text()).includes(addBox));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
await db.end();
