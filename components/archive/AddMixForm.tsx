'use client';

// Paste a link, we do the rest — the player is embedded on Guestlist.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AddMixForm({
  archiveEventId,
  sceneEntityId,
  label = '+ Add a mix from this night',
  isSignedIn,
}: {
  archiveEventId?: string;
  sceneEntityId?: string;
  label?: string;
  isSignedIn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) return null;
  if (note) return <p className="youPanelSub">✓ {note}</p>;

  if (!open) {
    return (
      <button className="btnGhost" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/archive/mixes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveEventId, sceneEntityId, url, title, artist }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNote(data.note ?? 'Added.');
        router.refresh();
      } else {
        setError(data.error ?? 'Something went wrong');
      }
    } catch {
      setError('Could not reach the server — try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="youProfileForm" onSubmit={submit} style={{ maxWidth: 480 }}>
      <input placeholder="Mixcloud, SoundCloud or YouTube link" value={url} required
             onChange={(e) => setUrl(e.target.value)} />
      <div className="youNewGrid">
        <input placeholder="Mix title (Doc Scott — 3am set)" value={title} required maxLength={120}
               onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Artist (optional)" value={artist} maxLength={120}
               onChange={(e) => setArtist(e.target.value)} />
      </div>
      {error && <div className="formError">{error}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btnAccent" type="submit" disabled={busy || title.trim().length < 2 || !url.trim()}>
          {busy ? 'Adding…' : 'Add mix'}
        </button>
        <button className="btnGhost" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
