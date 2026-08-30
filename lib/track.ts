// Client-side analytics helper. Fire-and-forget; never blocks navigation.

export type ClientTrackType =
  | 'event_viewed'
  | 'event_shared'
  | 'promoter_viewed'
  | 'genre_selected'
  | 'location_selected';

export function track(type: ClientTrackType, metadata: Record<string, unknown> = {}) {
  try {
    const body = JSON.stringify({
      type,
      metadata,
      eventId: (metadata.eventId as string) ?? null,
      path: window.location.pathname,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
    }
  } catch {
    /* never let analytics break the page */
  }
}
