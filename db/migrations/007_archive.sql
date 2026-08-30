-- V2E The Archive: a living social graph of club culture.
--
-- Historical events live in their OWN tables (different operational needs
-- from upcoming events), attach to the existing scene_entities (never a
-- duplicate archive-only universe), carry honest date uncertainty
-- ("Summer 1996" never silently becomes 1 June 1996), field provenance,
-- media rights metadata, and the I WAS THERE relationship with per-member
-- visibility. International from the start: canonical locations, country
-- codes, original language, historical prices in original currency.

-- ---------------------------------------------------------------------------
-- 1. Scene entities gain public slugs (for /archive/clubs/the-end-london)
--    and admin-managed lineage (renames, successions, venue moves).
-- ---------------------------------------------------------------------------

alter table scene_entities add column slug text unique;

update scene_entities set slug =
  regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')
  || case when city is not null then '-' || regexp_replace(lower(city), '[^a-z0-9]+', '-', 'g') else '' end
 where slug is null;

-- Collision cleanup: append a short id where the generated slug clashed.
update scene_entities se set slug = se.slug || '-' || left(se.id::text, 4)
 where exists (select 1 from scene_entities o
                where o.slug = se.slug and o.id < se.id);

create table scene_entity_links (
  id uuid primary key default gen_random_uuid(),
  from_entity uuid not null references scene_entities(id) on delete cascade,
  to_entity uuid not null references scene_entities(id) on delete cascade,
  relation text not null check (relation in
    ('renamed_to', 'became', 'moved_to', 'merged_into', 'successor_of', 'related')),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_entity <> to_entity),
  unique (from_entity, to_entity, relation)
);

-- ---------------------------------------------------------------------------
-- 2. Historical events — honest uncertainty, provenance, verification.
-- ---------------------------------------------------------------------------

create table archive_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  original_language char(2), -- ISO 639-1; original wording is never overwritten
  -- DATE UNCERTAINTY: precision says how much of the date is real.
  --   exact: start_date is the day · month: year+month known (day = 1 as
  --   anchor, never displayed) · year: year only · circa: display_date
  --   carries the human truth ("Summer 1996") · unknown: no date claim.
  date_precision text not null default 'unknown'
    check (date_precision in ('exact', 'month', 'year', 'circa', 'unknown')),
  start_date date,
  end_date date,
  year smallint check (year is null or year between 1950 and 2100),
  display_date text, -- what humans see: "14 Oct 1995", "Summer 1996", "1996"
  venue_name text,
  promoter_name text,
  city text,
  country_code char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  country_name text,
  location_id uuid references locations(id) on delete set null,
  price_note text, -- historical price in ORIGINAL currency, verbatim ("£8 / £6 NUS")
  source_url text,
  source_attribution text, -- where the facts came from; never erased
  confidence integer check (confidence is null or confidence between 0 and 100),
  provenance jsonb not null default '{}', -- field → FLYER_TEXT/ADMIN/AI_INFERENCE/…
  status text not null default 'pending'
    check (status in ('pending', 'needs_review', 'needs_research', 'published', 'rejected')),
  possible_duplicate_of uuid references archive_events(id) on delete set null,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index archive_events_status_idx on archive_events(status);
create index archive_events_year_idx on archive_events(year) where status = 'published';
create index archive_events_date_idx on archive_events(start_date) where status = 'published';
create index archive_events_location_idx on archive_events(location_id);
create index archive_events_country_idx on archive_events(country_code);
create index archive_events_title_idx on archive_events(lower(title));

-- Historical lineups are NAMES first (many acts predate the artists table);
-- an optional link to a current artist row when the lineage is real.
create table archive_event_artists (
  id uuid primary key default gen_random_uuid(),
  archive_event_id uuid not null references archive_events(id) on delete cascade,
  artist_name text not null,
  artist_id uuid references artists(id) on delete set null,
  position integer not null default 0,
  unique (archive_event_id, artist_name)
);

create index archive_event_artists_event_idx on archive_event_artists(archive_event_id);
create index archive_event_artists_name_idx on archive_event_artists(lower(artist_name));

create table archive_event_genres (
  archive_event_id uuid not null references archive_events(id) on delete cascade,
  genre_id uuid not null references genres(id) on delete cascade,
  primary key (archive_event_id, genre_id)
);

-- Attachment to the SHARED cultural graph (clubs, promoters, parties,
-- festivals, scenes — the same rows members put in their rave history).
create table archive_event_entities (
  archive_event_id uuid not null references archive_events(id) on delete cascade,
  entity_id uuid not null references scene_entities(id) on delete cascade,
  role text not null default 'venue'
    check (role in ('venue', 'club', 'promoter', 'party', 'festival', 'scene')),
  primary key (archive_event_id, entity_id)
);

create index archive_event_entities_entity_idx on archive_event_entities(entity_id);

-- ---------------------------------------------------------------------------
-- 3. Archive items — the artefacts (flyer, photo, article, listing…),
--    linkable to a historical event. Six artefacts of one night connect to
--    ONE archive_event.
-- ---------------------------------------------------------------------------

create table archive_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in
    ('event', 'flyer', 'photo', 'gallery', 'article', 'listing',
     'ticket_stub', 'poster', 'programme', 'memorabilia')),
  title text,
  description text,
  original_language char(2),
  archive_event_id uuid references archive_events(id) on delete set null,
  source_url text,
  source_attribution text,
  contributed_by uuid references members(id) on delete set null,
  credit_contributor boolean not null default false, -- "Contributed by Oshi" opt-in
  contributor_note text check (contributor_note is null or char_length(contributor_note) <= 500),
  provenance jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'needs_review', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index archive_items_event_idx on archive_items(archive_event_id);
create index archive_items_status_idx on archive_items(status, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Media — stored files (storage abstraction lives in code; originals in
--    object storage or /public/uploads in dev, NEVER base64 in Postgres).
--    Rights metadata is first-class: online ≠ owned.
-- ---------------------------------------------------------------------------

create table archive_media (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references archive_items(id) on delete cascade,
  kind text not null default 'front' check (kind in ('front', 'back', 'photo', 'page', 'other')),
  storage_path text not null,       -- original (safe generated path)
  display_path text,                -- optimised, when generated
  thumb_path text,                  -- grid thumbnail, when generated
  mime text not null,
  bytes integer,
  width integer,
  height integer,
  ocr_text text,                    -- extracted text (one signal, never truth)
  rights text not null default 'unknown' check (rights in
    ('unknown', 'guestlist_owned', 'contributor_granted', 'licensed',
     'external_reference', 'restricted')),
  rights_note text,
  hidden boolean not null default false, -- takedown: metadata stays, image hides
  created_at timestamptz not null default now()
);

create index archive_media_item_idx on archive_media(item_id);

-- ---------------------------------------------------------------------------
-- 5. I WAS THERE — the central member mechanic. Cultural memory, not legal
--    verification: optional "I think I was there", per-member visibility.
-- ---------------------------------------------------------------------------

create table archive_attendance (
  member_id uuid not null references members(id) on delete cascade,
  archive_event_id uuid not null references archive_events(id) on delete cascade,
  certainty text not null default 'sure' check (certainty in ('sure', 'unsure')),
  visibility text not null default 'public'
    check (visibility in ('public', 'connections', 'private')),
  created_at timestamptz not null default now(),
  primary key (member_id, archive_event_id)
);

create index archive_attendance_event_idx on archive_attendance(archive_event_id);

-- ---------------------------------------------------------------------------
-- 6. Memories — "your memory of this night". Short, human, deletable by the
--    author. Not a forum.
-- ---------------------------------------------------------------------------

create table archive_memories (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  archive_event_id uuid not null references archive_events(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  status text not null default 'visible' check (status in ('visible', 'removed')),
  removed_by uuid references members(id) on delete set null,
  report_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index archive_memories_event_idx on archive_memories(archive_event_id, created_at desc);

create table archive_memory_reports (
  memory_id uuid not null references archive_memories(id) on delete cascade,
  reporter_id uuid not null references members(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (memory_id, reporter_id)
);

-- ---------------------------------------------------------------------------
-- 7. Corrections — "I know more about this". Never overwrites published
--    history directly; queued for admin.
-- ---------------------------------------------------------------------------

create table archive_corrections (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  archive_event_id uuid not null references archive_events(id) on delete cascade,
  field text not null check (field in
    ('date', 'venue', 'promoter', 'lineup', 'title', 'story', 'image', 'other')),
  suggestion text not null check (char_length(suggestion) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'applied', 'rejected')),
  resolved_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index archive_corrections_status_idx on archive_corrections(status, created_at);

-- ---------------------------------------------------------------------------
-- 8. Ingestions — every import (upload, URL, bulk, manual) is a tracked run
--    with a dry-run mode; nothing dumps blindly into live tables.
-- ---------------------------------------------------------------------------

create table archive_ingestions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('upload', 'url', 'manual', 'bulk_json', 'bulk_csv')),
  source_ref text,             -- filename / URL / label
  dry_run boolean not null default false,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  stats jsonb not null default '{}', -- found/valid/invalid/duplicates/new entities/uncertain dates
  detail text,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 9. Notifications + analytics + preference hooks.
-- ---------------------------------------------------------------------------

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'friend_arrived', 'friend_pinged_you', 'event_room_message',
    'event_alert', 'event_reminder', 'connection_going',
    'travel_digest', 'city_digest', 'promoter_review',
    'archive_activity'
  ));

alter table notifications add column archive_event_id uuid
  references archive_events(id) on delete cascade;

alter table member_email_prefs add column archive_updates boolean not null default false;

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
    -- V2E
    'archive_viewed', 'archive_item_viewed', 'i_was_there_added',
    'i_was_there_removed', 'archive_contribution', 'archive_correction',
    'memory_added', 'archive_to_event_click', 'archive_search'
  ));
