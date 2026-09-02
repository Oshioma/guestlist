// GET ME IN — a member asks Guestlist to get them into an event.
//
// Two routes in, one door out:
//
//   • The promoter's own guestlist is OPEN on Guestlist → the member goes
//     straight onto it through the existing event_guestlist_entries flow
//     (instant, no desk work). A request row is still written, linked to the
//     entry, so history and stats see it.
//   • It is not → a brokered request lands on the admin desk, which
//     contacts the promoter, confirms free entry (writing the SAME guestlist
//     table so the member is on the real door list), offers a discount, buys
//     a ticket, waitlists or declines — with a reason, because why it failed
//     is the business intelligence.
//
// Members only ever see four friendly states. The ten operational statuses
// stay on the desk.

import { AuthError, type Member } from './auth';
import { db, query, queryOne } from './db';
import { track } from './analytics';
import { audit } from './audit';
import { refreshAdminReviewDigest } from './adminNotify';
import { queueMemberTransactional } from './email';
import { isPast } from './util';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

export const REQUEST_STATUSES = [
  'requested', 'reviewing', 'contacting_promoter',
  'confirmed_free', 'discounted', 'purchased_by_guestlist',
  'waitlisted', 'unavailable', 'cancelled', 'attended',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// Still needs the desk.
export const OPEN_STATUSES: RequestStatus[] = ['requested', 'reviewing', 'contacting_promoter', 'waitlisted'];
// Something was arranged.
export const FULFILLED_STATUSES: RequestStatus[] = ['confirmed_free', 'discounted', 'purchased_by_guestlist', 'attended'];
// Counts as a decision (for fulfilment rate).
export const DECIDED_STATUSES: RequestStatus[] = [...FULFILLED_STATUSES, 'unavailable'];

export const FULFILMENT_METHODS = [
  ['promoter_guestlist', 'Promoter guestlist'],
  ['venue', 'Venue'],
  ['guestlist_allocation', 'Guestlist allocation'],
  ['purchased', 'Ticket purchased'],
  ['partner', 'Partner'],
  ['other', 'Other'],
] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number][0];

export const DECLINE_REASONS = [
  ['promoter_declined', 'Promoter declined'],
  ['no_allocation', 'No allocation'],
  ['sold_out', 'Sold out'],
  ['too_expensive', 'Too expensive'],
  ['no_response', 'No response'],
  ['too_late', 'Request too late'],
  ['fair_use', 'Fair use'],
  ['other', 'Other'],
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number][0];

export function declineReasonLabel(r: string | null): string {
  return DECLINE_REASONS.find(([k]) => k === r)?.[1] ?? (r ?? '—');
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  requested: 'Requested',
  reviewing: 'Reviewing',
  contacting_promoter: 'Contacting promoter',
  confirmed_free: 'Confirmed free',
  discounted: 'Discount offered',
  purchased_by_guestlist: 'Bought by Guestlist',
  waitlisted: 'Waitlisted',
  unavailable: 'Declined',
  cancelled: 'Cancelled',
  attended: 'Attended',
};

// --- What the member sees ------------------------------------------------------

export type FriendlyKey = 'working' | 'guestlisted' | 'discount' | 'sorry' | 'cancelled';

export type FriendlyState = { key: FriendlyKey; title: string; body: string };

// The linked guestlist entry (when the promoter's own list handled it) wins:
// a promoter approving or declining the entry is the decision.
export function friendlyState(
  status: RequestStatus,
  memberMessage: string | null,
  entryStatus: string | null
): FriendlyState {
  const say = (key: FriendlyKey, title: string, fallback: string): FriendlyState =>
    ({ key, title, body: memberMessage?.trim() || fallback });
  if (entryStatus === 'confirmed' || FULFILLED_STATUSES.includes(status) && status !== 'discounted') {
    return say('guestlisted', 'YOU’RE ON THE GUESTLIST',
      'Your name is on the door. Bring ID and arrive before the list closes.');
  }
  if (status === 'discounted') {
    return say('discount', 'WE GOT YOU A DISCOUNT', 'We couldn’t get you in free this time, but we got you a member price.');
  }
  if (entryStatus === 'declined' || status === 'unavailable') {
    return say('sorry', 'SORRY — NOT THIS ONE',
      'We couldn’t make this one happen. Keep asking — there’s always another night.');
  }
  if (status === 'cancelled' || entryStatus === 'cancelled') {
    return { key: 'cancelled', title: 'Request cancelled', body: 'You cancelled this request.' };
  }
  return say('working', 'WE’RE WORKING ON IT',
    'Guestlist is on it. We’ll let you know as soon as we hear back.');
}

// --- Eligibility -----------------------------------------------------------------

type EligibleEvent = {
  id: string; status: string; listing_status: string; start_at: string; end_at: string | null;
};

export function eventEligible(e: EligibleEvent): boolean {
  return e.status === 'live' && e.listing_status !== 'cancelled' && !isPast(e);
}

// --- Creating --------------------------------------------------------------------

export type CreateOutcome =
  | { kind: 'guestlisted'; requestId: string; entryStatus: 'confirmed' | 'pending' }
  | { kind: 'requested'; requestId: string };

export async function createAccessRequest(
  member: Member,
  eventId: string,
  opts: { places: number; note?: string | null }
): Promise<CreateOutcome> {
  // JUST ME or ME +1. The column allows more for later; the product does not
  // promise it, so the API does not accept it.
  const places = opts.places === 2 ? 2 : 1;
  const note = (opts.note ?? '').trim().slice(0, 500) || null;
  const client = await db.connect();
  try {
    await client.query('begin');
    const ev = (await client.query<EligibleEvent & { promoter_id: string | null; title: string }>(
      `select id, title, promoter_id, status, listing_status, start_at::text, end_at::text
         from events where id = $1 for update`, [eventId]
    )).rows[0];
    if (!ev || !eventEligible(ev)) throw new AuthError(400, 'This event isn’t open for GET ME IN');

    const existing = (await client.query<{ id: string }>(
      `select id from member_access_requests where event_id = $1 and member_id = $2
        and status in ('requested','reviewing','contacting_promoter','waitlisted',
                       'confirmed_free','discounted','purchased_by_guestlist')`,
      [eventId, member.id]
    )).rows[0];
    if (existing) throw new AuthError(409, 'You’ve already asked us about this event');

    // Route 1: the promoter's own list is open on Guestlist.
    const settings = (await client.query<{
      promoter_id: string; mode: string; max_guestlist_places: number;
      guestlist_closes_at: string | null; max_plus_ones: number;
    }>(`select promoter_id, mode, max_guestlist_places, guestlist_closes_at, max_plus_ones
          from event_guestlist_settings where event_id = $1 for update`, [eventId])).rows[0];
    const listOpen = settings && settings.mode !== 'promoter_only'
      && (!settings.guestlist_closes_at || new Date(settings.guestlist_closes_at).getTime() > Date.now());
    if (listOpen) {
      const plusOnes = Math.min(places - 1, settings.max_plus_ones);
      const wanted = 1 + plusOnes;
      const alreadyOn = (await client.query<{ id: string; status: string }>(
        `select id, status from event_guestlist_entries
          where event_id = $1 and member_id = $2 and status in ('pending','confirmed')`,
        [eventId, member.id]
      )).rows[0];
      let room = true;
      if (!alreadyOn && settings.max_guestlist_places > 0) {
        const used = (await client.query<{ used: number }>(
          `select coalesce(sum(1 + plus_ones), 0)::int as used from event_guestlist_entries
            where event_id = $1 and source = 'guestlist' and status in ('pending','confirmed')`,
          [eventId]
        )).rows[0]?.used ?? 0;
        room = used + wanted <= settings.max_guestlist_places;
      }
      if (room) {
        let entryId = alreadyOn?.id;
        let entryStatus = (alreadyOn?.status ?? (settings.mode === 'auto_fill' ? 'confirmed' : 'pending')) as 'confirmed' | 'pending';
        if (!alreadyOn) {
          const name = (member.display_name || member.email.split('@')[0]).trim().slice(0, 140);
          entryId = (await client.query<{ id: string }>(
            `insert into event_guestlist_entries
               (event_id, promoter_id, member_id, guest_name, plus_ones, source, status, notes, created_by_member_id)
             values ($1, $2, $3, $4, $5, 'guestlist', $6, 'Guestlist member — GET ME IN', $3) returning id`,
            [eventId, settings.promoter_id, member.id, name, plusOnes, entryStatus]
          )).rows[0].id;
        } else {
          entryStatus = alreadyOn.status as 'confirmed' | 'pending';
        }
        const status: RequestStatus = entryStatus === 'confirmed' ? 'confirmed_free' : 'requested';
        const req = (await client.query<{ id: string }>(
          `insert into member_access_requests
             (member_id, event_id, promoter_id, places, member_note, status, fulfilment_method,
              guestlist_entry_id, member_message, decided_at, responded_at)
           values ($1, $2, $3, $4, $5, $6, 'promoter_guestlist', $7, $8,
                   case when $6 = 'confirmed_free' then now() end, case when $6 = 'confirmed_free' then now() end)
           returning id`,
          [member.id, eventId, settings.promoter_id, 1 + plusOnes, note, status, entryId,
           entryStatus === 'confirmed' ? 'You’re on the promoter’s guestlist. Bring ID and arrive before the list closes.' : null]
        )).rows[0];
        await client.query(
          `insert into member_access_request_events (request_id, actor_member_id, from_status, to_status, note)
           values ($1, $2, null, $3, $4)`,
          [req.id, member.id, status, `Promoter guestlist open (${settings.mode}) — placed directly`]
        );
        await client.query('commit');
        await track('get_me_in_guestlisted', { memberId: member.id, eventId, promoterId: settings.promoter_id,
          metadata: { entry_status: entryStatus, places: 1 + plusOnes } });
        await audit('access_request_created', { actorId: member.id, eventId, promoterId: settings.promoter_id,
          detail: { requestId: req.id, route: 'promoter_guestlist', entryStatus } });
        return { kind: 'guestlisted', requestId: req.id, entryStatus };
      }
    }

    // Route 2: the desk brokers it.
    const req = (await client.query<{ id: string }>(
      `insert into member_access_requests (member_id, event_id, promoter_id, places, member_note, status)
       values ($1, $2, $3, $4, $5, 'requested') returning id`,
      [member.id, eventId, ev.promoter_id, places, note]
    )).rows[0];
    await client.query(
      `insert into member_access_request_events (request_id, actor_member_id, from_status, to_status, note)
       values ($1, $2, null, 'requested', $3)`,
      [req.id, member.id, note ? `Member note: ${note}` : null]
    );
    await client.query('commit');
    await track('get_me_in_requested', { memberId: member.id, eventId, promoterId: ev.promoter_id, metadata: { places } });
    await audit('access_request_created', { actorId: member.id, eventId, promoterId: ev.promoter_id,
      detail: { requestId: req.id, route: 'brokered', places } });
    await refreshAdminReviewDigest();
    return { kind: 'requested', requestId: req.id };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// A member can withdraw while we are still working on it.
export async function cancelAccessRequest(memberId: string, requestId: string): Promise<boolean> {
  const row = await queryOne<{ id: string; status: RequestStatus; guestlist_entry_id: string | null; event_id: string }>(
    `select id, status, guestlist_entry_id, event_id from member_access_requests where id = $1 and member_id = $2`,
    [requestId, memberId]
  );
  if (!row) throw new AuthError(404, 'Request not found');
  if (!OPEN_STATUSES.includes(row.status) && row.status !== 'confirmed_free') return false;
  await query(
    `update member_access_requests set status = 'cancelled', updated_at = now() where id = $1`, [requestId]);
  if (row.guestlist_entry_id) {
    await query(`update event_guestlist_entries set status = 'cancelled', updated_at = now()
                  where id = $1 and status in ('pending','confirmed')`, [row.guestlist_entry_id]);
  }
  await query(
    `insert into member_access_request_events (request_id, actor_member_id, from_status, to_status, note)
     values ($1, $2, $3, 'cancelled', 'Cancelled by member')`,
    [requestId, memberId, row.status]
  );
  await track('get_me_in_cancelled', { memberId, eventId: row.event_id });
  await refreshAdminReviewDigest();
  return true;
}

// --- Reading (member) --------------------------------------------------------------

export type MemberRequest = {
  id: string;
  event_id: string;
  status: RequestStatus;
  places: number;
  member_message: string | null;
  member_price_pence: number | null;
  currency: string;
  requested_at: string;
  entry_status: string | null;
  title: string;
  slug: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  venue_name: string | null;
  city: string | null;
  friendly: FriendlyState;
};

const MEMBER_REQUEST_SQL = `
  select r.id, r.event_id, r.status, r.places, r.member_message, r.member_price_pence, r.currency,
         r.requested_at::text, g.status as entry_status,
         e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone, e.city, v.name as venue_name
    from member_access_requests r
    join events e on e.id = r.event_id
    left join venues v on v.id = e.venue_id
    left join event_guestlist_entries g on g.id = r.guestlist_entry_id`;

function decorate(r: Omit<MemberRequest, 'friendly'>): MemberRequest {
  return { ...r, friendly: friendlyState(r.status, r.member_message, r.entry_status) };
}

export async function liveRequestFor(memberId: string, eventId: string): Promise<MemberRequest | null> {
  const row = await queryOne<Omit<MemberRequest, 'friendly'>>(
    `${MEMBER_REQUEST_SQL}
      where r.member_id = $1 and r.event_id = $2 and r.status <> 'cancelled'
      order by r.requested_at desc limit 1`,
    [memberId, eventId]
  );
  return row ? decorate(row) : null;
}

export async function memberRequests(memberId: string, limit = 40): Promise<MemberRequest[]> {
  const rows = await query<Omit<MemberRequest, 'friendly'>>(
    `${MEMBER_REQUEST_SQL}
      where r.member_id = $1
      order by (coalesce(e.end_at, e.start_at + interval '6 hours') > now()) desc, e.start_at asc
      limit $2`,
    [memberId, limit]
  );
  return rows.map(decorate);
}

// --- Telling the member ------------------------------------------------------------

async function tellMember(requestId: string): Promise<void> {
  const r = await queryOne<{
    member_id: string; email: string; display_name: string; status: RequestStatus; member_message: string | null;
    event_id: string; title: string; slug: string; entry_status: string | null;
  }>(
    `select r.member_id, m.email, m.display_name, r.status, r.member_message, r.event_id,
            e.title, e.slug, g.status as entry_status
       from member_access_requests r
       join members m on m.id = r.member_id
       join events e on e.id = r.event_id
       left join event_guestlist_entries g on g.id = r.guestlist_entry_id
      where r.id = $1`,
    [requestId]
  );
  if (!r) return;
  const state = friendlyState(r.status, r.member_message, r.entry_status);
  await query(
    `insert into notifications (member_id, type, event_id, payload) values ($1, 'membership_request_update', $2, $3)`,
    [r.member_id, r.event_id, { request_id: requestId, state: state.key, title: state.title, event_title: r.title, slug: r.slug }]
  ).catch((err) => console.error('request notification failed', err));
  await queueMemberTransactional({
    memberId: r.member_id,
    email: r.email,
    emailType: 'notification:membership_request',
    subject: `${state.title} — ${r.title}`,
    body: state.body,
    ctaLabel: 'VIEW YOUR EVENTS',
    ctaUrl: `${SITE}/you/membership`,
    dedupeKey: `getmein:${requestId}:${r.status}`,
  });
  await query(`update member_access_requests set responded_at = now() where id = $1`, [requestId]);
}

// --- The desk -------------------------------------------------------------------------

export type AdminAction =
  | 'reviewing' | 'contact_promoter' | 'log_outreach' | 'confirm_free' | 'offer_discount'
  | 'purchase' | 'waitlist' | 'decline' | 'attended' | 'note' | 'reopen' | 'cancel';

export type AdminActionBody = {
  note?: string;
  memberMessage?: string;
  fulfilmentMethod?: string;
  costPence?: number;
  ticketValuePence?: number;
  memberPricePence?: number;
  declineReason?: string;
  // outreach
  channel?: string;
  direction?: string;
  summary?: string;
  outcome?: string;
  placesOffered?: number;
};

const int = (v: unknown, fallback: number | null = null): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

export async function adminActOnRequest(
  requestId: string,
  admin: Member,
  action: AdminAction,
  body: AdminActionBody
): Promise<{ status: RequestStatus }> {
  const r = await queryOne<{
    id: string; status: RequestStatus; member_id: string; event_id: string; promoter_id: string | null;
    places: number; guestlist_entry_id: string | null; admin_notes: string | null;
    event_promoter_id: string | null; display_name: string; email: string; currency: string;
  }>(
    `select r.id, r.status, r.member_id, r.event_id, r.promoter_id, r.places, r.guestlist_entry_id,
            r.admin_notes, e.promoter_id as event_promoter_id, m.display_name, m.email, r.currency
       from member_access_requests r
       join events e on e.id = r.event_id
       join members m on m.id = r.member_id
      where r.id = $1`,
    [requestId]
  );
  if (!r) throw new AuthError(404, 'Request not found');
  const promoterId = r.promoter_id ?? r.event_promoter_id;
  const note = (body.note ?? '').trim().slice(0, 2000) || null;
  const memberMessage = (body.memberMessage ?? '').trim().slice(0, 1000) || null;

  const timeline = async (to: RequestStatus | null, text: string | null) => {
    await query(
      `insert into member_access_request_events (request_id, actor_member_id, from_status, to_status, note)
       values ($1, $2, $3, $4, $5)`,
      [requestId, admin.id, r.status, to ?? r.status, text]
    );
  };
  const setStatus = async (to: RequestStatus, sets: Record<string, unknown> = {}, decided = false) => {
    const cols = Object.keys(sets);
    const args: unknown[] = [requestId, to, admin.id];
    const extra = cols.map((c) => { args.push(sets[c]); return `${c} = $${args.length}`; });
    await query(
      `update member_access_requests
          set status = $2, handled_by_member_id = $3, updated_at = now()
              ${decided ? ', decided_at = now()' : ''}${extra.length ? ', ' + extra.join(', ') : ''}
        where id = $1`,
      args
    );
  };
  const appendNote = async (text: string) => {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await query(
      `update member_access_requests
          set admin_notes = coalesce(admin_notes || E'\\n', '') || $2, updated_at = now()
        where id = $1`,
      [requestId, `[${stamp} ${admin.display_name}] ${text}`]
    );
  };

  // Put the member on the real door list. Only possible when the event has
  // a promoter (entries require one); otherwise the request itself is the
  // record and the member message says how entry works.
  const ensureGuestlistEntry = async (): Promise<string | null> => {
    if (!promoterId) return null;
    if (r.guestlist_entry_id) {
      await query(`update event_guestlist_entries set status = 'confirmed', updated_at = now() where id = $1`, [r.guestlist_entry_id]);
      return r.guestlist_entry_id;
    }
    const existing = await queryOne<{ id: string }>(
      `select id from event_guestlist_entries where event_id = $1 and member_id = $2 and status in ('pending','confirmed')`,
      [r.event_id, r.member_id]
    );
    if (existing) {
      await query(`update event_guestlist_entries set status = 'confirmed', updated_at = now() where id = $1`, [existing.id]);
      return existing.id;
    }
    const name = (r.display_name || r.email.split('@')[0]).trim().slice(0, 140);
    const row = await queryOne<{ id: string }>(
      `insert into event_guestlist_entries
         (event_id, promoter_id, member_id, guest_name, plus_ones, source, status, notes, created_by_member_id)
       values ($1, $2, $3, $4, $5, 'guestlist', 'confirmed', 'Guestlist member — arranged by Guestlist', $6)
       returning id`,
      [r.event_id, promoterId, r.member_id, name, Math.max(0, r.places - 1), admin.id]
    );
    return row?.id ?? null;
  };

  let next: RequestStatus = r.status;
  switch (action) {
    case 'reviewing':
    case 'reopen': {
      next = 'reviewing';
      await setStatus(next);
      await timeline(next, note);
      break;
    }
    case 'contact_promoter':
    case 'log_outreach': {
      if (!promoterId) throw new AuthError(400, 'This event has no promoter on Guestlist yet — add one on the event first');
      const summary = (body.summary ?? note ?? '').trim().slice(0, 2000);
      if (!summary) throw new AuthError(400, 'Say what was said');
      const channel = ['email', 'phone', 'whatsapp', 'instagram', 'in_person', 'other'].includes(String(body.channel)) ? String(body.channel) : 'email';
      const direction = body.direction === 'inbound' ? 'inbound' : 'outbound';
      const outcome = ['pending', 'free_places', 'discount', 'declined', 'no_response'].includes(String(body.outcome)) ? String(body.outcome) : 'pending';
      await query(
        `insert into promoter_outreach
           (promoter_id, request_id, event_id, actor_member_id, channel, direction, summary, outcome, places_offered)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [promoterId, requestId, r.event_id, admin.id, channel, direction, summary, outcome, int(body.placesOffered)]
      );
      // The relationship moves forward with what we learn; it never moves
      // backwards from a partner because one night fell through.
      const bump = outcome === 'free_places' || outcome === 'discount' ? 'supplying'
        : outcome === 'declined' ? 'declined' : 'contacted';
      await query(
        `update promoters set
           relationship_status = case
             when relationship_status = 'partner' then 'partner'
             when $2 = 'supplying' then 'supplying'
             when relationship_status in ('supplying') then relationship_status
             when $2 = 'declined' then 'declined'
             when relationship_status = 'none' then 'contacted'
             else relationship_status end,
           updated_at = now()
         where id = $1`,
        [promoterId, bump]
      );
      if (!r.promoter_id) await query(`update member_access_requests set promoter_id = $2 where id = $1`, [requestId, promoterId]);
      if (OPEN_STATUSES.includes(r.status) || r.status === 'requested') {
        next = 'contacting_promoter';
        await setStatus(next);
      }
      await timeline(next, `${direction === 'inbound' ? 'Heard from' : 'Contacted'} promoter (${channel}) — ${outcome}: ${summary}`);
      await track('promoter_contacted', { memberId: admin.id, eventId: r.event_id, promoterId, metadata: { outcome, channel } });
      await audit('promoter_outreach_logged', { actorId: admin.id, promoterId, eventId: r.event_id, detail: { requestId, outcome, channel } });
      break;
    }
    case 'confirm_free': {
      next = 'confirmed_free';
      const entryId = await ensureGuestlistEntry();
      const method = FULFILMENT_METHODS.some(([k]) => k === body.fulfilmentMethod) ? body.fulfilmentMethod : (entryId ? 'promoter_guestlist' : 'other');
      await setStatus(next, {
        fulfilment_method: method,
        guestlist_cost_pence: int(body.costPence, 0),
        ticket_value_pence: int(body.ticketValuePence),
        member_price_pence: null,
        decline_reason: null,
        guestlist_entry_id: entryId,
        member_message: memberMessage,
      }, true);
      await timeline(next, note ?? (entryId ? 'Confirmed free — on the door list' : 'Confirmed free'));
      await tellMember(requestId);
      break;
    }
    case 'offer_discount': {
      next = 'discounted';
      const price = int(body.memberPricePence);
      if (price == null) throw new AuthError(400, 'Enter the member price');
      await setStatus(next, {
        fulfilment_method: FULFILMENT_METHODS.some(([k]) => k === body.fulfilmentMethod) ? body.fulfilmentMethod : 'promoter_guestlist',
        member_price_pence: price,
        ticket_value_pence: int(body.ticketValuePence),
        guestlist_cost_pence: int(body.costPence, 0),
        decline_reason: null,
        member_message: memberMessage,
      }, true);
      await timeline(next, note ?? 'Discount offered');
      await tellMember(requestId);
      break;
    }
    case 'purchase': {
      next = 'purchased_by_guestlist';
      const cost = int(body.costPence);
      if (cost == null) throw new AuthError(400, 'Enter what Guestlist paid');
      const entryId = await ensureGuestlistEntry();
      await setStatus(next, {
        fulfilment_method: 'purchased',
        guestlist_cost_pence: cost,
        ticket_value_pence: int(body.ticketValuePence, cost),
        member_price_pence: 0,
        decline_reason: null,
        guestlist_entry_id: entryId,
        member_message: memberMessage,
      }, true);
      await timeline(next, note ?? 'Ticket bought by Guestlist');
      await tellMember(requestId);
      break;
    }
    case 'waitlist': {
      next = 'waitlisted';
      await setStatus(next, { member_message: memberMessage });
      await timeline(next, note ?? 'Waitlisted');
      break;
    }
    case 'decline': {
      next = 'unavailable';
      const reason = DECLINE_REASONS.some(([k]) => k === body.declineReason) ? body.declineReason : null;
      if (!reason) throw new AuthError(400, 'Choose why — it’s how we learn where the gaps are');
      await setStatus(next, { decline_reason: reason, member_message: memberMessage }, true);
      if (r.guestlist_entry_id) {
        await query(`update event_guestlist_entries set status = 'declined', updated_at = now()
                      where id = $1 and status in ('pending','confirmed')`, [r.guestlist_entry_id]);
      }
      await timeline(next, `${declineReasonLabel(reason)}${note ? ` — ${note}` : ''}`);
      await tellMember(requestId);
      break;
    }
    case 'attended': {
      next = 'attended';
      await setStatus(next);
      await timeline(next, note ?? 'Marked attended');
      break;
    }
    case 'cancel': {
      next = 'cancelled';
      await setStatus(next);
      if (r.guestlist_entry_id) {
        await query(`update event_guestlist_entries set status = 'cancelled', updated_at = now()
                      where id = $1 and status in ('pending','confirmed')`, [r.guestlist_entry_id]);
      }
      await timeline(next, note ?? 'Cancelled by Guestlist');
      break;
    }
    case 'note': {
      if (!note) throw new AuthError(400, 'Write something');
      await appendNote(note);
      await timeline(null, note);
      await audit('access_request_note', { actorId: admin.id, eventId: r.event_id, promoterId, detail: { requestId } });
      await refreshAdminReviewDigest();
      return { status: r.status };
    }
    default:
      throw new AuthError(400, 'Unknown action');
  }
  if (note && action !== 'contact_promoter' && action !== 'log_outreach') await appendNote(note);
  if (DECIDED_STATUSES.includes(next)) {
    await track('get_me_in_decided', { memberId: r.member_id, eventId: r.event_id, promoterId,
      metadata: { status: next, by: admin.id, decline_reason: body.declineReason ?? null } });
  }
  await audit('access_request_updated', { actorId: admin.id, eventId: r.event_id, promoterId,
    detail: { requestId, action, from: r.status, to: next } });
  await refreshAdminReviewDigest();
  return { status: next };
}

// --- Reading (admin) -------------------------------------------------------------------

export type QueueRow = {
  id: string; status: RequestStatus; places: number; requested_at: string; decided_at: string | null;
  member_note: string | null; decline_reason: string | null; guestlist_cost_pence: number;
  member_price_pence: number | null; currency: string; entry_status: string | null;
  member_id: string; member_name: string; member_email: string; member_slug: string | null;
  event_id: string; title: string; slug: string; start_at: string; end_at: string | null; timezone: string;
  city: string | null; venue_name: string | null; price_from: string | null; price_to: string | null; event_currency: string | null;
  promoter_id: string | null; promoter_name: string | null; promoter_slug: string | null;
  relationship_status: string | null; promoter_contact_email: string | null; promoter_contact_phone: string | null;
  standard_allocation: string | null;
  member_requests_month: number; member_lifetime_cost_pence: number;
  event_requests: number;
};

const QUEUE_SQL = `
  select r.id, r.status, r.places, r.requested_at::text, r.decided_at::text, r.member_note, r.decline_reason,
         r.guestlist_cost_pence, r.member_price_pence, r.currency, g.status as entry_status,
         m.id as member_id, m.display_name as member_name, m.email as member_email, m.slug as member_slug,
         e.id as event_id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone, e.city,
         v.name as venue_name, e.price_from::text, e.price_to::text, e.currency as event_currency,
         p.id as promoter_id, p.name as promoter_name, p.slug as promoter_slug, p.relationship_status,
         p.contact_email as promoter_contact_email, p.contact_phone as promoter_contact_phone, p.standard_allocation,
         (select count(*)::int from member_access_requests x
           where x.member_id = r.member_id and x.requested_at > date_trunc('month', now())) as member_requests_month,
         (select coalesce(sum(x.guestlist_cost_pence), 0)::int from member_access_requests x
           where x.member_id = r.member_id and x.status in ('confirmed_free','discounted','purchased_by_guestlist','attended')) as member_lifetime_cost_pence,
         (select count(*)::int from member_access_requests x where x.event_id = r.event_id and x.status <> 'cancelled') as event_requests
    from member_access_requests r
    join members m on m.id = r.member_id
    join events e on e.id = r.event_id
    left join venues v on v.id = e.venue_id
    left join promoters p on p.id = coalesce(r.promoter_id, e.promoter_id)
    left join event_guestlist_entries g on g.id = r.guestlist_entry_id`;

export async function adminQueue(view: 'open' | 'done' | 'all' = 'open', limit = 100): Promise<QueueRow[]> {
  // Open = needs the desk: brokered requests still in flight, plus a
  // promoter-list request the promoter declined (worth a second look).
  const where = view === 'open'
    ? `where (r.status in ('requested','reviewing','contacting_promoter','waitlisted') and (g.id is null or g.status = 'declined'))`
    : view === 'done'
      ? `where r.status not in ('requested','reviewing','contacting_promoter','waitlisted')`
      : '';
  return query<QueueRow>(
    `${QUEUE_SQL} ${where}
      order by case when r.status in ('requested','reviewing','contacting_promoter','waitlisted') then 0 else 1 end,
               e.start_at asc, r.requested_at asc
      limit $1`,
    [limit]
  );
}

export type RequestDetail = QueueRow & {
  member_message: string | null; admin_notes: string | null; fulfilment_method: string | null;
  ticket_value_pence: number | null; responded_at: string | null; ticket_url: string | null;
  promoter_website: string | null; promoter_socials: Record<string, string> | null;
  relationship_notes: string | null; allocation_notes: string | null;
  timeline: { id: number; actor_name: string | null; from_status: string | null; to_status: string | null; note: string | null; created_at: string }[];
  contacts: { id: string; name: string; role: string | null; email: string | null; phone: string | null; instagram: string | null; notes: string | null; is_primary: boolean }[];
  outreach: { id: string; channel: string; direction: string; summary: string; outcome: string; places_offered: number | null; created_at: string; actor_name: string | null; event_title: string | null }[];
  promoter_stats: PromoterRelationshipStats | null;
  member_history: MemberHistoryRow[];
  member_summary: MemberFulfilmentSummary;
};

export async function adminRequestDetail(id: string): Promise<RequestDetail | null> {
  const base = await queryOne<QueueRow & {
    member_message: string | null; admin_notes: string | null; fulfilment_method: string | null;
    ticket_value_pence: number | null; responded_at: string | null; ticket_url: string | null;
    promoter_website: string | null; promoter_socials: Record<string, string> | null;
    relationship_notes: string | null; allocation_notes: string | null;
  }>(
    `${QUEUE_SQL.replace('select r.id,', `select r.member_message, r.admin_notes, r.fulfilment_method, r.ticket_value_pence,
        r.responded_at::text, e.ticket_url, p.website as promoter_website, p.socials as promoter_socials,
        p.relationship_notes, p.allocation_notes, r.id,`)}
      where r.id = $1`,
    [id]
  );
  if (!base) return null;
  const promoterId = base.promoter_id;
  const [timeline, contacts, outreach, promoter_stats, member_history, member_summary] = await Promise.all([
    query<RequestDetail['timeline'][number]>(
      `select t.id, a.display_name as actor_name, t.from_status, t.to_status, t.note, t.created_at::text
         from member_access_request_events t left join members a on a.id = t.actor_member_id
        where t.request_id = $1 order by t.created_at`,
      [id]
    ),
    promoterId ? query<RequestDetail['contacts'][number]>(
      `select id, name, role, email, phone, instagram, notes, is_primary from promoter_contacts
        where promoter_id = $1 order by is_primary desc, created_at`, [promoterId]) : Promise.resolve([]),
    promoterId ? query<RequestDetail['outreach'][number]>(
      `select o.id, o.channel, o.direction, o.summary, o.outcome, o.places_offered, o.created_at::text,
              a.display_name as actor_name, e.title as event_title
         from promoter_outreach o
         left join members a on a.id = o.actor_member_id
         left join events e on e.id = o.event_id
        where o.promoter_id = $1 order by o.created_at desc limit 30`, [promoterId]) : Promise.resolve([]),
    promoterId ? promoterRelationshipStats(promoterId) : Promise.resolve(null),
    memberHistory(base.member_id),
    memberFulfilmentSummary(base.member_id),
  ]);
  return { ...base, timeline, contacts, outreach, promoter_stats, member_history, member_summary };
}

// --- Promoter relationship — derived, never denormalised ----------------------------------

export type PromoterRelationshipStats = {
  requests: number; members_sent: number; free_places: number; discounted_places: number;
  tickets_bought: number; cost_pence: number; value_delivered_pence: number; declined: number; outreach: number;
};

export async function promoterRelationshipStats(promoterId: string): Promise<PromoterRelationshipStats> {
  const row = await queryOne<PromoterRelationshipStats>(
    `select
       count(*) filter (where r.status <> 'cancelled')::int as requests,
       count(distinct r.member_id) filter (where r.status in ('confirmed_free','discounted','purchased_by_guestlist','attended'))::int as members_sent,
       coalesce(sum(r.places) filter (where r.status in ('confirmed_free','attended')), 0)::int as free_places,
       coalesce(sum(r.places) filter (where r.status = 'discounted'), 0)::int as discounted_places,
       coalesce(sum(r.places) filter (where r.status = 'purchased_by_guestlist'), 0)::int as tickets_bought,
       coalesce(sum(r.guestlist_cost_pence) filter (where r.status in ('confirmed_free','discounted','purchased_by_guestlist','attended')), 0)::int as cost_pence,
       coalesce(sum(coalesce(r.ticket_value_pence, 0) * r.places) filter (where r.status in ('confirmed_free','purchased_by_guestlist','attended')), 0)::int
         + coalesce(sum((coalesce(r.ticket_value_pence, 0) - coalesce(r.member_price_pence, 0)) * r.places) filter (where r.status = 'discounted'), 0)::int as value_delivered_pence,
       count(*) filter (where r.status = 'unavailable')::int as declined,
       (select count(*)::int from promoter_outreach o where o.promoter_id = $1) as outreach
     from member_access_requests r where r.promoter_id = $1`,
    [promoterId]
  );
  return row ?? { requests: 0, members_sent: 0, free_places: 0, discounted_places: 0, tickets_bought: 0, cost_pence: 0, value_delivered_pence: 0, declined: 0, outreach: 0 };
}

// --- Member history — the desk's view of one person -------------------------------------------

export type MemberHistoryRow = {
  id: string; status: RequestStatus; places: number; requested_at: string; guestlist_cost_pence: number;
  member_price_pence: number | null; decline_reason: string | null; title: string; slug: string; start_at: string;
};

export async function memberHistory(memberId: string, limit = 30): Promise<MemberHistoryRow[]> {
  return query<MemberHistoryRow>(
    `select r.id, r.status, r.places, r.requested_at::text, r.guestlist_cost_pence, r.member_price_pence,
            r.decline_reason, e.title, e.slug, e.start_at::text
       from member_access_requests r join events e on e.id = r.event_id
      where r.member_id = $1 order by r.requested_at desc limit $2`,
    [memberId, limit]
  );
}

export type MemberFulfilmentSummary = {
  requests_month: number; requests_lifetime: number; free_entries: number; discounts: number;
  purchased: number; declined: number; cost_month_pence: number; cost_lifetime_pence: number; plus_ones: number;
};

export async function memberFulfilmentSummary(memberId: string): Promise<MemberFulfilmentSummary> {
  const row = await queryOne<MemberFulfilmentSummary>(
    `select
       count(*) filter (where requested_at > date_trunc('month', now()) and status <> 'cancelled')::int as requests_month,
       count(*) filter (where status <> 'cancelled')::int as requests_lifetime,
       count(*) filter (where status in ('confirmed_free','attended'))::int as free_entries,
       count(*) filter (where status = 'discounted')::int as discounts,
       count(*) filter (where status = 'purchased_by_guestlist')::int as purchased,
       count(*) filter (where status = 'unavailable')::int as declined,
       coalesce(sum(guestlist_cost_pence) filter (where requested_at > date_trunc('month', now())
         and status in ('confirmed_free','discounted','purchased_by_guestlist','attended')), 0)::int as cost_month_pence,
       coalesce(sum(guestlist_cost_pence) filter (where status in ('confirmed_free','discounted','purchased_by_guestlist','attended')), 0)::int as cost_lifetime_pence,
       count(*) filter (where places > 1 and status <> 'cancelled')::int as plus_ones
     from member_access_requests where member_id = $1`,
    [memberId]
  );
  return row ?? { requests_month: 0, requests_lifetime: 0, free_entries: 0, discounts: 0, purchased: 0, declined: 0, cost_month_pence: 0, cost_lifetime_pence: 0, plus_ones: 0 };
}
