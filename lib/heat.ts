// Guestlist Heat — deterministic, honest, tunable. No AI, no invented
// numbers: every input is an existing platform signal.
//
// PUBLIC EVENT HEAT (same for every viewer):
//   raw = 3.0 * hereNow            -- active presence beats everything
//       + 2.0 * going
//       + 1.0 * interested
//       + 2.0 * goingLast6h        -- velocity: momentum right now
//       + 0.3 * views24h
//       + 1.0 * ticketClicks24h
//       + 0.5 * saves
//       + 0.5 * shares24h
//   heat = round(100 * raw / (raw + 25))   -- saturating curve, 0–99
// The curve keeps small honest numbers small (raw 25 → 50) and makes the
// high end hard to reach; weights live in HEAT_WEIGHTS for tuning, and the
// raw signal breakdown is returned so future services (AI Desk, Live Radar)
// can re-weight without re-querying.
//
// PERSONAL SOCIAL RELEVANCE (viewer-specific, never mixed into heat):
//   relevance = 5 * friendsHere + 3 * friendsGoing + 1 * friendsInterested
//             + 0.5 * extendedGoing   -- people the viewer follows one-way
// Rendering and calculation are separated: everything here is plain data.

import { query } from './db';

export const HEAT_WEIGHTS = {
  hereNow: 3.0,
  going: 2.0,
  interested: 1.0,
  goingLast6h: 2.0,
  views24h: 0.3,
  ticketClicks24h: 1.0,
  saves: 0.5,
  shares24h: 0.5,
  saturation: 25,
} as const;

export type HeatSignals = {
  hereNow: number;
  going: number;
  interested: number;
  goingLast6h: number;
  views24h: number;
  ticketClicks24h: number;
  saves: number;
  shares24h: number;
};

export function computeHeat(s: HeatSignals): number {
  const w = HEAT_WEIGHTS;
  const raw =
    w.hereNow * s.hereNow +
    w.going * s.going +
    w.interested * s.interested +
    w.goingLast6h * s.goingLast6h +
    w.views24h * s.views24h +
    w.ticketClicks24h * s.ticketClicks24h +
    w.saves * s.saves +
    w.shares24h * s.shares24h;
  if (raw <= 0) return 0;
  return Math.round((100 * raw) / (raw + w.saturation));
}

export function heatLabel(heat: number): string | null {
  if (heat >= 70) return 'Heating up';
  if (heat >= 40) return 'Busy';
  return null;
}

// Batch: signals + heat for a set of events in one pass.
export async function heatForEvents(
  eventIds: string[]
): Promise<Map<string, { heat: number; signals: HeatSignals }>> {
  const out = new Map<string, { heat: number; signals: HeatSignals }>();
  if (!eventIds.length) return out;
  const rows = await query<{ event_id: string } & HeatSignals>(
    `select e.id as event_id,
            (select count(*)::int from event_presence p
              where p.event_id = e.id and p.left_at is null and p.expires_at > now()
                and p.visibility <> 'invisible') as "hereNow",
            count(*) filter (where mea.rsvp = 'going')::int as going,
            count(*) filter (where mea.rsvp = 'interested')::int as interested,
            count(*) filter (where mea.rsvp = 'going' and mea.rsvp_at > now() - interval '6 hours')::int as "goingLast6h",
            (select count(*)::int from analytics_events a
              where a.event_id = e.id and a.event_type = 'event_viewed'
                and a.created_at > now() - interval '24 hours') as "views24h",
            (select count(*)::int from analytics_events a
              where a.event_id = e.id and a.event_type = 'ticket_clicked'
                and a.created_at > now() - interval '24 hours') as "ticketClicks24h",
            count(*) filter (where mea.saved_at is not null)::int as saves,
            (select count(*)::int from analytics_events a
              where a.event_id = e.id and a.event_type = 'event_shared'
                and a.created_at > now() - interval '24 hours') as "shares24h"
       from events e
       left join member_event_actions mea on mea.event_id = e.id
      where e.id = any($1)
      group by e.id`,
    [eventIds]
  );
  for (const r of rows) {
    const signals: HeatSignals = {
      hereNow: r.hereNow, going: r.going, interested: r.interested,
      goingLast6h: r.goingLast6h, views24h: r.views24h,
      ticketClicks24h: r.ticketClicks24h, saves: r.saves, shares24h: r.shares24h,
    };
    out.set(r.event_id, { heat: computeHeat(signals), signals });
  }
  return out;
}
