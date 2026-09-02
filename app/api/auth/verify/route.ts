// CONFIRMING AN ADDRESS, and asking for another link.
//
// POST with a token: prove the address. POST with nothing, signed in: send me
// another link. Both are deliberately quiet about what exists — the reply to
// a resend never says whether an address is already verified to anyone who is
// not the account holder.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { queueEmail } from '@/lib/email';
import { createVerificationToken, useVerificationToken, verificationEmail } from '@/lib/emailVerification';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';

  if (token) {
    const result = await useVerificationToken(token);
    if (result.ok) return NextResponse.json({ ok: true, alreadyDone: result.alreadyDone });
    const message = {
      unknown: 'That link is not one of ours. Ask for a new one below.',
      expired: 'That link has expired. Ask for a new one below.',
      used: 'That link has already been used. Ask for a new one below.',
      email_changed: 'Your email address changed after that link was sent. Ask for a new one below.',
    }[result.reason];
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // A resend, for the person themselves.
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });

  const issued = await createVerificationToken(member.id);
  if (!issued.issued) {
    if (issued.reason === 'already_verified') return NextResponse.json({ ok: true, alreadyDone: true });
    if (issued.reason === 'rate_limited') {
      return NextResponse.json(
        { error: 'We have sent a few of those already. Check your spam folder, or try again in an hour.' },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: 'Could not send that' }, { status: 400 });
  }

  const link = `${SITE}/verify?token=${encodeURIComponent(issued.token)}`;
  const mail = verificationEmail(issued.displayName, link);
  await queueEmail({
    recipientEmail: issued.email,
    memberId: member.id,
    emailType: 'transactional:verify_email',
    subject: mail.subject,
    bodyText: mail.bodyText,
  });
  return NextResponse.json({ ok: true, sent: true });
}
