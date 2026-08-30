'use client';

import { useEffect } from 'react';
import { track } from '@/lib/track';

export function TrackView({ eventId, src }: { eventId: string; src?: string | null }) {
  useEffect(() => {
    track('event_viewed', { eventId, ...(src ? { src } : {}) });
  }, [eventId, src]);
  return null;
}
