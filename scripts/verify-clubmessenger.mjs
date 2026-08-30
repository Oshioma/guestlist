// Club Messenger V1 verification (spec §24): presence lifecycle + expiry,
// visibility privacy (INCLUDING id-tampering attempts against private
// presence), friend = mutual follow only, room access + chat + rate limits,
// reports + admin moderation + suspension, pings + cooldowns, notifications
// + preferences, RSVP≠presence, analytics attribution.
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
    async post(url, body = {}) {
      return this.fetch(url, { method: 'POST', body: JSON.stringify(body) });
    },
  };
}

// Seeded relationships (scripts/seed.mjs):
//   oshi ⇄ nadia, oshi ⇄ kwame, oshi ⇄ jules, nadia ⇄ dan, nadia ⇄ kwame
//   priya → oshi (one-way), steve → nadia (one-way)
const anon = client();
const oshi = client();   // admin; nadia's friend
const nadia = client();  // the one who goes out
const dan = client();    // nadia's friend
const kwame = client();  // nadia's friend (arrival notifications OFF)
const jules = client();  // oshi's friend; Interested-not-Going case
const marcus = client(); // NOT nadia's friend — the attacker in tampering tests
const steve = client();  // one-way follower of nadia — must never count as friend

const mid = async (email) => (await q(`select id from members where email = $1`, [email]))[0].id;
const analyticsCount = (type, eventId) =>
  q(`select count(*)::int as n from analytics_events where event_type = $1 and ($2::uuid is null or event_id = $2)`, [type, eventId])
    .then((r) => r[0].n);

try {
  console.log('\n— Setup —');
  for (const [c, email] of [
    [oshi, 'oshi@guestlist.net'], [nadia, 'dev-nadia@example.com'],
    [dan, 'dev-dan@example.com'], [kwame, 'dev-kwame@example.com'],
    [jules, 'dev-jules@example.com'], [marcus, 'dev-marcus@example.com'],
    [steve, 'dev-steve@example.com'],
  ]) {
    check(`login ${email}`, (await c.login(email)) === 200);
  }
  const ids = {
    oshi: await mid('oshi@guestlist.net'),
    nadia: await mid('dev-nadia@example.com'),
    dan: await mid('dev-dan@example.com'),
    kwame: await mid('dev-kwame@example.com'),
    jules: await mid('dev-jules@example.com'),
    marcus: await mid('dev-marcus@example.com'),
    priya: await mid('dev-priya@example.com'),
    steve: await mid('dev-steve@example.com'),
  };

  // A live event happening tonight + one long-finished event.
  const [tonightEvent] = await q(
    `insert into events (title, slug, status, event_type, start_at, end_at, timezone, city, country, ticket_url)
     values ('Verify Warehouse Night', 'verify-warehouse-night', 'live', 'club_night',
             now() - interval '1 hour', now() + interval '5 hours', 'Europe/London',
             'London', 'United Kingdom', 'https://tickets.example/verify-warehouse')
     returning id`
  );
  const E = tonightEvent.id;
  const [pastEvent] = await q(
    `insert into events (title, slug, status, event_type, start_at, end_at, timezone)
     values ('Verify Bygone Rave', 'verify-bygone-rave', 'live', 'club_night',
             now() - interval '3 days', now() - interval '3 days' + interval '6 hours', 'Europe/London')
     returning id`
  );
  check('tonight + past events created', !!E && !!pastEvent.id);

  // kwame opts out of arrival notifications BEFORE anyone arrives.
  {
    const res = await kwame.fetch('/api/clubmessenger/preferences', {
      method: 'PATCH', body: JSON.stringify({ friend_arrivals: false }),
    });
    check('kwame turns friend-arrival notifications off', res.status === 200);
    const prefs = await (await kwame.fetch('/api/clubmessenger/preferences')).json();
    check('preferences round-trip (arrivals off, room_messages default OFF)',
      prefs.preferences.friend_arrivals === false && prefs.preferences.room_messages === false);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Presence lifecycle —');
  {
    check('anon cannot check in', (await anon.post('/api/clubmessenger/presence', { action: 'arrive', eventId: E })).status === 401);
    const res = await nadia.post('/api/clubmessenger/presence', {
      action: 'arrive', eventId: E, status: 'at the back bar 777',
    });
    const data = await res.json();
    check('nadia checks in (I’M HERE)', res.status === 200 && data.presence?.event_id === E);
    check('presence defaults to friends visibility', data.presence?.visibility === 'friends');

    const [action] = await q(`select rsvp from member_event_actions where member_id = $1 and event_id = $2`, [ids.nadia, E]);
    check('arriving auto-promotes RSVP to going', action?.rsvp === 'going');
    check('presence_started analytics recorded', (await analyticsCount('presence_started', E)) === 1);

    const [p] = await q(
      `select abs(extract(epoch from (expires_at - (select end_at + interval '2 hours' from events where id = $1)))) as drift
         from event_presence where member_id = $2 and event_id = $1`, [E, ids.nadia]);
    check('expiry defaults to event end + 2h grace', p && Number(p.drift) < 120);

    check('cannot check in to a finished event',
      (await nadia.post('/api/clubmessenger/presence', { action: 'arrive', eventId: pastEvent.id })).status === 400);
    check('cannot check in to a nonexistent event',
      (await nadia.post('/api/clubmessenger/presence', { action: 'arrive', eventId: '00000000-0000-0000-0000-000000000000' })).status === 404);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Presence privacy + id tampering —');
  {
    // The page renders only what the viewer may see; nadia's presence is
    // 'friends'-visible, and her status only renders for viewers who can
    // see her presence.
    const oshiHtml = await (await oshi.fetch('/clubmessenger')).text();
    check('friend (oshi) sees nadia out tonight', oshiHtml.includes('Nadia K'));
    const oshiRoom = await (await oshi.fetch(`/clubmessenger/events/${E}`)).text();
    check('friend sees her night status', oshiRoom.includes('at the back bar 777'));

    const marcusHtml = await (await marcus.fetch('/clubmessenger')).text();
    check('non-friend (marcus) sees NO trace of nadia on tonight page', !marcusHtml.includes('Nadia K'));

    const marcusRoom = await (await marcus.fetch(`/clubmessenger/events/${E}`)).text();
    check('non-friend never sees her status on the event page', !marcusRoom.includes('at the back bar 777'));

    // ID tampering: marcus pokes the APIs with nadia's and the event's real
    // ids. Nothing may confirm her presence.
    check('tampering: non-friend cannot ping her (403)',
      (await marcus.post('/api/clubmessenger/ping', { toMemberId: ids.nadia, eventId: E })).status === 403);
    check('tampering: one-way follower is NOT a friend (403)',
      (await steve.post('/api/clubmessenger/ping', { toMemberId: ids.nadia, eventId: E })).status === 403);
    check('tampering: non-attendee cannot read the room (403)',
      (await marcus.fetch(`/api/clubmessenger/rooms/${E}/messages`)).status === 403);
    check('tampering: anon gets 401 from the room', (await anon.fetch(`/api/clubmessenger/rooms/${E}/messages`)).status === 401);

    // Friends CAN interact.
    const danPing = await dan.post('/api/clubmessenger/ping', { toMemberId: ids.nadia, eventId: E });
    check('mutual friend can ping a visible friend', danPing.status === 200);
    check('ping cooldown enforced (429)',
      (await dan.post('/api/clubmessenger/ping', { toMemberId: ids.nadia, eventId: E })).status === 429);

    // Invisible hides from friends too.
    check('switch to invisible', (await nadia.post('/api/clubmessenger/presence', { action: 'visibility', eventId: E, visibility: 'invisible' })).status === 200);
    check('presence_visibility_changed recorded', (await analyticsCount('presence_visibility_changed', E)) >= 1);
    check('invisible: even a friend cannot ping (403)',
      (await kwame.post('/api/clubmessenger/ping', { toMemberId: ids.nadia, eventId: E })).status === 403);
    const oshiRoom2 = await (await oshi.fetch(`/clubmessenger/events/${E}`)).text();
    check('invisible: status hidden from friends', !oshiRoom2.includes('at the back bar 777'));

    // Back to friends-visible for the rest of the run.
    await nadia.post('/api/clubmessenger/presence', { action: 'visibility', eventId: E, visibility: 'friends' });
  }

  // -------------------------------------------------------------------------
  console.log('\n— Ping response —');
  {
    const [ping] = await q(`select id from club_pings where from_member = $1 and to_member = $2`, [ids.dan, ids.nadia]);
    check('tampering: someone else cannot answer her ping',
      (await marcus.post('/api/clubmessenger/ping', { pingId: ping.id, response: 'By the bar' })).status === 404);
    check('nadia answers with a quick reply',
      (await nadia.post('/api/clubmessenger/ping', { pingId: ping.id, response: 'By the bar' })).status === 200);
    const [answered] = await q(`select response, responded_at from club_pings where id = $1`, [ping.id]);
    check('response stored (venue-relative, no coordinates)', answered.response === 'By the bar' && !!answered.responded_at);
    check('ping analytics recorded', (await analyticsCount('ping_sent', E)) === 1 && (await analyticsCount('ping_response', E)) === 1);
    check('nadia got a friend_pinged_you notification',
      (await q(`select count(*)::int as n from notifications where member_id = $1 and type = 'friend_pinged_you' and actor_member_id = $2`, [ids.nadia, ids.dan]))[0].n === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Arrival notifications —');
  {
    const n = (member) => q(
      `select count(*)::int as n from notifications where member_id = $1 and type = 'friend_arrived' and actor_member_id = $2 and event_id = $3`,
      [member, ids.nadia, E]).then((r) => r[0].n);
    check('friend with default prefs was notified (dan)', (await n(ids.dan)) >= 1);
    check('friend who opted out was NOT notified (kwame)', (await n(ids.kwame)) === 0);
    check('non-friend was NOT notified (marcus)', (await n(ids.marcus)) === 0);
    check('one-way follower was NOT notified (priya)', (await n(ids.priya)) === 0);

    const list = await (await dan.fetch('/api/clubmessenger/notifications')).json();
    check('notification list shows the arrival', list.notifications.some((x) => x.type === 'friend_arrived' && x.actor_name === 'Nadia K'));
    await dan.post('/api/clubmessenger/notifications', { markAllRead: true });
    const after = await (await dan.fetch('/api/clubmessenger/notifications')).json();
    check('mark-all-read works', after.notifications.every((x) => x.read_at));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Room access + chat —');
  {
    // Interested is NOT enough (RSVP tiers matter).
    await jules.post(`/api/events/${E}/action`, { rsvp: 'interested' });
    check('Interested does not unlock the room (403)',
      (await jules.fetch(`/api/clubmessenger/rooms/${E}/messages`)).status === 403);
    const go = await jules.post(`/api/events/${E}/action`, { rsvp: 'going', source: 'clubmessenger' });
    check('Going from Club Messenger works', go.status === 200);
    check('going_from_clubmessenger attribution recorded', (await analyticsCount('going_from_clubmessenger', E)) === 1);
    check('Going unlocks the room', (await jules.fetch(`/api/clubmessenger/rooms/${E}/messages`)).status === 200);

    const sent = await nadia.post(`/api/clubmessenger/rooms/${E}/messages`, { body: 'meet by the smoke machine' });
    check('present member can post', sent.status === 200);
    const seen = await (await jules.fetch(`/api/clubmessenger/rooms/${E}/messages`)).json();
    check('room shows the message to another attendee', seen.messages.some((m) => m.body === 'meet by the smoke machine'));
    check('room_message_sent analytics recorded', (await analyticsCount('room_message_sent', E)) === 1);
    check('tampering: non-attendee cannot post (403)',
      (await marcus.post(`/api/clubmessenger/rooms/${E}/messages`, { body: 'let me in' })).status === 403);
    check('empty message rejected', (await nadia.post(`/api/clubmessenger/rooms/${E}/messages`, { body: '  ' })).status === 400);
    check('oversized message rejected', (await nadia.post(`/api/clubmessenger/rooms/${E}/messages`, { body: 'x'.repeat(501) })).status === 400);

    let limited = 0;
    for (let i = 0; i < 13; i++) {
      const r = await jules.post(`/api/clubmessenger/rooms/${E}/messages`, { body: `spam ${i}` });
      if (r.status === 429) limited++;
    }
    check('rate limit kicks in inside a minute', limited >= 1);
    // Clear the spam so later posts in this run aren't rate-limited.
    await q(`delete from event_room_messages where member_id = $1 and body like 'spam %'`, [ids.jules]);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Reports + moderation —');
  {
    const [msg] = await q(`select id from event_room_messages where event_id = $1 and member_id = $2 and body = 'meet by the smoke machine'`, [E, ids.nadia]);
    check('attendee can report a message',
      (await jules.post(`/api/clubmessenger/rooms/${E}/messages/${msg.id}/report`, { reason: 'testing reports' })).status === 200);
    await jules.post(`/api/clubmessenger/rooms/${E}/messages/${msg.id}/report`, {});
    const [counted] = await q(`select report_count from event_room_messages where id = $1`, [msg.id]);
    check('duplicate report does not double-count', counted.report_count === 1);

    check('non-admin cannot moderate',
      (await jules.post('/api/admin/clubmessenger', { action: 'remove_message', messageId: msg.id })).status === 403);
    check('admin removes the message',
      (await oshi.post('/api/admin/clubmessenger', { action: 'remove_message', messageId: msg.id })).status === 200);
    const room = await (await jules.fetch(`/api/clubmessenger/rooms/${E}/messages`)).json();
    check('removed message disappears from the room', !room.messages.some((m) => m.id === msg.id));
    check('removal is audit-logged',
      (await q(`select count(*)::int as n from audit_log where action = 'room_message_removed' and event_id = $1`, [E]))[0].n === 1);

    check('admin page renders', (await oshi.fetch('/admin/clubmessenger')).status === 200);

    // Suspension shuts the club features down for that member.
    check('admin suspends jules', (await oshi.post('/api/admin/clubmessenger', { action: 'suspend', memberId: ids.jules })).status === 200);
    check('suspended member cannot post (403)',
      (await jules.post(`/api/clubmessenger/rooms/${E}/messages`, { body: 'hello?' })).status === 403);
    check('suspended member cannot check in (403)',
      (await jules.post('/api/clubmessenger/presence', { action: 'arrive', eventId: E })).status === 403);
    check('admin unsuspends jules', (await oshi.post('/api/admin/clubmessenger', { action: 'unsuspend', memberId: ids.jules })).status === 200);
    check('unsuspended member can post again',
      (await jules.post(`/api/clubmessenger/rooms/${E}/messages`, { body: 'back in the room' })).status === 200);
    check('suspension audit-logged',
      (await q(`select count(*)::int as n from audit_log where action in ('member_club_suspended','member_club_unsuspended')`))[0].n === 2);
  }

  // -------------------------------------------------------------------------
  console.log('\n— RSVP is never presence —');
  {
    const [row] = await q(`select count(*)::int as n from event_presence where member_id = $1 and event_id = $2`, [ids.jules, E]);
    check('Going RSVP creates NO presence row', row.n === 0);
    const oshiHtml = await (await oshi.fetch('/clubmessenger')).text();
    check('tonight page keeps here/going separate', oshiHtml.includes('here now') || oshiHtml.includes('going'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Expiry + leave —');
  {
    await q(`update event_presence set expires_at = now() - interval '1 second' where member_id = $1 and event_id = $2`, [ids.nadia, E]);
    const oshiRoom = await (await oshi.fetch(`/clubmessenger/events/${E}`)).text();
    check('expired presence disappears (status marker gone)', !oshiRoom.includes('at the back bar 777'));
    check('expired: even a friend cannot ping (403)',
      (await kwame.post('/api/clubmessenger/ping', { toMemberId: ids.nadia, eventId: E })).status === 403);

    const rearrive = await nadia.post('/api/clubmessenger/presence', { action: 'arrive', eventId: E, visibility: 'event' });
    check('re-arriving after expiry works (upsert)', rearrive.status === 200);
    // 'event' visibility: people going/here see her — outsiders still don't.
    const julesRoom = await (await jules.fetch(`/clubmessenger/events/${E}`)).text();
    check('event-visible presence shows to a Going attendee', julesRoom.includes('Here now (1)'));
    const marcusRoom = await (await marcus.fetch(`/clubmessenger/events/${E}`)).text();
    check('event-visible presence still hidden from a non-attendee', marcusRoom.includes('Here now (0)'));
    await marcus.post(`/api/events/${E}/action`, { rsvp: 'going' });
    const marcusPing = await marcus.post('/api/clubmessenger/ping', { toMemberId: ids.nadia, eventId: E });
    check('event visibility never makes a non-friend pingable', marcusPing.status === 403);

    const leave = await nadia.post('/api/clubmessenger/presence', { action: 'leave', eventId: E });
    const left = await leave.json();
    check('leave clears presence', leave.status === 200 && left.presence === null);
    check('presence_ended analytics recorded', (await analyticsCount('presence_ended', E)) >= 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Member follows / friendship API —');
  {
    check('cannot follow yourself',
      (await nadia.post('/api/follow', { entityType: 'member', entityId: ids.nadia })).status === 400);
    check('unknown member 404',
      (await nadia.post('/api/follow', { entityType: 'member', entityId: '00000000-0000-0000-0000-000000000000' })).status === 404);
    const oneWay = await (await marcus.post('/api/follow', { entityType: 'member', entityId: ids.nadia })).json();
    check('one-way follow is not mutual', oneWay.mutual === false);
    const back = await (await nadia.post('/api/follow', { entityType: 'member', entityId: ids.marcus })).json();
    check('follow-back makes it mutual (friends)', back.mutual === true);
    // undo so earlier assumptions hold for reruns
    await marcus.post('/api/follow', { entityType: 'member', entityId: ids.nadia, follow: false });
    await nadia.post('/api/follow', { entityType: 'member', entityId: ids.marcus, follow: false });
    const attendees = await (await oshi.fetch(`/api/events/${E}/attendees`)).json();
    check('attendees API annotates friendship', attendees.going.some((m) => typeof m.is_friend === 'boolean'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— Analytics surface —');
  {
    const trackRes = await nadia.post('/api/track', { type: 'clubmessenger_open', metadata: {} });
    check('client can log clubmessenger_open', trackRes.status === 200 && (await analyticsCount('clubmessenger_open', null)) >= 1);
    check('client CANNOT spoof server-side types (presence_started)',
      (await nadia.post('/api/track', { type: 'presence_started', metadata: {} })).status === 400);

    const out = await nadia.fetch(`/out/${E}?src=clubmessenger`);
    check('ticket redirect works from club surface', out.status >= 300 && out.status < 400);
    check('ticket_click_from_clubmessenger attribution recorded',
      (await analyticsCount('ticket_click_from_clubmessenger', E)) === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— Pages render —');
  {
    check('/clubmessenger renders for members', (await oshi.fetch('/clubmessenger')).status === 200);
    const anonPage = await anon.fetch('/clubmessenger');
    check('/clubmessenger renders a join prompt for anon',
      anonPage.status === 200 && (await anonPage.text()).includes('Join Guestlist'));
    check('event room page renders', (await nadia.fetch(`/clubmessenger/events/${E}`)).status === 200);
    const heatHtml = await (await oshi.fetch('/clubmessenger')).text();
    check('honest heat: tiny numbers earn no Heating up badge', !heatHtml.includes('Heating up'));
    const detail = await (await nadia.fetch('/events/verify-warehouse-night')).text();
    check('event detail shows Tonight on Guestlist module', detail.includes('Tonight on Guestlist'));
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
