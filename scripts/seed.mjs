// Development seed data — FICTIONAL events, venues, promoters, artists and
// members for evaluating the UX. Nothing here represents a real upcoming
// event. Dates are generated relative to "now" so the This Weekend tab and
// past-event edge cases always have content.
//
// Usage: node scripts/seed.mjs   (idempotent-ish: clears platform tables first)

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (existsSync(path.join(root, '.env.local'))) {
  for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const q = (text, params = []) => client.query(text, params).then((r) => r.rows);

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const STOP = new Set(['the','a','an','at','of','and','presents','present','pres','with','w','feat','featuring','ft','x']);
const normTitle = (t) =>
  t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((w) => w && !STOP.has(w)).join(' ');

// --- wipe platform data (dev only) ---
await q(`truncate analytics_events, event_classifications, member_event_actions,
  event_submissions, event_images, event_artists, event_genres, events,
  event_sources, artists, promoters, venues, member_follows, member_genres,
  auth_sessions, members, genres, locations, scene_entities, email_outbox
  restart identity cascade`);

// --- genres ---
// Global taxonomy — an explicit editorial decision, not AI expansion.
// New scenes still arrive through the controlled genre-suggestion workflow.
const parentGenres = [
  'House', 'Drum & Bass', 'Jungle', 'Techno', 'Garage', 'Disco',
  'Trance', 'Hardcore', 'Reggae & Dub', 'Bass', 'Breaks', 'Balearic',
  'Amapiano', 'Afrobeats', 'Dancehall', 'Latin Electronic',
];
const subGenres = {
  'Drum & Bass': ['Liquid', 'Jump Up', 'Rollers', 'Neurofunk'],
  House: ['Deep House', 'Vocal House', 'Classic House', 'Funky House', 'Progressive House', 'Afro House'],
  Garage: ['UK Garage', '2-Step', 'Speed Garage'],
  Jungle: ['Old School Jungle', 'Ragga Jungle'],
  Techno: ['Melodic Techno', 'Hard Techno', 'Gqom'],
  'Latin Electronic': ['Brazilian Bass'],
};
const genreId = {};
let sort = 0;
for (const name of parentGenres) {
  const [row] = await q(
    `insert into genres (name, slug, sort_order) values ($1, $2, $3) returning id`,
    [name, slugify(name), sort++]
  );
  genreId[name] = row.id;
}
for (const [parent, subs] of Object.entries(subGenres)) {
  let s = 0;
  for (const name of subs) {
    const [row] = await q(
      `insert into genres (name, slug, parent_genre_id, sort_order) values ($1, $2, $3, $4) returning id`,
      [name, slugify(name), genreId[parent], s++]
    );
    genreId[name] = row.id;
  }
}

// --- venues (fictional) ---
const venuesData = [
  ['The Boiler Yard', 'Arch 12, Rivington Street', 'London', 'United Kingdom', 51.5265, -0.0824],
  ['Paradise Wharf', 'Harbourside', 'Bristol', 'United Kingdom', 51.4495, -2.5985],
  ['Mill City Warehouse', 'Pollard Street', 'Manchester', 'United Kingdom', 53.4794, -2.2247],
  ['Seafront Ballroom', 'Kings Road Arches', 'Brighton', 'United Kingdom', 50.8198, -0.1462],
  ['The Old Foundry', 'Kirkstall Road', 'Leeds', 'United Kingdom', 53.7997, -1.5731],
  ['Sunset Terraza', 'Carretera Cap Negret', 'Ibiza', 'Spain', 38.9744, 1.3060],
  ['Het Pakhuis', 'Oostelijke Handelskade', 'Amsterdam', 'Netherlands', 52.3760, 4.9280],
  ['Kraftfeld', 'Köpenicker Str.', 'Berlin', 'Germany', 52.5075, 13.4310],
  ['Laguna Beach Club', 'The Garden, Tisno', 'Tisno', 'Croatia', 43.8007, 15.6431],
  ['Kendwa Shores', 'Kendwa Beach', 'Zanzibar', 'Tanzania', -5.7515, 39.2871],
  ['The Undercroft', 'Trongate', 'Glasgow', 'United Kingdom', 55.8570, -4.2450],
  ['The Grain Store', 'Woodstock', 'Cape Town', 'South Africa', -33.9276, 18.4487],
  ['Greenpoint Works', 'Greenpoint Ave', 'New York', 'United States', 40.7304, -73.9540],
];
const venueId = {};
for (const [name, address, city, country, lat, lng] of venuesData) {
  const [row] = await q(
    `insert into venues (name, slug, address, city, country, latitude, longitude, website)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [name, slugify(name), address, city, country, lat, lng, `https://example.com/venues/${slugify(name)}`]
  );
  venueId[name] = row.id;
}

// --- promoters (fictional) ---
const promotersData = [
  ['Low End Collective', 'Bass-first warehouse parties since the myspace era.', true],
  ['Golden Hour', 'Day parties for people who still want to be home by midnight. Sometimes.', true],
  ['Rewind Sessions', 'Old school jungle and rave nostalgia done properly.', true],
  ['Casa Balearica', 'Sunset sessions, island time.', false],
  ['Night Bureau', 'Techno with no phones on the floor.', true],
  ['Steppers Union', 'Garage, 2-step and everything in between.', false],
  ['Analogue Love', 'Disco, boogie and vocal house for grown-ups.', true],
  ['Northern Circuit', 'Festivals and weekenders in unlikely places.', false],
];
const promoterId = {};
for (const [name, description, verified] of promotersData) {
  const [row] = await q(
    `insert into promoters (name, slug, description, website, verified)
     values ($1, $2, $3, $4, $5) returning id`,
    [name, slugify(name), description, `https://example.com/promoters/${slugify(name)}`, verified]
  );
  promoterId[name] = row.id;
}

// --- artists (fictional) ---
const artistNames = [
  'Marcy Vale', 'DJ Half Moon', 'Rudegirl Selecta', 'The Ellington Twins',
  'Konrad Weiss', 'Aya Sable', 'Tommy Deepside', 'Foxglove', 'MC Parable',
  'Sister Midnight', 'Oskar Linne', 'Delia Cruz', 'Bassline Bertie',
  'The Vinyl Gardener', 'Junglist Mo', 'Carmen Ostinato', 'Pale Rider',
  'Miss Dynamite Soul', 'Herbal T', 'Roulette',
];
const artistId = {};
for (const name of artistNames) {
  const [row] = await q(
    `insert into artists (name, slug) values ($1, $2) returning id`,
    [name, slugify(name)]
  );
  artistId[name] = row.id;
}

// --- members (fictional; password for all dev accounts: "guestlist") ---
const avatarDir = path.join(root, 'public', 'avatars');
mkdirSync(avatarDir, { recursive: true });
const palette = ['#e3b341', '#c46a4a', '#7a9e7e', '#6a7ba2', '#a26a9e', '#4a8ca6', '#a64a5c', '#8a8a5c'];
function makeAvatar(name, i) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const c = palette[i % palette.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#141414"/><circle cx="48" cy="48" r="44" fill="${c}" opacity="0.28"/><circle cx="48" cy="48" r="44" fill="none" stroke="${c}" stroke-width="2" opacity="0.7"/><text x="48" y="58" font-family="system-ui,sans-serif" font-size="30" font-weight="600" fill="${c}" text-anchor="middle">${initials}</text></svg>`;
  const file = `avatar-${i + 1}.svg`;
  writeFileSync(path.join(avatarDir, file), svg);
  return `/avatars/${file}`;
}

const membersData = [
  ['oshi@guestlist.net', 'Oshi', 'admin', 'London', 'United Kingdom'],
  ['dev-nadia@example.com', 'Nadia K', 'member', 'London', 'United Kingdom'],
  ['dev-marcus@example.com', 'Marcus T', 'member', 'Bristol', 'United Kingdom'],
  ['dev-jules@example.com', 'Jules', 'member', 'Manchester', 'United Kingdom'],
  ['dev-sophie@example.com', 'Sophie R', 'member', 'Brighton', 'United Kingdom'],
  ['dev-dan@example.com', 'Dan the Van', 'member', 'Leeds', 'United Kingdom'],
  ['dev-elena@example.com', 'Elena M', 'member', 'Amsterdam', 'Netherlands'],
  ['dev-kwame@example.com', 'Kwame A', 'member', 'London', 'United Kingdom'],
  ['dev-priya@example.com', 'Priya S', 'member', 'London', 'United Kingdom'],
  ['dev-rob@example.com', 'Rob Hacienda', 'member', 'Manchester', 'United Kingdom'],
  ['dev-carla@example.com', 'Carla B', 'member', 'Berlin', 'Germany'],
  ['dev-steve@example.com', 'Stevie G', 'member', 'Glasgow', 'United Kingdom'],
  // Global members (V2C): the network is international from day one.
  ['dev-lena@example.com', 'Lena Voss', 'member', 'Berlin', 'Germany'],
  ['dev-amani@example.com', 'Amani J', 'member', 'Zanzibar', 'Tanzania'],
  ['dev-thabo@example.com', 'Thabo M', 'member', 'Cape Town', 'South Africa'],
  ['dev-maya@example.com', 'Maya R', 'member', 'New York', 'United States'],
];
const memberId = {};
const pw = hashPassword('guestlist');
for (let i = 0; i < membersData.length; i++) {
  const [email, name, role, city, country] = membersData[i];
  const [row] = await q(
    `insert into members (email, password_hash, display_name, avatar_url, role, home_city, home_country)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [email, pw, name, makeAvatar(name, i), role, city, country]
  );
  memberId[email] = row.id;
}

// Explicit genre preferences for a few members (powers For You ranking).
const prefs = {
  'oshi@guestlist.net': ['House', 'Jungle', 'Balearic'],
  'dev-nadia@example.com': ['Drum & Bass', 'Jungle'],
  'dev-marcus@example.com': ['Techno'],
  'dev-jules@example.com': ['House', 'Disco'],
  'dev-kwame@example.com': ['Garage', 'Bass'],
  'dev-lena@example.com': ['Techno', 'Melodic Techno'],
  'dev-amani@example.com': ['Afro House', 'House'],
  'dev-thabo@example.com': ['Amapiano', 'Afro House'],
  'dev-maya@example.com': ['House', 'Disco', 'Classic House'],
};
for (const [email, names] of Object.entries(prefs)) {
  for (const g of names) {
    await q(`insert into member_genres (member_id, genre_id) values ($1, $2)`, [
      memberId[email], genreId[g],
    ]);
  }
}

// --- event sources (fictional) ---
const sourcesData = [
  ['promoter_website', 'Low End Collective — events page', 'https://example.com/promoters/low-end-collective/events', 'Low End Collective', null],
  ['venue_website', 'The Boiler Yard calendar', 'https://example.com/venues/the-boiler-yard/whats-on', null, 'The Boiler Yard'],
  ['festival_website', 'Ten Cities Festival site', 'https://example.com/festivals/ten-cities', null, null],
  ['independent_calendar', 'Bristol DIY listings', 'https://example.com/calendars/bristol-diy', null, null],
  ['blog_publication', 'Beyond The Ropes blog', 'https://example.com/blogs/beyond-the-ropes', null, null],
];
for (const [type, name, url, promoter, venue] of sourcesData) {
  await q(
    `insert into event_sources (source_type, name, url, promoter_id, venue_id, notes)
     values ($1, $2, $3, $4, $5, 'Development seed source')`,
    [type, name, url, promoter ? promoterId[promoter] : null, venue ? venueId[venue] : null]
  );
}

// --- events ---
// Dates relative to now. day(n) = n days from today at hh:mm.
const now = new Date();
const day = (n, h = 22, m = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  d.setHours(h, m, 0, 0);
  return d;
};
// Next Friday (>= today).
const dow = now.getDay();
const toFri = (5 - dow + 7) % 7;
const fri = (h, m = 0) => day(toFri, h, m);
const sat = (h, m = 0) => day(toFri + 1, h, m);
const sun = (h, m = 0) => day(toFri + 2, h, m);

const img = {
  party: '/images/secret-party.jpg',
  beach: '/images/retreat-beach.jpg',
  healing: '/images/sound-healing.jpg',
  supper: '/images/supper-club.jpg',
  ocean: '/images/travel-ocean.jpg',
  safari: '/images/travel-safari.jpg',
  hero: '/hero.jpg',
};

// [title, shortDesc, start, end, tz, venue, promoter, type, genres, lineup,
//  priceFrom, priceTo, currency, image, flags {featured, travel, status}, desc]
const eventsData = [
  ['Golden Hour: Rooftop Day Party', 'Vocal house and disco in the afternoon sun, done by ten.',
    sat(14), sat(22), 'Europe/London', 'The Boiler Yard', 'Golden Hour', 'day_party',
    ['Vocal House', 'Disco', 'Funky House'], ['Delia Cruz', 'Tommy Deepside', 'Miss Dynamite Soul'],
    22, 30, 'GBP', img.party, { featured: true },
    'An afternoon of hands-in-the-air vocal house and proper disco on the terrace. Golden Hour is built around one idea: all the euphoria of a big night out, finished at a civilised hour. Expect singalongs, sunset and a room full of people who were there the first time round.'],
  ['Rewind Sessions presents Jungle Mania', 'Old school jungle, all vinyl, all night.',
    fri(22), sat(6), 'Europe/London', 'Mill City Warehouse', 'Rewind Sessions', 'club_night',
    ['Jungle', 'Drum & Bass', 'Old School Jungle'], ['Junglist Mo', 'MC Parable', 'Rudegirl Selecta', 'Bassline Bertie'],
    18, null, 'GBP', img.hero, { featured: true },
    'Amen breaks until sunrise. Rewind Sessions brings four decks of 93–97 pressure to the warehouse: original dubplates, foghorns, and an MC who knows when to let the music breathe.'],
  ['Sunset at Casa Balearica', 'Balearic classics as the sun drops into the sea.',
    day(12, 17), day(12, 23, 30), 'Europe/Madrid', 'Sunset Terraza', 'Casa Balearica', 'day_party',
    ['Balearic', 'House', 'Disco'], ['The Vinyl Gardener', 'Aya Sable'],
    0, null, 'EUR', img.ocean, { featured: true, travel: true },
    'Free entry, one terrace, one sunset. Casa Balearica plays the long game: ambient into boogie into that record you forgot you loved, timed to the light. Arrive early, swim, stay late.'],
  ['Night Bureau 012', 'Proper techno. No phones on the floor.',
    sat(23), sun(8), 'Europe/London', 'The Undercroft', 'Night Bureau', 'club_night',
    ['Techno', 'Hard Techno'], ['Konrad Weiss', 'Pale Rider', 'Carmen Ostinato'],
    15, 20, 'GBP', img.party, {},
    'Twelve editions in and the formula holds: a concrete room, a serious system, camera stickers on the door. Konrad Weiss plays three hours of peak-time techno; Carmen Ostinato opens with electro and EBM.'],
  ['Steppers Union: Garage All-Dayer', 'UKG, 2-step and speed garage across two rooms.',
    sat(13), sat(23), 'Europe/London', 'Paradise Wharf', 'Steppers Union', 'day_party',
    ['Garage', 'UK Garage', '2-Step', 'Speed Garage'], ['Roulette', 'Miss Dynamite Soul', 'Herbal T'],
    12.5, 25, 'GBP', img.supper, {},
    'Two rooms on the harbourside: champagne garage upstairs, dark 2-step and speed garage below. Dress up, skank hard.'],
  ['Ten Cities Festival', 'Three days, five stages, one field in the Yorkshire Dales.',
    day(45, 12), day(47, 23), 'Europe/London', 'The Old Foundry', 'Northern Circuit', 'festival',
    ['House', 'Techno', 'Drum & Bass', 'Disco'], ['Marcy Vale', 'Konrad Weiss', 'Delia Cruz', 'Junglist Mo', 'The Ellington Twins'],
    145, 210, 'GBP', img.safari, { featured: true },
    'Ten Cities gathers the best of the country’s independent dance floors into one weekend. Five stages curated by five crews, a lake, a wood-fired sauna, and a strict no-headliner-worship policy. Camping and boutique options available.'],
  ['The Garden Weekender', 'Four days on the Adriatic with the extended family.',
    day(60, 16), day(64, 4), 'Europe/Zagreb', 'Laguna Beach Club', 'Northern Circuit', 'weekender',
    ['House', 'Disco', 'Balearic'], ['Tommy Deepside', 'The Vinyl Gardener', 'Aya Sable', 'Delia Cruz'],
    180, 260, 'EUR', img.ocean, { travel: true, featured: true },
    'Boat parties by day, open-air club by night, and the clearest water you’ve ever danced next to. The Garden Weekender is capped at 2,000 people and sells out on word of mouth.'],
  ['Kendwa Full Moon Sessions', 'Deep house and Afro house on the sand under the full moon.',
    day(75, 20), day(76, 6), 'Africa/Dar_es_Salaam', 'Kendwa Shores', null, 'beach_party',
    ['House', 'Deep House', 'Bass'], ['Aya Sable', 'DJ Half Moon'],
    25, null, 'USD', img.beach, { travel: true },
    'Once a month, when the tide and the moon line up, Kendwa Shores turns its beach bar into an open-air club. Local selectors and visiting DJs play deep and Afro house until the sun comes up over the Indian Ocean.'],
  ['Analogue Love: Disco Supper Club', 'Dinner, then dancing. Boogie records and big tunes.',
    fri(19), sat(1), 'Europe/London', 'Seafront Ballroom', 'Analogue Love', 'club_night',
    ['Disco', 'Vocal House', 'Classic House'], ['The Ellington Twins', 'Sister Midnight'],
    35, 65, 'GBP', img.supper, {},
    'Three courses, then the tables get pushed back and the Ellington Twins take over the ballroom. Expect Salsoul, West End, and at least one moment of mass euphoria before midnight.'],
  ['Low End Collective: Bassweight', 'Subs you feel in your chest. Bass, breaks and 140.',
    day(9, 22), day(10, 4), 'Europe/London', 'The Boiler Yard', 'Low End Collective', 'club_night',
    ['Bass', 'Breaks', 'Garage'], ['Foxglove', 'Herbal T', 'Kwaito Roulette'.replace('Kwaito ', '')],
    14, null, 'GBP', img.party, {},
    'The Low End system gets its annual service, then we turn it up. Bassweight is about physical sound: dubstep before it went stadium, broken beats, and the occasional garage curveball.'],
  ['Liquid Rollers', 'Smooth end of the drum & bass spectrum, all night long.',
    day(16, 22), day(17, 4), 'Europe/London', 'Paradise Wharf', 'Low End Collective', 'club_night',
    ['Drum & Bass', 'Liquid', 'Rollers'], ['Marcy Vale', 'MC Parable'],
    16, null, 'GBP', img.hero, {},
    'Liquid and rollers only — no jump up, no neuro, no tear-out. Marcy Vale plays an extended set of the soulful stuff.'],
  ['Neurofunk Assembly', 'The technical end of D&B, loud.',
    day(23, 23), day(24, 5), 'Europe/London', 'Mill City Warehouse', 'Low End Collective', 'club_night',
    ['Drum & Bass', 'Neurofunk', 'Jump Up'], ['Oskar Linne', 'Foxglove'],
    17, 22, 'GBP', img.party, {},
    'Precision-engineered drum & bass on a system that can take it.'],
  ['Kraftfeld Nacht', 'Berlin techno institution, guest-curated.',
    day(30, 23, 30), day(32, 10), 'Europe/Berlin', 'Kraftfeld', 'Night Bureau', 'club_night',
    ['Techno', 'Melodic Techno'], ['Konrad Weiss', 'Carmen Ostinato', 'Pale Rider'],
    20, null, 'EUR', img.party, { travel: true },
    'Thirty-four hours, one room, no re-entry stamp needed because nobody leaves. Night Bureau takes over Kraftfeld for a marathon weekend.'],
  ['Het Pakhuis Open Dag', 'Amsterdam warehouse day-into-night session.',
    day(19, 15), day(19, 23), 'Europe/Amsterdam', 'Het Pakhuis', 'Analogue Love', 'day_party',
    ['House', 'Deep House', 'Disco'], ['Tommy Deepside', 'Delia Cruz'],
    22, null, 'EUR', img.supper, { travel: true },
    'The old coffee warehouse opens its doors at three in the afternoon. Deep house on rotary mixers, stroopwafels at the bar.'],
  ['Trance Communion', 'Classic and progressive trance revival night.',
    day(26, 22), day(27, 6), 'Europe/London', 'The Old Foundry', null, 'club_night',
    ['Trance', 'Progressive House'], ['Oskar Linne', 'Sister Midnight'],
    18, null, 'GBP', img.healing, {},
    'Hands. In. The. Air. A room full of people who remember when trance was the biggest sound on earth, and a soundtrack to match.'],
  ['Hardcore Will Never Die', 'Happy hardcore and rave classics. Whistles provided.',
    day(37, 21), day(38, 4), 'Europe/London', 'The Undercroft', 'Rewind Sessions', 'club_night',
    ['Hardcore', 'Jungle'], ['Bassline Bertie', 'MC Parable'],
    15, null, 'GBP', img.party, {},
    'Gloves, glowsticks and 170bpm. A loving, sweaty tribute to the tape-pack era.'],
  ['Dub Foundation Sound System Session', 'Roots, dub and steppers on a hand-built rig.',
    day(11, 20), day(12, 2), 'Europe/London', 'Paradise Wharf', 'Steppers Union', 'club_night',
    ['Reggae & Dub', 'Bass'], ['Herbal T', 'Junglist Mo'],
    10, null, 'GBP', img.healing, {},
    'One rig, one operator, dubplates all night. Bring earplugs, leave your cynicism at home.'],
  ['Boat Party: Thames Pressure', 'Garage and bass on the river, three hours, one lap.',
    day(20, 18, 30), day(20, 22, 30), 'Europe/London', null, 'Steppers Union', 'boat_party',
    ['Garage', 'UK Garage', 'Bass'], ['Roulette', 'Foxglove'],
    28, null, 'GBP', img.ocean, {},
    'The pressure starts at Tower Pier. Three hours of UKG and bass while London slides past. Strictly limited capacity.'],
  ['Morning Frequencies', 'Sound bath into ambient into gentle house. Alcohol-free.',
    day(14, 8), day(14, 12), 'Europe/London', 'Seafront Ballroom', 'Golden Hour', 'retreat',
    ['Balearic', 'House'], ['Aya Sable'],
    20, null, 'GBP', img.healing, {},
    'A different kind of session: gongs and drones at 8am, coffee and pastries at 10, and a gentle house set to finish. Leave by noon feeling better than you arrived.'],
  ['The Ellington Twins: Live', 'Full live band show — disco played by actual humans.',
    day(33, 19), day(33, 23), 'Europe/London', 'Seafront Ballroom', 'Analogue Love', 'concert',
    ['Disco', 'Funky House'], ['The Ellington Twins'],
    27.5, 45, 'GBP', img.supper, {},
    'A nine-piece band, a horn section, and two hours of disco played live.'],
  ['Umoja: Amapiano & Afro House All-Nighter', 'Log drums until sunrise over Table Mountain.',
    day(21, 21), day(22, 6), 'Africa/Johannesburg', 'The Grain Store', null, 'club_night',
    ['Amapiano', 'Afro House', 'House'], ['DJ Half Moon', 'Aya Sable'],
    180, 250, 'ZAR', img.party, { travel: true },
    'Cape Town’s deepest amapiano session takes over the old grain store: log drums, private-school piano and Afro house until the mountain turns pink. Local selectors carry the night.'],
  ['Greenpoint Works: Loft Classics', 'New York house played where it was invented.',
    day(28, 22), day(29, 6), 'America/New_York', 'Greenpoint Works', null, 'club_night',
    ['House', 'Classic House', 'Disco'], ['Sister Midnight', 'Marcy Vale'],
    30, 40, 'USD', img.hero, { travel: true },
    'A Brooklyn warehouse, a rotary mixer, and six hours of the records that started everything. Loft Classics is a love letter to the city that built house music.'],
  ['Classic House Vinyl Social', 'Free afternoon session — bring your own records hour included.',
    day(6, 15), day(6, 21), 'Europe/London', 'The Boiler Yard', 'Analogue Love', 'day_party',
    ['House', 'Classic House', 'Deep House'], [],
    0, null, 'GBP', img.supper, {},
    'Free in, records out. The first hour is open decks: bring one classic house record and play it. No lineup, no headliners, just the music.'],
  ['Deep North Weekender', 'Two nights, one hotel, one lineup, zero sleep.',
    day(52, 18), day(54, 14), 'Europe/London', 'The Old Foundry', 'Northern Circuit', 'weekender',
    ['House', 'Deep House', 'Techno'], ['Tommy Deepside', 'Pale Rider', 'Marcy Vale'],
    99, 149, 'GBP', img.safari, {},
    'The whole hotel, taken over. Music in the ballroom, the basement and (quietly) the pool.'],
  ['Sunrise Over Kendwa: NYE Preview', 'A teaser session for the new year run.',
    day(85, 21), day(86, 7), 'Africa/Dar_es_Salaam', 'Kendwa Shores', null, 'beach_party',
    ['House', 'Balearic'], [],
    null, null, null, img.beach, { travel: true },
    'Details still landing — lineup and tickets to be announced. Mark yourself interested and we’ll keep you posted.'],
  ['Glasgow Subterranea', 'Techno and electro below street level.',
    day(8, 23), day(9, 5), 'Europe/London', 'The Undercroft', 'Night Bureau', 'club_night',
    ['Techno', 'Breaks'], ['Carmen Ostinato'],
    12, null, 'GBP', img.party, {},
    'Low ceilings, big sound.'],
  // Past event (finished last weekend) — proves past handling.
  ['Golden Hour: Season Opener', 'The one that started this season.',
    day(-8, 14), day(-8, 22), 'Europe/London', 'The Boiler Yard', 'Golden Hour', 'day_party',
    ['Vocal House', 'Disco'], ['Delia Cruz'],
    20, null, 'GBP', img.party, {},
    'Season opener — this one has already happened.'],
  // Sunday session next weekend.
  ['Sunday Best: Recovery Disco', 'Easy Sunday afternoon disco and balearic.',
    sun(14), sun(20), 'Europe/London', 'Paradise Wharf', 'Golden Hour', 'day_party',
    ['Disco', 'Balearic'], ['The Vinyl Gardener'],
    8, null, 'GBP', img.supper, {},
    'The gentlest possible landing after a big Saturday.'],
  // Always one event starting a few hours from seed time, so "tonight" /
  // current-weekend views are never empty whatever day the seed runs.
  ['Late Door Sessions: Tonight', 'Short-notice basement session, small room, big system.',
    new Date(now.getTime() + 3 * 3600 * 1000), new Date(now.getTime() + 9 * 3600 * 1000),
    'Europe/London', 'The Boiler Yard', 'Low End Collective', 'club_night',
    ['Bass', 'House'], ['Foxglove'],
    10, null, 'GBP', img.party, {},
    'Announced this morning, done by closing time. The room holds 150 people; when it’s full, it’s full.'],
];

const eventId = {};
for (const ev of eventsData) {
  const [title, shortDesc, start, end, tz, venue, promoter, type, genres, lineup,
    priceFrom, priceTo, currency, image, flags, desc] = ev;
  const v = venue ? venuesData.find((x) => x[0] === venue) : null;
  const [row] = await q(
    `insert into events (title, slug, short_description, description, start_at, end_at,
        timezone, venue_id, promoter_id, city, country, latitude, longitude, event_type,
        ticket_url, price_from, price_to, currency, primary_image_url,
        source_url, source_type, status, worth_travelling, featured,
        title_normalized, published_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,now(),$26)
     returning id`,
    [
      title, slugify(title), shortDesc, desc, start, end, tz,
      venue ? venueId[venue] : null,
      promoter ? promoterId[promoter] : null,
      v ? v[2] : (title.includes('Thames') ? 'London' : null),
      v ? v[3] : (title.includes('Thames') ? 'United Kingdom' : null),
      v ? v[4] : null, v ? v[5] : null,
      type,
      `https://example.com/tickets/${slugify(title)}`,
      priceFrom, priceTo, currency, image,
      `https://example.com/events/${slugify(title)}`, 'manual', 'live',
      !!flags.travel, !!flags.featured,
      normTitle(title), memberId['oshi@guestlist.net'],
    ]
  );
  eventId[title] = row.id;
  for (const g of genres) {
    await q(`insert into event_genres (event_id, genre_id) values ($1, $2) on conflict do nothing`,
      [row.id, genreId[g]]);
  }
  for (let i = 0; i < lineup.length; i++) {
    if (!artistId[lineup[i]]) continue;
    await q(`insert into event_artists (event_id, artist_id, position, billing) values ($1,$2,$3,$4)`,
      [row.id, artistId[lineup[i]], i, i === 0 ? 'headliner' : null]);
  }
  await q(`insert into event_images (event_id, url, sort_order) values ($1, $2, 0)`, [row.id, image]);
}

// A draft in the NEW queue (as if just submitted) and a POSSIBLE DUPLICATE
// in NEEDS REVIEW, so the admin queue has realistic content.
await q(
  `insert into events (title, slug, short_description, start_at, timezone, city, country,
      event_type, ticket_url, source_url, source_type, status, title_normalized)
   values ('Submitted event — basslinefridays.example.com', 'submitted-event-bassline-fridays',
      null, $1, 'Europe/London', null, null, 'other',
      'https://basslinefridays.example.com/next', 'https://basslinefridays.example.com/next',
      'member_submission', 'new', $2)`,
  [day(365), normTitle('Submitted event — basslinefridays.example.com')]
);

const jm = eventsData.find((e) => e[0].includes('Jungle Mania'));
await q(
  `insert into events (title, slug, short_description, start_at, end_at, timezone, city, country,
      event_type, ticket_url, source_url, source_type, status, possible_duplicate_of, title_normalized)
   values ('Jungle Mania (Rewind Sessions)', 'jungle-mania-rewind-sessions-dupe',
      'Old school jungle all-nighter.', $1, $2, 'Europe/London', 'Manchester', 'United Kingdom',
      'club_night', 'https://example.com/other-source/jungle-mania',
      'https://example.com/other-source/jungle-mania',
      'venue_website', 'needs_review', $3, $4)`,
  [jm[2], jm[3], eventId['Rewind Sessions presents Jungle Mania'], normTitle('Jungle Mania Rewind Sessions')]
);

// --- social actions: spread going/interested/saved across members ---
const rsvps = [
  ['Golden Hour: Rooftop Day Party', 'going', ['dev-nadia@example.com','dev-jules@example.com','dev-kwame@example.com','dev-priya@example.com','dev-sophie@example.com','dev-rob@example.com']],
  ['Golden Hour: Rooftop Day Party', 'interested', ['dev-marcus@example.com','dev-dan@example.com']],
  ['Rewind Sessions presents Jungle Mania', 'going', ['dev-nadia@example.com','dev-dan@example.com','dev-rob@example.com','dev-steve@example.com']],
  ['Rewind Sessions presents Jungle Mania', 'interested', ['dev-kwame@example.com','dev-jules@example.com','dev-priya@example.com']],
  ['Night Bureau 012', 'going', ['dev-marcus@example.com','dev-carla@example.com','dev-steve@example.com']],
  ['Ten Cities Festival', 'going', ['dev-nadia@example.com','dev-jules@example.com','dev-marcus@example.com','dev-dan@example.com','dev-rob@example.com']],
  ['Ten Cities Festival', 'interested', ['dev-sophie@example.com','dev-kwame@example.com','dev-priya@example.com','dev-elena@example.com']],
  ['The Garden Weekender', 'interested', ['dev-jules@example.com','dev-sophie@example.com','dev-elena@example.com']],
  ['Sunset at Casa Balearica', 'going', ['dev-elena@example.com','dev-sophie@example.com']],
  ['Steppers Union: Garage All-Dayer', 'going', ['dev-kwame@example.com','dev-marcus@example.com']],
  ['Analogue Love: Disco Supper Club', 'interested', ['dev-sophie@example.com','dev-priya@example.com']],
  ['Sunday Best: Recovery Disco', 'going', ['dev-jules@example.com']],
];
for (const [title, rsvp, emails] of rsvps) {
  for (const email of emails) {
    await q(
      `insert into member_event_actions (member_id, event_id, rsvp, rsvp_at)
       values ($1, $2, $3, now() - (random() * interval '10 days'))
       on conflict (member_id, event_id) do update set rsvp = excluded.rsvp, rsvp_at = excluded.rsvp_at`,
      [memberId[email], eventId[title], rsvp]
    );
  }
}
for (const [email, titles] of Object.entries({
  'dev-nadia@example.com': ['Liquid Rollers', 'Neurofunk Assembly'],
  'dev-jules@example.com': ['Het Pakhuis Open Dag', 'Classic House Vinyl Social'],
  'dev-elena@example.com': ['Kendwa Full Moon Sessions'],
})) {
  for (const t of titles) {
    await q(
      `insert into member_event_actions (member_id, event_id, saved_at)
       values ($1, $2, now()) on conflict (member_id, event_id) do update set saved_at = now()`,
      [memberId[email], eventId[t]]
    );
  }
}

// --- member friendships (Club Messenger; friend = MUTUAL follow) ---
// Pairs are mutual; the one-way rows model "follows, not friends".
const friendPairs = [
  ['oshi@guestlist.net', 'dev-nadia@example.com'],
  ['oshi@guestlist.net', 'dev-kwame@example.com'],
  ['oshi@guestlist.net', 'dev-jules@example.com'],
  ['dev-nadia@example.com', 'dev-dan@example.com'],
  ['dev-nadia@example.com', 'dev-kwame@example.com'],
  ['dev-jules@example.com', 'dev-sophie@example.com'],
  ['dev-marcus@example.com', 'dev-carla@example.com'],
];
const oneWayFollows = [
  ['dev-priya@example.com', 'oshi@guestlist.net'],
  ['dev-steve@example.com', 'dev-nadia@example.com'],
];
const followMember = (a, b) =>
  q(`insert into member_follows (member_id, entity_type, entity_id)
     values ($1, 'member', $2) on conflict do nothing`, [memberId[a], memberId[b]]);
for (const [a, b] of friendPairs) {
  await followMember(a, b);
  await followMember(b, a);
}
for (const [a, b] of oneWayFollows) await followMember(a, b);

// --- canonical locations (V2C) ---
// Mirror of the migration-005 backfill so a freshly seeded dev database has
// the same structured geography a migrated production database gets.
await q(`
create or replace function _seed_cc(name text) returns char(2)
language sql immutable as $fn$
  select case lower(coalesce(name, ''))
    when 'united kingdom' then 'GB' when 'spain' then 'ES' when 'netherlands' then 'NL'
    when 'germany' then 'DE' when 'croatia' then 'HR' when 'tanzania' then 'TZ'
    when 'south africa' then 'ZA' when 'united states' then 'US' when 'france' then 'FR'
    when 'italy' then 'IT' when 'portugal' then 'PT' when 'brazil' then 'BR'
    when 'australia' then 'AU' when 'japan' then 'JP' when 'ireland' then 'IE'
    else null end
$fn$;
insert into locations (kind, name, normalized_name, slug, country_code, country_name, timezone, latitude, longitude)
select 'city', src.city, lower(trim(src.city)),
       regexp_replace(lower(trim(src.city)), '[^a-z0-9]+', '-', 'g')
         || case when count(*) over (partition by lower(trim(src.city))) > 1
                 then coalesce('-' || lower(_seed_cc(src.country)), '-2') else '' end,
       _seed_cc(src.country), src.country, src.tz, src.lat, src.lng
  from (
    select city, country, tz, lat, lng,
           row_number() over (partition by lower(trim(city)), _seed_cc(country)
                              order by tz nulls last, lat nulls last) as rn
      from (
        select e.city, e.country, mode() within group (order by e.timezone) as tz,
               avg(e.latitude) as lat, avg(e.longitude) as lng
          from events e where e.city is not null group by e.city, e.country
        union all
        select v.city, v.country, null, avg(v.latitude), avg(v.longitude)
          from venues v where v.city is not null group by v.city, v.country
        union all
        select m.home_city, m.home_country, null, null, null
          from members m where m.home_city is not null group by m.home_city, m.home_country
      ) all_places
  ) src
 where src.rn = 1
on conflict (kind, normalized_name, country_code) do nothing;
update events e set location_id = l.id from locations l
 where e.city is not null and e.location_id is null and l.kind = 'city'
   and l.normalized_name = lower(trim(e.city))
   and l.country_code is not distinct from _seed_cc(e.country);
update venues v set location_id = l.id from locations l
 where v.city is not null and v.location_id is null and l.kind = 'city'
   and l.normalized_name = lower(trim(v.city))
   and l.country_code is not distinct from _seed_cc(v.country);
update members m set home_location_id = l.id from locations l
 where m.home_city is not null and m.home_location_id is null and l.kind = 'city'
   and l.normalized_name = lower(trim(m.home_city))
   and l.country_code is not distinct from _seed_cc(m.home_country);
update members set slug = regexp_replace(lower(display_name), '[^a-z0-9]+', '-', 'g') || '-' || left(id::text, 6)
 where slug is null;
drop function _seed_cc(text);
`);

// --- V2C: rave history, connections, travel, city follows (fictional) ---
const sceneData = [
  // [name, type, city, cc, country, from, to]
  ['The End', 'club', 'London', 'GB', 'United Kingdom', 1995, 2009],
  ['Space', 'club', 'Ibiza', 'ES', 'Spain', 1989, 2016],
  ['Metalheadz Sunday Sessions', 'party', 'London', 'GB', 'United Kingdom', 1996, 2000],
  ['Ministry of Sound', 'club', 'London', 'GB', 'United Kingdom', 1991, null],
  ['Tresor', 'club', 'Berlin', 'DE', 'Germany', 1991, null],
  ['Paradise Garage', 'club', 'New York', 'US', 'United States', 1977, 1987],
  ['The Garden Festival', 'festival', 'Tisno', 'HR', 'Croatia', 2006, 2015],
  ['Origin Sound System', 'promoter', 'Bristol', 'GB', 'United Kingdom', 1998, 2010],
];
const sceneId = {};
for (const [name, type, city, cc, country, from, to] of sceneData) {
  const normalized = name.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const [row] = await q(
    `insert into scene_entities (name, normalized_name, entity_type, city, country_code, country_name,
       active_from_year, active_to_year, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'approved',$9) returning id`,
    [name, normalized, type, city, cc, country, from, to, memberId['oshi@guestlist.net']]
  );
  sceneId[name] = row.id;
}
const histories = [
  // [email, entity, from, to, genres]
  ['oshi@guestlist.net', 'The End', 1998, 2002, ['House']],
  ['oshi@guestlist.net', 'Space', 2001, 2008, ['House', 'Balearic']],
  ['oshi@guestlist.net', 'Ministry of Sound', 1994, 1997, ['House']],
  ['dev-nadia@example.com', 'Metalheadz Sunday Sessions', 1996, 1999, ['Jungle', 'Drum & Bass']],
  ['dev-nadia@example.com', 'The End', 1999, 2003, ['Drum & Bass']],
  ['dev-jules@example.com', 'Space', 2002, 2006, ['House', 'Disco']],
  ['dev-kwame@example.com', 'The End', 2000, 2004, ['Garage', 'Bass']],
  ['dev-carla@example.com', 'Tresor', 2005, 2015, ['Techno']],
  ['dev-marcus@example.com', 'Tresor', 2008, 2012, ['Techno']],
  ['dev-lena@example.com', 'Tresor', 2010, null, ['Techno']],
  ['dev-elena@example.com', 'The Garden Festival', 2010, 2014, ['House', 'Balearic']],
  ['dev-maya@example.com', 'Paradise Garage', 1984, 1987, ['House', 'Disco']],
];
for (const [email, entity, from, to, gs] of histories) {
  const [row] = await q(
    `insert into member_scene_history (member_id, entity_id, from_year, to_year)
     values ($1,$2,$3,$4) returning id`,
    [memberId[email], sceneId[entity], from, to]
  );
  for (const g of gs) {
    await q(`insert into member_scene_history_genres (history_id, genre_id) values ($1,$2) on conflict do nothing`,
      [row.id, genreId[g]]);
  }
}
// Connections (accepted) — distinct from mutual follows.
for (const [a, b] of [
  ['oshi@guestlist.net', 'dev-jules@example.com'],
  ['dev-carla@example.com', 'dev-marcus@example.com'],
]) {
  await q(
    `insert into member_connections (requester_id, addressee_id, status, responded_at)
     values ($1,$2,'connected',now())`,
    [memberId[a], memberId[b]]
  );
}
// City follows + a travel plan (relative dates stay useful forever).
const locId = async (slug) => (await q(`select id from locations where slug = $1`, [slug]))[0]?.id;
const ibizaLoc = await locId('ibiza');
const londonLoc = await locId('london');
if (londonLoc) {
  await q(`insert into member_locations (member_id, location_id) values ($1,$2) on conflict do nothing`,
    [memberId['dev-amani@example.com'], londonLoc]);
  await q(`insert into member_locations (member_id, location_id) values ($1,$2) on conflict do nothing`,
    [memberId['dev-maya@example.com'], londonLoc]);
}
if (ibizaLoc) {
  await q(`insert into member_locations (member_id, location_id) values ($1,$2) on conflict do nothing`,
    [memberId['oshi@guestlist.net'], ibizaLoc]);
  const tFrom = new Date(now); tFrom.setDate(tFrom.getDate() + 10);
  const tTo = new Date(now); tTo.setDate(tTo.getDate() + 17);
  await q(
    `insert into travel_plans (member_id, location_id, start_date, end_date, visibility)
     values ($1,$2,$3,$4,'connections')`,
    [memberId['oshi@guestlist.net'], ibizaLoc, tFrom.toISOString().slice(0, 10), tTo.toISOString().slice(0, 10)]
  );
}

const counts = await q(`select
  (select count(*) from events) as events,
  (select count(*) from genres) as genres,
  (select count(*) from members) as members,
  (select count(*) from member_event_actions) as actions,
  (select count(*) from member_follows where entity_type = 'member') as member_follows`);
console.log('Seeded:', counts[0]);
console.log('Dev accounts all use password "guestlist". Admin: oshi@guestlist.net');
await client.end();
