// Set a new password from a reset link.
//
// Unlike the request step, this one answers honestly: the person holding the
// link needs to know whether it has expired or already been used, and saying
// so reveals nothing about anyone else.

import { NextRequest, NextResponse } from 'next/server';
import { consumeResetToken } from '@/lib/passwordReset';
import { createSession, setSessionCookie } from '@/lib/auth';

const MESSAGE: Record<string, string> = {
  invalid: 'That link is not valid. Ask for a new one.',
  expired: 'That link has expired. Ask for a new one.',
  used: 'That link has already been used. Ask for a new one.',
  weak_password: 'Use at least 8 characters.',
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token ?? '').trim();
  const password = String(body.password ?? '');
  if (!token) return NextResponse.json({ error: MESSAGE.invalid }, { status: 400 });

  const outcome = await consumeResetToken(token, password);
  if (!outcome.ok) {
    return NextResponse.json(
      { error: MESSAGE[outcome.reason] ?? 'Could not reset your password' },
      { status: outcome.reason === 'weak_password' ? 400 : 410 }
    );
  }

  // Straight in, rather than back to a login form to type the password they
  // just chose. Every other session was signed out by the reset itself.
  const sessionToken = await createSession(outcome.memberId);
  await setSessionCookie(sessionToken);
  return NextResponse.json({ ok: true });
}
