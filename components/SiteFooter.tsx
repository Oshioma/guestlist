'use client';

// THE FOOTER — on every page, not only the homepage.
//
// It carries the one thing Guestlist most needs from a visitor ("know
// something we're missing?") and the links a site is expected to have. Both
// were only ever on the front page, which is the page somebody is least
// likely to be on when they think of a night we have not got.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

// The Archive is its own world — a wall of flyers and memories, browsed
// rather than navigated. The footer's "add a night that's on" ask has nothing
// to do with 1996, so it stays out of the way there.
const NO_FOOTER = [/^\/archive(\/|$)/];

// The admin desk keeps the footer but loses the ask. "Know something we're
// missing? Paste the link" is an invitation to the public; showing it to the
// person who runs the place, underneath the queue of events they are already
// reviewing, is the site talking to itself. The links below it still earn
// their place — add an article, terms, the contact address.
const NO_ADD_BOX = [/^\/admin(\/|$)/];

export function SiteFooter({ isSignedIn, isAdmin }: { isSignedIn: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function sendToManual(value: string, error: string) {
    const qs = new URLSearchParams({ url: value, importError: error });
    router.push(`/events/submit/manual?${qs.toString()}`);
  }

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
        sendToManual(value, data.error || 'Import failed');
        return;
      }
      if (data.outcome === 'checking') {
        sendToManual(value, 'We could not read enough event information from that page automatically.');
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
      sendToManual(value, 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  if (NO_FOOTER.some((re) => re.test(pathname))) return null;

  const articleHref = isSignedIn ? '/articles/new' : '/login?next=/articles/new';
  const manualHref = isSignedIn ? '/events/submit/manual' : '/login?next=/events/submit/manual';

  return (
    <footer className="siteFooter">
      <div className="wrap">
      {/* The ask runs the full width of the page: it is the most useful thing
          on the footer, and it was sitting in half a column beside the links.
          Not on the admin desk, though — see NO_ADD_BOX. */}
      {!NO_ADD_BOX.some((re) => re.test(pathname)) && (
      <section className="siteFooterAdd">
        <div className="homeKicker">ADD AN EVENT</div>
        <h3 style={{ margin: '6px 0' }}>Know something we’re missing?</h3>
        <p style={{ margin: '0 0 14px', color: 'var(--text-muted)' }}>
          Paste the event or ticket link and we’ll do the rest.
        </p>
        <form onSubmit={submit} className="urlRow">
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
      </section>
      )}

      <nav className="siteFooterNav" aria-label="Guestlist footer">
        <Link href={articleHref}>Add article</Link>
        {/* Filling the form in by hand lives next to writing a piece by hand —
            both are the "I'll do it myself" route, and neither belongs as a
            second button under the paste-a-link box. */}
        <Link href={manualHref}>Add event</Link>
        <Link href="/events">Events</Link>
        <Link href="/balance">Balance</Link>
        <Link href="/terms">Terms &amp; Conditions</Link>
        <Link href="/privacy">Privacy Policy</Link>
        <a href="mailto:info@guestlist.net">info@guestlist.net</a>
      </nav>
      <div className="siteFooterLine">
        Guestlist — the best events for our community, not every event.
      </div>
      </div>
    </footer>
  );
}
