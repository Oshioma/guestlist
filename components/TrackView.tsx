'use client';

import { useEffect } from 'react';
import { track } from '@/lib/track';

export function TrackView({ eventId }: { eventId: string }) {
  useEffect(() => {
    track('event_viewed', { eventId });
  }, [eventId]);
  return null;
}
