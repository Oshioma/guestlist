// Admin create/update logic for events: slug management, genre + lineup
// wiring, dedupe flagging, publish transitions.

import { onEventPublished } from './alerts';
import { findOrCreateCity } from './locations';
import { query, queryOne } from './db';
import { checkForDuplicate } from './dedupe';
import { normalizeTitle, slugify } from './util';
import { isValidTimezone, parseLocalInTimezone } from './supply/time';

// Admin forms submit wall-clock "YYYY-MM-DDTHH:mm" values, interpreted in
// the EVENT's timezone (never the admin's browser timezone — that was the
// V1 caveat). ISO strings with an explicit offset are honoured as-is.
export function parseEventDate(value: string | Date, timezone: string): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const tz = isValidTimezone(timezone) ? timezone : 'Europe/London';
  return parseLocalInTimezone(value, tz);
}

export type EventInput = {
  title: string;
  shortDescription?: string | null;
  description?: string | null;
  startAt: string; // ISO
  endAt?: string | null;
  timezone?: string;
  venueId?: string | null;
  promoterId?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  eventType: string;
  ticketUrl?: string | null;
  priceFrom?: number | null;
  priceTo?: number | null;
  currency?: string | null;
  primaryImageUrl?: string | null;
  sourceUrl?: string | null;
  worthTravelling?: boolean;
  featured?: boolean;
  status?: 'new' | 'needs_review' | 'live' | 'rejected';
  genreSlugs?: string[];
  lineup?: string[]; // artist names in billing order
};

export function validateEventInput(input: Partial<EventInput>): string | null {
  const tz = input.timezone ?? 'Europe/London';
  if (!input.title?.trim()) return 'Title is required';
  if (!input.startAt || !parseEventDate(input.startAt, tz)) return 'A valid start date is required';
  if (input.endAt && !parseEventDate(input.endAt, tz)) return 'End date is invalid';
  if (input.endAt) {
    const start = parseEventDate(input.startAt, tz)!;
    const end = parseEventDate(input.endAt, tz)!;
    if (end.getTime() <= start.getTime()) return 'End must be after start';
  }
  if (!input.eventType) return 'Event type is required';
  if (
    input.priceFrom != null && input.priceTo != null &&
    Number(input.priceTo) < Number(input.priceFrom)
  ) {
    return 'Price “to” must not be below price “from”';
  }
  return null;
}

async function uniqueSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugify(title) || 'event';
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    const clash = await queryOne<{ id: string }>(
      `select id from events where slug = $1 ${excludeId ? 'and id <> $2' : ''}`,
      excludeId ? [candidate, excludeId] : [candidate]
    );
    if (!clash) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

async function syncRelations(eventId: string, input: EventInput) {
  if (input.genreSlugs) {
    await query(`delete from event_genres where event_id = $1 and source = 'manual'`, [eventId]);
    for (const slug of input.genreSlugs) {
      await query(
        `insert into event_genres (event_id, genre_id, source)
         select $1, id, 'manual' from genres where slug = $2
         on conflict (event_id, genre_id) do nothing`,
        [eventId, slug]
      );
    }
  }
  if (input.lineup) {
    await query(`delete from event_artists where event_id = $1`, [eventId]);
    for (let i = 0; i < input.lineup.length; i++) {
      const name = input.lineup[i].trim();
      if (!name) continue;
      const artist = await queryOne<{ id: string }>(
        `insert into artists (name, slug) values ($1, $2)
         on conflict (slug) do update set name = artists.name
         returning id`,
        [name, slugify(name) || `artist-${i}`]
      );
      await query(
        `insert into event_artists (event_id, artist_id, position, billing)
         values ($1, $2, $3, $4) on conflict do nothing`,
        [eventId, artist!.id, i, i === 0 ? 'headliner' : null]
      );
    }
  }
}

// Keep events on the canonical location graph — city strings are display
// cache, the location row is identity (drives city pages, travel + home
// city alerts, city health).
async function linkLocation(
  eventId: string,
  city: string | null | undefined,
  country: string | null | undefined,
  timezone?: string | null
) {
  if (!city?.trim()) return;
  try {
    const loc = await findOrCreateCity({
      name: city, countryName: country ?? null, timezone: timezone ?? null,
    });
    await query(`update events set location_id = $2 where id = $1`, [eventId, loc.id]);
  } catch (err) {
    console.error('location link failed', err);
  }
}

export async function createEvent(
  input: EventInput,
  createdBy: string
): Promise<{ id: string; slug: string; status: string; possibleDuplicateOf: string | null }> {
  // Dedupe: an exact/likely match downgrades the requested status to review.
  const dup = await checkForDuplicate({
    title: input.title,
    startAt: input.startAt,
    city: input.city,
    venueId: input.venueId,
    sourceUrl: input.sourceUrl,
  });
  const possibleDuplicateOf = dup.kind === 'none' ? null : dup.eventId;
  let status = input.status ?? 'new';
  if (possibleDuplicateOf && status !== 'rejected') status = 'needs_review';

  const slug = await uniqueSlug(input.title);
  const row = await queryOne<{ id: string }>(
    `insert into events (title, slug, short_description, description, start_at, end_at,
        timezone, venue_id, promoter_id, city, country, latitude, longitude, event_type,
        ticket_url, price_from, price_to, currency, primary_image_url, source_url,
        source_type, status, worth_travelling, featured, possible_duplicate_of,
        title_normalized, published_at, created_by)
     values ($1,$2,$3,$4,$5,$6,coalesce($7,'Europe/London'),$8,$9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20,'manual',$21::event_status,$22,$23,$24,$25,
        case when $21::event_status = 'live' then now() end, $26)
     returning id`,
    [
      input.title.trim(), slug, input.shortDescription ?? null, input.description ?? null,
      parseEventDate(input.startAt, input.timezone ?? 'Europe/London'),
      input.endAt ? parseEventDate(input.endAt, input.timezone ?? 'Europe/London') : null,
      input.timezone ?? null, input.venueId ?? null, input.promoterId ?? null,
      input.city ?? null, input.country ?? null, input.latitude ?? null, input.longitude ?? null,
      input.eventType, input.ticketUrl ?? null, input.priceFrom ?? null, input.priceTo ?? null,
      input.currency ?? null, input.primaryImageUrl ?? null, input.sourceUrl ?? null,
      status, input.worthTravelling ?? false, input.featured ?? false,
      possibleDuplicateOf, normalizeTitle(input.title), createdBy,
    ]
  );
  if (input.primaryImageUrl) {
    await query(
      `insert into event_images (event_id, url, sort_order) values ($1, $2, 0)`,
      [row!.id, input.primaryImageUrl]
    );
  }
  await syncRelations(row!.id, input);
  await linkLocation(row!.id, input.city, input.country, input.timezone);
  if (status === 'live') void onEventPublished(row!.id);
  return { id: row!.id, slug, status, possibleDuplicateOf };
}

export async function updateEvent(
  id: string,
  input: Partial<EventInput> & { status?: EventInput['status']; clearDuplicateFlag?: boolean }
): Promise<{ ok: boolean }> {
  // Wall-clock inputs are interpreted in the event's timezone: the one being
  // set in this update, else the one already stored.
  let tzForDates = input.timezone;
  if ((input.startAt !== undefined || input.endAt) && !tzForDates) {
    const existing = await queryOne<{ timezone: string }>(
      'select timezone from events where id = $1', [id]
    );
    tzForDates = existing?.timezone ?? 'Europe/London';
  }

  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, val: unknown, cast = '') => {
    args.push(val);
    sets.push(`${col} = $${args.length}${cast}`);
  };

  if (input.title !== undefined) {
    set('title', input.title.trim());
    set('title_normalized', normalizeTitle(input.title));
  }
  if (input.shortDescription !== undefined) set('short_description', input.shortDescription);
  if (input.description !== undefined) set('description', input.description);
  if (input.startAt !== undefined) set('start_at', parseEventDate(input.startAt, tzForDates ?? 'Europe/London'));
  if (input.endAt !== undefined) {
    set('end_at', input.endAt ? parseEventDate(input.endAt, tzForDates ?? 'Europe/London') : null);
  }
  if (input.timezone !== undefined) set('timezone', input.timezone || 'Europe/London');
  if (input.venueId !== undefined) set('venue_id', input.venueId);
  if (input.promoterId !== undefined) set('promoter_id', input.promoterId);
  if (input.city !== undefined) set('city', input.city);
  if (input.country !== undefined) set('country', input.country);
  if (input.latitude !== undefined) set('latitude', input.latitude);
  if (input.longitude !== undefined) set('longitude', input.longitude);
  if (input.eventType !== undefined) set('event_type', input.eventType, '::event_type');
  if (input.ticketUrl !== undefined) set('ticket_url', input.ticketUrl);
  if (input.priceFrom !== undefined) set('price_from', input.priceFrom);
  if (input.priceTo !== undefined) set('price_to', input.priceTo);
  if (input.currency !== undefined) set('currency', input.currency || null);
  if (input.primaryImageUrl !== undefined) set('primary_image_url', input.primaryImageUrl);
  if (input.sourceUrl !== undefined) set('source_url', input.sourceUrl);
  if (input.worthTravelling !== undefined) set('worth_travelling', input.worthTravelling);
  if (input.featured !== undefined) set('featured', input.featured);
  if (input.clearDuplicateFlag) sets.push('possible_duplicate_of = null');
  if (input.status !== undefined) {
    if (!['new', 'needs_review', 'live', 'rejected'].includes(input.status)) {
      return { ok: false };
    }
    set('status', input.status, '::event_status');
    // Stamp first publish time; keep it across unpublish/republish.
    args.push(input.status);
    sets.push(`published_at = case when $${args.length} = 'live' then coalesce(published_at, now()) else published_at end`);
  }
  sets.push('updated_at = now()');

  args.push(id);
  const res = await query(
    `update events set ${sets.join(', ')} where id = $${args.length} returning id`,
    args
  );
  if (res.length === 0) return { ok: false };
  if (input.city !== undefined) {
    await linkLocation(id, input.city, input.country ?? null, input.timezone);
  }
  if (input.status === 'live') void onEventPublished(id);
  await syncRelations(id, input as EventInput);
  return { ok: true };
}
