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
  | 'heat_card_click'
  // V2C
  | 'recommendation_impression'
  | 'recommendation_click'
  | 'event_hidden'
  | 'event_not_for_me'
  | 'taste_updated'
  | 'history_added'
  | 'scene_entity_added'
  | 'scene_people_impression'
  | 'member_profile_viewed'
  | 'connection_requested'
  | 'connection_accepted'
  | 'travel_plan_created'
  | 'city_followed'
  | 'email_queued'
  | 'email_rec_clicked'
  // V2D
  | 'alert_created'
  | 'email_sent'
  | 'email_failed'
  | 'email_unsubscribed'
  | 'notification_clicked'
  // V2E
  | 'archive_viewed'
  | 'archive_item_viewed'
  | 'i_was_there_added'
  | 'i_was_there_removed'
  | 'archive_contribution'
  | 'archive_correction'
  | 'memory_added'
  | 'archive_to_event_click'
  | 'archive_search'
  // V2F
  | 'close_friend_marked'
  | 'close_friend_unmarked'
  | 'announcement_created'
  | 'announcement_sent'
  | 'announcement_clicked'
  | 'promoter_followers_viewed'
  // V2H
  | 'ask_question'
  | 'ask_feedback';

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
