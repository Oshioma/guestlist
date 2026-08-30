-- V2F: CLOSE FRIENDS + PROMOTER FOLLOWER TOOLS.
--
-- Close friends: ONE relationship system. The V2D tier column was audited
-- and found pair-level — it cannot express the required ONE-WAY, PRIVATE
-- close-friend preference ("Oshi marks Sarah; Sarah never needs to know").
-- It evolves in place into two directional flags on the SAME row. No new
-- relationship table, no mutual requirement, no public badge.
--
-- Promoter follower tools: verified promoters reach followers through
-- Guestlist's own V2D delivery machinery. Promoters NEVER receive member
-- contact data. Announcements are structured (event + update type + short
-- note), capped centrally, audited, and admin-pausable.

-- ---------------------------------------------------------------------------
-- 1. Close friends — directional flags replace the pair-level tier.
-- ---------------------------------------------------------------------------

alter table member_connections
  add column requester_close boolean not null default false,
  add column addressee_close boolean not null default false;

-- The V2D tier column never had UI, but migrate any value faithfully:
-- a pair-level close_friend becomes close in both directions.
update member_connections
   set requester_close = true, addressee_close = true
 where tier = 'close_friend';

alter table member_connections drop column tier;

-- ---------------------------------------------------------------------------
-- 2. Promoter announcements — structured, event-centric, capped, audited.
-- ---------------------------------------------------------------------------

alter table promoters add column announcements_paused boolean not null default false;

create table promoter_announcements (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references promoters(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  created_by uuid references members(id) on delete set null,
  update_type text not null check (update_type in
    ('new_event', 'lineup_update', 'tickets_on_sale', 'final_tickets',
     'sold_out', 'date_change', 'venue_change', 'event_cancelled', 'event_update')),
  -- The promoter's optional note: short, plain text, no links, no HTML.
  note text check (note is null or char_length(note) <= 280),
  -- Audience targeting is a NAMED strategy, computed by Guestlist at send
  -- time — never a member list. ('all' | 'near_event' | 'genre_match' | 'city')
  audience text not null default 'all' check (audience in
    ('all', 'near_event', 'genre_match', 'city')),
  audience_location_id uuid references locations(id) on delete set null,
  status text not null default 'draft' check (status in
    ('draft', 'scheduled', 'queued', 'sending', 'sent', 'blocked', 'cancelled')),
  scheduled_for timestamptz,        -- null = send on next processing run
  preview jsonb not null default '{}', -- aggregate audience snapshot at queue time
  delivered_inapp integer not null default 0,
  delivered_email integer not null default 0,
  blocked_reason text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index promoter_announcements_promoter_idx
  on promoter_announcements(promoter_id, created_at desc);
create index promoter_announcements_due_idx
  on promoter_announcements(status)
  where status in ('queued', 'scheduled', 'sending');

-- Every action on the channel is audited: who, what, when.
create table promoter_announcement_audit (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid references promoter_announcements(id) on delete set null,
  promoter_id uuid not null references promoters(id) on delete cascade,
  actor_member_id uuid references members(id) on delete set null,
  action text not null check (action in
    ('created', 'edited', 'scheduled', 'queued', 'cancelled', 'sent',
     'blocked', 'admin_pause', 'admin_unpause', 'admin_caps_changed')),
  detail text,
  created_at timestamptz not null default now()
);

create index promoter_announcement_audit_promoter_idx
  on promoter_announcement_audit(promoter_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Delivery plumbing: notification type + per-announcement dedupe.
-- ---------------------------------------------------------------------------

alter table notifications add column announcement_id uuid
  references promoter_announcements(id) on delete cascade;

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'friend_arrived', 'friend_pinged_you', 'event_room_message',
    'event_alert', 'event_reminder', 'connection_going', 'close_friend_going',
    'travel_digest', 'city_digest', 'promoter_review',
    'archive_activity', 'promoter_announcement'
  ));

-- One in-app delivery per member per announcement, ever.
create unique index notifications_announcement_dedupe_idx
  on notifications(member_id, announcement_id)
  where type = 'promoter_announcement' and announcement_id is not null;

-- Close-friend going mirrors the connection-going dedupe.
create unique index notifications_close_friend_going_dedupe_idx
  on notifications(member_id, actor_member_id, event_id)
  where type = 'close_friend_going';

-- ---------------------------------------------------------------------------
-- 4. Member preferences — few, understandable.
-- ---------------------------------------------------------------------------

-- Close-friend event activity: on (in-app + email per alert rules),
-- digest (in-app + daily digest only, never instant email), off.
alter table member_email_prefs add column close_friend_activity text not null default 'on'
  check (close_friend_activity in ('on', 'digest', 'off'));

-- Promoter announcements: email (email + in-app), inapp (default), off.
alter table member_email_prefs add column promoter_announcements text not null default 'inapp'
  check (promoter_announcements in ('email', 'inapp', 'off'));

-- ---------------------------------------------------------------------------
-- 5. Analytics vocabulary.
-- ---------------------------------------------------------------------------

alter table analytics_events drop constraint analytics_events_event_type_check;
alter table analytics_events add constraint analytics_events_event_type_check
  check (event_type in (
    'event_viewed', 'event_saved', 'event_unsaved', 'interested', 'going',
    'rsvp_cleared', 'ticket_clicked', 'event_shared', 'promoter_viewed',
    'genre_selected', 'location_selected', 'event_submitted',
    'clubmessenger_open', 'clubmessenger_event_open',
    'presence_started', 'presence_ended', 'presence_visibility_changed',
    'friend_arrival_seen', 'friend_arrival_clicked',
    'ping_sent', 'ping_response',
    'live_room_open', 'room_message_sent',
    'going_from_clubmessenger', 'event_click_from_clubmessenger',
    'ticket_click_from_clubmessenger', 'heat_card_click',
    'recommendation_impression', 'recommendation_click',
    'event_hidden', 'event_not_for_me',
    'taste_updated', 'history_added', 'scene_entity_added',
    'scene_people_impression', 'member_profile_viewed',
    'connection_requested', 'connection_accepted',
    'travel_plan_created', 'city_followed',
    'email_queued', 'email_rec_clicked',
    'alert_created', 'email_sent', 'email_failed',
    'email_unsubscribed', 'notification_clicked',
    'archive_viewed', 'archive_item_viewed', 'i_was_there_added',
    'i_was_there_removed', 'archive_contribution', 'archive_correction',
    'memory_added', 'archive_to_event_click', 'archive_search',
    -- V2F
    'close_friend_marked', 'close_friend_unmarked',
    'announcement_created', 'announcement_sent', 'announcement_clicked',
    'promoter_followers_viewed'
  ));
