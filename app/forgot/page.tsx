'use client';

// FORGOTTEN PASSWORD.
//
// The confirmation is deliberately the same whether or not the address has an
// account — Guestlist is a members' club, and a "no such account" message
// would let anyone check who is a member. That silence is only fair if the
// page then explains the innocent reasons an email might not arrive, and the
// commonest one by far is that the person's account was on the OLD Guestlist
// and never came across.

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) setSent(true);
      else setError((await res.json().catch(() => ({})))?.error ?? 'Something went wrong');
    } catch {
      setError('Could not reach the server — try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <div className="formCard">
        {sent ? (
          <>
            <h1>Check your email</h1>
            <div className="sub">
              If <strong>{email}</strong> has a Guestlist account, a link to choose a new
              password is on its way. It works for one hour.
            </div>
            <div className="authNote">
              <strong>Nothing arrived?</strong>
              <p>
                Look in spam first. If it is not there, the likeliest reason is that this
                address does not have an account on the new Guestlist yet.
              </p>
              <p>
                <strong>If you were a member of the old Guestlist</strong>, that account did
                not carry over to this site. Nothing has been lost — you just need to create
                a new one, with the same email if you like.
              </p>
              <Link href="/signup" className="btnAccent" style={{ marginTop: 4 }}>
                Create an account →
              </Link>
            </div>
            <div className="sub" style={{ marginTop: 18, marginBottom: 0 }}>
              <button type="button" className="linkBtn" onClick={() => setSent(false)}>
                Try a different email
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <h1>Forgotten your password?</h1>
            <div className="sub">
              Enter the email you joined with and we will send you a link to choose a new one.
            </div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="formError">{error}</div>
            <button className="btnAccent" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
              {busy ? '…' : 'Send me a link'}
            </button>

            <div className="authNote">
              <strong>Were you on the old Guestlist?</strong>
              <p>
                Accounts from the old site did not move across to this one. If you have not
                joined here yet, a reset link cannot reach you — create an account instead,
                using the same email address if you want.
              </p>
              <Link href="/signup" className="btnGhost">Create an account</Link>
            </div>

            <div className="sub" style={{ marginTop: 18, marginBottom: 0 }}>
              Remembered it? <Link href="/login" style={{ color: 'var(--accent-ink, var(--accent))' }}>Sign in</Link>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
