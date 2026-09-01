// Deterministic tests for the Event Supply Engine (V2A).
// No live websites, no live AI: fixtures + injected fetcher + mock AI
// clients, against the local database (freshly reset + seeded).
//
// Usage: npm run test:supply   (runs db reset + seed itself)

import { execSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Load .env.local like the app does.
const root = path.resolve(__dirname, '..');
if (existsSync(path.join(root, '.env.local'))) {
  for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

console.log('Resetting + seeding database…');
execSync('node scripts/migrate.mjs --reset && node scripts/seed.mjs', { cwd: root, stdio: 'ignore' });

import { validateUrl, safeFetch, isBlockedIPv4, isBlockedIPv6, type SafeFetchResult, type SafeFetchOptions } from '@/lib/supply/safeFetch';
import { inspectPage, cleanPageText } from '@/lib/supply/structured';
import { parseAIJson, validateAIProposal, type AIExtractionClient, type AIExtractionOutcome } from '@/lib/supply/ai';
import { zonedTimeToUtc, parseLocalInTimezone, parseFoundDate, resolveEndCrossingMidnight, inferTimezone } from '@/lib/supply/time';
import { mapGenreProposals, loadGenres } from '@/lib/supply/genres';
import { computeOverallConfidence, canAutoPublish } from '@/lib/supply/confidence';
import { runExtractionPipeline } from '@/lib/supply/pipeline';
import { scanSource, identifyCandidateLinks, parseFeedLinks, canonicaliseCandidateUrl } from '@/lib/supply/scanner';
import { discoverSources, normaliseCandidates, isBannedCandidateHost, buildDiscoveryUser, DISCOVERY_SYSTEM_PROMPT, type DiscoveryClient } from '@/lib/supply/discover';
import { matchGenreIdsByName } from '@/lib/util';
import { isLiveSource } from '@/lib/supply/health';
import { findListingLink } from '@/lib/supply/probe';
import { testVerdict } from '@/lib/supply/verdict';
import { parse } from 'node-html-parser';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const q = (text: string, params: unknown[] = []) => db.query(text, params).then((r) => r.rows);

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, cond: unknown, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FUTURE = new Date(Date.now() + 40 * 86400_000);
const futureDate = FUTURE.toISOString().slice(0, 10); // YYYY-MM-DD

const JSONLD_PAGE = (opts: {
  title?: string; startDate?: string; endDate?: string | null; venue?: string;
  city?: string; ticketUrl?: string | null; image?: string | null; canonical?: string | null;
} = {}) => `<!doctype html><html><head>
<title>${opts.title ?? 'Warehouse Frequencies'} | Promoter</title>
${opts.canonical ? `<link rel="canonical" href="${opts.canonical}">` : ''}
<meta property="og:title" content="OG ${opts.title ?? 'Warehouse Frequencies'}">
<meta property="og:image" content="https://cdn.promoter-a.example/og.jpg">
<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'MusicEvent',
  name: opts.title ?? 'Warehouse Frequencies',
  startDate: opts.startDate ?? `${futureDate}T22:00:00+01:00`,
  ...(opts.endDate === null ? {} : { endDate: opts.endDate ?? `${futureDate}T23:30:00+01:00` }),
  image: opts.image === null ? undefined : (opts.image ?? 'https://cdn.promoter-a.example/artwork.jpg'),
  location: {
    '@type': 'Place',
    name: opts.venue ?? 'The Pressing Plant',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '4 Vinyl Way',
      addressLocality: opts.city ?? 'London',
      addressCountry: 'United Kingdom',
    },
  },
  performer: [{ '@type': 'MusicGroup', name: 'Fixture Artist One' }, { '@type': 'MusicGroup', name: 'Fixture Artist Two' }],
  organizer: { '@type': 'Organization', name: 'Fixture Promotions', url: 'https://promoter-a.example' },
  offers: { '@type': 'Offer', url: opts.ticketUrl === null ? undefined : (opts.ticketUrl ?? 'https://tickets.example/checkout/wf'), price: '17.50', priceCurrency: 'GBP' },
})}
</script></head>
<body><nav>Home Events About</nav><main><h1>${opts.title ?? 'Warehouse Frequencies'}</h1>
<p>Proper techno all night long. Doors 22:00.</p></main>
<footer>© Promoter</footer></body></html>`;

const OG_ONLY_PAGE = `<!doctype html><html><head>
<title>Sundown Sessions — tickets</title>
<meta property="og:title" content="Sundown Sessions">
<meta property="og:description" content="Balearic afternoon on the terrace.">
<meta property="og:image" content="https://cdn.promoter-b.example/sundown.jpg">
</head><body>
<nav><a href="/">Home</a><a href="/about">About</a></nav>
<main><h1>Sundown Sessions</h1>
<p>Saturday ${futureDate}, 3pm until 10pm at Harbour Terrace, Bristol.</p>
<p>Balearic and disco all afternoon. Tickets £12.</p>
<a href="https://tickets.example/checkout/sundown">Buy tickets</a></main>
<footer>Cookie banner. Privacy. Terms.</footer></body></html>`;

const LISTING_PAGE = `<!doctype html><html><head><title>Promoter A — What's on</title>
<link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>
<nav><a href="/about">About</a><a href="/login">Login</a></nav>
<main>
<a href="/events/warehouse-frequencies?utm_source=home">Warehouse Frequencies — ${futureDate}</a>
<a href="/events/second-night#top">Second Night</a>
<a href="/events/warehouse-frequencies">Warehouse Frequencies duplicate anchor</a>
<a href="https://other-site.example/events/away-day">Away day (offsite event link)</a>
<a href="/news/some-article">Some article</a>
<a href="/privacy">Privacy</a>
</main></body></html>`;

const RSS_FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Promoter B feed</title>
<item><title>Feed Night One</title><link>https://promoter-b.example/events/feed-night-one</link></item>
<item><title>Feed Night Two</title><link>https://promoter-b.example/events/feed-night-two</link></item>
</channel></rss>`;

// ---------------------------------------------------------------------------
// Mock fetcher + mock AI
// ---------------------------------------------------------------------------

type FixtureResponse = { body: string; contentType?: string; finalUrl?: string };
function mockFetcher(map: Record<string, FixtureResponse>) {
  return async (url: string): Promise<SafeFetchResult> => {
    // Real URL validation still applies in front of the fixture map.
    const validated = validateUrl(url);
    if (!validated.ok) return { ...validated, ms: 1 };
    const hit = map[url];
    if (!hit) return { ok: false, code: 'not_found', detail: 'fixture 404', status: 404, ms: 1 };
    return {
      ok: true, status: 200, finalUrl: hit.finalUrl ?? url,
      contentType: hit.contentType ?? 'text/html; charset=utf-8', body: hit.body, ms: 1,
    };
  };
}

function mockAI(proposals: Record<string, unknown>, opts: { raw?: Record<string, string> } = {}): AIExtractionClient {
  return {
    available: true,
    async extract({ url }): Promise<AIExtractionOutcome> {
      if (opts.raw && url in opts.raw) {
        const parsed = parseAIJson(opts.raw[url]);
        if (parsed == null) return { ok: false, error: 'invalid_json', detail: 'Model output was not parseable JSON' };
        const v = validateAIProposal(parsed);
        if (!v.ok) return { ok: false, error: 'invalid_shape', detail: v.detail };
        return { ok: true, proposal: v.proposal, model: 'mock', inputTokens: 1000, outputTokens: 200 };
      }
      const p = proposals[url] ?? proposals.default;
      if (!p) return { ok: false, error: 'call_failed', detail: 'no fixture proposal' };
      const v = validateAIProposal(p);
      if (!v.ok) return { ok: false, error: 'invalid_shape', detail: v.detail };
      return { ok: true, proposal: v.proposal, model: 'mock', inputTokens: 1000, outputTokens: 200 };
    },
  };
}

const noAI: AIExtractionClient = {
  available: false,
  async extract() {
    return { ok: false, error: 'unavailable', detail: 'mock: no key' };
  },
};

const baseProposal = {
  is_event: true, is_music_event: true,
  genres: [
    { name: 'Techno', confidence: 95 },
    { name: 'liquid funk', confidence: 80 },
  ],
  event_type: 'club_night',
  field_confidence: { title: 90, date: 90, venue: 88, city: 88, genres: 92 },
};

async function main() {
  await db.connect();

  // -------------------------------------------------------------------------
  console.log('\n— URL validation / SSRF —');
  {
    const cases: [string, string][] = [
      ['http://localhost/admin', 'localhost'],
      ['http://127.0.0.1:8080/x', 'loopback IP'],
      ['http://10.0.0.5/internal', 'private 10/8'],
      ['http://192.168.1.10/', 'private 192.168/16'],
      ['http://172.16.9.1/', 'private 172.16/12'],
      ['http://169.254.169.254/latest/meta-data/', 'cloud metadata IP'],
      ['http://metadata.google.internal/computeMetadata/', 'metadata hostname'],
      ['http://[::1]/x', 'IPv6 loopback'],
      ['http://[fd12::1]/x', 'IPv6 unique-local'],
      ['http://[::ffff:127.0.0.1]/x', 'IPv4-mapped loopback'],
      ['http://foo.internal/x', '.internal suffix'],
      ['http://user:pass@promoter.example/x', 'credentials in URL'],
    ];
    for (const [url, label] of cases) {
      const r = validateUrl(url);
      check(`rejects ${label}`, !r.ok && (r as { code: string }).code !== undefined);
    }
    check('rejects ftp protocol', !validateUrl('ftp://promoter.example/x').ok);
    check('rejects garbage', !validateUrl('not a url').ok);
    check('accepts public https', validateUrl('https://promoter.example/events/night').ok);
    check('blocks 100.64/10 CGNAT', isBlockedIPv4('100.64.0.1'));
    check('blocks NAT64-embedded private', isBlockedIPv6('64:ff9b::a00:1'.replace('a00:1', '10.0.0.1')) || isBlockedIPv6('64:ff9b::10.0.0.1'));
    check('allows public IPv4', !isBlockedIPv4('93.184.216.34'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— safeFetch hardening (local fixture server) —');
  {
    let slowTimer: NodeJS.Timeout | null = null;
    const server: Server = createServer((req, res) => {
      switch (req.url) {
        case '/redirect-private':
          res.writeHead(302, { Location: 'http://169.254.169.254/latest/' }).end();
          break;
        case '/redirect-localhost':
          res.writeHead(302, { Location: 'http://localhost/secret' }).end();
          break;
        case '/redirect-loop':
          res.writeHead(302, { Location: '/redirect-loop' }).end();
          break;
        case '/big-declared':
          res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': '99999999' });
          res.write('<html>');
          break;
        case '/big-streamed': {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          const chunk = 'x'.repeat(65536);
          for (let i = 0; i < 40; i++) res.write(chunk);
          res.end();
          break;
        }
        case '/slow':
          res.writeHead(200, { 'Content-Type': 'text/html' });
          slowTimer = setTimeout(() => res.end('<html>late</html>'), 5000);
          break;
        case '/png':
          res.writeHead(200, { 'Content-Type': 'image/png' }).end('not really a png');
          break;
        case '/missing':
          res.writeHead(404).end();
          break;
        case '/forbidden':
          res.writeHead(403).end();
          break;
        case '/ok':
          res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html><title>ok</title></html>');
          break;
        default:
          res.writeHead(500).end();
      }
    });
    await new Promise<void>((r) => server.listen(4571, '127.0.0.1', r));
    const T = (p: string) => `http://127.0.0.1:4571${p}`;
    const opts: SafeFetchOptions = { allowHostsForTests: ['127.0.0.1'], timeoutMs: 1500, maxBytes: 1_000_000 };

    const ok = await safeFetch(T('/ok'), opts);
    check('fetches allowed fixture host', ok.ok && ok.body.includes('ok'));
    const rp = await safeFetch(T('/redirect-private'), opts);
    check('redirect to private IP rejected', !rp.ok && rp.code === 'unsafe_url');
    const rl = await safeFetch(T('/redirect-localhost'), opts);
    check('redirect to localhost rejected', !rl.ok && rl.code === 'unsafe_url');
    const loop = await safeFetch(T('/redirect-loop'), opts);
    check('redirect loop capped', !loop.ok && loop.code === 'fetch_failed');
    const bigD = await safeFetch(T('/big-declared'), opts);
    check('declared oversize rejected', !bigD.ok && bigD.code === 'too_large');
    const bigS = await safeFetch(T('/big-streamed'), opts);
    check('streamed oversize rejected', !bigS.ok && bigS.code === 'too_large');
    const slow = await safeFetch(T('/slow'), opts);
    check('timeout enforced', !slow.ok && slow.code === 'fetch_failed' && /Timed out/i.test(slow.detail));
    const png = await safeFetch(T('/png'), opts);
    check('non-HTML content-type rejected', !png.ok && png.code === 'unsupported_content');
    const nf = await safeFetch(T('/missing'), opts);
    check('404 → not_found', !nf.ok && nf.code === 'not_found');
    const fb = await safeFetch(T('/forbidden'), opts);
    check('403 → blocked_by_site (no anti-bot escalation)', !fb.ok && fb.code === 'blocked_by_site');
    check('localhost blocked WITHOUT test allowlist', !(await safeFetch(T('/ok'))).ok);
    if (slowTimer) clearTimeout(slowTimer);
    server.close();
  }

  // -------------------------------------------------------------------------
  console.log('\n— structured metadata parsing —');
  {
    const url = 'https://promoter-a.example/events/warehouse-frequencies';
    const page = inspectPage(JSONLD_PAGE({ canonical: url }), url);
    check('JSON-LD title (beats OG)', page.title?.value === 'Warehouse Frequencies' && page.title.source === 'json-ld');
    check('JSON-LD start date', page.startAt?.value === `${futureDate}T22:00:00+01:00`);
    check('JSON-LD venue + city + country', page.venueName?.value === 'The Pressing Plant' && page.city?.value === 'London' && page.country?.value === 'United Kingdom');
    check('JSON-LD performers', page.performers.length === 2 && page.performers[0] === 'Fixture Artist One');
    check('JSON-LD offer → ticket URL separated from source', page.ticketUrl?.value === 'https://tickets.example/checkout/wf');
    check('JSON-LD price + currency', page.priceFrom?.value === 17.5 && page.currency?.value === 'GBP');
    check('JSON-LD image preferred over OG', page.imageUrl?.value === 'https://cdn.promoter-a.example/artwork.jpg');
    check('canonical URL captured', page.canonicalUrl === url);
    check('organizer captured', page.organizerName?.value === 'Fixture Promotions');
    check('structured data flag set', page.structuredDataFound);

    // schema.org genre + eventStatus (common on real event pages).
    const gPage = inspectPage(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': 'MusicEvent', name: 'Tagged Night',
        startDate: `${futureDate}T21:00:00+01:00`,
        genre: ['Drum & Bass / Jungle', 'Liquid Funk'],
        eventStatus: 'https://schema.org/EventCancelled',
        location: { '@type': 'Place', name: 'Tag Hall', address: { addressLocality: 'Leeds', addressCountry: 'United Kingdom' } },
      })}</script></head><body><main>x</main></body></html>`,
      'https://promoter-g.example/events/tagged'
    );
    check('JSON-LD genre parsed and split', gPage.genres.includes('Drum & Bass') && gPage.genres.includes('Jungle') && gPage.genres.includes('Liquid Funk'));
    check('schema.org eventStatus → cancelled hint', gPage.eventStatusHint === 'cancelled');

    const og = inspectPage(OG_ONLY_PAGE, 'https://promoter-b.example/events/sundown');
    check('OpenGraph fallback title', og.title?.value === 'Sundown Sessions' && og.title.source === 'opengraph');
    check('no structured Event flagged', !og.structuredDataFound);
    check('cleaned text keeps content', og.cleanedText.includes('Balearic and disco'));
    check('cleaned text strips nav/footer', !og.cleanedText.includes('Cookie banner') && !/Home\s*About/.test(og.cleanedText.split('\n')[0] ?? ''));
    const stripped = cleanPageText(parse('<html><body><script>var x=1;</script><nav>MENU</nav><main>real content here</main></body></html>'), 5000);
    check('scripts stripped from AI content', !stripped.includes('var x') && stripped.includes('real content'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— date/time normalisation —');
  {
    const summer = zonedTimeToUtc(2026, 7, 10, 22, 0, 'Europe/London');
    check('BST wall clock → UTC-1h', summer.toISOString() === '2026-07-10T21:00:00.000Z');
    const winter = zonedTimeToUtc(2026, 1, 10, 22, 0, 'Europe/London');
    check('GMT wall clock → UTC same', winter.toISOString() === '2026-01-10T22:00:00.000Z');
    const local = parseLocalInTimezone('2026-07-10T22:00', 'Europe/Berlin');
    check('datetime-local parsed in event tz (Berlin)', local?.toISOString() === '2026-07-10T20:00:00.000Z');
    const start = zonedTimeToUtc(2026, 7, 10, 23, 0, 'Europe/London');
    const endSameNight = zonedTimeToUtc(2026, 7, 10, 4, 0, 'Europe/London');
    const rolled = resolveEndCrossingMidnight(start, endSameNight);
    check('midnight crossing rolls end +1 day', rolled.getTime() - start.getTime() === 5 * 3600_000);
    const offsetParsed = parseFoundDate('2026-08-01T21:00:00+02:00', 'Europe/London');
    check('explicit offset honoured over tz', offsetParsed?.date.toISOString() === '2026-08-01T19:00:00.000Z');
    const dateOnly = parseFoundDate('2026-08-01', 'Europe/Madrid');
    check('date-only flagged', dateOnly?.dateOnly === true);
    check('invalid date rejected', parseFoundDate('next friday probably', 'Europe/London') === null);
    check('tz inferred from country', inferTimezone('Spain').timezone === 'Europe/Madrid');
    check('invalid explicit tz falls through', inferTimezone('Germany', 'Not/AZone').timezone === 'Europe/Berlin');
  }

  // -------------------------------------------------------------------------
  console.log('\n— genre mapping —');
  {
    const taxonomy = await loadGenres();
    const m = mapGenreProposals(
      [
        { name: 'liquid funk', confidence: 90 },
        { name: 'Drum & Bass', confidence: 97 },
        { name: 'UKG', confidence: 70 },
        { name: 'zydeco', confidence: 66 },
        { name: 'electronic', confidence: 50 },
      ],
      taxonomy
    );
    const slugs = m.matched.map((x) => x.genre.slug);
    check('"liquid funk" maps to Liquid subgenre', slugs.includes('liquid'));
    check('subgenre implies parent Drum & Bass', slugs.includes('drum-and-bass'));
    check('alias UKG → UK Garage (+ parent Garage)', slugs.includes('uk-garage') && slugs.includes('garage'));
    check('unknown genre goes to suggestions, not created', m.unknown.length === 1 && m.unknown[0].name === 'zydeco');
    check('generic "electronic" ignored silently', !m.unknown.some((u) => u.name === 'electronic'));
    check('exact name match works', mapGenreProposals([{ name: 'Techno', confidence: 90 }], taxonomy).matched.some((x) => x.genre.slug === 'techno'));
    const dab = mapGenreProposals([{ name: 'D&B', confidence: 90 }], taxonomy);
    check('"D&B" alias maps to Drum & Bass', dab.matched.some((x) => x.genre.slug === 'drum-and-bass'));
  }

  // -------------------------------------------------------------------------
  console.log('\n— pipeline: structured genres + eventStatus without AI —');
  {
    const urlT = 'https://promoter-g.example/events/tagged-no-ai';
    const body = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'MusicEvent', name: 'Tagged No-AI Night',
      startDate: `${futureDate}T21:00:00+01:00`,
      genre: 'Drum & Bass / Jungle',
      location: { '@type': 'Place', name: 'Tag Hall', address: { '@type': 'PostalAddress', addressLocality: 'Leeds', addressCountry: 'United Kingdom' } },
      offers: { '@type': 'Offer', url: 'https://tickets.example/tagged' },
    })}</script></head><body><main>Tagged</main></body></html>`;
    const out = await runExtractionPipeline(urlT, { fetcher: mockFetcher({ [urlT]: { body } }), ai: noAI });
    check('LD genres classify the event without AI', out.status === 'succeeded');
    const gn = await q(
      `select g.slug from event_genres eg join genres g on g.id = eg.genre_id where eg.event_id = $1`,
      [out.eventId]
    );
    const slugs = (gn as { slug: string }[]).map((x) => x.slug);
    check('LD genre split maps to taxonomy', slugs.includes('drum-and-bass') && slugs.includes('jungle'));
    const ex1 = (await q(`select field_sources, relevance from extractions where event_id = $1`, [out.eventId]))[0] as {
      field_sources: Record<string, string>; relevance: string;
    };
    check('genre provenance = json-ld', ex1.field_sources.genres === 'json-ld');
    check('relevance decided from structured genres', ex1.relevance === 'relevant');

    const urlC = 'https://promoter-g.example/events/cancelled-on-page';
    const bodyC = body
      .replace('Tagged No-AI Night', 'Cancelled On Page')
      .replace('"genre":"Drum & Bass / Jungle"', '"genre":"Techno","eventStatus":"https://schema.org/EventCancelled"')
      .replace('tickets.example/tagged', 'tickets.example/cancelled-x');
    const outC = await runExtractionPipeline(urlC, { fetcher: mockFetcher({ [urlC]: { body: bodyC } }), ai: noAI });
    const evC = (await q(`select listing_status from events where id = $1`, [outC.eventId]))[0] as { listing_status: string };
    check('page-declared cancellation carried onto draft', evC.listing_status === 'cancelled');
  }

  // -------------------------------------------------------------------------
  console.log('\n— deterministic confidence + auto-publish gate —');
  {
    const fields = { title: 97, date: 96, venue: 94, city: 92, genres: 92, lineup: 90, image: 92, ticket_url: 92 };
    const trusted = computeOverallConfidence(fields, 'trusted');
    const untrusted = computeOverallConfidence(fields, 'new');
    check('overall computed deterministically', trusted > 90 && trusted <= 100);
    check('source trust scales confidence', untrusted < trusted);
    check('no date → zero confidence', computeOverallConfidence({ title: 99 }, 'trusted') === 0);
    const base = {
      sourceTrust: 'trusted', overallConfidence: trusted, fieldConfidence: fields,
      startAt: FUTURE, hasLocation: true, mappedGenreCount: 2,
      duplicateState: 'none' as const, warnings: [],
    };
    check('clean trusted extraction may auto-publish', canAutoPublish(base).ok);
    check('NEW source never auto-publishes', !canAutoPublish({ ...base, sourceTrust: 'new' }).ok);
    check('duplicate blocks auto-publish', !canAutoPublish({ ...base, duplicateState: 'possible' }).ok);
    check('past event blocks auto-publish', !canAutoPublish({ ...base, startAt: new Date(Date.now() - 86400_000) }).ok);
    check('timezone warning blocks auto-publish', !canAutoPublish({ ...base, warnings: ['timezone assumed Europe/London (no location evidence)'] }).ok);
  }

  // -------------------------------------------------------------------------
  console.log('\n— AI response robustness —');
  {
    check('parses fenced JSON', (parseAIJson('```json\n{"is_event":true}\n```') as { is_event: boolean }).is_event === true);
    check('salvages JSON with prose around it', (parseAIJson('Sure! {"is_event":false} hope that helps') as { is_event: boolean }).is_event === false);
    check('malformed JSON → null', parseAIJson('deeply sorry, no json today') === null);
    check('wrong shape rejected', !validateAIProposal({ is_event: 'yes' }).ok);
    check('injection-shaped fields rejected by schema', !validateAIProposal({ is_event: true, genres: [{ name: 'x'.repeat(500), confidence: 90 }] }).ok);
  }

  // -------------------------------------------------------------------------
  console.log('\n— pipeline: structured-first extraction —');
  const urlA = 'https://promoter-a.example/events/warehouse-frequencies';
  {
    const fetcher = mockFetcher({ [urlA]: { body: JSONLD_PAGE({ canonical: urlA }) } });
    const out = await runExtractionPipeline(urlA, { fetcher, ai: mockAI({ default: baseProposal }) });
    check('JSON-LD pipeline succeeds', out.status === 'succeeded' && !!out.eventId);
    const ev = (await q(
      `select e.*, (select count(*)::int from event_genres g where g.event_id = e.id) as genre_count,
              (select count(*)::int from event_artists a where a.event_id = e.id) as artist_count
         from events e where e.id = $1`, [out.eventId]))[0] as Record<string, unknown>;
    check('title from JSON-LD', ev.title === 'Warehouse Frequencies');
    check('start stored with explicit offset (21:00Z)', new Date(ev.start_at as string).toISOString().includes('21:00:00'));
    check('end time preserved, not invented', ev.end_at != null);
    check('ticket URL separated from source URL', ev.ticket_url === 'https://tickets.example/checkout/wf' && ev.source_url === urlA);
    check('canonical URL stored', ev.canonical_url === urlA);
    check('price captured', Number(ev.price_from) === 17.5 && ev.currency === 'GBP');
    check('image from JSON-LD', ev.primary_image_url === 'https://cdn.promoter-a.example/artwork.jpg');
    check('multiple genres m2m (techno + liquid + dnb)', (ev.genre_count as number) >= 3);
    check('lineup created', (ev.artist_count as number) === 2);
    check('draft not live (no trusted source)', ev.status !== 'live');
    check('confidence stored on event', ev.confidence_score != null);
    const ex = (await q(`select * from extractions where event_id = $1`, [out.eventId]))[0] as Record<string, unknown>;
    check('provenance recorded (title=json-ld)', (ex.field_sources as Record<string, string>).title === 'json-ld');
    check('metrics recorded (ai tokens, timings)', ex.ai_used === true && ex.ai_input_tokens === 1000 && ex.total_ms != null);
    check('structured-data hit recorded', ex.structured_data_found === true);
    const links = await q(`select * from event_source_links where event_id = $1`, [out.eventId]);
    check('source link evidence created', links.length === 1);
    const venue = (await q(`select name, city from venues where id = $1`, [ev.venue_id]))[0] as { name: string };
    check('venue created from JSON-LD place', venue?.name === 'The Pressing Plant');
  }

  // -------------------------------------------------------------------------
  console.log('\n— pipeline: exact URL duplicate + multi-source enrichment —');
  {
    // Same canonical event discovered via a different URL that redirects/serves
    // the same canonical link → exact duplicate → linked, not duplicated.
    const urlA2 = 'https://venue-site.example/whats-on/warehouse-frequencies';
    const fetcher = mockFetcher({
      [urlA2]: { body: JSONLD_PAGE({ canonical: urlA }) }, // same canonical
    });
    const out = await runExtractionPipeline(urlA2, { fetcher, ai: mockAI({ default: baseProposal }) });
    check('exact duplicate → linked, no new event', out.status === 'duplicate_linked');
    const events = await q(`select id from events where title = 'Warehouse Frequencies'`);
    check('still exactly one canonical event', events.length === 1);
    const links = await q(`select url, kind from event_source_links where event_id = $1 order by created_at`, [out.duplicateOf]);
    check('event now carries multiple source links', links.length === 2);

    // Resubmitting the identical URL is also an exact duplicate.
    const again = await runExtractionPipeline(urlA, {
      fetcher: mockFetcher({ [urlA]: { body: JSONLD_PAGE({ canonical: urlA }) } }),
      ai: mockAI({ default: baseProposal }),
    });
    check('same URL twice → duplicate, not second event', again.status === 'duplicate_linked');
  }

  // -------------------------------------------------------------------------
  console.log('\n— pipeline: probable (non-URL) duplicate —');
  {
    const urlDup = 'https://blog.example/events/warehouse-frequencies-preview';
    const fetcher = mockFetcher({
      [urlDup]: { body: JSONLD_PAGE({ canonical: urlDup, venue: 'Pressing Plant', ticketUrl: null }) },
    });
    const out = await runExtractionPipeline(urlDup, { fetcher, ai: mockAI({ default: baseProposal }) });
    check('similar title+date+city → flagged, not merged', out.status === 'possible_duplicate' && !!out.eventId);
    const ev = (await q(`select status, possible_duplicate_of from events where id = $1`, [out.eventId]))[0] as Record<string, unknown>;
    check('flagged draft goes to needs_review', ev.status === 'needs_review');
    check('duplicate pointer set for admin', ev.possible_duplicate_of != null);
    const ex = (await q(`select duplicate_state, duplicate_score from extractions where event_id = $1`, [out.eventId]))[0] as Record<string, unknown>;
    check('duplicate scored (possible/likely)', ['possible', 'likely'].includes(ex.duplicate_state as string) && Number(ex.duplicate_score) >= 50);
    // Clean up flagged draft so later scans aren't affected.
    await q(`update events set status = 'rejected' where id = $1`, [out.eventId]);
  }

  // -------------------------------------------------------------------------
  console.log('\n— pipeline: AI-assisted extraction (no structured data) —');
  const urlB = 'https://promoter-b.example/events/sundown';
  {
    const proposal = {
      is_event: true, is_music_event: true,
      title: 'Sundown Sessions',
      start_date: futureDate, start_time: '15:00', end_time: '22:00',
      venue_name: 'Paradise Wharf', city: 'Bristol', country: 'United Kingdom',
      artists: ['The Vinyl Gardener'],
      genres: [{ name: 'Balearic', confidence: 90 }, { name: 'nu disco', confidence: 84 }],
      event_type: 'day_party',
      ticket_url: 'https://tickets.example/checkout/sundown',
      price_from: 12, currency: 'GBP',
      field_confidence: { title: 88, date: 85, start_time: 80, venue: 82, city: 85, genres: 88 },
    };
    const out = await runExtractionPipeline(urlB, {
      fetcher: mockFetcher({ [urlB]: { body: OG_ONLY_PAGE } }),
      ai: mockAI({ [urlB]: proposal }),
    });
    check('AI-assisted extraction succeeds', out.status === 'succeeded' && !!out.eventId);
    const ev = (await q(`select * from events where id = $1`, [out.eventId]))[0] as Record<string, unknown>;
    check('OG title kept (structured beats AI)', ev.title === 'Sundown Sessions');
    const startIso = new Date(ev.start_at as string).toISOString();
    const expectedStart = zonedTimeToUtc(
      Number(futureDate.slice(0, 4)), Number(futureDate.slice(5, 7)), Number(futureDate.slice(8, 10)),
      15, 0, 'Europe/London'
    ).toISOString();
    check('AI local time interpreted in event tz', startIso === expectedStart);
    check('same-day end resolved (15:00→22:00)', new Date(ev.end_at as string).getTime() - new Date(ev.start_at as string).getTime() === 7 * 3600_000);
    const venue = (await q(`select id, name from venues where id = $1`, [ev.venue_id]))[0] as { id: string; name: string };
    const seededVenue = (await q(`select id from venues where slug = 'paradise-wharf'`))[0] as { id: string };
    check('existing venue reused, not duplicated', venue.id === seededVenue.id);
    const venueCount = await q(`select count(*)::int as n from venues where lower(name) like 'paradise wharf%'`);
    check('no venue formatting duplicates', (venueCount[0] as { n: number }).n === 1);
    const ex = (await q(`select field_sources from extractions where event_id = $1`, [out.eventId]))[0] as { field_sources: Record<string, string> };
    check('AI provenance recorded for date', ex.field_sources.date === 'ai');
    check('entity-match provenance for venue', ex.field_sources.venue === 'entity-match');
  }

  // -------------------------------------------------------------------------
  console.log('\n— pipeline: midnight crossing + multi-day festival —');
  {
    const urlNight = 'https://promoter-c.example/events/all-nighter';
    const nightProposal = {
      is_event: true, is_music_event: true, title: 'All Nighter',
      start_date: futureDate, start_time: '23:00', end_time: '06:00',
      city: 'Leeds', country: 'United Kingdom',
      genres: [{ name: 'Jungle', confidence: 92 }],
      field_confidence: { title: 85, date: 85, city: 80, genres: 90 },
    };
    const out1 = await runExtractionPipeline(urlNight, {
      fetcher: mockFetcher({ [urlNight]: { body: '<html><title>All Nighter</title><body><main>All Nighter</main></body></html>' } }),
      ai: mockAI({ [urlNight]: nightProposal }),
    });
    const ev1 = (await q(`select start_at, end_at from events where id = $1`, [out1.eventId]))[0] as Record<string, string>;
    check('midnight crossing: end rolls to next day', new Date(ev1.end_at).getTime() - new Date(ev1.start_at).getTime() === 7 * 3600_000);

    const festStart = `${futureDate}T12:00:00+01:00`;
    const festEndDate = new Date(FUTURE.getTime() + 2 * 86400_000).toISOString().slice(0, 10);
    const urlFest = 'https://festival.example/events/three-dayer';
    const out2 = await runExtractionPipeline(urlFest, {
      fetcher: mockFetcher({
        [urlFest]: { body: JSONLD_PAGE({ title: 'Three Dayer Festival', startDate: festStart, endDate: `${festEndDate}T23:00:00+01:00`, venue: 'Festival Field', city: 'Norwich', canonical: urlFest, ticketUrl: 'https://tickets.example/fest' }) },
      }),
      ai: mockAI({ default: { ...baseProposal, event_type: 'festival' } }),
    });
    const ev2 = (await q(`select start_at, end_at, event_type from events where id = $1`, [out2.eventId]))[0] as Record<string, string>;
    const spanDays = (new Date(ev2.end_at).getTime() - new Date(ev2.start_at).getTime()) / 86400_000;
    check('multi-day festival span preserved', spanDays > 1.9 && spanDays < 2.6);
    check('festival type from JSON-LD subtype', ev2.event_type === 'festival');
  }

  // -------------------------------------------------------------------------
  console.log('\n— pipeline: honest gaps (no invention) —');
  {
    const urlGap = 'https://promoter-d.example/events/mystery';
    const gapProposal = {
      is_event: true, is_music_event: true, title: 'Mystery Basement Session',
      start_date: futureDate, // no time, no end, no venue, no price, no promoter
      city: 'Glasgow', country: 'United Kingdom',
      genres: [{ name: 'Techno', confidence: 88 }],
      field_confidence: { title: 82, date: 78, city: 80, genres: 88 },
    };
    const out = await runExtractionPipeline(urlGap, {
      fetcher: mockFetcher({ [urlGap]: { body: '<html><title>Mystery</title><body><main>Basement soon</main></body></html>' } }),
      ai: mockAI({ [urlGap]: gapProposal }),
    });
    const ev = (await q(`select * from events where id = $1`, [out.eventId]))[0] as Record<string, unknown>;
    check('missing end time stays null', ev.end_at === null);
    check('missing venue stays null', ev.venue_id === null);
    check('missing price stays null', ev.price_from === null && ev.currency === null);
    check('missing ticket URL stays null (never source URL)', ev.ticket_url === null);
    check('missing promoter stays null', ev.promoter_id === null);
    const ex = (await q(`select warnings from extractions where event_id = $1`, [out.eventId]))[0] as { warnings: string[] };
    check('date-only start carries warning into moderation', ex.warnings.some((w) => /start time unknown/.test(w)));
  }

  // -------------------------------------------------------------------------
  console.log('\n— pipeline: unknown genre suggestion + promoter reuse —');
  {
    const urlU = 'https://promoter-a.example/events/second-night';
    const proposal = {
      is_event: true, is_music_event: true, title: 'Second Night',
      start_date: new Date(FUTURE.getTime() + 7 * 86400_000).toISOString().slice(0, 10),
      start_time: '22:00',
      venue_name: 'The Pressing Plant', city: 'London', country: 'United Kingdom',
      promoter_name: 'Fixture Promotions', promoter_website: 'https://promoter-a.example',
      genres: [{ name: 'liquid funk', confidence: 82 }, { name: 'moombahcore', confidence: 61 }],
      field_confidence: { title: 90, date: 88, venue: 85, city: 88, promoter: 85, genres: 80 },
    };
    const genresBefore = await q(`select count(*)::int as n from genres`);
    const out = await runExtractionPipeline(urlU, {
      fetcher: mockFetcher({ [urlU]: { body: '<html><title>Second Night</title><body><main>Second Night at the Pressing Plant</main></body></html>' } }),
      ai: mockAI({ [urlU]: proposal }),
    });
    check('event created despite unknown genre', out.status === 'succeeded');
    const suggestions = await q(`select suggested_name, status from genre_suggestions where event_id = $1`, [out.eventId]);
    check('UNKNOWN GENRE SUGGESTION queued for admin', suggestions.length === 1 && (suggestions[0] as { suggested_name: string }).suggested_name === 'moombahcore');
    const genreCount = await q(`select count(*)::int as n from genres`);
    check('no genre auto-created', (genreCount[0] as { n: number }).n === (genresBefore[0] as { n: number }).n);
    const ev = (await q(`select status, venue_id, promoter_id from events where id = $1`, [out.eventId]))[0] as Record<string, unknown>;
    check('unknown genre → needs_review queue', ev.status === 'needs_review');
    const venues = await q(`select count(*)::int as n from venues where name = 'The Pressing Plant'`);
    check('venue reused across extractions', (venues[0] as { n: number }).n === 1);
    const promoters = await q(`select count(*)::int as n from promoters where name = 'Fixture Promotions'`);
    check('promoter reused by domain/name', (promoters[0] as { n: number }).n === 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— pipeline: failure states —');
  {
    const mkOut = (url: string, body: string | null, proposal?: unknown, raw?: string) =>
      runExtractionPipeline(url, {
        fetcher: body == null
          ? mockFetcher({})
          : mockFetcher({ [url]: { body } }),
        ai: raw != null
          ? mockAI({}, { raw: { [url]: raw } })
          : proposal !== undefined
            ? mockAI({ [url]: proposal })
            : noAI,
      });

    const badUrl = await runExtractionPipeline('http://localhost/evil', { fetcher: mockFetcher({}), ai: noAI });
    check('unsafe URL recorded as unsafe_url', badUrl.status === 'unsafe_url');
    const nf = await mkOut('https://gone.example/events/x', null);
    check('fetch miss recorded as not_found', nf.status === 'not_found');

    const noTitle = await mkOut(
      'https://promoter-e.example/events/no-title',
      '<html><body><main>something something</main></body></html>',
      { is_event: true, is_music_event: true, start_date: futureDate, field_confidence: {} }
    );
    check('missing title → insufficient_information', noTitle.status === 'insufficient_information');

    const badDate = await mkOut(
      'https://promoter-e.example/events/bad-date',
      JSONLD_PAGE({ title: 'Bad Date Night', startDate: 'sometime in summer', canonical: 'https://promoter-e.example/events/bad-date' }),
      baseProposal
    );
    check('unparseable date → invalid_date', badDate.status === 'invalid_date');

    const malformed = await mkOut(
      'https://promoter-e.example/events/malformed-ai',
      '<html><title>Night</title><body><main>a night with no structure</main></body></html>',
      undefined,
      'I refuse to produce JSON.'
    );
    check('malformed AI JSON without structured fallback → ai_extraction_failed', malformed.status === 'ai_extraction_failed');

    const malformedWithLd = await mkOut(
      'https://promoter-e.example/events/malformed-ai-ld',
      JSONLD_PAGE({ title: 'Resilient Night', canonical: 'https://promoter-e.example/events/malformed-ai-ld', ticketUrl: 'https://tickets.example/res' }),
      undefined,
      '{"broken": '
    );
    // The fixture shares venue/date/lineup with an earlier event, so the
    // draft may legitimately carry a duplicate flag — the point is that
    // structured data alone still produced a reviewable draft.
    check('malformed AI JSON with structured data → draft still created',
      ['succeeded', 'possible_duplicate'].includes(malformedWithLd.status) && malformedWithLd.eventId != null);
    const resEv = (await q(`select status from events where id = $1`, [malformedWithLd.eventId]))[0] as { status: string };
    check('degraded extraction lands in review, never live', resEv.status !== 'live');

    const notEvent = await mkOut(
      'https://promoter-e.example/shop',
      '<html><title>Merch shop</title><body><main>t-shirts and records</main></body></html>',
      { is_event: false, field_confidence: {} }
    );
    check('non-event page → not_an_event', notEvent.status === 'not_an_event');

    const irrelevant = await mkOut(
      'https://theatre.example/events/play',
      '<html><title>A Play</title><body><main>A three act play, eight pm</main></body></html>',
      {
        is_event: true, is_music_event: false, title: 'A Serious Play',
        start_date: futureDate, start_time: '19:30', city: 'London', country: 'United Kingdom',
        genres: [], field_confidence: { title: 90, date: 88, city: 85 },
      }
    );
    check('irrelevant event → not_relevant (kept out of queue)', irrelevant.status === 'not_relevant');
    const irrelevantEvents = await q(`select count(*)::int as n from events where title = 'A Serious Play'`);
    check('irrelevant event creates no event row', (irrelevantEvents[0] as { n: number }).n === 0);
    const irrelevantEx = await q(`select relevance, failure_detail from extractions where url = 'https://theatre.example/events/play'`);
    check('irrelevance reason preserved for source analysis', (irrelevantEx[0] as { relevance: string }).relevance === 'not_relevant');
  }

  // -------------------------------------------------------------------------
  console.log('\n— source scanning (HTML + seen URLs + RSS) —');
  let sourceAId: string;
  {
    // Deterministic candidate identification (pure).
    const links = identifyCandidateLinks(LISTING_PAGE, 'https://promoter-a.example/whats-on');
    check('event-like links identified', links.includes('https://promoter-a.example/events/warehouse-frequencies') && links.includes('https://promoter-a.example/events/second-night'));
    check('utm params stripped + fragments dropped + deduped', links.filter((l) => l.includes('warehouse-frequencies')).length === 1 && !links.some((l) => l.includes('utm_') || l.includes('#')));
    check('offsite /events links allowed, junk links excluded', links.includes('https://other-site.example/events/away-day') && !links.some((l) => l.includes('/privacy') || l.includes('/news/')));
    check('feed link parsing (RSS)', parseFeedLinks(RSS_FEED, 'https://promoter-b.example/feed.xml').length === 2);
    check('URL canonicalisation strips tracking', canonicaliseCandidateUrl('/e/x?utm_source=a&id=9#frag', 'https://p.example/') === 'https://p.example/e/x?id=9');

    const src = (await q(
      `insert into event_sources (source_type, name, url) values ('promoter_website', 'Promoter A', 'https://promoter-a.example/whats-on') returning id`
    ))[0] as { id: string };
    sourceAId = src.id;

    const scanFetcher = mockFetcher({
      'https://promoter-a.example/whats-on': { body: LISTING_PAGE },
      // warehouse-frequencies already exists → exact dup link; second-night already extracted above → dup too.
      'https://promoter-a.example/events/warehouse-frequencies': { body: JSONLD_PAGE({ canonical: urlA }) },
      'https://promoter-a.example/events/second-night': { body: '<html><title>Second Night</title><body><main>Second Night</main></body></html>' },
      'https://other-site.example/events/away-day': {
        body: JSONLD_PAGE({ title: 'Away Day', startDate: `${futureDate}T14:00:00+01:00`, endDate: null, venue: 'Away Field', city: 'Margate', canonical: 'https://other-site.example/events/away-day', ticketUrl: 'https://tickets.example/away' }),
      },
    });
    const scanAI = mockAI({
      default: baseProposal,
      'https://promoter-a.example/events/second-night': {
        is_event: true, is_music_event: true, title: 'Second Night',
        start_date: new Date(FUTURE.getTime() + 7 * 86400_000).toISOString().slice(0, 10), start_time: '22:00',
        venue_name: 'The Pressing Plant', city: 'London', country: 'United Kingdom',
        genres: [{ name: 'Techno', confidence: 90 }],
        field_confidence: { title: 90, date: 88, venue: 85, city: 88, genres: 88 },
      },
    });

    const scan1 = await scanSource(sourceAId, { fetcher: scanFetcher, ai: scanAI, delayMs: 1 });
    check('scan succeeds via HTML', scan1.status === 'succeeded' && scan1.method === 'html');
    check('candidates counted', scan1.candidatesFound === 3);
    check('all candidates new on first scan', scan1.newCandidates === 3);
    check('duplicates linked during scan, not recreated', scan1.duplicates === 2);
    check('new event extracted from scan', scan1.extracted === 1);
    const awayEvent = await q(`select id, source_id, status from events where title = 'Away Day'`);
    check('scanned event carries its source', awayEvent.length === 1 && (awayEvent[0] as { source_id: string }).source_id === sourceAId);
    // An advertised feed is a fallback, not an upgrade: while the listing page
    // is yielding events, adopting the site's generic feed would quietly
    // redirect every later scan away from the page that works.
    const feedSaved = (await q(`select feed_url from event_sources where id = $1`, [sourceAId]))[0] as { feed_url: string | null };
    check('advertised feed ignored while the listing page is working', feedSaved.feed_url === null);

    // Second scan: everything already seen.
    const scan2 = await scanSource(sourceAId, {
      fetcher: mockFetcher({
        'https://promoter-a.example/whats-on': { body: LISTING_PAGE },
        'https://promoter-a.example/feed.xml': { body: LISTING_PAGE }, // feed_url now set; serve HTML → falls back? it's html content
      }),
      ai: noAI, delayMs: 1,
    });
    check('already-seen URLs skipped on rescan', scan2.newCandidates === 0 && scan2.extracted === 0);
    const scanRows = await q(`select count(*)::int as n from source_scans where source_id = $1`, [sourceAId]);
    check('scan metrics recorded per scan', (scanRows[0] as { n: number }).n === 2);
  }

  // RSS-first source.
  {
    const src = (await q(
      `insert into event_sources (source_type, name, url) values ('rss_feed', 'Promoter B feed', 'https://promoter-b.example/feed.xml') returning id`
    ))[0] as { id: string };
    const feedProposal = (title: string) => ({
      is_event: true, is_music_event: true, title,
      start_date: new Date(FUTURE.getTime() + 14 * 86400_000).toISOString().slice(0, 10), start_time: '21:00',
      city: 'Bristol', country: 'United Kingdom',
      genres: [{ name: 'Breaks', confidence: 85 }],
      field_confidence: { title: 88, date: 85, city: 85, genres: 85 },
    });
    const scan = await scanSource(src.id, {
      fetcher: mockFetcher({
        'https://promoter-b.example/feed.xml': { body: RSS_FEED, contentType: 'application/rss+xml' },
        'https://promoter-b.example/events/feed-night-one': { body: '<html><title>Feed Night One</title><body><main>one</main></body></html>' },
        'https://promoter-b.example/events/feed-night-two': { body: '<html><title>Feed Night Two</title><body><main>two</main></body></html>' },
      }),
      ai: mockAI({
        'https://promoter-b.example/events/feed-night-one': feedProposal('Feed Night One'),
        'https://promoter-b.example/events/feed-night-two': feedProposal('Feed Night Two'),
      }),
      delayMs: 1,
    });
    check('RSS scan detected and used', scan.status === 'succeeded' && scan.method === 'rss');
    check('RSS entries extracted', scan.extracted === 2 && scan.candidatesFound === 2);
  }

  // Source with no event links at all.
  {
    const src = (await q(
      `insert into event_sources (source_type, name, url) values ('blog_publication', 'Quiet blog', 'https://quiet.example/') returning id`
    ))[0] as { id: string };
    const scan = await scanSource(src.id, {
      fetcher: mockFetcher({
        'https://quiet.example/': { body: '<html><body><main><a href="/about">About us</a><p>No events here.</p></main></body></html>' },
      }),
      ai: noAI, delayMs: 1,
    });
    check('source with no events → clean empty scan', scan.status === 'succeeded' && scan.candidatesFound === 0 && scan.failed === 0);
  }

  // Listing page with no event links, but a working advertised feed: this is
  // the one case where the feed IS adopted, so later scans use it.
  {
    const src = (await q(
      `insert into event_sources (source_type, name, url) values ('promoter_website', 'Feed fallback', 'https://fallback.example/whats-on') returning id`
    ))[0] as { id: string };
    await scanSource(src.id, {
      fetcher: mockFetcher({
        'https://fallback.example/whats-on': {
          body: `<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>
<body><main><a href="/about">About</a></main></body></html>`,
        },
        'https://fallback.example/feed.xml': {
          body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Fallback</title>
<item><title>Night</title><link>https://fallback.example/events/night</link></item></channel></rss>`,
          contentType: 'application/rss+xml',
        },
        'https://fallback.example/events/night': { body: '<html><title>Night</title><body><main>night</main></body></html>' },
      }),
      ai: noAI, delayMs: 1,
    });
    const adopted = (await q(`select feed_url from event_sources where id = $1`, [src.id]))[0] as { feed_url: string | null };
    check('advertised feed adopted when the listing page finds nothing',
      adopted.feed_url === 'https://fallback.example/feed.xml', JSON.stringify(adopted));
  }

  // -------------------------------------------------------------------------
  console.log('\n— trusted-source auto-publish rules —');
  {
    const src = (await q(
      `insert into event_sources (source_type, name, url, trust)
       values ('promoter_website', 'Trusted Promoter', 'https://trusted.example/events', 'trusted') returning id`
    ))[0] as { id: string };
    const urlT = 'https://trusted.example/events/big-room-night';
    const out = await runExtractionPipeline(urlT, {
      sourceId: src.id, scanKind: 'source_scan',
      fetcher: mockFetcher({
        [urlT]: { body: JSONLD_PAGE({ title: 'Big Room Night', venue: 'Trusted Hall', city: 'Manchester', canonical: urlT, ticketUrl: 'https://tickets.example/brn' }) },
      }),
      ai: mockAI({ default: { ...baseProposal, genres: [{ name: 'Techno', confidence: 95 }] } }),
    });
    check('trusted source + clean extraction → auto-published', out.autoPublished);
    const ev = (await q(`select status, published_at from events where id = $1`, [out.eventId]))[0] as Record<string, unknown>;
    check('auto-published event is live with timestamp', ev.status === 'live' && ev.published_at != null);

    // Same trusted source, but the event collides with an existing one.
    const urlT2 = 'https://trusted.example/events/big-room-night-again';
    const out2 = await runExtractionPipeline(urlT2, {
      sourceId: src.id, scanKind: 'source_scan',
      fetcher: mockFetcher({
        [urlT2]: { body: JSONLD_PAGE({ title: 'Big Room Night', venue: 'Trusted Hall', city: 'Manchester', canonical: urlT2, ticketUrl: null }) },
      }),
      ai: mockAI({ default: { ...baseProposal, genres: [{ name: 'Techno', confidence: 95 }] } }),
    });
    check('auto-publish blocked by duplicate warning', !out2.autoPublished);
    if (out2.eventId) {
      const ev2 = (await q(`select status from events where id = $1`, [out2.eventId]))[0] as { status: string };
      check('duplicate lands in needs_review instead', ev2.status === 'needs_review');
    } else {
      check('duplicate lands in needs_review instead', out2.status === 'duplicate_linked');
    }

    // Low-confidence extraction from the same trusted source stays in review.
    const urlT3 = 'https://trusted.example/events/vague-night';
    const out3 = await runExtractionPipeline(urlT3, {
      sourceId: src.id, scanKind: 'source_scan',
      fetcher: mockFetcher({ [urlT3]: { body: '<html><title>Vague Night</title><body><main>details tba</main></body></html>' } }),
      ai: mockAI({
        default: {
          is_event: true, is_music_event: true, title: 'Vague Night',
          start_date: futureDate, city: 'Manchester', country: 'United Kingdom',
          genres: [{ name: 'House', confidence: 55 }],
          field_confidence: { title: 60, date: 55, city: 50, genres: 55 },
        },
      }),
    });
    check('low confidence → review queue even when trusted', !out3.autoPublished && out3.eventId != null);
  }

  // -------------------------------------------------------------------------
  console.log('\n— source discovery (suggestions are never trusted) —');
  {
    const fake = (text: string): DiscoveryClient => ({
      available: true,
      async propose() { return { ok: true, text, model: 'fake' }; },
    });
    const req = { country: 'Tanzania', city: 'Dar es Salaam', genres: ['House'], limit: 5 };

    const good = await discoverSources(req, fake(JSON.stringify({
      candidates: [
        { name: 'Elements Club', url: 'https://elements.example/events', kind: 'venue_website',
          city: 'Dar es Salaam', country: 'Tanzania', genres: ['House'], note: 'Weekly house night' },
      ],
    })));
    check('discovery returns a normalised candidate',
      good.ok && good.candidates.length === 1 && good.candidates[0].url === 'https://elements.example/events');

    // Aggregators and ticketing platforms are exactly what the independent
    // event graph exists to avoid, so they never survive normalisation.
    const banned = normaliseCandidates({ candidates: [
      { name: 'RA listing', url: 'https://ra.co/clubs/123' },
      { name: 'Eventbrite', url: 'https://www.eventbrite.co.uk/d/tanzania/music' },
      { name: 'Real club', url: 'https://realclub.example/whats-on' },
    ] }, req);
    check('aggregator suggestions are dropped',
      banned.length === 1 && banned[0].url === 'https://realclub.example/whats-on');
    check('banned-host check covers subdomains', isBannedCandidateHost('www.dice.fm') && isBannedCandidateHost('m.facebook.com'));

    const junk = normaliseCandidates({ candidates: [
      { name: 'No scheme', url: 'notaurl' },
      { name: 'Local', url: 'javascript:alert(1)' },
      { name: 'Dupe', url: 'https://dupe.example/events' },
      { name: 'Dupe again', url: 'https://dupe.example/events/' },
    ] }, req);
    check('malformed and duplicate suggestions are dropped',
      junk.length === 1 && junk[0].url === 'https://dupe.example/events');

    // Any ONE of the requested genres is enough to qualify a place: a drum &
    // bass club belongs in the results of a house/techno/d&b search.
    check('the request tells the model any one genre is enough',
      buildDiscoveryUser({ ...req, genres: ['House', 'Techno'] }).includes('any one of these is enough'));
    check('the system prompt states the any-of matching rule',
      /ANY ONE of the requested genres/.test(DISCOVERY_SYSTEM_PROMPT)
      && /does not have to cover them all/i.test(DISCOVERY_SYSTEM_PROMPT));

    // What an added source gets TAGGED with comes from the candidate itself,
    // matched against our own taxonomy — never a name we do not have.
    const taxonomy = [
      { id: '11111111-1111-1111-1111-111111111111', name: 'House' },
      { id: '22222222-2222-2222-2222-222222222222', name: 'Drum & Bass' },
    ];
    check('candidate genres map onto our taxonomy',
      matchGenreIdsByName(['house', ' Drum & Bass '], taxonomy).length === 2);
    check('unknown genre names are dropped, not invented',
      matchGenreIdsByName(['Polka', 'House'], taxonomy).join() === taxonomy[0].id);

    const unavailable = await discoverSources(req, { available: false, async propose() { return { ok: false, detail: 'no key' }; } });
    check('discovery says so when no API key is configured', !unavailable.ok && unavailable.error === 'unavailable');
    const garbled = await discoverSources(req, fake('sorry, I cannot help with that'));
    check('unparseable model output is an error, not a candidate', !garbled.ok);
  }

  // -------------------------------------------------------------------------
  console.log('\n— a source earns its polling schedule —');
  {
    const mk = async (name: string, url: string) => (await q(
      `insert into event_sources (source_type, name, url, trust) values ('promoter_website', $1, $2, 'trusted') returning id`,
      [name, url]
    ))[0] as { id: string };
    const polling = async (id: string) => ((await q(`select polling_enabled from event_sources where id = $1`, [id]))[0] as { polling_enabled: boolean }).polling_enabled;

    const listing = (host: string) => `<html><body><main>
      <a href="${host}/events/earned-night">Earned Night — ${futureDate}</a></main></body></html>`;
    const eventProposal = {
      is_event: true, is_music_event: true, title: 'Earned Night',
      start_date: FUTURE.toISOString().slice(0, 10), start_time: '22:00',
      city: 'Leeds', country: 'United Kingdom',
      genres: [{ name: 'Techno', confidence: 88 }],
      field_confidence: { title: 90, date: 88, city: 85, genres: 85 },
    };

    // A scan that finds nothing leaves the source off the schedule.
    const quiet = await mk('Quiet source', 'https://quiet-earner.example/whats-on');
    const quietScan = await scanSource(quiet.id, {
      fetcher: mockFetcher({ 'https://quiet-earner.example/whats-on': { body: '<html><body><main><a href="/about">About</a></main></body></html>' } }),
      ai: noAI, delayMs: 1,
    });
    check('a scan that finds nothing does not start polling',
      quietScan.startedPolling === false && (await polling(quiet.id)) === false);

    // A scan that brings back an event does.
    const good = await mk('Earning source', 'https://earner.example/whats-on');
    const goodScan = await scanSource(good.id, {
      fetcher: mockFetcher({
        'https://earner.example/whats-on': { body: listing('https://earner.example') },
        'https://earner.example/events/earned-night': { body: '<html><title>Earned Night</title><body><main>x</main></body></html>' },
      }),
      ai: mockAI({ 'https://earner.example/events/earned-night': eventProposal }),
      delayMs: 1,
    });
    check('the first productive scan starts polling',
      goodScan.extracted === 1 && goodScan.startedPolling === true && (await polling(good.id)) === true);

    // Once the admin has had their say, nothing here overrides it: an admin
    // who switches polling off does not get it switched back on by a rescan.
    await q(`update event_sources set polling_enabled = false where id = $1`, [good.id]);
    const rescan = await scanSource(good.id, {
      fetcher: mockFetcher({
        'https://earner.example/whats-on': { body: listing('https://earner.example') },
      }),
      ai: noAI, delayMs: 1,
    });
    check('a later scan never overrides the admin turning polling off',
      rescan.startedPolling === false && (await polling(good.id)) === false);
  }

  // -------------------------------------------------------------------------
  console.log('\n— finding the real listing page when a suggested path misses —');
  {
    const home = `<html><body>
      <nav><a href="/about">About us</a><a href="/en/agenda">Agenda</a><a href="/contact">Contact</a></nav>
      <a href="https://tickets.example/buy">Tickets</a>
    </body></html>`;
    check('a listing link is found on the homepage',
      findListingLink(home, 'https://club.example/') === 'https://club.example/en/agenda');
    check('offsite links are never offered as the listing page',
      findListingLink('<html><body><a href="https://other.example/agenda">Agenda</a></body></html>',
        'https://club.example/') === null);
    check('a homepage with nothing listing-shaped yields nothing',
      findListingLink('<html><body><a href="/about">About</a><a href="/jobs">Jobs</a></body></html>',
        'https://club.example/') === null);
    // Link text alone is enough — plenty of sites use /p/1234 for the agenda.
    check('link text counts when the path says nothing',
      findListingLink('<html><body><a href="/p/1234">What\u2019s on</a></body></html>',
        'https://club.example/') === 'https://club.example/p/1234');
    check('a short matching path beats a deep one',
      findListingLink(`<html><body><a href="/news/2019/agenda-archive">Agenda archive</a>
        <a href="/agenda">Agenda</a></body></html>`, 'https://club.example/')
        === 'https://club.example/agenda');
  }

  // -------------------------------------------------------------------------
  console.log('\n— workbench vs live split —');
  {
    const base = { active: true, polling_enabled: true, failure_count: 0, events_found: 4, linked_events: 2 };
    check('polling + producing = live', isLiveSource(base));
    check('paused source stays on the bench', !isLiveSource({ ...base, active: false }));
    check('not polling stays on the bench', !isLiveSource({ ...base, polling_enabled: false }));
    check('failing source stays on the bench', !isLiveSource({ ...base, failure_count: 3 }));
    check('polling but finding nothing stays on the bench',
      !isLiveSource({ ...base, events_found: 0, linked_events: 0 }));

    const probe = (ok: boolean, candidates: number | null) => ({
      target: 'https://x.example/events',
      bot: { ok, status: ok ? 200 : null, code: ok ? null : 'dns', detail: null, ms: 10 },
      browser: { ok: false, status: null, code: 'dns', detail: null, ms: 10 },
      method: ok ? ('html' as const) : null,
      candidates,
    });
    check('a candidate with event links reads as OK', !testVerdict(probe(true, 3)).bad);
    check('a reachable page with no event links reads as a problem', testVerdict(probe(true, 0)).bad);
    check('an unreachable candidate reads as a problem', testVerdict(probe(false, null)).bad);
  }

  // -------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exitCode = 1;
  }
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
