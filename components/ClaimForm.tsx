'use client';

import { useState } from 'react';
import Link from 'next/link';

export function ClaimForm({
  promoterId,
  promoterName,
  promoterSlug,
  promoterWebsite,
  memberEmail,
}: {
  promoterId: string;
  promoterName: string;
  promoterSlug: string;
  promoterWebsite: string | null;
  memberEmail: string;
}) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('busy');
    setError('');
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/promoters/${promoterId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: f.get('name'), role: f.get('role'), email: f.get('email'),
        phone: f.get('phone'), website: f.get('website'), notes: f.get('notes'),
      }),
    });
    if (res.ok) {
      setStatus('done');
    } else {
      setStatus('idle');
      setError((await res.json().catch(() => ({})))?.error ?? 'Something went wrong');
    }
  }

  if (status === 'done') {
    return (
      <div className="formCard" style={{ textAlign: 'center' }}>
        <h1>Claim received</h1>
        <div className="sub" style={{ marginTop: 10 }}>
          Thanks — the Guestlist team will review your claim on {promoterName}.
          We may follow up on the email you provided.
        </div>
        <Link className="btnGhost" href={`/promoters/${promoterSlug}`}>Back to profile</Link>
      </div>
    );
  }

  return (
    <form className="formCard" onSubmit={onSubmit}>
      <h1>Run {promoterName}?</h1>
      <div className="sub">
        Claim this profile to manage its events, connect your website and see
        your Guestlist analytics. Using an email on your official domain
        {promoterWebsite ? ` (${promoterWebsite.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')})` : ''}{' '}
        speeds up verification — but it isn’t required.
      </div>
      <label htmlFor="c-name">Your name *</label>
      <input id="c-name" name="name" required autoComplete="name" />
      <label htmlFor="c-role">Your role</label>
      <input id="c-role" name="role" placeholder="e.g. Founder, Promotions manager" />
      <label htmlFor="c-email">Work email *</label>
      <input id="c-email" name="email" type="email" required defaultValue={memberEmail} />
      <label htmlFor="c-phone">Phone (optional)</label>
      <input id="c-phone" name="phone" autoComplete="tel" />
      <label htmlFor="c-website">Promoter website</label>
      <input id="c-website" name="website" type="url" defaultValue={promoterWebsite ?? ''} placeholder="https://…" />
      <label htmlFor="c-notes">Anything that helps us verify you</label>
      <textarea id="c-notes" name="notes" rows={3} placeholder="Links, socials, who to contact…" />
      <div className="formError">{error}</div>
      <button className="btnAccent" style={{ width: '100%', marginTop: 6 }} disabled={status === 'busy'} type="submit">
        {status === 'busy' ? 'Sending…' : 'Claim this profile →'}
      </button>
    </form>
  );
}
