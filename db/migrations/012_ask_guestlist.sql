-- 012: ASK @GUESTLIST — conversational discovery over the Guestlist graph.
--
-- Conversations hold BOUNDED structured state (city, date, genres,
-- preferences), never an unlimited transcript. Messages record the full
-- decision trail: question, parsed intent, the real result ids used,
-- model usage/cost, validation outcome — the evaluation data V2H's
-- learning loop needs. Feedback is the lightweight 👍/👎.

create table ask_conversations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete cascade,
  channel text not null default 'website' check (channel in ('website', 'x')),
  external_ref text, -- e.g. X conversation id for cross-channel follow-ups
  state jsonb not null default '{}', -- bounded structured context
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ask_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ask_conversations(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  channel text not null default 'website',
  ip_hash text, -- guest rate limiting, same convention as event_submissions
  question text not null,
  intent jsonb not null default '{}',
  answer_type text,
  result_event_ids uuid[] not null default '{}',
  result_archive_ids uuid[] not null default '{}',
  commentary text,
  ai_model text,               -- null when the deterministic template answered
  ai_draft text,               -- what the AI wrote before validation
  validation jsonb,            -- validator outcome (problems, fallback used)
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(10,6),
  tool_calls integer not null default 0,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create table ask_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references ask_messages(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  verdict text not null check (verdict in ('up', 'down')),
  reason text check (reason in ('not_relevant', 'wrong_vibe', 'too_far', 'too_expensive', 'already_knew', 'bad_answer', 'other')),
  created_at timestamptz not null default now(),
  unique (message_id, member_id)
);

create index ask_conversations_member_idx on ask_conversations (member_id, updated_at desc);
create index ask_conversations_external_idx on ask_conversations (external_ref) where external_ref is not null;
create index ask_messages_conversation_idx on ask_messages (conversation_id, created_at);
create index ask_messages_recent_idx on ask_messages (created_at desc);
create index ask_messages_ip_idx on ask_messages (ip_hash, created_at) where ip_hash is not null;
create index ask_messages_member_idx on ask_messages (member_id, created_at) where member_id is not null;

-- Ask events join the analytics vocabulary.
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
  'ask_question', 'ask_feedback'
));
