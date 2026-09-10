-- 041: a sign-in is worth counting, and nothing was counting it.
--
-- auth_sessions looked like a sign-in log and is not one: a row is deleted on
-- sign-out and again on a password reset, so counting it answers "how many
-- people are signed in right now", never "how many signed in last week".
--
-- So the login route records an event like everything else does. Signing UP is
-- already answerable from members.created_at, all the way back, so it does not
-- need one.

alter table analytics_events drop constraint analytics_events_event_type_check;
alter table analytics_events add constraint analytics_events_event_type_check check (event_type in (
  'event_viewed', 'event_saved', 'event_unsaved', 'interested', 'going', 'rsvp_cleared',
  'ticket_clicked', 'event_shared', 'promoter_viewed', 'genre_selected', 'location_selected',
  'event_submitted', 'clubmessenger_open', 'clubmessenger_event_open', 'presence_started',
  'presence_ended', 'presence_visibility_changed', 'friend_arrival_seen', 'friend_arrival_clicked',
  'ping_sent', 'ping_response', 'live_room_open', 'room_message_sent', 'going_from_clubmessenger',
  'event_click_from_clubmessenger', 'ticket_click_from_clubmessenger', 'heat_card_click',
  'recommendation_impression', 'recommendation_click', 'event_hidden', 'event_not_for_me',
  'taste_updated', 'history_added', 'scene_entity_added', 'scene_people_impression',
  'member_profile_viewed', 'connection_requested', 'connection_accepted', 'travel_plan_created',
  'city_followed', 'email_queued', 'email_rec_clicked', 'alert_created', 'email_sent',
  'email_failed', 'email_unsubscribed', 'notification_clicked', 'archive_viewed',
  'archive_item_viewed', 'i_was_there_added', 'i_was_there_removed', 'archive_contribution',
  'archive_correction', 'memory_added', 'archive_to_event_click', 'archive_search',
  'close_friend_marked', 'close_friend_unmarked', 'announcement_created', 'announcement_sent',
  'announcement_clicked', 'promoter_followers_viewed',
  'ask_question', 'ask_feedback',
  'membership_page_viewed', 'membership_waitlist_joined', 'membership_waitlist_invited', 'membership_checkout_started',
  'membership_started', 'membership_renewed', 'membership_payment_failed',
  'membership_cancelled', 'membership_expired', 'membership_portal_opened',
  'get_me_in_viewed', 'get_me_in_requested', 'get_me_in_guestlisted',
  'get_me_in_decided', 'get_me_in_cancelled',
  'promoter_contacted',
  'market_viewed', 'market_business_viewed', 'market_offer_claimed', 'market_offer_redeemed',
  'market_business_applied', 'market_business_decided',
  'member_drop_viewed', 'member_drop_claimed',
  'retreat_clicked',
  -- Who came back.
  'signed_in',
  'ask_guestlist_opened', 'ask_guestlist_submitted', 'external_event_requested',
  'external_event_linked', 'external_event_created', 'plus_one_requested',
  'sold_out_help_requested', 'recommendation_requested',
  'ask_guestlist_fulfilled', 'ask_guestlist_declined'
));

-- The desk reads this table by day across a window; without this it is a
-- sequential scan of every row on every page load.
create index if not exists idx_analytics_created on analytics_events(created_at desc);
