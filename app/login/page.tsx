'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/events';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });
    setBusy(false);
    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Unable to sign in');
    }
  }

  return (
    <form className="formCard" onSubmit={onSubmit}>
      <h1>Sign in</h1>
      <div className="sub">Welcome back to the Guestlist.</div>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required autoComplete="email" />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" required autoComplete="current-password" />
      <div className="formError">{error}</div>
      <button className="btnAccent" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
        {busy ? '…' : 'Sign in'}
      </button>
      <div className="sub" style={{ marginTop: 18, marginBottom: 0 }}>
        New here? <Link href={`/signup?next=${encodeURIComponent(next)}`} style={{ color: 'var(--accent-ink, var(--accent))' }}>Join Guestlist</Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="wrap">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
