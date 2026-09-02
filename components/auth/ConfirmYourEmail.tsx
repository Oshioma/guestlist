'use client';

// "IS THAT ADDRESS REAL?" — asked once a visit, until they answer.
//
// The same shape as the city ask, and for the same reason: it matters, it is
// one tap, and nagging every page load would be worse than not asking. What
// is different is the tone. Nobody has done anything wrong by not having
// clicked a link yet, and Guestlist still works for them — so this says what
// confirming BUYS rather than what not confirming costs.

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const KEY = 'gl_verify_prompt_dismissed';
// Where the ask would be in the way: the page that answers it, and the pages
// somebody is in the middle of something on.
const QUIET = ['/verify', '/login', '/signup', '/reset', '/forgot'];

export function ConfirmYourEmail() {
  const pathname = usePathname();
  const [show, setShow] = useState(true);
  const [sent, setSent] = useState('');

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY)) setShow(false);
    } catch {
      // A browser that will not give us session storage still gets asked;
      // being asked twice is a smaller problem than never being asked.
    }
  }, []);

  if (!show || QUIET.some((p) => pathname?.startsWith(p))) return null;

  async function resend() {
    setSent('Sending…');
    const res = await fetch('/api/auth/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    setSent(res.ok
      ? 'Sent — check your inbox, and your spam folder if it is not there.'
      : (data.error ?? 'Could not send that. Try again shortly.'));
  }

  function dismiss() {
    try { sessionStorage.setItem(KEY, '1'); } catch { /* asked again next visit */ }
    setShow(false);
  }

  return (
    <div className="cityPrompt" role="status">
      <span>
        Confirm your email and your profile goes live — other members can find you,
        and you show up in your city.
      </span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btnAccent" onClick={resend} style={{ fontSize: 12 }}>
          Send me the link
        </button>
        <button type="button" className="btnGhost" onClick={dismiss} style={{ fontSize: 12 }}>
          Not now
        </button>
      </span>
      {sent && <span style={{ fontSize: 12 }}>{sent}</span>}
    </div>
  );
}
