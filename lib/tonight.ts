// WHAT IS ON TONIGHT — asked in one place, answered the same way everywhere.
//
// Tonight appears TWICE on Guestlist: the band on the homepage and the
// Tonight page itself. They were separate queries with separate ideas about
// what "tonight" meant and what order to put it in, which is how the Tonight
// page got fixed to show your own city first while the homepage carried on
// showing Spain.
//
// So this module owns the answer, and both surfaces read it from here:
//
//   TONIGHT_WINDOW  — what counts as tonight
//   tonightFor()    — the events, already in the right order
//   rankTonight()   — the order, once, so a page cannot invent its own
//   tonightGroups() — home / country / elsewhere, for a page that labels them
//
// If a third surface ever wants Tonight, it reads it from here too. Anything
// else and the three of them will disagree by Friday.

import {
  tonightEvents, tonightEventsPublic,
  type TonightEvent, type TonightPublicEvent,
} from './clubmessenger';
import { TIER_NEAR, TIER_FOLLOWED, TIER_COUNTRY, TIER_ELSEWHERE, TIER_UNKNOWN } from './proximity';

export type { TonightEvent, TonightPublicEvent } from './clubmessenger';
export { TONIGHT_WINDOW } from './clubmessenger';

// The events, for whoever is looking. A signed-out visitor gets the listings
// with nothing about people in them — that separation is deliberate and lives
// in lib/clubmessenger, which is the only place the presence predicates are
// allowed to be written.
export async function tonightFor(memberId: string | null): Promise<TonightEvent[] | TonightPublicEvent[]> {
  return memberId ? tonightEvents(memberId) : tonightEventsPublic();
}

type Rankable = {
  id: string;
  start_at: string;
  proximity?: number;
  going_count?: number;
  my_rsvp?: string | null;
  friends_here?: unknown[];
  friends_going?: unknown[];
};

// THE ORDER. Home first, always — who is out and how busy a room is decide
// the order WITHIN where you are, and never lift another country above your
// own. That rule was written on the Tonight page and nowhere else, which is
// exactly why it is here now.
export function rankTonight<T extends Rankable>(
  events: T[],
  heat?: Map<string, { heat: number }>
): T[] {
  return [...events].sort((a, b) => {
    const diff =
      (a.proximity ?? TIER_UNKNOWN) - (b.proximity ?? TIER_UNKNOWN) ||
      (b.friends_here?.length ?? 0) - (a.friends_here?.length ?? 0) ||
      (b.friends_going?.length ?? 0) - (a.friends_going?.length ?? 0) ||
      Number(b.my_rsvp === 'going') - Number(a.my_rsvp === 'going') ||
      Number(b.my_rsvp === 'interested') - Number(a.my_rsvp === 'interested') ||
      ((heat?.get(b.id)?.heat ?? 0) - (heat?.get(a.id)?.heat ?? 0)) ||
      (b.going_count ?? 0) - (a.going_count ?? 0);
    return diff || new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
  });
}

// True when we actually know where this member is. An unplaced member gets
// TIER_UNKNOWN on every event (see lib/proximity), and a page that does not
// check this ends up writing "near you" over a list from three continents.
export function knowsWhereTheyAre(events: { proximity?: number }[]): boolean {
  return events.some((e) => (e.proximity ?? TIER_UNKNOWN) !== TIER_UNKNOWN);
}

// The country to name in a heading: the one their own events are in, not the
// country of whatever happens to be first in the list.
export function homeCountryFrom(
  events: { proximity?: number; country?: string | null }[],
  fallback: string | null
): string | null {
  return events.find((e) => e.proximity === TIER_NEAR)?.country
    ?? events.find((e) => e.proximity === TIER_COUNTRY)?.country
    ?? events.find((e) => e.proximity === TIER_FOLLOWED)?.country
    ?? fallback;
}

// Split into the sections a page shows. One group with tier -1 when we have
// no idea where they are, so the page can say so instead of guessing.
export function tonightGroups<T extends { proximity?: number }>(
  events: T[]
): { tier: number; events: T[] }[] {
  if (!knowsWhereTheyAre(events)) return events.length ? [{ tier: -1, events }] : [];
  return [TIER_NEAR, TIER_FOLLOWED, TIER_COUNTRY, TIER_ELSEWHERE]
    .map((tier) => ({ tier, events: events.filter((e) => e.proximity === tier) }))
    .filter((g) => g.events.length > 0);
}
