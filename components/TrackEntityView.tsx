'use client';

import { useEffect } from 'react';
import { track, type ClientTrackType } from '@/lib/track';

export function TrackEntityView({
  type,
  ids,
}: {
  type: ClientTrackType;
  ids: Record<string, string>;
}) {
  useEffect(() => {
    track(type, ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, JSON.stringify(ids)]);
  return null;
}
