// V2B end-to-end verification: promoter network, claiming, teams,
// self-serve events, source connection, analytics, permissions — including
// the full §43 loop (claim → approve → connect → scan → confirm → member
// engages → analytics reflect it).
//
// Requires: db reset+seed, dev server on :3000 with
// SUPPLY_FETCH_ALLOW_HOSTS=127.0.0.1 (dev/test only).

import { createServer } from 'node:http';
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
    async signup(email, displayName) {
      return (await this.fetch('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'password123', displayName, homeCity: 'London' }),
      })).status;
    },
  };
}

const anon = client();
const admin = client();
const alex = client();   // will own Night Bureau
const bob = client();    // rejected claimant
const casper = client(); // invited editor → admin
const anna = client();   // invited analyst
const fan = client();    // member engaging with events

// Fixture promoter website on 127.0.0.1 for source connection tests.
const FIXTURE_PORT = 4591;
const FIX = `http://127.0.0.1:${FIXTURE_PORT}`;
const futureDate = new Date(Date.now() + 25 * 86400_000).toISOString().slice(0, 10);
const eventPage = (slug, title) => `<!doctype html><html><head><title>${title}</title>
<link rel="canonical" href="${FIX}/events/${slug}">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'MusicEvent', name: title,
  startDate: `${futureDate}T22:00:00+01:00`, endDate: `${futureDate}T23:45:00+01:00`,
  image: `${FIX}/art/${slug}.jpg`,
  location: { '@type': 'Place', name: 'Bureau Basement', address: { '@type': 'PostalAddress', addressLocality: 'Glasgow', addressCountry: 'United Kingdom' } },
  offers: { '@type': 'Offer', url: `https://tickets.example/${slug}`, price: '14', priceCurrency: 'GBP' },
})}</script></head><body><main>${title}</main></body></html>`;
const fixtures = createServer((req, res) => {
  const url = req.url ?? '';
  if (url === '/events' || url === '/events/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body><main>
      <a href="/events/bureau-allnighter">Bureau Allnighter — ${futureDate}</a>
      <a href="/events/bureau-daytime">Bureau Daytime — ${futureDate}</a>
    </main></body></html>`);
  } else if (url.startsWith('/events/')) {
    const slug = url.split('/').pop();
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(eventPage(slug, slug === 'bureau-allnighter' ? 'Bureau Allnighter' : 'Bureau Daytime'));
  } else {
    res.writeHead(404).end();
  }
});
await new Promise((r) => fixtures.listen(FIXTURE_PORT, '127.0.0.1', r));

const promoterId = async (slug) => (await q(`select id from promoters where slug = $1`, [slug]))[0].id;

try {
  // -------------------------------------------------------------------------
  console.log('\n— Public promoter / venue / artist pages —');
  {
    const dir = await anon.fetch('/promoters');
    const dirHtml = await dir.text();
    check('promoter directory renders', dir.status === 200 && dirHtml.includes('Golden Hour'));

    const prom = await anon.fetch('/promoters/golden-hour');
    const promHtml = await prom.text();
    check('promoter profile renders', prom.status === 200 && promHtml.includes('Golden Hour'));
    check('profile shows upcoming events + counts', promHtml.includes('Rooftop Day Party') && promHtml.includes('follower'));
    check('unclaimed profile shows claim CTA', promHtml.includes('Claim this profile'));

    const venue = await anon.fetch('/venues/paradise-wharf');
    const venueHtml = await venue.text();
    check('venue profile renders with events + map', venue.status === 200 && venueHtml.includes('Paradise Wharf') && venueHtml.includes('openstreetmap'));

    const artist = await anon.fetch('/artists/marcy-vale');
    check('artist page renders', artist.status === 200 && (await artist.text()).includes('Marcy Vale'));

    check('missing promoter 404s', (await anon.fetch('/promoters/does-not-exist')).status === 404);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Anonymous / unauthorized access —');
  {
    const nb = await promoterId('night-bureau');
    const dash = await anon.fetch('/promoter');
    check('anonymous dashboard redirects to login', dash.status >= 300 && dash.status < 400);
    check('anonymous cannot use promoter APIs',
      (await anon.fetch(`/api/promoter/${nb}/events`, { method: 'POST', body: '{}' })).status === 401);
    check('anonymous cannot follow',
      (await anon.fetch('/api/follow', { method: 'POST', body: JSON.stringify({ entityType: 'promoter', entityId: nb }) })).status === 401);
    check('anonymous cannot claim',
      (await anon.fetch(`/api/promoters/${nb}/claim`, { method: 'POST', body: '{}' })).status === 401);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Claim flow: submit → admin approve —');
  const nb = await promoterId('night-bureau');
  {
    check('alex signs up', (await alex.signup(`alex-${Date.now()}@example.com`, 'Alex Bureau')) === 200);
    const res = await alex.fetch(`/api/promoters/${nb}/claim`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Alex Bureau', role: 'Founder', email: 'alex@example.com',
        website: 'https://example.com/promoters/night-bureau', notes: 'I run this.',
      }),
    });
    check('claim submitted', res.status === 201);
    const p = (await q(`select claim_status from promoters where id = $1`, [nb]))[0];
    check('promoter marked claim_pending', p.claim_status === 'claim_pending');
    check('duplicate open claim rejected',
      (await alex.fetch(`/api/promoters/${nb}/claim`, { method: 'POST', body: JSON.stringify({ name: 'Alex', email: 'alex@example.com' }) })).status === 409);
    check('claim audit recorded',
      (await q(`select 1 from audit_log where action = 'claim_submitted' and promoter_id = $1`, [nb])).length === 1);

    check('admin login', (await admin.login('oshi@guestlist.net')) === 200);
    const claim = (await q(`select id, domain_match from promoter_claims where promoter_id = $1`, [nb]))[0];
    check('domain evidence computed', claim.domain_match === true);

    check('non-admin cannot decide claims', (await alex.fetch(`/api/admin/claims/${claim.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'approve' }),
    })).status === 403);

    const approve = await admin.fetch(`/api/admin/claims/${claim.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'approve' }),
    });
    check('admin approves claim', approve.status === 200);
    const after = (await q(`select claim_status, verified from promoters where id = $1`, [nb]))[0];
    check('promoter verified after approval', after.claim_status === 'verified' && after.verified === true);
    const membership = (await q(
      `select pm.role from promoter_members pm join members m on m.id = pm.member_id
        where pm.promoter_id = $1`, [nb]))[0];
    check('claimant becomes owner', membership?.role === 'owner');
  }

  // -------------------------------------------------------------------------
  console.log('\n— Claim rejection path —');
  {
    const steppers = await promoterId('steppers-union');
    check('bob signs up', (await bob.signup(`bob-${Date.now()}@example.com`, 'Bob Chancer')) === 200);
    await bob.fetch(`/api/promoters/${steppers}/claim`, {
      method: 'POST', body: JSON.stringify({ name: 'Bob', email: 'bob@gmail.com' }),
    });
    const claim = (await q(
      `select id, domain_match from promoter_claims where promoter_id = $1 order by created_at desc limit 1`,
      [steppers]))[0];
    check('gmail claim allowed but without domain evidence', claim.domain_match === false);
    await admin.fetch(`/api/admin/claims/${claim.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'reject', note: 'No evidence' }),
    });
    const after = (await q(`select claim_status from promoters where id = $1`, [steppers]))[0];
    check('rejected claim resets promoter to unclaimed', after.claim_status === 'unclaimed');
    check('rejected claimant has no team access',
      (await q(`select 1 from promoter_members where promoter_id = $1`, [steppers])).length === 0);
    check('rejected claimant cannot edit the promoter',
      (await bob.fetch(`/api/promoter/${steppers}/profile`, { method: 'PATCH', body: JSON.stringify({ description: 'mine now' }) })).status === 403);
    const bobDash = await bob.fetch('/promoter');
    check('rejected claimant sees no dashboard team', (await bobDash.text()).includes('not on a promoter team'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Verified promoter dashboard + own events —');
  let bureauEventId;
  {
    const dash = await alex.fetch('/promoter');
    check('verified owner sees dashboard', dash.status === 200 && (await dash.text()).includes('Night Bureau'));

    const create = await alex.fetch(`/api/promoter/${nb}/events`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Bureau Test Night',
        startAt: `${futureDate}T21:00`, endAt: `${futureDate}T23:30`,
        timezone: 'Europe/London', city: 'Glasgow', country: 'United Kingdom',
        eventType: 'club_night', genreSlugs: ['techno'],
        ticketUrl: 'https://tickets.example/bureau-test', lineup: ['Konrad Weiss'],
        priceFrom: 12, currency: 'GBP',
        primaryImageUrl: 'javascript:alert(1)', // must be stripped
      }),
    });
    const created = await create.json();
    check('verified promoter creates own event (publishes)', create.status === 201 && created.status === 'live');
    bureauEventId = created.id;
    const ev = (await q(`select promoter_id, primary_image_url, status from events where id = $1`, [bureauEventId]))[0];
    check('ownership forced server-side', ev.promoter_id === nb);
    check('unsafe image URL stripped', ev.primary_image_url === null);
    const pub = await anon.fetch(`/events/${created.slug}`);
    check('promoter event live in discovery', pub.status === 200);

    // Sanity validation still applies to trusted contributors.
    const dup = await alex.fetch(`/api/promoter/${nb}/events`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Bureau Test Night', startAt: `${futureDate}T21:00`, timezone: 'Europe/London',
        city: 'Glasgow', eventType: 'club_night',
      }),
    });
    const dupBody = await dup.json();
    check('duplicate promoter event held for review', dupBody.status === 'needs_review' && !!dupBody.possibleDuplicateOf);
    await q(`update events set status = 'rejected' where id = $1`, [dupBody.id]);
    check('invalid dates rejected', (await alex.fetch(`/api/promoter/${nb}/events`, {
      method: 'POST',
      body: JSON.stringify({ title: 'X', startAt: `${futureDate}T22:00`, endAt: `${futureDate}T20:00`, eventType: 'club_night' }),
    })).status === 400);

    // Cross-promoter protections.
    const foreign = (await q(`select id from events where slug = 'golden-hour-rooftop-day-party'`))[0];
    check('cannot edit an unrelated event (404)',
      (await alex.fetch(`/api/promoter/${nb}/events/${foreign.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'hacked' }) })).status === 404);
    const gh = await promoterId('golden-hour');
    check('cannot act as a promoter you are not on (403)',
      (await alex.fetch(`/api/promoter/${gh}/events`, { method: 'POST', body: JSON.stringify({ title: 'x', startAt: `${futureDate}T20:00`, eventType: 'other' }) })).status === 403);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Team: invites, roles, permission boundaries —');
  {
    check('casper signs up', (await casper.signup(`casper-${Date.now()}@example.com`, 'Casper Deck')) === 200);
    check('anna signs up', (await anna.signup(`anna-${Date.now()}@example.com`, 'Anna Numbers')) === 200);

    const inv1 = await (await alex.fetch(`/api/promoter/${nb}/team`, {
      method: 'POST', body: JSON.stringify({ email: 'casper@example.com', role: 'editor' }),
    })).json();
    check('owner invites editor', !!inv1.inviteUrl);
    const token1 = inv1.inviteUrl.split('/').pop();
    check('casper accepts invite',
      (await casper.fetch('/api/promoter/invite/accept', { method: 'POST', body: JSON.stringify({ token: token1 }) })).status === 200);
    check('invite token single-use',
      (await anna.fetch('/api/promoter/invite/accept', { method: 'POST', body: JSON.stringify({ token: token1 }) })).status === 409);
    check('bad token rejected',
      (await anna.fetch('/api/promoter/invite/accept', { method: 'POST', body: JSON.stringify({ token: 'a'.repeat(48) }) })).status === 404);

    const inv2 = await (await alex.fetch(`/api/promoter/${nb}/team`, {
      method: 'POST', body: JSON.stringify({ email: 'anna@example.com', role: 'analyst' }),
    })).json();
    await anna.fetch('/api/promoter/invite/accept', { method: 'POST', body: JSON.stringify({ token: inv2.inviteUrl.split('/').pop() }) });
    const roles = await q(`select role from promoter_members where promoter_id = $1 order by role`, [nb]);
    check('team has owner + editor + analyst', roles.length === 3);

    // Editor: events yes, admin things no.
    check('editor can edit own promoter event',
      (await casper.fetch(`/api/promoter/${nb}/events/${bureauEventId}`, { method: 'PATCH', body: JSON.stringify({ shortDescription: 'Edited by Casper' }) })).status === 200);
    check('editor cannot invite', (await casper.fetch(`/api/promoter/${nb}/team`, {
      method: 'POST', body: JSON.stringify({ email: 'x@example.com', role: 'editor' }),
    })).status === 403);
    check('editor cannot edit profile',
      (await casper.fetch(`/api/promoter/${nb}/profile`, { method: 'PATCH', body: JSON.stringify({ description: 'x' }) })).status === 403);

    // Analyst: read-only.
    check('analyst cannot edit events',
      (await anna.fetch(`/api/promoter/${nb}/events/${bureauEventId}`, { method: 'PATCH', body: JSON.stringify({ title: 'nope' }) })).status === 403);
    check('analyst cannot connect source',
      (await anna.fetch(`/api/promoter/${nb}/source`, { method: 'POST', body: JSON.stringify({ url: 'https://example.com/x' }) })).status === 403);
    const annaAnalytics = await anna.fetch('/promoter/analytics');
    check('analyst can view analytics', annaAnalytics.status === 200 && (await annaAnalytics.text()).includes('Ticket clicks'));

    // Role change + ownership protections.
    const casperId = (await q(`select member_id from promoter_members where promoter_id = $1 and role = 'editor'`, [nb]))[0].member_id;
    check('owner promotes editor to admin',
      (await alex.fetch(`/api/promoter/${nb}/team`, { method: 'PATCH', body: JSON.stringify({ memberId: casperId, role: 'admin' }) })).status === 200);
    const alexId = (await q(`select member_id from promoter_members where promoter_id = $1 and role = 'owner'`, [nb]))[0].member_id;
    check('admin cannot touch ownership',
      (await casper.fetch(`/api/promoter/${nb}/team`, { method: 'PATCH', body: JSON.stringify({ memberId: alexId, role: 'admin' }) })).status === 403);
    check('last owner cannot be demoted',
      (await alex.fetch(`/api/promoter/${nb}/team`, { method: 'PATCH', body: JSON.stringify({ memberId: alexId, role: 'admin' }) })).status === 409);
    check('role changes audited',
      (await q(`select 1 from audit_log where action = 'role_changed' and promoter_id = $1`, [nb])).length >= 1);
    check('members cannot self-serve another team',
      (await bob.fetch(`/api/promoter/${nb}/team`, { method: 'POST', body: JSON.stringify({ email: 'bob2@example.com', role: 'admin' }) })).status === 403);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Connect website → scan → confirm/ignore —');
  {
    check('unsafe source URL rejected',
      (await alex.fetch(`/api/promoter/${nb}/source`, { method: 'POST', body: JSON.stringify({ url: 'http://localhost/internal' }) })).status === 400);
    const connect = await alex.fetch(`/api/promoter/${nb}/source`, {
      method: 'POST', body: JSON.stringify({ url: `${FIX}/events` }),
    });
    const connected = await connect.json();
    check('owner connects website', connect.status === 201 && !!connected.sourceId);

    // Pinned to the row that was just created. Looking it up by promoter and
    // taking the first of an unordered result was testing whichever row the
    // database felt like returning — and the seed already ships one.
    const src = (await q(
      `select id, promoter_id, polling_enabled from event_sources where id = $1`,
      [connected.sourceId]))[0];
    check('the source is linked to the promoter', !!src && src.promoter_id === nb);
    // CONNECTING IS NOT SUBSCRIBING. Adding a site says "read this", not "read
    // this every day for ever" — a schedule nobody chose is a schedule nobody
    // is watching, so an admin turns polling on once the scans look right.
    // This check used to assert the opposite and had been red ever since.
    check('and connecting does not schedule polling by itself', src.polling_enabled === false);

    const scan = await (await alex.fetch(`/api/promoter/${nb}/source/scan`, { method: 'POST' })).json();
    check('first scan finds both events', scan.ok && scan.found === 2 && scan.newEvents === 2, JSON.stringify(scan));
    const extracted = await q(
      `select id, title, status, promoter_id from events where source_id = $1 order by title`, [src.id]
    );
    check('extracted events attributed to promoter',
      extracted.length === 2 && extracted.every((e) => e.promoter_id === nb));
    check('extracted events await review (no AI genres)', extracted.every((e) => ['new', 'needs_review'].includes(e.status)));

    const scan2 = await (await alex.fetch(`/api/promoter/${nb}/source/scan`, { method: 'POST' })).json();
    check('rescan skips already-seen URLs', scan2.ok && scan2.newEvents === 0);

    const queueHtml = await (await alex.fetch('/promoter/events')).text();
    check('import queue visible in dashboard', queueHtml.includes('New events found'));

    const [confirmMe, ignoreMe] = extracted;
    const confirm = await alex.fetch(`/api/promoter/${nb}/events/${confirmMe.id}/moderate`, {
      method: 'POST', body: JSON.stringify({ action: 'confirm' }),
    });
    check('promoter confirms extracted event', confirm.status === 200);
    const confirmed = (await q(`select status, slug from events where id = $1`, [confirmMe.id]))[0];
    check('confirmed event goes live', confirmed.status === 'live');
    check('confirmed event public', (await anon.fetch(`/events/${confirmed.slug}`)).status === 200);

    check('promoter ignores extracted event',
      (await alex.fetch(`/api/promoter/${nb}/events/${ignoreMe.id}/moderate`, { method: 'POST', body: JSON.stringify({ action: 'ignore' }) })).status === 200);
    check('ignored event rejected', (await q(`select status from events where id = $1`, [ignoreMe.id]))[0].status === 'rejected');

    check('pause sync', (await alex.fetch(`/api/promoter/${nb}/source`, { method: 'PATCH', body: JSON.stringify({ action: 'pause' }) })).status === 200);
    check('source paused in DB', (await q(`select active from event_sources where id = $1`, [src.id]))[0].active === false);
    check('resume sync', (await alex.fetch(`/api/promoter/${nb}/source`, { method: 'PATCH', body: JSON.stringify({ action: 'resume' }) })).status === 200);
    check('source lifecycle audited',
      (await q(`select count(*)::int as n from audit_log where promoter_id = $1 and action in ('source_connected','source_scanned','source_paused','source_resumed')`, [nb]))[0].n >= 4);
    check('scan notification stored',
      (await q(`select 1 from promoter_notifications where promoter_id = $1 and type = 'events_found'`, [nb])).length >= 1);

    // Source trust ≠ promoter verification: a verified promoter's source
    // starts at NEW, and only admin can change trust (audited).
    check('verified promoter source starts at trust NEW',
      (await q(`select trust from event_sources where id = $1`, [src.id]))[0].trust === 'new');
    check('promoter cannot change own trust level',
      (await alex.fetch(`/api/admin/sources/${src.id}`, { method: 'PATCH', body: JSON.stringify({ trust: 'trusted' }) })).status === 403);
    check('admin trust change works',
      (await admin.fetch(`/api/admin/sources/${src.id}`, { method: 'PATCH', body: JSON.stringify({ trust: 'restricted' }) })).status === 200);
    check('trust change audited',
      (await q(`select 1 from audit_log where action = 'source_trust_changed' and source_id = $1`, [src.id])).length === 1);
    await admin.fetch(`/api/admin/sources/${src.id}`, { method: 'PATCH', body: JSON.stringify({ trust: 'new' }) });
  }

  // -------------------------------------------------------------------------
  console.log('\n— Genre suggestions admin workflow —');
  {
    const someEvent = (await q(`select id from events where promoter_id = $1 limit 1`, [nb]))[0];
    await q(
      `insert into genre_suggestions (event_id, suggested_name, confidence)
       values ($1, 'moombahcore', 72), ($1, 'Moombahcore', 65), ($1, 'polka', 40), ($1, 'uk funky', 81)`,
      [someEvent.id]
    );
    check('non-admin blocked from genre suggestions',
      (await alex.fetch('/api/admin/genre-suggestions', { method: 'POST', body: JSON.stringify({ term: 'moombahcore', action: 'dismiss' }) })).status === 403);

    const page = await admin.fetch('/admin/genre-suggestions');
    check('suggestions page groups pending terms', page.status === 200 && (await page.text()).includes('moombahcore'));

    check('MAP applies existing genre to source events',
      (await admin.fetch('/api/admin/genre-suggestions', {
        method: 'POST', body: JSON.stringify({ term: 'moombahcore', action: 'map', genreSlug: 'bass' }),
      })).status === 200);
    check('mapped genre lands on the event',
      (await q(`select 1 from event_genres eg join genres g on g.id = eg.genre_id
                 where eg.event_id = $1 and g.slug = 'bass'`, [someEvent.id])).length === 1);
    check('both case variants resolved together',
      (await q(`select count(*)::int as n from genre_suggestions
                 where lower(suggested_name) = 'moombahcore' and status = 'mapped'`))[0].n === 2);

    check('DISMISS drops a term',
      (await admin.fetch('/api/admin/genre-suggestions', {
        method: 'POST', body: JSON.stringify({ term: 'polka', action: 'dismiss' }),
      })).status === 200 &&
      (await q(`select status from genre_suggestions where suggested_name = 'polka'`))[0].status === 'dismissed');

    const before = (await q(`select count(*)::int as n from genres`))[0].n;
    check('CREATE GENRE is an explicit admin decision',
      (await admin.fetch('/api/admin/genre-suggestions', {
        method: 'POST', body: JSON.stringify({ term: 'uk funky', action: 'create', name: 'UK Funky', parentSlug: 'house' }),
      })).status === 201);
    const created = (await q(`select g.slug, p.slug as parent from genres g join genres p on p.id = g.parent_genre_id where g.slug = 'uk-funky'`))[0];
    check('created genre is a House subgenre', created?.parent === 'house');
    check('exactly one genre added', (await q(`select count(*)::int as n from genres`))[0].n === before + 1);
    check('creating a duplicate slug is refused',
      (await q(`insert into genre_suggestions (event_id, suggested_name, confidence) values ($1, 'techno', 90)`, [someEvent.id]),
       await admin.fetch('/api/admin/genre-suggestions', {
         method: 'POST', body: JSON.stringify({ term: 'techno', action: 'create' }),
       })).status === 409);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Postpone lifecycle —');
  {
    const ev = (await q(
      `select id from events where promoter_id = $1 and status = 'live' and listing_status = 'confirmed' limit 1`,
      [nb]))[0];
    check('promoter postpones event',
      (await alex.fetch(`/api/promoter/${nb}/events/${ev.id}/moderate`, { method: 'POST', body: JSON.stringify({ action: 'postpone' }) })).status === 200 &&
      (await q(`select listing_status from events where id = $1`, [ev.id]))[0].listing_status === 'postponed');
    // Rescheduling a postponed event flips it to RESCHEDULED.
    const fd = new Date(Date.now() + 32 * 86400_000).toISOString().slice(0, 10);
    await alex.fetch(`/api/promoter/${nb}/events/${ev.id}`, {
      method: 'PATCH', body: JSON.stringify({ startAt: `${fd}T21:00`, endAt: null }),
    });
    check('postponed + new date → rescheduled',
      (await q(`select listing_status from events where id = $1`, [ev.id]))[0].listing_status === 'rescheduled');
    await alex.fetch(`/api/promoter/${nb}/events/${ev.id}/moderate`, { method: 'POST', body: JSON.stringify({ action: 'restore' }) });
  }

  // -------------------------------------------------------------------------
  console.log('\n— Event lifecycle: cancel / sold out / reschedule —');
  {
    const cancel = await alex.fetch(`/api/promoter/${nb}/events/${bureauEventId}/moderate`, {
      method: 'POST', body: JSON.stringify({ action: 'cancel' }),
    });
    check('promoter cancels own event', cancel.status === 200);
    const slug = (await q(`select slug from events where id = $1`, [bureauEventId]))[0].slug;
    const page = await anon.fetch(`/events/${slug}`);
    const html = await page.text();
    check('cancelled event still visible, clearly marked', page.status === 200 && html.includes('CANCELLED'));
    check('cancelled event loses GET TICKETS', !html.includes('Get Tickets'));
    const out = await anon.fetch(`/out/${bureauEventId}`);
    const outLoc = out.headers.get('location') ?? '';
    check('cancelled event stops forwarding ticket traffic',
      out.status >= 300 && out.status < 400 && outLoc.includes('/events') && !outLoc.includes('tickets.example'));
    check('cancelled event out of browse',
      !(await (await anon.fetch('/events?city=Glasgow')).text()).includes('Bureau Test Night'));
    check('cancellation audited',
      (await q(`select 1 from audit_log where action = 'event_cancelled' and event_id = $1`, [bureauEventId])).length === 1);

    await alex.fetch(`/api/promoter/${nb}/events/${bureauEventId}/moderate`, { method: 'POST', body: JSON.stringify({ action: 'restore' }) });
    check('restore works', (await q(`select listing_status from events where id = $1`, [bureauEventId]))[0].listing_status === 'confirmed');
    await alex.fetch(`/api/promoter/${nb}/events/${bureauEventId}/moderate`, { method: 'POST', body: JSON.stringify({ action: 'sold_out' }) });
    const soldHtml = await (await anon.fetch(`/events/${slug}`)).text();
    check('sold out marked, CTA disabled', soldHtml.toLowerCase().includes('sold out') && !soldHtml.includes('Get Tickets'));
    await alex.fetch(`/api/promoter/${nb}/events/${bureauEventId}/moderate`, { method: 'POST', body: JSON.stringify({ action: 'restore' }) });

    const resched = await alex.fetch(`/api/promoter/${nb}/events/${bureauEventId}`, {
      method: 'PATCH', body: JSON.stringify({ startAt: `${futureDate}T22:30`, endAt: null }),
    });
    check('reschedule accepted + audited', resched.status === 200 &&
      (await q(`select 1 from audit_log where action = 'event_rescheduled' and event_id = $1`, [bureauEventId])).length >= 1);
  }

  // -------------------------------------------------------------------------
  console.log("\n— Member loop: follow → going → tickets → promoter analytics —");
  {
    check('fan login', (await fan.login('dev-jules@example.com')) === 200);
    const follow = await (await fan.fetch('/api/follow', {
      method: 'POST', body: JSON.stringify({ entityType: 'promoter', entityId: nb }),
    })).json();
    check('fan follows promoter', follow.ok && follow.followers === 1);
    const unfollow = await (await fan.fetch('/api/follow', {
      method: 'POST', body: JSON.stringify({ entityType: 'promoter', entityId: nb, follow: false }),
    })).json();
    check('unfollow works', unfollow.followers === 0);
    await fan.fetch('/api/follow', { method: 'POST', body: JSON.stringify({ entityType: 'promoter', entityId: nb }) });
    const venueId = (await q(`select id from venues where slug = 'the-undercroft'`))[0].id;
    const artistId = (await q(`select id from artists where slug = 'konrad-weiss'`))[0].id;
    check('venue + artist follows work',
      (await fan.fetch('/api/follow', { method: 'POST', body: JSON.stringify({ entityType: 'venue', entityId: venueId }) })).status === 200 &&
      (await fan.fetch('/api/follow', { method: 'POST', body: JSON.stringify({ entityType: 'artist', entityId: artistId }) })).status === 200);

    const promHtml = await (await fan.fetch('/promoters/night-bureau')).text();
    check('follower count on public profile', promHtml.includes('1</b> follower'));

    // Engage: view (tracked with anon id), going, ticket click.
    await fan.fetch('/api/track', {
      method: 'POST',
      body: JSON.stringify({ type: 'event_viewed', eventId: bureauEventId, anonId: 'test-anon-1', path: '/events/x' }),
    });
    check('view stored with anon id',
      (await q(`select 1 from analytics_events where event_type = 'event_viewed' and event_id = $1 and anon_id = 'test-anon-1'`, [bureauEventId])).length === 1);
    check('fan marks going',
      (await fan.fetch(`/api/events/${bureauEventId}/action`, { method: 'POST', body: JSON.stringify({ rsvp: 'going' }) })).status === 200);
    const out = await fan.fetch(`/out/${bureauEventId}`);
    check('fan clicks GET TICKETS', out.status === 302 && out.headers.get('location') === 'https://tickets.example/bureau-test');

    // Promoter analytics reflect the activity.
    const stats = (await q(
      `select count(*) filter (where event_type = 'event_viewed')::int as views,
              count(*) filter (where event_type = 'ticket_clicked')::int as clicks,
              count(*) filter (where event_type = 'going')::int as going
         from analytics_events a
        where a.promoter_id = $1 or exists (select 1 from events e where e.id = a.event_id and e.promoter_id = $1)`,
      [nb]))[0];
    check('analytics ledger reflects loop', stats.views >= 1 && stats.clicks >= 1 && stats.going >= 1, JSON.stringify(stats));
    const page = await alex.fetch('/promoter/analytics?days=7');
    const pageHtml = await page.text();
    check('promoter analytics page renders real numbers', page.status === 200 && pageHtml.includes('Ticket clicks'));
    check('analytics stays aggregate (no member identities)', !pageHtml.includes('Jules'));
    const overview = await (await alex.fetch('/promoter')).text();
    check('overview shows follower/going stats', overview.includes('Followers'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Event claiming (is this your event?) —');
  {
    const trance = (await q(`select id from events where slug = 'trance-communion'`))[0];
    const res = await (await alex.fetch(`/api/promoter/${nb}/claim-event`, {
      method: 'POST', body: JSON.stringify({ eventId: trance.id }),
    })).json();
    check('domain-matched event claim auto-approves', res.status === 'approved');
    check('event now linked to promoter',
      (await q(`select promoter_id from events where id = $1`, [trance.id]))[0].promoter_id === nb);
    check('duplicate event claim blocked',
      (await alex.fetch(`/api/promoter/${nb}/claim-event`, { method: 'POST', body: JSON.stringify({ eventId: trance.id }) })).status === 409);

    // Pending path: unowned event on a foreign domain.
    const foreignEvent = await (await admin.fetch('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Mystery Warehouse Session', startAt: `${futureDate}T20:00`, timezone: 'Europe/London',
        city: 'Leeds', eventType: 'club_night', sourceUrl: 'https://totally-other-site.example/events/mystery',
        status: 'live',
      }),
    })).json();
    const res2 = await (await alex.fetch(`/api/promoter/${nb}/claim-event`, {
      method: 'POST', body: JSON.stringify({ eventId: foreignEvent.id, evidence: 'That is our warehouse series.' }),
    })).json();
    check('non-matching claim goes to admin review', res2.status === 'pending');
    check('event unchanged while pending',
      (await q(`select promoter_id from events where id = $1`, [foreignEvent.id]))[0].promoter_id === null);
    const claimRow = (await q(`select id from event_claims where event_id = $1`, [foreignEvent.id]))[0];
    const approve = await admin.fetch(`/api/admin/event-claims/${claimRow.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'approve' }),
    });
    check('admin approves event claim', approve.status === 200 &&
      (await q(`select promoter_id from events where id = $1`, [foreignEvent.id]))[0].promoter_id === nb);

    const owned = (await q(`select id from events where slug = 'golden-hour-rooftop-day-party'`))[0];
    check('cannot claim an event owned by another promoter',
      (await alex.fetch(`/api/promoter/${nb}/claim-event`, { method: 'POST', body: JSON.stringify({ eventId: owned.id }) })).status === 409);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Admin retains control: suspension —');
  {
    const suspend = await admin.fetch(`/api/admin/promoters/${nb}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'suspend' }),
    });
    check('admin suspends promoter', suspend.status === 200);
    check('suspended team loses write access',
      (await alex.fetch(`/api/promoter/${nb}/events`, {
        method: 'POST', body: JSON.stringify({ title: 'x', startAt: `${futureDate}T20:00`, eventType: 'other' }),
      })).status === 403);
    const dashHtml = await (await alex.fetch('/promoter')).text();
    check('dashboard shows suspension notice', dashHtml.includes('suspended'));
    check('public profile still renders', (await anon.fetch('/promoters/night-bureau')).status === 200);
    check('admin unsuspends',
      (await admin.fetch(`/api/admin/promoters/${nb}`, { method: 'PATCH', body: JSON.stringify({ action: 'unsuspend' }) })).status === 200 &&
      (await alex.fetch(`/api/promoter/${nb}/source/scan`, { method: 'POST' })).status === 200);
    check('suspension audited',
      (await q(`select 1 from audit_log where action = 'promoter_suspended' and promoter_id = $1`, [nb])).length === 1);
    check('admin claims queue renders', (await admin.fetch('/admin/promoters')).status === 200);
  }
} finally {
  fixtures.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:', failures.join(' | '));
  process.exitCode = 1;
}
await db.end();
