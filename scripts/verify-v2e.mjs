// V2E verification: the Archive + I WAS THERE. Honest date uncertainty
// ("Summer 1996" never becomes 1 June 1996), attendance visibility that
// never leaks through counts/lists/matching copy, Who Was There ordering,
// member contributions with safe media storage, AI-proposes/admin-decides
// ingestion with provenance, dedupe buckets that never auto-merge
// ambiguity, corrections, memories + moderation, bulk import behind a
// mandatory dry run, rights + takedown, search, taste/people integration,
// and the archive → present bridges.
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
      const isForm = opts.body instanceof FormData;
      const res = await fetch(`${BASE}${url}`, {
        ...opts,
        redirect: 'manual',
        headers: {
          ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
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
    post(url, body = {}, headers = {}) {
      return this.fetch(url, { method: 'POST', body: JSON.stringify(body), headers });
    },
    del(url, body = {}) { return this.fetch(url, { method: 'DELETE', body: JSON.stringify(body) }); },
    form(url, formData, headers = {}) {
      return this.fetch(url, { method: 'POST', body: formData, headers });
    },
    async json(url) { const r = await this.fetch(url); return r.ok ? r.json() : null; },
    async html(url) { return (await this.fetch(url)).text(); },
  };
}

const anon = client();
const oshi = client();   // admin · public I WAS THERE at Metalheadz
const nadia = client();  // public Metalheadz + a memory
const jules = client();  // unsure at The End closing · contributes uploads
const kwame = client();  // connections-visibility Metalheadz
const marcus = client(); // PRIVATE Cream attendance — must never leak
const carla = client();  // connected to marcus
const maya = client();   // fresh attendance for taste/people tests
const steve = client();  // add/remove + block tests

const analyticsCount = (type) =>
  q(`select count(*)::int as n from analytics_events where event_type = $1`, [type]).then((r) => r[0].n);

// A valid 1×1 PNG (red pixel) for media tests.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const metalheadzFixture = JSON.stringify({
  title: 'Metalheadz at Blue Note',
  date_text: '1996',
  date_iso: '1996',
  venue_name: 'Blue Note',
  promoter_name: 'Metalheadz',
  city: 'London',
  country: 'United Kingdom',
  artists: ['Goldie', 'Doc Scott'],
  genres: ['Jungle'],
  price_text: null,
  language: null,
  description: null,
  confidence: 92,
  raw_text: 'METALHEADZ SUNDAY SESSIONS AT THE BLUE NOTE HOXTON SQUARE',
});

function uploadForm(what, when, where, opts = {}) {
  const fd = new FormData();
  fd.append('file', new File([opts.bytes ?? PNG_1PX], opts.filename ?? 'shoebox-scan.png', { type: 'image/png' }));
  fd.append('itemType', opts.itemType ?? 'flyer');
  if (what) fd.append('what', what);
  if (when) fd.append('when', when);
  if (where) fd.append('where', where);
  fd.append('credit', opts.credit === false ? 'false' : 'true');
  return fd;
}

try {
  console.log('\n— Setup —');
  const roster = [
    [oshi, 'oshi@guestlist.net'], [nadia, 'dev-nadia@example.com'], [jules, 'dev-jules@example.com'],
    [kwame, 'dev-kwame@example.com'], [marcus, 'dev-marcus@example.com'], [carla, 'dev-carla@example.com'],
    [maya, 'dev-maya@example.com'], [steve, 'dev-steve@example.com'],
  ];
  for (const [c, email] of roster) check(`login ${email}`, (await c.login(email)) === 200);

  const ids = {};
  const names = {};
  for (const [k, e] of [['oshi', 'oshi@guestlist.net'], ['nadia', 'dev-nadia@example.com'],
    ['jules', 'dev-jules@example.com'], ['kwame', 'dev-kwame@example.com'],
    ['marcus', 'dev-marcus@example.com'], ['carla', 'dev-carla@example.com'],
    ['maya', 'dev-maya@example.com'], ['steve', 'dev-steve@example.com']]) {
    const [row] = await q(`select id, display_name from members where email = $1`, [e]);
    ids[k] = row.id;
    names[k] = row.display_name;
  }
  const ae = {};
  for (const t of ['Metalheadz at Blue Note', 'Cream: October Session', 'The End: Closing Weekend', 'Baile do Espaço']) {
    const [row] = await q(`select id, slug from archive_events where title = $1`, [t]);
    ae[t] = row;
  }
  const mzUrl = `/archive/events/${ae['Metalheadz at Blue Note'].slug}`;
  const creamUrl = `/archive/events/${ae['Cream: October Session'].slug}`;

  // -------------------------------------------------------------------------
  console.log('\n— Honest dates —');
  {
    const rows = await q(`select title, date_precision, start_date::text, year, display_date from archive_events order by title`);
    const by = Object.fromEntries(rows.map((r) => [r.title, r]));
    check('year-only event stores no fabricated day',
      by['Metalheadz at Blue Note'].date_precision === 'year'
      && by['Metalheadz at Blue Note'].start_date === null
      && by['Metalheadz at Blue Note'].display_date === '1996');
    check('exact event keeps its real date',
      by['Cream: October Session'].date_precision === 'exact'
      && by['Cream: October Session'].start_date === '1995-10-14');
    check('circa event carries human wording verbatim, no synthetic date',
      by['Baile do Espaço'].date_precision === 'circa'
      && by['Baile do Espaço'].start_date === null
      && by['Baile do Espaço'].display_date === 'Verão de 1997');

    const baile = await anon.html(`/archive/events/${ae['Baile do Espaço'].slug}`);
    check('circa page shows the wording + (approximate) marker',
      baile.includes('Verão de 1997') && baile.includes('(approximate)'));
    check('circa page never invents a precise date', !/1 Jan 1997|1997-01-01|June 1997/.test(baile));
    check('original language preserved (São Paulo like London)',
      baile.includes('Uma noite que virou lenda') && baile.includes('São Paulo'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Discovery + search —');
  {
    const html = await anon.html('/archive');
    check('/archive lists published events', html.includes('Metalheadz at Blue Note') && html.includes('Baile do Espaço'));
    check('decades come from real years', html.includes('1990s'));
    check('memories surface on the front door', html.includes('Inner City Life'));
    // A MEMORY IS ABOUT A NIGHT, SO THE NIGHT IS THE HEADLINE. These were
    // quotes stacked in one box with the club's name small and grey at the
    // bottom, which read as a comments section. Each is its own card now, led
    // by the event and the date — the part somebody recognises.
    check('each memory is its own card', html.includes('memoryCard'));
    const at = html.indexOf('memoryCard');
    check('led by the night it is about, not the quote',
      at > 0 && html.indexOf('memoryCardTitle', at) < html.indexOf('memoryCardBody', at));
    check('and the card carries the date',
      /memoryCardWhen[^>]*>\s*[^<]*\d{4}/.test(html), 'a year should appear in the card meta');

    const s = await anon.json('/api/archive/search?q=metalheadz');
    check('search groups results (entity + event)',
      s.entities.some((e) => e.name === 'Metalheadz Sunday Sessions')
      && s.events.some((e) => e.title === 'Metalheadz at Blue Note'));
    check('search flyers group returns the flyer',
      s.flyers.some((f) => f.title === 'Metalheadz at Blue Note'));
    const byArtist = await anon.json('/api/archive/search?q=goldie');
    check('lineup names are searchable', byArtist.events.some((e) => e.title === 'Metalheadz at Blue Note'));
    check('empty query returns empty groups',
      JSON.stringify(await anon.json('/api/archive/search?q=')) === '{"entities":[],"events":[],"flyers":[]}');
    check('archive_search analytics recorded', (await analyticsCount('archive_search')) >= 2);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Archive event + club pages —');
  {
    const html = await anon.html(mzUrl);
    check('event page: lineup, genre, entity chip, memory, source',
      html.includes('Goldie') && html.includes('Jungle')
      && html.includes('Metalheadz Sunday Sessions')
      && html.includes('Inner City Life')
      && html.includes('Guestlist development seed'));
    check('flyer rights note shown beside the image', html.includes('Development placeholder image'));
    check('archive → now: Still your sound? bridges to a live D&B night',
      html.includes('Still your sound?')
      && /Jungle Mania|Liquid Rollers|Neurofunk Assembly|Hardcore Will Never Die|Ten Cities/.test(html));

    const club = await anon.html('/archive/clubs/the-end-london');
    check('club page: entity + its archived night',
      club.includes('The End') && club.includes('The End: Closing Weekend'));

    const [media] = await q(
      `select m.id from archive_media m join archive_items i on i.id = m.item_id
        where i.archive_event_id = $1`, [ae['Metalheadz at Blue Note'].id]);
    const fly = await anon.fetch(`/archive/flyers/${media.id}`);
    check('flyer URL redirects home to its night',
      fly.status === 307 && (fly.headers.get('location') ?? '').includes(ae['Metalheadz at Blue Note'].slug));
  }

  // -------------------------------------------------------------------------
  console.log('\n— I WAS THERE + attendance privacy —');
  {
    const html = await anon.html(mzUrl);
    check('anon count = public marks only (2)', html.includes('2 Guestlist members were there'));
    check('anon sees public attendees, never connections-visibility ones',
      html.includes(names.nadia) && !html.includes(names.kwame));

    // Kwame re-affirms his connections-visibility mark → sees himself + publics.
    const kw = await (await kwame.post('/api/archive/attendance', {
      archiveEventId: ae['Metalheadz at Blue Note'].id, certainty: 'sure', visibility: 'connections',
    })).json();
    check('viewer count includes own + visible rows (kwame: 3)', kw.count === 3);

    const nadiaView1 = await nadia.html(mzUrl);
    check('connections-visibility hidden from non-connections', !nadiaView1.includes(names.kwame));

    // Nadia connects with Kwame — his mark becomes visible to her.
    await nadia.post('/api/connections', { action: 'request', memberId: ids.kwame });
    const inbox = await kwame.json('/api/connections');
    const pending = inbox.pendingIn.find((c) => c.member_id === ids.nadia);
    check('connection accept succeeds',
      !!pending && (await kwame.post('/api/connections', { action: 'accept', connectionId: pending.connection_id })).status === 200);
    const nadiaView2 = await nadia.html(mzUrl);
    check('connections-visibility appears once connected', nadiaView2.includes(names.kwame));
    const iKwame = nadiaView2.indexOf(names.kwame);
    const iOshi = nadiaView2.indexOf(names.oshi);
    check('Who Was There orders connections first', iKwame !== -1 && iOshi !== -1 && iKwame < iOshi);

    // PRIVATE attendance never leaks — not to strangers, not to connections.
    const creamAnon = await anon.html(creamUrl);
    check('private mark invisible to anon (no name, no count)',
      !creamAnon.includes(names.marcus) && !/\d+ Guestlist member/.test(creamAnon));
    const creamCarla = await carla.html(creamUrl);
    check('private mark invisible even to a connection', !creamCarla.includes(names.marcus));
    const creamMarcus = await marcus.html(creamUrl);
    check('the member always sees their own mark', creamMarcus.includes(names.marcus));

    // Visibility changes recalculate counts immediately.
    const pub = await (await marcus.post('/api/archive/attendance', {
      archiveEventId: ae['Cream: October Session'].id, visibility: 'public',
    })).json();
    check('switch to public → count 1', pub.count === 1);
    check('now visible to anon', (await anon.html(creamUrl)).includes(names.marcus));
    await marcus.post('/api/archive/attendance', {
      archiveEventId: ae['Cream: October Session'].id, visibility: 'private',
    });
    check('switch back to private → hidden again', !(await anon.html(creamUrl)).includes(names.marcus));

    // "I think I was there" honesty in the list.
    const closing = await anon.html(`/archive/events/${ae['The End: Closing Weekend'].slug}`);
    check('unsure marks read "Thinks they were there"', closing.includes('Thinks they were there'));

    // Add + remove round trip.
    const sAdd = await (await steve.post('/api/archive/attendance', {
      archiveEventId: ae['Metalheadz at Blue Note'].id, certainty: 'unsure',
    })).json();
    check('steve adds (unsure) → count 3', sAdd.count === 3);
    const sDel = await (await steve.post('/api/archive/attendance', {
      archiveEventId: ae['Metalheadz at Blue Note'].id, action: 'remove',
    })).json();
    check('remove works and count recalculates', sDel.count === 2
      && (await q(`select 1 from archive_attendance where member_id = $1 and archive_event_id = $2`,
        [ids.steve, ae['Metalheadz at Blue Note'].id])).length === 0);
    check('add/remove analytics recorded',
      (await analyticsCount('i_was_there_added')) >= 1 && (await analyticsCount('i_was_there_removed')) >= 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Taste + people integration —');
  {
    // Maya (Paradise Garage era, no Jungle anywhere) marks the Metalheadz night.
    await maya.post('/api/archive/attendance', {
      archiveEventId: ae['Metalheadz at Blue Note'].id, certainty: 'sure', visibility: 'public',
    });
    const taste = await maya.json('/api/you/taste');
    check('archive attendance feeds INFERRED taste (Jungle)',
      taste.inferred.some((g) => g.name === 'Jungle'));
    check('inferred never merges into explicit', !taste.explicit.some((g) => g.name === 'Jungle'));

    const people = await oshi.html('/people');
    check('people graph: "You were both at" from public archive marks',
      people.includes('You were both at Metalheadz at Blue Note'));
    check('private attendance never becomes matching copy',
      !people.includes('You were both at Cream'));

    // Hiding rave history hides archive-based claims about you too.
    await nadia.fetch('/api/you/settings', {
      method: 'PATCH', body: JSON.stringify({ privacy: { show_history: false } }),
    });
    const people2 = await oshi.html('/people');
    const nIdx = people2.indexOf(names.nadia);
    const nadiaCard = nIdx === -1 ? '' : people2.slice(nIdx, nIdx + 400);
    check('show_history off removes her "You were both at" line',
      !nadiaCard.includes('Metalheadz at Blue Note'));
    await nadia.fetch('/api/you/settings', {
      method: 'PATCH', body: JSON.stringify({ privacy: { show_history: true } }),
    });
    const people3 = await oshi.html('/people');
    check('restoring history restores the shared night', people3.includes('You were both at Metalheadz at Blue Note'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Member contributions (add an old event) —');
  let speedId, speedSlug, circaId;
  {
    const res = await jules.post('/api/archive/contribute', {
      title: 'Speed at Mash', year: 1995, venue: 'Mash', city: 'London', country: 'United Kingdom',
      notes: 'Wednesday nights, LTJ Bukem residency era.',
    });
    const data = await res.json();
    check('member adds an old event → queued, never live', res.status === 200 && !!data.archiveEventId);
    speedId = data.archiveEventId;
    const [row] = await q(
      `select slug, status, date_precision, display_date, provenance from archive_events where id = $1`, [speedId]);
    speedSlug = row.slug;
    check('lands pending with honest year-only date',
      row.status === 'pending' && row.date_precision === 'year' && row.display_date === '1995');
    check('provenance marks it MEMBER_SUGGESTION', row.provenance.all === 'MEMBER_SUGGESTION');

    const circaRes = await kwame.post('/api/archive/contribute', {
      title: 'Twice as Nice Sunday', year: 1998, circa: 'Summer 1998', city: 'London', country: 'United Kingdom',
    });
    circaId = (await circaRes.json()).archiveEventId;
    const [crow] = await q(`select date_precision, display_date, start_date from archive_events where id = $1`, [circaId]);
    check('member "roughly when" becomes circa, wording kept',
      crow.date_precision === 'circa' && crow.display_date === 'Summer 1998' && crow.start_date === null);

    check('nameless nights rejected', (await jules.post('/api/archive/contribute', { title: 'x' })).status === 400);
    check('pending events are invisible to the public',
      (await anon.fetch(`/archive/events/${speedSlug}`)).status === 404
      && !(await anon.html('/archive')).includes('Speed at Mash'));
    check('I WAS THERE refuses unpublished events',
      (await jules.post('/api/archive/attendance', { archiveEventId: speedId })).status === 404);
    check('admin can preview unpublished', (await oshi.fetch(`/archive/events/${speedSlug}`)).status === 200);
    check('contribution analytics recorded', (await analyticsCount('archive_contribution')) >= 2);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Archive Desk: review, publish, edit, provenance —');
  {
    check('desk is admin-only (anon redirected)', (await anon.fetch('/admin/archive')).status === 307);
    check('desk API rejects non-admins',
      (await jules.post('/api/admin/archive', { action: 'publish_event', eventId: speedId })).status >= 401);
    const desk = await oshi.html('/admin/archive');
    check('desk shows the queue with health metrics',
      desk.includes('Speed at Mash') && desk.includes('published events'));

    check('admin publishes the contribution',
      (await oshi.post('/api/admin/archive', { action: 'publish_event', eventId: speedId })).status === 200);
    check('published event goes public', (await anon.fetch(`/archive/events/${speedSlug}`)).status === 200);

    check('needs_research holds an event without losing it',
      (await oshi.post('/api/admin/archive', { action: 'needs_research', eventId: circaId })).status === 200
      && (await q(`select status from archive_events where id = $1`, [circaId]))[0].status === 'needs_research');

    // Admin edit: refine the date, provenance-tagged.
    await oshi.post('/api/admin/archive', {
      action: 'edit_event', eventId: speedId,
      patch: { date: { precision: 'exact', startDate: '1995-03-17' }, venueName: 'The Mash Rooms' },
    });
    const [edited] = await q(`select display_date, date_precision, venue_name, provenance from archive_events where id = $1`, [speedId]);
    check('admin edit upgrades precision honestly',
      edited.date_precision === 'exact' && edited.display_date === '17 Mar 1995' && edited.venue_name === 'The Mash Rooms');
    check('every admin edit is provenance-tagged ADMIN',
      edited.provenance.date === 'ADMIN' && edited.provenance.all === 'MEMBER_SUGGESTION');
    check('bad date edits rejected',
      (await oshi.post('/api/admin/archive', {
        action: 'edit_event', eventId: speedId, patch: { date: { precision: 'circa', year: 1995 } },
      })).status === 400);
    check('unknown event 404s',
      (await oshi.post('/api/admin/archive', {
        action: 'publish_event', eventId: '00000000-0000-0000-0000-000000000000',
      })).status === 404);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Upload pipeline: safe media, AI proposes, dedupe attaches —');
  let uploadedItemId, uploadedMediaId, secondItemId;
  {
    const before = (await q(`select count(*)::int as n from archive_events`))[0].n;
    const res = await jules.form('/api/archive/contribute',
      uploadForm('Metalheadz flyer from a shoebox', '1996', 'London'),
      { 'x-vision-fixture': metalheadzFixture });
    const data = await res.json();
    check('matching flyer ATTACHES to the existing night (no duplicate event)',
      res.status === 200 && data.attachedToExisting === true
      && (await q(`select count(*)::int as n from archive_events`))[0].n === before);
    uploadedItemId = data.itemId;

    const [item] = await q(
      `select archive_event_id, status, contributed_by, credit_contributor, provenance
         from archive_items where id = $1`, [uploadedItemId]);
    check('item queued pending against the matched event',
      item.archive_event_id === ae['Metalheadz at Blue Note'].id && item.status === 'pending'
      && item.contributed_by === ids.jules && item.credit_contributor === true);
    check('item provenance separates member media from AI extraction',
      item.provenance.media === 'MEMBER_SUGGESTION' && item.provenance.extraction === 'AI_INFERENCE');

    const [media] = await q(
      `select id, storage_path, mime, rights, rights_note, ocr_text from archive_media where item_id = $1`,
      [uploadedItemId]);
    uploadedMediaId = media.id;
    check('media stored under a generated sharded path, never the filename',
      /^(\/uploads\/archive\/|https?:\/\/)[^ ]*[0-9a-f]{2}\/[0-9a-f-]{36}\/original\.png$/.test(media.storage_path)
      && !media.storage_path.includes('shoebox'));
    check('upload rights = contributor_granted with credit note',
      media.mime === 'image/png' && media.rights === 'contributor_granted'
      && media.rights_note.includes(names.jules));
    check('flyer text kept as OCR source material', (media.ocr_text ?? '').includes('BLUE NOTE'));
    check('pending media stays off the public page',
      !(await anon.html(mzUrl)).includes(media.id));

    // MIME sniffing: bytes rule, not extensions.
    const mediaBefore = (await q(`select count(*)::int as n from archive_media`))[0].n;
    const bad = await jules.form('/api/archive/contribute',
      uploadForm('fake', null, null, { bytes: Buffer.from('#!/bin/sh\necho not-an-image'), filename: 'legit.png' }));
    check('non-image bytes rejected regardless of extension',
      bad.status === 400 && (await q(`select count(*)::int as n from archive_media`))[0].n === mediaBefore);

    // A genuinely new night creates a pending event with per-field provenance.
    const warp = JSON.stringify({
      title: 'Warp Night at the Corn Exchange', date_text: '9 May 1992', date_iso: '1992-05-09',
      venue_name: 'Corn Exchange', promoter_name: null, city: 'Leeds', country: 'United Kingdom',
      artists: ['LFO', 'Nightmares on Wax'], genres: ['Techno'], price_text: '£8 b4 11',
      language: null, description: null, confidence: 80, raw_text: 'WARP NIGHT CORN EXCHANGE LEEDS',
    });
    const warpRes = await jules.form('/api/archive/contribute',
      uploadForm('Warp flyer', 'May 1992', 'Leeds'), { 'x-vision-fixture': warp });
    const warpData = await warpRes.json();
    check('unknown night → new pending event from the proposal', warpData.attachedToExisting === false);
    const [warpRow] = await q(
      `select e.status, e.date_precision, e.display_date, e.price_note, e.provenance
         from archive_items i join archive_events e on e.id = i.archive_event_id
        where i.id = $1`, [warpData.itemId]);
    check('AI proposal lands pending with exact date + verbatim price',
      warpRow.status === 'pending' && warpRow.date_precision === 'exact'
      && warpRow.display_date === '9 May 1992' && warpRow.price_note === '£8 b4 11');
    check('per-field provenance recorded (FLYER_TEXT / AI_INFERENCE)',
      warpRow.provenance.date === 'FLYER_TEXT' && warpRow.provenance.venue === 'FLYER_TEXT'
      && warpRow.provenance.title === 'AI_INFERENCE');

    // No extraction available → a pending night is still built from the
    // member's own answers, so the contribution can become visible later.
    const plain = await jules.form('/api/archive/contribute',
      uploadForm('Mystery ticket stub', 'late 90s', 'Bristol', { itemType: 'ticket_stub' }),
      { 'x-vision-fixture': 'null' });
    const plainData = await plain.json();
    const plainEvent = (await q(
      `select e.status, e.title, e.city from archive_items i
         join archive_events e on e.id = i.archive_event_id where i.id = $1`,
      [plainData.itemId]))[0];
    check('no extraction → pending night built from the member hints',
      plain.status === 200 && plainData.attachedToExisting === false
      && plainEvent && plainEvent.status === 'pending'
      && plainEvent.title === 'Mystery ticket stub' && plainEvent.city === 'Bristol');
    check('ingestion runs are recorded',
      (await q(`select count(*)::int as n from archive_ingestions where kind = 'upload'`))[0].n >= 3);

    // Second Metalheadz artefact for the notification-dedupe test below.
    const res2 = await jules.form('/api/archive/contribute',
      uploadForm('Second flyer', '1996', 'London'), { 'x-vision-fixture': metalheadzFixture });
    secondItemId = (await res2.json()).itemId;
  }

  // -------------------------------------------------------------------------
  console.log('\n— Publish item → preference-gated notifications —');
  {
    await q(
      `insert into member_email_prefs (member_id, archive_updates) values ($1, true)
       on conflict (member_id) do update set archive_updates = true`, [ids.nadia]);

    await oshi.post('/api/admin/archive', { action: 'publish_item', itemId: uploadedItemId });
    const nNadia = (await q(
      `select count(*)::int as n from notifications where member_id = $1 and type = 'archive_activity'`,
      [ids.nadia]))[0].n;
    const nOshi = (await q(
      `select count(*)::int as n from notifications where member_id = $1 and type = 'archive_activity'`,
      [ids.oshi]))[0].n;
    check('attendee with archive_updates ON gets one in-app notification', nNadia === 1);
    check('attendees with the pref OFF (default) get nothing', nOshi === 0);

    await oshi.post('/api/admin/archive', { action: 'publish_item', itemId: secondItemId });
    check('second publish within 3 days deduped', (await q(
      `select count(*)::int as n from notifications where member_id = $1 and type = 'archive_activity'`,
      [ids.nadia]))[0].n === 1);
    check('no auto-email from archive activity', (await q(
      `select count(*)::int as n from email_outbox where member_id = $1 and created_at > now() - interval '5 minutes'`,
      [ids.nadia]))[0].n === 0);
    check('published artefact appears on the night', (await anon.html(mzUrl)).includes(uploadedMediaId));

    // Publishing an item drags its night along — a published item invisible
    // behind a pending or missing night is the bug this guards against.
    const hinted = await jules.form('/api/archive/contribute',
      uploadForm('Lost basement night', '1998', 'Leeds'), { 'x-vision-fixture': 'null' });
    const hintedItem = (await hinted.json()).itemId;
    await oshi.post('/api/admin/archive', { action: 'publish_item', itemId: hintedItem });
    const hintedEvent = (await q(
      `select e.status from archive_items i join archive_events e on e.id = i.archive_event_id
        where i.id = $1`, [hintedItem]))[0];
    check('publish_item publishes the pending night it is attached to',
      hintedEvent && hintedEvent.status === 'published');

    const orphanItem = (await q(
      `insert into archive_items (item_type, title, contributor_note, status, provenance)
       values ('flyer', 'Orphan flyer', 'somewhere in 1997', 'pending', '{}') returning id`))[0].id;
    await oshi.post('/api/admin/archive', { action: 'publish_item', itemId: orphanItem });
    const orphanEvent = (await q(
      `select e.status, e.title, e.year from archive_items i
         join archive_events e on e.id = i.archive_event_id where i.id = $1`, [orphanItem]))[0];
    check('publish_item creates + publishes a night for an unattached item',
      orphanEvent && orphanEvent.status === 'published'
      && orphanEvent.title === 'Orphan flyer' && orphanEvent.year === 1997);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Rights + takedown —');
  {
    await oshi.post('/api/admin/archive', {
      action: 'set_media_rights', mediaId: uploadedMediaId, rights: 'licensed', note: 'Licence agreed with photographer',
    });
    const [m] = await q(`select rights, rights_note from archive_media where id = $1`, [uploadedMediaId]);
    check('rights + note stored', m.rights === 'licensed' && m.rights_note === 'Licence agreed with photographer');

    await oshi.post('/api/admin/archive', { action: 'hide_media', mediaId: uploadedMediaId });
    check('hide image: gone from the page, flyer URL dead, record kept',
      !(await anon.html(mzUrl)).includes(uploadedMediaId)
      && (await anon.fetch(`/archive/flyers/${uploadedMediaId}`)).status === 404
      && (await q(`select hidden from archive_media where id = $1`, [uploadedMediaId]))[0].hidden === true);
    await oshi.post('/api/admin/archive', { action: 'show_media', mediaId: uploadedMediaId });
    check('unhide restores it', (await anon.html(mzUrl)).includes(uploadedMediaId));
  }

  // -------------------------------------------------------------------------
  console.log('\n— I know more about this (corrections) —');
  {
    const res = await kwame.post('/api/archive/corrections', {
      archiveEventId: ae['Metalheadz at Blue Note'].id, field: 'lineup',
      suggestion: 'Randall played the back room most of those Sundays.',
    });
    check('correction queued', res.status === 200);
    check('empty corrections rejected',
      (await kwame.post('/api/archive/corrections', {
        archiveEventId: ae['Metalheadz at Blue Note'].id, suggestion: '',
      })).status === 400);
    check('corrections only against published history',
      (await kwame.post('/api/archive/corrections', { archiveEventId: circaId, suggestion: 'x' })).status === 404);
    check('desk lists the correction', (await oshi.html('/admin/archive')).includes('Randall played the back room'));

    const [corr] = await q(`select id from archive_corrections where status = 'open' order by created_at desc limit 1`);
    check('admin resolves it (applied)',
      (await oshi.post('/api/admin/archive', { action: 'resolve_correction', correctionId: corr.id, applied: true })).status === 200
      && (await q(`select status, resolved_by from archive_corrections where id = $1`, [corr.id]))[0].status === 'applied');
    check('cannot resolve twice',
      (await oshi.post('/api/admin/archive', { action: 'resolve_correction', correctionId: corr.id, applied: false })).status === 404);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Memories + moderation —');
  {
    await nadia.post('/api/archive/memories', {
      archiveEventId: ae['Metalheadz at Blue Note'].id,
      body: 'First time I heard Inner City Life on that system. Still chasing it.',
    });
    check('memory edit updates in place (one per member per night)',
      (await q(`select count(*)::int as n, max(body) as body from archive_memories
                 where member_id = $1 and archive_event_id = $2 and status = 'visible'`,
        [ids.nadia, ae['Metalheadz at Blue Note'].id]))[0].n === 1
      && (await anon.html(mzUrl)).includes('Still chasing it'));

    await maya.post('/api/archive/memories', {
      archiveEventId: ae['Metalheadz at Blue Note'].id, body: 'Flew over from New York that summer. Worth every penny.',
    });
    check('over-length memories rejected',
      (await maya.post('/api/archive/memories', {
        archiveEventId: ae['Metalheadz at Blue Note'].id, body: 'x'.repeat(501),
      })).status === 400);

    const [mayaMem] = await q(
      `select id from archive_memories where member_id = $1 and status = 'visible'`, [ids.maya]);
    await steve.post('/api/archive/memories', { reportMemoryId: mayaMem.id, reason: 'test report' });
    await steve.post('/api/archive/memories', { reportMemoryId: mayaMem.id, reason: 'again' });
    check('reports count once per reporter',
      (await q(`select report_count from archive_memories where id = $1`, [mayaMem.id]))[0].report_count === 1);
    check('desk lists reported memories', (await oshi.html('/admin/archive')).includes('Worth every penny'));

    await oshi.post('/api/admin/archive', { action: 'remove_memory', memoryId: mayaMem.id });
    check('removed memory disappears (record kept)',
      !(await anon.html(mzUrl)).includes('Worth every penny')
      && (await q(`select status from archive_memories where id = $1`, [mayaMem.id]))[0].status === 'removed');
    await oshi.post('/api/admin/archive', { action: 'restore_memory', memoryId: mayaMem.id });
    check('restore brings it back', (await anon.html(mzUrl)).includes('Worth every penny'));

    // Author control: delete own, never someone else's.
    await maya.del('/api/archive/memories', { memoryId: mayaMem.id });
    check('author deletes their own memory',
      (await q(`select count(*)::int as n from archive_memories where id = $1`, [mayaMem.id]))[0].n === 0);
    const [nadiaMem] = await q(`select id from archive_memories where member_id = $1`, [ids.nadia]);
    await maya.del('/api/archive/memories', { memoryId: nadiaMem.id });
    check('deleting another member’s memory is a no-op',
      (await q(`select count(*)::int as n from archive_memories where id = $1`, [nadiaMem.id]))[0].n === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Duplicates: buckets + deliberate merge —');
  {
    // A member re-submits a night that already exists (JSON path queues it
    // for the desk; the desk decides).
    const dupRes = await jules.post('/api/archive/contribute', {
      title: 'Cream: October Session', year: 1995, venue: 'Nation', city: 'Liverpool', country: 'United Kingdom',
    });
    const dupId = (await dupRes.json()).archiveEventId;
    check('slug collisions resolved, never overwritten',
      (await q(`select slug from archive_events where id = $1`, [dupId]))[0].slug
        !== ae['Cream: October Session'].slug);

    check('merge refuses self and unknowns',
      (await oshi.post('/api/admin/archive', { action: 'merge_events', keepId: dupId, dupId })).status === 400
      && (await oshi.post('/api/admin/archive', {
        action: 'merge_events', keepId: dupId, dupId: '00000000-0000-0000-0000-000000000000',
      })).status === 404);

    await oshi.post('/api/admin/archive', {
      action: 'merge_events', keepId: ae['Cream: October Session'].id, dupId,
    });
    const [merged] = await q(`select status, possible_duplicate_of from archive_events where id = $1`, [dupId]);
    check('merge is explicit: duplicate rejected + pointed at the kept night',
      merged.status === 'rejected' && merged.possible_duplicate_of === ae['Cream: October Session'].id);
    check('kept night unharmed (private attendance intact)',
      (await q(`select count(*)::int as n from archive_attendance where archive_event_id = $1`,
        [ae['Cream: October Session'].id]))[0].n === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Bulk import: mandatory dry run —');
  {
    const csv = [
      'title,date,display_date,venue,city,country,lineup,genres',
      '"Helter Skelter: Energy","1994-12-31",,"The Sanctuary","Milton Keynes","United Kingdom","Slipmatt; Dougal","Jungle"',
      '"Warehouse Sessions","1997",,,"Manchester","United Kingdom",,"House"',
      '"Summer Jam 96","1996","Summer 1996","Finsbury Park","London","United Kingdom",,"Jungle"',
      '"Lost Flyer Night","nineties?",,,,,,',
      '"Metalheadz at Blue Note","1996",,"Blue Note","London","United Kingdom","Goldie; Doc Scott","Jungle"',
    ].join('\n');

    const before = (await q(`select count(*)::int as n from archive_events`))[0].n;
    const dry = (await (await oshi.post('/api/admin/archive', {
      action: 'bulk_import', format: 'csv', text: csv, sourceRef: 'v2e-test',
    })).json()).report;
    check('dry run is the DEFAULT', dry.dryRun === true);
    check('dry run reports found/valid/invalid', dry.found === 5 && dry.valid === 4 && dry.invalid.length === 1);
    check('unparseable dates flagged, never guessed',
      dry.invalid[0].problems[0].includes('unparseable date'));
    check('duplicates detected and held',
      dry.duplicates.some((d) => d.title === 'Metalheadz at Blue Note' && ['exact', 'likely'].includes(d.bucket)));
    check('uncertain dates surfaced honestly (year + circa + dup-year)', dry.uncertainDates === 3);
    check('new venues reported before they exist', dry.newEntities.some((e) => e.includes('The Sanctuary')));
    check('dry run writes NOTHING', dry.imported === 0
      && (await q(`select count(*)::int as n from archive_events`))[0].n === before);
    check('every run is an audited ingestion',
      (await q(`select dry_run from archive_ingestions where kind = 'bulk_csv' order by created_at desc limit 1`))[0].dry_run === true);

    const real = (await (await oshi.post('/api/admin/archive', {
      action: 'bulk_import', format: 'csv', text: csv, dryRun: false, sourceRef: 'v2e-test',
    })).json()).report;
    check('real import lands valid rows for review, duplicates still held', real.imported === 3);
    const [summerJam] = await q(
      `select status, date_precision, display_date, start_date from archive_events where title = 'Summer Jam 96'`);
    check('imports land as needs_review, never straight to live', summerJam.status === 'needs_review');
    check('"Summer 1996" stays "Summer 1996" — no fabricated 1 June',
      summerJam.date_precision === 'circa' && summerJam.display_date === 'Summer 1996' && summerJam.start_date === null);
    check('the archive front door shows none of it yet',
      !(await anon.html('/archive')).includes('Summer Jam 96'));
    check('no second Metalheadz row was created',
      (await q(`select count(*)::int as n from archive_events where title = 'Metalheadz at Blue Note'`))[0].n === 1);

    // JSON path + international row.
    const intl = (await (await oshi.post('/api/admin/archive', {
      action: 'bulk_import', format: 'json', dryRun: false, sourceRef: 'v2e-intl',
      text: JSON.stringify([{
        title: 'Rave na Represa', date: '1998', city: 'São Paulo', country: 'Brazil',
        language: 'pt', lineup: ['DJ Marky'], genres: ['Jungle'],
      }]),
    })).json()).report;
    const [represa] = await q(
      `select city, country_code, original_language from archive_events where title = 'Rave na Represa'`);
    check('international rows import like London rows',
      intl.imported === 1 && represa.city === 'São Paulo' && represa.country_code === 'BR'
      && represa.original_language === 'pt');
    check('bad payloads rejected',
      (await oshi.post('/api/admin/archive', {
        action: 'bulk_import', format: 'json', text: '{"not":"an array"}',
      })).status === 400
      && (await oshi.post('/api/admin/archive', { action: 'bulk_import', format: 'csv', text: ' ' })).status === 400);

    // Publish one and check the honest date all the way to the page.
    const [sj] = await q(`select id, slug from archive_events where title = 'Summer Jam 96'`);
    await oshi.post('/api/admin/archive', { action: 'publish_event', eventId: sj.id });
    const page = await anon.html(`/archive/events/${sj.slug}`);
    check('published circa import reads honestly on the page',
      page.includes('Summer 1996') && page.includes('(approximate)') && !page.includes('June 1996'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Entity linking + lineage —');
  {
    const [mos] = await q(`select id from scene_entities where name = 'Ministry of Sound'`);
    const [theEnd] = await q(`select id from scene_entities where name = 'The End'`);
    await oshi.post('/api/admin/archive', { action: 'link_entity', eventId: speedId, entityId: mos.id });
    check('admin links an event to a scene entity',
      (await q(`select 1 from archive_event_entities where archive_event_id = $1 and entity_id = $2`,
        [speedId, mos.id])).length === 1);
    check('linked entity appears as a chip on the night',
      (await anon.html(`/archive/events/${speedSlug}`)).includes('Ministry of Sound'));

    await oshi.post('/api/admin/archive', {
      action: 'link_entities_lineage', fromEntity: theEnd.id, toEntity: mos.id,
      relation: 'related', note: 'test lineage',
    });
    check('lineage stored between entities',
      (await q(`select relation from scene_entity_links where from_entity = $1 and to_entity = $2`,
        [theEnd.id, mos.id]))[0].relation === 'related');

    // Venue auto-link: an exact normalized name+city match wires itself up.
    const sub = await (await jules.post('/api/archive/contribute', {
      title: 'Subterrain All-Nighter', year: 2003, venue: 'The End', city: 'London', country: 'United Kingdom',
    })).json();
    check('venue auto-links to the known scene entity (conservative match)',
      (await q(`select 1 from archive_event_entities where archive_event_id = $1 and entity_id = $2 and role = 'venue'`,
        [sub.archiveEventId, theEnd.id])).length === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Blocks cut across the archive too —');
  {
    await steve.post('/api/archive/attendance', {
      archiveEventId: ae['Metalheadz at Blue Note'].id, visibility: 'public',
    });
    await maya.post('/api/connections', { action: 'block', memberId: ids.steve });
    const mayaView = await maya.html(mzUrl);
    check('blocked member vanishes from Who Was There', !mayaView.includes(names.steve));
    const steveView = await steve.html(mzUrl);
    check('block works both directions', !steveView.includes(names.maya));
    check('anon still sees both (block is personal, not a ban)',
      (await anon.html(mzUrl)).includes(names.steve) && (await anon.html(mzUrl)).includes(names.maya));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Mixes: paste a link, play on-site —');
  {
    const mz = ae['Metalheadz at Blue Note'].id;
    check('anon cannot add a mix',
      (await anon.post('/api/archive/mixes',
        { archiveEventId: mz, url: 'https://youtu.be/dQw4w9WgXcQ0', title: 'x' })).status === 401);
    check('non-embeddable platform rejected with guidance', await (async () => {
      const r = await jules.post('/api/archive/mixes',
        { archiveEventId: mz, url: 'https://open.spotify.com/track/abc', title: 'Some set' });
      const d = await r.json();
      return r.status === 400 && /Mixcloud, SoundCloud or YouTube/.test(d.error ?? '');
    })());

    const added = await jules.post('/api/archive/mixes', {
      archiveEventId: mz, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Doc Scott — 3am set', artist: 'Doc Scott',
    });
    const addedData = await added.json();
    check('member mix lands pending', added.status === 200
      && (await q(`select status, platform, url from archive_mixes where id = $1`, [addedData.id]))[0].status === 'pending');
    check('pending mix not on the night page', !(await anon.html(mzUrl)).includes('Doc Scott — 3am set'));
    check('duplicate link on the same night blocked',
      (await jules.post('/api/archive/mixes', {
        archiveEventId: mz, url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Same set again',
      })).status === 409);

    check('desk lists the waiting mix', (await oshi.html('/admin/archive')).includes('Mixes waiting (1)'));
    await oshi.post('/api/admin/archive', { action: 'publish_mix', mixId: addedData.id });
    const night = await anon.html(mzUrl);
    check('published mix plays on the night page in our card',
      night.includes('Doc Scott — 3am set') && night.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ')
      && night.includes('mixCard'));
    check('published mix appears on the archive main page',
      (await anon.html('/archive')).includes('Doc Scott — 3am set'));

    // Admin additions publish immediately — they are the reviewers.
    const scAdd = await oshi.post('/api/archive/mixes', {
      archiveEventId: mz, url: 'https://soundcloud.com/metalheadz/goldie-live-blue-note',
      title: 'Goldie — Blue Note live',
    });
    check('admin-added SoundCloud mix publishes immediately with our accent colour',
      scAdd.status === 200
      && (await anon.html(mzUrl)).includes('w.soundcloud.com/player') && (await anon.html(mzUrl)).includes('7c4a9e'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Mixes on scenes: direct mixes + night roll-up —');
  {
    const [theEnd] = await q(`select id, name, slug from scene_entities where name = 'The End'`);
    const clubUrl = `/archive/clubs/${theEnd.slug}`;

    // The Metalheadz night is linked to its scene entity, so its published
    // mix rolls up onto that scene's page automatically.
    const mhClub = await anon.html('/archive/clubs/metalheadz-sunday-sessions-london');
    check('night mixes roll up onto the linked scene page',
      mhClub.includes('The mixes') && mhClub.includes('Doc Scott — 3am set'));

    check('a mix needs a night or a scene',
      (await jules.post('/api/archive/mixes',
        { url: 'https://youtu.be/jNQXAC9IVRw', title: 'Floating set' })).status === 400);
    check('unknown scene rejected',
      (await jules.post('/api/archive/mixes', {
        sceneEntityId: '00000000-0000-0000-0000-000000000000',
        url: 'https://youtu.be/jNQXAC9IVRw', title: 'Floating set',
      })).status === 404);

    const sceneMix = await (await jules.post('/api/archive/mixes', {
      sceneEntityId: theEnd.id, url: 'https://youtu.be/jNQXAC9IVRw',
      title: 'Mr C — closing room one', artist: 'Mr C',
    })).json();
    check('member scene mix lands pending, off the club page',
      (await q(`select status from archive_mixes where id = $1`, [sceneMix.id]))[0].status === 'pending'
      && !(await anon.html(clubUrl)).includes('Mr C — closing room one'));
    check('desk labels the scene mix',
      (await oshi.html('/admin/archive')).includes('The End (scene)'));

    await oshi.post('/api/admin/archive', { action: 'publish_mix', mixId: sceneMix.id });
    const club = await anon.html(clubUrl);
    check('published scene mix plays on the club page in our card',
      club.includes('Mr C — closing room one') && club.includes('mixCard'));
    check('scene mix appears on the archive main page with a scene link',
      (await anon.html('/archive')).includes('Mr C — closing room one'));
    check('duplicate link on the same scene blocked', await (async () => {
      const r = await jules.post('/api/archive/mixes', {
        sceneEntityId: theEnd.id, url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'Again',
      });
      return r.status === 409 && /already on this scene/.test((await r.json()).error ?? '');
    })());

    check('member sees the add-a-night shortcut on the scene page',
      (await jules.html(clubUrl)).includes(`+ Add a night at ${theEnd.name}`)
      && !(await anon.html(clubUrl)).includes('+ Add a night at'));

    // Admin can delete any mix outright; members and anon cannot.
    check('admin sees the delete control on the club page, others never',
      (await oshi.html(clubUrl)).includes('✕ Delete')
      && !(await jules.html(clubUrl)).includes('✕ Delete')
      && !(await anon.html(clubUrl)).includes('✕ Delete'));
    check('non-admin cannot delete a mix',
      (await jules.post('/api/admin/archive', { action: 'delete_mix', mixId: sceneMix.id })).status === 403);
    check('admin deletes the mix — gone from the page and the table',
      (await oshi.post('/api/admin/archive', { action: 'delete_mix', mixId: sceneMix.id })).status === 200
      && (await q(`select count(*)::int as n from archive_mixes where id = $1`, [sceneMix.id]))[0].n === 0
      && !(await anon.html(clubUrl)).includes('Mr C — closing room one'));
    check('add-a-night shortcut prefills the event name',
      (await jules.html('/archive/add?scene=The%20End')).includes('value="The End"'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Legacy suites untouched (spot checks) —');
  {
    check('live events browse still healthy', (await anon.fetch('/events')).status === 200);
    check('club messenger untouched', (await nadia.fetch('/clubmessenger')).status === 200);
    check('/you control surface untouched', (await nadia.fetch('/you')).status === 200);
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
