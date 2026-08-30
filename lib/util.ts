export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Normalised form of an event title used for duplicate detection:
// lowercase, no diacritics/punctuation, common filler words removed,
// whitespace collapsed.
const TITLE_STOPWORDS = new Set([
  'the', 'a', 'an', 'at', 'of', 'and', 'presents', 'present', 'pres',
  'with', 'w', 'feat', 'featuring', 'ft', 'x',
]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !TITLE_STOPWORDS.has(w))
    .join(' ');
}

export const EVENT_TYPES = [
  { value: 'day_party', label: 'Day Party' },
  { value: 'club_night', label: 'Club Night' },
  { value: 'festival', label: 'Festival' },
  { value: 'weekender', label: 'Weekender' },
  { value: 'boat_party', label: 'Boat Party' },
  { value: 'beach_party', label: 'Beach Party' },
  { value: 'concert', label: 'Concert / Live' },
  { value: 'retreat', label: 'Retreat / Experience' },
  { value: 'other', label: 'Other' },
] as const;

export type EventTypeValue = (typeof EVENT_TYPES)[number]['value'];

export function eventTypeLabel(value: string): string {
  return EVENT_TYPES.find((t) => t.value === value)?.label ?? 'Other';
}

export const SOURCE_TYPES = [
  { value: 'promoter_website', label: 'Promoter Website' },
  { value: 'venue_website', label: 'Venue Website' },
  { value: 'festival_website', label: 'Festival Website' },
  { value: 'artist_website', label: 'Artist / DJ Website' },
  { value: 'record_label', label: 'Record Label' },
  { value: 'independent_calendar', label: 'Independent Calendar' },
  { value: 'blog_publication', label: 'Blog / Publication' },
  { value: 'rss_feed', label: 'RSS / Feed' },
  { value: 'member_submission', label: 'Member Submission' },
  { value: 'manual', label: 'Manual' },
  { value: 'other', label: 'Other' },
] as const;

export function sourceTypeLabel(value: string): string {
  return SOURCE_TYPES.find((t) => t.value === value)?.label ?? 'Other';
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', EUR: '€', USD: '$', TZS: 'TSh ', HRK: '€',
};

export function formatPrice(
  priceFrom: string | number | null,
  priceTo: string | number | null,
  currency: string | null
): string | null {
  if (priceFrom == null && priceTo == null) return null;
  const sym = CURRENCY_SYMBOLS[currency ?? 'GBP'] ?? `${currency ?? ''} `;
  const fmt = (v: string | number) => {
    const n = Number(v);
    return n === 0 ? 'Free' : `${sym}${Number.isInteger(n) ? n : n.toFixed(2)}`;
  };
  if (priceFrom != null && Number(priceFrom) === 0 && priceTo == null) return 'Free';
  if (priceFrom != null && priceTo != null && Number(priceFrom) !== Number(priceTo)) {
    return `${fmt(priceFrom)} – ${fmt(priceTo)}`;
  }
  const v = priceFrom ?? priceTo;
  return v != null ? `From ${fmt(v)}` : null;
}

// --- Date formatting (always in the event's own timezone) ---

export function fmtDate(d: Date | string, timezone: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'Europe/London',
    ...opts,
  }).format(typeof d === 'string' ? new Date(d) : d);
}

export function fmtEventDate(startAt: string | Date, endAt: string | Date | null, timezone: string): string {
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;
  const day = (x: Date) =>
    fmtDate(x, timezone, { weekday: 'short', day: 'numeric', month: 'short' });
  if (end && day(end) !== day(start)) {
    // Multi-day (ignore a finish shortly after midnight — that's a club night).
    const hoursIntoEndDay = Number(
      fmtDate(end, timezone, { hour: 'numeric', hour12: false })
    );
    const spansRealDays = end.getTime() - start.getTime() > 20 * 3600 * 1000 || hoursIntoEndDay >= 12;
    if (spansRealDays) return `${day(start)} – ${day(end)}`;
  }
  return day(start);
}

export function fmtEventTime(startAt: string | Date, endAt: string | Date | null, timezone: string): string {
  const t = (x: Date | string) =>
    fmtDate(x, timezone, { hour: 'numeric', minute: '2-digit', hour12: false });
  const start = t(startAt);
  return endAt ? `${start} – ${t(endAt)}` : start;
}

export function isPast(e: { end_at: string | Date | null; start_at: string | Date }): boolean {
  const ref = e.end_at ? new Date(e.end_at) : new Date(new Date(e.start_at).getTime() + 6 * 3600 * 1000);
  return ref.getTime() < Date.now();
}
