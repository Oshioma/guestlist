'use client';

// Create and edit member offers. The form is the same whether the business
// or the desk is filling it in; only where it posts differs.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type OfferFormValues = {
  id?: string; title: string; offerType: string; discountPercent: string; discountAmountPence: string; currency: string;
  description: string; redemptionInstructions: string; terms: string; redemptionMethod: string; claimValidityMinutes: string;
  validFrom: string; validTo: string; active: boolean; approvalStatus?: string;
};

export const EMPTY_OFFER: OfferFormValues = {
  title: '', offerType: 'percentage', discountPercent: '', discountAmountPence: '', currency: 'GBP', description: '',
  redemptionInstructions: 'Show your code at the counter.', terms: '', redemptionMethod: 'code', claimValidityMinutes: '1440',
  validFrom: '', validTo: '', active: true,
};

const TYPES: [string, string][] = [
  ['percentage', 'Percentage off'], ['fixed', 'Fixed amount off'], ['free_item', 'Free item'], ['free_upgrade', 'Free upgrade'],
  ['package', 'Special package'], ['member_only', 'Member-only product or service'], ['other', 'Something else'],
];

export function OfferEditor({ businessId, initial, endpoint, onDone }: {
  businessId: string; initial: OfferFormValues; endpoint: 'portal' | 'admin'; onDone?: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const upd = (patch: Partial<OfferFormValues>) => setV((x) => ({ ...x, ...patch }));
  const toLocal = (s: string) => (s ? new Date(s).toISOString().slice(0, 16) : '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(''); setMsg('');
    const payload = {
      offerId: v.id, title: v.title, offerType: v.offerType,
      discountPercent: v.discountPercent ? Number(v.discountPercent) : null,
      discountAmountPence: v.discountAmountPence ? Math.round(Number(v.discountAmountPence) * 100) : null,
      currency: v.currency, description: v.description, redemptionInstructions: v.redemptionInstructions, terms: v.terms,
      redemptionMethod: v.redemptionMethod, claimValidityMinutes: Number(v.claimValidityMinutes) || 1440,
      validFrom: v.validFrom ? new Date(v.validFrom).toISOString() : null, validTo: v.validTo ? new Date(v.validTo).toISOString() : null,
      active: v.active, ...(endpoint === 'admin' && v.approvalStatus ? { approvalStatus: v.approvalStatus } : {}),
    };
    const res = endpoint === 'portal'
      ? await fetch(`/api/business/${businessId}/offers`, { method: v.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/admin/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'offer', businessId, offer: payload }) });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? 'Save failed'); return; }
    setMsg(j.backToReview ? 'Saved — that change goes back to Guestlist for a quick check before it’s live.' : 'Saved.');
    router.refresh();
    onDone?.();
  }

  return (
    <form className="deskForm" onSubmit={submit}>
      <label htmlFor="o-title">Offer title</label>
      <input id="o-title" value={v.title} onChange={(e) => upd({ title: e.target.value })} placeholder="15% off everything" required />
      <div className="row">
        <div>
          <label htmlFor="o-type">Kind of offer</label>
          <select id="o-type" value={v.offerType} onChange={(e) => upd({ offerType: e.target.value })}>
            {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {v.offerType === 'percentage' && (
          <div><label htmlFor="o-pct">Percent off</label><input id="o-pct" type="number" min={1} max={100} value={v.discountPercent} onChange={(e) => upd({ discountPercent: e.target.value })} /></div>
        )}
        {v.offerType === 'fixed' && (
          <div><label htmlFor="o-amt">Amount off ({v.currency})</label><input id="o-amt" type="number" min={0.01} step={0.01} value={v.discountAmountPence} onChange={(e) => upd({ discountAmountPence: e.target.value })} /></div>
        )}
      </div>
      <label htmlFor="o-desc">What members get</label>
      <textarea id="o-desc" rows={3} value={v.description} onChange={(e) => upd({ description: e.target.value })} />
      <label htmlFor="o-how">How to use it</label>
      <input id="o-how" value={v.redemptionInstructions} onChange={(e) => upd({ redemptionInstructions: e.target.value })} />
      <label htmlFor="o-terms">Terms for this offer</label>
      <textarea id="o-terms" rows={2} value={v.terms} onChange={(e) => upd({ terms: e.target.value })} placeholder="Not with other offers. Dine-in only. …" />
      <div className="row">
        <div><label htmlFor="o-from">Valid from</label><input id="o-from" type="datetime-local" value={toLocal(v.validFrom)} onChange={(e) => upd({ validFrom: e.target.value })} /></div>
        <div><label htmlFor="o-to">Valid until</label><input id="o-to" type="datetime-local" value={toLocal(v.validTo)} onChange={(e) => upd({ validTo: e.target.value })} /></div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="o-life">Code lasts</label>
          <select id="o-life" value={v.claimValidityMinutes} onChange={(e) => upd({ claimValidityMinutes: e.target.value })}>
            <option value="30">30 minutes</option><option value="120">2 hours</option><option value="1440">24 hours</option>
            <option value="10080">7 days</option><option value="43200">30 days</option>
          </select>
        </div>
        <div>
          <label htmlFor="o-active">Switched on</label>
          <select id="o-active" value={v.active ? 'yes' : 'no'} onChange={(e) => upd({ active: e.target.value === 'yes' })}>
            <option value="yes">Live</option><option value="no">Paused</option>
          </select>
        </div>
      </div>
      {endpoint === 'admin' && (
        <>
          <label htmlFor="o-appr">Guestlist approval</label>
          <select id="o-appr" value={v.approvalStatus ?? 'approved'} onChange={(e) => upd({ approvalStatus: e.target.value })}>
            <option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option>
          </select>
        </>
      )}
      <div className="formError">{err}</div>
      {msg && <div className="formOk">{msg}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btnAccent" disabled={busy} type="submit">{busy ? 'Saving…' : v.id ? 'Save offer' : 'Create offer'}</button>
        {onDone && <button type="button" className="btnGhost" onClick={onDone}>Close</button>}
      </div>
    </form>
  );
}

export function OfferList({ businessId, offers, endpoint }: {
  businessId: string; endpoint: 'portal' | 'admin';
  offers: { id: string; title: string; offer_type: string; discount_percent: number | null; discount_amount_pence: number | null; currency: string;
    description: string | null; redemption_instructions: string | null; terms: string | null; redemption_method: string; claim_validity_minutes: number;
    valid_from: string | null; valid_to: string | null; active: boolean; approval_status: string }[];
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const toForm = (o: (typeof offers)[number]): OfferFormValues => ({
    id: o.id, title: o.title, offerType: o.offer_type, discountPercent: o.discount_percent?.toString() ?? '',
    discountAmountPence: o.discount_amount_pence ? (o.discount_amount_pence / 100).toString() : '', currency: o.currency,
    description: o.description ?? '', redemptionInstructions: o.redemption_instructions ?? '', terms: o.terms ?? '',
    redemptionMethod: o.redemption_method, claimValidityMinutes: String(o.claim_validity_minutes), validFrom: o.valid_from ?? '',
    validTo: o.valid_to ?? '', active: o.active, approvalStatus: o.approval_status,
  });
  return (
    <div>
      {offers.map((o) => (
        <div key={o.id} className="attentionRow" style={{ flexWrap: 'wrap' }}>
          <span>
            <b>{o.title}</b>{' '}
            <span className={`evChip ${o.approval_status === 'approved' ? 'green' : o.approval_status === 'pending' ? 'amber' : 'red'}`}>{o.approval_status}</span>{' '}
            {!o.active && <span className="evChip">paused</span>}
            <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              {o.offer_type.replace('_', ' ')}{o.discount_percent ? ` · ${o.discount_percent}%` : ''}{o.discount_amount_pence ? ` · ${(o.discount_amount_pence / 100).toFixed(2)} ${o.currency}` : ''}
              {o.valid_to && ` · until ${new Date(o.valid_to).toLocaleDateString('en-GB')}`}
            </div>
          </span>
          <button className="btnGhost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={() => setEditing(editing === o.id ? null : o.id)}>{editing === o.id ? 'Close' : 'Edit'}</button>
          {editing === o.id && <div style={{ flexBasis: '100%' }}><OfferEditor businessId={businessId} initial={toForm(o)} endpoint={endpoint} onDone={() => setEditing(null)} /></div>}
        </div>
      ))}
      {editing === 'new' ? (
        <OfferEditor businessId={businessId} initial={EMPTY_OFFER} endpoint={endpoint} onDone={() => setEditing(null)} />
      ) : (
        <button className="btnAccent" style={{ marginTop: 12 }} onClick={() => setEditing('new')}>+ New offer</button>
      )}
    </div>
  );
}
