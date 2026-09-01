'use client';

// "WHERE ARE YOU?" — the one thing Guestlist needs and cannot work out.
//
// Everything that puts local events first reads a member's resolved place.
// A member without one is, as far as the site is concerned, nowhere: their
// Tonight is the whole world at once. Most of them have simply never been
// asked, because the field was optional and unexplained when they joined.
//
// So it asks, once per visit, until they set one. "Not now" hides it for
// this visit only — the next visit asks again, because the question does not
// stop mattering, and it is one tap to answer.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const KEY = 'gl_city_prompt_dismissed';
// Places where the ask would be in the way: they are already asking, or the
// member is in the middle of something.
const QUIET = [/^\/you/, /^\/login/, /^\/signup/, /^\/reset/, /^\/forgot/, /^\/admin/, /^\/promoter/];

export function SetYourCity() {
  const pathname = usePathname() ?? '';
  // Shown by default and hidden once we know it was dismissed. The other way
  // round means a member with JavaScript off is never asked at all, and the
  // question is the whole point.
  const [show, setShow] = useState(true);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === '1') setShow(false);
    } catch { /* storage blocked — asking twice beats never asking */ }
  }, []);

  if (!show || QUIET.some((re) => re.test(pathname))) return null;

  return (
    <div className="cityPrompt">
      <span>
        <strong>Where are you?</strong> Set your city and Guestlist puts what’s on
        near you at the top — of Tonight, and everywhere else.
      </span>
      <span className="cityPromptActions">
        <Link href="/you#places" className="btnAccent">Set your city</Link>
        <button
          type="button"
          className="btnGhost"
          onClick={() => {
            try { sessionStorage.setItem(KEY, '1'); } catch { /* fine */ }
            setShow(false);
          }}
        >
          Not now
        </button>
      </span>
    </div>
  );
}
