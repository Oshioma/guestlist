'use client';

// Fire one client analytics event on mount (page-open style events).

import { useEffect } from 'react';
import { track, type ClientTrackType } from '@/lib/track';

export function ClubTrack({ type, eventId }: { type: ClientTrackType; eventId?: string }) {
  useEffect(() => {
    track(type, eventId ? { eventId } : {});
  }, [type, eventId]);
  return null;
}
