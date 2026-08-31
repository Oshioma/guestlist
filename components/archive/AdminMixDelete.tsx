'use client';

// Admin-only: remove a mix from anywhere it renders. Two-tap confirm so a
// stray click on a public page never deletes anything.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AdminMixDelete({ mixId }: { mixId: string }) {
  const router = useRouter();
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function del() {
    if (busy) return;
    setBusy(true);
    const res = await fetch('/api/admin/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_mix', mixId }),
    }).catch(() => null);
    setBusy(false);
    setArming(false);
    if (res?.ok) router.refresh();
  }

  return arming ? (
    <span className="mixAdminDel">
      <button type="button" className="mixAdminDelConfirm" onClick={del} disabled={busy}>
        {busy ? 'Deleting…' : 'Really delete'}
      </button>
      <button type="button" className="mixAdminDelCancel" onClick={() => setArming(false)}>Cancel</button>
    </span>
  ) : (
    <button type="button" className="mixAdminDel" onClick={() => setArming(true)} title="Delete this mix (admin)">
      ✕ Delete
    </button>
  );
}
