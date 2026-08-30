'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RetryExtraction({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    await fetch(`/api/admin/extractions/${id}/retry`, { method: 'POST' });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      className="btnGhost"
      style={{ padding: '4px 10px', fontSize: 10.5 }}
      onClick={retry}
      disabled={busy}
      type="button"
    >
      {busy ? '…' : 'Retry'}
    </button>
  );
}
