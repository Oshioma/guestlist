'use client';

// CONNECT — person-to-person. Handles the whole lifecycle from either side.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type State = 'none' | 'pending_out' | 'pending_in' | 'connected' | 'declined' | 'blocked' | 'self';

export function ConnectButton({
  memberId,
  initialState,
  connectionId,
  isSignedIn,
  compact = false,
}: {
  memberId: string;
  initialState: State;
  connectionId?: string | null;
  isSignedIn: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(body: Record<string, unknown>, next: State) {
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setState(next);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Something went wrong');
    }
    setBusy(false);
  }

  if (state === 'self' || state === 'blocked') return null;
  const style = compact ? { padding: '6px 12px', fontSize: 11 } : undefined;

  return (
    <span className="connectWrap">
      {state === 'none' || state === 'declined' ? (
        <button className="btnAccent" style={style} type="button" disabled={busy}
                onClick={() => act({ action: 'request', memberId }, 'pending_out')}>
          Connect
        </button>
      ) : state === 'pending_out' ? (
        <button className="btnGhost isActive" style={style} type="button" disabled>
          Requested
        </button>
      ) : state === 'pending_in' && connectionId ? (
        <>
          <button className="btnAccent" style={style} type="button" disabled={busy}
                  onClick={() => act({ action: 'accept', connectionId }, 'connected')}>
            Accept
          </button>
          <button className="btnGhost" style={style} type="button" disabled={busy}
                  onClick={() => act({ action: 'decline', connectionId }, 'declined')}>
            Decline
          </button>
        </>
      ) : state === 'connected' ? (
        <button className="btnGhost isActive" style={style} type="button" disabled>
          ✦ Connected
        </button>
      ) : null}
      {error && <span className="formError" style={{ marginLeft: 8 }}>{error}</span>}
    </span>
  );
}
