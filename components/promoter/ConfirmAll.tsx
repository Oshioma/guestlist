'use client';

// CONFIRM ALL for the import queue: confirms every clean draft; duplicate-
// flagged drafts are skipped (those stay with Guestlist admin).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ConfirmAll({
  promoterId,
  eventIds,
}: {
  promoterId: string;
  eventIds: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  async function confirmAll() {
    setBusy(true);
    let ok = 0;
    for (const id of eventIds) {
      const res = await fetch(`/api/promoter/${promoterId}/events/${id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      });
      if (res.ok) ok++;
      setDone(ok);
    }
    setBusy(false);
    router.refresh();
  }

  if (!eventIds.length) return null;
  return (
    <button className="btnAccent" onClick={confirmAll} disabled={busy} type="button">
      {busy ? `Confirming… ${done}/${eventIds.length}` : `Confirm all (${eventIds.length})`}
    </button>
  );
}
