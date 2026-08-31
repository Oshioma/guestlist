// Email delivery: ONE outbox, one provider boundary, full lifecycle.
//
//   queueEmail()          — idempotent enqueue (dedupe_key), suppression +
//                           pause + fatigue checks, SUPPRESSED audit rows
//   processEmailQueue()   — delivery with bounded retries/backoff; with
//                           RESEND_API_KEY + EMAIL_FROM mail actually sends,
//                           without them everything is dev_logged (fixture
//                           and test email can never escape)
//   unsubscribe tokens    — HMAC-signed, no login required
//
// Digests use the SAME V2C recommendation service as the website. Email
// classification: TRANSACTIONAL (invites, claim decisions, source errors)
// is never suppressed by a recommendations unsubscribe; everything else is.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { query, queryOne } from './db';
import { track } from './analytics';
import { getEmailPrefs } from './privacy';
import { getSafetySwitches } from './settings';
import { getRecommendedEvents, reasonText, weekendWindow, type RecommendedEvent } from './recommend';
import { fmtEventDate } from './util';

const SITE = process.env.SITE_URL ?? 'https://www.clubguestlists.com';

export const EMAIL_LIMITS = {
  maxAttempts: 3,
  retryBackoffMinutes: [5, 30, 120], // by attempt number
  maxAlertEmailsPerMemberPerDay: 3,  // non-transactional, non-digest
} as const;

// --- Classification ---------------------------------------------------------

// Transactional email keeps flowing even after a recommendations
// unsubscribe (but an 'all' suppression from a bounce still stops it).
const TRANSACTIONAL_PREFIXES = [
  'notification:', 'team_invite', 'claim_decision', 'promoter_review',
];

export function isTransactional(emailType: string): boolean {
  return TRANSACTIONAL_PREFIXES.some((p) => emailType.startsWith(p));
}

// Unsubscribe scope family for a type (what the link in the footer stops).
export function scopeFor(emailType: string): string {
  if (emailType.startsWith('alert')) return 'alerts';
  if (emailType.startsWith('daily_digest')) return 'alerts';
  if (emailType.startsWith('member_weekly_digest')) return 'weekly_digest';
  if (emailType.startsWith('event_reminder')) return 'reminders';
  if (emailType.startsWith('travel')) return 'alerts';
  if (emailType.startsWith('city_digest')) return 'alerts';
  if (emailType.startsWith('promoter_weekly_digest')) return 'promoter_digest';
  if (emailType.startsWith('promoter_announcement')) return 'promoter_announcements';
  return 'recommendations';
}

// --- Unsubscribe tokens ------------------------------------------------------

function unsubscribeSecret(): string {
  return process.env.SESSION_SECRET ?? 'dev-secret';
}

export function unsubscribeToken(memberId: string, scope: string): string {
  return createHmac('sha256', unsubscribeSecret())
    .update(`unsub:${memberId}:${scope}`)
    .digest('hex')
    .slice(0, 32);
}

export function verifyUnsubscribeToken(memberId: string, scope: string, token: string): boolean {
  const expected = unsubscribeToken(memberId, scope);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function unsubscribeUrl(memberId: string, scope: string): string {
  return `${SITE}/api/email/unsubscribe?m=${memberId}&s=${encodeURIComponent(scope)}&t=${unsubscribeToken(memberId, scope)}`;
}

// --- Suppression -------------------------------------------------------------

export async function isSuppressed(email: string, emailType: string): Promise<boolean> {
  const scopes = ['all'];
  if (!isTransactional(emailType)) scopes.push('recommendations', scopeFor(emailType));
  const row = await queryOne(
    `select 1 from email_suppressions where lower(email) = lower($1) and scope = any($2)`,
    [email, scopes]
  );
  // 'all' from a bounce stops even transactional mail (the address is dead).
  if (isTransactional(emailType)) {
    const hard = await queryOne(
      `select 1 from email_suppressions where lower(email) = lower($1) and scope = 'all' and source = 'bounce'`,
      [email]
    );
    return !!hard;
  }
  return !!row;
}

export async function suppress(
  email: string,
  scope: string,
  source: 'unsubscribe' | 'bounce' | 'admin',
  memberId?: string | null
): Promise<void> {
  await query(
    `insert into email_suppressions (email, member_id, scope, source)
     values (lower($1), $2, $3, $4) on conflict (email, scope) do nothing`,
    [email, memberId ?? null, scope, source]
  );
}

async function isPaused(emailType: string): Promise<boolean> {
  const s = await getSafetySwitches();
  if (s.paused_alert_types.some((t) => emailType.startsWith(t))) return true;
  if (isTransactional(emailType)) return false;
  if (emailType.startsWith('promoter_weekly_digest')) return s.pause_promoter_digests;
  if (emailType.startsWith('event_reminder')) return s.pause_event_reminders;
  return s.pause_recommendation_emails;
}

// --- Queueing ----------------------------------------------------------------

export async function queueEmail(opts: {
  recipientEmail: string;
  memberId?: string | null;
  promoterId?: string | null;
  emailType: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  dedupeKey?: string | null;
}): Promise<{ id: string | null; outcome: 'queued' | 'suppressed' | 'paused' | 'capped' | 'duplicate' }> {
  if (await isPaused(opts.emailType)) return { id: null, outcome: 'paused' };

  // Fatigue: cap instant alert email per member per day (digests exempt —
  // they ARE the fatigue control; transactional exempt).
  if (opts.memberId && opts.emailType.startsWith('alert')) {
    const sentToday = await queryOne<{ n: number }>(
      `select count(*)::int as n from email_outbox
        where member_id = $1 and email_type like 'alert%'
          and created_at > now() - interval '24 hours'
          and status not in ('suppressed', 'failed')`,
      [opts.memberId]
    );
    if ((sentToday?.n ?? 0) >= EMAIL_LIMITS.maxAlertEmailsPerMemberPerDay) {
      return { id: null, outcome: 'capped' };
    }
  }

  const suppressed = await isSuppressed(opts.recipientEmail, opts.emailType);
  const row = await queryOne<{ id: string }>(
    `insert into email_outbox
       (recipient_email, member_id, promoter_id, email_type, subject, body_text, body_html, dedupe_key, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (dedupe_key) where dedupe_key is not null do nothing
     returning id`,
    [opts.recipientEmail, opts.memberId ?? null, opts.promoterId ?? null,
     opts.emailType, opts.subject.slice(0, 200), opts.bodyText, opts.bodyHtml ?? null,
     opts.dedupeKey ?? null, suppressed ? 'suppressed' : 'pending']
  );
  if (!row) return { id: null, outcome: 'duplicate' };
  if (suppressed) return { id: row.id, outcome: 'suppressed' };
  await track('email_queued', {
    memberId: opts.memberId ?? null,
    promoterId: opts.promoterId ?? null,
    metadata: { email_type: opts.emailType },
  });
  return { id: row.id, outcome: 'queued' };
}

// --- Provider boundary -------------------------------------------------------

type DeliveryResult =
  | { outcome: 'sent'; providerMessageId: string | null }
  | { outcome: 'dev_logged' }
  | { outcome: 'failed'; category: 'temporary' | 'permanent'; error: string };

async function deliver(
  recipient: string,
  subject: string,
  text: string,
  html: string | null
): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    // No credentials: never attempt delivery — dev/test mail cannot escape.
    console.log(`[email dev_logged] to=${recipient} subject="${subject}"`);
    return { outcome: 'dev_logged' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [recipient], subject, text, ...(html ? { html } : {}) }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { outcome: 'sent', providerMessageId: typeof data.id === 'string' ? data.id : null };
    }
    const body = (await res.text()).slice(0, 300);
    // 429 + 5xx are worth retrying; other 4xx (bad address, bad payload) are not.
    const category = res.status === 429 || res.status >= 500 ? 'temporary' : 'permanent';
    return { outcome: 'failed', category, error: `provider ${res.status}: ${body}` };
  } catch (err) {
    return { outcome: 'failed', category: 'temporary', error: String(err).slice(0, 300) };
  }
}

export async function processEmailQueue(limit = 50): Promise<{
  sent: number; failed: number; devLogged: number; suppressed: number; retried: number;
}> {
  // pending rows, plus temporary failures whose backoff has elapsed.
  const backoffCase = EMAIL_LIMITS.retryBackoffMinutes
    .map((mins, i) => `when attempt_count = ${i + 1} then last_attempt_at < now() - interval '${mins} minutes'`)
    .join(' ');
  const rows = await query<{
    id: string; recipient_email: string; subject: string; body_text: string;
    body_html: string | null; email_type: string; member_id: string | null; attempt_count: number;
  }>(
    `update email_outbox set status = 'processing', last_attempt_at = now(),
            attempt_count = attempt_count + 1
      where id in (
        select id from email_outbox
         where status = 'pending'
            or (status = 'failed' and error_category = 'temporary'
                and attempt_count < ${EMAIL_LIMITS.maxAttempts}
                and case ${backoffCase} else false end)
         order by created_at limit $1
         for update skip locked)
      returning id, recipient_email, subject, body_text, body_html, email_type, member_id, attempt_count`,
    [limit]
  );

  let sent = 0, failed = 0, devLogged = 0, suppressed = 0, retried = 0;
  for (const row of rows) {
    if (row.attempt_count > 1) retried++;
    // Suppression re-check at send time (an unsubscribe may have landed
    // between queue and send).
    if (await isSuppressed(row.recipient_email, row.email_type)) {
      await query(`update email_outbox set status = 'suppressed' where id = $1`, [row.id]);
      suppressed++;
      continue;
    }
    const result = await deliver(row.recipient_email, row.subject, row.body_text, row.body_html);
    if (result.outcome === 'sent') {
      await query(
        `update email_outbox set status = 'sent', sent_at = now(), provider_message_id = $2 where id = $1`,
        [row.id, result.providerMessageId]
      );
      await track('email_sent', { memberId: row.member_id, metadata: { email_type: row.email_type } });
      sent++;
    } else if (result.outcome === 'dev_logged') {
      await query(`update email_outbox set status = 'dev_logged', sent_at = now() where id = $1`, [row.id]);
      devLogged++;
    } else {
      await query(
        `update email_outbox set status = 'failed', error = $2, error_category = $3 where id = $1`,
        [row.id, result.error, result.category]
      );
      await track('email_failed', {
        memberId: row.member_id,
        metadata: { email_type: row.email_type, category: result.category },
      });
      failed++;
    }
  }
  return { sent, failed, devLogged, suppressed, retried };
}

// Back-compat alias (V2C name).
export const sendPendingEmails = processEmailQueue;

// --- Branded rendering -------------------------------------------------------
// Email-client-safe: tables, inline styles, dark header on cream body,
// one dominant CTA. Mobile first, no exotic CSS.

export type EmailEventBlock = {
  title: string;
  meta: string;      // date · venue · city (event's own timezone/currency)
  reason?: string | null;
  url: string;
};

export function renderEmailHtml(opts: {
  heading: string;
  intro?: string | null;
  events?: EmailEventBlock[];
  footerLines?: string[];
  cta?: { label: string; url: string } | null;
  memberId?: string | null;
  emailType: string;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const events = (opts.events ?? [])
    .map(
      (e) => `
      <tr><td style="padding:0 0 18px 0;">
        <a href="${e.url}" style="text-decoration:none;color:#141414;">
          <div style="border:1px solid #e4dcc8;border-radius:12px;padding:16px 18px;background:#ffffff;">
            <div style="font-size:17px;font-weight:700;letter-spacing:-0.3px;color:#141414;">${esc(e.title)}</div>
            <div style="font-size:13px;color:#6f6a5c;margin-top:4px;">${esc(e.meta)}</div>
            ${e.reason ? `<div style="font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#9a7b1f;margin-top:9px;">${esc(e.reason)}</div>` : ''}
          </div>
        </a>
      </td></tr>`
    )
    .join('');
  const unsub =
    opts.memberId && !isTransactional(opts.emailType)
      ? `<a href="${unsubscribeUrl(opts.memberId, scopeFor(opts.emailType))}" style="color:#8a8574;">Stop these emails</a>
         &nbsp;·&nbsp;
         <a href="${unsubscribeUrl(opts.memberId, 'recommendations')}" style="color:#8a8574;">Stop all recommendations</a>
         &nbsp;·&nbsp;`
      : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3eee1;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3eee1;">
    <tr><td align="center" style="padding:0 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
        <tr><td style="background:#0d0d0c;border-radius:0 0 14px 14px;padding:22px 26px;">
          <span style="font-size:15px;font-weight:800;letter-spacing:4px;color:#f5f1e6;">GUEST<span style="color:#c9a2e8;">LIST</span></span>
        </td></tr>
        <tr><td style="padding:28px 6px 8px;">
          <div style="font-size:24px;font-weight:800;letter-spacing:-0.6px;color:#141414;">${esc(opts.heading)}</div>
          ${opts.intro ? `<div style="font-size:14px;color:#6f6a5c;margin-top:8px;line-height:1.5;">${esc(opts.intro)}</div>` : ''}
        </td></tr>
        <tr><td style="padding:14px 6px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${events}</table>
        </td></tr>
        ${opts.cta ? `
        <tr><td align="center" style="padding:8px 6px 26px;">
          <a href="${opts.cta.url}" style="display:inline-block;background:#7c4a9e;color:#ffffff;font-weight:800;font-size:14px;letter-spacing:0.4px;text-decoration:none;border-radius:12px;padding:14px 34px;">${esc(opts.cta.label)}</a>
        </td></tr>` : ''}
        <tr><td style="padding:10px 6px 34px;border-top:1px solid #e4dcc8;">
          <div style="font-size:11px;color:#8a8574;line-height:1.7;">
            ${(opts.footerLines ?? []).map(esc).join('<br/>')}
            ${opts.footerLines?.length ? '<br/>' : ''}
            ${unsub}<a href="${SITE}/you" style="color:#8a8574;">Email settings</a><br/>
            Guestlist — the best events for our community, not every event.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function eventBlocks(recs: RecommendedEvent[], src: string): EmailEventBlock[] {
  return recs.map((r) => ({
    title: r.title,
    meta: [fmtEventDate(r.start_at, r.end_at, r.timezone), r.venue_name, r.city].filter(Boolean).join(' · '),
    reason: r.reasons[0] ? reasonText(r.reasons[0]) : null,
    url: `${SITE}/events/${r.slug}?src=${src}`,
  }));
}

// ---------------------------------------------------------------------------
// Member weekly digest — same recommendation service as the website;
// location aware (home + followed cities + active travel handled inside
// getRecommendedEvents). Idempotent per member per ISO week.
// ---------------------------------------------------------------------------

export function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function queueMemberWeeklyDigest(memberId: string): Promise<boolean> {
  const prefs = await getEmailPrefs(memberId);
  if (!prefs.weekly_digest) return false;
  const member = await queryOne<{ email: string; display_name: string }>(
    `select email, display_name from members where id = $1`, [memberId]);
  if (!member) return false;
  const { from, to } = weekendWindow();
  const recs = await getRecommendedEvents(memberId, { limit: 5, from, to });
  if (!recs.length) return false; // never an empty digest

  const connectionNames = [...new Set(recs.flatMap((r) =>
    r.reasons.flatMap((x) => (x.code === 'CONNECTION_GOING' ? x.names.slice(0, 2) : []))))];
  const firstName = member.display_name.split(' ')[0];
  const intro = connectionNames.length
    ? `${connectionNames.slice(0, 2).join(' and ')} ${connectionNames.length === 1 ? 'is' : 'are'} going out this weekend. Here are your picks.`
    : `Here are your picks for this weekend.`;

  const text = [
    `Your weekend on Guestlist`,
    ``,
    `${firstName}, ${recs.length} event${recs.length === 1 ? '' : 's'} picked for you:`,
    ``,
    ...recs.map((r) => {
      const reason = r.reasons[0] ? ` — ${reasonText(r.reasons[0])}` : '';
      return `• ${r.title}\n  ${fmtEventDate(r.start_at, r.end_at, r.timezone)}${r.city ? ` · ${r.city}` : ''}${reason}\n  ${SITE}/events/${r.slug}?src=email-weekly`;
    }),
    ``,
    `See your weekend: ${SITE}/events?tab=this-weekend`,
    `Stop these: ${unsubscribeUrl(memberId, 'weekly_digest')}`,
  ].join('\n');

  const { outcome } = await queueEmail({
    recipientEmail: member.email,
    memberId,
    emailType: 'member_weekly_digest',
    subject: `Your weekend on Guestlist — ${recs.length} picks`,
    bodyText: text,
    bodyHtml: renderEmailHtml({
      heading: `${firstName}, your weekend.`,
      intro,
      events: eventBlocks(recs, 'email-weekly'),
      cta: { label: 'SEE YOUR WEEKEND', url: `${SITE}/events?tab=this-weekend` },
      memberId,
      emailType: 'member_weekly_digest',
    }),
    dedupeKey: `weekly:${memberId}:${isoWeek()}`,
  });
  return outcome === 'queued';
}

// ---------------------------------------------------------------------------
// Promoter weekly digest — real analytics only. Idempotent per ISO week.
// ---------------------------------------------------------------------------

export async function queuePromoterWeeklyDigest(promoterId: string): Promise<boolean> {
  const prefs = await queryOne<{ weekly_digest: boolean }>(
    `select weekly_digest from promoter_email_prefs where promoter_id = $1`, [promoterId]);
  if (prefs && !prefs.weekly_digest) return false;

  const promoter = await queryOne<{ name: string; slug: string }>(
    `select name, slug from promoters where id = $1`, [promoterId]);
  if (!promoter) return false;
  const recipients = await query<{ email: string; member_id: string }>(
    `select m.email, m.id as member_id from promoter_members pm
       join members m on m.id = pm.member_id
      where pm.promoter_id = $1 and pm.role in ('owner', 'admin')`,
    [promoterId]
  );
  if (!recipients.length) return false;

  const stats = await queryOne<{
    views: number; clicks: number; interested: number; going: number;
    followers: number; top_event: string | null;
  }>(
    `select
       (select count(*)::int from analytics_events a join events e on e.id = a.event_id
         where e.promoter_id = $1 and a.event_type = 'event_viewed'
           and a.created_at > now() - interval '7 days') as views,
       (select count(*)::int from analytics_events a
         where a.promoter_id = $1 and a.event_type = 'ticket_clicked'
           and a.created_at > now() - interval '7 days') as clicks,
       (select count(*)::int from analytics_events a join events e on e.id = a.event_id
         where e.promoter_id = $1 and a.event_type = 'interested'
           and a.created_at > now() - interval '7 days') as interested,
       (select count(*)::int from analytics_events a join events e on e.id = a.event_id
         where e.promoter_id = $1 and a.event_type = 'going'
           and a.created_at > now() - interval '7 days') as going,
       (select count(*)::int from member_follows f
         where f.entity_type = 'promoter' and f.entity_id = $1
           and f.created_at > now() - interval '7 days') as followers,
       (select e.title from events e
         join analytics_events a on a.event_id = e.id
        where e.promoter_id = $1 and a.created_at > now() - interval '7 days'
        group by e.id order by count(*) desc limit 1) as top_event`,
    [promoterId]
  );
  const s = stats!;
  if (s.views + s.clicks + s.going + s.interested + s.followers === 0) return false;
  const ctr = s.views > 0 ? `${((s.clicks / s.views) * 100).toFixed(1)}% CTR` : null;

  const lines = [
    `${s.views} event views`,
    `${s.clicks} ticket clicks${ctr ? ` (${ctr})` : ''}`,
    `${s.interested} Interested`,
    `${s.going} Going`,
    `+${s.followers} new followers`,
    s.top_event ? `Top event: ${s.top_event}` : null,
  ].filter(Boolean) as string[];

  let queued = false;
  for (const r of recipients) {
    const { outcome } = await queueEmail({
      recipientEmail: r.email,
      memberId: r.member_id,
      promoterId,
      emailType: 'promoter_weekly_digest',
      subject: `Your week on Guestlist — ${promoter.name}`,
      bodyText: [`Your week on Guestlist — ${promoter.name}`, '', ...lines, '',
        `Full analytics: ${SITE}/promoter/analytics`].join('\n'),
      bodyHtml: renderEmailHtml({
        heading: `Your week on Guestlist`,
        intro: promoter.name,
        events: lines.map((l) => ({ title: l, meta: '', url: `${SITE}/promoter/analytics` })),
        cta: { label: 'VIEW ANALYTICS', url: `${SITE}/promoter/analytics` },
        memberId: r.member_id,
        emailType: 'promoter_weekly_digest',
      }),
      dedupeKey: `promoter-weekly:${promoterId}:${r.member_id}:${isoWeek()}`,
    });
    queued = queued || outcome === 'queued';
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Promoter transactional bridge — the notification types V2B actually
// emits. Idempotent per notification row.
// ---------------------------------------------------------------------------

const NOTIFICATION_EMAILS: Record<string, (p: string, payload: Record<string, unknown>) => { subject: string; body: string; cta: string }> = {
  claim_approved: (p) => ({
    subject: `Your claim for ${p} was approved`,
    body: `You now manage ${p} on Guestlist. Connect your website and your events stay current automatically.`,
    cta: `${SITE}/promoter`,
  }),
  events_found: (p, payload) => {
    const n = Number(payload.new ?? payload.count ?? 0) || 'New';
    return {
      subject: `We found ${n} new event${n === 1 ? '' : 's'} for ${p} — review them`,
      body: `Your website scan found new events waiting for confirmation. A quick review puts them live.`,
      cta: `${SITE}/promoter/events`,
    };
  },
  source_failing: (p) => ({
    subject: `A source for ${p} needs attention`,
    body: `We couldn't read your connected website on recent checks. Your events may go stale until it's fixed.`,
    cta: `${SITE}/promoter/sources`,
  }),
  event_published: (p) => ({
    subject: `Your event is live on Guestlist`,
    body: `${p}: a confirmed event has been published and is now reaching members.`,
    cta: `${SITE}/promoter/events`,
  }),
};

export async function queuePromoterNotificationEmails(sinceHours = 26): Promise<number> {
  const rows = await query<{
    id: string; promoter_id: string; type: string; promoter_name: string; payload: Record<string, unknown>;
  }>(
    `select n.id, n.promoter_id, n.type, p.name as promoter_name, n.payload
       from promoter_notifications n
       join promoters p on p.id = n.promoter_id
      where n.created_at > now() - make_interval(hours => $1)
        and n.type = any($2)`,
    [sinceHours, Object.keys(NOTIFICATION_EMAILS)]
  );
  let queued = 0;
  for (const n of rows) {
    const prefs = await queryOne<{ transactional: boolean; new_events_found: boolean }>(
      `select transactional, new_events_found from promoter_email_prefs where promoter_id = $1`,
      [n.promoter_id]);
    const allowed = n.type === 'events_found'
      ? (prefs?.new_events_found ?? true)
      : (prefs?.transactional ?? true);
    if (!allowed) continue;
    const spec = NOTIFICATION_EMAILS[n.type](n.promoter_name, n.payload ?? {});
    const recipients = await query<{ email: string; member_id: string }>(
      `select m.email, m.id as member_id from promoter_members pm
         join members m on m.id = pm.member_id
        where pm.promoter_id = $1 and pm.role in ('owner', 'admin')`,
      [n.promoter_id]
    );
    for (const r of recipients) {
      const { outcome } = await queueEmail({
        recipientEmail: r.email,
        memberId: r.member_id,
        promoterId: n.promoter_id,
        emailType: `notification:${n.type}`,
        subject: spec.subject,
        bodyText: `${spec.subject}\n\n${spec.body}\n\n${spec.cta}`,
        bodyHtml: renderEmailHtml({
          heading: spec.subject,
          intro: spec.body,
          cta: { label: 'OPEN DASHBOARD', url: spec.cta },
          memberId: r.member_id,
          emailType: `notification:${n.type}`,
        }),
        dedupeKey: `pn:${n.id}:${r.member_id}`,
      });
      if (outcome === 'queued') queued++;
    }
  }
  return queued;
}

// Direct transactional email to a member (claim decisions, team invites).
export async function queueMemberTransactional(opts: {
  memberId?: string | null;
  email: string;
  emailType: string; // must start with a transactional prefix
  subject: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  dedupeKey?: string;
}): Promise<void> {
  await queueEmail({
    recipientEmail: opts.email,
    memberId: opts.memberId ?? null,
    emailType: opts.emailType,
    subject: opts.subject,
    bodyText: `${opts.subject}\n\n${opts.body}\n\n${opts.ctaUrl}`,
    bodyHtml: renderEmailHtml({
      heading: opts.subject,
      intro: opts.body,
      cta: { label: opts.ctaLabel, url: opts.ctaUrl },
      memberId: opts.memberId ?? null,
      emailType: opts.emailType,
    }),
    dedupeKey: opts.dedupeKey ?? null,
  });
}
