// V2F verification: CLOSE FRIENDS + PROMOTER FOLLOWER TOOLS.
//
// Close friends: one-way private marks inside existing connections, privacy
// (the other member never sees the mark), recommendation boost, Who's Going
// ordering, event copy, alerts with the on/digest/off preference, hidden
// Going exclusion, messenger pinning, blocks.
//
// Promoter tools: verified-only structured announcements, deterministic
// note validation, audience targeting + aggregate-only previews, caps +
// same-message suppression, scheduling, idempotent batched delivery through
// V2D, member preferences + unsubscribe + unfollow exclusion, attribution
// analytics, follower dashboard privacy floors, admin pause/block/caps,
// audit trail, announcement + close-friend dedupe, international targeting.
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
    patch(url, body = {}) { return this.fetch(url, { method: 'PATCH', body: JSON.stringify(body) }); },
    async json(url) { const r = await this.fetch(url); return r.ok ? r.json() : null; },
    async html(url) { return (await this.fetch(url)).text(); },
  };
}

const anon = client();
const oshi = client();   // admin · marks Jules a close friend
const nadia = client();  // follower with email announcements ON
const jules = client();  // Oshi's close friend (one-way) · follower
const kwame = client();  // Low End Collective owner (fixture, verified in-test)
const marcus = client(); // ordinary connection of carla (control group)
const carla = client();  // Berlin follower
const maya = client();   // London follower who unfollows mid-test
const steve = client();  // follower with announcements OFF
const lena = client();   // becomes São Paulo follower · analyst role test

const notifCount = (memberId, type, eventId = null) =>
  q(`select count(*)::int as n from notifications
      where member_id = $1 and type = $2 and ($3::uuid is null or event_id = $3)`,
    [memberId, type, eventId]).then((r) => r[0].n);
const analyticsCount = (type) =>
  q(`select count(*)::int as n from analytics_events where event_type = $1`, [type]).then((r) => r[0].n);
const runJob = () => oshi.post('/api/jobs/send-emails');

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
    promoterId: opts.promoterId ?? null,
    venueId: null,
    genreSlugs: opts.genreSlugs ?? [],
    lineup: [],
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`publish failed: ${JSON.stringify(data)}`);
  await sleep(600); // publish hook is fire-and-forget
  return data.id;
}

const inDays = (n, h = 22) => {
  const d = new Date(Date.now() + n * 86400_000);
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString();
};

try {
  console.log('\n— Setup —');
  for (const [c, email] of [
    [oshi, 'oshi@guestlist.net'], [nadia, 'dev-nadia@example.com'], [jules, 'dev-jules@example.com'],
    [kwame, 'dev-kwame@example.com'], [marcus, 'dev-marcus@example.com'], [carla, 'dev-carla@example.com'],
    [maya, 'dev-maya@example.com'], [steve, 'dev-steve@example.com'], [lena, 'dev-lena@example.com'],
  ]) {
    check(`login ${email}`, (await c.login(email)) === 200);
  }
  const ids = {};
  const names = {};
  for (const [k, e] of [['oshi', 'oshi@guestlist.net'], ['nadia', 'dev-nadia@example.com'],
    ['jules', 'dev-jules@example.com'], ['kwame', 'dev-kwame@example.com'],
    ['marcus', 'dev-marcus@example.com'], ['carla', 'dev-carla@example.com'],
    ['maya', 'dev-maya@example.com'], ['steve', 'dev-steve@example.com'],
    ['lena', 'dev-lena@example.com']]) {
    const [row] = await q(`select id, display_name, slug from members where email = $1`, [e]);
    ids[k] = row.id;
    names[k] = row.display_name;
    if (k === 'jules') ids.julesSlug = row.slug;
  }
  const julesFirst = names.jules.split(' ')[0];
  void julesFirst;

  // -------------------------------------------------------------------------
  console.log('\n— Close friends: one relationship, one-way, private —');
  {
    check('close friend requires an existing connection',
      (await oshi.post('/api/connections', { action: 'close_friend', memberId: ids.steve })).status === 400);

    check('mark close friend (inside the seeded oshi↔jules connection)',
      (await oshi.post('/api/connections', { action: 'close_friend', memberId: ids.jules })).status === 200);
    const mine = await oshi.json('/api/connections');
    check('my list shows MY star', mine.connected.find((c) => c.member_id === ids.jules)?.is_close === true);

    // ONE-WAY + PRIVATE: Jules never sees that he was marked.
    const theirs = await jules.json('/api/connections');
    check('one-way: their list shows no star for them',
      theirs.connected.find((c) => c.member_id === ids.oshi)?.is_close === false);
    check('no notification is ever sent for being marked',
      (await q(`select count(*)::int as n from notifications where member_id = $1
                 and created_at > now() - interval '5 minutes'`, [ids.jules]))[0].n === 0);

    const oshiViews = await oshi.html(`/members/${ids.julesSlug}`);
    check('marker sees ★ Close friend on the profile', oshiViews.includes('★ Close friend'));
    const [oshiRow] = await q(`select slug from members where id = $1`, [ids.oshi]);
    const julesViews = await jules.html(`/members/${oshiRow.slug}`);
    check('the marked member sees only ✦ Connected',
      julesViews.includes('✦ Connected') && !julesViews.includes('★ Close friend'));

    check('unmark works',
      (await oshi.post('/api/connections', { action: 'close_friend', memberId: ids.jules, close: false })).status === 200
      && (await oshi.json('/api/connections')).connected.find((c) => c.member_id === ids.jules)?.is_close === false);
    await oshi.post('/api/connections', { action: 'close_friend', memberId: ids.jules });
    check('close friend analytics recorded',
      (await analyticsCount('close_friend_marked')) >= 2 && (await analyticsCount('close_friend_unmarked')) >= 1);

    // Remove connection entirely (steve↔lena round trip).
    await steve.post('/api/connections', { action: 'request', memberId: ids.lena });
    const inbox = await lena.json('/api/connections');
    const pend = inbox.pendingIn.find((c) => c.member_id === ids.steve);
    await lena.post('/api/connections', { action: 'accept', connectionId: pend.connection_id });
    check('remove connection severs it for both sides',
      (await steve.post('/api/connections', { action: 'remove', memberId: ids.lena })).status === 200
      && (await lena.json('/api/connections')).connected.length === 0);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Close friend signals: event copy, Who’s Going, recs, /people —');
  const [liquid] = await q(`select id, slug from events where title = 'Liquid Rollers'`);
  {
    await jules.post(`/api/events/${liquid.id}/action`, { rsvp: 'going' });
    await steve.post(`/api/events/${liquid.id}/action`, { rsvp: 'going' });
    await sleep(600);

    const page = await oshi.html(`/events/${liquid.slug}`);
    check('event page leads with ★ close friend copy',
      page.includes(`★ ${names.jules} is going`));

    const att = await oshi.json(`/api/events/${liquid.id}/attendees`);
    check('Who’s Going puts the close friend first, starred for me only',
      att.going[0]?.id === ids.jules && att.going[0]?.is_close === true);
    const attForSteve = await steve.json(`/api/events/${liquid.id}/attendees`);
    check('nobody else sees my star',
      (attForSteve.going.find((g) => g.id === ids.jules)?.is_close ?? false) === false);

    const recs = await oshi.json('/api/recommendations?limit=30&track=false');
    const rec = recs.recommendations.find((r) => r.id === liquid.id);
    check('recommendation carries CLOSE_FRIEND_GOING with the ★ name',
      !!rec && rec.reason_codes.includes('CLOSE_FRIEND_GOING')
      && rec.reason_texts.some((t) => t.includes(`★ ${names.jules}`)));

    // Ordinary connections read as CONNECTION_GOING — then upgrade live.
    await carla.post(`/api/events/${liquid.id}/action`, { rsvp: 'going' });
    await sleep(600);
    const mRecs = await marcus.json('/api/recommendations?limit=30&track=false');
    const mRec = mRecs.recommendations.find((r) => r.id === liquid.id);
    check('ordinary connection stays CONNECTION_GOING',
      !!mRec && mRec.reason_codes.includes('CONNECTION_GOING')
      && !mRec.reason_codes.includes('CLOSE_FRIEND_GOING'));
    await marcus.post('/api/connections', { action: 'close_friend', memberId: ids.carla });
    const mRecs2 = await marcus.json('/api/recommendations?limit=30&track=false');
    const mRec2 = mRecs2.recommendations.find((r) => r.id === liquid.id);
    check('marking them close upgrades the same signal',
      !!mRec2 && mRec2.reason_codes.includes('CLOSE_FRIEND_GOING'));

    const people = await oshi.html('/people');
    check('/people shows the private Close friends panel',
      people.includes('Close friends (1)') && people.includes(`★ ${names.jules}`)
      && people.includes('Only you can see this list'));
    const cardIdx = people.indexOf(`★ ${names.jules}`);
    check('close friend upcoming plans listed',
      cardIdx !== -1 && people.slice(cardIdx, cardIdx + 600).includes('Going:'));

    const julesPeople = await jules.html('/people');
    check('the marked member’s /people has no close-friends panel',
      !julesPeople.includes('Close friends ('));

    // Discovery sections exclude existing connections, so /people must list
    // them explicitly — a friend never disappears after connecting. Carla's
    // connection to Marcus is ordinary (she never starred him).
    const carlaPeople = await carla.html('/people');
    check('/people lists ordinary connections under Your people',
      carlaPeople.includes('Your people (') && carlaPeople.includes(names.marcus));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Weekend home: Your people this weekend —');
  {
    // A guaranteed-in-window event: next Friday night (or tonight if it IS
    // the weekend), same maths as weekendWindow().
    const now = new Date();
    const day = now.getUTCDay();
    const fridayOffset = (day === 5 || day === 6 || day === 0) ? 0 : 5 - day;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),
      now.getUTCDate() + fridayOffset, 22, 0, 0));
    if (start.getTime() < Date.now()) start.setUTCHours(now.getUTCHours() + 2);
    const weekendEventId = await publishEvent({
      title: 'V2F Weekend Session', startAt: start.toISOString(), genreSlugs: ['house'],
    });
    await jules.post(`/api/events/${weekendEventId}/action`, { rsvp: 'going' });
    await sleep(600);
    const home = await oshi.html('/');
    check('home shows Your people this weekend with the ★',
      home.includes('Your people this weekend') && home.includes(`★ ${names.jules}`)
      && home.includes('V2F Weekend Session'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Close friend alerts: on / digest / off, taste reach, hidden Going —');
  {
    await q(`insert into member_genres (member_id, genre_id)
             select $1, id from genres where name = 'House' on conflict do nothing`, [ids.oshi]);
    await oshi.patch('/api/you/settings', {
      emailPrefs: { alert_frequency: 'instant', close_friend_activity: 'on' },
    });

    // ON + saved event → one notification + one instant ★ email.
    const e2 = await publishEvent({ title: 'V2F Alert Night', startAt: inDays(9), genreSlugs: ['techno'] });
    await oshi.post(`/api/events/${e2}/action`, { saved: true });
    await jules.post(`/api/events/${e2}/action`, { rsvp: 'going' });
    await sleep(600);
    check('close friend going → close_friend_going notification',
      (await notifCount(ids.oshi, 'close_friend_going', e2)) === 1);
    const [mail] = await q(
      `select subject from email_outbox where dedupe_key = $1`, [`conn:${ids.oshi}:${ids.jules}:${e2}`]);
    check('instant email carries the ★', !!mail && mail.subject.startsWith(`★ ${names.jules} is going`));
    check('notification centre renders the ★ line',
      (await oshi.html('/notifications')).includes(`★ ${names.jules} is going to V2F Alert Night`));

    // Idempotent: re-RSVP never duplicates.
    await jules.post(`/api/events/${e2}/action`, { rsvp: 'going' });
    await sleep(600);
    check('re-RSVP never duplicates the alert',
      (await notifCount(ids.oshi, 'close_friend_going', e2)) === 1);

    // DIGEST: in-app lands, no instant email — the daily digest owns it.
    await oshi.patch('/api/you/settings', { emailPrefs: { close_friend_activity: 'digest' } });
    const e3 = await publishEvent({ title: 'V2F Digest Night', startAt: inDays(10), genreSlugs: ['techno'] });
    await oshi.post(`/api/events/${e3}/action`, { saved: true });
    await jules.post(`/api/events/${e3}/action`, { rsvp: 'going' });
    await sleep(600);
    check('digest pref: notification yes, instant email no',
      (await notifCount(ids.oshi, 'close_friend_going', e3)) === 1
      && (await q(`select count(*)::int as n from email_outbox where dedupe_key = $1`,
        [`conn:${ids.oshi}:${ids.jules}:${e3}`]))[0].n === 0);

    // OFF: silence, their choice is final.
    await oshi.patch('/api/you/settings', { emailPrefs: { close_friend_activity: 'off' } });
    const e4 = await publishEvent({ title: 'V2F Quiet Night', startAt: inDays(11), genreSlugs: ['techno'] });
    await oshi.post(`/api/events/${e4}/action`, { saved: true });
    await jules.post(`/api/events/${e4}/action`, { rsvp: 'going' });
    await sleep(600);
    check('off pref: no notification at all',
      (await notifCount(ids.oshi, 'close_friend_going', e4)) === 0);

    // Taste reach: close friends alert on a matching-genre event even when
    // it isn't saved — ordinary connections don't.
    await oshi.patch('/api/you/settings', { emailPrefs: { close_friend_activity: 'on' } });
    const e5 = await publishEvent({ title: 'V2F House Special', startAt: inDays(12), genreSlugs: ['house'] });
    await jules.post(`/api/events/${e5}/action`, { rsvp: 'going' });
    await carla.post(`/api/events/${e5}/action`, { rsvp: 'going' });
    await sleep(700);
    check('close friend + taste match alerts without a save',
      (await notifCount(ids.oshi, 'close_friend_going', e5)) === 1);
    check('ordinary connection without relevance stays silent',
      (await notifCount(ids.marcus, 'connection_going', e5)) === 0);

    // Hidden Going never leaks into close-friend alerts either.
    await jules.patch('/api/you/settings', { privacy: { show_going: false } });
    const e6 = await publishEvent({ title: 'V2F Private Plans', startAt: inDays(13), genreSlugs: ['house'] });
    await oshi.post(`/api/events/${e6}/action`, { saved: true });
    await jules.post(`/api/events/${e6}/action`, { rsvp: 'going' });
    await sleep(600);
    check('hidden Going excluded from close-friend alerts',
      (await notifCount(ids.oshi, 'close_friend_going', e6)) === 0);
    await jules.patch('/api/you/settings', { privacy: { show_going: true } });
    await oshi.patch('/api/you/settings', { emailPrefs: { alert_frequency: 'daily' } });
  }

  // -------------------------------------------------------------------------
  console.log('\n— Club Messenger: close friends pinned + starred —');
  {
    const soon = new Date(Date.now() + 2 * 3600_000).toISOString();
    const tonightId = await publishEvent({ title: 'V2F Tonight', startAt: soon, genreSlugs: ['house'] });
    await jules.post(`/api/events/${tonightId}/action`, { rsvp: 'going' });
    await jules.post('/api/clubmessenger/presence', { action: 'arrive', eventId: tonightId });
    await sleep(400);
    const club = await oshi.html('/clubmessenger');
    check('messenger shows the private ★ beside a close friend here now',
      club.includes(`★ ${names.jules}`));
    const clubForSteve = await steve.html('/clubmessenger');
    check('no star for anyone else', !clubForSteve.includes(`★ ${names.jules}`));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Promoter follower tools: verification gates —');
  const [lowEnd] = await q(`select id from promoters where name = 'Low End Collective'`);
  const [nightBureau] = await q(`select id from promoters where name = 'Night Bureau'`);
  {
    // Fixtures: kwame owns Low End (verified); steve owns Night Bureau (unclaimed).
    await q(`update promoters set claim_status = 'verified' where id = $1`, [lowEnd.id]);
    await q(`insert into promoter_members (promoter_id, member_id, role) values ($1, $2, 'owner')
             on conflict do nothing`, [lowEnd.id, ids.kwame]);
    await q(`insert into promoter_members (promoter_id, member_id, role) values ($1, $2, 'owner')
             on conflict do nothing`, [nightBureau.id, ids.steve]);
    await q(`insert into promoter_members (promoter_id, member_id, role) values ($1, $2, 'analyst')
             on conflict do nothing`, [lowEnd.id, ids.lena]);

    check('unverified promoter cannot announce',
      (await steve.post(`/api/promoter/${nightBureau.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'new_event',
      })).status === 403);
    await q(`update promoters set claim_status = 'suspended' where id = $1`, [nightBureau.id]);
    check('suspended promoter blocked immediately',
      (await steve.post(`/api/promoter/${nightBureau.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'new_event',
      })).status === 403);
    check('cross-promoter events rejected (Liquid Rollers is Low End’s)',
      ((await (await steve.post(`/api/promoter/${nightBureau.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'new_event',
      })).json()).error ?? '').length > 0);
    check('analyst role cannot send',
      (await lena.post(`/api/promoter/${lowEnd.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'new_event',
      })).status >= 401);
    check('random members cannot touch the API',
      (await nadia.post(`/api/promoter/${lowEnd.id}/announcements`, { action: 'create' })).status >= 401);

    // A cross-promoter event by its OWNER promoter is still rejected.
    const foreign = await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
      action: 'create', eventId: (await q(
        `select id from events where promoter_id is distinct from $1 and status = 'live' limit 1`,
        [lowEnd.id]))[0].id, updateType: 'new_event',
    });
    check('event ownership enforced for verified promoters too', foreign.status === 403);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Note validation: deterministic, no giant AI —');
  {
    const mk = (note) => kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
      action: 'create', eventId: liquid.id, updateType: 'new_event', note,
    });
    check('281-char note rejected', (await mk('x'.repeat(281))).status === 400);
    check('HTML rejected', (await mk('<b>BIG NIGHT</b>')).status === 400);
    check('URLs rejected', (await mk('grab tickets at https://evil.example')).status === 400);
    check('bare domains rejected', (await mk('see ticketsite.com for more')).status === 400);
    check('unknown update types rejected',
      (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'buy_merch',
      })).status === 400);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Audience targeting + aggregate preview —');
  {
    // Six followers with controlled geography and taste.
    for (const c of [nadia, jules, maya, steve, carla, lena]) {
      await c.post('/api/follow', { entityType: 'promoter', entityId: lowEnd.id, follow: true });
    }
    const [london] = await q(`select id from locations where slug = 'london'`);
    const [berlin] = await q(`select id from locations where slug = 'berlin'`);
    await q(`update members set home_location_id = $2, home_city = 'London' where id = any($1)`,
      [[ids.nadia, ids.jules, ids.maya], london.id]);
    await q(`update members set home_location_id = $2, home_city = 'Berlin' where id = $1`, [ids.carla, berlin.id]);
    await q(`update members set home_location_id = null where id = any($1)`, [[ids.steve, ids.lena]]);
    // Liquid Rollers must be linked to London for near_event targeting.
    await q(`update events set location_id = $2 where id = $1`, [liquid.id, london.id]);
    // Taste: exactly nadia + jules match the event's genres.
    const eventGenres = (await q(
      `select genre_id from event_genres where event_id = $1`, [liquid.id])).map((r) => r.genre_id);
    await q(`delete from member_genres where member_id = any($1) and genre_id = any($2)`,
      [[ids.maya, ids.carla, ids.lena, ids.steve], eventGenres]);
    await q(`insert into member_genres (member_id, genre_id)
             select m, $2 from unnest($1::uuid[]) m on conflict do nothing`,
      [[ids.nadia, ids.jules], eventGenres[0]]);
    // Preferences: nadia email, steve off, rest default (in-app).
    await nadia.patch('/api/you/settings', { emailPrefs: { promoter_announcements: 'email' } });
    await steve.patch('/api/you/settings', { emailPrefs: { promoter_announcements: 'off' } });

    const prev = async (audience, locationId = null) =>
      (await (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
        action: 'preview', eventId: liquid.id, audience, locationId,
      })).json()).preview;

    const all = await prev('all');
    check('preview: all followers counted', all.followers === 6 && all.targeted === 6);
    check('preview: channel eligibility respects member prefs',
      all.email_eligible === 1 && all.inapp_eligible === 5);
    const near = await prev('near_event');
    check('preview: near-event targeting (3 Londoners)', near.targeted === 3);
    const genre = await prev('genre_match');
    check('preview: genre targeting (2 taste matches)', genre.targeted === 2);
    const city = await prev('city', berlin.id);
    check('preview: city targeting (1 Berliner)', city.targeted === 1);
    check('preview exposes counts only — never identities',
      JSON.stringify(all).length < 200 && !JSON.stringify(all).includes('@'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Send, caps, suppression, scheduling, idempotency —');
  let annId1;
  {
    const res1 = await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
      action: 'create', eventId: liquid.id, updateType: 'new_event',
      note: 'Liquid and rollers all night — see you down the front.',
    });
    const d1 = await res1.json();
    annId1 = d1.id;
    check('verified promoter sends (queued → sent inline)', res1.status === 200);
    const [a1] = await q(`select status, delivered_inapp from promoter_announcements where id = $1`, [annId1]);
    check('announcement delivered and marked sent',
      a1.status === 'sent' && a1.delivered_inapp === 5);
    check('in-app deliveries respect the off preference',
      (await notifCount(ids.steve, 'promoter_announcement')) === 0
      && (await notifCount(ids.jules, 'promoter_announcement', liquid.id)) === 1);
    const [em] = await q(`select subject from email_outbox where dedupe_key = $1`,
      [`ann:${annId1}:${ids.nadia}`]);
    check('templated email only to the email-opted follower',
      !!em && em.subject === 'New from Low End Collective: Liquid Rollers'
      && (await q(`select count(*)::int as n from email_outbox where dedupe_key like $1`,
        [`ann:${annId1}:%`]))[0].n === 1);

    await runJob();
    check('job re-runs are idempotent (no duplicate deliveries)',
      (await notifCount(ids.jules, 'promoter_announcement', liquid.id)) === 1
      && (await q(`select delivered_inapp from promoter_announcements where id = $1`, [annId1]))[0].delivered_inapp === 5);

    check('same event + same update type suppressed',
      (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'new_event',
      })).status === 409);
    check('a different update type is fine',
      (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'tickets_on_sale',
      })).status === 200);
    check('flood cap: third announcement in 7 days rejected',
      (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'final_tickets',
      })).status === 429);

    check('admin adjusts caps centrally',
      (await oshi.post('/api/admin/promoter-comms', { action: 'set_caps', per_promoter_per_7d: 3 })).status === 200);
    const sched = await (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
      action: 'create', eventId: liquid.id, updateType: 'final_tickets',
      scheduleFor: new Date(Date.now() + 3600_000).toISOString(),
    })).json();
    check('scheduling works', sched.status === 'scheduled');
    await runJob();
    check('scheduled announcements wait their turn',
      (await q(`select status, delivered_inapp from promoter_announcements where id = $1`,
        [sched.id]))[0].status === 'scheduled');
    check('promoter can cancel before send',
      (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
        action: 'cancel', announcementId: sched.id,
      })).status === 200);

    // Unfollow exclusion: maya leaves before the next send.
    await maya.post('/api/follow', { entityType: 'promoter', entityId: lowEnd.id, follow: false });
    const a4 = await (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
      action: 'create', eventId: liquid.id, updateType: 'lineup_update',
    })).json();
    check('unfollow immediately stops future announcements',
      (await q(`select count(*)::int as n from notifications
                 where member_id = $1 and announcement_id = $2`, [ids.maya, a4.id]))[0].n === 0
      && (await q(`select delivered_inapp from promoter_announcements where id = $1`, [a4.id]))[0].delivered_inapp === 4);

    // Unsubscribe overrides everything for email.
    await oshi.post('/api/admin/promoter-comms', { action: 'set_caps', per_promoter_per_7d: 10 });
    await q(`insert into email_suppressions (email, member_id, scope, source)
             select email, id, 'promoter_announcements', 'unsubscribe' from members where id = $1
             on conflict do nothing`, [ids.nadia]);
    const a5 = await (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
      action: 'create', eventId: liquid.id, updateType: 'sold_out',
    })).json();
    check('unsubscribed member still gets in-app, never email',
      (await q(`select count(*)::int as n from notifications
                 where member_id = $1 and announcement_id = $2`, [ids.nadia, a5.id]))[0].n === 1
      && (await q(`select count(*)::int as n from email_outbox
                    where dedupe_key = $1 and status not in ('suppressed')`,
        [`ann:${a5.id}:${ids.nadia}`]))[0].n === 0);

    check('audit trail records the lifecycle',
      (await q(`select count(distinct action)::int as n from promoter_announcement_audit
                 where promoter_id = $1 and action in ('created','queued','sent','scheduled','cancelled')`,
        [lowEnd.id]))[0].n === 5);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Announcement + close-friend/alert dedupe: ONE communication —');
  {
    const e7 = await publishEvent({
      title: 'V2F Hospital Takeover', startAt: inDays(14), genreSlugs: ['drum-and-bass'],
      promoterId: lowEnd.id,
    });
    check('publish already alerted the promoter follower',
      (await notifCount(ids.nadia, 'event_alert', e7)) === 1);
    await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
      action: 'create', eventId: e7, updateType: 'new_event',
    });
    const unread = await q(
      `select count(*)::int as n from notifications
        where member_id = $1 and event_id = $2 and read_at is null`, [ids.nadia, e7]);
    check('announcement folds into the existing alert — one unread, not two', unread[0].n === 1);
    const [merged] = await q(
      `select payload from notifications where member_id = $1 and event_id = $2 and type = 'event_alert'`,
      [ids.nadia, e7]);
    check('the alert now carries the announcement context',
      typeof merged.payload.announcement === 'string');
  }

  // -------------------------------------------------------------------------
  console.log('\n— Attribution analytics: honest, labeled —');
  {
    const src = `ann-${annId1.slice(0, 8)}`;
    await nadia.post('/api/track', { type: 'event_viewed', eventId: liquid.id, metadata: { src } });
    await nadia.fetch(`/out/${liquid.id}?src=${src}`);
    await nadia.post(`/api/events/${liquid.id}/action`, { rsvp: 'going' });
    await sleep(600);
    const list = await kwame.json(`/api/promoter/${lowEnd.id}/announcements`);
    const a1 = list.announcements.find((a) => a.id === annId1);
    check('attributed views + ticket clicks counted from the src token',
      a1.attributed_views === 1 && a1.attributed_ticket_clicks === 1);
    check('post-send RSVPs reported as "since sent", not causally claimed',
      a1.going_since >= 1);
    check('promoter API never leaks follower emails',
      !JSON.stringify(list).includes('@example.com') && !JSON.stringify(list).includes('@guestlist.net'));
    check('history page labels attribution honestly',
      (await kwame.html('/promoter/announce')).includes('FROM THIS ANNOUNCEMENT'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Follower dashboard: aggregates behind a privacy floor —');
  {
    await oshi.post('/api/admin/promoter-comms', { action: 'set_caps', min_aggregate: 99 });
    let stats = await kwame.json(`/api/promoter/${lowEnd.id}/followers`);
    check('below the floor, breakdowns disappear entirely',
      stats.top_cities.length === 0 && stats.top_genres.length === 0);
    await oshi.post('/api/admin/promoter-comms', { action: 'set_caps', min_aggregate: 2 });
    stats = await kwame.json(`/api/promoter/${lowEnd.id}/followers`);
    check('above the floor, aggregate cities appear (London ≥ 2)',
      stats.top_cities.some((c) => c.city === 'London' && c.n >= 2));
    check('totals + growth are real numbers', stats.total === 5 && stats.new_7d === 5);
    check('follower stats carry no identities or contact data',
      !JSON.stringify(stats).includes('@') && !JSON.stringify(stats).includes(names.nadia));
    check('followers dashboard page renders aggregate-only',
      (await kwame.html('/promoter/followers')).includes('aggregates only'));
    check('promoter overview shows follower growth',
      (await kwame.html('/promoter')).includes('this month'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Admin: pause promoter, pause channel, block, oversight —');
  {
    await oshi.post('/api/admin/promoter-comms', { action: 'pause_promoter', promoterId: lowEnd.id });
    check('paused promoter cannot send',
      (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'event_update',
      })).status === 403);
    await oshi.post('/api/admin/promoter-comms', { action: 'unpause_promoter', promoterId: lowEnd.id });

    await oshi.post('/api/admin/promoter-comms', { action: 'pause_all' });
    check('global pause stops the whole channel',
      (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
        action: 'create', eventId: liquid.id, updateType: 'event_update',
      })).status === 503);
    await oshi.post('/api/admin/promoter-comms', { action: 'unpause_all' });

    const blocked = await (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
      action: 'create', eventId: liquid.id, updateType: 'event_update',
      scheduleFor: new Date(Date.now() + 3600_000).toISOString(),
    })).json();
    await oshi.post('/api/admin/promoter-comms', { action: 'block_announcement', announcementId: blocked.id });
    await runJob();
    check('admin-blocked announcement never delivers',
      (await q(`select status, delivered_inapp from promoter_announcements where id = $1`,
        [blocked.id]))[0].status === 'blocked'
      && (await q(`select delivered_inapp from promoter_announcements where id = $1`,
        [blocked.id]))[0].delivered_inapp === 0);

    const adminPage = await oshi.html('/admin/promoter-comms');
    check('admin console shows announcements, promoters and the audit trail',
      adminPage.includes('Low End Collective') && adminPage.includes('Audit trail')
      && adminPage.includes('Central caps'));
    check('non-admins locked out of the console API',
      (await kwame.post('/api/admin/promoter-comms', { action: 'pause_all' })).status >= 401);
  }

  // -------------------------------------------------------------------------
  console.log('\n— International: São Paulo targets like London —');
  {
    const spEvent = await publishEvent({
      title: 'V2F Noite de Bass', startAt: inDays(20), city: 'São Paulo', country: 'Brazil',
      timezone: 'America/Sao_Paulo', genreSlugs: ['drum-and-bass'], promoterId: lowEnd.id,
    });
    const [sp] = await q(`select location_id from events where id = $1`, [spEvent]);
    check('the event auto-linked a canonical São Paulo location', !!sp.location_id);
    await q(`update members set home_location_id = $2 where id = $1`, [ids.lena, sp.location_id]);
    const prev = await (await kwame.post(`/api/promoter/${lowEnd.id}/announcements`, {
      action: 'preview', eventId: spEvent, audience: 'near_event',
    })).json();
    check('near-event targeting finds the São Paulo follower', prev.preview.targeted === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Blocks end everything —');
  {
    await jules.post('/api/connections', { action: 'block', memberId: ids.oshi });
    check('block severs the connection (and the close-friend mark with it)',
      ((await oshi.json('/api/connections')).connected ?? []).every((c) => c.member_id !== ids.jules));
    check('blocked pair can never be close friends',
      (await oshi.post('/api/connections', { action: 'close_friend', memberId: ids.jules })).status === 403);
    const page = await oshi.html(`/events/${liquid.slug}`);
    check('★ copy disappears from event pages', !page.includes(`★ ${names.jules} is going`));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Legacy surfaces untouched (spot checks) —');
  {
    check('events browse healthy', (await anon.fetch('/events')).status === 200);
    check('archive untouched', (await anon.fetch('/archive')).status === 200);
    // The email + privacy controls moved to Your profile (#130): every one of
    // them answers "who sees this, and when do you hear from us", which is a
    // question about the profile rather than about your taste. This check kept
    // asking /you and had been failing on main ever since.
    check('the settings render the new controls',
      (await nadia.html('/you/profile')).includes('Close friend event activity'));
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
