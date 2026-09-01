'use client';

// Choose a new password from an emailed link. Unlike the request step this
// page answers honestly about a dead link — the person holding it needs to
// know whether to ask for another, and saying so gives away nothing about
// anybody else.

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password !== confirm) { setError('Those two passwords do not match'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        // The reset signed every other session out, and this one is now
        // signed in — so straight to the site rather than back to a form.
        router.push('/events');
        router.refresh();
      } else {
        setError((await res.json().catch(() => ({})))?.error ?? 'Could not reset your password');
      }
    } catch {
      setError('Could not reach the server — try again');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="formCard">
        <h1>That link is incomplete</h1>
        <div className="sub">
          Open the link straight from the email, or ask for a new one.
        </div>
        <Link href="/forgot" className="btnAccent">Send me a new link</Link>
      </div>
    );
  }

  return (
    <form className="formCard" onSubmit={onSubmit}>
      <h1>Choose a new password</h1>
      <div className="sub">
        Anything signed in as you elsewhere will be signed out.
      </div>
      <label htmlFor="password">New password</label>
      <input id="password" type="password" required minLength={8} autoComplete="new-password"
             value={password} onChange={(e) => setPassword(e.target.value)} />
      <label htmlFor="confirm">New password again</label>
      <input id="confirm" type="password" required minLength={8} autoComplete="new-password"
             value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <div className="formError">{error}</div>
      <button className="btnAccent" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
        {busy ? '…' : 'Save and sign in'}
      </button>
      <div className="sub" style={{ marginTop: 18, marginBottom: 0 }}>
        Link stopped working? <Link href="/forgot" style={{ color: 'var(--accent-ink, var(--accent))' }}>Ask for another</Link>
      </div>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="wrap">
      <Suspense>
        <ResetForm />
      </Suspense>
    </main>
  );
}
