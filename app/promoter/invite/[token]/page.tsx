'use client';

// Team invite acceptance page.

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ promoterName: string; role: string } | null>(null);

  async function accept() {
    setState('busy');
    setError('');
    const res = await fetch('/api/promoter/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setResult(data);
      setState('done');
      router.refresh();
    } else if (res.status === 401) {
      router.push(`/login?next=${encodeURIComponent(`/promoter/invite/${token}`)}`);
    } else {
      setState('idle');
      setError(data.error ?? 'Could not accept invite');
    }
  }

  return (
    <main className="wrap">
      <div className="formCard" style={{ textAlign: 'center' }}>
        {state === 'done' && result ? (
          <>
            <h1>You’re in</h1>
            <div className="sub" style={{ margin: '12px 0 20px' }}>
              You’ve joined <b>{result.promoterName}</b> as <b>{result.role}</b>.
            </div>
            <Link className="btnAccent" href="/promoter">Open dashboard →</Link>
          </>
        ) : (
          <>
            <h1>Team invite</h1>
            <div className="sub" style={{ margin: '12px 0 20px' }}>
              You’ve been invited to help run a promoter on Guestlist. Sign in
              first if you haven’t already.
            </div>
            <button className="btnAccent" onClick={accept} disabled={state === 'busy'} type="button">
              {state === 'busy' ? '…' : 'Accept invite'}
            </button>
            <div className="formError">{error}</div>
          </>
        )}
      </div>
    </main>
  );
}
