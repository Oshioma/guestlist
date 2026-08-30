'use client';

// Admin controls for the V2C network: scene entities, member reports,
// duplicate requests.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/v2c', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Failed');
    setBusy(false);
    router.refresh();
  }
  return { run, busy, error };
}

export function SceneEntityActions({ entityId }: { entityId: string }) {
  const { run, busy, error } = useAction();
  return (
    <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'approve_entity', entityId })}>Approve</button>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'reject_entity', entityId })}>Reject</button>
      {error && <span className="formError">{error}</span>}
    </span>
  );
}

export function ReportActions({ reportId }: { reportId: string }) {
  const { run, busy, error } = useAction();
  return (
    <span>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'resolve_report', reportId })}>Resolve</button>
      {error && <span className="formError">{error}</span>}
    </span>
  );
}

export function DuplicateActions({ requestId }: { requestId: string }) {
  const { run, busy, error } = useAction();
  return (
    <span style={{ display: 'flex', gap: 8 }}>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'decide_duplicate', requestId, approve: true })}>Approve</button>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'decide_duplicate', requestId, approve: false })}>Reject</button>
      {error && <span className="formError">{error}</span>}
    </span>
  );
}
