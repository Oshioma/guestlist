// THE PAGE A CONFIRMATION LINK LANDS ON — WHICH, WHEN IT WORKS, IS NOT A PAGE.
//
// Confirming an email is not an errand somebody chose to run; it is the last
// two seconds of joining. A screen that says "Email confirmed" and then asks
// them to press something else is a dead end with a full stop in it — they
// have to decide, again, where they were going.
//
// So the happy path never renders. The token is spent here, on the server, and
// they arrive on the front page with a line across the top saying it worked.
// The site is already in front of them; the confirmation is a note, not a
// destination.
//
// What DOES need a page is a link that failed, because that needs the button
// which sends another one. That is the only thing left here.
//
// Doing the work on GET means a mail scanner that follows links can spend the
// token before the person does. That is survivable and always was: a spent
// token belonging to an address that IS verified reads as "already done", so
// the person clicking a minute later still lands on the same banner.

import { redirect } from 'next/navigation';
import { useVerificationToken } from '@/lib/emailVerification';
import { VerifyFailed } from '@/components/auth/VerifyFailed';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirm your email — Guestlist', robots: { index: false, follow: false } };

export default async function VerifyPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const raw = (await searchParams).token;
  const token = typeof raw === 'string' ? raw.trim() : '';

  // No token at all is its own kind of broken link — usually a mail client
  // that has chewed the query string.
  let reason: 'missing' | 'unknown' | 'expired' | 'used' | 'email_changed' = 'missing';

  if (token) {
    const result = await useVerificationToken(token);
    // redirect() throws to unwind, so it sits outside anything that catches.
    if (result.ok) redirect(result.alreadyDone ? '/?confirmed=already' : '/?confirmed=new');
    reason = result.reason;
  }

  return (
    <main className="wrap">
      <VerifyFailed reason={reason} />
    </main>
  );
}
