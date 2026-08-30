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
  initialClose = false,
}: {
  memberId: string;
  initialState: State;
  connectionId?: string | null;
  isSignedIn: boolean;
  compact?: boolean;
  initialClose?: boolean; // MY private close-friend mark on them
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(initialState);
  const [isClose, setIsClose] = useState(initialClose);
  const [menuOpen, setMenuOpen] = useState(false);
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
          Pending
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
        // The relationship menu. Close-friend status is PRIVATE — only this
        // member ever sees the star; the other person is never notified.
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <button className="btnGhost isActive" style={style} type="button" disabled={busy}
                  onClick={() => setMenuOpen((o) => !o)}>
            {isClose ? '★ Close friend ▾' : '✦ Connected ▾'}
          </button>
          {menuOpen && (
            <span style={{
              position: 'absolute', top: '110%', right: 0, zIndex: 30, minWidth: 220,
              background: 'var(--bg-raised, #111)', border: '1px solid var(--border-strong, #333)',
              borderRadius: 10, padding: 6, display: 'grid', gap: 2, boxShadow: '0 8px 30px rgba(0,0,0,.5)',
            }}>
              <button className="btnGhost" type="button" disabled={busy}
                      style={{ justifyContent: 'flex-start', fontSize: 12 }}
                      onClick={async () => {
                        setMenuOpen(false);
                        const next = !isClose;
                        setIsClose(next);
                        await act({ action: 'close_friend', memberId, close: next }, 'connected');
                      }}>
                {isClose ? 'Remove from close friends' : '★ Mark as close friend'}
              </button>
              <button className="btnGhost" type="button" disabled={busy}
                      style={{ justifyContent: 'flex-start', fontSize: 12 }}
                      onClick={() => { setMenuOpen(false); setIsClose(false); act({ action: 'remove', memberId }, 'none'); }}>
                Remove connection
              </button>
              <button className="btnGhost" type="button" disabled={busy}
                      style={{ justifyContent: 'flex-start', fontSize: 12, color: '#e46a6a' }}
                      onClick={() => { setMenuOpen(false); setIsClose(false); act({ action: 'block', memberId }, 'blocked'); }}>
                Block
              </button>
            </span>
          )}
        </span>
      ) : null}
      {error && <span className="formError" style={{ marginLeft: 8 }}>{error}</span>}
    </span>
  );
}
