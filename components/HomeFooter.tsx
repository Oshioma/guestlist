'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function HomeFooter({ isSignedIn, isAdmin }: { isSignedIn: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const qs = new URLSearchParams({ url: value, importError: data.error || 'Import failed' });
        router.push(`/events/submit/manual?${qs.toString()}`);
        return;
      }
      if (data.outcome === 'duplicate') {
        setMessage(data.message || 'We already have that event on our radar.');
        return;
      }
      if (isAdmin && data.eventId) {
        router.push(`/admin/events/${data.eventId}`);
        return;
      }
      setMessage(data.message || 'Thanks — your event has been submitted for review.');
      setUrl('');
    } catch {
      const qs = new URLSearchParams({ url: value, importError: 'Import failed' });
      router.push(`/events/submit/manual?${qs.toString()}`);
    } finally {
      setBusy(false);
    }
  }

  const articleHref = isSignedIn ? '/articles/new' : '/login?next=/articles/new';
  const manualHref = isSignedIn ? '/events/submit/manual' : '/login?next=/events/submit/manual';

  return (
    <footer className="siteFooter" style={{ marginTop: 44 }}>
      <section style={{ padding: '26px 0', borderBottom: '1px solid var(--border)' }}>
        <div className="homeKicker">ADD AN EVENT</div>
        <h3 style={{ margin: '6px 0' }}>Know something we’re missing?</h3>
        <p style={{ margin: '0 0 14px', color: 'var(--text-muted)' }}>
          Paste the event or ticket link and we’ll do the rest.
        </p>
        <form onSubmit={submit} className="urlRow" style={{ maxWidth: 760 }}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            aria-label="Event or ticket link"
            required
          />
          <button className="btnAccent" type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'ADD EVENT'}
          </button>
        </form>
        {message && <p style={{ margin: '12px 0 0', color: 'var(--text-muted)' }}>{message}</p>}
        <div style={{ marginTop: 10 }}>
          <Link href={manualHref} className="btnGhost">Add manually</Link>
        </div>
      </section>

      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', padding: '22px 0 10px' }} aria-label="Guestlist footer">
        <Link href={articleHref}>Add article</Link>
        <Link href="/events">Events</Link>
        <Link href="/balance">Balance</Link>
        <Link href="/terms">Terms &amp; Conditions</Link>
        <Link href="/privacy">Privacy Policy</Link>
        <a href="mailto:info@guestlist.net">info@guestlist.net</a>
      </nav>
      <div style={{ paddingBottom: 22, color: 'var(--text-muted)' }}>
        Guestlist — the best events for our community, not every event.
      </div>
    </footer>
  );
}
