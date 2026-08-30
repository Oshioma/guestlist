'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SOURCE_TYPES } from '@/lib/util';

type Opt = { id: string; name: string };

export function AddSourceForm({ promoters, venues }: { promoters: Opt[]; venues: Opt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/admin/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        url: form.get('url'),
        sourceType: form.get('sourceType'),
        promoterId: form.get('promoterId') || null,
        venueId: form.get('venueId') || null,
        notes: form.get('notes') || null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({})))?.error ?? 'Failed to add source');
    }
  }

  return (
    <div style={{ marginBottom: 26 }}>
      {!open ? (
        <button className="btnAccent" onClick={() => setOpen(true)} type="button">+ Add Source</button>
      ) : (
        <form className="formCard" style={{ margin: '0 0 10px', maxWidth: 560 }} onSubmit={onSubmit}>
          <label htmlFor="s-name">Source name *</label>
          <input id="s-name" name="name" required placeholder="e.g. Fabric — what's on" />
          <label htmlFor="s-url">URL *</label>
          <input id="s-url" name="url" type="url" required placeholder="https://…" />
          <label htmlFor="s-type">Type *</label>
          <select id="s-type" name="sourceType" required defaultValue="promoter_website">
            {SOURCE_TYPES.filter((t) => !['member_submission', 'manual'].includes(t.value)).map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label htmlFor="s-promoter">Linked promoter</label>
              <select id="s-promoter" name="promoterId" defaultValue="">
                <option value="">— none —</option>
                {promoters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="s-venue">Linked venue</label>
              <select id="s-venue" name="venueId" defaultValue="">
                <option value="">— none —</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>
          <label htmlFor="s-notes">Notes</label>
          <input id="s-notes" name="notes" />
          <div className="formError">{error}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button className="btnAccent" disabled={busy} type="submit">{busy ? 'Adding…' : 'Add source'}</button>
            <button className="btnGhost" onClick={() => setOpen(false)} type="button">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
