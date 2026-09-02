'use client';

import { useState } from 'react';

export function DropClaim({ dropId, initialClaimed, full }: { dropId: string; initialClaimed: boolean; full: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'claimed' | 'full' | 'error'>(initialClaimed ? 'claimed' : full ? 'full' : 'idle');
  async function go() {
    setState('busy');
    const r = await fetch(`/api/membership/drops/${dropId}`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setState('error'); return; }
    setState(j.outcome === 'full' ? 'full' : 'claimed');
  }
  if (state === 'claimed') return <span className="reqChip guestlisted">You’re down</span>;
  if (state === 'full') return <span className="reqChip sorry">All gone</span>;
  return (
    <button className="btnAccent" onClick={go} disabled={state === 'busy'} style={{ padding: '8px 14px', fontSize: 11 }}>
      {state === 'busy' ? '…' : state === 'error' ? 'Try again' : 'Put my name down'}
    </button>
  );
}
