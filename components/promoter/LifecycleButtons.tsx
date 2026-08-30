'use client';

// Confirm / Ignore for drafts; Cancel / Sold out / Restore for live events.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LifecycleButtons({
  promoterId,
  eventId,
  status,
  listingStatus,
  duplicateFlagged,
}: {
  promoterId: string;
  eventId: string;
  status: string;
  listingStatus: string;
  duplicateFlagged: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function act(action: string) {
    if (action === 'cancel' && !confirm('Mark this event as cancelled? It stays visible, clearly marked, with tickets disabled.')) return;
    setBusy(action);
    setError('');
    const res = await fetch(`/api/promoter/${promoterId}/events/${eventId}/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? 'Failed');
  }

  const small = { padding: '6px 12px', fontSize: 11 } as const;
  const pending = status === 'new' || status === 'needs_review';

  return (
    <>
      {pending && !duplicateFlagged && (
        <button className="btnAccent" style={small} onClick={() => act('confirm')} disabled={!!busy} type="button">
          {busy === 'confirm' ? '…' : 'Confirm'}
        </button>
      )}
      {pending && duplicateFlagged && (
        <span style={{ fontSize: 10.5, color: 'var(--text-faint)', maxWidth: 110 }}>
          Guestlist is reviewing a duplicate flag
        </span>
      )}
      {pending && (
        <button className="btnGhost" style={small} onClick={() => act('ignore')} disabled={!!busy} type="button">
          {busy === 'ignore' ? '…' : 'Ignore'}
        </button>
      )}
      {status === 'live' && listingStatus === 'confirmed' && (
        <>
          <button className="btnGhost" style={small} onClick={() => act('sold_out')} disabled={!!busy} type="button">
            {busy === 'sold_out' ? '…' : 'Sold out'}
          </button>
          <button className="btnGhost" style={small} onClick={() => act('postpone')} disabled={!!busy} type="button">
            {busy === 'postpone' ? '…' : 'Postpone'}
          </button>
          <button className="btnGhost" style={small} onClick={() => act('cancel')} disabled={!!busy} type="button">
            {busy === 'cancel' ? '…' : 'Cancel event'}
          </button>
        </>
      )}
      {status === 'live' && listingStatus !== 'confirmed' && (
        <button className="btnGhost" style={small} onClick={() => act('restore')} disabled={!!busy} type="button">
          {busy === 'restore' ? '…' : 'Restore'}
        </button>
      )}
      {error && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</span>}
    </>
  );
}
