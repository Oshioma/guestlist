-- 040: retreats — the things on Balance that are not articles.
--
-- Balance is where the site stops shouting. Alongside the writing there is a
-- second kind of thing worth putting in front of people: a week somewhere
-- quiet. It is an advert, and it is honest about being one — the card sends
-- you to the retreat's own site, because that is where you book.
--
-- Deliberately NOT an event. An event has one start time, a city, a lineup,
-- a guestlist, a reminder email and a "who's going". A retreat has none of
-- those: it runs in seasons, or monthly, or whenever there are six of you,
-- and saying so in words ("Monthly, October to April") is more truthful than
-- inventing a date so it fits a column that demands one.

create table if not exists retreats (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  -- Where, as people say it: "Zanzibar, Tanzania".
  location text,
  -- When, in words, because retreats rarely publish a single date.
  when_text text,
  blurb text,
  image_url text,
  -- Where the card sends you. The whole point of the thing.
  url text not null,
  price_text text,
  status text not null default 'draft' check (status in ('draft', 'live', 'hidden')),
  sort_order int not null default 0,
  -- The link an admin pasted, kept even when url is later edited by hand.
  source_url text,
  created_by_member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_retreats_live on retreats(sort_order, created_at desc) where status = 'live';

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
  -- Balance
  'retreat_clicked',
  -- ASK GUESTLIST
  'ask_guestlist_opened', 'ask_guestlist_submitted', 'external_event_requested',
  'external_event_linked', 'external_event_created', 'plus_one_requested',
  'sold_out_help_requested', 'recommendation_requested',
  'ask_guestlist_fulfilled', 'ask_guestlist_declined'
));
