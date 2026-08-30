// Admin create/update logic for events: slug management, genre + lineup
// wiring, dedupe flagging, publish transitions.

import { query, queryOne } from './db';
import { checkForDuplicate } from './dedupe';
import { normalizeTitle, slugify } from './util';

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
  if (!input.title?.trim()) return 'Title is required';
  if (!input.startAt || Number.isNaN(Date.parse(input.startAt))) return 'A valid start date is required';
  if (input.endAt && Number.isNaN(Date.parse(input.endAt))) return 'End date is invalid';
  if (input.endAt && Date.parse(input.endAt) <= Date.parse(input.startAt!)) {
    return 'End must be after start';
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
      new Date(input.startAt), input.endAt ? new Date(input.endAt) : null,
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
  return { id: row!.id, slug, status, possibleDuplicateOf };
}

export async function updateEvent(
  id: string,
  input: Partial<EventInput> & { status?: EventInput['status']; clearDuplicateFlag?: boolean }
): Promise<{ ok: boolean }> {
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
  if (input.startAt !== undefined) set('start_at', new Date(input.startAt));
  if (input.endAt !== undefined) set('end_at', input.endAt ? new Date(input.endAt) : null);
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
    set('status', input.status, '::event_status');
    // Stamp first publish time; keep it across unpublish/republish.
    sets.push(`published_at = case when '${input.status}' = 'live' then coalesce(published_at, now()) else published_at end`);
  }
  sets.push('updated_at = now()');

  args.push(id);
  const res = await query(
    `update events set ${sets.join(', ')} where id = $${args.length} returning id`,
    args
  );
  if (res.length === 0) return { ok: false };
  await syncRelations(id, input as EventInput);
  return { ok: true };
}
