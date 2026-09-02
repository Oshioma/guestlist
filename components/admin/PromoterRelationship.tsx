'use client';

// The promoter side of the desk: who to call, where the relationship is,
// what allocation we have. Extends the promoter record.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Contact = { id: string; name: string; role: string | null; email: string | null; phone: string | null; instagram: string | null; notes: string | null; is_primary: boolean };

const STATES: [string, string][] = [
  ['none', 'Never contacted'], ['contacted', 'Contacted'], ['responding', 'Responding'],
  ['supplying', 'Supplying places'], ['partner', 'Partner'], ['declined', 'Declined'],
];

export function PromoterRelationship({ promoterId, initial, contacts }: {
  promoterId: string;
  initial: { contactEmail: string; contactPhone: string; relationshipStatus: string; relationshipNotes: string; standardAllocation: string; allocationNotes: string };
  contacts: Contact[];
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [c, setC] = useState({ name: '', role: '', email: '', phone: '', instagram: '', notes: '' });
  const [showContact, setShowContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function post(body: Record<string, unknown>) {
    setBusy(true); setErr(''); setMsg('');
    const r = await fetch(`/api/admin/promoters/${promoterId}/relationship`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? 'Failed'); return false; }
    router.refresh();
    return true;
  }

  return (
    <div>
      <form className="deskForm" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: 'update', ...v })) setMsg('Saved.'); }}>
        <label>Relationship</label>
        <select value={v.relationshipStatus} onChange={(e) => setV({ ...v, relationshipStatus: e.target.value })}>
          {STATES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="row">
          <div><label>Main email</label><input value={v.contactEmail} onChange={(e) => setV({ ...v, contactEmail: e.target.value })} /></div>
          <div><label>Main phone</label><input value={v.contactPhone} onChange={(e) => setV({ ...v, contactPhone: e.target.value })} /></div>
        </div>
        <label>Standing allocation (the goal)</label>
        <input value={v.standardAllocation} onChange={(e) => setV({ ...v, standardAllocation: e.target.value })} placeholder="e.g. 4 places on the list every Saturday" />
        <label>Allocation notes</label>
        <input value={v.allocationNotes} onChange={(e) => setV({ ...v, allocationNotes: e.target.value })} placeholder="How to use it, who to tell, cut-off times" />
        <label>Relationship notes</label>
        <textarea rows={3} value={v.relationshipNotes} onChange={(e) => setV({ ...v, relationshipNotes: e.target.value })} />
        {err && <div className="formError">{err}</div>}
        {msg && <div className="formOk">{msg}</div>}
        <div style={{ marginTop: 10 }}><button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Save'}</button></div>
      </form>

      <div className="sectionLabel" style={{ marginTop: 14 }}>Contacts</div>
      {contacts.length === 0 && <p className="adminSub" style={{ marginBottom: 8 }}>Nobody’s number yet. That’s the first job.</p>}
      {contacts.map((x) => (
        <div className="attentionRow" key={x.id}>
          <span>
            <b>{x.name}</b>{x.is_primary && ' ★'}{x.role && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}> · {x.role}</span>}
            <div style={{ fontSize: 12.5 }}>
              {x.email && <a href={`mailto:${x.email}`} style={{ textDecoration: 'underline', marginRight: 10 }}>{x.email}</a>}
              {x.phone && <a href={`tel:${x.phone}`} style={{ textDecoration: 'underline', marginRight: 10 }}>{x.phone}</a>}
              {x.instagram && <span style={{ marginRight: 10 }}>{x.instagram}</span>}
              {x.notes && <span style={{ color: 'var(--text-faint)' }}>{x.notes}</span>}
            </div>
          </span>
          <button className="btnGhost" style={{ padding: '4px 10px', fontSize: 10.5 }} onClick={() => post({ action: 'remove_contact', contactId: x.id })} disabled={busy}>Remove</button>
        </div>
      ))}
      {showContact ? (
        <form className="deskForm" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: 'add_contact', ...c, isPrimary: contacts.length === 0 })) { setC({ name: '', role: '', email: '', phone: '', instagram: '', notes: '' }); setShowContact(false); } }}>
          <div className="row">
            <div><label>Name</label><input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} required /></div>
            <div><label>Role</label><input value={c.role} onChange={(e) => setC({ ...c, role: e.target.value })} placeholder="Promoter, door manager…" /></div>
          </div>
          <div className="row">
            <div><label>Email</label><input value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
            <div><label>Phone / WhatsApp</label><input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></div>
          </div>
          <div className="row">
            <div><label>Instagram</label><input value={c.instagram} onChange={(e) => setC({ ...c, instagram: e.target.value })} placeholder="@handle" /></div>
            <div><label>Notes</label><input value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Add contact'}</button>
            <button className="btnGhost" type="button" onClick={() => setShowContact(false)}>Close</button>
          </div>
        </form>
      ) : (
        <button className="btnGhost" style={{ marginTop: 8, padding: '6px 12px', fontSize: 11 }} onClick={() => setShowContact(true)}>+ Add contact</button>
      )}
    </div>
  );
}
