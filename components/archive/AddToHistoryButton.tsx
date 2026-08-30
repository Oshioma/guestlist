'use client';

// ADD TO MY RAVE HISTORY — from a scene entity page straight into the
// member's cultural profile (reuses the V2C history API).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AddToHistoryButton({
  entityId, added, isSignedIn,
}: {
  entityId: string;
  added: boolean;
  isSignedIn: boolean;
}) {
  const router = useRouter();
  const [isAdded, setIsAdded] = useState(added);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (busy || isAdded) return;
    setBusy(true);
    const res = await fetch('/api/you/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId, genreIds: [] }),
    });
    if (res.ok) {
      setIsAdded(true);
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 12 }}>
      {isAdded ? (
        <span className="btnGhost isActive" style={{ display: 'inline-block' }}>✓ In your rave history</span>
      ) : (
        <button className="btnAccent" type="button" disabled={busy} onClick={add}>
          Add to my rave history
        </button>
      )}
    </div>
  );
}
