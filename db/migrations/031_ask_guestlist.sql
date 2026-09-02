-- ASK GUESTLIST — request any event.
--
-- GET ME IN asks for an event already on Guestlist. ASK GUESTLIST is the
-- wider member service: "I found this somewhere else — can you get me in?",
-- "+1?", "sold out — help?", "where should I go?". Same pipeline, same desk,
-- same promoter flywheel; the request row simply no longer needs an event.
--
--   • request_type / origin / context are plain text validated in code, so
--     a new kind of ask never needs a migration.
--   • An external event lives in its own 1:1 row so the demand signal (URL,
--     host, venue, city, artist) survives linking and can be counted.
--   • decline_reason becomes outcome_reason with the fuller internal list.
--     Members still only ever see the friendly states.
--   • 'answered' closes advice-type requests: HERE'S WHAT WE THINK.

alter table member_access_requests alter column event_id drop not null;
alter table member_access_requests add column if not exists request_type text not null default 'event_access';
alter table member_access_requests add column if not exists origin text not null default 'get_me_in';
alter table member_access_requests add column if not exists context text;
alter table member_access_requests add column if not exists suggested_event_id uuid references events(id) on delete set null;
alter table member_access_requests add column if not exists match_confidence text;
alter table member_access_requests add column if not exists linked_by_member_id uuid references members(id) on delete set null;
alter table member_access_requests add column if not exists linked_at timestamptz;

alter table member_access_requests drop constraint member_access_requests_status_check;
alter table member_access_requests add constraint member_access_requests_status_check
  check (status in (
    'requested', 'reviewing', 'contacting_promoter',
    'confirmed_free', 'discounted', 'purchased_by_guestlist',
    'waitlisted', 'unavailable', 'cancelled', 'attended', 'answered'
  ));

-- Why it did not happen, in full. No check constraint: the list is code's.
alter table member_access_requests drop constraint member_access_requests_decline_reason_check;
alter table member_access_requests rename column decline_reason to outcome_reason;
update member_access_requests set outcome_reason = 'promoter_no_response' where outcome_reason = 'no_response';
update member_access_requests set outcome_reason = 'request_too_late' where outcome_reason = 'too_late';
update member_access_requests set outcome_reason = 'member_cancelled' where status = 'cancelled' and outcome_reason is null;

create index if not exists idx_access_requests_origin on member_access_requests(origin, status);
create index if not exists idx_access_requests_type on member_access_requests(request_type);
create index if not exists idx_access_requests_suggested on member_access_requests(suggested_event_id)
  where suggested_event_id is not null;

create table if not exists member_request_external_events (
  request_id uuid primary key references member_access_requests(id) on delete cascade,
  url text,
  -- Host + path, no scheme, no www, no query, no trailing slash: the form
  -- everything is matched on.
  url_normalised text,
  url_host text,
  name text,
  venue_name text,
  city text,
  country text,
  starts_at timestamptz,
  timezone text,
  ticket_price_pence integer check (ticket_price_pence is null or ticket_price_pence >= 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  lineup text,
  notes text,
  -- Set by the desk's CREATE/IMPORT, which runs the existing submission
  -- pipeline. Nothing is imported because a member pasted a link.
  import_submission_id uuid references event_submissions(id) on delete set null,
  created_event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_request_external_url on member_request_external_events(url_normalised)
  where url_normalised is not null;
create index if not exists idx_request_external_host on member_request_external_events(url_host)
  where url_host is not null;
create index if not exists idx_request_external_city on member_request_external_events(city)
  where city is not null;

alter table member_request_external_events enable row level security;
revoke all on table member_request_external_events from anon, authenticated;
grant select, insert, update, delete on table member_request_external_events to service_role, supabase_admin;

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
  'membership_page_viewed', 'membership_waitlist_joined', 'membership_checkout_started',
  'membership_started', 'membership_renewed', 'membership_payment_failed',
  'membership_cancelled', 'membership_expired', 'membership_portal_opened',
  'get_me_in_viewed', 'get_me_in_requested', 'get_me_in_guestlisted',
  'get_me_in_decided', 'get_me_in_cancelled',
  'promoter_contacted',
  'market_viewed', 'market_business_viewed', 'market_offer_claimed', 'market_offer_redeemed',
  'market_business_applied', 'market_business_decided',
  'member_drop_viewed', 'member_drop_claimed',
  -- ASK GUESTLIST
  'ask_guestlist_opened', 'ask_guestlist_submitted', 'external_event_requested',
  'external_event_linked', 'external_event_created', 'plus_one_requested',
  'sold_out_help_requested', 'recommendation_requested',
  'ask_guestlist_fulfilled', 'ask_guestlist_declined'
));
