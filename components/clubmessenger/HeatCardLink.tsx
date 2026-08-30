'use client';

// Card wrapper that records the tap (heat_card_click + event open
// attribution) before navigating to the event's live room.

import Link from 'next/link';
import { track } from '@/lib/track';

export function HeatCardLink({ eventId, children }: { eventId: string; children: React.ReactNode }) {
  return (
    <Link
      href={`/clubmessenger/events/${eventId}`}
      className="clubEventCardLink"
      onClick={() => {
        track('heat_card_click', { eventId });
        track('event_click_from_clubmessenger', { eventId });
      }}
    >
      {children}
    </Link>
  );
}
