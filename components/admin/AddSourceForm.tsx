'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SOURCE_TYPES } from '@/lib/util';
import { GenrePicker, type GenreOpt } from '@/components/admin/GenrePicker';

type Opt = { id: string; name: string };

export function AddSourceForm({
  promoters, venues, genres, countries,
}: {
  promoters: Opt[];
  venues: Opt[];
  genres: GenreOpt[];
  countries: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [genreIds, setGenreIds] = useState<string[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          url: form.get('url'),
          sourceType: form.get('sourceType'),
          promoterId: form.get('promoterId') || null,
          venueId: form.get('venueId') || null,
          city: form.get('city') || null,
          country: form.get('country') || null,
          genreIds,
          notes: form.get('notes') || null,
        }),
      });
      if (res.ok) {
        setOpen(false);
        setGenreIds([]);
        router.refresh();
      } else {
        setError((await res.json().catch(() => ({})))?.error ?? 'Failed to add source');
      }
    } catch {
      setError('Could not reach the server — try again');
    } finally {
      setBusy(false);
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
              <label htmlFor="s-city">City</label>
              <input id="s-city" name="city" placeholder="e.g. London" maxLength={80} />
            </div>
            <div>
              <label htmlFor="s-country">Country</label>
              <input id="s-country" name="country" placeholder="e.g. United Kingdom" maxLength={80} list="s-countries" />
              <datalist id="s-countries">
                {countries.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>
          <label>Genres</label>
          <GenrePicker genres={genres} selected={genreIds} onChange={setGenreIds} />
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
