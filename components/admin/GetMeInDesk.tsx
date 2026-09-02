'use client';

// The actions on one GET ME IN request. Each button opens the small form
// it needs and posts to the desk API; the page refreshes with the result.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Action = 'reviewing' | 'contact_promoter' | 'log_outreach' | 'confirm_free' | 'offer_discount' | 'purchase' | 'waitlist' | 'decline' | 'attended' | 'note' | 'reopen' | 'cancel';

const DECLINE_REASONS: [string, string][] = [
  ['promoter_declined', 'Promoter declined'], ['no_allocation', 'No allocation'], ['sold_out', 'Sold out'],
  ['too_expensive', 'Too expensive'], ['no_response', 'No response'], ['too_late', 'Request too late'],
  ['fair_use', 'Fair use'], ['other', 'Other'],
];
const METHODS: [string, string][] = [
  ['promoter_guestlist', 'Promoter guestlist'], ['venue', 'Venue'], ['guestlist_allocation', 'Guestlist allocation'],
  ['purchased', 'Ticket purchased'], ['partner', 'Partner'], ['other', 'Other'],
];

export function GetMeInDesk({ requestId, status, hasPromoter, currency, places, memberName }: {
  requestId: string; status: string; hasPromoter: boolean; currency: string; places: number; memberName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const pounds = (v: string) => (v.trim() === '' ? undefined : Math.round(Number(v) * 100));

  async function send(action: Action, body: Record<string, unknown> = {}) {
    setBusy(true); setErr('');
    const r = await fetch(`/api/admin/access-requests/${requestId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? 'Failed'); return; }
    setOpen(null); setF({});
    router.refresh();
  }

  const openStates = ['requested', 'reviewing', 'contacting_promoter', 'waitlisted'];
  const isOpen = openStates.includes(status);
  const firstName = memberName.split(' ')[0];
  const msgDefault: Record<string, string> = {
    confirm_free: `${firstName}, you’re on the guestlist${places > 1 ? ' (+1)' : ''}. Bring ID and arrive before the list closes.`,
    offer_discount: `We couldn’t get you in free this time, but we got you a member price. Here’s how to get it: `,
    purchase: `Sorted — Guestlist has bought your ticket${places > 1 ? 's' : ''}. Details are on the way.`,
    decline: `We couldn’t make this one happen. Keep asking — there’s always another night.`,
    waitlist: `You’re on our waitlist for this one. We’ll keep trying and tell you the moment it moves.`,
  };
  const toggle = (a: Action) => { setErr(''); setF({ memberMessage: msgDefault[a] ?? '' }); setOpen(open === a ? null : a); };

  return (
    <div>
      <div className="deskActions">
        {isOpen && hasPromoter && <button className="btnAccent" onClick={() => toggle('contact_promoter')}>Contact promoter</button>}
        {isOpen && <button className="btnAccent" onClick={() => toggle('confirm_free')}>Confirm free entry</button>}
        {isOpen && <button className="btnGhost" onClick={() => toggle('offer_discount')}>Offer discount</button>}
        {isOpen && <button className="btnGhost" onClick={() => toggle('purchase')}>Buy / fulfil ticket</button>}
        {isOpen && status !== 'waitlisted' && <button className="btnGhost" onClick={() => toggle('waitlist')}>Waitlist</button>}
        {isOpen && <button className="btnGhost" onClick={() => toggle('decline')}>Decline</button>}
        {status === 'requested' && <button className="btnGhost" onClick={() => send('reviewing')} disabled={busy}>Mark reviewing</button>}
        {(status === 'confirmed_free' || status === 'purchased_by_guestlist' || status === 'discounted') && <button className="btnGhost" onClick={() => send('attended')} disabled={busy}>Mark attended</button>}
        {!isOpen && status !== 'attended' && status !== 'cancelled' && <button className="btnGhost" onClick={() => send('reopen')} disabled={busy}>Reopen</button>}
        {isOpen && <button className="btnGhost" onClick={() => toggle('cancel')}>Cancel request</button>}
        <button className="btnGhost" onClick={() => toggle('note')}>Add note</button>
        {hasPromoter && <button className="btnGhost" onClick={() => toggle('log_outreach')}>Log a reply</button>}
      </div>
      {err && <div className="formError">{err}</div>}

      {(open === 'contact_promoter' || open === 'log_outreach') && (
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send(open, { summary: f.summary, channel: f.channel ?? 'email', direction: open === 'log_outreach' ? (f.direction ?? 'inbound') : 'outbound', outcome: f.outcome ?? 'pending', placesOffered: f.placesOffered ? Number(f.placesOffered) : undefined }); }}>
          <div className="row">
            <div><label>Channel</label>
              <select value={f.channel ?? 'email'} onChange={(e) => set('channel', e.target.value)}>
                {['email', 'phone', 'whatsapp', 'instagram', 'in_person', 'other'].map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select></div>
            <div><label>Outcome so far</label>
              <select value={f.outcome ?? 'pending'} onChange={(e) => set('outcome', e.target.value)}>
                <option value="pending">Waiting to hear</option><option value="free_places">Free places offered</option>
                <option value="discount">Discount offered</option><option value="declined">Declined</option><option value="no_response">No response</option>
              </select></div>
          </div>
          {(f.outcome === 'free_places' || f.outcome === 'discount') && (
            <><label>Places offered</label><input type="number" min={0} value={f.placesOffered ?? ''} onChange={(e) => set('placesOffered', e.target.value)} /></>
          )}
          <label>{open === 'contact_promoter' ? 'What you sent / said' : 'What they said'}</label>
          <textarea rows={3} value={f.summary ?? ''} onChange={(e) => set('summary', e.target.value)} required />
          <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Log it'}</button></div>
          <p className="fieldNote" style={{ marginTop: 10 }}>Every conversation moves the promoter relationship along — from “contacted” to “supplying” to “partner with a standing allocation”.</p>
        </form>
      )}

      {open === 'confirm_free' && (
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send('confirm_free', { fulfilmentMethod: f.method ?? (hasPromoter ? 'promoter_guestlist' : 'other'), costPence: pounds(f.cost ?? '') ?? 0, ticketValuePence: pounds(f.value ?? ''), memberMessage: f.memberMessage, note: f.note }); }}>
          <div className="row">
            <div><label>How</label>
              <select value={f.method ?? (hasPromoter ? 'promoter_guestlist' : 'other')} onChange={(e) => set('method', e.target.value)}>
                {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div><label>Normal ticket value ({currency}, each)</label><input type="number" step="0.01" min={0} value={f.value ?? ''} onChange={(e) => set('value', e.target.value)} /></div>
          </div>
          <label>Cost to Guestlist ({currency}, total)</label><input type="number" step="0.01" min={0} value={f.cost ?? '0'} onChange={(e) => set('cost', e.target.value)} />
          <label>Message to {firstName}</label><textarea rows={2} value={f.memberMessage ?? ''} onChange={(e) => set('memberMessage', e.target.value)} />
          <label>Internal note</label><input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : `Confirm — ${places > 1 ? `${places} places` : '1 place'} on the list`}</button></div>
          <p className="fieldNote" style={{ marginTop: 10 }}>{hasPromoter ? 'Writes the member onto the promoter’s Guestlist door list.' : 'This event has no promoter on Guestlist, so nothing is written to a door list — tell the member how entry works in the message.'}</p>
        </form>
      )}

      {open === 'offer_discount' && (
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send('offer_discount', { memberPricePence: pounds(f.price ?? ''), ticketValuePence: pounds(f.value ?? ''), costPence: pounds(f.cost ?? '') ?? 0, fulfilmentMethod: f.method ?? 'promoter_guestlist', memberMessage: f.memberMessage, note: f.note }); }}>
          <div className="row">
            <div><label>Member price ({currency}, each)</label><input type="number" step="0.01" min={0} value={f.price ?? ''} onChange={(e) => set('price', e.target.value)} required /></div>
            <div><label>Normal price ({currency}, each)</label><input type="number" step="0.01" min={0} value={f.value ?? ''} onChange={(e) => set('value', e.target.value)} /></div>
          </div>
          <label>Cost to Guestlist, if any ({currency})</label><input type="number" step="0.01" min={0} value={f.cost ?? '0'} onChange={(e) => set('cost', e.target.value)} />
          <label>Message to {firstName} — include how they get it</label><textarea rows={3} value={f.memberMessage ?? ''} onChange={(e) => set('memberMessage', e.target.value)} required />
          <label>Internal note</label><input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Offer discount'}</button></div>
        </form>
      )}

      {open === 'purchase' && (
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send('purchase', { costPence: pounds(f.cost ?? ''), ticketValuePence: pounds(f.value ?? ''), memberMessage: f.memberMessage, note: f.note }); }}>
          <div className="row">
            <div><label>What Guestlist paid ({currency}, total)</label><input type="number" step="0.01" min={0} value={f.cost ?? ''} onChange={(e) => set('cost', e.target.value)} required /></div>
            <div><label>Face value ({currency}, each)</label><input type="number" step="0.01" min={0} value={f.value ?? ''} onChange={(e) => set('value', e.target.value)} /></div>
          </div>
          <label>Message to {firstName}</label><textarea rows={2} value={f.memberMessage ?? ''} onChange={(e) => set('memberMessage', e.target.value)} />
          <label>Internal note (order ref etc.)</label><input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Mark bought'}</button></div>
        </form>
      )}

      {open === 'waitlist' && (
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send('waitlist', { memberMessage: f.memberMessage, note: f.note }); }}>
          <label>Message to {firstName} (optional)</label><textarea rows={2} value={f.memberMessage ?? ''} onChange={(e) => set('memberMessage', e.target.value)} />
          <label>Internal note</label><input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Waitlist'}</button></div>
        </form>
      )}

      {open === 'decline' && (
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send('decline', { declineReason: f.reason, memberMessage: f.memberMessage, note: f.note }); }}>
          <label>Why — this is the business intelligence</label>
          <select value={f.reason ?? ''} onChange={(e) => set('reason', e.target.value)} required>
            <option value="">Choose…</option>
            {DECLINE_REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label>Message to {firstName}</label><textarea rows={2} value={f.memberMessage ?? ''} onChange={(e) => set('memberMessage', e.target.value)} />
          <label>Internal note</label><input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Decline'}</button></div>
        </form>
      )}

      {(open === 'note' || open === 'cancel') && (
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send(open, { note: f.note }); }}>
          <label>{open === 'note' ? 'Note' : 'Why cancel'}</label><textarea rows={2} value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} required={open === 'note'} />
          <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : open === 'note' ? 'Add note' : 'Cancel request'}</button></div>
        </form>
      )}
    </div>
  );
}
