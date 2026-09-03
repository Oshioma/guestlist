// PROVING AN ADDRESS IS REAL.
//
// The same three rules the password reset follows, for the same reasons:
//
// 1. Only a hash of the token is stored. A leak of this table must not let
//    anybody verify an address they do not own.
// 2. A request is rate limited per member, so nobody can be used to hammer
//    somebody else's inbox.
// 3. The link expires. A verification email found in an old mailbox two years
//    from now is not proof of anything.
//
// And one rule of its own: BEING UNVERIFIED IS NOT BEING LOCKED OUT. Someone
// who has just joined can sign in, look around, save events and set their
// city. What they cannot do is be published — their profile is not offered to
// search engines and they are not listed in the directory — because that is
// the only thing a spam signup actually wants.

import { createHash, randomBytes } from 'node:crypto';
import { query, queryOne } from './db';
import { BRAND, button, centreRow, emailShell, esc, heroPanel, row } from './emailBrand';

export const VERIFY_TTL_HOURS = 72;
// ONE REMINDER, AND ONLY ONE.
//
// A single email at the moment of signup is one chance: land in a promotions
// tab, arrive while somebody is on a train, and they are invisible for good
// with nothing to tell them why. A nudge a day later catches that. Two nudges
// would be nagging somebody about a thing they have already decided not to do.
export const VERIFY_NUDGE_AFTER_HOURS = 24;
// Past this, a signup has gone cold and a reminder is just a stranger's email
// arriving out of nowhere.
export const VERIFY_NUDGE_WINDOW_DAYS = 7;
// Enough for somebody who mistyped their address and needs another go; few
// enough that nobody's inbox becomes a weapon.
export const MAX_VERIFICATIONS_PER_MEMBER_PER_HOUR = 5;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const hashVerificationToken = (token: string) => sha256(token);

export type VerificationRequest =
  | { issued: true; token: string; email: string; displayName: string }
  | { issued: false; reason: 'already_verified' | 'no_account' | 'rate_limited' };

export async function createVerificationToken(memberId: string): Promise<VerificationRequest> {
  const member = await queryOne<{ email: string; display_name: string; email_verified_at: string | null }>(
    `select email, display_name, email_verified_at::text from members where id = $1`,
    [memberId]
  );
  if (!member) return { issued: false, reason: 'no_account' };
  if (member.email_verified_at) return { issued: false, reason: 'already_verified' };

  const recent = await queryOne<{ n: number }>(
    `select count(*)::int as n from email_verifications
      where member_id = $1 and created_at > now() - interval '1 hour'`,
    [memberId]
  );
  if ((recent?.n ?? 0) >= MAX_VERIFICATIONS_PER_MEMBER_PER_HOUR) {
    return { issued: false, reason: 'rate_limited' };
  }

  const token = randomBytes(32).toString('base64url');
  await query(
    `insert into email_verifications (member_id, email, token_hash, expires_at)
     values ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
    [memberId, member.email, hashVerificationToken(token), String(VERIFY_TTL_HOURS)]
  );
  return { issued: true, token, email: member.email, displayName: member.display_name };
}

export type VerifyOutcome =
  | { ok: true; memberId: string; alreadyDone: boolean }
  | { ok: false; reason: 'unknown' | 'expired' | 'used' | 'email_changed' };

export async function useVerificationToken(rawToken: string): Promise<VerifyOutcome> {
  const row = await queryOne<{
    id: string; member_id: string; email: string; used_at: string | null;
    expired: boolean; current_email: string; verified_at: string | null;
  }>(
    `select v.id, v.member_id, v.email, v.used_at::text,
            (v.expires_at <= now()) as expired,
            m.email as current_email, m.email_verified_at::text as verified_at
       from email_verifications v join members m on m.id = v.member_id
      where v.token_hash = $1`,
    [hashVerificationToken(rawToken)]
  );
  if (!row) return { ok: false, reason: 'unknown' };
  // Clicking the same link twice is a person double-tapping an email, not an
  // error worth a red page.
  if (row.used_at) {
    return row.verified_at
      ? { ok: true, memberId: row.member_id, alreadyDone: true }
      : { ok: false, reason: 'used' };
  }
  if (row.expired) return { ok: false, reason: 'expired' };
  // They changed their address after the link was sent. Proving the old one
  // says nothing about the new one.
  if (row.current_email.toLowerCase() !== row.email.toLowerCase()) {
    return { ok: false, reason: 'email_changed' };
  }

  await query(`update email_verifications set used_at = now() where id = $1`, [row.id]);
  await query(`update members set email_verified_at = now() where id = $1`, [row.member_id]);
  return { ok: true, memberId: row.member_id, alreadyDone: false };
}

// ONE EMAIL, NOT TWO.
//
// Somebody who has just joined does not need a welcome and then, separately, a
// chore. They need one message that says hello, says what this place is, and
// carries the single button that finishes the job. So this is both — and it
// is the only email a new member gets.
export function verificationEmail(displayName: string, link: string) {
  const site = process.env.SITE_URL ?? 'https://www.guestlist.net';
  const first = displayName.trim().split(/\s+/)[0] || displayName;

  const steps: [string, string, string][] = [
    ['Set your city', 'Everything on Guestlist leads with where you are.', `${site}/you#places`],
    ['Say what you listen to', 'It is how the right nights find you instead of every night.', `${site}/you#taste`],
    ['See what is on tonight', 'Who is out, where they are, and what is still open.', `${site}/clubmessenger`],
  ];

  const bodyText = [
    `${first} — welcome to Guestlist.`,
    '',
    'Confirm this address and your profile goes live:',
    link,
    '',
    `The link works for ${VERIFY_TTL_HOURS} hours.`,
    '',
    'You can already sign in and look around without it — confirming is what',
    'puts your profile on the map and lets other members find you.',
    '',
    'Once you are in:',
    ...steps.map(([title, why]) => `  · ${title} — ${why}`),
    '',
    'If you did not sign up, ignore this and nothing happens.',
  ].join('\n');

  const bodyHtml = emailShell({
    preheader: `Confirm this address and your profile goes live — the link works for ${VERIFY_TTL_HOURS} hours.`,
    rows: [
      row(heroPanel(
        `Welcome, ${first}`,
        `ONE THING<br/>AND YOU'RE <span style="color:${BRAND.onNightAccent};">IN</span>`,
        `Confirm this address and your profile goes live. It takes one press and the link works for ${VERIFY_TTL_HOURS} hours.`
      ), '20px 26px 0'),

      centreRow(button(link, 'Confirm your email')),
      centreRow(`<div style="font-size:11.5px;color:${BRAND.soft};line-height:1.65;max-width:400px;">
        You can already sign in and look around without it — confirming is what puts
        your profile on the map and lets other members find you.
      </div>`, '2px 26px 0'),

      row(`<div style="font-size:10.5px;font-weight:800;letter-spacing:2.2px;color:${BRAND.gold};text-transform:uppercase;">Then, three minutes well spent</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
          ${steps.map(([title, why, href]) => `
          <tr><td style="padding:0 0 10px 0;">
            <a href="${href}" style="text-decoration:none;color:${BRAND.ink};">
              <div style="border:1px solid ${BRAND.line};border-radius:14px;padding:14px 16px;background:${BRAND.surface};">
                <div style="font-size:15px;font-weight:750;letter-spacing:-0.2px;color:${BRAND.ink};">${esc(title)}</div>
                <div style="font-size:12.5px;color:${BRAND.soft};margin-top:3px;line-height:1.5;">${esc(why)}</div>
              </div>
            </a>
          </td></tr>`).join('')}
        </table>`, '26px 26px 0'),
    ].join(''),
    footerHtml: 'If you did not sign up, ignore this and nothing happens.',
  });

  return { subject: `${first}, one press and you're in — Guestlist`, bodyText, bodyHtml };
}

// The reminder. Deliberately shorter than the welcome and in a different
// voice: this one exists to say what they are missing, not to say hello again.
export function verificationNudgeEmail(displayName: string, link: string) {
  const first = displayName.trim().split(/\s+/)[0] || displayName;

  const bodyText = [
    `${first} — your Guestlist profile is still hidden.`,
    '',
    'You joined, but the address was never confirmed, so other members cannot',
    'find you and you are not in the directory. One press fixes it:',
    link,
    '',
    `The link works for ${VERIFY_TTL_HOURS} hours.`,
    '',
    'This is the only reminder we will send.',
  ].join('\n');

  const bodyHtml = emailShell({
    preheader: 'Your profile is still hidden — one press fixes it.',
    rows: [
      row(`<div style="font-size:27px;line-height:1.12;font-weight:800;letter-spacing:-0.9px;color:${BRAND.ink};">
          ${esc(first)}, you're still hidden
        </div>
        <div style="font-size:14.5px;color:${BRAND.soft};margin-top:14px;line-height:1.65;">
          You joined Guestlist, but this address was never confirmed — so other
          members can't find you and you're not in the directory. One press fixes it.
        </div>`, '24px 26px 0'),
      centreRow(button(link, 'Confirm your email')),
    ].join(''),
    footerHtml: `The link works for ${VERIFY_TTL_HOURS} hours. This is the only reminder we'll send.<br/>`
      + 'If you did not sign up, ignore this and nothing happens.',
  });

  return { subject: `${first}, your Guestlist profile is still hidden`, bodyText, bodyHtml };
}

/**
 * Everybody who joined, never confirmed, and has not been reminded. Run from
 * the hourly email job. The dedupe key is what makes "only one" true: a
 * second call can never queue a second reminder for the same person.
 */
export async function queueVerificationNudges(): Promise<number> {
  const { queueEmail } = await import('./email');
  const site = process.env.SITE_URL ?? 'https://www.guestlist.net';
  const due = await query<{ id: string }>(
    `select m.id from members m
      where m.email_verified_at is null
        and m.created_at < now() - make_interval(hours => $1)
        and m.created_at > now() - make_interval(days => $2)
        and not exists (
          select 1 from email_outbox o
           where o.member_id = m.id and o.email_type = 'transactional:verify_reminder')
      order by m.created_at`,
    [VERIFY_NUDGE_AFTER_HOURS, VERIFY_NUDGE_WINDOW_DAYS]
  );
  let sent = 0;
  for (const m of due) {
    const issued = await createVerificationToken(m.id);
    if (!issued.issued) continue;
    const mail = verificationNudgeEmail(
      issued.displayName, `${site}/verify?token=${encodeURIComponent(issued.token)}`);
    const { outcome } = await queueEmail({
      recipientEmail: issued.email,
      memberId: m.id,
      emailType: 'transactional:verify_reminder',
      subject: mail.subject,
      bodyText: mail.bodyText,
      bodyHtml: mail.bodyHtml,
      dedupeKey: `verify_nudge:${m.id}`,
    });
    if (outcome === 'queued') sent++;
  }
  return sent;
}

export type UnverifiedMember = {
  id: string; display_name: string; email: string; slug: string | null;
  created_at: string; hours_waiting: number; reminded_at: string | null;
};

/** Who the verification gate is currently holding, and for how long. */
export async function unverifiedMembers(): Promise<UnverifiedMember[]> {
  return query<UnverifiedMember>(
    `select m.id, m.display_name, m.email, m.slug, m.created_at::text,
            floor(extract(epoch from (now() - m.created_at)) / 3600)::int as hours_waiting,
            (select max(o.created_at)::text from email_outbox o
              where o.member_id = m.id and o.email_type = 'transactional:verify_reminder') as reminded_at
       from members m
      where m.email_verified_at is null
      order by m.created_at desc
      limit 200`
  );
}

/** An admin vouching for somebody they know is real. */
export async function markVerifiedByAdmin(memberId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `update members set email_verified_at = coalesce(email_verified_at, now())
      where id = $1 returning id`,
    [memberId]
  );
  return !!row;
}
