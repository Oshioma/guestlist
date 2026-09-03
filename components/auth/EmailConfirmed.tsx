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
//
// And it does not stop at "well done". Somebody who has just finished joining
// is the most willing they will ever be to do the next thing, so the line
// carries the two: where are you going, and what have you already been to.

import { useEffect, useState } from 'react';
import Link from 'next/link';

export function EmailConfirmed() {
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
      {/* Same words either way. Somebody double-tapping the link in their
          email has not done anything that needs a different sentence. */}
      <span className="confirmedText">
        <strong>Account confirmed</strong>
        {', now '}
        <Link href="/clubmessenger">where are you going tonight?</Link>
        {' Add a memory to the archive '}
        <Link href="/archive/add">here</Link>.
      </span>
      <button type="button" className="confirmedClose" onClick={() => setShow(false)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
