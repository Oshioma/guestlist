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

export function verificationEmail(displayName: string, link: string) {
  return {
    subject: 'Confirm your email — Guestlist',
    bodyText: [
      `${displayName},`,
      '',
      'Confirm this address and your Guestlist profile goes live:',
      link,
      '',
      `The link works for ${VERIFY_TTL_HOURS} hours.`,
      '',
      'You can already sign in and look around without it — confirming is what',
      'puts your profile on the map and lets other members find you.',
      '',
      'If you did not sign up, ignore this and nothing happens.',
    ].join('\n'),
  };
}
