import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { createSession, hashPassword, setSessionCookie } from '@/lib/auth';
import { memberSlug } from '@/lib/members';
import { notifyAdminsNewMember } from '@/lib/adminNotify';
import { findOrCreateCity } from '@/lib/locations';
import { canonicalCity } from '@/lib/cityNames';
import { queueEmail } from '@/lib/email';
import { createVerificationToken, verificationEmail } from '@/lib/emailVerification';
import { HONEYPOT_FIELD, hashIp, looksAutomated, requestIp, signupsFromIp, SIGNUPS_PER_IP_PER_DAY } from '@/lib/botCheck';

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const email = String(data.email ?? '').trim().toLowerCase();
  const password = String(data.password ?? '');
  const displayName = String(data.displayName ?? '').trim();
  const homeCity = canonicalCity(String(data.homeCity ?? ''));

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: 'A display name is required' }, { status: 400 });
  }

  // A form filled in by something that cannot see it, or faster than anybody
  // can read it. Answered with the same sentence a person would get from a
  // genuine mistake — telling a script which check it failed is telling it
  // what to change.
  if (looksAutomated({ honeypot: data[HONEYPOT_FIELD], startedAt: data.startedAt })) {
    return NextResponse.json({ error: 'Unable to sign up. Please try again.' }, { status: 400 });
  }

  const ipHash = hashIp(requestIp(req.headers));
  if (ipHash && (await signupsFromIp(ipHash)) >= SIGNUPS_PER_IP_PER_DAY) {
    return NextResponse.json(
      { error: 'Too many accounts have been created from this connection today. Try again tomorrow, or email info@guestlist.net.' },
      { status: 429 }
    );
  }

  const existing = await queryOne('select 1 from members where lower(email) = $1', [email]);
  if (existing) {
    return NextResponse.json({ error: 'That email is already registered' }, { status: 409 });
  }

  // The profile slug is generated here — without it every link to this
  // member's profile would point at /members/null.
  const member = await queryOne<{ id: string }>(
    `insert into members (email, password_hash, display_name, home_city, signup_ip_hash)
     values ($1, $2, $3, $4, $5) returning id`,
    [email, hashPassword(password), displayName, homeCity, ipHash]
  );
  await query(`update members set slug = $2 where id = $1`,
    [member!.id, memberSlug(displayName, member!.id)]);

  // A typed city has to become a real place, or it is decoration. Everything
  // that puts local events first — Tonight, the events ranking, city alerts —
  // reads home_location_id, not this free-text field, so resolving it here is
  // the difference between "we know where you are" and not.
  if (homeCity) {
    try {
      const location = await findOrCreateCity({ name: homeCity });
      await query(`update members set home_location_id = $2 where id = $1`, [member!.id, location.id]);
    } catch (err) {
      // A place we cannot resolve is not a reason to fail somebody's signup.
      console.error('could not resolve signup city', err);
    }
  }

  // Ask them to prove the address. Never blocking, for the same reason the
  // admin notification is not: an email service having a bad afternoon must
  // not stop somebody joining. They can ask for another link any time.
  try {
    const issued = await createVerificationToken(member!.id);
    if (issued.issued) {
      const site = process.env.SITE_URL ?? 'https://www.guestlist.net';
      const mail = verificationEmail(issued.displayName, `${site}/verify?token=${encodeURIComponent(issued.token)}`);
      await queueEmail({
        recipientEmail: issued.email,
        memberId: member!.id,
        emailType: 'transactional:verify_email',
        subject: mail.subject,
        bodyText: mail.bodyText,
      });
    }
  } catch (err) {
    console.error('could not send verification email', err);
  }

  // The admins hear about it. Never blocking: a notification that cannot be
  // written must not stop somebody joining.
  await notifyAdminsNewMember(member!.id);

  const token = await createSession(member!.id);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
