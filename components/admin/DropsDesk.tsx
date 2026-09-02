'use client';

// Drops and good causes, written by hand.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/drops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, ...j } as { ok: boolean; error?: string };
}

export type DropForm = { id?: string; title: string; body: string; eventId: string; linkUrl: string; places: string; startsAt: string; endsAt: string; status: string };
export const EMPTY_DROP: DropForm = { title: '', body: '', eventId: '', linkUrl: '', places: '', startsAt: '', endsAt: '', status: 'draft' };

export function DropEditor({ initial, onDone }: { initial: DropForm; onDone?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toLocal = (s: string) => (s ? new Date(s).toISOString().slice(0, 16) : '');
  return (
    <form className="deskForm" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr('');
      const r = await post({ action: 'save_drop', ...v, startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : null, endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : null });
      setBusy(false); if (!r.ok) { setErr(r.error ?? 'Failed'); return; } router.refresh(); onDone?.();
    }}>
      <label>Title</label><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required placeholder="Two places on the list for Saturday" />
      <label>Details</label><textarea rows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
      <div className="row">
        <div><label>Event id (optional)</label><input value={v.eventId} onChange={(e) => setV({ ...v, eventId: e.target.value })} placeholder="uuid from /admin/events" /></div>
        <div><label>Link (optional)</label><input value={v.linkUrl} onChange={(e) => setV({ ...v, linkUrl: e.target.value })} placeholder="https://…" /></div>
      </div>
      <div className="row">
        <div><label>Places (blank = unlimited)</label><input type="number" min={0} value={v.places} onChange={(e) => setV({ ...v, places: e.target.value })} /></div>
        <div><label>Status</label><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="draft">Draft</option><option value="live">Live</option><option value="closed">Closed</option></select></div>
      </div>
      <div className="row">
        <div><label>Starts</label><input type="datetime-local" value={toLocal(v.startsAt)} onChange={(e) => setV({ ...v, startsAt: e.target.value })} /></div>
        <div><label>Ends</label><input type="datetime-local" value={toLocal(v.endsAt)} onChange={(e) => setV({ ...v, endsAt: e.target.value })} /></div>
      </div>
      {err && <div className="formError">{err}</div>}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Save drop'}</button>
        {onDone && <button className="btnGhost" type="button" onClick={onDone}>Close</button>}
      </div>
    </form>
  );
}

export type CauseForm = { id?: string; title: string; summary: string; body: string; imageUrl: string; linkUrl: string; status: string; sortOrder: string };
export const EMPTY_CAUSE: CauseForm = { title: '', summary: '', body: '', imageUrl: '', linkUrl: '', status: 'draft', sortOrder: '0' };

export function CauseEditor({ initial, onDone }: { initial: CauseForm; onDone?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <form className="deskForm" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr('');
      const r = await post({ action: 'save_cause', ...v, sortOrder: Number(v.sortOrder) });
      setBusy(false); if (!r.ok) { setErr(r.error ?? 'Failed'); return; } router.refresh(); onDone?.();
    }}>
      <label>Project</label><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required />
      <label>One line</label><input value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} />
      <label>What it is, honestly</label><textarea rows={4} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
      <div className="row">
        <div><label>Image URL</label><input value={v.imageUrl} onChange={(e) => setV({ ...v, imageUrl: e.target.value })} /></div>
        <div><label>Link</label><input value={v.linkUrl} onChange={(e) => setV({ ...v, linkUrl: e.target.value })} /></div>
      </div>
      <div className="row">
        <div><label>Status</label><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="draft">Draft</option><option value="live">Live</option><option value="completed">Completed</option><option value="archived">Archived</option></select></div>
        <div><label>Order</label><input type="number" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} /></div>
      </div>
      {err && <div className="formError">{err}</div>}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Save project'}</button>
        {onDone && <button className="btnGhost" type="button" onClick={onDone}>Close</button>}
      </div>
    </form>
  );
}

export function Editable<T extends { id?: string }>({ label, initial, Editor }: { label: string; initial: T; Editor: (p: { initial: T; onDone?: () => void }) => React.ReactElement }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btnGhost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={() => setOpen(true)}>{label}</button>;
  return <div style={{ flexBasis: '100%' }}><Editor initial={initial} onDone={() => setOpen(false)} /></div>;
}
