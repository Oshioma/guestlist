'use client';

// At the counter: type the member's code, press redeem.

import { useState } from 'react';

export function RedeemBox({ businessId }: { businessId: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setResult(null);
    const r = await fetch(`/api/business/${businessId}/redeem`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setResult({ ok: false, text: j.error ?? 'Something went wrong' }); return; }
    const text = j.outcome === 'redeemed' ? `✓ Redeemed — ${j.offer_title} for ${j.member_name}`
      : j.outcome === 'already_redeemed' ? 'This code has already been used'
      : j.outcome === 'expired' ? 'This code has expired — ask the member to claim again'
      : j.outcome === 'cancelled' ? 'This code was cancelled'
      : 'Code not found for this business';
    setResult({ ok: j.outcome === 'redeemed', text });
    if (j.outcome === 'redeemed') setCode('');
  }

  return (
    <form className="formCard redeemBox" onSubmit={submit}>
      <label htmlFor="rd-code">Member’s code</label>
      <input id="rd-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="GL-XXXX-XXXX" autoComplete="off" autoFocus />
      <button className="btnAccent" style={{ width: '100%', marginTop: 10, padding: 14 }} disabled={busy || code.length < 8} type="submit">{busy ? 'Checking…' : 'Redeem'}</button>
      {result && <div className={`redeemResult ${result.ok ? 'ok' : 'bad'}`}>{result.text}</div>}
    </form>
  );
}
