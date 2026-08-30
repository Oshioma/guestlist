'use client';

// The "I'M HERE" button + presence controls for one event.
// Manual check-in only — arriving is a deliberate tap, never automatic.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Presence = {
  visibility: 'friends' | 'event' | 'invisible';
  status: string | null;
} | null;

const VISIBILITY_LABELS: Record<string, string> = {
  friends: 'Friends can see me',
  event: 'Everyone at this event',
  invisible: 'Invisible (only you)',
};

export function PresenceControls({
  eventId,
  presence,
  isSignedIn,
  canCheckIn,
  sticky = false,
}: {
  eventId: string;
  presence: Presence;
  isSignedIn: boolean;
  canCheckIn: boolean;
  sticky?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState(presence?.status ?? '');
  const [error, setError] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/clubmessenger/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? 'Something went wrong');
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function requireAuth() {
    if (isSignedIn) return true;
    router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    return false;
  }

  if (!presence) {
    if (!canCheckIn) return null;
    return (
      <div className={sticky ? 'presenceSticky' : undefined}>
        <button
          className="btnHere"
          type="button"
          disabled={busy}
          onClick={() => requireAuth() && send({ action: 'arrive' })}
        >
          🔥 I’M HERE
        </button>
        {error && <div className="formError" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className={`presencePanel${sticky ? ' presenceSticky' : ''}`}>
      <div className="presenceRow">
        <span className="hereBadge">● You’re here</span>
        <button className="btnGhost" type="button" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Options'}
        </button>
        <button
          className="btnGhost"
          type="button"
          disabled={busy}
          onClick={() => send({ action: 'leave' })}
        >
          Leave
        </button>
      </div>
      {presence.status && <div className="presenceStatus">“{presence.status}”</div>}
      {open && (
        <div className="presenceOptions">
          <div className="sectionLabel">Who can see you</div>
          <div className="presenceVisRow">
            {(['friends', 'event', 'invisible'] as const).map((v) => (
              <button
                key={v}
                type="button"
                disabled={busy}
                className={`btnGhost${presence.visibility === v ? ' isActive' : ''}`}
                onClick={() => send({ action: 'visibility', visibility: v })}
              >
                {VISIBILITY_LABELS[v]}
              </button>
            ))}
          </div>
          <div className="sectionLabel">Night status</div>
          <form
            className="presenceStatusForm"
            onSubmit={(e) => {
              e.preventDefault();
              send({ action: 'status', status: statusDraft });
            }}
          >
            <input
              value={statusDraft}
              maxLength={80}
              placeholder="Here till late 🖤"
              onChange={(e) => setStatusDraft(e.target.value)}
            />
            <button className="btnGhost" type="submit" disabled={busy}>Set</button>
          </form>
        </div>
      )}
      {error && <div className="formError" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
