// PROMOTER → FOLLOWER ANNOUNCEMENTS.
//
// Core principle: promoters reach followers WITHOUT ever receiving follower
// contact data. Guestlist computes the audience internally from a NAMED
// targeting strategy, delivers through the V2D machinery (preferences,
// suppression, caps, idempotent dedupe keys), and reports aggregates only.
//
// The channel is structured and event-centric: event + update type +
// optional short plain-text note. No free-form bulk email, no HTML, no
// links, no uploaded lists, no tracking pixels. Deterministic validation —
// not a content-moderation AI.

import { query, queryOne } from './db';
import { track } from './analytics';
import { getSetting, setSetting } from './settings';
import { queueEmail, renderEmailHtml, unsubscribeUrl } from './email';
import { fmtEventDate, fmtEventTime } from './util';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

// ---------------------------------------------------------------------------
// Central caps — admin-adjustable in one place (system_settings), never
// scattered through components.
// ---------------------------------------------------------------------------

export type AnnouncementCaps = {
  per_promoter_per_7d: number;   // announcement flood control
  same_event_type_days: number;  // same event + same update type suppression
  min_aggregate: number;         // privacy floor for follower breakdowns
  batch_size: number;            // recipients processed per job run
};

export const ANNOUNCEMENT_CAP_DEFAULTS: AnnouncementCaps = {
  per_promoter_per_7d: 2,
  same_event_type_days: 7,
  min_aggregate: 5,
  batch_size: 200,
};

export async function announcementCaps(): Promise<AnnouncementCaps> {
  const stored = await getSetting<Partial<AnnouncementCaps>>('promoter_announcement_caps');
  const out = { ...ANNOUNCEMENT_CAP_DEFAULTS };
  for (const k of Object.keys(out) as (keyof AnnouncementCaps)[]) {
    const v = stored?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
  }
  return out;
}

export async function setAnnouncementCaps(caps: Partial<AnnouncementCaps>, adminId: string): Promise<void> {
  const current = await announcementCaps();
  await setSetting('promoter_announcement_caps', { ...current, ...caps }, adminId);
}

export async function announcementsGloballyPaused(): Promise<boolean> {
  return (await getSetting<boolean>('pause_promoter_announcements')) === true;
}

// ---------------------------------------------------------------------------
// Structured update types → template copy. Guestlist writes the message
// from event data; the promoter only picks the type and adds a short note.
// ---------------------------------------------------------------------------

export const UPDATE_TYPES = [
  'new_event', 'lineup_update', 'tickets_on_sale', 'final_tickets',
  'sold_out', 'date_change', 'venue_change', 'event_cancelled', 'event_update',
] as const;
export type UpdateType = (typeof UPDATE_TYPES)[number];

export const UPDATE_TYPE_LABELS: Record<UpdateType, string> = {
  new_event: 'New event',
  lineup_update: 'Lineup update',
  tickets_on_sale: 'Tickets on sale',
  final_tickets: 'Final tickets',
  sold_out: 'Sold out',
  date_change: 'Date change',
  venue_change: 'Venue change',
  event_cancelled: 'Event cancelled',
  event_update: 'Other event update',
};

function headlineFor(type: UpdateType, promoterName: string, eventTitle: string): string {
  switch (type) {
    case 'new_event': return `New from ${promoterName}: ${eventTitle}`;
    case 'lineup_update': return `Lineup update: ${eventTitle}`;
    case 'tickets_on_sale': return `Tickets on sale: ${eventTitle}`;
    case 'final_tickets': return `Final tickets: ${eventTitle}`;
    case 'sold_out': return `Sold out: ${eventTitle}`;
    case 'date_change': return `Date change: ${eventTitle}`;
    case 'venue_change': return `Venue change: ${eventTitle}`;
    case 'event_cancelled': return `Cancelled: ${eventTitle}`;
    case 'event_update': return `Update from ${promoterName}: ${eventTitle}`;
  }
}

// ---------------------------------------------------------------------------
// Deterministic note validation — the promoter's optional voice, kept safe.
// ---------------------------------------------------------------------------

export function validateNote(note: string | null | undefined): { note: string | null } | { error: string } {
  if (note == null || !note.trim()) return { note: null };
  const trimmed = note.trim();
  if (trimmed.length > 280) return { error: 'Notes are capped at 280 characters' };
  if (/[<>]/.test(trimmed)) return { error: 'Notes are plain text — no HTML' };
  if (/(https?:\/\/|www\.)/i.test(trimmed) || /\S+\.(com|net|org|io|co|uk|ly|to|gg)(\/|\b)/i.test(trimmed)) {
    return { error: 'No links in notes — the announcement already links to your event' };
  }
  return { note: trimmed };
}

// ---------------------------------------------------------------------------
// Audience: NAMED strategies, computed internally. Never a member list out.
// ---------------------------------------------------------------------------

export type Audience = 'all' | 'near_event' | 'genre_match' | 'city';

type EventRow = {
  id: string; title: string; slug: string; start_at: string; end_at: string | null;
  timezone: string; city: string | null; location_id: string | null;
  venue_name: string | null; status: string; listing_status: string; promoter_id: string | null;
};

async function announcementEvent(eventId: string): Promise<EventRow | null> {
  return queryOne<EventRow>(
    `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone, e.city,
            e.location_id, v.name as venue_name, e.status, e.listing_status, e.promoter_id
       from events e left join venues v on v.id = e.venue_id
      where e.id = $1`,
    [eventId]
  );
}

// The audience WHERE clause over followers. Placeholder names are passed
// in so callers keep full control of their parameter lists.
function audienceSql(audience: Audience, ph: { loc: string; date: string; event: string }): string {
  switch (audience) {
    case 'all':
      return 'true';
    case 'near_event':
    case 'city':
      // Near the event's location / the selected city: home city, followed
      // city, or a travel plan overlapping the event date. Private travel
      // plans are used ONLY as an internal filter — never shown to anyone.
      return `(${ph.loc}::uuid is not null and (
                m.home_location_id = ${ph.loc}
                or exists (select 1 from member_locations ml where ml.member_id = m.id and ml.location_id = ${ph.loc})
                or exists (select 1 from travel_plans tp where tp.member_id = m.id and tp.location_id = ${ph.loc}
                            and ${ph.date}::date between tp.start_date and tp.end_date)
              ))`;
    case 'genre_match':
      return `exists (select 1 from member_genres mg
                       join event_genres eg on eg.genre_id = mg.genre_id and eg.event_id = ${ph.event}
                      where mg.member_id = m.id)`;
  }
}

export type AudiencePreview = {
  followers: number;
  targeted: number;
  email_eligible: number;
  inapp_eligible: number;
};

export async function audiencePreview(
  promoterId: string,
  eventId: string,
  audience: Audience,
  locationId?: string | null
): Promise<AudiencePreview | { error: string }> {
  const event = await announcementEvent(eventId);
  if (!event) return { error: 'Event not found' };
  const loc = audience === 'city' ? (locationId ?? null) : event.location_id;
  const aud = audienceSql(audience, { loc: '$2', date: '$3', event: '$4' });
  const row = await queryOne<AudiencePreview>(
    `select
       count(*)::int as followers,
       count(*) filter (where ${aud})::int as targeted,
       count(*) filter (where ${aud}
         and coalesce(p.promoter_announcements, 'inapp') = 'email'
         and not exists (select 1 from email_suppressions s
                          where lower(s.email) = lower(m.email)
                            and s.scope in ('all', 'recommendations', 'promoter_announcements'))
       )::int as email_eligible,
       count(*) filter (where ${aud}
         and coalesce(p.promoter_announcements, 'inapp') in ('email', 'inapp'))::int as inapp_eligible
     from member_follows f
     join members m on m.id = f.member_id
     left join member_email_prefs p on p.member_id = m.id
    where f.entity_type = 'promoter' and f.entity_id = $1
      -- reference every parameter even for 'all' targeting (pg requires it)
      and ($2::uuid is null or true) and ($3::date is null or true) and ($4::uuid is null or true)`,
    [promoterId, loc, event.start_at.slice(0, 10), eventId]
  );
  return row ?? { followers: 0, targeted: 0, email_eligible: 0, inapp_eligible: 0 };
}

// ---------------------------------------------------------------------------
// Lifecycle: create (draft→queued/scheduled), cancel, admin block.
// Every action audited.
// ---------------------------------------------------------------------------

export class AnnouncementError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function audit(
  promoterId: string,
  action: string,
  opts: { announcementId?: string | null; actorId?: string | null; detail?: string | null } = {}
): Promise<void> {
  await query(
    `insert into promoter_announcement_audit (announcement_id, promoter_id, actor_member_id, action, detail)
     values ($1, $2, $3, $4, $5)`,
    [opts.announcementId ?? null, promoterId, opts.actorId ?? null, action, opts.detail ?? null]
  );
}

export async function createAnnouncement(input: {
  promoterId: string;
  actorId: string;
  eventId: string;
  updateType: string;
  note?: string | null;
  audience?: string;
  locationId?: string | null;
  scheduleFor?: string | null; // ISO timestamp → scheduled; absent → queued now
}): Promise<{ id: string; status: string }> {
  const promoter = await queryOne<{ name: string; claim_status: string; announcements_paused: boolean }>(
    `select name, claim_status, announcements_paused from promoters where id = $1`,
    [input.promoterId]
  );
  if (!promoter) throw new AnnouncementError(404, 'Promoter not found');
  // VERIFIED promoters only — unclaimed, pending, rejected and suspended
  // profiles cannot reach followers, and suspension is immediate.
  if (promoter.claim_status !== 'verified') {
    throw new AnnouncementError(403, 'Only verified promoters can send announcements');
  }
  if (promoter.announcements_paused) {
    throw new AnnouncementError(403, 'Announcements are paused for this promoter');
  }
  if (await announcementsGloballyPaused()) {
    throw new AnnouncementError(503, 'Announcements are temporarily paused');
  }

  const event = await announcementEvent(input.eventId);
  if (!event) throw new AnnouncementError(404, 'Event not found');
  // Event-centric and OWNED: a promoter can only announce their own events.
  if (event.promoter_id !== input.promoterId) {
    throw new AnnouncementError(403, 'You can only announce your own events');
  }
  if (event.status !== 'live') throw new AnnouncementError(400, 'The event must be live first');
  const updateType = input.updateType as UpdateType;
  if (!UPDATE_TYPES.includes(updateType)) throw new AnnouncementError(400, 'Unknown update type');
  if (event.listing_status === 'cancelled' && updateType !== 'event_cancelled') {
    throw new AnnouncementError(400, 'This event is cancelled — only a cancellation notice can be sent');
  }

  const noteCheck = validateNote(input.note);
  if ('error' in noteCheck) throw new AnnouncementError(400, noteCheck.error);

  const audience: Audience = (['all', 'near_event', 'genre_match', 'city'] as const)
    .includes(input.audience as Audience) ? (input.audience as Audience) : 'all';
  const locationId = audience === 'city' ? (input.locationId ?? null) : null;
  if (audience === 'city' && !locationId) throw new AnnouncementError(400, 'Pick a city for city targeting');

  const caps = await announcementCaps();
  // Flood control: max N live announcements per promoter per rolling 7 days.
  const recent = await queryOne<{ n: number }>(
    `select count(*)::int as n from promoter_announcements
      where promoter_id = $1 and status in ('scheduled', 'queued', 'sending', 'sent')
        and created_at > now() - interval '7 days'`,
    [input.promoterId]
  );
  if ((recent?.n ?? 0) >= caps.per_promoter_per_7d) {
    throw new AnnouncementError(429,
      `Limit reached: ${caps.per_promoter_per_7d} announcements per 7 days`);
  }
  // Same-message suppression: one update type per event per window.
  const dupe = await queryOne(
    `select 1 from promoter_announcements
      where promoter_id = $1 and event_id = $2 and update_type = $3
        and status in ('scheduled', 'queued', 'sending', 'sent')
        and created_at > now() - interval '1 day' * $4`,
    [input.promoterId, input.eventId, updateType, caps.same_event_type_days]
  );
  if (dupe) {
    throw new AnnouncementError(409, 'You already sent this update for this event');
  }

  let scheduledFor: Date | null = null;
  if (input.scheduleFor) {
    scheduledFor = new Date(input.scheduleFor);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now() - 60_000) {
      throw new AnnouncementError(400, 'Schedule time must be in the future');
    }
  }

  const preview = await audiencePreview(input.promoterId, input.eventId, audience, locationId);
  if ('error' in preview) throw new AnnouncementError(400, preview.error);

  const status = scheduledFor ? 'scheduled' : 'queued';
  const row = await queryOne<{ id: string }>(
    `insert into promoter_announcements
       (promoter_id, event_id, created_by, update_type, note, audience, audience_location_id,
        status, scheduled_for, preview)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id`,
    [input.promoterId, input.eventId, input.actorId, updateType, noteCheck.note,
     audience, locationId, status, scheduledFor, JSON.stringify(preview)]
  );
  await audit(input.promoterId, 'created', {
    announcementId: row!.id, actorId: input.actorId,
    detail: `${updateType} · ${audience} · ${status}`,
  });
  if (scheduledFor) {
    await audit(input.promoterId, 'scheduled', {
      announcementId: row!.id, actorId: input.actorId, detail: scheduledFor.toISOString(),
    });
  } else {
    await audit(input.promoterId, 'queued', { announcementId: row!.id, actorId: input.actorId });
  }
  await track('announcement_created', {
    memberId: input.actorId, promoterId: input.promoterId, eventId: input.eventId,
    metadata: { update_type: updateType, audience, status },
  });
  return { id: row!.id, status };
}

export async function cancelAnnouncement(
  announcementId: string, promoterId: string, actorId: string
): Promise<boolean> {
  const row = await queryOne(
    `update promoter_announcements set status = 'cancelled'
      where id = $1 and promoter_id = $2 and status in ('draft', 'scheduled', 'queued')
      returning id`,
    [announcementId, promoterId]
  );
  if (row) await audit(promoterId, 'cancelled', { announcementId, actorId });
  return !!row;
}

// ---------------------------------------------------------------------------
// DELIVERY — batched, idempotent, retry-safe. Runs inside the hourly job
// (and on demand). The audience is computed at DELIVERY time, so an
// unfollow or unsubscribe between queue and send excludes the member.
// ---------------------------------------------------------------------------

export async function processAnnouncements(opts: { batchLimit?: number } = {}): Promise<{
  processed: number; inapp: number; emails: number;
}> {
  if (await announcementsGloballyPaused()) return { processed: 0, inapp: 0, emails: 0 };
  const caps = await announcementCaps();
  const batch = Math.min(opts.batchLimit ?? caps.batch_size, 1000);

  const due = await query<{
    id: string; promoter_id: string; event_id: string; update_type: UpdateType;
    note: string | null; audience: Audience; audience_location_id: string | null;
    status: string;
  }>(
    `select id, promoter_id, event_id, update_type, note, audience, audience_location_id, status
       from promoter_announcements
      where status in ('queued', 'sending')
         or (status = 'scheduled' and scheduled_for <= now())
      order by created_at
      limit 5`
  );

  let processed = 0;
  let inappTotal = 0;
  let emailTotal = 0;

  for (const ann of due) {
    // Suspension/pause is immediate — checked per run, not just at create.
    const promoter = await queryOne<{ name: string; claim_status: string; announcements_paused: boolean }>(
      `select name, claim_status, announcements_paused from promoters where id = $1`,
      [ann.promoter_id]
    );
    const event = await announcementEvent(ann.event_id);
    if (!promoter || promoter.claim_status !== 'verified' || promoter.announcements_paused || !event) {
      await query(
        `update promoter_announcements set status = 'blocked',
                blocked_reason = coalesce(blocked_reason, 'promoter not eligible at send time')
          where id = $1`, [ann.id]);
      await audit(ann.promoter_id, 'blocked', { announcementId: ann.id, detail: 'not eligible at send time' });
      continue;
    }
    // Timezone honesty: never announce a night that has already started —
    // unless the update is exactly the kind you'd want late (cancelled,
    // date change, venue change).
    const started = new Date(event.start_at).getTime() < Date.now();
    if (started && !['event_cancelled', 'date_change', 'venue_change'].includes(ann.update_type)) {
      await query(
        `update promoter_announcements set status = 'cancelled',
                blocked_reason = 'event already started before delivery'
          where id = $1`, [ann.id]);
      await audit(ann.promoter_id, 'cancelled', { announcementId: ann.id, detail: 'event already started' });
      continue;
    }

    await query(`update promoter_announcements set status = 'sending' where id = $1`, [ann.id]);
    processed++;

    const loc = ann.audience === 'city' ? ann.audience_location_id : event.location_id;
    // Recipients not yet delivered in-app (idempotent across job re-runs).
    const recipients = await query<{ id: string; email: string; pref: string }>(
      `select m.id, m.email, coalesce(p.promoter_announcements, 'inapp') as pref
         from member_follows f
         join members m on m.id = f.member_id
         left join member_email_prefs p on p.member_id = m.id
        where f.entity_type = 'promoter' and f.entity_id = $1
          and coalesce(p.promoter_announcements, 'inapp') <> 'off'
          and ${audienceSql(ann.audience, { loc: '$2', date: '$3', event: '$4' })}
          and not exists (select 1 from notifications n
                           where n.member_id = m.id and n.announcement_id = $5)
          and ($2::uuid is null or true) and ($3::date is null or true) and ($4::uuid is null or true)
        limit $6`,
      [ann.promoter_id, loc, event.start_at.slice(0, 10), ann.event_id, ann.id, batch]
    );

    const headline = headlineFor(ann.update_type, promoter.name, event.title);
    const src = `ann-${ann.id.slice(0, 8)}`;
    const when = `${fmtEventDate(event.start_at, event.end_at, event.timezone)} · ${fmtEventTime(event.start_at, event.end_at, event.timezone)}`;
    const whereLine = [event.venue_name, event.city].filter(Boolean).join(' · ');
    let inapp = 0;
    let emails = 0;

    for (const r of recipients) {
      // ONE useful communication (Part 14): if this member already has a
      // recent alert about this exact event (new-event alert, close friend
      // going, connection going), fold the announcement into it instead of
      // stacking a second notification.
      const existing = await queryOne<{ id: string }>(
        `select id from notifications
          where member_id = $1 and event_id = $2
            and type in ('event_alert', 'close_friend_going', 'connection_going')
            and created_at > now() - interval '7 days'
          order by created_at desc limit 1`,
        [r.id, ann.event_id]
      );
      if (existing) {
        const merged = await queryOne(
          `update notifications
              set payload = payload || $2, read_at = null
            where id = $1
              and not exists (select 1 from notifications d
                               where d.member_id = $3 and d.announcement_id = $4)
            returning id`,
          [existing.id,
           JSON.stringify({ announcement: headline, announcement_note: ann.note, src }),
           r.id, ann.id]
        );
        // Mark delivery via a dedicated row? No — the merged payload IS the
        // delivery. Record it in the dedupe index with a zero-noise insert.
        if (merged) {
          await query(
            `insert into notifications (member_id, type, event_id, promoter_id, announcement_id, payload, read_at)
             values ($1, 'promoter_announcement', $2, $3, $4, $5, now())
             on conflict do nothing`,
            [r.id, ann.event_id, ann.promoter_id, ann.id,
             JSON.stringify({ merged_into: existing.id, title: event.title, slug: event.slug })]
          );
          inapp++;
          continue; // no second email either — the alert already carried one
        }
      }

      const inserted = await queryOne<{ id: string }>(
        `insert into notifications (member_id, type, event_id, promoter_id, announcement_id, payload)
         values ($1, 'promoter_announcement', $2, $3, $4, $5)
         on conflict do nothing returning id`,
        [r.id, ann.event_id, ann.promoter_id, ann.id,
         JSON.stringify({
           message: headline, note: ann.note, title: event.title, slug: event.slug,
           promoter_name: promoter.name, src,
         })]
      );
      if (!inserted) continue;
      inapp++;

      if (r.pref === 'email') {
        // Email dedupe against other event emails this week: an alert email
        // for the same event already reached them → in-app only.
        const alreadyEmailed = await queryOne(
          `select 1 from email_outbox
            where member_id = $1 and status not in ('failed', 'suppressed')
              and created_at > now() - interval '7 days'
              and (dedupe_key = 'alert:' || $1 || ':' || $2
                   or dedupe_key like 'conn:' || $1 || ':%:' || $2)`,
          [r.id, ann.event_id]
        );
        if (alreadyEmailed) continue;
        const url = `${SITE}/events/${event.slug}?src=${src}`;
        const { outcome } = await queueEmail({
          recipientEmail: r.email,
          memberId: r.id,
          promoterId: ann.promoter_id,
          emailType: 'promoter_announcement',
          subject: headline,
          bodyText: [
            headline, when, whereLine, ann.note ? `\n“${ann.note}” — ${promoter.name}` : '',
            '', url, `Stop these: ${unsubscribeUrl(r.id, 'promoter_announcements')}`,
          ].filter((l) => l !== '').join('\n'),
          bodyHtml: renderEmailHtml({
            heading: headline,
            intro: [when, whereLine].filter(Boolean).join(' — '),
            events: [{
              title: event.title,
              meta: [when, whereLine].filter(Boolean).join(' · '),
              reason: ann.note ? `“${ann.note}” — ${promoter.name}` : null,
              url,
            }],
            cta: { label: ann.update_type === 'event_cancelled' ? 'VIEW DETAILS' : 'TICKETS / VIEW EVENT', url },
            memberId: r.id,
            emailType: 'promoter_announcement',
          }),
          dedupeKey: `ann:${ann.id}:${r.id}`,
        });
        if (outcome === 'queued') emails++;
      }
    }

    await query(
      `update promoter_announcements
          set delivered_inapp = delivered_inapp + $2,
              delivered_email = delivered_email + $3
        where id = $1`,
      [ann.id, inapp, emails]
    );
    inappTotal += inapp;
    emailTotal += emails;

    // Done when the batch came back short of the limit.
    if (recipients.length < batch) {
      await query(
        `update promoter_announcements set status = 'sent', sent_at = coalesce(sent_at, now())
          where id = $1`, [ann.id]);
      await audit(ann.promoter_id, 'sent', { announcementId: ann.id, detail: `in-app +${inapp}, email +${emails}` });
      await track('announcement_sent', {
        promoterId: ann.promoter_id, eventId: ann.event_id,
        metadata: { announcement_id: ann.id },
      });
    }
  }
  return { processed, inapp: inappTotal, emails: emailTotal };
}

// ---------------------------------------------------------------------------
// ANALYTICS — honest attribution. "From this announcement" = carried the
// announcement's src token. Everything else is labeled "since sent".
// ---------------------------------------------------------------------------

export type AnnouncementStats = {
  id: string;
  update_type: string;
  audience: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  event_title: string;
  event_slug: string;
  preview: AudiencePreview | Record<string, never>;
  delivered_inapp: number;
  delivered_email: number;
  emails_sent: number;
  attributed_views: number;
  attributed_ticket_clicks: number;
  going_since: number;
  interested_since: number;
  unsubscribes: number;
  note: string | null;
};

export async function announcementStats(promoterId: string): Promise<AnnouncementStats[]> {
  const rows = await query<AnnouncementStats & { event_id: string }>(
    `select a.id, a.update_type, a.audience, a.status, a.created_at::text, a.sent_at::text,
            a.note, a.preview, a.delivered_inapp, a.delivered_email, a.event_id,
            e.title as event_title, e.slug as event_slug,
            (select count(*)::int from email_outbox o
              where o.dedupe_key like 'ann:' || a.id || ':%'
                and o.status in ('sent', 'dev_logged', 'pending', 'processing')) as emails_sent,
            (select count(*)::int from analytics_events ae
              where ae.event_type = 'event_viewed' and ae.event_id = a.event_id
                and ae.metadata->>'src' = 'ann-' || left(a.id::text, 8)) as attributed_views,
            (select count(*)::int from analytics_events ae
              where ae.event_type = 'ticket_clicked' and ae.event_id = a.event_id
                and ae.metadata->>'src' = 'ann-' || left(a.id::text, 8)) as attributed_ticket_clicks,
            coalesce((select count(*)::int from member_event_actions mea
              where mea.event_id = a.event_id and mea.rsvp = 'going'
                and a.sent_at is not null and mea.rsvp_at > a.sent_at), 0) as going_since,
            coalesce((select count(*)::int from member_event_actions mea
              where mea.event_id = a.event_id and mea.rsvp = 'interested'
                and a.sent_at is not null and mea.rsvp_at > a.sent_at), 0) as interested_since,
            (select count(*)::int from email_suppressions s
              where s.scope = 'promoter_announcements'
                and a.sent_at is not null and s.created_at > a.sent_at) as unsubscribes
       from promoter_announcements a
       join events e on e.id = a.event_id
      where a.promoter_id = $1
      order by a.created_at desc
      limit 25`,
    [promoterId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// FOLLOWER DASHBOARD — aggregates only, behind a privacy floor. No names,
// no emails, no exportable lists.
// ---------------------------------------------------------------------------

export type FollowerStats = {
  total: number;
  new_7d: number;
  new_30d: number;
  new_90d: number;
  top_cities: { city: string; n: number }[];
  top_genres: { genre: string; n: number }[];
  engagement: { views_30d: number; interested_30d: number; going_30d: number; ticket_clicks_30d: number };
  insight: string | null;
};

export async function followerStats(promoterId: string): Promise<FollowerStats> {
  const caps = await announcementCaps();
  const floor = caps.min_aggregate;

  const [totals, cities, genres, engagement, genreEngagement] = await Promise.all([
    queryOne<{ total: number; new_7d: number; new_30d: number; new_90d: number }>(
      `select count(*)::int as total,
              count(*) filter (where f.created_at > now() - interval '7 days')::int as new_7d,
              count(*) filter (where f.created_at > now() - interval '30 days')::int as new_30d,
              count(*) filter (where f.created_at > now() - interval '90 days')::int as new_90d
         from member_follows f
        where f.entity_type = 'promoter' and f.entity_id = $1`,
      [promoterId]
    ),
    // City breakdown uses members' VISIBLE home city only, and a row must
    // clear the aggregate floor before it is shown at all.
    query<{ city: string; n: number }>(
      `select m.home_city as city, count(*)::int as n
         from member_follows f
         join members m on m.id = f.member_id
        where f.entity_type = 'promoter' and f.entity_id = $1
          and m.home_city is not null
          and coalesce((select mp.show_home_city from member_privacy mp where mp.member_id = m.id), true)
        group by m.home_city
       having count(*) >= $2
        order by n desc limit 5`,
      [promoterId, floor]
    ),
    query<{ genre: string; n: number }>(
      `select g.name as genre, count(distinct f.member_id)::int as n
         from member_follows f
         join member_genres mg on mg.member_id = f.member_id
         join genres g on g.id = mg.genre_id
        where f.entity_type = 'promoter' and f.entity_id = $1
        group by g.name
       having count(distinct f.member_id) >= $2
        order by n desc limit 5`,
      [promoterId, floor]
    ),
    queryOne<{ views_30d: number; interested_30d: number; going_30d: number; ticket_clicks_30d: number }>(
      `select
         (select count(*)::int from analytics_events ae
           where ae.promoter_id = $1 and ae.event_type = 'event_viewed'
             and ae.created_at > now() - interval '30 days'
             and exists (select 1 from member_follows f where f.member_id = ae.member_id
                          and f.entity_type = 'promoter' and f.entity_id = $1)) as views_30d,
         (select count(*)::int from member_event_actions mea
           join events e on e.id = mea.event_id and e.promoter_id = $1
          where mea.rsvp = 'interested' and mea.rsvp_at > now() - interval '30 days'
            and exists (select 1 from member_follows f where f.member_id = mea.member_id
                         and f.entity_type = 'promoter' and f.entity_id = $1)) as interested_30d,
         (select count(*)::int from member_event_actions mea
           join events e on e.id = mea.event_id and e.promoter_id = $1
          where mea.rsvp = 'going' and mea.rsvp_at > now() - interval '30 days'
            and exists (select 1 from member_follows f where f.member_id = mea.member_id
                         and f.entity_type = 'promoter' and f.entity_id = $1)) as going_30d,
         (select count(*)::int from analytics_events ae
           where ae.promoter_id = $1 and ae.event_type = 'ticket_clicked'
             and ae.created_at > now() - interval '30 days'
             and exists (select 1 from member_follows f where f.member_id = ae.member_id
                          and f.entity_type = 'promoter' and f.entity_id = $1)) as ticket_clicks_30d`,
      [promoterId]
    ),
    // Feedback loop: which of the promoter's OWN event genres draw the most
    // follower engagement (aggregate, floored — never per-member profiling).
    query<{ genre: string; n: number }>(
      `select g.name as genre, count(*)::int as n
         from member_event_actions mea
         join events e on e.id = mea.event_id and e.promoter_id = $1
         join event_genres eg on eg.event_id = e.id
         join genres g on g.id = eg.genre_id
        where mea.rsvp in ('interested', 'going')
          and exists (select 1 from member_follows f where f.member_id = mea.member_id
                       and f.entity_type = 'promoter' and f.entity_id = $1)
        group by g.name
       having count(*) >= $2
        order by n desc limit 1`,
      [promoterId, floor]
    ),
  ]);

  return {
    total: totals?.total ?? 0,
    new_7d: totals?.new_7d ?? 0,
    new_30d: totals?.new_30d ?? 0,
    new_90d: totals?.new_90d ?? 0,
    top_cities: cities,
    top_genres: genres,
    engagement: engagement ?? { views_30d: 0, interested_30d: 0, going_30d: 0, ticket_clicks_30d: 0 },
    insight: genreEngagement[0]
      ? `Your followers respond most to your ${genreEngagement[0].genre} events`
      : null,
  };
}
