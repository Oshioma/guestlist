// COLD START MODE — sparse data is a product state, not an error.
//
// Every Ask computes the data density around its query and the engine
// changes how it RANKS and how it TALKS. The signal hierarchy, in order of
// trust as Guestlist grows:
//
//   1. Hard event facts                (always)
//   2. Taste / genre match             (always)
//   3. Venue / promoter / artist       (always — relationships already in Guestlist)
//   4. Archive / scene similarity      (when archive coverage is real)
//   5. Member behaviour (popularity)   (only past minCityRsvps)
//   6. Social graph                    (only with actual eligible people)
//   7. Heat / momentum                 (only past hard minimum evidence)
//
// Levels 5–7 switch on automatically as the numbers grow. Early Guestlist
// behaves like a knowledgeable editor; later, an editor who also knows
// your friends, your history and what is moving.

import { query } from '../db';
import { getSetting } from '../settings';

// Minimum evidence per claim type — admin-overridable via the
// 'ask_thresholds' system setting. A claim below its floor simply
// disappears; it is never rounded up into existence.
export const ASK_EVIDENCE_THRESHOLDS = {
  momentum: { goingLast6h: 3, ticketClicks24h: 5, hereNow: 3 }, // any ONE qualifies
  sceneGoing: 3,           // privacy-safe scene matches before "people from your scene"
  minCityRsvps: 25,        // below this, popularity is NOT a ranking signal
  minActiveMembers: 20,    // below this, behavioural signals stay quiet
  archiveRich: 3,          // published archive nights before scene-similarity leans in
} as const;

export type AskThresholds = {
  momentum: { goingLast6h: number; ticketClicks24h: number; hereNow: number };
  sceneGoing: number;
  minCityRsvps: number;
  minActiveMembers: number;
  archiveRich: number;
};

export async function askThresholds(): Promise<AskThresholds> {
  const override = await getSetting<Partial<AskThresholds>>('ask_thresholds');
  return {
    ...ASK_EVIDENCE_THRESHOLDS,
    ...override,
    momentum: { ...ASK_EVIDENCE_THRESHOLDS.momentum, ...(override?.momentum ?? {}) },
  };
}

export type DataDensity = {
  events: number;          // live events in the query city (or globally) next 30d
  activeMembers: number;   // members active in the last 30 days
  rsvpVolume: number;      // going/interested in that scope, next 30d
  archiveCoverage: number; // published archive nights
  socialCoverage: number;  // the viewer's own connections (0 for guests)
  popularityOn: boolean;   // level 5 unlocked
  socialOn: boolean;       // level 6 unlocked (has actual people)
  mode: 'cold' | 'warm';
};

export async function dataDensity(
  city: string | null,
  viewerId: string | null,
  t: AskThresholds
): Promise<DataDensity> {
  const [row] = await query<{
    events: number; active_members: number; rsvp_volume: number;
    archive_coverage: number; social_coverage: number;
  }>(
    `select
       (select count(*)::int from events e
         where e.status = 'live' and e.listing_status not in ('cancelled','postponed')
           and e.start_at between now() and now() + interval '30 days'
           and ($1::text is null or lower(e.city) = lower($1))) as events,
       (select count(distinct member_id)::int from member_event_actions
         where rsvp_at > now() - interval '30 days' or saved_at > now() - interval '30 days') as active_members,
       (select count(*)::int from member_event_actions a join events e on e.id = a.event_id
         where a.rsvp in ('going','interested')
           and e.start_at between now() and now() + interval '30 days'
           and ($1::text is null or lower(e.city) = lower($1))) as rsvp_volume,
       (select count(*)::int from archive_events where status = 'published') as archive_coverage,
       (select count(*)::int from member_connections
         where status = 'connected' and ($2::uuid is not null)
           and (requester_id = $2 or addressee_id = $2)) as social_coverage`,
    [city, viewerId]
  );
  const popularityOn = row.rsvp_volume >= t.minCityRsvps && row.active_members >= t.minActiveMembers;
  const socialOn = row.social_coverage > 0;
  return {
    events: row.events,
    activeMembers: row.active_members,
    rsvpVolume: row.rsvp_volume,
    archiveCoverage: row.archive_coverage,
    socialCoverage: row.social_coverage,
    popularityOn,
    socialOn,
    mode: popularityOn ? 'warm' : 'cold',
  };
}
