'use client';

// The one button on the membership page.
//
//   billing on  → JOIN GUESTLIST — £30/MONTH → Stripe Checkout
//   billing off → COMING SOON → JOIN THE WAITLIST (one press for a member,
//                 an email box for a visitor)
//   already a member → straight to the member area

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function JoinCta({
  mode, isSignedIn, isMember, onWaitlist, price, next = '/membership',
}: {
  mode: 'checkout' | 'waitlist';
  isSignedIn: boolean;
  isMember: boolean;
  onWaitlist: boolean;
  price: string;
  next?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(onWaitlist);
  const [error, setError] = useState('');

  if (isMember) {
    return (
      <div className="mbCtaRow">
        <Link href="/you/membership" className="mbCta">YOU’RE IN — YOUR MEMBERSHIP →</Link>
      </div>
    );
  }

  async function checkout() {
    if (!isSignedIn) { router.push(`/signup?next=${encodeURIComponent(next)}`); return; }
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/membership/checkout', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error || 'Could not start checkout');
      window.location.href = j.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start checkout');
      setBusy(false);
    }
  }

  async function waitlist(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/membership/waitlist', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isSignedIn ? {} : { email }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not join the waitlist');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the waitlist');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'checkout') {
    return (
      <div>
        <div className="mbCtaRow">
          <button className="mbCta" onClick={checkout} disabled={busy}>
            {busy ? 'One moment…' : `Join Guestlist — ${price}/month`}
          </button>
          {!isSignedIn && <Link href={`/login?next=${encodeURIComponent(next)}`} className="btnGhost">Already have an account? Sign in</Link>}
        </div>
        {error && <div className="mbErr" style={{ marginTop: 10 }}>{error}</div>}
        <div className="mbQualifier">Cancel any time. Free entrance subject to availability and fair use.</div>
      </div>
    );
  }

  if (done) {
    return (
      <div>
        <div className="mbOk">✓ You’re on the list. We’ll tell you the moment membership opens.</div>
        {!isSignedIn && <div className="mbQualifier">Not on Guestlist yet? <Link href="/signup" style={{ textDecoration: 'underline' }}>Create a free account</Link> so you’re first in.</div>}
      </div>
    );
  }
  return (
    <div>
      {isSignedIn ? (
        <div className="mbCtaRow">
          <button className="mbCta" onClick={() => waitlist()} disabled={busy}>{busy ? 'One moment…' : 'Join the waitlist'}</button>
        </div>
      ) : (
        <form className="mbWaitForm" onSubmit={waitlist}>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" aria-label="Email address" />
          <button className="mbCta" type="submit" disabled={busy}>{busy ? 'One moment…' : 'Join the waitlist'}</button>
        </form>
      )}
      {error && <div className="mbErr" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mbQualifier">{price}/month when it opens. No payment today.</div>
    </div>
  );
}
