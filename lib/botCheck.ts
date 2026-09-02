// SIGNUP, FOR PEOPLE.
//
// Guestlist had nothing between a script and a public member page: no email
// verification, no rate limit, nothing to fill in wrong. A bot could POST the
// signup endpoint and be at /members/<random-slug> a second later, which is
// how a page of gibberish ends up on the site.
//
// None of this is a wall. A determined scraper writes past all three in an
// afternoon. They are a toll: the bots that produce random-slug profiles are
// cheap and generic, and cheap and generic is exactly what a toll stops. The
// real wall is email verification, which is a separate piece of work.
//
// What matters is that none of it inconveniences a person. A human fills in a
// form they can see, takes more than two seconds to do it, and does not sign
// up eight times an hour from one connection.

import { createHash } from 'node:crypto';
import { queryOne } from './db';

// A field the form renders but nobody can see or tab to. A browser leaves it
// empty; a script that fills every input fills it too.
export const HONEYPOT_FIELD = 'nickname';

// Nobody types a name, an email, a password and a city in under this. A form
// posted faster than a person can read it was not read.
export const MIN_FILL_MS = 2_000;

export type BotSignals = {
  honeypot?: unknown;
  // When the form was rendered, as the client saw it. Advisory: a bot can lie
  // about it, and a bot that bothers to lie has already paid the toll we were
  // charging.
  startedAt?: unknown;
};

export function looksAutomated(signals: BotSignals): string | null {
  if (typeof signals.honeypot === 'string' && signals.honeypot.trim() !== '') {
    return 'honeypot';
  }
  const started = Number(signals.startedAt);
  if (Number.isFinite(started) && started > 0) {
    const elapsed = Date.now() - started;
    // A clock ahead of ours, or a stale page left open for a day, are both
    // fine. Only "impossibly fast" is a signal.
    if (elapsed >= 0 && elapsed < MIN_FILL_MS) return 'too_fast';
  }
  return null;
}

// Addresses we cannot tell apart, so we do not count them. Everything on one
// machine looks like loopback — the dev server, the test suite, a proxy that
// forgot its headers — and counting those as one connection would rate-limit
// a whole deployment as though it were a single person.
const UNCOUNTABLE = /^(127\.|::1$|::ffff:127\.|0\.0\.0\.0$|localhost$)/i;

// One connection, hashed. We never store an address: the salt makes it useful
// for counting and useless for identifying.
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip || UNCOUNTABLE.test(ip)) return null;
  const salt = process.env.IP_HASH_SALT ?? 'guestlist';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export function requestIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim() || null;
  return headers.get('x-real-ip');
}

// How many accounts one connection may open in a day. A university, an office
// and a festival wifi all share one address, so this has to be generous to
// people; a bot farm opens thousands, so generous to people is still mean to
// scripts. Tunable, because the right number is a thing you learn.
export const SIGNUPS_PER_IP_PER_DAY =
  Number(process.env.SIGNUP_MAX_PER_IP_PER_DAY) > 0
    ? Number(process.env.SIGNUP_MAX_PER_IP_PER_DAY)
    : 20;

export async function signupsFromIp(ipHash: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from members
      where signup_ip_hash = $1 and created_at > now() - interval '24 hours'`,
    [ipHash]
  );
  return row?.n ?? 0;
}
