'use client';

// The actions on one request — GET ME IN or ASK GUESTLIST. Each button opens
// the small form it needs and posts to the desk API; the page refreshes with
// the result. External requests add LINK EVENT / IMPORT / ASSIGN PROMOTER.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Action = 'reviewing' | 'contact_promoter' | 'log_outreach' | 'confirm_free' | 'offer_discount' | 'purchase' | 'waitlist' | 'decline'
  | 'attended' | 'note' | 'reopen' | 'cancel' | 'link_event' | 'import_event' | 'assign_promoter' | 'message_member' | 'answer';

const OUTCOME_REASONS: [string, string][] = [
  ['promoter_declined', 'Promoter declined'], ['promoter_no_response', 'Promoter — no response'], ['no_promoter_contact', 'No promoter contact'],
  ['no_allocation', 'No allocation'], ['sold_out', 'Sold out'], ['too_expensive', 'Too expensive'], ['request_too_late', 'Request too late'],
  ['fair_use', 'Fair use'], ['excluded_event', 'Excluded event'], ['event_cancelled', 'Event cancelled'],
  ['insufficient_information', 'Not enough information'], ['other', 'Other'],
];
const METHODS: [string, string][] = [
  ['promoter_guestlist', 'Promoter guestlist'], ['venue', 'Venue'], ['guestlist_allocation', 'Guestlist allocation'],
  ['purchased', 'Ticket purchased'], ['partner', 'Partner'], ['other', 'Other'],
];

type Found = { id: string; title?: string; name?: string; slug: string; start_at?: string; city: string | null; status?: string; relationship_status?: string };

function Picker({ kind, onPick, busy }: { kind: 'events' | 'promoters'; onPick: (id: string) => void; busy: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Found[]>([]);
  async function search(value: string) {
    setQ(value);
    if (value.trim().length < 2) { setResults([]); return; }
    const r = await fetch(`/api/admin/access-requests/search?kind=${kind}&q=${encodeURIComponent(value)}`);
    const j = await r.json().catch(() => ({}));
    setResults(j.results ?? []);
  }
  return (
    <div>
      <label>{kind === 'events' ? 'Find the event on Guestlist' : 'Find the promoter'}</label>
      <input value={q} onChange={(e) => search(e.target.value)} placeholder="Start typing…" autoFocus />
      {results.map((x) => (
        <div className="attentionRow" key={x.id}>
          <span><b>{x.title ?? x.name}</b> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            {x.start_at && new Date(x.start_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{x.city && ` · ${x.city}`}{x.status && ` · ${x.status}`}{x.relationship_status && ` · ${x.relationship_status}`}
          </span></span>
          <button type="button" className="btnAccent" style={{ padding: '4px 10px', fontSize: 10.5 }} disabled={busy} onClick={() => onPick(x.id)}>{kind === 'events' ? 'Link' : 'Assign'}</button>
        </div>
      ))}
    </div>
  );
}

export function GetMeInDesk({ requestId, status, hasEvent, hasPromoter, currency, places, memberName, requestType, externalUrl, alreadyImported, suggested }: {
  requestId: string; status: string; hasEvent: boolean; hasPromoter: boolean; currency: string; places: number; memberName: string;
  requestType: string; externalUrl: string | null; alreadyImported: boolean; suggested: { id: string; title: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const pounds = (v: string) => (v.trim() === '' ? undefined : Math.round(Number(v) * 100));

  async function send(action: Action, body: Record<string, unknown> = {}) {
    setBusy(true); setErr(''); setInfo('');
    const r = await fetch(`/api/admin/access-requests/${requestId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? 'Failed'); return; }
    if (action === 'import_event' && j.submission) {
      setInfo(j.submission.status === 'created' ? 'Imported — a draft is waiting in the events review queue.'
        : j.submission.status === 'duplicate' ? 'That link is already an event on Guestlist — linked.'
        : 'Sent through the pipeline; not enough could be read automatically, so it is in review for a person.');
    }
    setOpen(null); setF({});
    router.refresh();
  }

  const openStates = ['requested', 'reviewing', 'contacting_promoter', 'waitlisted'];
  const isOpen = openStates.includes(status);
  const isAccess = ['event_access', 'plus_one', 'sold_out_event'].includes(requestType);
  const firstName = memberName.split(' ')[0];
  const msgDefault: Record<string, string> = {
    confirm_free: `${firstName}, you’re on the guestlist${places > 1 ? ' (+1)' : ''}. Bring ID and arrive before the list closes.`,
    offer_discount: `We couldn’t get you in free this time, but we got you a member price. Here’s how to get it: `,
    purchase: `Sorted — Guestlist has bought your ticket${places > 1 ? 's' : ''}. Details are on the way.`,
    decline: `We couldn’t make this one happen. Keep asking — there’s always another night.`,
    waitlist: `You’re on our waitlist for this one. We’ll keep trying and tell you the moment it moves.`,
    answer: '',
    message_member: '',
  };
  const toggle = (a: Action) => { setErr(''); setInfo(''); setF({ memberMessage: msgDefault[a] ?? '' }); setOpen(open === a ? null : a); };

  return (
    <div>
      {suggested && !hasEvent && isOpen && (
        <div className="claimStrip" style={{ marginBottom: 10 }}>
          <span>Looks like <b>{suggested.title}</b> on Guestlist — same name and date.</span>
          <button className="btnAccent" style={{ padding: '6px 12px', fontSize: 11 }} disabled={busy} onClick={() => send('link_event', { eventId: suggested.id })}>Link it</button>
        </div>
      )}
      <div className="deskActions">
        {isOpen && !hasEvent && <button className="btnAccent" onClick={() => toggle('link_event')}>Link event</button>}
        {isOpen && !hasEvent && externalUrl && !alreadyImported && <button className="btnGhost" disabled={busy} onClick={() => send('import_event')}>Create / import event</button>}
        {isOpen && !hasPromoter && <button className="btnAccent" onClick={() => toggle('assign_promoter')}>Assign promoter</button>}
        {isOpen && hasPromoter && <button className="btnAccent" onClick={() => toggle('contact_promoter')}>Contact promoter</button>}
        {isOpen && isAccess && <button className="btnAccent" onClick={() => toggle('confirm_free')}>Confirm free entry</button>}
        {isOpen && isAccess && <button className="btnGhost" onClick={() => toggle('offer_discount')}>Offer discount</button>}
        {isOpen && isAccess && <button className="btnGhost" onClick={() => toggle('purchase')}>Buy / fulfil ticket</button>}
        {isOpen && !isAccess && <button className="btnAccent" onClick={() => toggle('answer')}>Answer</button>}
        {isOpen && status !== 'waitlisted' && <button className="btnGhost" onClick={() => toggle('waitlist')}>Waitlist</button>}
        {isOpen && <button className="btnGhost" onClick={() => toggle('decline')}>Decline</button>}
        {isOpen && <button className="btnGhost" onClick={() => toggle('message_member')}>Message member</button>}
        {status === 'requested' && <button className="btnGhost" onClick={() => send('reviewing')} disabled={busy}>Mark reviewing</button>}
        {(status === 'confirmed_free' || status === 'purchased_by_guestlist' || status === 'discounted') && <button className="btnGhost" onClick={() => send('attended')} disabled={busy}>Mark attended</button>}
        {!isOpen && status !== 'attended' && status !== 'cancelled' && <button className="btnGhost" onClick={() => send('reopen')} disabled={busy}>Reopen</button>}
        {isOpen && <button className="btnGhost" onClick={() => toggle('cancel')}>Cancel request</button>}
        <button className="btnGhost" onClick={() => toggle('note')}>Add note</button>
        {hasPromoter && <button className="btnGhost" onClick={() => toggle('log_outreach')}>Log a reply</button>}
      </div>
      {err && <div className="formError">{err}</div>}
      {info && <div className="formOk">{info}</div>}

      {open === 'link_event' && (
        <div className="deskForm">
          <Picker kind="events" busy={busy} onPick={(id) => send('link_event', { eventId: id })} />
          <p className="fieldNote" style={{ marginTop: 10 }}>Not on Guestlist yet? {externalUrl ? 'Use Create / import — it runs the normal paste-a-link pipeline and lands in the review queue.' : 'Add it by hand from Events → New event, then link it.'}</p>
        </div>
      )}
      {open === 'assign_promoter' && (
        <div className="deskForm">
          <Picker kind="promoters" busy={busy} onPick={(id) => send('assign_promoter', { promoterId: id })} />
          <p className="fieldNote" style={{ marginTop: 10 }}>Not on Guestlist yet? Add the promoter from Admin → Promoters, then assign.</p>
        </div>
      )}

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
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send('confirm_free', { fulfilmentMethod: f.method ?? (hasPromoter && hasEvent ? 'promoter_guestlist' : 'other'), costPence: pounds(f.cost ?? '') ?? 0, ticketValuePence: pounds(f.value ?? ''), memberMessage: f.memberMessage, note: f.note }); }}>
          <div className="row">
            <div><label>How</label>
              <select value={f.method ?? (hasPromoter && hasEvent ? 'promoter_guestlist' : 'other')} onChange={(e) => set('method', e.target.value)}>
                {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div><label>Normal ticket value ({currency}, each)</label><input type="number" step="0.01" min={0} value={f.value ?? ''} onChange={(e) => set('value', e.target.value)} /></div>
          </div>
          <label>Cost to Guestlist ({currency}, total)</label><input type="number" step="0.01" min={0} value={f.cost ?? '0'} onChange={(e) => set('cost', e.target.value)} />
          <label>Message to {firstName}</label><textarea rows={2} value={f.memberMessage ?? ''} onChange={(e) => set('memberMessage', e.target.value)} />
          <label>Internal note</label><input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : `Confirm — ${places > 1 ? `${places} places` : '1 place'}`}</button></div>
          <p className="fieldNote" style={{ marginTop: 10 }}>{hasPromoter && hasEvent ? 'Writes the member onto the promoter’s Guestlist door list.' : 'No Guestlist event + promoter to write a door list against — tell the member how entry works in the message (or link the event first).'}</p>
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

      {(open === 'answer' || open === 'message_member') && (
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send(open, { memberMessage: f.memberMessage, note: f.note }); }}>
          <label>{open === 'answer' ? `What we think — this closes the ask and goes to ${firstName}` : `Message to ${firstName} (status unchanged)`}</label>
          <textarea rows={4} value={f.memberMessage ?? ''} onChange={(e) => set('memberMessage', e.target.value)} required />
          <label>Internal note</label><input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : open === 'answer' ? 'Send — HERE’S WHAT WE THINK' : 'Send message'}</button></div>
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
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); send('decline', { outcomeReason: f.reason, memberMessage: f.memberMessage, note: f.note }); }}>
          <label>Why — internal, this is the business intelligence</label>
          <select value={f.reason ?? ''} onChange={(e) => set('reason', e.target.value)} required>
            <option value="">Choose…</option>
            {OUTCOME_REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label>Message to {firstName} — they see this, never the reason above</label><textarea rows={2} value={f.memberMessage ?? ''} onChange={(e) => set('memberMessage', e.target.value)} />
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
