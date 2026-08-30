'use client';

// Polling refresh for Club Messenger pages. Realtime for V1 is deliberately
// simple: the server components re-render on router.refresh(), so counts and
// people stay current without a socket layer. Swap path: Supabase Realtime
// channels on event_presence / event_room_messages.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
