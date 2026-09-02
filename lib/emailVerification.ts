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

export const VERIFY_TTL_HOURS = 72;
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
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  const bodyHtml = `<!doctype html><html><body style="margin:0;padding:0;background:#f3eee1;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3eee1;">
    <tr><td align="center" style="padding:0 14px 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">

        <tr><td style="background:#0d0d0c;border-radius:0 0 14px 14px;padding:20px 26px;">
          <span style="font-size:15px;font-weight:800;letter-spacing:4px;color:#f5f1e6;">GUEST<span style="color:#c9a2e8;">LIST</span></span>
        </td></tr>

        <tr><td style="padding:30px 0 0;">
          <div style="background:#0d0d0c;border-radius:16px;padding:32px 28px;">
            <div style="font-size:11px;font-weight:800;letter-spacing:3px;color:#c9a2e8;text-transform:uppercase;">Welcome, ${esc(first)}</div>
            <div style="font-size:36px;line-height:1.05;font-weight:800;letter-spacing:-1.2px;color:#f5f1e6;margin-top:12px;">
              ONE THING<br/>AND YOU'RE <span style="color:#c9a2e8;">IN</span>
            </div>
            <div style="font-size:14px;color:#a9a294;margin-top:16px;line-height:1.6;">
              Confirm this address and your profile goes live. It takes one press
              and the link works for ${VERIFY_TTL_HOURS} hours.
            </div>
          </div>
        </td></tr>

        <tr><td align="center" style="padding:26px 6px 6px;">
          <a href="${link}" style="display:inline-block;background:#7c4a9e;color:#ffffff;font-weight:800;font-size:14px;letter-spacing:0.6px;text-decoration:none;border-radius:12px;padding:16px 38px;">CONFIRM YOUR EMAIL</a>
        </td></tr>
        <tr><td align="center" style="padding:0 6px 8px;">
          <div style="font-size:11.5px;color:#8a8574;line-height:1.6;">
            You can already sign in and look around without it — confirming is what puts
            your profile on the map and lets other members find you.
          </div>
        </td></tr>

        <tr><td style="padding:24px 6px 0;">
          <div style="font-size:10.5px;font-weight:800;letter-spacing:2.4px;color:#9a7b1f;text-transform:uppercase;">Then, three minutes well spent</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
            ${steps.map(([title, why, href]) => `
            <tr><td style="padding:0 0 10px 0;">
              <a href="${href}" style="text-decoration:none;color:#141414;">
                <div style="border:1px solid #e4dcc8;border-radius:12px;padding:14px 16px;background:#ffffff;">
                  <div style="font-size:15px;font-weight:700;letter-spacing:-0.2px;color:#141414;">${esc(title)}</div>
                  <div style="font-size:12.5px;color:#6f6a5c;margin-top:3px;line-height:1.5;">${esc(why)}</div>
                </div>
              </a>
            </td></tr>`).join('')}
          </table>
        </td></tr>

        <tr><td style="padding:16px 6px 0;border-top:1px solid #e4dcc8;">
          <div style="font-size:11px;color:#8a8574;line-height:1.7;padding-top:14px;">
            If you did not sign up, ignore this and nothing happens.<br/>
            Guestlist — the best events for our community, not every event.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject: `${first}, one press and you're in — Guestlist`, bodyText, bodyHtml };
}
