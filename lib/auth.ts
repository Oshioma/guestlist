// Session auth for local development.
//
// Deliberately thin: this module is the only place that knows how members are
// authenticated, so it can be swapped for Supabase Auth (auth.users + a
// profiles table) without touching the rest of the app. Passwords use
// scrypt via node:crypto; sessions are opaque tokens in auth_sessions.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { query, queryOne } from './db';

export type Member = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: 'member' | 'admin';
  home_city: string | null;
  home_country: string | null;
  // The resolved place, not the typed text. Everything that puts local events
  // first reads THIS — see lib/proximity — so a member with a home_city and
  // no home_location_id is, to Guestlist, nowhere.
  home_location_id: string | null;
};

const COOKIE = 'gl_session';
const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(memberId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await query(
    'insert into auth_sessions (token, member_id, expires_at) values ($1, $2, $3)',
    [hashToken(token), memberId, expires]
  );
  return token;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    await query('delete from auth_sessions where token = $1', [hashToken(token)]);
  }
  store.delete(COOKIE);
}

export async function getCurrentMember(): Promise<Member | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return queryOne<Member>(
    `select m.id, m.email, m.display_name, m.avatar_url, m.role, m.home_city, m.home_country,
            m.home_location_id
       from auth_sessions s join members m on m.id = s.member_id
      where s.token = $1 and s.expires_at > now()`,
    [hashToken(token)]
  );
}

export async function requireMember(): Promise<Member> {
  const member = await getCurrentMember();
  if (!member) throw new AuthError(401, 'Sign in required');
  return member;
}

export async function requireAdmin(): Promise<Member> {
  const member = await getCurrentMember();
  if (!member) throw new AuthError(401, 'Sign in required');
  if (member.role !== 'admin') throw new AuthError(403, 'Admin access required');
  return member;
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
