'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

type State =
  | { kind: 'working' }
  | { kind: 'done'; alreadyDone: boolean }
  | { kind: 'failed'; message: string };

export function VerifyPanel() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>({ kind: 'working' });
  const [resent, setResent] = useState('');

  useEffect(() => {
    if (!token) {
      setState({ kind: 'failed', message: 'That link is missing its code.' });
      return;
    }
    let live = true;
    fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) setState({ kind: 'done', alreadyDone: !!data.alreadyDone });
        else setState({ kind: 'failed', message: data.error ?? 'Could not confirm that link.' });
      })
      .catch(() => live && setState({ kind: 'failed', message: 'Could not reach Guestlist. Try again.' }));
    return () => { live = false; };
  }, [token]);

  async function resend() {
    const res = await fetch('/api/auth/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    setResent(res.ok
      ? 'Sent. It should arrive in a minute — check your spam folder if not.'
      : (data.error ?? 'Could not send another link.'));
  }

  if (state.kind === 'working') {
    return <div className="formCard"><h1>Confirming…</h1></div>;
  }

  if (state.kind === 'done') {
    return (
      <div className="formCard">
        <h1>{state.alreadyDone ? 'Already confirmed' : 'Email confirmed'}</h1>
        <div className="sub">
          Your profile is live and other members can find you.
        </div>
        <Link href="/events" className="btnAccent" style={{ textAlign: 'center' }}>Find something on →</Link>
      </div>
    );
  }

  return (
    <div className="formCard">
      <h1>That link did not work</h1>
      <div className="sub">{state.message}</div>
      <button type="button" className="btnAccent" onClick={resend}>Send me a new link</button>
      {resent && <div className="sub" style={{ marginTop: 8 }}>{resent}</div>}
      <div className="sub" style={{ marginTop: 8 }}>
        You can carry on using Guestlist either way — <Link href="/events" style={{ textDecoration: 'underline' }}>have a look around</Link>.
      </div>
    </div>
  );
}
