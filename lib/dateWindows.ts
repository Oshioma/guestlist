// WHAT "TONIGHT" AND "THIS WEEKEND" MEAN, AND WHERE.
//
// "Today", "this weekend" and the rest were worked out with the server's own
// clock — setHours(0), getDay() — and the server is Vercel, which runs on UTC.
// For half the year that is an hour away from London, so between midnight and
// one in the morning on a summer Friday the site still thought it was
// Thursday: "this weekend" pointed at last weekend's leftovers and "today"
// started an hour late, which on a site about nights out is exactly the hour
// people are looking.
//
// Guestlist's home is London (lib/proximity places anyone we cannot place
// there too), so the day boundaries are London's, whatever machine is doing
// the sums. Pure functions of `now`, so they can be tested on any clock.

import { zonedTimeToUtc } from './supply/time';

export const HOME_TZ = 'Europe/London';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The calendar date and weekday it is in London at `now`. */
export function londonDate(now = new Date()): { y: number; m: number; d: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: HOME_TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday: WEEKDAYS.indexOf(parts.weekday) };
}

/**
 * The instant it is `hh:mm` in London, `plusDays` days after the London date
 * at `now`. Days are added to the calendar date, not as 24-hour blocks, so a
 * clock change in between does not knock midnight to 23:00 or 01:00.
 */
export function londonDayAt(now: Date, plusDays: number, hh = 0, mm = 0): Date {
  const { y, m, d } = londonDate(now);
  const day = new Date(Date.UTC(y, m - 1, d + plusDays));
  return zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, HOME_TZ);
}

/**
 * The weekend, as the browse tab means it: Friday 00:00 to Monday 06:00 in
 * London — the Monday morning so a Sunday night that finishes late still
 * counts. On a Sunday it is the weekend we are in, not next week's.
 */
export function londonWeekend(now = new Date()): { from: Date; to: Date } {
  const { weekday } = londonDate(now);
  const friOffset = weekday === 0 ? -2 : 5 - weekday; // Sat → -1, Sun → -2
  return { from: londonDayAt(now, friOffset), to: londonDayAt(now, friOffset + 3, 6) };
}

/** The /events date filter (?date=today|tomorrow|week|month), in London days. */
export function datePresetRange(preset: string | null | undefined, now = new Date()): { from: Date | null; to: Date | null } {
  switch (preset) {
    case 'today': return { from: londonDayAt(now, 0), to: londonDayAt(now, 1) };
    case 'tomorrow': return { from: londonDayAt(now, 1), to: londonDayAt(now, 2) };
    case 'week': return { from: londonDayAt(now, 0), to: londonDayAt(now, 7) };
    case 'month': return { from: londonDayAt(now, 0), to: londonDayAt(now, 31) };
    default: return { from: null, to: null };
  }
}
