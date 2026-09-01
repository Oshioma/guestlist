// FORGOTTEN PASSWORD.
//
// Three rules shape this file:
//
// 1. The reply never says whether an address has an account. Guestlist is a
//    members' club, so "no account with that email" would tell anyone who
//    asks who is and is not a member. Every request gets the same answer, and
//    the page explains the innocent reasons an email might not arrive.
// 2. Only a hash of the token is stored. If this table ever leaked, it must
//    not hand anyone a working reset link.
// 3. Using a token signs every other session out. A password reset is what
//    someone does when they fear their account is compromised; leaving the
//    intruder's session alive would defeat the point.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { query, queryOne } from './db';
import { hashPassword } from './auth';

export const RESET_TTL_MINUTES = 60;
// Enough to stop someone hammering an inbox, loose enough that a person who
// mistypes their address twice is not locked out of trying again.
export const MAX_RESETS_PER_EMAIL_PER_HOUR = 5;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function hashResetToken(token: string): string {
  return sha256(token);
}

export type ResetRequest =
  | { issued: true; token: string; memberId: string; displayName: string; email: string }
  | { issued: false; reason: 'no_account' | 'rate_limited' };

export async function createResetToken(rawEmail: string, ipHash?: string | null): Promise<ResetRequest> {
  const email = rawEmail.trim().toLowerCase();
  const member = await queryOne<{ id: string; email: string; display_name: string }>(
    `select id, email, display_name from members where lower(email) = $1`,
    [email]
  );
  if (!member) return { issued: false, reason: 'no_account' };

  const recent = await queryOne<{ n: number }>(
    `select count(*)::int as n from password_resets
      where member_id = $1 and created_at > now() - interval '1 hour'`,
    [member.id]
  );
  if ((recent?.n ?? 0) >= MAX_RESETS_PER_EMAIL_PER_HOUR) {
    return { issued: false, reason: 'rate_limited' };
  }

  // Any earlier link stops working the moment a new one is asked for, so a
  // forwarded or shoulder-surfed old email is worthless.
  await query(
    `update password_resets set used_at = now()
      where member_id = $1 and used_at is null and expires_at > now()`,
    [member.id]
  );

  const token = randomBytes(32).toString('base64url');
  await query(
    `insert into password_resets (member_id, token_hash, expires_at, requested_ip_hash)
     values ($1, $2, now() + ($3 || ' minutes')::interval, $4)`,
    [member.id, hashResetToken(token), String(RESET_TTL_MINUTES), ipHash ?? null]
  );
  return { issued: true, token, memberId: member.id, displayName: member.display_name, email: member.email };
}

export type ResetOutcome =
  | { ok: true; memberId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'weak_password' };

export async function consumeResetToken(token: string, newPassword: string): Promise<ResetOutcome> {
  if (newPassword.length < 8) return { ok: false, reason: 'weak_password' };

  const row = await queryOne<{ id: string; member_id: string; token_hash: string; used_at: string | null; expired: boolean }>(
    `select id, member_id, token_hash, used_at::text, (expires_at <= now()) as expired
       from password_resets where token_hash = $1`,
    [hashResetToken(token)]
  );
  if (!row) return { ok: false, reason: 'invalid' };
  // The lookup is by hash, so this only guards against a timing signal on
  // the comparison itself.
  const provided = Buffer.from(hashResetToken(token));
  const stored = Buffer.from(row.token_hash);
  if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) {
    return { ok: false, reason: 'invalid' };
  }
  if (row.used_at) return { ok: false, reason: 'used' };
  if (row.expired) return { ok: false, reason: 'expired' };

  await query(`update members set password_hash = $2 where id = $1`, [row.member_id, hashPassword(newPassword)]);
  await query(`update password_resets set used_at = now() where id = $1`, [row.id]);
  // Everything else signed in as this member is now signed out.
  await query(`delete from auth_sessions where member_id = $1`, [row.member_id]);
  return { ok: true, memberId: row.member_id };
}
