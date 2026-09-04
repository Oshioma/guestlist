// GET ME IN and ASK GUESTLIST — a member asks Guestlist to get them in.
//
// Two ways to ask, one pipeline, one desk:
//
//   • GET ME IN — a specific event already on Guestlist. Fast. If the
//     promoter's own guestlist is OPEN on Guestlist the member goes straight
//     onto it through event_guestlist_entries (instant, no desk work); if
//     not, a brokered request lands on the desk.
//   • ASK GUESTLIST — the wider member service. "I found this on Instagram,
//     can you get me in?", "+1?", "sold out — help?", "where should I go?".
//     A pasted link is matched against Guestlist first; a confident match
//     becomes a normal event request, anything else is stored as an EXTERNAL
//     event request with what the member knew. Nothing is imported because
//     a member pasted a link — the desk decides.
//
// Both feed the same promoter flywheel: the desk assigns or contacts a
// promoter, the outreach ledger records what came of it, and the promoter's
// relationship status moves. External requests are demand signals, not
// tickets: what members want that Guestlist does not have yet.
//
// Members only ever see the friendly states. The operational statuses and
// the internal outcome reasons stay on the desk.

import { AuthError, type Member } from './auth';
import { db, query, queryOne } from './db';
import { track } from './analytics';
import { audit } from './audit';
import { refreshAdminReviewDigest } from './adminNotify';
import { queueMemberTransactional } from './email';
import { markConfirmed } from './doorPass';
import { sendGuestlistConfirmed } from './guestlistEmail';
import { processUrlSubmission } from './ingestion';
import { isPast, normalizeTitle } from './util';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

export const REQUEST_STATUSES = [
  'requested', 'reviewing', 'contacting_promoter',
  'confirmed_free', 'discounted', 'purchased_by_guestlist',
  'waitlisted', 'unavailable', 'cancelled', 'attended', 'answered',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// Still needs the desk.
export const OPEN_STATUSES: RequestStatus[] = ['requested', 'reviewing', 'contacting_promoter', 'waitlisted'];
// Something was arranged.
export const FULFILLED_STATUSES: RequestStatus[] = ['confirmed_free', 'discounted', 'purchased_by_guestlist', 'attended'];
// Counts as a decision (for fulfilment rate).
export const DECIDED_STATUSES: RequestStatus[] = [...FULFILLED_STATUSES, 'unavailable', 'answered'];

// Kinds of ask. Plain text in the database, validated here, so a new kind
// never needs a migration.
export const REQUEST_TYPES = [
  ['event_access', 'Get me in'],
  ['plus_one', '+1'],
  ['sold_out_event', 'Sold out — help'],
  ['event_recommendation', 'Recommend me something'],
  ['afterparty', 'Afterparty'],
  ['city_recommendation', 'What should I do in a city'],
  ['other', 'Something else'],
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number][0];
export const ACCESS_TYPES: RequestType[] = ['event_access', 'plus_one', 'sold_out_event'];
export function requestTypeLabel(t: string): string {
  return REQUEST_TYPES.find(([k]) => k === t)?.[1] ?? t;
}

export type RequestOrigin = 'get_me_in' | 'ask_guestlist' | 'admin';
export const CONTEXTS = ['event_page', 'membership_area', 'events_empty', 'ask_panel', 'you', 'admin'] as const;

export const FULFILMENT_METHODS = [
  ['promoter_guestlist', 'Promoter guestlist'],
  ['venue', 'Venue'],
  ['guestlist_allocation', 'Guestlist allocation'],
  ['purchased', 'Ticket purchased'],
  ['partner', 'Partner'],
  ['other', 'Other'],
] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number][0];

// Why it did not happen — internal intelligence, never shown to the member
// unless the desk chooses to explain it in the message.
export const OUTCOME_REASONS = [
  ['promoter_declined', 'Promoter declined'],
  ['promoter_no_response', 'Promoter — no response'],
  ['no_promoter_contact', 'No promoter contact'],
  ['no_allocation', 'No allocation'],
  ['sold_out', 'Sold out'],
  ['too_expensive', 'Too expensive'],
  ['request_too_late', 'Request too late'],
  ['fair_use', 'Fair use'],
  ['excluded_event', 'Excluded event'],
  ['event_cancelled', 'Event cancelled'],
  ['insufficient_information', 'Not enough information'],
  ['member_cancelled', 'Member cancelled'],
  ['other', 'Other'],
] as const;
export type OutcomeReason = (typeof OUTCOME_REASONS)[number][0];

export function outcomeReasonLabel(r: string | null): string {
  return OUTCOME_REASONS.find(([k]) => k === r)?.[1] ?? (r ?? '—');
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
  answered: 'Answered',
};

// --- What the member sees ------------------------------------------------------

export type FriendlyKey = 'working' | 'guestlisted' | 'discount' | 'answered' | 'sorry' | 'cancelled';

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
  if (status === 'answered') {
    return say('answered', 'HERE’S WHAT WE THINK', 'We’ve had a look and sent you our thoughts.');
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

// --- Fair-use brakes (information for the desk; friendly limits for the member) ----

// Fair use is information for the desk, never automation: this is only the
// point at which a row grows a quiet chip so a pattern gets noticed early.
export const FAIR_USE_WATCH = { asksPerWeek: 6 };

export const ASK_LIMITS = {
  submissionsPerHour: 10,
  openRequests: 20,
} as const;

async function assertUnderLimits(memberId: string): Promise<void> {
  const row = await queryOne<{ hour: number; open: number }>(
    `select count(*) filter (where requested_at > now() - interval '1 hour')::int as hour,
            count(*) filter (where status in ('requested','reviewing','contacting_promoter','waitlisted'))::int as open
       from member_access_requests where member_id = $1`,
    [memberId]
  );
  if ((row?.hour ?? 0) >= ASK_LIMITS.submissionsPerHour) {
    throw new AuthError(429, 'That’s a lot of asks at once — give us an hour to catch up');
  }
  if ((row?.open ?? 0) >= ASK_LIMITS.openRequests) {
    throw new AuthError(429, 'You have a lot open with us already — let us work through those first');
  }
}

// --- Creating: GET ME IN (and any request linked to a Guestlist event) ------------

export type CreateOutcome =
  | { kind: 'guestlisted'; requestId: string; entryStatus: 'confirmed' | 'pending' }
  | { kind: 'requested'; requestId: string };

export type CreateOpts = {
  places: number;
  note?: string | null;
  origin?: RequestOrigin;
  context?: string | null;
  requestType?: RequestType;
};

export async function createAccessRequest(
  member: Member,
  eventId: string,
  opts: CreateOpts
): Promise<CreateOutcome> {
  // JUST ME or ME +1. The column allows more for later; the product does not
  // promise it, so the API does not accept it.
  const places = opts.places === 2 ? 2 : 1;
  const note = (opts.note ?? '').trim().slice(0, 500) || null;
  const origin = opts.origin ?? 'get_me_in';
  const context = opts.context ?? (origin === 'get_me_in' ? 'event_page' : null);
  const requestType: RequestType = opts.requestType ?? (places === 2 && origin === 'ask_guestlist' ? 'plus_one' : 'event_access');
  await assertUnderLimits(member.id);
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
              guestlist_entry_id, member_message, decided_at, responded_at, request_type, origin, context)
           values ($1, $2, $3, $4, $5, $6, 'promoter_guestlist', $7, $8,
                   case when $6 = 'confirmed_free' then now() end, case when $6 = 'confirmed_free' then now() end,
                   $9, $10, $11)
           returning id`,
          [member.id, eventId, settings.promoter_id, 1 + plusOnes, note, status, entryId,
           entryStatus === 'confirmed' ? 'You’re on the promoter’s guestlist. Bring ID and arrive before the list closes.' : null,
           requestType, origin, context]
        )).rows[0];
        await client.query(
          `insert into member_access_request_events (request_id, actor_member_id, from_status, to_status, note)
           values ($1, $2, null, $3, $4)`,
          [req.id, member.id, status, `Promoter guestlist open (${settings.mode}) — placed directly`]
        );
        await client.query('commit');
        await track('get_me_in_guestlisted', { memberId: member.id, eventId, promoterId: settings.promoter_id,
          metadata: { entry_status: entryStatus, places: 1 + plusOnes, origin } });
        await audit('access_request_created', { actorId: member.id, eventId, promoterId: settings.promoter_id,
          detail: { requestId: req.id, route: 'promoter_guestlist', entryStatus, origin } });
        return { kind: 'guestlisted', requestId: req.id, entryStatus };
      }
    }

    // Route 2: the desk brokers it.
    const req = (await client.query<{ id: string }>(
      `insert into member_access_requests (member_id, event_id, promoter_id, places, member_note, status, request_type, origin, context)
       values ($1, $2, $3, $4, $5, 'requested', $6, $7, $8) returning id`,
      [member.id, eventId, ev.promoter_id, places, note, requestType, origin, context]
    )).rows[0];
    await client.query(
      `insert into member_access_request_events (request_id, actor_member_id, from_status, to_status, note)
       values ($1, $2, null, 'requested', $3)`,
      [req.id, member.id, note ? `Member note: ${note}` : null]
    );
    await client.query('commit');
    await track('get_me_in_requested', { memberId: member.id, eventId, promoterId: ev.promoter_id, metadata: { places, origin } });
    await audit('access_request_created', { actorId: member.id, eventId, promoterId: ev.promoter_id,
      detail: { requestId: req.id, route: 'brokered', places, origin } });
    await refreshAdminReviewDigest();
    return { kind: 'requested', requestId: req.id };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// --- ASK GUESTLIST: any event, anywhere ---------------------------------------------

// host + path, no scheme, no www, no query, no fragment, no trailing slash.
// The same form is computed in SQL when matching against stored URLs.
export function normaliseEventUrl(raw: string): { url: string; normalised: string; host: string } | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // Tracking parameters are not part of the event.
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|mc_|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return { url: u.toString(), normalised: `${host}${path}`, host };
  } catch {
    return null;
  }
}

// The first http(s) link in a pasted blob of text.
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return m ? m[0].replace(/[.,;:!?]+$/, '') : null;
}

export const URL_KEY_SQL = (col: string) =>
  `lower(regexp_replace(regexp_replace(regexp_replace(${col}, '^https?://(www\\.)?', ''), '[?#].*$', ''), '/+$', ''))`;

export type EventMatch = { eventId: string; title: string; confidence: 'url' | 'title_date' };

// Try to find the event on Guestlist before storing it as external. A URL
// hit anywhere we keep URLs is confident; a title+date+city hit is only a
// suggestion for the desk to confirm. Never creates anything.
export async function matchExternalEvent(input: {
  normalisedUrl?: string | null; name?: string | null; startsAt?: Date | null; city?: string | null;
}): Promise<EventMatch | null> {
  if (input.normalisedUrl) {
    const hit = await queryOne<{ id: string; title: string }>(
      `select e.id, e.title from events e
        where e.status <> 'rejected' and (
          ${URL_KEY_SQL('e.source_url')} = $1
          or exists (select 1 from event_source_links l where l.event_id = e.id and ${URL_KEY_SQL('l.url')} = $1)
          or exists (select 1 from event_submissions s where s.event_id = e.id and ${URL_KEY_SQL('s.url')} = $1)
        )
        order by (e.status = 'live') desc, e.start_at desc limit 1`,
      [input.normalisedUrl]
    );
    if (hit) return { eventId: hit.id, title: hit.title, confidence: 'url' };
  }
  if (input.name && input.startsAt) {
    const normalized = normalizeTitle(input.name);
    if (!normalized) return null;
    // title_normalized is maintained by the importers; hand-made events may
    // not have it, so the plain title counts too.
    const hits = await query<{ id: string; title: string; city: string | null }>(
      `select id, title, city from events
        where (title_normalized = $1 or lower(btrim(title)) = lower(btrim($3))) and status <> 'rejected'
          and start_at between $2::timestamptz - interval '1 day' and $2::timestamptz + interval '1 day'
        limit 5`,
      [normalized, input.startsAt, input.name]
    );
    const hit = hits.find((h) => !input.city || !h.city || h.city.trim().toLowerCase() === input.city.trim().toLowerCase());
    if (hit) return { eventId: hit.id, title: hit.title, confidence: 'title_date' };
  }
  return null;
}

export type AskInput = {
  text?: string | null;           // the box: a link, a name, a question
  url?: string | null;
  requestType?: string | null;
  places?: number;
  note?: string | null;
  name?: string | null;
  venue?: string | null;
  city?: string | null;
  country?: string | null;
  startsAt?: string | null;
  ticketPrice?: string | number | null;  // pounds, from the form
  lineup?: string | null;
  context?: string | null;
};

export type AskOutcome =
  | { kind: 'guestlisted'; requestId: string; entryStatus: 'confirmed' | 'pending'; eventId: string }
  | { kind: 'requested'; requestId: string; eventId: string | null; matched: EventMatch | null };

export async function createAskRequest(member: Member, input: AskInput): Promise<AskOutcome> {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);
  const text = s(input.text, 1500);
  const rawUrl = s(input.url, 2000) ?? (text ? extractUrl(text) : null);
  const link = rawUrl ? normaliseEventUrl(rawUrl) : null;
  if (rawUrl && !link) throw new AuthError(400, 'That link doesn’t look right — it needs to start with http(s)://');
  const places = Number(input.places) === 2 ? 2 : 1;
  const requestType: RequestType = REQUEST_TYPES.some(([k]) => k === input.requestType)
    ? (input.requestType as RequestType)
    : places === 2 ? 'plus_one' : 'event_access';
  const context = CONTEXTS.includes(input.context as (typeof CONTEXTS)[number]) ? String(input.context) : 'membership_area';
  const name = s(input.name, 200);
  // The note is what the member wrote; if the box held only prose (no link,
  // no name), that prose IS the request.
  const note = s(input.note, 500) ?? (text && text !== rawUrl ? text.replace(rawUrl ?? '', '').trim().slice(0, 500) || null : null);
  if (!link && !name && !note) throw new AuthError(400, 'Paste a link, or tell us what you’re after');
  const startsAt = input.startsAt && !Number.isNaN(Date.parse(String(input.startsAt))) ? new Date(String(input.startsAt)) : null;
  const pricePence = input.ticketPrice != null && input.ticketPrice !== '' && Number.isFinite(Number(input.ticketPrice))
    ? Math.max(0, Math.round(Number(input.ticketPrice) * 100)) : null;
  const city = s(input.city, 100);

  await assertUnderLimits(member.id);
  const matched = ACCESS_TYPES.includes(requestType)
    ? await matchExternalEvent({ normalisedUrl: link?.normalised, name, startsAt, city })
    : null;

  const external = {
    url: link?.url ?? null, normalised: link?.normalised ?? null, host: link?.host ?? null,
    name, venue: s(input.venue, 200), city, country: s(input.country, 100), startsAt,
    pricePence, lineup: s(input.lineup, 500),
  };
  const hasExternal = !!(external.url || external.name || external.venue || external.city || external.startsAt);

  const writeExternal = async (requestId: string) => {
    if (!hasExternal) return;
    await query(
      `insert into member_request_external_events
         (request_id, url, url_normalised, url_host, name, venue_name, city, country, starts_at, ticket_price_pence, lineup)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (request_id) do nothing`,
      [requestId, external.url, external.normalised, external.host, external.name, external.venue,
       external.city, external.country, external.startsAt, external.pricePence, external.lineup]
    );
  };

  const typeEvents: Partial<Record<RequestType, 'plus_one_requested' | 'sold_out_help_requested' | 'recommendation_requested'>> = {
    plus_one: 'plus_one_requested', sold_out_event: 'sold_out_help_requested',
    event_recommendation: 'recommendation_requested', city_recommendation: 'recommendation_requested', afterparty: 'recommendation_requested',
  };
  const meta = { request_type: requestType, context, host: external.host, city: external.city, places };

  // A confident match to a live event is a GET ME IN in everything but name.
  if (matched?.confidence === 'url') {
    const ev = await queryOne<EligibleEvent>(
      `select id, status, listing_status, start_at::text, end_at::text from events where id = $1`, [matched.eventId]);
    if (ev && eventEligible(ev)) {
      const out = await createAccessRequest(member, matched.eventId, { places, note, origin: 'ask_guestlist', context, requestType });
      await writeExternal(out.requestId);
      await track('ask_guestlist_submitted', { memberId: member.id, eventId: matched.eventId, metadata: { ...meta, matched: 'url' } });
      if (typeEvents[requestType]) await track(typeEvents[requestType]!, { memberId: member.id, eventId: matched.eventId, metadata: meta });
      return out.kind === 'guestlisted'
        ? { kind: 'guestlisted', requestId: out.requestId, entryStatus: out.entryStatus, eventId: matched.eventId }
        : { kind: 'requested', requestId: out.requestId, eventId: matched.eventId, matched };
    }
  }

  // Otherwise an external (or non-event) request for the desk. One live ask
  // per member per link.
  if (external.normalised) {
    const dup = await queryOne(
      `select 1 from member_access_requests r join member_request_external_events x on x.request_id = r.id
        where r.member_id = $1 and x.url_normalised = $2
          and r.status in ('requested','reviewing','contacting_promoter','waitlisted','confirmed_free','discounted','purchased_by_guestlist')`,
      [member.id, external.normalised]
    );
    if (dup) throw new AuthError(409, 'You’ve already sent us that one — it’s with the desk');
  }
  const req = await queryOne<{ id: string }>(
    `insert into member_access_requests
       (member_id, event_id, places, member_note, status, request_type, origin, context, suggested_event_id, match_confidence)
     values ($1, null, $2, $3, 'requested', $4, 'ask_guestlist', $5, $6, $7) returning id`,
    [member.id, places, note, requestType, context, matched?.eventId ?? null, matched?.confidence ?? null]
  );
  const requestId = req!.id;
  await writeExternal(requestId);
  await query(
    `insert into member_access_request_events (request_id, actor_member_id, from_status, to_status, note)
     values ($1, $2, null, 'requested', $3)`,
    [requestId, member.id, [
      `ASK GUESTLIST (${requestTypeLabel(requestType)})`,
      external.url ? `link: ${external.url}` : null,
      matched ? `possible match: ${matched.title}` : null,
      note ? `note: ${note}` : null,
    ].filter(Boolean).join(' · ')]
  );
  await track('ask_guestlist_submitted', { memberId: member.id, metadata: { ...meta, matched: matched?.confidence ?? 'none' } });
  if (hasExternal) await track('external_event_requested', { memberId: member.id, metadata: { ...meta, url: external.url, venue: external.venue } });
  if (typeEvents[requestType]) await track(typeEvents[requestType]!, { memberId: member.id, metadata: meta });
  await audit('access_request_created', { actorId: member.id, detail: { requestId, route: 'ask_guestlist', requestType, host: external.host, matched: matched?.confidence ?? null } });
  await refreshAdminReviewDigest();
  return { kind: 'requested', requestId, eventId: null, matched };
}

// A member can withdraw while we are still working on it.
export async function cancelAccessRequest(memberId: string, requestId: string): Promise<boolean> {
  const row = await queryOne<{ id: string; status: RequestStatus; guestlist_entry_id: string | null; event_id: string | null }>(
    `select id, status, guestlist_entry_id, event_id from member_access_requests where id = $1 and member_id = $2`,
    [requestId, memberId]
  );
  if (!row) throw new AuthError(404, 'Request not found');
  if (!OPEN_STATUSES.includes(row.status) && row.status !== 'confirmed_free') return false;
  await query(
    `update member_access_requests set status = 'cancelled', outcome_reason = 'member_cancelled', updated_at = now() where id = $1`, [requestId]);
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
  event_id: string | null;
  request_type: RequestType;
  origin: RequestOrigin;
  status: RequestStatus;
  places: number;
  member_message: string | null;
  member_price_pence: number | null;
  currency: string;
  requested_at: string;
  entry_status: string | null;
  // Event title, or what the member told us, or the link's host.
  title: string;
  slug: string | null;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  venue_name: string | null;
  city: string | null;
  external_url: string | null;
  image_url: string | null;
  friendly: FriendlyState;
};

const MEMBER_REQUEST_SQL = `
  select r.id, r.event_id, r.request_type, r.origin, r.status, r.places, r.member_message, r.member_price_pence, r.currency,
         r.requested_at::text, g.status as entry_status,
         coalesce(e.title, x.name, x.url_host, case r.request_type
           when 'event_recommendation' then 'Recommend me something'
           when 'city_recommendation' then 'What should I do'
           when 'afterparty' then 'Afterparty'
           else 'Your ask' end) as title,
         e.slug, coalesce(e.start_at, x.starts_at)::text as start_at, e.end_at::text, e.timezone,
         coalesce(e.city, x.city) as city, coalesce(v.name, x.venue_name) as venue_name, x.url as external_url,
         e.primary_image_url as image_url
    from member_access_requests r
    left join events e on e.id = r.event_id
    left join venues v on v.id = e.venue_id
    left join member_request_external_events x on x.request_id = r.id
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
      order by (coalesce(e.end_at, e.start_at + interval '6 hours', x.starts_at + interval '6 hours', r.requested_at + interval '30 days') > now()) desc,
               coalesce(e.start_at, x.starts_at, r.requested_at) asc
      limit $2`,
    [memberId, limit]
  );
  return rows.map(decorate);
}

// --- Telling the member ------------------------------------------------------------

async function tellMember(requestId: string, opts: { skipEmail?: boolean } = {}): Promise<void> {
  const r = await queryOne<{
    member_id: string; email: string; display_name: string; status: RequestStatus; member_message: string | null;
    event_id: string | null; title: string; slug: string | null; entry_status: string | null;
  }>(
    `select r.member_id, m.email, m.display_name, r.status, r.member_message, r.event_id,
            coalesce(e.title, x.name, x.url_host, 'your ask') as title, e.slug, g.status as entry_status
       from member_access_requests r
       join members m on m.id = r.member_id
       left join events e on e.id = r.event_id
       left join member_request_external_events x on x.request_id = r.id
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
  if (!opts.skipEmail) await queueMemberTransactional({
    memberId: r.member_id,
    email: r.email,
    emailType: 'notification:membership_request',
    subject: `${state.title} — ${r.title}`,
    body: state.body,
    ctaLabel: 'VIEW YOUR REQUESTS',
    ctaUrl: `${SITE}/you/membership`,
    dedupeKey: `getmein:${requestId}:${r.status}:${Date.now().toString(36).slice(0, 6)}`,
  });
  await query(`update member_access_requests set responded_at = now() where id = $1`, [requestId]);
}

// --- The desk -------------------------------------------------------------------------

export type AdminAction =
  | 'reviewing' | 'contact_promoter' | 'log_outreach' | 'confirm_free' | 'offer_discount'
  | 'purchase' | 'waitlist' | 'decline' | 'attended' | 'note' | 'reopen' | 'cancel'
  | 'link_event' | 'import_event' | 'assign_promoter' | 'message_member' | 'answer';

export type AdminActionBody = {
  note?: string;
  memberMessage?: string;
  fulfilmentMethod?: string;
  costPence?: number;
  ticketValuePence?: number;
  memberPricePence?: number;
  outcomeReason?: string;
  declineReason?: string; // older clients
  eventId?: string;
  promoterId?: string;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Put the member on the real door list. Only possible when the request is
// linked to an event with a promoter (entries require both); otherwise the
// request itself is the record and the member message says how entry works.
// Shared by the desk and the promoter's own "put them on the list" button.
type DoorTarget = { event_id: string | null; member_id: string; guestlist_entry_id: string | null; places: number; display_name: string; email: string };
export async function ensureDoorEntry(r: DoorTarget, promoterId: string | null, actorId: string): Promise<string | null> {
  if (!promoterId || !r.event_id) return null;
  if (r.guestlist_entry_id) {
    await query(`update event_guestlist_entries set status = 'confirmed', updated_at = now() where id = $1`, [r.guestlist_entry_id]);
    await markConfirmed(r.guestlist_entry_id, actorId);
    return r.guestlist_entry_id;
  }
  const existing = await queryOne<{ id: string }>(
    `select id from event_guestlist_entries where event_id = $1 and member_id = $2 and status in ('pending','confirmed')`,
    [r.event_id, r.member_id]
  );
  if (existing) {
    await query(`update event_guestlist_entries set status = 'confirmed', updated_at = now() where id = $1`, [existing.id]);
    await markConfirmed(existing.id, actorId);
    return existing.id;
  }
  const name = (r.display_name || r.email.split('@')[0]).trim().slice(0, 140);
  const row = await queryOne<{ id: string }>(
    `insert into event_guestlist_entries
       (event_id, promoter_id, member_id, guest_name, plus_ones, source, status, notes,
        created_by_member_id, confirmed_by_member_id, confirmed_at)
     values ($1, $2, $3, $4, $5, 'guestlist', 'confirmed', 'Guestlist member — arranged by Guestlist', $6, $6, now())
     returning id`,
    [r.event_id, promoterId, r.member_id, name, Math.max(0, r.places - 1), actorId]
  );
  return row?.id ?? null;
}

// --- The promoter's side ---------------------------------------------------
//
// A promoter sees the Guestlist members asking for their own events and can
// put them on the list in one press — the same door entry, the same pass
// email, the same request record the desk would have produced. "Can't this
// time" hands the request back to the desk rather than telling the member
// no: Guestlist may still find another way in.

export type PromoterAsk = {
  id: string; status: RequestStatus; places: number; requested_at: string; member_note: string | null;
  member_name: string; event_id: string; title: string; slug: string; start_at: string; end_at: string | null; timezone: string;
  venue_name: string | null; entry_status: string | null;
};

export async function promoterOpenAsks(promoterId: string, limit = 40): Promise<PromoterAsk[]> {
  return query<PromoterAsk>(
    `select r.id, r.status, r.places, r.requested_at::text, r.member_note,
            m.display_name as member_name,
            e.id as event_id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
            v.name as venue_name, g.status as entry_status
       from member_access_requests r
       join members m on m.id = r.member_id
       join events e on e.id = r.event_id
       left join venues v on v.id = e.venue_id
       left join event_guestlist_entries g on g.id = r.guestlist_entry_id
      where coalesce(r.promoter_id, e.promoter_id) = $1
        and r.request_type = 'event_access'
        and r.status in ('requested','reviewing','contacting_promoter','waitlisted')
        and (g.id is null or g.status = 'declined')
        and coalesce(e.end_at, e.start_at + interval '6 hours') > now()
      order by e.start_at asc, r.requested_at asc
      limit $2`,
    [promoterId, limit]
  );
}

export async function promoterOpenAskCount(promoterId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from member_access_requests r join events e on e.id = r.event_id
      left join event_guestlist_entries g on g.id = r.guestlist_entry_id
      where coalesce(r.promoter_id, e.promoter_id) = $1 and r.request_type = 'event_access'
        and r.status in ('requested','reviewing','contacting_promoter','waitlisted')
        and (g.id is null or g.status = 'declined')
        and coalesce(e.end_at, e.start_at + interval '6 hours') > now()`,
    [promoterId]
  );
  return row?.n ?? 0;
}

export async function promoterActOnRequest(
  promoter: { id: string; name: string },
  actor: { id: string; display_name: string },
  requestId: string,
  action: 'guestlist' | 'cant'
): Promise<{ status: RequestStatus; entryId: string | null }> {
  const r = await queryOne<{
    id: string; status: RequestStatus; event_id: string | null; member_id: string; guestlist_entry_id: string | null;
    places: number; display_name: string; email: string; owner_promoter_id: string | null;
  }>(
    `select r.id, r.status, r.event_id, r.member_id, r.guestlist_entry_id, r.places, m.display_name, m.email,
            coalesce(r.promoter_id, e.promoter_id) as owner_promoter_id
       from member_access_requests r
       join members m on m.id = r.member_id
       left join events e on e.id = r.event_id
      where r.id = $1`,
    [requestId]
  );
  if (!r || r.owner_promoter_id !== promoter.id || !r.event_id) throw new AuthError(404, 'Request not found');
  if (!OPEN_STATUSES.includes(r.status)) throw new AuthError(409, 'This request has already been decided');

  const timeline = async (to: RequestStatus, text: string) => {
    await query(
      `insert into member_access_request_events (request_id, actor_member_id, from_status, to_status, note) values ($1, $2, $3, $4, $5)`,
      [requestId, actor.id, r.status, to, text]
    );
  };

  if (action === 'guestlist') {
    const entryId = await ensureDoorEntry(r, promoter.id, actor.id);
    if (!entryId) throw new AuthError(400, 'Could not create a door entry for this event');
    await query(
      `update member_access_requests
          set status = 'confirmed_free', fulfilment_method = 'promoter_guestlist', guestlist_entry_id = $2,
              outcome_reason = null, member_message = null, handled_by_member_id = $3, decided_at = now(), updated_at = now()
        where id = $1`,
      [requestId, entryId, actor.id]
    );
    await timeline('confirmed_free', `Put on the list by ${promoter.name} (${actor.display_name})`);
    await audit('access_request_updated', { actorId: actor.id, promoterId: promoter.id, eventId: r.event_id, detail: { requestId, action: 'promoter_guestlist' } });
    await track('get_me_in_guestlisted', { memberId: r.member_id, eventId: r.event_id, promoterId: promoter.id, metadata: { by: 'promoter', places: r.places } });
    const sentPass = await sendGuestlistConfirmed(entryId).catch((err) => { console.error('guestlist email failed', err); return false; });
    await tellMember(requestId, { skipEmail: sentPass });
    await refreshAdminReviewDigest();
    return { status: 'confirmed_free', entryId };
  }

  // "Can't this time": back to the desk with the reason on record. The
  // member hears nothing yet — Guestlist may still buy a ticket or find a
  // member price.
  await query(
    `update member_access_requests
        set status = 'reviewing', outcome_reason = 'promoter_declined',
            admin_notes = coalesce(admin_notes || E'\n', '') || $2, updated_at = now()
      where id = $1`,
    [requestId, `[${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${promoter.name}] Promoter can’t this time — find another way in, or decline.`]
  );
  await timeline('reviewing', `${promoter.name} can’t this time — back to the desk`);
  await audit('access_request_updated', { actorId: actor.id, promoterId: promoter.id, eventId: r.event_id, detail: { requestId, action: 'promoter_cant' } });
  await refreshAdminReviewDigest();
  return { status: 'reviewing', entryId: null };
}

export async function adminActOnRequest(
  requestId: string,
  admin: Member,
  action: AdminAction,
  body: AdminActionBody
): Promise<{ status: RequestStatus; eventId?: string | null; submission?: { status: string; eventId: string | null } }> {
  const r = await queryOne<{
    id: string; status: RequestStatus; member_id: string; event_id: string | null; promoter_id: string | null;
    places: number; guestlist_entry_id: string | null; admin_notes: string | null; request_type: RequestType;
    event_promoter_id: string | null; display_name: string; email: string; currency: string;
    external_url: string | null; external_name: string | null; import_submission_id: string | null;
  }>(
    `select r.id, r.status, r.member_id, r.event_id, r.promoter_id, r.places, r.guestlist_entry_id,
            r.admin_notes, r.request_type, e.promoter_id as event_promoter_id, m.display_name, m.email, r.currency,
            x.url as external_url, x.name as external_name, x.import_submission_id
       from member_access_requests r
       left join events e on e.id = r.event_id
       left join member_request_external_events x on x.request_id = r.id
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

  // Put the member on the real door list. Only possible when the request is
  // linked to an event with a promoter (entries require both); otherwise the
  // request itself is the record and the member message says how entry works.
  const ensureGuestlistEntry = () => ensureDoorEntry(r, promoterId, admin.id);

  let next: RequestStatus = r.status;
  let result: { eventId?: string | null; submission?: { status: string; eventId: string | null } } = {};
  switch (action) {
    case 'reviewing':
    case 'reopen': {
      next = 'reviewing';
      await setStatus(next, action === 'reopen' ? { outcome_reason: null } : {});
      await timeline(next, note);
      break;
    }
    case 'link_event': {
      const eventId = UUID.test(String(body.eventId)) ? String(body.eventId) : null;
      const ev = eventId ? await queryOne<{ id: string; title: string; promoter_id: string | null }>(
        `select id, title, promoter_id from events where id = $1`, [eventId]) : null;
      if (!ev) throw new AuthError(404, 'Event not found');
      await query(
        `update member_access_requests
            set event_id = $2, promoter_id = coalesce(promoter_id, $3), suggested_event_id = null, match_confidence = 'admin',
                linked_by_member_id = $4, linked_at = now(), handled_by_member_id = $4, updated_at = now()
          where id = $1`,
        [requestId, ev.id, ev.promoter_id, admin.id]
      );
      await timeline(null, `Linked to Guestlist event: ${ev.title}`);
      await track('external_event_linked', { memberId: r.member_id, eventId: ev.id, promoterId: ev.promoter_id, metadata: { by: admin.id } });
      await audit('access_request_linked', { actorId: admin.id, eventId: ev.id, detail: { requestId } });
      result = { eventId: ev.id };
      break;
    }
    case 'import_event': {
      if (!r.external_url) throw new AuthError(400, 'No link to import from — add the event by hand instead');
      if (r.import_submission_id) throw new AuthError(409, 'Already sent through the import pipeline — check the review queue');
      // The existing, SSRF-hardened submission pipeline. Lands in the review
      // queue like any other paste-a-link; nothing is published here.
      const outcome = await processUrlSubmission(r.external_url, admin.id);
      if (outcome.status === 'invalid') throw new AuthError(400, outcome.message);
      await query(
        `update member_request_external_events set import_submission_id = $2, created_event_id = $3, updated_at = now() where request_id = $1`,
        [requestId, outcome.submissionId, outcome.eventId]
      );
      if (outcome.eventId) {
        await query(
          `update member_access_requests set event_id = coalesce(event_id, $2), suggested_event_id = null, match_confidence = 'import',
                  linked_by_member_id = $3, linked_at = now(), handled_by_member_id = $3, updated_at = now() where id = $1`,
          [requestId, outcome.eventId, admin.id]
        );
        await track('external_event_created', { memberId: r.member_id, eventId: outcome.eventId, metadata: { by: admin.id, outcome: outcome.status } });
      }
      await timeline(null, `Import: ${outcome.status}${outcome.summary?.title ? ` — ${outcome.summary.title}` : ''}`);
      await audit('access_request_imported', { actorId: admin.id, eventId: outcome.eventId, detail: { requestId, outcome: outcome.status } });
      result = { eventId: outcome.eventId, submission: { status: outcome.status, eventId: outcome.eventId } };
      break;
    }
    case 'assign_promoter': {
      const pid = UUID.test(String(body.promoterId)) ? String(body.promoterId) : null;
      const p = pid ? await queryOne<{ id: string; name: string }>(`select id, name from promoters where id = $1`, [pid]) : null;
      if (!p) throw new AuthError(404, 'Promoter not found');
      await query(`update member_access_requests set promoter_id = $2, handled_by_member_id = $3, updated_at = now() where id = $1`, [requestId, p.id, admin.id]);
      await timeline(null, `Promoter assigned: ${p.name}`);
      await audit('access_request_promoter_assigned', { actorId: admin.id, promoterId: p.id, detail: { requestId } });
      break;
    }
    case 'contact_promoter':
    case 'log_outreach': {
      if (!promoterId) throw new AuthError(400, 'Assign a promoter first');
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
      if (OPEN_STATUSES.includes(r.status)) {
        next = 'contacting_promoter';
        await setStatus(next);
      }
      await timeline(next, `${direction === 'inbound' ? 'Heard from' : 'Contacted'} promoter (${channel}) — ${outcome}: ${summary}`);
      await track('promoter_contacted', { memberId: admin.id, eventId: r.event_id, promoterId, metadata: { outcome, channel, external: !r.event_id } });
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
        outcome_reason: null,
        guestlist_entry_id: entryId,
        member_message: memberMessage,
      }, true);
      await timeline(next, note ?? (entryId ? 'Confirmed free — on the door list' : 'Confirmed free'));
      // A place at a door deserves the pass, not a status update. When there
      // is a real door list entry the guestlist email carries everything the
      // generic one would have said and a code the door can scan, so only one
      // of the two is sent.
      const sentPass = entryId
        ? await sendGuestlistConfirmed(entryId).catch((err) => { console.error('guestlist email failed', err); return false; })
        : false;
      await tellMember(requestId, { skipEmail: sentPass });
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
        outcome_reason: null,
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
        outcome_reason: null,
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
      const raw = body.outcomeReason ?? body.declineReason;
      const reason = OUTCOME_REASONS.some(([k]) => k === raw) ? raw : null;
      if (!reason) throw new AuthError(400, 'Choose why — it’s how we learn where the gaps are');
      await setStatus(next, { outcome_reason: reason, member_message: memberMessage }, true);
      if (r.guestlist_entry_id) {
        await query(`update event_guestlist_entries set status = 'declined', updated_at = now()
                      where id = $1 and status in ('pending','confirmed')`, [r.guestlist_entry_id]);
      }
      await timeline(next, `${outcomeReasonLabel(reason)}${note ? ` — ${note}` : ''}`);
      await tellMember(requestId);
      break;
    }
    case 'answer': {
      // Advice-type asks close with what we think, not with a door list.
      if (!memberMessage) throw new AuthError(400, 'Write what you’d tell them');
      next = 'answered';
      await setStatus(next, { member_message: memberMessage, outcome_reason: null }, true);
      await timeline(next, note ?? 'Answered');
      await tellMember(requestId);
      break;
    }
    case 'message_member': {
      if (!memberMessage) throw new AuthError(400, 'Write the message');
      await query(`update member_access_requests set member_message = $2, handled_by_member_id = $3, updated_at = now() where id = $1`, [requestId, memberMessage, admin.id]);
      await timeline(null, `Message to member: ${memberMessage}`);
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
      await setStatus(next, { outcome_reason: 'other' });
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
  if (DECIDED_STATUSES.includes(next) && next !== r.status) {
    await track('get_me_in_decided', { memberId: r.member_id, eventId: r.event_id, promoterId,
      metadata: { status: next, by: admin.id, outcome_reason: body.outcomeReason ?? body.declineReason ?? null, request_type: r.request_type } });
    if (!r.event_id || r.request_type !== 'event_access' || r.external_url) {
      await track(next === 'unavailable' ? 'ask_guestlist_declined' : 'ask_guestlist_fulfilled',
        { memberId: r.member_id, eventId: r.event_id, promoterId, metadata: { status: next, request_type: r.request_type } });
    }
  }
  await audit('access_request_updated', { actorId: admin.id, eventId: r.event_id, promoterId,
    detail: { requestId, action, from: r.status, to: next } });
  await refreshAdminReviewDigest();
  return { status: next, ...result };
}

// --- Reading (admin) -------------------------------------------------------------------

export type QueueRow = {
  id: string; status: RequestStatus; request_type: RequestType; origin: RequestOrigin; context: string | null;
  places: number; requested_at: string; decided_at: string | null;
  member_note: string | null; outcome_reason: string | null; guestlist_cost_pence: number;
  member_price_pence: number | null; currency: string; entry_status: string | null;
  member_id: string; member_name: string; member_email: string; member_slug: string | null;
  member_status: string | null; member_billing_source: string | null;
  event_id: string | null; title: string | null; slug: string | null; start_at: string | null; end_at: string | null; timezone: string | null;
  city: string | null; venue_name: string | null; price_from: string | null; price_to: string | null; event_currency: string | null;
  promoter_id: string | null; promoter_name: string | null; promoter_slug: string | null;
  relationship_status: string | null; promoter_contact_email: string | null; promoter_contact_phone: string | null;
  standard_allocation: string | null;
  member_requests_month: number; member_requests_week: number; member_lifetime_cost_pence: number;
  event_requests: number;
  suggested_event_id: string | null; suggested_title: string | null; match_confidence: string | null;
  external_url: string | null; external_host: string | null; external_name: string | null; external_venue: string | null;
  external_city: string | null; external_country: string | null; external_starts_at: string | null;
  external_price_pence: number | null; external_lineup: string | null;
  import_submission_id: string | null; created_event_id: string | null;
};

const QUEUE_SQL = `
  select r.id, r.status, r.request_type, r.origin, r.context, r.places, r.requested_at::text, r.decided_at::text, r.member_note, r.outcome_reason,
         r.guestlist_cost_pence, r.member_price_pence, r.currency, g.status as entry_status,
         m.id as member_id, m.display_name as member_name, m.email as member_email, m.slug as member_slug,
         ms.status as member_status, ms.billing_source as member_billing_source,
         e.id as event_id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone, e.city,
         v.name as venue_name, e.price_from::text, e.price_to::text, e.currency as event_currency,
         p.id as promoter_id, p.name as promoter_name, p.slug as promoter_slug, p.relationship_status,
         p.contact_email as promoter_contact_email, p.contact_phone as promoter_contact_phone, p.standard_allocation,
         (select count(*)::int from member_access_requests x2
           where x2.member_id = r.member_id and x2.requested_at > date_trunc('month', now())) as member_requests_month,
         (select count(*)::int from member_access_requests x2
           where x2.member_id = r.member_id and x2.requested_at > now() - interval '7 days' and x2.status <> 'cancelled') as member_requests_week,
         (select coalesce(sum(x2.guestlist_cost_pence), 0)::int from member_access_requests x2
           where x2.member_id = r.member_id and x2.status in ('confirmed_free','discounted','purchased_by_guestlist','attended')) as member_lifetime_cost_pence,
         (select count(*)::int from member_access_requests x2 where r.event_id is not null and x2.event_id = r.event_id and x2.status <> 'cancelled') as event_requests,
         r.suggested_event_id, se.title as suggested_title, r.match_confidence,
         x.url as external_url, x.url_host as external_host, x.name as external_name, x.venue_name as external_venue,
         x.city as external_city, x.country as external_country, x.starts_at::text as external_starts_at,
         x.ticket_price_pence as external_price_pence, x.lineup as external_lineup,
         x.import_submission_id, x.created_event_id
    from member_access_requests r
    join members m on m.id = r.member_id
    left join memberships ms on ms.member_id = m.id
    left join events e on e.id = r.event_id
    left join venues v on v.id = e.venue_id
    left join promoters p on p.id = coalesce(r.promoter_id, e.promoter_id)
    left join event_guestlist_entries g on g.id = r.guestlist_entry_id
    left join member_request_external_events x on x.request_id = r.id
    left join events se on se.id = r.suggested_event_id`;

export type QueueKind = 'all' | 'get_me_in' | 'ask_guestlist';

export async function adminQueue(view: 'open' | 'done' | 'all' = 'open', kind: QueueKind = 'all', limit = 100): Promise<QueueRow[]> {
  // Open = needs the desk: brokered requests still in flight, plus a
  // promoter-list request the promoter declined (worth a second look).
  const conds: string[] = [];
  if (view === 'open') conds.push(`(r.status in ('requested','reviewing','contacting_promoter','waitlisted') and (g.id is null or g.status = 'declined'))`);
  if (view === 'done') conds.push(`r.status not in ('requested','reviewing','contacting_promoter','waitlisted')`);
  if (kind === 'get_me_in') conds.push(`r.origin = 'get_me_in'`);
  if (kind === 'ask_guestlist') conds.push(`r.origin = 'ask_guestlist'`);
  return query<QueueRow>(
    `${QUEUE_SQL} ${conds.length ? `where ${conds.join(' and ')}` : ''}
      order by case when r.status in ('requested','reviewing','contacting_promoter','waitlisted') then 0 else 1 end,
               coalesce(e.start_at, x.starts_at, r.requested_at + interval '30 days') asc, r.requested_at asc
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
  // Other members asking for the same link, or the same event.
  same_ask: number;
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
  const [timeline, contacts, outreach, promoter_stats, member_history, member_summary, sameAsk] = await Promise.all([
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
    base.external_host && base.external_url
      ? queryOne<{ n: number }>(
          `select count(*)::int as n from member_access_requests r join member_request_external_events x on x.request_id = r.id
            where x.url_normalised = (select url_normalised from member_request_external_events where request_id = $1)
              and r.id <> $1 and r.status <> 'cancelled'`, [id])
      : Promise.resolve({ n: 0 }),
  ]);
  return { ...base, timeline, contacts, outreach, promoter_stats, member_history, member_summary, same_ask: sameAsk?.n ?? 0 };
}

// LINK EVENT / ASSIGN PROMOTER pickers.
export async function searchEventsForDesk(q: string, limit = 10): Promise<{ id: string; title: string; slug: string; start_at: string; city: string | null; status: string }[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return query(
    `select id, title, slug, start_at::text, city, status from events
      where status <> 'rejected' and (title ilike '%' || $1 || '%' or slug ilike '%' || $1 || '%')
      order by (start_at > now()) desc, start_at asc limit $2`,
    [term, limit]
  );
}

export async function searchPromotersForDesk(q: string, limit = 10): Promise<{ id: string; name: string; slug: string; relationship_status: string; city: string | null }[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return query(
    `select id, name, slug, relationship_status, city from promoters
      where name ilike '%' || $1 || '%' or slug ilike '%' || $1 || '%' or website ilike '%' || $1 || '%'
      order by name limit $2`,
    [term, limit]
  );
}

// --- Promoter relationship — derived, never denormalised ----------------------------------

export type PromoterRelationshipStats = {
  requests: number; members_sent: number; free_places: number; discounted_places: number;
  tickets_bought: number; cost_pence: number; value_delivered_pence: number; declined: number; outreach: number;
  external_requests: number;
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
       (select count(*)::int from promoter_outreach o where o.promoter_id = $1) as outreach,
       count(*) filter (where r.origin = 'ask_guestlist' and r.status <> 'cancelled')::int as external_requests
     from member_access_requests r where r.promoter_id = $1`,
    [promoterId]
  );
  return row ?? { requests: 0, members_sent: 0, free_places: 0, discounted_places: 0, tickets_bought: 0, cost_pence: 0, value_delivered_pence: 0, declined: 0, outreach: 0, external_requests: 0 };
}

// --- Member history — the desk's view of one person -------------------------------------------

export type MemberHistoryRow = {
  id: string; status: RequestStatus; request_type: RequestType; origin: RequestOrigin; places: number; requested_at: string;
  guestlist_cost_pence: number; member_price_pence: number | null; outcome_reason: string | null;
  title: string; slug: string | null; start_at: string | null;
};

export async function memberHistory(memberId: string, limit = 30): Promise<MemberHistoryRow[]> {
  return query<MemberHistoryRow>(
    `select r.id, r.status, r.request_type, r.origin, r.places, r.requested_at::text, r.guestlist_cost_pence, r.member_price_pence,
            r.outcome_reason, coalesce(e.title, x.name, x.url_host, 'Ask') as title, e.slug, coalesce(e.start_at, x.starts_at)::text as start_at
       from member_access_requests r
       left join events e on e.id = r.event_id
       left join member_request_external_events x on x.request_id = r.id
      where r.member_id = $1 order by r.requested_at desc limit $2`,
    [memberId, limit]
  );
}

export type MemberFulfilmentSummary = {
  requests_month: number; requests_lifetime: number; free_entries: number; discounts: number;
  purchased: number; declined: number; cost_month_pence: number; cost_lifetime_pence: number; plus_ones: number;
  asks: number;
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
       count(*) filter (where places > 1 and status <> 'cancelled')::int as plus_ones,
       count(*) filter (where origin = 'ask_guestlist' and status <> 'cancelled')::int as asks
     from member_access_requests where member_id = $1`,
    [memberId]
  );
  return row ?? { requests_month: 0, requests_lifetime: 0, free_entries: 0, discounts: 0, purchased: 0, declined: 0, cost_month_pence: 0, cost_lifetime_pence: 0, plus_ones: 0, asks: 0 };
}
