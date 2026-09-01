'use client';

import Link from 'next/link';
import { useState } from 'react';

export function ManualEventSubmissionForm({ initialUrl, importError }: { initialUrl: string; importError: string }) {
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
      <>
        <p className="adminSub">{message}</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
          <Link href="/events" className="btnAccent">Browse events →</Link>
          <Link href="/events/submit/manual" className="btnGhost">Add another</Link>
        </div>
      </>
    );
  }

  return (
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
  );
}
