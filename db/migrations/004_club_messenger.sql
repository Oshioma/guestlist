-- Club Messenger V1: live social presence on top of the existing event
-- network. Presence is temporal (RSVP stays historical/planning data),
-- privacy is enforced server-side in the API layer (see
-- db/supabase_rls_reference.sql for the equivalent RLS policies to apply
-- when this schema moves onto Supabase Auth).

-- ---------------------------------------------------------------------------
-- People can now follow people. A "friend" is a MUTUAL member follow —
-- one-way followers are never treated as trusted friends. Upgrade path for
-- "close friends": a tier column on member_follows or a lists table.
-- ---------------------------------------------------------------------------

alter table member_follows drop constraint member_follows_entity_type_check;
alter table member_follows add constraint member_follows_entity_type_check
  check (entity_type in ('artist', 'promoter', 'venue', 'member'));

create index member_follows_entity_idx on member_follows(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Presence: "I'm here". Manual, temporary, private by default.
-- Active presence = left_at is null AND expires_at > now().
-- One row per member per event; re-arriving updates the row.
-- ---------------------------------------------------------------------------

create table event_presence (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  arrived_at timestamptz not null default now(),
  -- Defaults to the event's end time (+grace); fallback arrival+8h.
  expires_at timestamptz not null,
  left_at timestamptz,
  visibility text not null default 'friends'
    check (visibility in ('friends', 'event', 'invisible')),
  status text check (status is null or char_length(status) <= 80),
  updated_at timestamptz not null default now(),
  unique (member_id, event_id)
);

create index event_presence_event_active_idx on event_presence(event_id)
  where left_at is null;
create index event_presence_member_idx on event_presence(member_id, arrived_at desc);
create index event_presence_expires_idx on event_presence(expires_at)
  where left_at is null;

-- ---------------------------------------------------------------------------
-- Event live rooms: lightweight chronological chat per event.
-- Access rule (enforced in the API): a member may read/post in an event's
-- room if they RSVP'd Going, hold presence at the event (active or from
-- earlier tonight), or are a Guestlist admin.
-- ---------------------------------------------------------------------------

create table event_room_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references members(id) on delete set null,
  report_count integer not null default 0
);

create index event_room_messages_event_idx on event_room_messages(event_id, created_at);

create table room_message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references event_room_messages(id) on delete cascade,
  reporter_id uuid not null references members(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);

-- ---------------------------------------------------------------------------
-- "Where are you?" pings — one-tap ask, short venue-relative answer.
-- ---------------------------------------------------------------------------

create table club_pings (
  id uuid primary key default gen_random_uuid(),
  from_member uuid not null references members(id) on delete cascade,
  to_member uuid not null references members(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  response text check (response is null or char_length(response) <= 80)
);

create index club_pings_to_idx on club_pings(to_member, created_at desc);
create index club_pings_from_idx on club_pings(from_member, event_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Member notifications (in-app now; web/native push + email can attach to
-- the same rows later). Deliberately separate from promoter_notifications.
-- ---------------------------------------------------------------------------

create table notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  type text not null check (type in ('friend_arrived', 'friend_pinged_you', 'event_room_message')),
  actor_member_id uuid references members(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_member_idx on notifications(member_id, created_at desc);
create index notifications_unread_idx on notifications(member_id) where read_at is null;

create table notification_preferences (
  member_id uuid primary key references members(id) on delete cascade,
  friend_arrivals boolean not null default true,
  pings boolean not null default true,
  -- Off by default: room chatter must never become notification spam.
  room_messages boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Moderation: Club Messenger privileges can be suspended per member.
-- ---------------------------------------------------------------------------

alter table members add column club_suspended_at timestamptz;

-- ---------------------------------------------------------------------------
-- Analytics: extend the allowed event types with Club Messenger actions.
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
    'ticket_click_from_clubmessenger', 'heat_card_click'
  ));
