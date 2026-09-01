// Ask for a reset link.
//
// The response is identical whether or not the address has an account.
// Guestlist is a members' club: "no account with that email" would let anyone
// test whether a person is a member. The page carries the explanation of why
// an email might not arrive, which is the honest way to help without telling
// strangers who is on the list.

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createResetToken, RESET_TTL_MINUTES } from '@/lib/passwordReset';
import { queueMemberTransactional, processEmailQueue } from '@/lib/email';

const SITE = process.env.SITE_URL ?? 'https://www.clubguestlists.com';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter your email address' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ipHash = ip ? createHash('sha256').update(ip).digest('hex') : null;

  const request = await createResetToken(email, ipHash);
  if (request.issued) {
    const link = `${SITE}/reset?token=${encodeURIComponent(request.token)}`;
    await queueMemberTransactional({
      memberId: request.memberId,
      email: request.email,
      emailType: 'transactional_password_reset',
      subject: 'Reset your Guestlist password',
      body: `Someone asked to reset the password for this address. Use the button below within ${RESET_TTL_MINUTES} minutes to choose a new one.\n\nIf it wasn't you, ignore this email — your password stays as it is, and the link expires on its own.`,
      ctaLabel: 'Choose a new password',
      ctaUrl: link,
    });
    // A reset that waits for the next scheduled email run is a reset nobody
    // completes, so this one is pushed out now rather than queued and left.
    await processEmailQueue(5).catch(() => undefined);
  }

  // Always the same answer, and always the same shape.
  return NextResponse.json({ ok: true });
}
