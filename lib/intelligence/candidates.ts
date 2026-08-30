// DETERMINISTIC DISCOVERY. The database proposes; the AI only narrates.
//
// Every generator here is plain SQL over real Guestlist signals with
// explicit thresholds. When nothing crosses a threshold the honest result
// is NO opportunities — @guestlist is allowed to say nothing.

import { query, queryOne } from '../db';
import { weekendWindow } from '../recommend';
import { heatForEvents } from '../heat';
import { buildEvidencePack } from './evidence';
import {
  OPPORTUNITY_TYPE_WEIGHTS, type Confidence, type EvidencePack, type OpportunityType,
} from './types';

// Central thresholds — editorial policy, tunable in one place.
export const DISCOVERY_THRESHOLDS = {
  tonightPickGoing: 5,        // a single event worth calling out tonight
  patternMinEvents: 3,        // same genre+city cluster = a pattern
  weekendPatternMinEvents: 4,
  momentumGoing6h: 3,         // velocity, not size
  momentumClicks24h: 5,
  notableLineupArtists: 4,
  newEventMaxAgeHours: 48,
  iwasThereMin: 3,            // public marks only
  promoterActivityEvents: 2,
  cityMomentMinEvents: 5,
  opportunityTtlHours: 24,
} as const;

type Candidate = {
  type: OpportunityType;
  headline: string;
  reason: string;
  suggestedAngle: string | null;
  signal: number;             // raw strength, scaled by type weight for score
  confidence: Confidence;
  city?: string | null;
  locationId?: string | null;
  genres?: string[];
  eventIds?: string[];
  artistNames?: string[];
  promoterIds?: string[];
  archiveEventIds?: string[];
  archiveMediaIds?: string[];
  aggregates?: Record<string, number | string | null>;
  fingerprint: string;
  expiresAt: Date;
};

const TONIGHT_SQL = `
  e.status = 'live' and e.listing_status <> 'cancelled'
  and e.start_at < now() + interval '24 hours'
  and coalesce(e.end_at, e.start_at + interval '6 hours') > now()
`;

const endOfTonight = () => new Date(Date.now() + 24 * 3600_000);
const inHours = (h: number) => new Date(Date.now() + h * 3600_000);
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------

async function tonightPatterns(): Promise<Candidate[]> {
  const t = DISCOVERY_THRESHOLDS;
  const rows = await query<{ city: string; genre: string; n: number; event_ids: string[] }>(
    `select e.city, g.name as genre, count(distinct e.id)::int as n,
            array_agg(distinct e.id) as event_ids
       from events e
       join event_genres eg on eg.event_id = e.id
       join genres g on g.id = eg.genre_id and g.parent_genre_id is null
      where ${TONIGHT_SQL} and e.city is not null
      group by e.city, g.name
     having count(distinct e.id) >= $1
      order by n desc limit 5`,
    [t.patternMinEvents]
  );
  return rows.map((r) => ({
    type: 'TONIGHT_PATTERN' as const,
    headline: `${r.genre} is unusually strong in ${r.city} tonight`,
    reason: `${r.n} ${r.genre} events tonight in ${r.city} — the strongest single-genre cluster today`,
    suggestedAngle: `${r.city}'s unusually strong for ${r.genre.toLowerCase()} tonight.`,
    signal: r.n,
    confidence: (r.n >= t.patternMinEvents + 2 ? 'high' : 'medium') as Confidence,
    city: r.city,
    genres: [r.genre],
    eventIds: r.event_ids.slice(0, 6),
    aggregates: { pattern_event_count: r.n, city: r.city, genre: r.genre },
    fingerprint: `TONIGHT_PATTERN:${r.city}:${r.genre}:${today()}`,
    expiresAt: endOfTonight(),
  }));
}

async function weekendPatterns(): Promise<Candidate[]> {
  const t = DISCOVERY_THRESHOLDS;
  const w = weekendWindow();
  if (w.from.getTime() < Date.now() + 3600_000) return []; // tonight owns the weekend once it starts
  const rows = await query<{ city: string; genre: string; n: number; event_ids: string[] }>(
    `select e.city, g.name as genre, count(distinct e.id)::int as n,
            array_agg(distinct e.id) as event_ids
       from events e
       join event_genres eg on eg.event_id = e.id
       join genres g on g.id = eg.genre_id and g.parent_genre_id is null
      where e.status = 'live' and e.listing_status <> 'cancelled'
        and e.start_at between $1 and $2 and e.city is not null
      group by e.city, g.name
     having count(distinct e.id) >= $3
      order by n desc limit 3`,
    [w.from, w.to, t.weekendPatternMinEvents]
  );
  return rows.map((r) => ({
    type: 'WEEKEND_PATTERN' as const,
    headline: `A strong ${r.genre} weekend is shaping up in ${r.city}`,
    reason: `${r.n} ${r.genre} events across the coming weekend in ${r.city}`,
    suggestedAngle: `If you're into ${r.genre.toLowerCase()}, this weekend in ${r.city} has become complicated.`,
    signal: r.n,
    confidence: 'medium' as Confidence,
    city: r.city,
    genres: [r.genre],
    eventIds: r.event_ids.slice(0, 6),
    aggregates: { weekend_event_count: r.n, city: r.city, genre: r.genre },
    fingerprint: `WEEKEND_PATTERN:${r.city}:${r.genre}:${w.from.toISOString().slice(0, 10)}`,
    expiresAt: w.to,
  }));
}

async function momentumEvents(): Promise<Candidate[]> {
  const t = DISCOVERY_THRESHOLDS;
  const upcoming = await query<{ id: string; title: string; city: string | null }>(
    `select id, title, city from events e
      where e.status = 'live' and e.listing_status <> 'cancelled'
        and e.start_at between now() and now() + interval '30 days'
      limit 200`
  );
  if (!upcoming.length) return [];
  const heat = await heatForEvents(upcoming.map((e) => e.id));
  const out: Candidate[] = [];
  for (const e of upcoming) {
    const h = heat.get(e.id);
    if (!h) continue;
    // Velocity over size: acceleration is the signal, not raw totals.
    if (h.signals.goingLast6h >= t.momentumGoing6h || h.signals.ticketClicks24h >= t.momentumClicks24h) {
      out.push({
        type: 'EVENT_MOMENTUM',
        headline: `${e.title} is picking up real momentum`,
        reason: [
          h.signals.goingLast6h >= t.momentumGoing6h && `Going +${h.signals.goingLast6h} in six hours`,
          h.signals.ticketClicks24h >= t.momentumClicks24h && `${h.signals.ticketClicks24h} ticket clicks in 24h`,
          `${h.signals.views24h} views in 24h`,
        ].filter(Boolean).join(' · '),
        suggestedAngle: null,
        signal: h.signals.goingLast6h * 2 + h.signals.ticketClicks24h,
        confidence: h.signals.goingLast6h >= t.momentumGoing6h * 2 ? 'high' : 'medium',
        city: e.city,
        eventIds: [e.id],
        aggregates: {
          going_6h: h.signals.goingLast6h, ticket_clicks_24h: h.signals.ticketClicks24h,
          views_24h: h.signals.views24h,
        },
        fingerprint: `EVENT_MOMENTUM:${e.id}:${today()}`,
        expiresAt: inHours(DISCOVERY_THRESHOLDS.opportunityTtlHours),
      });
    }
  }
  return out.sort((a, b) => b.signal - a.signal).slice(0, 5);
}

async function notableLineups(): Promise<Candidate[]> {
  const t = DISCOVERY_THRESHOLDS;
  const rows = await query<{ id: string; title: string; city: string | null; n: number; artists: string[] }>(
    `select e.id, e.title, e.city, count(ea.artist_id)::int as n,
            array_agg(a.name order by ea.position) as artists
       from events e
       join event_artists ea on ea.event_id = e.id
       join artists a on a.id = ea.artist_id
      where e.status = 'live' and e.listing_status <> 'cancelled'
        and e.start_at between now() and now() + interval '30 days'
      group by e.id
     having count(ea.artist_id) >= $1
      order by n desc limit 4`,
    [t.notableLineupArtists]
  );
  return rows.map((r) => ({
    type: 'NOTABLE_LINEUP' as const,
    headline: `${r.title} has stacked a serious lineup`,
    reason: `${r.n} artists billed: ${r.artists.slice(0, 5).join(', ')}${r.n > 5 ? '…' : ''}`,
    suggestedAngle: `We weren't expecting this lineup.`,
    signal: r.n,
    confidence: 'medium' as Confidence,
    city: r.city,
    eventIds: [r.id],
    artistNames: r.artists,
    aggregates: { lineup_size: r.n },
    fingerprint: `NOTABLE_LINEUP:${r.id}`,
    expiresAt: inHours(7 * 24),
  }));
}

async function worthTravelling(): Promise<Candidate[]> {
  const rows = await query<{ id: string; title: string; city: string | null }>(
    `select id, title, city from events
      where status = 'live' and listing_status <> 'cancelled' and worth_travelling
        and start_at between now() and now() + interval '45 days'
      order by start_at limit 3`
  );
  return rows.map((r) => ({
    type: 'WORTH_TRAVELLING_FOR' as const,
    headline: `${r.title} is worth travelling for`,
    reason: `Curated as worth travelling for${r.city ? ` — ${r.city}` : ''}`,
    suggestedAngle: 'This is worth travelling for.',
    signal: 3,
    confidence: 'high' as Confidence,
    city: r.city,
    eventIds: [r.id],
    fingerprint: `WORTH_TRAVELLING_FOR:${r.id}`,
    expiresAt: inHours(7 * 24),
  }));
}

async function onThisNight(): Promise<Candidate[]> {
  // Exact-dated archive events whose calendar day matches today, any year.
  const rows = await query<{
    id: string; title: string; year: number; city: string | null; display_date: string;
    media_ids: string[];
  }>(
    `select ae.id, ae.title, ae.year, ae.city, ae.display_date,
            coalesce((select array_agg(m.id) from archive_media m
                        join archive_items i on i.id = m.item_id and i.status = 'published'
                       where i.archive_event_id = ae.id and not m.hidden), '{}') as media_ids
       from archive_events ae
      where ae.status = 'published' and ae.date_precision = 'exact'
        and extract(month from ae.start_date) = extract(month from now())
        and extract(day from ae.start_date) = extract(day from now())
      order by ae.year limit 3`
  );
  const thisYear = new Date().getUTCFullYear();
  return rows.map((r) => ({
    type: 'ON_THIS_NIGHT' as const,
    headline: `On this night in ${r.year}: ${r.title}`,
    reason: `${thisYear - r.year} years ago tonight${r.city ? ` in ${r.city}` : ''} — from the Guestlist Archive`,
    suggestedAngle: `On this night in ${r.year}. Were you there?`,
    signal: 5,
    confidence: 'high' as Confidence,
    city: r.city,
    archiveEventIds: [r.id],
    archiveMediaIds: r.media_ids,
    aggregates: { years_ago: thisYear - r.year, year: r.year },
    fingerprint: `ON_THIS_NIGHT:${r.id}:${thisYear}`,
    expiresAt: endOfTonight(),
  }));
}

async function archiveFlyers(): Promise<Candidate[]> {
  // Recently published flyers whose rights permit reuse conversations.
  const rows = await query<{
    media_id: string; archive_event_id: string; title: string; year: number | null;
    display_date: string; rights: string;
  }>(
    `select m.id as media_id, ae.id as archive_event_id, ae.title, ae.year,
            ae.display_date, m.rights
       from archive_media m
       join archive_items i on i.id = m.item_id and i.status = 'published'
         and i.item_type in ('flyer', 'poster')
       join archive_events ae on ae.id = i.archive_event_id and ae.status = 'published'
      where not m.hidden and i.published_at > now() - interval '14 days'
      order by i.published_at desc limit 3`
  );
  return rows.map((r) => ({
    type: 'ARCHIVE_FLYER' as const,
    headline: `A flyer from ${r.display_date} just surfaced: ${r.title}`,
    reason: `Newly published in the Guestlist Archive (rights: ${r.rights})`,
    suggestedAngle: r.year ? `Apparently ${r.year} has entered the chat.` : null,
    signal: 3,
    confidence: 'medium' as Confidence,
    archiveEventIds: [r.archive_event_id],
    archiveMediaIds: [r.media_id],
    fingerprint: `ARCHIVE_FLYER:${r.media_id}`,
    expiresAt: inHours(14 * 24),
  }));
}

async function iWasThereMoments(): Promise<Candidate[]> {
  const t = DISCOVERY_THRESHOLDS;
  const rows = await query<{ id: string; title: string; year: number | null; n: number }>(
    `select ae.id, ae.title, ae.year, count(*)::int as n
       from archive_attendance a
       join members am on am.id = a.member_id
       join archive_events ae on ae.id = a.archive_event_id and ae.status = 'published'
      where a.visibility = 'public'
        and coalesce((select mp.profile_public from member_privacy mp
                       where mp.member_id = am.id), true)
      group by ae.id
     having count(*) >= $1
      order by n desc limit 3`,
    [t.iwasThereMin]
  );
  const month = new Date().toISOString().slice(0, 7);
  return rows.map((r) => ({
    type: 'I_WAS_THERE_MOMENT' as const,
    headline: `${r.n} members were at ${r.title}${r.year ? ` (${r.year})` : ''}`,
    reason: `${r.n} public I WAS THERE marks — living memory gathering around one night`,
    suggestedAngle: 'Were you there?',
    signal: r.n,
    confidence: 'medium' as Confidence,
    archiveEventIds: [r.id],
    aggregates: { i_was_there_public: r.n },
    fingerprint: `I_WAS_THERE_MOMENT:${r.id}:${month}`,
    expiresAt: inHours(30 * 24),
  }));
}

async function promoterActivity(): Promise<Candidate[]> {
  const t = DISCOVERY_THRESHOLDS;
  const rows = await query<{ id: string; name: string; n: number; event_ids: string[] }>(
    `select p.id, p.name, count(e.id)::int as n, array_agg(e.id) as event_ids
       from promoters p
       join events e on e.promoter_id = p.id and e.status = 'live'
        and e.created_at > now() - interval '7 days' and e.listing_status <> 'cancelled'
      group by p.id
     having count(e.id) >= $1
      order by n desc limit 2`,
    [t.promoterActivityEvents]
  );
  const week = new Date().toISOString().slice(0, 10);
  return rows.map((r) => ({
    type: 'PROMOTER_ACTIVITY' as const,
    headline: `${r.name} just announced ${r.n} events`,
    reason: `${r.n} new events from ${r.name} inside a week`,
    suggestedAngle: null,
    signal: r.n,
    confidence: 'medium' as Confidence,
    eventIds: r.event_ids.slice(0, 4),
    promoterIds: [r.id],
    aggregates: { new_event_count: r.n },
    fingerprint: `PROMOTER_ACTIVITY:${r.id}:${week}`,
    expiresAt: inHours(7 * 24),
  }));
}

// ---------------------------------------------------------------------------
// findOpportunities — run every generator, dedupe by fingerprint, persist.
// Honestly returns { created: 0 } when nothing is genuinely interesting.
// ---------------------------------------------------------------------------

export async function findOpportunities(): Promise<{ created: number; considered: number }> {
  const candidates = (await Promise.all([
    tonightPatterns(), weekendPatterns(), momentumEvents(), notableLineups(),
    worthTravelling(), onThisNight(), archiveFlyers(), iWasThereMoments(),
    promoterActivity(),
  ])).flat();

  let created = 0;
  for (const c of candidates) {
    const evidence = await buildEvidencePack({
      eventIds: c.eventIds,
      archiveEventIds: c.archiveEventIds,
      aggregates: c.aggregates,
    });
    const score = OPPORTUNITY_TYPE_WEIGHTS[c.type] * Math.max(1, c.signal);
    const row = await queryOne(
      `insert into intelligence_opportunities
         (type, headline, reason, suggested_angle, score, confidence, city,
          genres, linked_event_ids, linked_artist_names, linked_promoter_ids,
          linked_archive_event_ids, linked_archive_media_ids, evidence,
          fingerprint, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (fingerprint) do nothing
       returning id`,
      [c.type, c.headline, c.reason, c.suggestedAngle, score, c.confidence,
       c.city ?? null, c.genres ?? [], c.eventIds ?? [], c.artistNames ?? [],
       c.promoterIds ?? [], c.archiveEventIds ?? [], c.archiveMediaIds ?? [],
       JSON.stringify(evidence), c.fingerprint, c.expiresAt]
    );
    if (row) created++;
  }
  return { created, considered: candidates.length };
}

export async function expireOpportunities(): Promise<number> {
  const rows = await query<{ id: string }>(
    `update intelligence_opportunities set status = 'expired'
      where status = 'open' and expires_at < now() returning id`
  );
  return rows.length;
}

export type { EvidencePack };
