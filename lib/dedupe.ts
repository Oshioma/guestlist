// Duplicate detection for incoming events.
//
// The same night can arrive from a promoter site, the venue's own calendar,
// a member submission and a festival page. Strategy:
//   1. Exact source_url match          → hard duplicate (don't create).
//   2. Same normalised title + same date (±1 day) + same city or venue
//                                      → POSSIBLE DUPLICATE: create the row,
//                                        point possible_duplicate_of at the
//                                        suspected canonical event and force
//                                        status to needs_review for an admin.
// Admins resolve flags in the review queue; nothing is auto-merged.

import { query, queryOne } from './db';
import { normalizeTitle } from './util';

export type DuplicateCheck =
  | { kind: 'none' }
  | { kind: 'exact_source'; eventId: string; title: string }
  | { kind: 'possible'; eventId: string; title: string; reason: string };

export async function checkForDuplicate(candidate: {
  title: string;
  startAt: Date | string;
  city?: string | null;
  venueId?: string | null;
  sourceUrl?: string | null;
  excludeEventId?: string | null;
}): Promise<DuplicateCheck> {
  if (candidate.sourceUrl) {
    const hit = await queryOne<{ id: string; title: string }>(
      `select id, title from events
        where source_url = $1 and status <> 'rejected' and ($2::uuid is null or id <> $2)
        limit 1`,
      [candidate.sourceUrl, candidate.excludeEventId ?? null]
    );
    if (hit) return { kind: 'exact_source', eventId: hit.id, title: hit.title };
  }

  const normalized = normalizeTitle(candidate.title);
  if (!normalized) return { kind: 'none' };

  const hits = await query<{ id: string; title: string; city: string | null; venue_id: string | null }>(
    `select id, title, city, venue_id from events
      where title_normalized = $1
        and status <> 'rejected'
        and start_at between $2::timestamptz - interval '1 day' and $2::timestamptz + interval '1 day'
        and ($3::uuid is null or id <> $3)`,
    [normalized, new Date(candidate.startAt), candidate.excludeEventId ?? null]
  );

  for (const hit of hits) {
    const sameVenue = candidate.venueId && hit.venue_id === candidate.venueId;
    const sameCity =
      candidate.city && hit.city &&
      hit.city.trim().toLowerCase() === candidate.city.trim().toLowerCase();
    if (sameVenue || sameCity || (!candidate.venueId && !candidate.city)) {
      return {
        kind: 'possible',
        eventId: hit.id,
        title: hit.title,
        reason: sameVenue
          ? 'same title, date and venue'
          : sameCity
            ? 'same title, date and city'
            : 'same title and date',
      };
    }
  }
  return { kind: 'none' };
}
