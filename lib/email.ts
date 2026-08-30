// Email delivery: one reusable outbox + provider abstraction.
//
// Rows are queued (respecting per-member / per-promoter preferences) and a
// cron job sends them. With RESEND_API_KEY + EMAIL_FROM configured, mail
// goes out via Resend's API; otherwise rows are marked dev_logged so the
// whole pipeline is testable without a provider. Digests use the SAME
// recommendation service as the website — no separate email logic.

import { query, queryOne } from './db';
import { track } from './analytics';
import { getEmailPrefs } from './privacy';
import { getRecommendedEvents, reasonText, weekendWindow } from './recommend';
import { fmtEventDate } from './util';

const SITE = process.env.SITE_URL ?? 'https://www.clubguestlists.com';

export async function queueEmail(opts: {
  recipientEmail: string;
  memberId?: string | null;
  promoterId?: string | null;
  emailType: string;
  subject: string;
  bodyText: string;
}): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `insert into email_outbox (recipient_email, member_id, promoter_id, email_type, subject, body_text)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [opts.recipientEmail, opts.memberId ?? null, opts.promoterId ?? null,
     opts.emailType, opts.subject.slice(0, 200), opts.bodyText]
  );
  await track('email_queued', {
    memberId: opts.memberId ?? null,
    promoterId: opts.promoterId ?? null,
    metadata: { email_type: opts.emailType },
  });
  return row?.id ?? null;
}

async function deliver(recipient: string, subject: string, body: string): Promise<'sent' | 'dev_logged'> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    console.log(`[email dev_logged] to=${recipient} subject="${subject}"`);
    return 'dev_logged';
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [recipient], subject, text: body }),
  });
  if (!res.ok) throw new Error(`email provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return 'sent';
}

export async function sendPendingEmails(limit = 50): Promise<{ sent: number; failed: number; devLogged: number }> {
  const pending = await query<{ id: string; recipient_email: string; subject: string; body_text: string }>(
    `select id, recipient_email, subject, body_text from email_outbox
      where status = 'pending' order by created_at limit $1`,
    [limit]
  );
  let sent = 0, failed = 0, devLogged = 0;
  for (const row of pending) {
    try {
      const outcome = await deliver(row.recipient_email, row.subject, row.body_text);
      await query(`update email_outbox set status = $2, sent_at = now() where id = $1`, [row.id, outcome]);
      if (outcome === 'sent') sent++; else devLogged++;
    } catch (err) {
      failed++;
      await query(`update email_outbox set status = 'failed', error = $2 where id = $1`,
        [row.id, String(err).slice(0, 500)]);
    }
  }
  return { sent, failed, devLogged };
}

// ---------------------------------------------------------------------------
// Member weekly digest — same recommendations the site shows.
// ---------------------------------------------------------------------------

export async function queueMemberWeeklyDigest(memberId: string): Promise<boolean> {
  const prefs = await getEmailPrefs(memberId);
  if (!prefs.weekly_digest) return false;
  const member = await queryOne<{ email: string; display_name: string }>(
    `select email, display_name from members where id = $1`, [memberId]);
  if (!member) return false;
  const { from, to } = weekendWindow();
  const recs = await getRecommendedEvents(memberId, { limit: 5, from, to });
  if (!recs.length) return false; // never send an empty digest

  const lines = recs.map((r) => {
    const reason = r.reasons[0] ? ` — ${reasonText(r.reasons[0])}` : '';
    return `• ${r.title}\n  ${fmtEventDate(r.start_at, r.end_at, r.timezone)}${r.city ? ` · ${r.city}` : ''}${reason}\n  ${SITE}/events/${r.slug}`;
  });
  const connectionsOut = recs.reduce(
    (acc, r) => acc + (r.reasons.some((x) => x.code === 'CONNECTION_GOING') ? 1 : 0), 0);
  const body = [
    `Your weekend on Guestlist`,
    ``,
    `${recs.length} event${recs.length === 1 ? '' : 's'} picked for you:`,
    ``,
    ...lines,
    ``,
    connectionsOut ? `${connectionsOut} of these have connections going.` : ``,
    `Manage what we send you: ${SITE}/you`,
  ].filter((l) => l !== null).join('\n');

  await queueEmail({
    recipientEmail: member.email,
    memberId,
    emailType: 'member_weekly_digest',
    subject: `Your weekend on Guestlist — ${recs.length} picks`,
    bodyText: body,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Promoter weekly digest — real numbers only, from analytics.
// ---------------------------------------------------------------------------

export async function queuePromoterWeeklyDigest(promoterId: string): Promise<boolean> {
  const prefs = await queryOne<{ weekly_digest: boolean }>(
    `select weekly_digest from promoter_email_prefs where promoter_id = $1`, [promoterId]);
  if (prefs && !prefs.weekly_digest) return false;

  const promoter = await queryOne<{ name: string; slug: string }>(
    `select name, slug from promoters where id = $1`, [promoterId]);
  if (!promoter) return false;
  // Owner/admin team members get the digest.
  const recipients = await query<{ email: string; member_id: string }>(
    `select m.email, m.id as member_id from promoter_members pm
       join members m on m.id = pm.member_id
      where pm.promoter_id = $1 and pm.role in ('owner', 'admin')`,
    [promoterId]
  );
  if (!recipients.length) return false;

  const stats = await queryOne<{
    views: number; clicks: number; going: number; followers: number; top_event: string | null;
  }>(
    `select
       (select count(*)::int from analytics_events a join events e on e.id = a.event_id
         where e.promoter_id = $1 and a.event_type = 'event_viewed'
           and a.created_at > now() - interval '7 days') as views,
       (select count(*)::int from analytics_events a
         where a.promoter_id = $1 and a.event_type = 'ticket_clicked'
           and a.created_at > now() - interval '7 days') as clicks,
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
  if (s.views + s.clicks + s.going + s.followers === 0) return false; // nothing to say

  const body = [
    `Your week on Guestlist — ${promoter.name}`,
    ``,
    `${s.views} event views`,
    `${s.clicks} ticket clicks`,
    `${s.going} Going`,
    `+${s.followers} new followers`,
    s.top_event ? `\nTop event: ${s.top_event}` : ``,
    ``,
    `Full analytics: ${SITE}/promoter/analytics`,
  ].join('\n');

  for (const r of recipients) {
    await queueEmail({
      recipientEmail: r.email,
      memberId: r.member_id,
      promoterId,
      emailType: 'promoter_weekly_digest',
      subject: `Your week on Guestlist — ${promoter.name}`,
      bodyText: body,
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bridge: recent promoter notifications (claim decisions, invites, imports,
// source errors — created by V2B flows) become transactional emails, per
// preferences. Runs from the email cron; idempotent via a seen check.
// ---------------------------------------------------------------------------

const NOTIFICATION_EMAILS: Record<string, { subject: (p: string) => string; kind: 'transactional' | 'new_events_found' }> = {
  claim_approved: { subject: (p) => `Your claim for ${p} was approved`, kind: 'transactional' },
  claim_rejected: { subject: (p) => `Your claim for ${p} needs attention`, kind: 'transactional' },
  claim_info_requested: { subject: (p) => `More information needed for ${p}`, kind: 'transactional' },
  team_invited: { subject: (p) => `You've been invited to ${p} on Guestlist`, kind: 'transactional' },
  events_imported: { subject: (p) => `New events found for ${p} — review them`, kind: 'new_events_found' },
  source_error: { subject: (p) => `A source for ${p} needs attention`, kind: 'transactional' },
};

export async function queuePromoterNotificationEmails(sinceHours = 26): Promise<number> {
  const rows = await query<{
    id: string; promoter_id: string; type: string; promoter_name: string; payload: Record<string, unknown>;
  }>(
    `select n.id, n.promoter_id, n.type, p.name as promoter_name, n.payload
       from promoter_notifications n
       join promoters p on p.id = n.promoter_id
      where n.created_at > now() - make_interval(hours => $1)
        and n.type = any($2)
        and not exists (
          select 1 from email_outbox eo
           where eo.promoter_id = n.promoter_id
             and eo.email_type = 'notification:' || n.type || ':' || n.id::text)`,
    [sinceHours, Object.keys(NOTIFICATION_EMAILS)]
  );
  let queued = 0;
  for (const n of rows) {
    const spec = NOTIFICATION_EMAILS[n.type];
    const prefs = await queryOne<{ transactional: boolean; new_events_found: boolean }>(
      `select transactional, new_events_found from promoter_email_prefs where promoter_id = $1`,
      [n.promoter_id]);
    const allowed = spec.kind === 'transactional'
      ? (prefs?.transactional ?? true)
      : (prefs?.new_events_found ?? true);
    if (!allowed) continue;
    const recipients = await query<{ email: string; member_id: string }>(
      `select m.email, m.id as member_id from promoter_members pm
         join members m on m.id = pm.member_id
        where pm.promoter_id = $1 and pm.role in ('owner', 'admin')`,
      [n.promoter_id]
    );
    for (const r of recipients) {
      await queueEmail({
        recipientEmail: r.email,
        memberId: r.member_id,
        promoterId: n.promoter_id,
        emailType: `notification:${n.type}:${n.id}`,
        subject: spec.subject(n.promoter_name),
        bodyText: `${spec.subject(n.promoter_name)}\n\nOpen your dashboard: ${SITE}/promoter`,
      });
      queued++;
    }
  }
  return queued;
}
