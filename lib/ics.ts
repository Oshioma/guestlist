// ADD TO CALENDAR.
//
// Saving a night on Guestlist only helps if you come back to Guestlist. The
// calendar is where people actually look on a Thursday to see what the
// weekend holds, so a night should be able to go there in one tap — as an
// .ics file (Apple Calendar, Outlook, anything on a phone) or as a Google
// Calendar link, which opens straight into the "add event" screen.
//
// Pure: no database, no clock unless one is passed in, so the exact bytes can
// be tested. RFC 5545 is fussy and calendar apps are fussier: lines end in
// CRLF, text values escape backslash, semicolon, comma and newline, and no
// line may be longer than 75 octets — longer ones are folded with CRLF and a
// space, and must never be cut through the middle of a multi-byte character
// (an accented venue name, an emoji in a title), or Outlook shows garbage.

export type CalendarEvent = {
  /** Globally unique and stable, so re-adding updates rather than duplicates. */
  uid: string;
  title: string;
  start: Date;
  /** Nights with no end time get the site's usual six hours (lib/util isPast). */
  end: Date | null;
  location?: string | null;
  url?: string | null;
  description?: string | null;
  cancelled?: boolean;
};

const DEFAULT_LENGTH_MS = 6 * 3600_000;

export function endOf(e: Pick<CalendarEvent, 'start' | 'end'>): Date {
  return e.end && e.end.getTime() > e.start.getTime() ? e.end : new Date(e.start.getTime() + DEFAULT_LENGTH_MS);
}

/** 2026-10-16T21:30:00.000Z → 20261016T213000Z — UTC, so no VTIMEZONE is needed. */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** TEXT value escaping (RFC 5545 §3.3.11). */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const utf8 = new TextEncoder();

/** Fold one content line to 75 octets, never splitting a character. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = utf8.encode(ch).length;
    // The first line gets 75 octets; continuations lose one to the leading space.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function buildIcs(e: CalendarEvent, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Guestlist//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(endOf(e))}`,
    `SUMMARY:${icsEscape(e.title)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/**
 * Google Calendar's own "add event" screen, filled in. Google has no way to
 * read an .ics from a link, so it gets its own button.
 */
export function googleCalendarUrl(e: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsDate(e.start)}/${icsDate(endOf(e))}`,
  });
  const details = [e.description, e.url].filter(Boolean).join('\n\n');
  if (details) params.set('details', details);
  if (e.location) params.set('location', e.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * A listed night as a calendar entry — the one shape both the .ics route and
 * the Google link are built from, so the two buttons cannot disagree.
 */
export function calendarEventFor(
  e: {
    id: string; slug: string; title: string; start_at: string | Date; end_at: string | Date | null;
    short_description: string | null; city: string | null; country: string | null;
    listing_status?: string | null; venue_name?: string | null;
    venue?: { name: string; address: string | null; city: string | null; country: string | null } | null;
  },
  siteUrl: string
): CalendarEvent {
  const place = e.venue
    ? [e.venue.name, e.venue.address, e.venue.city ?? e.city, e.venue.country ?? e.country]
    : [e.venue_name, e.city, e.country];
  return {
    // The event's id never changes, even when its address does, so a second
    // tap on "add to calendar" updates the entry rather than adding another.
    uid: `event-${e.id}@${new URL(siteUrl).host}`,
    title: e.title,
    start: new Date(e.start_at),
    end: e.end_at ? new Date(e.end_at) : null,
    location: [...new Set(place.filter((x): x is string => !!x))].join(', ') || null,
    url: `${siteUrl}/events/${e.slug}`,
    description: e.short_description,
    cancelled: e.listing_status === 'cancelled',
  };
}
