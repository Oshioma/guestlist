'use client';

// WHAT IS THIS ARTICLE ABOUT? — attach the nights a piece covers, so the
// article shows up on their pages and they show up on its.
//
// Many-to-many by design: a festival preview covers several nights, and a
// night can carry both a preview and a review.

import { useCallback, useEffect, useState } from 'react';

type LinkedEvent = {
  id: string; slug: string; title: string; start_at: string;
  city: string | null; status: string;
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function EventLinker({ articleId, editable }: { articleId: string; editable: boolean }) {
  const [linked, setLinked] = useState<LinkedEvent[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LinkedEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (search: string) => {
    try {
      const res = await fetch(`/api/articles/${articleId}/events?q=${encodeURIComponent(search)}`);
      if (!res.ok) return;
      const data = await res.json();
      setLinked(data.linked ?? []);
      setResults(data.results ?? []);
    } catch { /* the picker is an extra, never the reason a draft is unusable */ }
  }, [articleId]);

  useEffect(() => { load(''); }, [load]);

  // Search as you type, but not on every keystroke.
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  async function save(next: LinkedEvent[]) {
    setBusy(true);
    setError('');
    const previous = linked;
    setLinked(next); // optimistic: the list is the thing being edited
    try {
      const res = await fetch(`/api/articles/${articleId}/events`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventIds: next.map((e) => e.id) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save');
      setLinked((await res.json()).linked ?? next);
    } catch (e) {
      setLinked(previous);
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const add = (e: LinkedEvent) => {
    if (linked.some((l) => l.id === e.id)) return;
    save([...linked, e]);
    setQ('');
    setResults([]);
  };

  return (
    <div className="eventLinker">
      <label>Events this piece is about</label>
      <p className="eventLinkerNote">
        Linked nights show this article on their page, and appear on yours once it is published.
      </p>

      {linked.length > 0 && (
        <ul className="eventLinkerList">
          {linked.map((e) => (
            <li key={e.id}>
              <span>
                <strong>{e.title}</strong>
                <span className="eventLinkerMeta">
                  {when(e.start_at)}{e.city ? ` · ${e.city}` : ''}
                  {e.status !== 'live' && ' · not published yet'}
                </span>
              </span>
              {editable && (
                <button type="button" onClick={() => save(linked.filter((l) => l.id !== e.id))}
                        disabled={busy} aria-label={`Unlink ${e.title}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <>
          <input
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            placeholder="Search events by name…"
            disabled={busy}
          />
          {results.length > 0 && (
            <ul className="eventLinkerResults">
              {results.filter((r) => !linked.some((l) => l.id === r.id)).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => add(r)} disabled={busy}>
                    <strong>{r.title}</strong>
                    <span className="eventLinkerMeta">
                      {when(r.start_at)}{r.city ? ` · ${r.city}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && results.length === 0 && (
            <p className="eventLinkerNote">No events match “{q}”.</p>
          )}
        </>
      )}
      {error && <p className="formError">{error}</p>}
    </div>
  );
}
