'use client';

// SHARING A NIGHT, OR A PIECE.
//
// The old share control was one grey button in a sidebar that said "Share",
// and pressing it opened the phone's share sheet or quietly copied the link.
// On a laptop — where nobody has a share sheet — that meant the only thing it
// ever did was copy, silently, and you had to guess where to paste it.
//
// This says where it is going before you press it. WhatsApp because that is
// how a night actually gets passed around, then X, then Facebook, then a copy
// button that tells you it worked. On a phone the sheet comes first, because
// the sheet is the only route to Instagram, Signal, Messages and AirDrop and
// they matter more than any of the four.
//
// Every button records the share against the thing shared. A promoter's
// dashboard already counts shares, and a share is the strongest signal there
// is — somebody putting their own name behind a night in front of their
// friends.

import { useEffect, useState } from 'react';
import { track } from '@/lib/track';

type Props = {
  /** Absolute, because everything here hands the URL to somewhere else. */
  url: string;
  title: string;
  /** A line of context for the message body — the date and city, or the standfirst. */
  blurb?: string;
  /** Events feed promoter analytics; articles do not. */
  eventId?: string;
  label?: string;
};

const Icon = {
  share: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5v11M12 3.5 8.2 7.3M12 3.5l3.8 3.8" />
      <path d="M5.5 12.5v6a1.6 1.6 0 0 0 1.6 1.6h9.8a1.6 1.6 0 0 0 1.6-1.6v-6" />
    </svg>
  ),
  whatsapp: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.6 2 2.2 6.4 2.2 11.84c0 1.74.46 3.44 1.32 4.94L2.1 22l5.36-1.4a9.8 9.8 0 0 0 4.58 1.16h.01c5.43 0 9.84-4.4 9.84-9.84 0-2.63-1.02-5.1-2.88-6.96A9.77 9.77 0 0 0 12.04 2Zm0 18a8.2 8.2 0 0 1-4.16-1.14l-.3-.18-3.1.81.83-3.02-.2-.31a8.13 8.13 0 0 1-1.25-4.32c0-4.5 3.67-8.16 8.18-8.16a8.1 8.1 0 0 1 5.77 2.4 8.1 8.1 0 0 1 2.39 5.77c0 4.5-3.67 8.15-8.16 8.15Zm4.48-6.1c-.25-.13-1.45-.71-1.67-.79-.23-.08-.39-.13-.55.12-.17.25-.64.79-.78.95-.14.17-.29.19-.53.06-.25-.12-1.04-.38-1.97-1.22-.73-.65-1.22-1.45-1.37-1.7-.14-.24-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.55-1.33-.76-1.82-.2-.47-.4-.41-.55-.42h-.47c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05 0 1.2.88 2.37 1 2.53.13.17 1.74 2.65 4.2 3.72.59.25 1.05.4 1.4.52.6.19 1.14.16 1.56.1.48-.07 1.45-.59 1.66-1.17.2-.57.2-1.06.14-1.16-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.53 3h3.02l-6.6 7.54L21.7 21h-6.06l-4.75-6.2L5.46 21H2.44l7.05-8.06L2.3 3h6.2l4.3 5.68L17.53 3Zm-1.06 16.17h1.67L7.6 4.74H5.81l10.66 14.43Z" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.91h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94Z" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2.4" />
      <path d="M15 5.6A1.6 1.6 0 0 0 13.4 4H6a2 2 0 0 0-2 2v7.4A1.6 1.6 0 0 0 5.6 15" />
    </svg>
  ),
  tick: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  ),
};

export function ShareRow({ url, title, blurb, eventId, label = 'Share this' }: Props) {
  const [copied, setCopied] = useState(false);
  // Rendered on the server too, where there is no navigator — so the sheet
  // button appears after mount, on the devices that actually have one.
  const [canSheet, setCanSheet] = useState(false);
  useEffect(() => { setCanSheet(typeof navigator !== 'undefined' && !!navigator.share); }, []);

  const line = blurb ? `${title} — ${blurb}` : title;
  const record = (via: string) => {
    // A share of an article carries no eventId, so it lands as a plain
    // recorded share rather than polluting an event's numbers.
    track('event_shared', eventId ? { eventId } : {});
    void via;
  };

  const enc = encodeURIComponent;
  const links: { key: string; href: string; label: string; icon: React.ReactNode }[] = [
    { key: 'whatsapp', label: 'WhatsApp', icon: Icon.whatsapp, href: `https://wa.me/?text=${enc(`${line}\n${url}`)}` },
    { key: 'x', label: 'X', icon: Icon.x, href: `https://twitter.com/intent/tweet?text=${enc(line)}&url=${enc(url)}` },
    { key: 'facebook', label: 'Facebook', icon: Icon.facebook, href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
  ];

  async function sheet() {
    record('sheet');
    try {
      await navigator.share({ title, text: blurb ?? undefined, url });
    } catch {
      // Dismissing the sheet is a decision, not a failure. Nothing to say.
    }
  }

  async function copy() {
    record('copy');
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // A browser that refuses the clipboard still has the address bar.
    }
  }

  return (
    <div className="shareRow">
      <span className="shareRowLabel">{label}</span>
      <div className="shareRowBtns">
        {canSheet && (
          <button type="button" className="shareBtn sheet" onClick={sheet} title="Share…" aria-label="Share">
            {Icon.share}
          </button>
        )}
        {links.map((l) => (
          <a
            key={l.key}
            className={`shareBtn ${l.key}`}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Share on ${l.label}`}
            aria-label={`Share on ${l.label}`}
            onClick={() => record(l.key)}
          >
            {l.icon}
          </a>
        ))}
        <button
          type="button"
          className={`shareBtn copy${copied ? ' done' : ''}`}
          onClick={copy}
          title="Copy link"
          aria-label={copied ? 'Link copied' : 'Copy link'}
        >
          {copied ? Icon.tick : Icon.copy}
        </button>
        {/* Said in words as well as in the icon: a tick alone is a guess. */}
        <span className={`shareCopied${copied ? ' on' : ''}`} role="status">Link copied</span>
      </div>
    </div>
  );
}
