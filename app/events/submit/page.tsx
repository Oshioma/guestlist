'use client';

// + ADD EVENT — paste a link and we take care of the rest.
// The URL goes into the ingestion pipeline (event_submissions → draft event
// → admin review). Nothing goes live without review.

import { useState } from 'react';

export default function SubmitEventPage() {
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const url = new FormData(e.currentTarget).get('url');
    setStatus('busy');
    setMessage('');
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus('done');
      setMessage(data.message ?? 'Got it — thank you.');
    } else {
      setStatus('error');
      setMessage(data.error ?? 'Something went wrong. Try again.');
    }
  }

  return (
    <main className="wrap">
      <div className="submitHero">
        <h1>Know a night we’re missing?</h1>
        <p className="sub">
          Paste the event link and we’ll take care of the rest — dates, lineup,
          venue, the lot. Our team reviews everything before it goes live.
        </p>
        {status === 'done' ? (
          <div className="joinPrompt" style={{ fontSize: 15 }}>
            {message}
            <div style={{ marginTop: 16 }}>
              <button className="btnGhost" onClick={() => { setStatus('idle'); setMessage(''); }} type="button">
                Add another
              </button>
            </div>
          </div>
        ) : (
          <form className="urlRow" onSubmit={onSubmit}>
            <input
              name="url"
              type="url"
              required
              placeholder="https://…"
              aria-label="Event link"
            />
            <button className="btnAccent" disabled={status === 'busy'} type="submit">
              {status === 'busy' ? 'Adding…' : 'Add to Guestlist →'}
            </button>
          </form>
        )}
        {status === 'error' && <div className="formError" style={{ marginTop: 14 }}>{message}</div>}
      </div>
    </main>
  );
}
