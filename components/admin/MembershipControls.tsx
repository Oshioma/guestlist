'use client';

// GRANT MEMBERSHIP / REVOKE for the people we want in without a card, and
// CANCEL / REFUND through Stripe for the people who pay.

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

// Stripe members: end the subscription, or send money back. Each one asks
// twice, says exactly what will happen, and takes a note for the ledger.
export function StripeControls({ memberId, cancelAtPeriodEnd, periodEnd, active, lastPaidPence, currency = 'GBP' }: {
  memberId: string; cancelAtPeriodEnd: boolean; periodEnd: string | null; active: boolean; lastPaidPence: number; currency?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | 'cancel' | 'refund'>(null);
  const [when, setWhen] = useState<'period_end' | 'now'>('period_end');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : `${currency} `;
  const ends = periodEnd ? new Date(periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'the end of the paid month';

  async function go() {
    setBusy(true); setErr(''); setMsg('');
    const body = mode === 'cancel'
      ? { action: 'cancel_stripe', memberId, when, note }
      : { action: 'refund', memberId, note, amountPence: amount.trim() ? Math.round(Number(amount) * 100) : null };
    const r = await fetch('/api/admin/memberships', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? 'Failed'); return; }
    setMsg(mode === 'cancel'
      ? (j.outcome === 'cancelled_now' ? 'Ended now. They have been told.' : j.outcome === 'already' ? 'Already cancelling.' : `Ends ${ends}. They have been told.`)
      : `Refunded ${sym}${(j.amountPence / 100).toFixed(2)}. ${j.remainingPence > 0 ? `${sym}${(j.remainingPence / 100).toFixed(2)} of that payment is left.` : 'That payment is fully refunded.'} They have been told.`);
    setMode(null); setNote(''); setAmount('');
    router.refresh();
  }

  if (!mode) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {active && !cancelAtPeriodEnd && <button className="btnGhost" style={{ padding: '4px 10px', fontSize: 10.5 }} onClick={() => { setMode('cancel'); setWhen('period_end'); }}>Cancel</button>}
        {active && cancelAtPeriodEnd && <button className="btnGhost" style={{ padding: '4px 10px', fontSize: 10.5 }} onClick={() => { setMode('cancel'); setWhen('now'); }}>End now</button>}
        <button className="btnGhost" style={{ padding: '4px 10px', fontSize: 10.5 }} onClick={() => setMode('refund')}>Refund</button>
        {msg && <span className="formOk" style={{ fontSize: 11.5 }}>{msg}</span>}
      </span>
    );
  }
  return (
    <div className="deskForm stripeControl" onClick={(e) => e.stopPropagation()}>
      {mode === 'cancel' ? (
        <>
          <label>Cancel this membership in Stripe</label>
          <select value={when} onChange={(e) => setWhen(e.target.value as 'period_end' | 'now')}>
            <option value="period_end">At the end of the paid month ({ends}) — normal</option>
            <option value="now">Now — access ends immediately</option>
          </select>
          <div className="adminSub">{when === 'now' ? 'They lose access the moment you confirm. No refund is made unless you also press Refund.' : `They keep everything until ${ends} and are not charged again.`}</div>
        </>
      ) : (
        <>
          <label>Refund the last payment ({sym}{(lastPaidPence / 100).toFixed(2)})</label>
          <input inputMode="decimal" placeholder={`Blank = the full ${sym}${(lastPaidPence / 100).toFixed(2)}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="adminSub">Money goes back to their card in 5–10 days. The membership itself does not change — cancel separately if it should.</div>
        </>
      )}
      <label>Why (for the ledger)</label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. test payment, asked by email, goodwill" />
      {err && <div className="formError">{err}</div>}
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button className="btnAccent" disabled={busy} onClick={go}>{busy ? '…' : mode === 'cancel' ? (when === 'now' ? 'Confirm — end now' : 'Confirm cancel') : 'Confirm refund'}</button>
        <button className="btnGhost" type="button" onClick={() => { setMode(null); setErr(''); }}>Back</button>
      </div>
    </div>
  );
}
