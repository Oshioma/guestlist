'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function ManualEventSubmissionPage() {
  const searchParams = useSearchParams();
  const initialUrl = searchParams.get('url') ?? '';
  const importError = searchParams.get('importError') ?? '';
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('busy');
    setMessage('');
    const form = new FormData(e.currentTarget);
    const payload = {
      manual: true,
      url: String(form.get('url') ?? '').trim(),
      title: String(form.get('title') ?? '').trim(),
      date: String(form.get('date') ?? '').trim(),
      venue: String(form.get('venue') ?? '').trim(),
      city: String(form.get('city') ?? '').trim(),
      notes: String(form.get('notes') ?? '').trim(),
      importError,
    };

    const response = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (!response) {
      setStatus('error');
      setMessage('Could not submit that right now. Please try again.');
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus('error');
      setMessage(data.error || 'Could not submit that right now. Please try again.');
      return;
    }

    setStatus('done');
    setMessage(data.message || 'Thanks — we have the details and will review them.');
  }

  if (status === 'done') {
    return (
      <main className="wrap" style={{ maxWidth: 760, paddingTop: 48, paddingBottom: 72 }}>
        <div className="homeKicker">ADD AN EVENT</div>
        <h1>Thanks — we’ve got it.</h1>
        <p className="adminSub">{message}</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
          <Link href="/events" className="btnAccent">Browse events →</Link>
          <Link href="/events/submit/manual" className="btnGhost">Add another</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap" style={{ maxWidth: 760, paddingTop: 48, paddingBottom: 72 }}>
      <div className="homeKicker">ADD AN EVENT</div>
      <h1>Add it manually</h1>
      <p className="adminSub" style={{ maxWidth: 650 }}>
        {importError
          ? `We couldn’t read that page automatically (${importError}). Add the key details below and it will go into the same Guestlist review queue.`
          : 'Add the key details below and it will go into the Guestlist review queue.'}
      </p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 14, marginTop: 24 }}>
        <label>
          <span className="adminSub">Event or ticket URL</span>
          <input name="url" type="url" required defaultValue={initialUrl} placeholder="https://…" style={{ width: '100%', marginTop: 6 }} />
        </label>
        <label>
          <span className="adminSub">Event name</span>
          <input name="title" required placeholder="Event name" style={{ width: '100%', marginTop: 6 }} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
          <label>
            <span className="adminSub">Date</span>
            <input name="date" type="date" style={{ width: '100%', marginTop: 6 }} />
          </label>
          <label>
            <span className="adminSub">City</span>
            <input name="city" placeholder="City" style={{ width: '100%', marginTop: 6 }} />
          </label>
        </div>
        <label>
          <span className="adminSub">Venue</span>
          <input name="venue" placeholder="Venue" style={{ width: '100%', marginTop: 6 }} />
        </label>
        <label>
          <span className="adminSub">Anything else we should know?</span>
          <textarea name="notes" rows={4} placeholder="Line-up, promoter, ticket info, corrections…" style={{ width: '100%', marginTop: 6 }} />
        </label>
        {status === 'error' && <div className="formError">{message}</div>}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="submit" className="btnAccent" disabled={status === 'busy'}>
            {status === 'busy' ? 'Sending…' : 'Send for review →'}
          </button>
          <Link href="/events/submit" className="btnGhost">Try link import again</Link>
        </div>
      </form>
    </main>
  );
}
