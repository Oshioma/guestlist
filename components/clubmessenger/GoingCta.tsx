'use client';

// "I'm Going" from a Club Messenger surface — unlocks the room and records
// the going_from_clubmessenger attribution server-side via source.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function GoingCta({ eventId, isSignedIn }: { eventId: string; isSignedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    await fetch(`/api/events/${eventId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rsvp: 'going', source: 'clubmessenger' }),
    }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  return (
    <button className="btnAccent" type="button" disabled={busy} onClick={go}>
      ✓ I’m Going — join the room
    </button>
  );
}
