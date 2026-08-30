'use client';

import { useState } from 'react';
import { track } from '@/lib/track';

export function ShareButton({ eventId, title }: { eventId: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    track('event_shared', { eventId });
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* user dismissed — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <button className="btnGhost" style={{ width: '100%' }} onClick={share} type="button">
      {copied ? 'Link copied ✓' : 'Share'}
    </button>
  );
}
