'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function useAction(path: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function act(action: string, note?: string) {
    setBusy(action);
    setError('');
    const res = await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note }),
    });
    setBusy(null);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? 'Failed');
  }
  return { act, busy, error };
}

export function ClaimDecision({ claimId }: { claimId: string }) {
  const { act, busy, error } = useAction(`/api/admin/claims/${claimId}`);
  return (
    <>
      <button className="btnAccent" disabled={!!busy} onClick={() => act('approve')} type="button">
        {busy === 'approve' ? '…' : 'Approve'}
      </button>
      <button className="btnGhost" disabled={!!busy} onClick={() => {
        const note = prompt('What extra information do you need?');
        if (note != null) act('request_info', note);
      }} type="button">
        {busy === 'request_info' ? '…' : 'Request info'}
      </button>
      <button className="btnGhost" disabled={!!busy} onClick={() => {
        const note = prompt('Rejection note (optional)') ?? undefined;
        act('reject', note);
      }} type="button">
        {busy === 'reject' ? '…' : 'Reject'}
      </button>
      {error && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</span>}
    </>
  );
}

export function EventClaimDecision({ claimId }: { claimId: string }) {
  const { act, busy, error } = useAction(`/api/admin/event-claims/${claimId}`);
  return (
    <span style={{ display: 'flex', gap: 6 }}>
      <button className="btnAccent" style={{ padding: '5px 12px', fontSize: 11 }} disabled={!!busy}
              onClick={() => act('approve')} type="button">
        {busy === 'approve' ? '…' : 'Approve'}
      </button>
      <button className="btnGhost" style={{ padding: '5px 12px', fontSize: 11 }} disabled={!!busy}
              onClick={() => act('reject')} type="button">
        {busy === 'reject' ? '…' : 'Reject'}
      </button>
      {error && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</span>}
    </span>
  );
}

export function PromoterSuspend({ promoterId, suspended }: { promoterId: string; suspended: boolean }) {
  const { act, busy, error } = useAction(`/api/admin/promoters/${promoterId}`);
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button className="btnGhost" style={{ padding: '5px 12px', fontSize: 11 }} disabled={!!busy}
              onClick={() => {
                if (suspended || confirm('Suspend this promoter account? Their team loses dashboard access.')) {
                  act(suspended ? 'unsuspend' : 'suspend');
                }
              }} type="button">
        {busy ? '…' : suspended ? 'Unsuspend' : 'Suspend'}
      </button>
      {error && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</span>}
    </span>
  );
}
