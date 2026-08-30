'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type GenreOpt = { slug: string; name: string; parent_name: string | null };

export function GenreSuggestionRow({
  term,
  occurrences,
  avgConfidence,
  events,
  genres,
}: {
  term: string;
  occurrences: number;
  avgConfidence: string | null;
  events: { title: string; slug: string | null }[];
  genres: GenreOpt[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // A cheap closest-match hint: taxonomy entries sharing a token with the term.
  const tokens = term.split(/\s+/);
  const hint = genres.find((g) =>
    tokens.some((t) => t.length > 3 && g.name.toLowerCase().includes(t))
  );

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/genre-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term, ...body }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? 'Failed');
  }

  const parents = genres.filter((g) => !g.parent_name);

  return (
    <div className="reviewCard" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
      <div>
        <h3 style={{ textTransform: 'capitalize' }}>
          “{term}”
          <span className="confidencePill" style={{ marginLeft: 10 }}>
            ×{occurrences}{avgConfidence ? ` · avg ${avgConfidence}%` : ''}
          </span>
          {hint && (
            <span className="evChip amber" style={{ marginLeft: 8 }}>closest: {hint.name}</span>
          )}
        </h3>
        <div className="facts">
          {events.slice(0, 4).map((e, i) =>
            e.slug ? (
              <span key={i}>
                <Link href={`/events/${e.slug}`} style={{ textDecoration: 'underline' }}>{e.title}</Link>
              </span>
            ) : (
              <span key={i}>{e.title}</span>
            )
          )}
          {events.length > 4 && <span>+{events.length - 4} more</span>}
        </div>
        {creating && (
          <form
            style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act({ action: 'create', name: f.get('name'), parentSlug: f.get('parent') || null });
            }}
          >
            <input name="name" defaultValue={term} required
                   style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                            borderRadius: 999, color: 'var(--text)', padding: '7px 14px', fontSize: 13 }} />
            <select name="parent" defaultValue={hint && !hint.parent_name ? hint.slug : ''}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                             borderRadius: 999, color: 'var(--text-soft)', padding: '7px 12px', fontSize: 12.5 }}>
              <option value="">Top-level genre</option>
              {parents.map((p) => <option key={p.slug} value={p.slug}>Subgenre of {p.name}</option>)}
            </select>
            <button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Create genre'}</button>
            <button className="btnGhost" onClick={() => setCreating(false)} type="button">Cancel</button>
          </form>
        )}
        {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</div>}
      </div>
      {!creating && (
        <div className="actions">
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={target} onChange={(e) => setTarget(e.target.value)}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                             borderRadius: 999, color: 'var(--text-soft)', padding: '6px 10px', fontSize: 12, maxWidth: 170 }}>
              <option value="">Map to…</option>
              {genres.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.parent_name ? `${g.parent_name} — ${g.name}` : g.name}
                </option>
              ))}
            </select>
            <button className="btnAccent" style={{ padding: '6px 12px', fontSize: 11 }}
                    disabled={busy || !target} onClick={() => act({ action: 'map', genreSlug: target })} type="button">
              Map
            </button>
          </div>
          <button className="btnGhost" style={{ padding: '6px 12px', fontSize: 11 }}
                  onClick={() => setCreating(true)} disabled={busy} type="button">
            Create genre
          </button>
          <button className="btnGhost" style={{ padding: '6px 12px', fontSize: 11 }}
                  onClick={() => act({ action: 'dismiss' })} disabled={busy} type="button">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
