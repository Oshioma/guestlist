import { query } from './db';

export type AnalyticsEventType =
  | 'event_viewed'
  | 'event_saved'
  | 'event_unsaved'
  | 'interested'
  | 'going'
  | 'rsvp_cleared'
  | 'ticket_clicked'
  | 'event_shared'
  | 'promoter_viewed'
  | 'genre_selected'
  | 'location_selected'
  | 'event_submitted'
  // Club Messenger
  | 'clubmessenger_open'
  | 'clubmessenger_event_open'
  | 'presence_started'
  | 'presence_ended'
  | 'presence_visibility_changed'
  | 'friend_arrival_seen'
  | 'friend_arrival_clicked'
  | 'ping_sent'
  | 'ping_response'
  | 'live_room_open'
  | 'room_message_sent'
  | 'going_from_clubmessenger'
  | 'event_click_from_clubmessenger'
  | 'ticket_click_from_clubmessenger'
  | 'heat_card_click';

export async function track(
  type: AnalyticsEventType,
  opts: {
    memberId?: string | null;
    anonId?: string | null;
    eventId?: string | null;
    promoterId?: string | null;
    genreId?: string | null;
    path?: string | null;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    await query(
      `insert into analytics_events
         (event_type, member_id, anon_id, event_id, promoter_id, genre_id, path, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        type,
        opts.memberId ?? null,
        opts.anonId ?? null,
        opts.eventId ?? null,
        opts.promoterId ?? null,
        opts.genreId ?? null,
        opts.path ?? null,
        JSON.stringify(opts.metadata ?? {}),
      ]
    );
  } catch (err) {
    // Analytics must never break a user-facing flow.
    console.error('analytics track failed', err);
  }
}
