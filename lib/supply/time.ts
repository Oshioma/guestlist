// Date/time normalisation for extracted events.
//
// Rules:
//  * ISO strings with an explicit offset are trusted as-is.
//  * Local wall-clock times are interpreted in the event's own timezone —
//    explicit page timezone first, else a country/city heuristic. Never the
//    admin's or server's timezone.
//  * An end time earlier than the start rolls to the next day (club nights
//    crossing midnight).

const COUNTRY_TZ: Record<string, string> = {
  'united kingdom': 'Europe/London', uk: 'Europe/London', gb: 'Europe/London',
  england: 'Europe/London', scotland: 'Europe/London', wales: 'Europe/London',
  ireland: 'Europe/Dublin', ie: 'Europe/Dublin',
  spain: 'Europe/Madrid', es: 'Europe/Madrid',
  netherlands: 'Europe/Amsterdam', nl: 'Europe/Amsterdam',
  germany: 'Europe/Berlin', de: 'Europe/Berlin',
  france: 'Europe/Paris', fr: 'Europe/Paris',
  belgium: 'Europe/Brussels', be: 'Europe/Brussels',
  portugal: 'Europe/Lisbon', pt: 'Europe/Lisbon',
  italy: 'Europe/Rome', it: 'Europe/Rome',
  croatia: 'Europe/Zagreb', hr: 'Europe/Zagreb',
  austria: 'Europe/Vienna', at: 'Europe/Vienna',
  switzerland: 'Europe/Zurich', ch: 'Europe/Zurich',
  poland: 'Europe/Warsaw', pl: 'Europe/Warsaw',
  'czech republic': 'Europe/Prague', czechia: 'Europe/Prague',
  denmark: 'Europe/Copenhagen', sweden: 'Europe/Stockholm', norway: 'Europe/Oslo',
  finland: 'Europe/Helsinki', greece: 'Europe/Athens',
  'united states': 'America/New_York', usa: 'America/New_York', us: 'America/New_York',
  canada: 'America/Toronto',
  tanzania: 'Africa/Dar_es_Salaam', 'south africa': 'Africa/Johannesburg',
  australia: 'Australia/Sydney',
};

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function inferTimezone(country: string | null, explicit?: string | null): {
  timezone: string;
  inferred: boolean;
} {
  if (explicit && isValidTimezone(explicit)) return { timezone: explicit, inferred: false };
  const tz = country ? COUNTRY_TZ[country.trim().toLowerCase()] : undefined;
  if (tz) return { timezone: tz, inferred: true };
  return { timezone: 'Europe/London', inferred: true };
}

// Offset (ms) of `timezone` from UTC at the given instant.
function tzOffsetMs(instant: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour), Number(parts.minute), Number(parts.second)
  );
  return asUtc - instant.getTime();
}

// Convert a wall-clock time in `timezone` to the UTC instant. Two-pass
// offset estimation handles DST edges well enough for event listings.
export function zonedTimeToUtc(
  y: number, m: number, d: number, hh: number, mm: number, timezone: string
): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset1 = tzOffsetMs(guess, timezone);
  const candidate = new Date(guess.getTime() - offset1);
  const offset2 = tzOffsetMs(candidate, timezone);
  return offset1 === offset2 ? candidate : new Date(guess.getTime() - offset2);
}

// Parse "YYYY-MM-DDTHH:mm" (datetime-local) in a specific timezone.
export function parseLocalInTimezone(local: string, timezone: string): Date | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return zonedTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], timezone);
}

// Interpret a date/time string as found on a page.
//  * has explicit offset or Z → exact instant
//  * date+time without offset → wall clock in `timezone`
//  * date only → treated as evening-unknown; caller decides default time
export function parseFoundDate(
  value: string,
  timezone: string
): { date: Date; hadOffset: boolean; dateOnly: boolean } | null {
  const v = value.trim();
  const offsetMatch = /(?:Z|[+-]\d{2}:?\d{2})$/.test(v);
  if (offsetMatch) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : { date: d, hadOffset: true, dateOnly: false };
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (dateOnly) {
    const [y, m, d] = v.split('-').map(Number);
    return { date: zonedTimeToUtc(y, m, d, 0, 0, timezone), hadOffset: false, dateOnly: true };
  }
  const local = parseLocalInTimezone(v, timezone);
  return local ? { date: local, hadOffset: false, dateOnly: false } : null;
}

// If an end wall-clock time lands before the start, the night crossed
// midnight: roll the end forward a day.
export function resolveEndCrossingMidnight(start: Date, end: Date): Date {
  if (end.getTime() > start.getTime()) return end;
  const rolled = new Date(end.getTime() + 24 * 3600 * 1000);
  // Never roll multi-day amounts silently; > 24h earlier means bad data.
  return rolled.getTime() > start.getTime() ? rolled : end;
}
