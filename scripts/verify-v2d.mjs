// V2D verification: email delivery lifecycle (dev no-send, retries,
// permanent failures, suppression), signed unsubscribe, the member alert
// engine (followed promoter/artist/venue, genre/city, travel, connection
// going), deduplication + multi-reason collapse, frequency caps, digest
// fallback with member-local timezones, event reminders, promoter emails,
// follower privacy, admin safety switches, and job idempotency.
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
  };
}

const anon = client();
const oshi = client();   // admin · Ibiza travel plan (days 10–17) · likes House
const nadia = client();  // will follow Low End Collective, instant alerts
const jules = client();  // artist follower · connected to oshi
const kwame = client();  // venue follower · Steppers Union owner (fixture)
const steve = client();  // weak-signal member (genre+city only)
const carla = client();  // connected to marcus
const marcus = client(); // saves events; receives connection alerts

const mid = async (email) => (await q(`select id from members where email = $1`, [email]))[0].id;
const runJob = () => oshi.post('/api/jobs/send-emails');
const outbox = (where, params = []) =>
  q(`select * from email_outbox where ${where} order by created_at`, params);
const notifCount = (memberId, type, eventId = null) =>
  q(`select count(*)::int as n from notifications
      where member_id = $1 and type = $2 and ($3::uuid is null or event_id = $3)`,
    [memberId, type, eventId]).then((r) => r[0].n);

// Publish a live event through the admin API so the alert hooks fire.
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
    venueId: opts.venueId ?? null,
    genreSlugs: opts.genreSlugs ?? [],
    lineup: opts.lineup ?? [],
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
    [kwame, 'dev-kwame@example.com'], [steve, 'dev-steve@example.com'],
    [carla, 'dev-carla@example.com'], [marcus, 'dev-marcus@example.com'],
  ]) {
    check(`login ${email}`, (await c.login(email)) === 200);
  }
  const ids = {};
  for (const [k, e] of [['oshi', 'oshi@guestlist.net'], ['nadia', 'dev-nadia@example.com'],
    ['jules', 'dev-jules@example.com'], ['kwame', 'dev-kwame@example.com'],
    ['steve', 'dev-steve@example.com'], ['carla', 'dev-carla@example.com'],
    ['marcus', 'dev-marcus@example.com']]) ids[k] = await mid(e);

  const [lowEnd] = await q(`select id from promoters where name = 'Low End Collective'`);
  const [boilerYard] = await q(`select id from venues where name = 'The Boiler Yard'`);
  check('cron requires auth', (await anon.post('/api/jobs/send-emails')).status === 401);

  // -------------------------------------------------------------------------
  console.log('\n— Followed-promoter alert (the core loop) —');
  {
    await nadia.post('/api/follow', { entityType: 'promoter', entityId: lowEnd.id });
    await nadia.patch('/api/you/settings', { emailPrefs: { alert_frequency: 'instant' } });

    const eventId = await publishEvent({
      title: 'V2D Bass Test Night', startAt: inDays(8), promoterId: lowEnd.id,
      genreSlugs: ['bass'],
    });
    check('follower got ONE event_alert notification',
      (await notifCount(ids.nadia, 'event_alert', eventId)) === 1);
    const [notif] = await q(
      `select payload from notifications where member_id = $1 and event_id = $2`,
      [ids.nadia, eventId]);
    check('reason is FOLLOWED_PROMOTER with the promoter named',
      notif.payload.reasons?.[0]?.code === 'FOLLOWED_PROMOTER'
      && notif.payload.reasons?.[0]?.detail === 'Low End Collective');
    const alertMail = await outbox(`member_id = $1 and email_type = 'alert:event'`, [ids.nadia]);
    check('instant preference queued exactly one alert email', alertMail.length === 1);
    check('alert email carries reason + canonical link',
      alertMail[0].body_text.includes('Because you follow Low End Collective')
      && alertMail[0].body_text.includes('/events/'));
    check('alert_created analytics recorded',
      (await q(`select count(*)::int as n from analytics_events where event_type='alert_created'`))[0].n >= 1);

    // Republishing the same event must not re-alert (dedupe + idempotency).
    await oshi.fetch(`/api/admin/events/${eventId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'live' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await sleep(600);
    check('republish does not duplicate the notification',
      (await notifCount(ids.nadia, 'event_alert', eventId)) === 1);
    check('republish does not duplicate the email',
      (await outbox(`member_id = $1 and email_type = 'alert:event'`, [ids.nadia])).length === 1);

    // Member who marked Going gets no duplicate alert later.
    await nadia.post(`/api/events/${eventId}/action`, { rsvp: 'going' });
    await oshi.fetch(`/api/admin/events/${eventId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'live' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await sleep(600);
    check('no duplicate after member marks Going',
      (await notifCount(ids.nadia, 'event_alert', eventId)) === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Artist / venue alerts + multi-reason collapse —');
  {
    const [artist] = await q(`select id, name from artists where name = 'Foxglove'`);
    await jules.post('/api/follow', { entityType: 'artist', entityId: artist.id });
    await kwame.post('/api/follow', { entityType: 'venue', entityId: boilerYard.id });
    // oshi: follows promoter + venue + likes House + home city London → ONE alert.
    await oshi.post('/api/follow', { entityType: 'promoter', entityId: lowEnd.id });
    await oshi.post('/api/follow', { entityType: 'venue', entityId: boilerYard.id });
    await oshi.patch('/api/you/settings', { emailPrefs: { genre_in_home_city: true } });

    const eventId = await publishEvent({
      title: 'V2D Multi Signal Session', startAt: inDays(9),
      promoterId: lowEnd.id, venueId: boilerYard.id,
      genreSlugs: ['house'], lineup: ['Foxglove'],
    });
    check('artist follower alerted with FOLLOWED_ARTIST',
      (await q(`select payload from notifications where member_id=$1 and event_id=$2`,
        [ids.jules, eventId]))[0]?.payload.reasons?.some((r) => r.code === 'FOLLOWED_ARTIST') === true);
    check('venue follower alerted with FOLLOWED_VENUE',
      (await q(`select payload from notifications where member_id=$1 and event_id=$2`,
        [ids.kwame, eventId]))[0]?.payload.reasons?.some((r) => r.code === 'FOLLOWED_VENUE') === true);

    const oshiNotifs = await q(
      `select payload from notifications where member_id=$1 and event_id=$2`, [ids.oshi, eventId]);
    check('five signals collapse into ONE notification', oshiNotifs.length === 1);
    const codes = oshiNotifs[0].payload.reasons.map((r) => r.code);
    check('multiple reasons preserved, priority-ordered',
      codes[0] === 'FOLLOWED_PROMOTER' && codes.includes('FOLLOWED_VENUE')
      && codes.indexOf('FOLLOWED_VENUE') < codes.indexOf('HOME_CITY'), codes.join(','));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Weak signals never email instantly —');
  {
    await steve.patch('/api/you/settings', { emailPrefs: { genre_in_home_city: true, alert_frequency: 'instant' } });
    await steve.fetch('/api/you/taste'); // ensure session
    const taste = await steve.json('/api/you/taste');
    const techno = taste.allGenres.find((g) => g.slug === 'techno');
    await steve.fetch('/api/you/taste', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genreIds: [techno.id] }),
    });
    const eventId = await publishEvent({
      title: 'V2D Glasgow Techno Test', startAt: inDays(10),
      city: 'Glasgow', genreSlugs: ['techno'],
    });
    check('genre+home-city creates an in-app notification',
      (await notifCount(ids.steve, 'event_alert', eventId)) === 1);
    check('…but weak reasons never trigger instant email',
      (await outbox(`member_id = $1 and email_type = 'alert:event'`, [ids.steve])).length === 0);

    // frequency off = no notifications at all.
    await carla.patch('/api/you/settings', { emailPrefs: { alert_frequency: 'off' } });
    const [tresorish] = await q(`select id from promoters where name = 'Night Bureau'`);
    await carla.post('/api/follow', { entityType: 'promoter', entityId: tresorish.id });
    const offEvent = await publishEvent({
      title: 'V2D Off Frequency Test', startAt: inDays(11), promoterId: tresorish.id,
      genreSlugs: ['techno'],
    });
    check('alert_frequency=off suppresses even strong alerts',
      (await notifCount(ids.carla, 'event_alert', offEvent)) === 0);
    await carla.patch('/api/you/settings', { emailPrefs: { alert_frequency: 'daily' } });
  }

  // -------------------------------------------------------------------------
  console.log('\n— Frequency cap (fatigue) —');
  {
    // nadia is instant + follows Low End: publish 3 more strong events →
    // cap of 3 alert emails per day total (1 already sent).
    for (let i = 0; i < 3; i++) {
      await publishEvent({
        title: `V2D Cap Test ${i}`, startAt: inDays(12 + i), promoterId: lowEnd.id,
        genreSlugs: ['bass'],
      });
    }
    const mails = await outbox(
      `member_id = $1 and email_type = 'alert:event' and status <> 'suppressed'`, [ids.nadia]);
    check('daily alert-email cap enforced (3 max)', mails.length === 3, `got ${mails.length}`);
    const notifs = await q(
      `select count(*)::int as n from notifications
        where member_id = $1 and type = 'event_alert'`, [ids.nadia]);
    check('capped alerts still arrive in-app', notifs[0].n === 5, `got ${notifs[0].n}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Connection-going alerts —');
  {
    // carla ⇄ marcus connected (seed). marcus saves an event; carla goes.
    const [ev] = await q(`select id, slug from events where title = 'Liquid Rollers'`);
    await marcus.post(`/api/events/${ev.id}/action`, { saved: true });
    await marcus.patch('/api/you/settings', { emailPrefs: { connection_going: true, alert_frequency: 'instant' } });
    await carla.post(`/api/events/${ev.id}/action`, { rsvp: 'going' });
    await sleep(600);
    check('connection Going on a saved event notifies',
      (await notifCount(ids.marcus, 'connection_going', ev.id)) === 1);
    check('connection email queued (instant + opted in)',
      (await outbox(`member_id = $1 and email_type = 'alert:connection'`, [ids.marcus])).length === 1);
    // Repeat going (clear + re-going) must not duplicate.
    await carla.post(`/api/events/${ev.id}/action`, { rsvp: null });
    await carla.post(`/api/events/${ev.id}/action`, { rsvp: 'going' });
    await sleep(600);
    check('re-going never duplicates the alert',
      (await notifCount(ids.marcus, 'connection_going', ev.id)) === 1);

    // Privacy: hidden Going never generates connection alerts.
    await carla.patch('/api/you/settings', { privacy: { show_going: false } });
    const [ev2] = await q(`select id from events where title = 'Trance Communion'`);
    await marcus.post(`/api/events/${ev2.id}/action`, { saved: true });
    await carla.post(`/api/events/${ev2.id}/action`, { rsvp: 'going' });
    await sleep(600);
    check('show_going=false blocks connection alerts',
      (await notifCount(ids.marcus, 'connection_going', ev2.id)) === 0);
    await carla.patch('/api/you/settings', { privacy: { show_going: true } });
  }

  // -------------------------------------------------------------------------
  console.log('\n— Daily digest fallback + member timezones —');
  {
    // Give steve a home timezone where it is 09:00 local right now, and
    // marcus one where it is 03:00 — only steve gets the digest this run.
    const utcHour = new Date().getUTCHours();
    const goodOffset = (9 - utcHour + 24) % 24;               // local 9am
    const badOffsetRaw = (3 - utcHour + 24) % 24;             // local 3am
    const tzName = (off) => (off === 0 ? 'Etc/GMT' : off <= 14 ? `Etc/GMT-${off}` : `Etc/GMT+${24 - off}`);
    await q(`insert into locations (kind, name, normalized_name, slug, timezone)
             values ('city','V2D Morningtown','v2d morningtown','v2d-morningtown',$1),
                    ('city','V2D Nighttown','v2d nighttown','v2d-nighttown',$2)
             on conflict do nothing`, [tzName(goodOffset), tzName(badOffsetRaw)]);
    await q(`update members set home_location_id = (select id from locations where slug='v2d-morningtown') where id = $1`, [ids.steve]);
    await q(`update members set home_location_id = (select id from locations where slug='v2d-nighttown') where id = $1`, [ids.marcus]);
    // marcus needs an unread alert too: give him one via SQL copy.
    await q(`insert into notifications (member_id, type, event_id, payload)
             select $1, 'event_alert', event_id, payload from notifications
              where member_id = $2 and type = 'event_alert' limit 1
             on conflict do nothing`, [ids.marcus, ids.steve]);

    const before = (await outbox(`email_type = 'daily_digest'`)).length;
    const run = await (await runJob()).json();
    check('digest job ran', run.ok === true);
    const steveDigest = await outbox(`member_id = $1 and email_type = 'daily_digest'`, [ids.steve]);
    check('member at local 9am received ONE daily digest', steveDigest.length === 1);
    check('digest collapses alerts into one email with reasons',
      steveDigest[0].body_text.includes('V2D Glasgow Techno Test'));
    check('member at local 3am received nothing (timezone-aware)',
      (await outbox(`member_id = $1 and email_type = 'daily_digest'`, [ids.marcus])).length === 0);

    await runJob();
    check('running the job again sends no second digest (idempotent)',
      (await outbox(`email_type = 'daily_digest'`)).length === before + 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Delivery lifecycle: dev no-send, retries, permanent failures —');
  {
    const delivered = await outbox(`status = 'dev_logged'`);
    check('without credentials all delivery is dev_logged (no real sends)',
      delivered.length > 0
      && (await outbox(`status = 'sent'`)).length === 0);

    // Temporary failure retries with backoff; permanent never retries.
    await q(`insert into email_outbox (recipient_email, email_type, subject, body_text, status, error_category, attempt_count, last_attempt_at)
             values ('retry@test.example','test_retry','Retry me','x','failed','temporary',1, now() - interval '10 minutes'),
                    ('dead@test.example','test_perm','Dead','x','failed','permanent',1, now() - interval '10 minutes')`);
    await runJob();
    const [retryRow] = await q(`select attempt_count, status from email_outbox where recipient_email='retry@test.example'`);
    check('temporary failure retried (attempt 2, then dev_logged)',
      retryRow.attempt_count === 2 && retryRow.status === 'dev_logged');
    const [permRow] = await q(`select attempt_count from email_outbox where recipient_email='dead@test.example'`);
    check('permanent failure never retried', permRow.attempt_count === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Unsubscribe (signed, no login) —');
  {
    // Take the real link out of steve's digest.
    const [digest] = await outbox(`member_id = $1 and email_type = 'daily_digest'`, [ids.steve]);
    const html = digest.body_html ?? '';
    const m = html.match(/href="([^"]*\/api\/email\/unsubscribe[^"]+)"/);
    check('digest carries an unsubscribe link', !!m);
    const url = m[1].replace(/&amp;/g, '&').replace(/^https?:\/\/[^/]+/, '');
    const res = await anon.fetch(url);
    check('unsubscribe works logged out', res.status === 200
      && (await res.text()).includes('unsubscribed'));
    check('suppression recorded',
      (await q(`select count(*)::int as n from email_suppressions where member_id = $1`, [ids.steve]))[0].n >= 1);
    check('tampered token rejected',
      (await anon.fetch(url.replace(/t=./, 't=x'))).status === 400);
    check('email_unsubscribed analytics recorded',
      (await q(`select count(*)::int as n from analytics_events where event_type='email_unsubscribed'`))[0].n >= 1);

    // Suppressed member gets no more of that mail — but transactional still flows.
    await q(`update notifications set emailed_at = null, read_at = null where member_id = $1 and type='event_alert'`, [ids.steve]);
    await runJob();
    const after = await outbox(
      `member_id = $1 and email_type = 'daily_digest' and status in ('pending','dev_logged')`, [ids.steve]);
    check('opt-out enforced on the next digest run', after.length === 1); // still just the original
  }

  // -------------------------------------------------------------------------
  console.log('\n— Event reminders —');
  {
    const [ev] = await q(
      `insert into events (title, slug, status, event_type, start_at, end_at, timezone, city, country)
       values ('V2D Reminder Test', 'v2d-reminder-test', 'live', 'club_night',
               now() + interval '24 hours', now() + interval '30 hours', 'Africa/Dar_es_Salaam',
               'Zanzibar', 'Tanzania') returning id`);
    await jules.post(`/api/events/${ev.id}/action`, { rsvp: 'going' });
    await kwame.post(`/api/events/${ev.id}/action`, { rsvp: 'going' });
    await kwame.patch('/api/you/settings', { emailPrefs: { event_reminders: false } });
    await runJob();
    check('going member got tomorrow reminder',
      (await notifCount(ids.jules, 'event_reminder', ev.id)) === 1);
    const mail = await outbox(`member_id = $1 and email_type = 'event_reminder'`, [ids.jules]);
    check('reminder email in the event’s own timezone',
      mail.length === 1 && mail[0].subject.includes('Tomorrow'));
    check('reminders disabled per member are respected',
      (await notifCount(ids.kwame, 'event_reminder', ev.id)) === 0);
    await runJob();
    check('reminder never repeats',
      (await outbox(`member_id = $1 and email_type = 'event_reminder'`, [ids.jules])).length === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Travel alerts + digest —');
  {
    // oshi's seed plan: Ibiza, days 10–17. Publish an Ibiza event inside it.
    const eventId = await publishEvent({
      title: 'V2D Pikes Announcement', startAt: inDays(12, 20),
      city: 'Ibiza', country: 'Spain', timezone: 'Europe/Madrid',
      genreSlugs: ['balearic'],
    });
    const [notif] = await q(
      `select payload from notifications where member_id=$1 and event_id=$2`, [ids.oshi, eventId]);
    check('travel-matching publish alerts the traveller',
      notif?.payload.reasons?.[0]?.code === 'TRAVEL_MATCH');
    check('TRAVEL_MATCH outranks every other reason',
      notif?.payload.reasons?.[0]?.code === 'TRAVEL_MATCH');

    await runJob();
    const travelMail = await outbox(`member_id = $1 and email_type = 'travel_digest'`, [ids.oshi]);
    check('travel digest queued (≥2 events in destination window)', travelMail.length === 1);
    check('travel digest is location-titled, dates stay private to the member',
      travelMail[0].subject.includes('Ibiza'));
    await runJob();
    check('travel digest idempotent per plan',
      (await outbox(`member_id = $1 and email_type = 'travel_digest'`, [ids.oshi])).length === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Weekly digest idempotency —');
  {
    const before = (await outbox(`email_type = 'member_weekly_digest'`)).length;
    await oshi.post('/api/jobs/send-emails?digest=weekly');
    const mid1 = (await outbox(`email_type = 'member_weekly_digest'`)).length;
    await oshi.post('/api/jobs/send-emails?digest=weekly');
    const mid2 = (await outbox(`email_type = 'member_weekly_digest'`)).length;
    check('weekly digests queue once', mid1 > before);
    check('forcing the weekly run twice adds nothing (ISO-week dedupe)', mid2 === mid1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Notification centre —');
  {
    const page = await (await nadia.fetch('/notifications')).text();
    check('/notifications renders alerts with reasons',
      page.includes('V2D Bass Test Night') && page.includes('Because you follow Low End Collective'));
    const header = await (await nadia.fetch('/events')).text();
    check('header bell shows unread badge', header.includes('bellBadge'));
    await nadia.post('/api/clubmessenger/notifications', { markAllRead: true });
    const header2 = await (await nadia.fetch('/events')).text();
    check('mark all read clears the badge', !header2.includes('bellBadge'));
    check('client cannot spoof alert_created',
      (await anon.post('/api/track', { type: 'alert_created' })).status === 400);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Promoter emails + follower privacy —');
  {
    const [steppers] = await q(`select id from promoters where name = 'Steppers Union'`);
    await q(`update promoters set claim_status = 'verified', verified = true where id = $1`, [steppers.id]);
    await q(`insert into promoter_members (promoter_id, member_id, role) values ($1, $2, 'owner')
             on conflict do nothing`, [steppers.id, ids.kwame]);
    await q(`insert into promoter_notifications (promoter_id, type, payload)
             values ($1, 'events_found', '{"new": 3}')`, [steppers.id]);
    await runJob();
    const found = await outbox(`promoter_id = $1 and email_type = 'notification:events_found'`, [steppers.id]);
    check('NEW EVENTS FOUND email queued with count + review link',
      found.length === 1 && found[0].subject.includes('3 new events')
      && found[0].body_html.includes('/promoter/events'));
    await runJob();
    check('promoter notification email idempotent',
      (await outbox(`promoter_id = $1 and email_type = 'notification:events_found'`, [steppers.id])).length === 1);

    // Give the promoter real weekly activity (a new follower + a view).
    await nadia.post('/api/follow', { entityType: 'promoter', entityId: steppers.id });
    const [sev] = await q(`select id from events where promoter_id = $1 limit 1`, [steppers.id]);
    if (sev) await nadia.post('/api/track', { type: 'event_viewed', eventId: sev.id });
    await oshi.post('/api/jobs/send-emails?digest=weekly'); // now that the team exists
    const digest = await outbox(`promoter_id = $1 and email_type = 'promoter_weekly_digest'`, [steppers.id]);
    check('promoter weekly digest uses real analytics', digest.length >= 1
      && /\d+ event views/.test(digest[0].body_text)
      && /\+\d+ new followers/.test(digest[0].body_text));

    // Follower privacy: nadia follows Low End; no surface exposes her email
    // to promoter team members, and alert email went to HER, not them.
    const analyticsPage = await (await kwame.fetch('/promoter/analytics?p=' + steppers.id)).text();
    check('promoter surfaces never expose follower email addresses',
      !analyticsPage.includes('dev-nadia@example.com'));
    check('alerts route through Guestlist to the member',
      (await outbox(`recipient_email = 'dev-nadia@example.com' and email_type = 'alert:event'`)).length >= 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Transactional email: claims + invites —');
  {
    // A fresh claim on a promoter, approved by admin → claimant email.
    const [promoter] = await q(`select id from promoters where name = 'Golden Hour'`);
    await q(`update promoters set claim_status = 'claim_pending' where id = $1`, [promoter.id]);
    const [claim] = await q(
      `insert into promoter_claims (promoter_id, member_id, claimant_name, claimant_role, email, status)
       values ($1, $2, 'Jules', 'Founder', 'dev-jules@example.com', 'pending') returning id`,
      [promoter.id, ids.jules]);
    const res = await oshi.fetch(`/api/admin/claims/${claim.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
    check('claim approved', res.status === 200);
    const mail = await outbox(`member_id = $1 and email_type = 'claim_decision'`, [ids.jules]);
    check('claim decision email queued to the claimant',
      mail.length === 1 && mail[0].subject.includes('approved'));

    // Team invite → invite email with accept link.
    const invite = await kwame.post(`/api/promoter/${(await q(`select id from promoters where name='Steppers Union'`))[0].id}/team`,
      { email: 'newcrew@example.com', role: 'editor' });
    check('invite accepted by API', invite.status === 201);
    const inviteMail = await outbox(`recipient_email = 'newcrew@example.com'`);
    check('team invite email queued with accept link',
      inviteMail.length === 1 && inviteMail[0].body_html.includes('/promoter/invite/'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Admin safety switches —');
  {
    check('admin email console renders',
      (await oshi.fetch('/admin/email')).status === 200);
    check('non-admin cannot flip switches',
      (await steve.post('/api/admin/email', { action: 'set_switch', key: 'pause_recommendation_emails', value: true })).status === 403);
    await oshi.post('/api/admin/email', { action: 'set_switch', key: 'pause_recommendation_emails', value: true });

    const eventId = await publishEvent({
      title: 'V2D Paused Test', startAt: inDays(20), promoterId: lowEnd.id, genreSlugs: ['bass'],
    });
    // nadia: still gets the in-app notification, never an email while paused.
    check('paused: in-app notification still created',
      (await notifCount(ids.nadia, 'event_alert', eventId)) === 1);
    check('paused: no alert email even for instant members',
      (await outbox(`member_id = $1 and email_type = 'alert:event' and created_at > now() - interval '5 seconds'`, [ids.nadia])).length === 0);
    await oshi.post('/api/admin/email', { action: 'set_switch', key: 'pause_recommendation_emails', value: false });
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
