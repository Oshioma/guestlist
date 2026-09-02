// THE DOOR PASS.
//
// One link, printed as a QR code on the confirmation email, that answers the
// only questions a door asks: is this person on the list, for how many, and
// who here put them there.
//
// Three rules:
//
// 1. The link is the credential, so it is signed. An entry id on its own would
//    let anybody who guessed one read a stranger's pass; the signature means a
//    link can only come from us.
// 2. It shows what a door needs and nothing else. A name, a count, a night,
//    and who confirmed it. Never an email address, never a phone number,
//    never the rest of the list.
// 3. Checking somebody in is a different thing from reading the pass. Anyone
//    holding the link can read it — that is what a pass is for. Marking an
//    arrival takes a signed-in member of that promoter's team.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { query, queryOne } from './db';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

function secret(): string {
  return process.env.SESSION_SECRET ?? 'dev-secret';
}

// The id, packed to 22 characters instead of 36. A QR code holding a shorter
// URL is a smaller grid, and a smaller grid reads faster off a dim phone in a
// queue — which is the only place this is ever used.
function packId(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url');
}
function unpackId(packed: string): string | null {
  try {
    const hex = Buffer.from(packed, 'base64url').toString('hex');
    if (hex.length !== 32) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function doorToken(entryId: string): string {
  const packed = packId(entryId);
  const sig = createHmac('sha256', secret()).update(`door:${entryId}`).digest('base64url').slice(0, 22);
  return `${packed}.${sig}`;
}

export function doorUrl(entryId: string): string {
  return `${SITE}/d/${doorToken(entryId)}`;
}

export function qrUrl(entryId: string): string {
  return `${SITE}/api/door/${doorToken(entryId)}/qr.png`;
}

/** The entry this token names, or null if the signature does not hold. */
export function entryFromToken(token: string): string | null {
  const [packed, sig] = token.split('.');
  if (!packed || !sig) return null;
  const entryId = unpackId(packed);
  if (!entryId || !UUID.test(entryId)) return null;
  const expected = createHmac('sha256', secret()).update(`door:${entryId}`).digest('base64url').slice(0, 22);
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? entryId : null;
}

export type DoorPass = {
  entryId: string;
  promoterId: string;
  promoterName: string;
  guestName: string;
  places: number;             // the guest plus their plus-ones
  status: 'confirmed' | 'pending' | 'declined' | 'cancelled';
  source: string;
  checkedInAt: string | null;
  confirmedBy: string | null; // the person in the promoter's team who said yes
  confirmedAt: string | null;
  eventTitle: string;
  eventSlug: string;
  startAt: string;
  endAt: string | null;
  timezone: string;
  venueName: string | null;
  city: string | null;
};

export async function doorPass(token: string): Promise<DoorPass | null> {
  const entryId = entryFromToken(token);
  if (!entryId) return null;
  const row = await queryOne<{
    id: string; promoter_id: string; promoter_name: string; guest_name: string;
    plus_ones: number; status: DoorPass['status']; source: string;
    checked_in_at: string | null; confirmed_by: string | null; confirmed_at: string | null;
    title: string; slug: string; start_at: string; end_at: string | null;
    timezone: string; venue_name: string | null; city: string | null;
  }>(
    `select g.id, g.promoter_id, p.name as promoter_name, g.guest_name, g.plus_ones,
            g.status, g.source, g.checked_in_at::text, c.display_name as confirmed_by,
            g.confirmed_at::text, e.title, e.slug, e.start_at::text, e.end_at::text,
            e.timezone, v.name as venue_name, e.city
       from event_guestlist_entries g
       join events e on e.id = g.event_id
       join promoters p on p.id = g.promoter_id
       left join members c on c.id = g.confirmed_by_member_id
       left join venues v on v.id = e.venue_id
      where g.id = $1`,
    [entryId]
  );
  if (!row) return null;
  return {
    entryId: row.id,
    promoterId: row.promoter_id,
    promoterName: row.promoter_name,
    guestName: row.guest_name,
    places: 1 + row.plus_ones,
    status: row.status,
    source: row.source,
    checkedInAt: row.checked_in_at,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    eventTitle: row.title,
    eventSlug: row.slug,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    venueName: row.venue_name,
    city: row.city,
  };
}

/** Mark an arrival, or undo one. Returns the new check-in time, or null. */
export async function toggleCheckIn(entryId: string): Promise<{ checkedInAt: string | null }> {
  const row = await queryOne<{ checked_in_at: string | null }>(
    `update event_guestlist_entries
        set checked_in_at = case when checked_in_at is null then now() else null end,
            updated_at = now()
      where id = $1 and status = 'confirmed'
      returning checked_in_at::text`,
    [entryId]
  );
  return { checkedInAt: row?.checked_in_at ?? null };
}

/**
 * Record who confirmed an entry, and when. Called at every point an entry
 * becomes confirmed, so the pass can always name a person rather than saying
 * "somebody, at some point".
 */
export async function markConfirmed(entryId: string, byMemberId: string): Promise<void> {
  await query(
    `update event_guestlist_entries
        set confirmed_by_member_id = $2, confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
      where id = $1`,
    [entryId, byMemberId]
  );
}
