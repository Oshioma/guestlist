'use client';

// GRANT MEMBERSHIP / REVOKE. The people we want in without a card.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function GrantMembership() {
  const router = useRouter();
  const [v, setV] = useState({ email: '', source: 'complimentary', expiresAt: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(''); setErr('');
    const r = await fetch('/api/admin/memberships', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'grant', ...v, expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? 'Failed'); return; }
    setMsg(`Granted to ${v.email}.`);
    setV({ email: '', source: 'complimentary', expiresAt: '', note: '' });
    router.refresh();
  }
  return (
    <form className="deskForm" style={{ maxWidth: 560 }} onSubmit={submit}>
      <label>Email of a Guestlist account</label>
      <input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required />
      <div className="row">
        <div>
          <label>Kind</label>
          <select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })}>
            <option value="complimentary">Complimentary</option>
            <option value="lifetime">Lifetime</option>
            <option value="manual">Manual (paid outside Stripe)</option>
          </select>
        </div>
        <div>
          <label>Expires (optional)</label>
          <input type="date" value={v.expiresAt} onChange={(e) => setV({ ...v, expiresAt: e.target.value })} disabled={v.source === 'lifetime'} />
        </div>
      </div>
      <label>Why (internal)</label>
      <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="DJ, promoter, journalist, competition winner…" />
      {err && <div className="formError">{err}</div>}
      {msg && <div className="formOk">{msg}</div>}
      <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Grant membership'}</button></div>
    </form>
  );
}

export function RevokeMembership({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function go() {
    setBusy(true);
    const r = await fetch('/api/admin/memberships', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', memberId }),
    });
    setBusy(false);
    if (r.ok) { setConfirm(false); router.refresh(); }
  }
  if (!confirm) return <button className="btnGhost" style={{ padding: '4px 10px', fontSize: 10.5 }} onClick={() => setConfirm(true)}>Revoke</button>;
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button className="btnAccent" style={{ padding: '4px 10px', fontSize: 10.5 }} onClick={go} disabled={busy}>Confirm revoke</button>
      <button className="btnGhost" style={{ padding: '4px 10px', fontSize: 10.5 }} onClick={() => setConfirm(false)}>Keep</button>
    </span>
  );
}
