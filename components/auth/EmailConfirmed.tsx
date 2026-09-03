'use client';

// "EMAIL CONFIRMED" — SAID ON THE WAY PAST, NOT ON A PAGE OF ITS OWN.
//
// They pressed a button in an email and landed on the front page. This is the
// line that tells them it worked, sitting above everything for as long as it
// takes to read, and then gone.
//
// It takes the query string out of the address bar on arrival, so a refresh or
// a shared link does not congratulate somebody a second time — or congratulate
// a stranger who was sent the URL.

import { useEffect, useState } from 'react';

export function EmailConfirmed({ kind }: { kind: 'new' | 'already' }) {
  const [show, setShow] = useState(true);

  useEffect(() => {
    // The banner is the record of what happened; the URL does not need to be.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('confirmed');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch { /* an address bar we cannot rewrite changes nothing that matters */ }
  }, []);

  if (!show) return null;

  return (
    <div className="confirmedBanner" role="status">
      <span className="confirmedTick" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 12.5l5 5 10-11" />
        </svg>
      </span>
      <span className="confirmedText">
        <strong>{kind === 'already' ? 'Already confirmed' : 'Email confirmed'}</strong>
        {' — your profile is live and other members can find you.'}
      </span>
      <button type="button" className="confirmedClose" onClick={() => setShow(false)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
