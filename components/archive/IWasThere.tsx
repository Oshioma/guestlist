'use client';

// I WAS THERE — one tap. Options fold away: "I think I was there" and
// visibility (public / connections / private).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function IWasThere({
  archiveEventId, initialState, initialCount, isSignedIn,
}: {
  archiveEventId: string;
  initialState: { set: boolean; certainty: string; visibility: string } | null;
  initialCount: number;
  isSignedIn: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>) {
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    const res = await fetch('/api/archive/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveEventId, ...body }),
    });
    if (res.ok) {
      const data = await res.json();
      setCount(data.count);
      if (body.action === 'remove') setState(null);
      else setState({
        set: true,
        certainty: (body.certainty as string) ?? 'sure',
        visibility: (body.visibility as string) ?? 'public',
      });
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="iwtWrap">
      <div className="iwtRow">
        {state?.set ? (
          <button className="btnAccent iwtBtn isSet" type="button" disabled={busy}
                  onClick={() => send({ action: 'remove' })}>
            ✓ {state.certainty === 'unsure' ? 'I think I was there' : 'I was there'}
          </button>
        ) : (
          <button className="btnAccent iwtBtn" type="button" disabled={busy}
                  onClick={() => send({ action: 'set' })}>
            I WAS THERE
          </button>
        )}
        <button className="recHide" type="button" onClick={() => setOpen((o) => !o)}>
          {open ? 'close' : 'options'}
        </button>
      </div>
      <div className="iwtCount">
        {count > 0
          ? `${count} Guestlist member${count === 1 ? '' : 's'} ${count === 1 ? 'was' : 'were'} there`
          : 'Were you there? Say so — this is how the scene finds itself again.'}
      </div>
      {open && (
        <div className="iwtOptions">
          <div className="chipRow">
            <button type="button" className={`chip${state?.certainty === 'unsure' ? ' active' : ''}`}
                    disabled={busy}
                    onClick={() => send({ action: 'set', certainty: 'unsure', visibility: state?.visibility ?? 'public' })}>
              I think I was there
            </button>
            {(['public', 'connections', 'private'] as const).map((v) => (
              <button key={v} type="button"
                      className={`chip${(state?.visibility ?? 'public') === v && state?.set ? ' active' : ''}`}
                      disabled={busy}
                      onClick={() => send({ action: 'set', certainty: state?.certainty ?? 'sure', visibility: v })}>
                {v === 'public' ? 'Visible to everyone' : v === 'connections' ? 'Connections only' : 'Only me'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
