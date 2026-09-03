'use client';

// A LINK THAT DID NOT WORK, AND THE WAY OUT OF IT.
//
// The only reason this is a page: somebody stuck here needs a new link, and
// asking for one is a button. Every reason says the same two things — what
// happened, and that they are not locked out of anything in the meantime.

import { useState } from 'react';
import Link from 'next/link';

// A bare /verify is not a broken link — it is somebody who came looking for
// the button rather than pressing one, so it does not get told off.
const HEADING: Record<string, string> = { missing: 'Confirm your email' };

const WHY: Record<string, string> = {
  missing: 'Ask for a link and we will send one to the address on your account. '
    + 'If you got here from an email, some mail apps cut the link short — a new one will work.',
  unknown: 'That link is not one of ours.',
  expired: 'That link has expired.',
  used: 'That link has already been used.',
  email_changed: 'Your email address changed after that link was sent, so it no longer proves anything.',
};

export function VerifyFailed({ reason }: { reason: string }) {
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    const res = await fetch('/api/auth/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setSent(res.ok
      ? 'Sent. It should arrive in a minute — check your spam folder if not.'
      : (data.error ?? 'Could not send another link.'));
  }

  return (
    <div className="formCard">
      <h1>{HEADING[reason] ?? 'That link did not work'}</h1>
      <div className="sub">
        {WHY[reason] ?? WHY.unknown}
        {reason !== 'missing' && ' Ask for a new one below.'}
      </div>
      <button type="button" className="btnAccent" onClick={resend} disabled={busy}>
        {busy ? 'Sending…' : reason === 'missing' ? 'Send me a link' : 'Send me a new link'}
      </button>
      {sent && <div className="sub" style={{ marginTop: 8 }}>{sent}</div>}
      <div className="sub" style={{ marginTop: 8 }}>
        You can carry on using Guestlist either way — <Link href="/events" style={{ textDecoration: 'underline' }}>have a look around</Link>.
      </div>
    </div>
  );
}
