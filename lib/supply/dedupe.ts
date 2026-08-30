// V2 duplicate detection: multi-signal scoring instead of V1's binary
// title+date check (lib/dedupe.ts remains for the manual admin-create path;
// this module supersedes it for the supply pipeline).
//
// Signals: canonical/source/ticket URL, normalised title similarity, start
// date proximity, venue, city, promoter, lineup overlap. Returns a scored
// state — nothing is ever merged automatically.

import { query } from '@/lib/db';
import { normalizeTitle } from '@/lib/util';
import { supplyConfig } from './config';

export type DuplicateAssessment = {
  state: 'none' | 'possible' | 'likely' | 'exact';
  score: number; // 0–100
  eventId: string | null;
  eventTitle: string | null;
  reasons: string[];
};

export type DuplicateCandidateInput = {
  title: string;
  startAt: Date;
  city: string | null;
  venueId: string | null;
  promoterId: string | null;
  artistNames: string[];
  sourceUrl: string | null;
  canonicalUrl: string | null;
  ticketUrl: string | null;
  excludeEventId?: string | null;
};

function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(' '));
  const tb = new Set(b.split(' '));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : inter / union;
}

export async function assessDuplicate(input: DuplicateCandidateInput): Promise<DuplicateAssessment> {
  const none: DuplicateAssessment = { state: 'none', score: 0, eventId: null, eventTitle: null, reasons: [] };

  // 1. Exact URL identity (source, canonical or ticket URL already known).
  const urls = [input.sourceUrl, input.canonicalUrl, input.ticketUrl].filter((u): u is string => !!u);
  if (urls.length) {
    const rows = await query<{ id: string; title: string }>(
      `select id, title from events
        where status <> 'rejected'
          and ($2::uuid is null or id <> $2)
          and (source_url = any($1) or canonical_url = any($1) or ticket_url = any($1))
        limit 1`,
      [urls, input.excludeEventId ?? null]
    );
    if (rows[0]) {
      return {
        state: 'exact', score: 100, eventId: rows[0].id, eventTitle: rows[0].title,
        reasons: ['same URL already on Guestlist'],
      };
    }
    const links = await query<{ event_id: string; title: string }>(
      `select l.event_id, e.title from event_source_links l
         join events e on e.id = l.event_id
        where l.url = any($1) and e.status <> 'rejected'
          and ($2::uuid is null or e.id <> $2)
        limit 1`,
      [urls, input.excludeEventId ?? null]
    );
    if (links[0]) {
      return {
        state: 'exact', score: 100, eventId: links[0].event_id, eventTitle: links[0].title,
        reasons: ['URL already linked as a source of an existing event'],
      };
    }
  }

  // 2. Similarity scoring against events within ±2 days.
  const candidates = await query<{
    id: string; title: string; title_normalized: string | null; city: string | null;
    venue_id: string | null; promoter_id: string | null; start_at: string;
    lineup: string[] | null;
  }>(
    `select e.id, e.title, e.title_normalized, e.city, e.venue_id, e.promoter_id, e.start_at,
            (select array_agg(lower(a.name)) from event_artists ea
              join artists a on a.id = ea.artist_id where ea.event_id = e.id) as lineup
       from events e
      where e.status <> 'rejected'
        and ($2::uuid is null or e.id <> $2)
        and e.start_at between $1::timestamptz - interval '2 days'
                           and $1::timestamptz + interval '2 days'`,
    [input.startAt, input.excludeEventId ?? null]
  );
  if (!candidates.length) return none;

  const inputNorm = normalizeTitle(input.title);
  const inputArtists = new Set(input.artistNames.map((a) => a.toLowerCase()));
  let best: DuplicateAssessment = none;

  for (const c of candidates) {
    const reasons: string[] = [];
    let score = 0;

    const sim = titleSimilarity(inputNorm, c.title_normalized ?? normalizeTitle(c.title));
    if (sim >= 0.95) { score += 45; reasons.push('same title'); }
    else if (sim >= 0.6) { score += Math.round(sim * 35); reasons.push('similar title'); }

    const dayDiff = Math.abs(new Date(c.start_at).getTime() - input.startAt.getTime()) / 86400000;
    if (dayDiff < 0.75) { score += 25; reasons.push('same date'); }
    else if (dayDiff <= 1.5) { score += 12; reasons.push('adjacent date'); }

    if (input.venueId && c.venue_id === input.venueId) { score += 20; reasons.push('same venue'); }
    else if (input.city && c.city && input.city.trim().toLowerCase() === c.city.trim().toLowerCase()) {
      score += 10; reasons.push('same city');
    }

    if (input.promoterId && c.promoter_id === input.promoterId) { score += 8; reasons.push('same promoter'); }

    if (inputArtists.size && c.lineup?.length) {
      const overlap = c.lineup.filter((a) => inputArtists.has(a)).length;
      const ratio = overlap / Math.min(inputArtists.size, c.lineup.length);
      if (ratio >= 0.5) { score += 12; reasons.push('overlapping lineup'); }
      else if (overlap > 0) { score += 5; reasons.push('shared artist'); }
    }

    // Title or lineup must contribute; date+city alone is just a busy night.
    if (!reasons.some((r) => r.includes('title') || r.includes('lineup') || r.includes('artist'))) continue;

    score = Math.min(score, 99); // only URL identity reaches 100
    if (score > best.score) {
      best = { state: 'none', score, eventId: c.id, eventTitle: c.title, reasons };
    }
  }

  if (best.score >= supplyConfig.dedupe.likely) best.state = 'likely';
  else if (best.score >= supplyConfig.dedupe.possible) best.state = 'possible';
  else return none;
  return best;
}
