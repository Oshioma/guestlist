// Client-side analytics helper. Fire-and-forget; never blocks navigation.

export type ClientTrackType =
  | 'event_viewed'
  | 'event_shared'
  | 'promoter_viewed'
  | 'genre_selected'
  | 'location_selected';

// Stable anonymous id (per browser) so unique-viewer counts work without
// accounts. Random UUID, no fingerprinting.
function anonId(): string | null {
  try {
    let id = localStorage.getItem('gl_anon');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('gl_anon', id);
    }
    return id;
  } catch {
    return null;
  }
}

export function track(type: ClientTrackType, metadata: Record<string, unknown> = {}) {
  try {
    const body = JSON.stringify({
      type,
      metadata,
      eventId: (metadata.eventId as string) ?? null,
      promoterId: (metadata.promoterId as string) ?? null,
      anonId: anonId(),
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
