'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SourceToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch(`/api/admin/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      className="btnGhost"
      style={{ padding: '4px 10px', fontSize: 10.5, marginLeft: 8 }}
      onClick={toggle}
      disabled={busy}
      type="button"
    >
      {active ? 'Pause' : 'Resume'}
    </button>
  );
}
