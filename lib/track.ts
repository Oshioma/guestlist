// Client-side analytics helper. Fire-and-forget; never blocks navigation.

export type ClientTrackType =
  | 'event_viewed'
  | 'event_shared'
  | 'promoter_viewed'
  | 'genre_selected'
  | 'location_selected'
  // Club Messenger view/UI events (actions stay server-side, unspoofable)
  | 'clubmessenger_open'
  | 'clubmessenger_event_open'
  | 'live_room_open'
  | 'friend_arrival_seen'
  | 'friend_arrival_clicked'
  | 'event_click_from_clubmessenger'
  | 'heat_card_click'
  // V2C view/UI events
  | 'member_profile_viewed'
  | 'scene_people_impression'
  | 'recommendation_click'
  | 'email_rec_clicked'
  | 'notification_clicked'
  | 'archive_viewed'
  | 'archive_item_viewed'
  | 'archive_to_event_click'
  // Membership + Market page views
  | 'membership_page_viewed'
  | 'get_me_in_viewed'
  | 'market_viewed'
  | 'market_business_viewed'
  | 'member_drop_viewed'
  | 'ask_guestlist_opened'
  // Balance
  | 'retreat_clicked';

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

// Who sent them, and nothing else about it.
//
// document.referrer is a full URL, and a full URL is a confession: which
// Instagram post, which search, which private page somebody had open before
// they got here. The hostname alone answers "where did they come from" and
// carries none of that, so the hostname is all that leaves the browser.
//
// Our own pages are dropped — a member walking from /events to a night is not
// a traffic source, and counting them would drown the real ones.
function referrerHost(): string | null {
  try {
    const raw = document.referrer;
    if (!raw) return null;
    const host = new URL(raw).hostname.replace(/^www\./, '');
    return host === window.location.hostname.replace(/^www\./, '') ? null : host.slice(0, 120);
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
      referrerHost: referrerHost(),
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
