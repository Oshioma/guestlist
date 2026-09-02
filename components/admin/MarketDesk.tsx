'use client';

// Market desk controls: decide on a business, add one by hand, feature /
// order / note, manage its team.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, ...j } as { ok: boolean; error?: string; id?: string; slug?: string };
}

export function BusinessDecision({ businessId, status }: { businessId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  async function decide(decision: string) {
    setBusy(true);
    const r = await post({ action: 'decide', businessId, decision, note });
    setBusy(false);
    if (r.ok) { setAsking(null); setNote(''); router.refresh(); }
  }
  return (
    <div>
      <div className="deskActions" style={{ margin: 0 }}>
        {status !== 'approved' && status !== 'rejected' && <button className="btnAccent" disabled={busy} onClick={() => decide('approve')}>Approve</button>}
        {status === 'paused' && <button className="btnAccent" disabled={busy} onClick={() => decide('resume')}>Resume</button>}
        {status === 'approved' && <button className="btnGhost" disabled={busy} onClick={() => setAsking('pause')}>Pause</button>}
        {(status === 'applied' || status === 'pending' || status === 'invited') && <button className="btnGhost" disabled={busy} onClick={() => setAsking('reject')}>Reject</button>}
        {status === 'rejected' && <button className="btnGhost" disabled={busy} onClick={() => decide('approve')}>Approve after all</button>}
      </div>
      {asking && (
        <form className="deskForm" onSubmit={(e) => { e.preventDefault(); decide(asking); }}>
          <label>Note to the business (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button className="btnAccent" disabled={busy} type="submit">{asking === 'pause' ? 'Pause' : 'Reject'}</button>
            <button className="btnGhost" type="button" onClick={() => setAsking(null)}>Back</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function CreateBusiness({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: '', tagline: '', categoryId: '', city: '', country: '', website: '', ownerEmail: '', approve: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await post({ action: 'create', business: v, ownerEmail: v.ownerEmail, approve: v.approve });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
    router.push(`/admin/market/${r.id}`);
  }
  if (!open) return <button className="btnAccent" onClick={() => setOpen(true)}>+ Add a business</button>;
  return (
    <form className="deskForm" style={{ maxWidth: 600 }} onSubmit={submit}>
      <label>Business name</label><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
      <label>One line</label><input value={v.tagline} onChange={(e) => setV({ ...v, tagline: e.target.value })} />
      <div className="row">
        <div><label>Category</label>
          <select value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
            <option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div><label>Website</label><input value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></div>
      </div>
      <div className="row">
        <div><label>City</label><input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} /></div>
        <div><label>Country</label><input value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })} /></div>
      </div>
      <label>Owner’s Guestlist email (optional — gives them the portal, status “invited”)</label>
      <input type="email" value={v.ownerEmail} onChange={(e) => setV({ ...v, ownerEmail: e.target.value })} />
      <label><input type="checkbox" checked={v.approve} onChange={(e) => setV({ ...v, approve: e.target.checked })} style={{ width: 'auto', marginRight: 8 }} />Approve straight away</label>
      {err && <div className="formError">{err}</div>}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Create'}</button>
        <button className="btnGhost" type="button" onClick={() => setOpen(false)}>Close</button>
      </div>
    </form>
  );
}

export function BusinessControls({ businessId, featured, sortOrder, adminNotes }: { businessId: string; featured: boolean; sortOrder: number; adminNotes: string }) {
  const router = useRouter();
  const [v, setV] = useState({ featured, sortOrder: String(sortOrder), adminNotes });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <form className="deskForm" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg('');
      const r = await post({ action: 'update', businessId, business: { featured: v.featured, sortOrder: Number(v.sortOrder), adminNotes: v.adminNotes } });
      setBusy(false); if (r.ok) { setMsg('Saved.'); router.refresh(); }
    }}>
      <div className="row">
        <div><label>Featured</label>
          <select value={v.featured ? 'yes' : 'no'} onChange={(e) => setV({ ...v, featured: e.target.value === 'yes' })}><option value="no">No</option><option value="yes">Featured</option></select></div>
        <div><label>Display order (low first)</label><input type="number" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} /></div>
      </div>
      <label>Admin notes</label><textarea rows={3} value={v.adminNotes} onChange={(e) => setV({ ...v, adminNotes: e.target.value })} />
      {msg && <div className="formOk">{msg}</div>}
      <div style={{ marginTop: 8 }}><button className="btnAccent" disabled={busy} type="submit">Save</button></div>
    </form>
  );
}

export function TeamControls({ businessId, team }: { businessId: string; team: { member_id: string; display_name: string; email: string; role: string }[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('owner');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div>
      {team.map((t) => (
        <div className="attentionRow" key={t.member_id}>
          <span><b>{t.display_name}</b> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{t.email} · {t.role}</span></span>
          <button className="btnGhost" style={{ padding: '4px 10px', fontSize: 10.5 }} disabled={busy} onClick={async () => { setBusy(true); await post({ action: 'remove_member', businessId, memberId: t.member_id }); setBusy(false); router.refresh(); }}>Remove</button>
        </div>
      ))}
      <form className="deskForm" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        const r = await post({ action: 'add_member', businessId, email, role });
        setBusy(false); if (!r.ok) { setErr(r.error ?? 'Failed'); return; } setEmail(''); router.refresh();
      }}>
        <div className="row">
          <div><label>Guestlist account email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><label>Role</label><select value={role} onChange={(e) => setRole(e.target.value)}><option value="owner">Owner</option><option value="editor">Editor</option></select></div>
        </div>
        {err && <div className="formError">{err}</div>}
        <div style={{ marginTop: 8 }}><button className="btnGhost" disabled={busy} type="submit">Give portal access</button></div>
      </form>
    </div>
  );
}
