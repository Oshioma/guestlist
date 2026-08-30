// V2C verification: global locations, taste (explicit vs inferred),
// deterministic recommendations + reasons + diversity + exploration,
// rave history + dedupe, People From Your Scene, connections + blocking,
// travel plans + privacy, city pages/health, member home, Who's Going
// ordering, email foundation, promoter duplicates — including the privacy
// LEAK tests (hidden history must never surface in matching or copy).
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
    put(url, body = {}) { return this.fetch(url, { method: 'PUT', body: JSON.stringify(body) }); },
    patch(url, body = {}) { return this.fetch(url, { method: 'PATCH', body: JSON.stringify(body) }); },
    del(url, body = {}) { return this.fetch(url, { method: 'DELETE', body: JSON.stringify(body) }); },
    async json(url) { const r = await this.fetch(url); return r.ok ? r.json() : null; },
  };
}

const anon = client();
const oshi = client();   // admin · London · Space/The End/Ministry · Ibiza trip
const nadia = client();  // Metalheadz + The End (overlaps oshi 1999–2002)
const jules = client();  // Space 2002–06 · CONNECTED to oshi
const marcus = client(); // Tresor Berlin
const lena = client();   // Berlin · techno
const amani = client();  // Zanzibar · follows London
const maya = client();   // New York · house/disco
const thabo = client();  // Cape Town · amapiano
const steve = client();  // blank slate
const kwame = client();

const mid = async (email) => (await q(`select id from members where email = $1`, [email]))[0].id;
const mslug = async (email) => (await q(`select slug from members where email = $1`, [email]))[0].slug;
const eid = async (title) => (await q(`select id from events where title = $1`, [title]))[0].id;
const eslug = async (title) => (await q(`select slug from events where title = $1`, [title]))[0].slug;
const analyticsCount = (type) =>
  q(`select count(*)::int as n from analytics_events where event_type = $1`, [type]).then((r) => r[0].n);

try {
  console.log('\n— Setup —');
  for (const [c, email] of [
    [oshi, 'oshi@guestlist.net'], [nadia, 'dev-nadia@example.com'], [jules, 'dev-jules@example.com'],
    [marcus, 'dev-marcus@example.com'], [lena, 'dev-lena@example.com'], [amani, 'dev-amani@example.com'],
    [maya, 'dev-maya@example.com'], [thabo, 'dev-thabo@example.com'], [steve, 'dev-steve@example.com'],
    [kwame, 'dev-kwame@example.com'],
  ]) {
    check(`login ${email}`, (await c.login(email)) === 200);
  }
  const ids = {};
  for (const [key, email] of [
    ['oshi', 'oshi@guestlist.net'], ['nadia', 'dev-nadia@example.com'], ['jules', 'dev-jules@example.com'],
    ['marcus', 'dev-marcus@example.com'], ['lena', 'dev-lena@example.com'], ['amani', 'dev-amani@example.com'],
    ['maya', 'dev-maya@example.com'], ['thabo', 'dev-thabo@example.com'], ['steve', 'dev-steve@example.com'],
    ['kwame', 'dev-kwame@example.com'], ['rob', 'dev-rob@example.com'],
  ]) ids[key] = await mid(email);

  // -------------------------------------------------------------------------
  console.log('\n— International locations —');
  {
    const [london] = await q(`select * from locations where slug = 'london'`);
    check('canonical London: bare slug, GB, IANA tz',
      london && london.country_code === 'GB' && london.timezone === 'Europe/London');
    const [zanzibar] = await q(`select * from locations where slug = 'zanzibar'`);
    check('Zanzibar: TZ country code + Africa/Dar_es_Salaam',
      zanzibar && zanzibar.country_code === 'TZ' && zanzibar.timezone === 'Africa/Dar_es_Salaam');

    const before = (await q(`select count(*)::int as n from locations`))[0].n;
    const res = await steve.post('/api/you/places', { action: 'follow', newCity: { name: '  LONDON ', country: 'UK' } });
    const after = (await q(`select count(*)::int as n from locations`))[0].n;
    check('"LONDON, UK" resolves to the existing London — no duplicate place',
      res.status === 200 && after === before);

    await steve.post('/api/you/places', { action: 'follow', newCity: { name: 'Springfield', country: 'United States' } });
    await steve.post('/api/you/places', { action: 'follow', newCity: { name: 'Springfield', country: 'Ireland' } });
    const springfields = await q(`select slug, country_code from locations where normalized_name = 'springfield' order by slug`);
    check('same city name in two countries stays two places',
      springfields.length === 2 && new Set(springfields.map((s) => s.country_code)).size === 2);

    const kendwa = await q(`select timezone from events where title = 'Kendwa Full Moon Sessions'`);
    check('event timezone is the venue country, never the browser',
      kendwa[0].timezone === 'Africa/Dar_es_Salaam');

    const umojaHtml = await (await anon.fetch(`/events/${await eslug('Umoja: Amapiano & Afro House All-Nighter')}`)).text();
    check('ZAR prices display in rand', umojaHtml.includes('R180'));
    const loftHtml = await (await anon.fetch(`/events/${await eslug('Greenpoint Works: Loft Classics')}`)).text();
    check('USD prices display in dollars', loftHtml.includes('$30'));
    const currencies = await q(`select distinct currency from events where currency is not null`);
    check('multiple ISO currencies live side by side', currencies.length >= 4);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Taste: explicit vs inferred —');
  {
    const taste = await thabo.json('/api/you/taste');
    check('explicit taste returned (Thabo: Amapiano)',
      taste.explicit.some((g) => g.name === 'Amapiano'));
    check('global genres exist in taxonomy',
      taste.allGenres.some((g) => g.name === 'Afro House') && taste.allGenres.some((g) => g.name === 'Amapiano'));

    // Amani behaves (goes to an Amapiano night she never declared).
    await amani.post(`/api/events/${await eid('Umoja: Amapiano & Afro House All-Nighter')}/action`, { rsvp: 'going' });
    const amaniTaste = await amani.json('/api/you/taste');
    check('behaviour surfaces as INFERRED, never merged into explicit',
      amaniTaste.inferred.some((g) => g.name === 'Amapiano')
      && !amaniTaste.explicit.some((g) => g.name === 'Amapiano'));
    check('explicit choices survive behaviour',
      amaniTaste.explicit.some((g) => g.name === 'Afro House'));

    const put = await steve.put('/api/you/taste', {
      genreIds: taste.allGenres.filter((g) => ['Techno', 'Breaks'].includes(g.name)).map((g) => g.id),
    });
    const steveTaste = await put.json();
    check('setting explicit genres works', put.status === 200 && steveTaste.explicit.length === 2);
    check('taste_updated analytics recorded', (await analyticsCount('taste_updated')) >= 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Recommendations —');
  {
    const recs = await oshi.json('/api/recommendations?limit=12');
    check('recommendations return with reason codes',
      recs.recommendations.length > 0 && recs.recommendations.every((r) => r.reason_codes.length > 0));
    check('raw scores are never exposed',
      recs.recommendations.every((r) => r.score === undefined));
    check('genre match reasons for explicit taste',
      recs.recommendations.some((r) => r.reason_codes.includes('GENRE_MATCH')));
    check('travel destination boosts Ibiza during the trip',
      recs.recommendations.some((r) => r.reason_codes.includes('TRAVEL_DESTINATION') && r.city === 'Ibiza'));
    check('scene-history attendee reason (Nadia going to Jungle Mania)',
      recs.recommendations.some((r) => r.reason_codes.includes('SCENE_GOING')));
    check('recommendation impressions tracked', (await analyticsCount('recommendation_impression')) > 0);

    // Followed promoter.
    const [nightBureau] = await q(`select id from promoters where name = 'Night Bureau'`);
    await oshi.post('/api/follow', { entityType: 'promoter', entityId: nightBureau.id });
    const recs2 = await oshi.json('/api/recommendations?limit=20&track=false');
    check('followed promoter reason appears after following',
      recs2.recommendations.some((r) => r.reason_codes.includes('FOLLOWED_PROMOTER')));

    // Connection going: jules (connected to oshi) marks Going.
    await jules.post(`/api/events/${await eid('Analogue Love: Disco Supper Club')}/action`, { rsvp: 'going' });
    const recs3 = await oshi.json('/api/recommendations?limit=20&track=false');
    const disco = recs3.recommendations.find((r) => r.title === 'Analogue Love: Disco Supper Club');
    check('connection going reason with the connection’s name',
      !!disco && disco.reason_codes.includes('CONNECTION_GOING')
      && disco.reason_texts.some((t) => t.includes('Jules')));

    // Home city (Lena in Berlin).
    const lenaRecs = await lena.json('/api/recommendations?limit=20&track=false');
    check('home-city reason for Berlin member',
      lenaRecs.recommendations.some((r) => r.reason_codes.includes('HOME_CITY') && r.city === 'Berlin'));

    // Followed city (Amani follows London).
    const amaniRecs = await amani.json('/api/recommendations?limit=20&track=false');
    check('followed-city reason for London events',
      amaniRecs.recommendations.some((r) => r.reason_codes.includes('FOLLOWED_CITY') && r.city === 'London'));

    // Diversity: max 2 per promoter.
    const nadiaRecs = await nadia.json('/api/recommendations?limit=12&track=false');
    const perPromoter = {};
    for (const r of nadiaRecs.recommendations.filter((x) => !x.reason_codes.includes('EXPLORE'))) {
      if (r.promoter_name) perPromoter[r.promoter_name] = (perPromoter[r.promoter_name] ?? 0) + 1;
    }
    check('diversity: no promoter fills more than 2 slots',
      Object.values(perPromoter).every((n) => n <= 2), JSON.stringify(perPromoter));

    // Exploration: something outside the member's taste bubble.
    const marcusRecs = await marcus.json('/api/recommendations?limit=8&track=false');
    check('exploration slot escapes the filter bubble',
      marcusRecs.recommendations.some((r) => r.reason_codes.includes('EXPLORE')));

    // Negative feedback.
    const target = recs2.recommendations[0];
    const fb = await oshi.post(`/api/events/${target.id}/feedback`, { kind: 'not_for_me', reason: 'wrong_music' });
    const recs4 = await oshi.json('/api/recommendations?limit=20&track=false');
    check('NOT FOR ME excludes the event from recommendations',
      fb.status === 200 && !recs4.recommendations.some((r) => r.id === target.id));
    check('negative feedback analytics recorded', (await analyticsCount('event_not_for_me')) >= 1);
    await oshi.del(`/api/events/${target.id}/feedback`);
    const recs5 = await oshi.json('/api/recommendations?limit=20&track=false');
    check('undoing feedback restores eligibility', recs5.recommendations.some((r) => r.id === target.id));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Rave history + historical entities —');
  {
    const search = await oshi.json('/api/scene/search?q=space');
    check('entity search finds Space (Ibiza · Spain)',
      search.results.some((r) => r.name === 'Space' && r.country_code === 'ES'));
    check('I WAS THERE counts visible members',
      (await oshi.json('/api/scene/search?q=the end')).results.some((r) => r.attendee_count >= 3));
    check('anon cannot search scene entities', (await anon.fetch('/api/scene/search?q=space')).status === 401);

    // Dedupe: "THE END" in London resolves to the existing entity.
    const before = (await q(`select count(*)::int as n from scene_entities`))[0].n;
    const add = await steve.post('/api/you/history', {
      newEntity: { name: 'THE END', entityType: 'club', city: 'London', country: 'United Kingdom' },
      fromYear: 2001, toYear: 2003, genreIds: [],
    });
    const addData = await add.json();
    const after = (await q(`select count(*)::int as n from scene_entities`))[0].n;
    check('historical dedupe: THE END → existing The End (no new entity)',
      add.status === 200 && addData.entityCreated === false && after === before);
    check('history row stored with years',
      addData.history.some((h) => h.name === 'The End' && h.from_year === 2001 && h.to_year === 2003));

    // Same name, different country = a genuinely different club.
    const add2 = await steve.post('/api/you/history', {
      newEntity: { name: 'The End', entityType: 'club', city: 'Nairobi', country: 'Kenya' },
      fromYear: 2005, genreIds: [],
    });
    const add2Data = await add2.json();
    check('same club name in another country creates a NEW pending entity',
      add2.status === 200 && add2Data.entityCreated === true);
    const [nairobi] = await q(
      `select id, status, country_code from scene_entities where city = 'Nairobi'`);
    check('member-added entity starts pending with KE country', nairobi.status === 'pending' && nairobi.country_code === 'KE');

    const nadiaSearch = await nadia.json('/api/scene/search?q=the end');
    check('pending entities hidden from other members’ search',
      !nadiaSearch.results.some((r) => r.city === 'Nairobi'));
    const steveSearch = await steve.json('/api/scene/search?q=the end');
    check('creator still sees their own pending entity',
      steveSearch.results.some((r) => r.city === 'Nairobi'));

    const approve = await oshi.post('/api/admin/v2c', { action: 'approve_entity', entityId: nairobi.id });
    const nadiaSearch2 = await nadia.json('/api/scene/search?q=the end');
    check('admin approval makes it visible to everyone',
      approve.status === 200 && nadiaSearch2.results.some((r) => r.city === 'Nairobi'));
    check('non-admin cannot moderate entities',
      (await steve.post('/api/admin/v2c', { action: 'approve_entity', entityId: nairobi.id })).status === 403);
    check('history_added + scene_entity_added analytics recorded',
      (await analyticsCount('history_added')) >= 2 && (await analyticsCount('scene_entity_added')) >= 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— People From Your Scene —');
  {
    const html = await (await oshi.fetch('/people')).text();
    check('/people shows Nadia (shared The End, 1999–2002 overlap)', html.includes('Nadia K'));
    check('danced-with module present', html.includes('People you may have danced with'));
    check('overlap years shown when both members share them', /1999–2002|Both went to/.test(html));
    check('connected members are not re-suggested (Jules hidden)', !html.includes('Jules'));

    const profileHtml = await (await oshi.fetch(`/members/${await mslug('dev-nadia@example.com')}`)).text();
    check('profile shows mutually visible shared history',
      profileHtml.includes('crossed paths') && profileHtml.includes('The End'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— PRIVACY LEAK TESTS —');
  {
    const nadiaSlug = await mslug('dev-nadia@example.com');

    // Nadia hides her rave history entirely. (Kwame also shares The End
    // with oshi and keeps his public — his mention is legitimate; the test
    // is that NADIA's hidden history leaks nowhere.)
    await nadia.patch('/api/you/settings', { privacy: { show_history: false } });
    const people = await (await oshi.fetch('/people')).text();
    check('hidden history never appears in matching copy (Metalheadz gone)',
      !people.includes('Metalheadz'));
    const nadiaIdx = people.indexOf('Nadia K');
    const nadiaCard = nadiaIdx === -1 ? '' : people.slice(nadiaIdx, nadiaIdx + 400);
    check('her card carries no history-based reason',
      !nadiaCard.includes('The End') && !nadiaCard.includes('Both went to'));
    const profile = await (await oshi.fetch(`/members/${nadiaSlug}`)).text();
    check('hidden history vanishes from her profile',
      !profile.includes('The End') && !profile.includes('Metalheadz') && !profile.includes('crossed paths'));

    // Years hidden but history shown.
    await nadia.patch('/api/you/settings', { privacy: { show_history: true, show_history_years: false } });
    const profile2 = await (await oshi.fetch(`/members/${nadiaSlug}`)).text();
    check('years hidden: place shown, era withheld',
      // Match the rendered era format precisely — dev-mode RSC payloads
      // contain arbitrary timing floats that can embed "1999" by chance.
      profile2.includes('The End') && !/· 1999|1999–2003/.test(profile2));

    // Out of scene discovery entirely.
    await nadia.patch('/api/you/settings', { privacy: { show_history_years: true, scene_discovery: false } });
    const people2 = await (await oshi.fetch('/people')).text();
    check('scene_discovery off removes her from People entirely', !people2.includes('Nadia K'));

    // Private profile.
    await nadia.patch('/api/you/settings', { privacy: { profile_public: false } });
    check('private profile 404s for other members',
      (await marcus.fetch(`/members/${nadiaSlug}`)).status === 404);

    await nadia.patch('/api/you/settings', {
      privacy: { profile_public: true, scene_discovery: true, show_history: true, show_history_years: true },
    });
    const people3 = await (await oshi.fetch('/people')).text();
    check('restoring privacy restores discovery', people3.includes('Nadia K'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Connections + blocking —');
  {
    check('cannot connect with yourself',
      (await steve.post('/api/connections', { action: 'request', memberId: ids.steve })).status === 400);
    check('steve requests nadia',
      (await steve.post('/api/connections', { action: 'request', memberId: ids.nadia })).status === 200);
    check('duplicate request rejected',
      (await steve.post('/api/connections', { action: 'request', memberId: ids.nadia })).status === 400);
    const inbox = await nadia.json('/api/connections');
    const pending = inbox.pendingIn.find((c) => c.member_id === ids.steve);
    check('request lands in her inbox', !!pending);
    check('nadia accepts',
      (await nadia.post('/api/connections', { action: 'accept', connectionId: pending.connection_id })).status === 200);
    const steveConns = await steve.json('/api/connections');
    check('both sides now connected', steveConns.connected.some((c) => c.member_id === ids.nadia));
    check('connection analytics recorded',
      (await analyticsCount('connection_requested')) >= 1 && (await analyticsCount('connection_accepted')) >= 1);

    // Decline.
    await kwame.post('/api/connections', { action: 'request', memberId: ids.maya });
    const mayaInbox = await maya.json('/api/connections');
    const kReq = mayaInbox.pendingIn.find((c) => c.member_id === ids.kwame);
    check('maya declines kwame',
      (await maya.post('/api/connections', { action: 'decline', connectionId: kReq.connection_id })).status === 200);

    // Requests can be turned off.
    await lena.patch('/api/you/settings', { privacy: { allow_connection_requests: false } });
    check('requests blocked when member opts out',
      (await thabo.post('/api/connections', { action: 'request', memberId: ids.lena })).status === 403);
    await lena.patch('/api/you/settings', { privacy: { allow_connection_requests: true } });

    // Blocking.
    check('marcus blocks steve',
      (await marcus.post('/api/connections', { action: 'block', memberId: ids.steve })).status === 200);
    check('blocked member cannot request',
      (await steve.post('/api/connections', { action: 'request', memberId: ids.marcus })).status === 403);
    check('blocked profile hidden both ways',
      (await steve.fetch(`/members/${await mslug('dev-marcus@example.com')}`)).status === 404);
    const stevePeople = await (await steve.fetch('/people')).text();
    check('blocked member excluded from discovery', !stevePeople.includes('Marcus T'));
    const marcusRecs = await marcus.json('/api/recommendations?limit=20&track=false');
    check('blocked members never surface in rec reasons',
      marcusRecs.recommendations.every((r) => !r.reason_texts.some((t) => t.includes('Stevie'))));

    // Report + admin resolution.
    check('member report accepted',
      (await steve.post('/api/connections', { action: 'report', memberId: ids.kwame, reason: 'test report' })).status === 200);
    const [report] = await q(`select id from member_reports where status = 'open' order by created_at desc limit 1`);
    check('admin resolves the report',
      (await oshi.post('/api/admin/v2c', { action: 'resolve_report', reportId: report.id })).status === 200);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Travel plans + privacy —');
  {
    const start = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 9 * 86400_000).toISOString().slice(0, 10);
    const res = await maya.post('/api/you/travel', {
      destination: 'London', country: 'United Kingdom',
      startDate: start, endDate: end, visibility: 'private',
    });
    check('maya plans a private London trip', res.status === 200);
    check('travel analytics recorded', (await analyticsCount('travel_plan_created')) >= 1);

    const recs = await maya.json('/api/recommendations?limit=20&track=false');
    const travelRecs = recs.recommendations.filter((r) => r.reason_codes.includes('TRAVEL_DESTINATION'));
    check('private plan still powers her own recommendations',
      travelRecs.length > 0 && travelRecs.every((r) => r.city === 'London'));
    const outside = recs.recommendations.find(
      (r) => r.city === 'London' && (new Date(r.start_at) < new Date(start) || new Date(r.start_at) > new Date(`${end}T23:59:59Z`)));
    check('events outside the travel dates get no travel reason',
      !outside || !outside.reason_codes.includes('TRAVEL_DESTINATION'));

    const mayaProfile = await (await oshi.fetch(`/members/${await mslug('dev-maya@example.com')}`)).text();
    check('private travel dates never appear on her public profile', !mayaProfile.includes(start));
    check('bad dates rejected',
      (await maya.post('/api/you/travel', { destination: 'Berlin', startDate: end, endDate: start })).status === 400);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Cities, explore, member home —');
  {
    const london = await (await anon.fetch('/london')).text();
    check('/london city page renders with events', london.includes('Coming up in London'));
    check('unknown place 404s', (await anon.fetch('/place-that-does-not-exist')).status === 404);
    const explore = await (await anon.fetch('/explore')).text();
    check('explore lists destinations from real supply',
      explore.includes('London') && explore.includes('Zanzibar') && explore.includes('Cape Town'));

    check('thabo follows a city via API',
      (await thabo.post('/api/you/places', { action: 'follow', locationId: (await q(`select id from locations where slug='london'`))[0].id })).status === 200);
    check('city_followed analytics recorded', (await analyticsCount('city_followed')) >= 1);

    const home = await (await oshi.fetch('/')).text();
    check('member home greets with picks', home.includes('your Guestlist'));
    check('travel module on home (While you’re in Ibiza)', home.includes('While you’re in Ibiza'));
    check('city health table renders for admin',
      (await (await oshi.fetch('/admin/network')).text()).includes('City health'));
    const cityRows = await q(`
      select l.name, (select count(*)::int from events e where e.location_id = l.id
        and e.status='live' and e.start_at > now()) as n
      from locations l where l.slug in ('london','cape-town')`);
    const ldn = cityRows.find((c) => c.name === 'London');
    const cpt = cityRows.find((c) => c.name === 'Cape Town');
    check('city health raw signals sane (London busy, Cape Town seeding)',
      ldn.n >= 3 && cpt.n >= 1 && cpt.n < 3);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Event social context + Who’s Going ordering —');
  {
    const discoSlug = await eslug('Analogue Love: Disco Supper Club');
    const html = await (await oshi.fetch(`/events/${discoSlug}`)).text();
    check('event page shows connection context', html.includes('1 connection'));

    const jungleId = await eid('Rewind Sessions presents Jungle Mania');
    const attendees = await oshi.json(`/api/events/${jungleId}/attendees`);
    const names = attendees.going.map((m) => m.display_name);
    check('friends rank above strangers in Who’s Going',
      names.indexOf('Nadia K') !== -1 && names.indexOf('Nadia K') < names.indexOf('Stevie G'),
      JSON.stringify(names));

    // A member who hides Going disappears from lists.
    const rob = client();
    await rob.login('dev-rob@example.com');
    await rob.patch('/api/you/settings', { privacy: { show_going: false } });
    const attendees2 = await oshi.json(`/api/events/${jungleId}/attendees`);
    check('show_going=false removes a member from the list',
      !attendees2.going.some((m) => m.display_name === 'Rob Hacienda'));
    await rob.patch('/api/you/settings', { privacy: { show_going: true } });
  }

  // -------------------------------------------------------------------------
  console.log('\n— Email foundation —');
  {
    check('email cron requires auth', (await anon.post('/api/jobs/send-emails')).status === 401);
    const run = await (await oshi.post('/api/jobs/send-emails?digest=weekly')).json();
    check('weekly digest run queues member digests', run.ok && run.memberDigests > 0);
    const [digest] = await q(
      `select body_text, status from email_outbox where email_type = 'member_weekly_digest' limit 1`);
    check('digest body carries real picks + reasons',
      !!digest && digest.body_text.includes('picked for you') && digest.body_text.includes('/events/'));
    check('without a provider, delivery is dev-logged (never fake-sent)', digest.status === 'dev_logged');

    // Opt-out respected.
    await steve.patch('/api/you/settings', { emailPrefs: { weekly_digest: false } });
    const steveEmail = 'dev-steve@example.com';
    const before = (await q(`select count(*)::int as n from email_outbox where recipient_email = $1 and email_type='member_weekly_digest'`, [steveEmail]))[0].n;
    await oshi.post('/api/jobs/send-emails?digest=weekly');
    const after = (await q(`select count(*)::int as n from email_outbox where recipient_email = $1 and email_type='member_weekly_digest'`, [steveEmail]))[0].n;
    check('digest opt-out respected', after === before);
    check('email_queued analytics recorded', (await analyticsCount('email_queued')) > 0);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Promoter duplicate resolution —');
  {
    // Make kwame a verified owner of Steppers Union (test fixture).
    const [steppers] = await q(`select id from promoters where name = 'Steppers Union'`);
    await q(`update promoters set claim_status = 'verified', verified = true where id = $1`, [steppers.id]);
    await q(
      `insert into promoter_members (promoter_id, member_id, role) values ($1, $2, 'owner')
       on conflict do nothing`,
      [steppers.id, ids.kwame]
    );
    const keep = await eid('Steppers Union: Garage All-Dayer');
    const dup = await eid('Boat Party: Thames Pressure');
    check('outsider cannot file duplicate requests',
      (await steve.post('/api/promoter/duplicates', {
        promoterId: steppers.id, action: 'same_event', eventId: keep, duplicateOfEventId: dup,
      })).status === 403);
    const reqRes = await kwame.post('/api/promoter/duplicates', {
      promoterId: steppers.id, action: 'same_event', eventId: keep, duplicateOfEventId: dup,
      note: 'same night listed twice',
    });
    check('verified promoter files a duplicate request', reqRes.status === 200);
    const { requestId } = await reqRes.json();
    check('request is pending, not self-executing',
      (await q(`select status from event_duplicate_requests where id = $1`, [requestId]))[0].status === 'pending');
    check('admin approves the merge',
      (await oshi.post('/api/admin/v2c', { action: 'decide_duplicate', requestId, approve: true })).status === 200);
    const [dupEvent] = await q(`select status, possible_duplicate_of from events where id = $1`, [dup]);
    check('duplicate listing retired, canonical kept',
      dupEvent.status === 'rejected' && dupEvent.possible_duplicate_of === keep);
    check('keep_both is safe + auto-approved',
      (await (await kwame.post('/api/promoter/duplicates', {
        promoterId: steppers.id, action: 'keep_both',
        eventId: keep, duplicateOfEventId: await eid('Dub Foundation Sound System Session'),
      })).json()).ok === true);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Language readiness + misc —');
  {
    await q(
      `insert into events (title, slug, status, event_type, start_at, end_at, timezone, city, country,
         original_language, currency, price_from)
       values ('Noite Carioca — Baile Funk Especial', 'noite-carioca-baile-funk', 'live', 'club_night',
               now() + interval '10 days', now() + interval '10 days 6 hours', 'America/Sao_Paulo',
               'São Paulo', 'Brazil', 'pt', 'BRL', 60)`
    );
    const html = await (await anon.fetch('/events/noite-carioca-baile-funk')).text();
    check('non-English event keeps its original name untranslated',
      html.includes('Noite Carioca — Baile Funk Especial'));

    await oshi.patch('/api/you/settings', { profile: { ravingSince: '1992', nowDoing: 'Hospitality · Technology' } });
    const profile = await (await nadia.fetch(`/members/${await mslug('oshi@guestlist.net')}`)).text();
    check('cultural profile: raving since + now', profile.includes('Raving since 1992') && profile.includes('Hospitality'));

    check('/you requires sign-in', (await anon.fetch('/you')).status === 307);
    check('/people requires sign-in', (await anon.fetch('/people')).status === 307);
    check('client cannot spoof server-side rec analytics',
      (await anon.post('/api/track', { type: 'recommendation_impression' })).status === 400);
  }
} finally {
  await db.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
