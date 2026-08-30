'use client';

// YOUR MEMORY OF THIS NIGHT — short human memories, author-controlled.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Memory = {
  id: string;
  body: string;
  display_name: string;
  member_id: string;
  created_at: string;
};

export function MemoryPanel({
  archiveEventId, memories, meId, isSignedIn,
}: {
  archiveEventId: string;
  memories: Memory[];
  meId: string | null;
  isSignedIn: boolean;
}) {
  const router = useRouter();
  const mine = memories.find((m) => m.member_id === meId);
  const [draft, setDraft] = useState(mine?.body ?? '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!draft.trim() || busy) return;
    setBusy(true);
    await fetch('/api/archive/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveEventId, body: draft.trim() }),
    }).catch(() => {});
    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  async function remove(memoryId: string) {
    await fetch('/api/archive/memories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memoryId }),
    }).catch(() => {});
    setDraft('');
    router.refresh();
  }

  async function report(memoryId: string) {
    setReported((prev) => new Set(prev).add(memoryId));
    await fetch('/api/archive/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportMemoryId: memoryId }),
    }).catch(() => {});
  }

  return (
    <section className="memoryPanel">
      <div className="sectionLabel">Memories of this night</div>
      {memories.length === 0 && (
        <p className="youPanelSub">No memories yet — were you in the room?</p>
      )}
      {memories.map((m) => (
        <div className="memoryRow" key={m.id}>
          <div className="memoryBody">“{m.body}”</div>
          <div className="memoryMeta">
            {m.display_name}
            {m.member_id === meId ? (
              <>
                {' · '}<button className="recHide" type="button" onClick={() => { setEditing(true); setDraft(m.body); }}>edit</button>
                {' · '}<button className="recHide" type="button" onClick={() => remove(m.id)}>delete</button>
              </>
            ) : (
              <>
                {' · '}
                <button className="recHide" type="button" disabled={reported.has(m.id)}
                        onClick={() => report(m.id)}>
                  {reported.has(m.id) ? 'reported' : 'report'}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {(!mine || editing) && (
        <form className="memoryForm" onSubmit={save}>
          <textarea
            placeholder="Your memory of this night… (“First time I heard Inner City Life on that system…”)"
            value={draft} maxLength={500} rows={2}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btnGhost" type="submit" disabled={busy || !draft.trim()}>
            {mine ? 'Update memory' : 'Add memory'}
          </button>
        </form>
      )}
    </section>
  );
}
