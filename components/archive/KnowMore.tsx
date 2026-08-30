'use client';

// I KNOW MORE ABOUT THIS — corrections queue, never direct edits.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const FIELDS: [string, string][] = [
  ['date', 'The date'], ['venue', 'The venue'], ['promoter', 'The promoter'],
  ['lineup', 'The lineup'], ['title', 'The name'], ['story', 'The story / context'],
  ['image', 'A missing image'], ['other', 'Something else'],
];

export function KnowMore({ archiveEventId, isSignedIn }: { archiveEventId: string; isSignedIn: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState('other');
  const [suggestion, setSuggestion] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!suggestion.trim() || busy) return;
    setBusy(true);
    const res = await fetch('/api/archive/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveEventId, field, suggestion: suggestion.trim() }),
    });
    setBusy(false);
    if (res.ok) setDone(true);
  }

  if (done) {
    return <div className="youNotice">Thank you — the team checks every correction before history changes.</div>;
  }
  return (
    <div className="knowMore">
      <button className="btnGhost" type="button" onClick={() => setOpen((o) => !o)}>
        I know more about this
      </button>
      {open && (
        <form className="knowMoreForm" onSubmit={submit}>
          <select value={field} onChange={(e) => setField(e.target.value)}>
            {FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <textarea
            placeholder="What do you know? Sources welcome."
            value={suggestion} maxLength={1000} rows={3}
            onChange={(e) => setSuggestion(e.target.value)}
          />
          <button className="btnAccent" type="submit" disabled={busy || !suggestion.trim()}>Send</button>
        </form>
      )}
    </div>
  );
}
