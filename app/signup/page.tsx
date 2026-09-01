'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function SignupForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/events';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Leaving the city blank is allowed, but not silently: Guestlist cannot put
  // what is on near somebody at the top of the page without knowing where
  // "near" is, so it asks once before letting the blank through.
  const [askingCity, setAskingCity] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const form = new FormData(e.currentTarget);
    const city = String(form.get('homeCity') ?? '').trim();
    if (!city && !askingCity) {
      setAskingCity(true);
      setBusy(false);
      (e.currentTarget.elements.namedItem('homeCity') as HTMLInputElement | null)?.focus();
      return;
    }
    setBusy(true);
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.get('email'),
        password: form.get('password'),
        displayName: form.get('displayName'),
        homeCity: form.get('homeCity'),
      }),
    });
    setBusy(false);
    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Unable to sign up');
    }
  }

  return (
    <form className="formCard" onSubmit={onSubmit}>
      <h1>Join Guestlist</h1>
      <div className="sub">
        Find the nights worth going to — and the people you used to share
        dance floors with.
      </div>
      <label htmlFor="displayName">Name</label>
      <input id="displayName" name="displayName" required autoComplete="name" />
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required autoComplete="email" />
      <label htmlFor="password">Password (8+ characters)</label>
      <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      <label htmlFor="homeCity">Your city</label>
      <input id="homeCity" name="homeCity" autoComplete="address-level2"
             placeholder="London, Lagos, Dar es Salaam…" />
      <div className="fieldNote">
        {askingCity
          ? 'Which city are you in? It decides what sits at the top of your Tonight — without it we show you the whole world at once. You can still join without one.'
          : 'We put what’s on near you at the top. You can change it any time.'}
      </div>
      <div className="formError">{error}</div>
      <button className="btnAccent" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
        {busy ? '…' : askingCity ? 'Join anyway' : 'Join'}
      </button>
      <div className="sub" style={{ marginTop: 18, marginBottom: 0 }}>
        Already a member? <Link href={`/login?next=${encodeURIComponent(next)}`} style={{ color: 'var(--accent-ink, var(--accent))' }}>Sign in</Link>
      </div>
    </form>
  );
}

export default function SignupPage() {
  return (
    <main className="wrap">
      <Suspense>
        <SignupForm />
      </Suspense>
    </main>
  );
}
