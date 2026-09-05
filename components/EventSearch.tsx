'use client';

// SEARCHING THE LISTINGS.
//
// The filters answer "show me a kind of night". They cannot answer "what was
// that thing at Corsica in November", which is the other half of how anybody
// uses a listings site — you half-remember a name, a room, or a DJ, and you
// want that one thing.
//
// It writes ?q= and leaves every other parameter alone, so a search inside
// This Weekend stays inside This Weekend. Submitting is deliberate rather
// than searching on every keystroke: each change is a server round trip and a
// full page of results, and a list that reshuffles under your fingers while
// you are still typing is worse than pressing return.

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function EventSearch({ initial = '', placeholder = 'Search events, venues, cities, DJs…' }: {
  initial?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Back and forward have to move the box too, or it shows a search that is
  // no longer the one on screen.
  useEffect(() => { setQ(initial); }, [initial]);

  function go(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    const next = value.trim();
    if (next) params.set('q', next);
    else params.delete('q');
    const qs = params.toString();
    router.push(qs ? `?${qs}` : '?', { scroll: false });
  }

  return (
    <form
      className="eventSearch"
      role="search"
      onSubmit={(e) => { e.preventDefault(); inputRef.current?.blur(); go(q); }}
    >
      <span className="eventSearchIcon" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" />
        </svg>
      </span>
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label="Search events"
        maxLength={120}
      />
      {q && (
        <button type="button" className="eventSearchClear" onClick={() => { setQ(''); go(''); }} aria-label="Clear search">
          ×
        </button>
      )}
      <button type="submit" className="eventSearchGo">Search</button>
    </form>
  );
}
