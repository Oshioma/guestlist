'use client';

// Manage or cancel through Stripe's Billing Portal.

import { useState } from 'react';

export function ManageMembership({ label = 'Manage membership' }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function open() {
    setBusy(true); setError('');
    const r = await fetch('/api/membership/portal', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.url) { window.location.href = j.url; return; }
    setError(j.error || 'Could not open billing');
    setBusy(false);
  }
  return (
    <span>
      <button className="btnGhost" onClick={open} disabled={busy}>{busy ? 'Opening…' : label}</button>
      {error && <span className="adminSub" style={{ marginLeft: 10 }}>{error}</span>}
    </span>
  );
}
