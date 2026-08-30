'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SaveButton({
  eventId,
  initialSaved,
  isSignedIn,
}: {
  eventId: string;
  initialSaved: boolean;
  isSignedIn: boolean;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    const next = !saved;
    setSaved(next); // optimistic
    const res = await fetch(`/api/events/${eventId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: next }),
    });
    if (!res.ok) setSaved(!next);
    setBusy(false);
  }

  return (
    <button
      className={`saveBtn${saved ? ' saved' : ''}`}
      onClick={toggle}
      aria-label={saved ? 'Remove from saved' : 'Save event'}
      title={saved ? 'Saved' : 'Save'}
      type="button"
    >
      {saved ? '♥' : '♡'}
    </button>
  );
}
