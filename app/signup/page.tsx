'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function SignupForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/events';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
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
      <label htmlFor="homeCity">Home city (optional)</label>
      <input id="homeCity" name="homeCity" autoComplete="address-level2" />
      <div className="formError">{error}</div>
      <button className="btnAccent" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
        {busy ? '…' : 'Join'}
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
