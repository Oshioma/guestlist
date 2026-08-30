'use client';

// "Is this your event?" — shown to verified promoter team members on
// events with no promoter attached.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ClaimEventPrompt({
  eventId,
  promoters,
}: {
  eventId: string;
  promoters: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function claim(promoterId: string) {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/promoter/${promoterId}/claim-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMessage(data.message ?? 'Claim received.');
      router.refresh();
    } else {
      setError(data.error ?? 'Claim failed');
    }
  }

  if (message) {
    return <div className="claimStrip" style={{ marginTop: 30 }}>{message}</div>;
  }

  return (
    <div className="claimStrip" style={{ marginTop: 30 }}>
      <span>Is this your event?</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {promoters.map((p) => (
          <button key={p.id} className="btnGhost" disabled={busy} onClick={() => claim(p.id)} type="button">
            {busy ? '…' : `Claim for ${p.name}`}
          </button>
        ))}
        {error && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}
