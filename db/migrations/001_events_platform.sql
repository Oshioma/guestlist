-- Guestlist Events Platform — core schema.
-- Written as portable PostgreSQL so it can be applied to Supabase unchanged.
-- (On Supabase, gen_random_uuid() is available by default; locally we enable pgcrypto.)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type event_status as enum ('new', 'needs_review', 'live', 'rejected');

create type event_type as enum (
  'day_party', 'club_night', 'festival', 'weekender', 'boat_party',
  'beach_party', 'concert', 'retreat', 'other'
);

create type source_type as enum (
  'promoter_website', 'venue_website', 'festival_website', 'artist_website',
  'record_label', 'independent_calendar', 'blog_publication', 'rss_feed',
  'member_submission', 'manual', 'other'
);

create type rsvp_status as enum ('interested', 'going');

create type submission_status as enum ('pending', 'processed', 'duplicate', 'rejected', 'failed');

-- ---------------------------------------------------------------------------
-- Members & auth
-- On Supabase these map onto auth.users + a profiles table; the app's auth
-- module is the only place that touches password_hash/auth_sessions, so the
-- swap is contained.
-- ---------------------------------------------------------------------------

create table members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text,
  display_name text not null,
  avatar_url text,
  role text not null default 'member' check (role in ('member', 'admin')),
  home_city text,
  home_country text,
  created_at timestamptz not null default now()
);

create table auth_sessions (
  token text primary key,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Explicit genre preferences: personalisation foundation ("For You").
create table member_genres (
  member_id uuid not null references members(id) on delete cascade,
  genre_id uuid not null, -- fk added after genres table
  created_at timestamptz not null default now(),
  primary key (member_id, genre_id)
);

-- Follow graph foundation (artists / promoters / venues) — populated later.
create table member_follows (
  member_id uuid not null references members(id) on delete cascade,
  entity_type text not null check (entity_type in ('artist', 'promoter', 'venue')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (member_id, entity_type, entity_id)
);

-- ---------------------------------------------------------------------------
-- Taxonomy
-- ---------------------------------------------------------------------------

create table genres (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_genre_id uuid references genres(id) on delete set null,
  active boolean not null default true,
  sort_order integer not null default 0
);

alter table member_genres
  add constraint member_genres_genre_fk
  foreign key (genre_id) references genres(id) on delete cascade;

create index genres_parent_idx on genres(parent_genre_id);

-- ---------------------------------------------------------------------------
-- Places & people
-- ---------------------------------------------------------------------------

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  address text,
  city text,
  country text,
  latitude double precision,
  longitude double precision,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table promoters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  website text,
  image_url text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  image_url text,
  website text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  short_description text,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  timezone text not null default 'Europe/London',
  venue_id uuid references venues(id) on delete set null,
  promoter_id uuid references promoters(id) on delete set null,
  city text,
  country text,
  latitude double precision,
  longitude double precision,
  event_type event_type not null default 'other',
  ticket_url text,
  price_from numeric(10, 2) check (price_from is null or price_from >= 0),
  price_to numeric(10, 2) check (price_to is null or price_to >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  primary_image_url text,
  source_url text,
  source_type source_type not null default 'manual',
  source_id uuid, -- fk added after event_sources
  status event_status not null default 'new',
  -- Curated "destination event" flag for the Worth Travelling For shelf.
  worth_travelling boolean not null default false,
  featured boolean not null default false,
  -- AI enrichment fields: null until a real classifier writes them.
  confidence_score numeric(5, 2) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 100)),
  -- Duplicate detection: points at the suspected canonical event.
  possible_duplicate_of uuid references events(id) on delete set null,
  -- Normalised title maintained by the app for dedupe matching.
  title_normalized text,
  published_at timestamptz,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at > start_at),
  check (price_to is null or price_from is null or price_to >= price_from)
);

create index events_status_start_idx on events(status, start_at);
create index events_city_idx on events(city);
create index events_country_idx on events(country);
create index events_type_idx on events(event_type);
create index events_title_normalized_idx on events(title_normalized);
create index events_source_url_idx on events(source_url);

create table event_genres (
  event_id uuid not null references events(id) on delete cascade,
  genre_id uuid not null references genres(id) on delete cascade,
  -- Where the tag came from; classifier confidence stays null for manual tags.
  source text not null default 'manual' check (source in ('manual', 'import', 'ai')),
  confidence numeric(5, 2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  primary key (event_id, genre_id)
);

create index event_genres_genre_idx on event_genres(genre_id);

create table event_artists (
  event_id uuid not null references events(id) on delete cascade,
  artist_id uuid not null references artists(id) on delete cascade,
  position integer not null default 0,
  billing text check (billing is null or billing in ('headliner', 'support', 'resident', 'special_guest')),
  primary key (event_id, artist_id)
);

create table event_images (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  url text not null,
  alt text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index event_images_event_idx on event_images(event_id);

-- ---------------------------------------------------------------------------
-- Sources & ingestion
-- ---------------------------------------------------------------------------

create table event_sources (
  id uuid primary key default gen_random_uuid(),
  source_type source_type not null,
  name text not null,
  url text not null,
  promoter_id uuid references promoters(id) on delete set null,
  venue_id uuid references venues(id) on delete set null,
  active boolean not null default true,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  failure_count integer not null default 0,
  events_found integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table events
  add constraint events_source_fk
  foreign key (source_id) references event_sources(id) on delete set null;

-- Member "paste a link" submissions. The ingestion service processes these
-- into draft events; raw URLs are kept for audit and dedupe.
create table event_submissions (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  submitted_by uuid references members(id) on delete set null,
  status submission_status not null default 'pending',
  event_id uuid references events(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Social actions
-- One row per (member, event): saving and RSVP are independent axes, and
-- interested/going are mutually exclusive states of the same axis.
-- ---------------------------------------------------------------------------

create table member_event_actions (
  member_id uuid not null references members(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  saved_at timestamptz,
  rsvp rsvp_status,
  rsvp_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (member_id, event_id),
  check (saved_at is not null or rsvp is not null)
);

create index member_event_actions_event_idx on member_event_actions(event_id) where rsvp is not null;

-- ---------------------------------------------------------------------------
-- AI classification (future enrichment). Structured columns for the signals
-- we already know we want, full payload for everything else. No rows exist
-- until a real classifier runs — the UI never fabricates scores.
-- ---------------------------------------------------------------------------

create table event_classifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  classifier text not null,
  model_version text,
  payload jsonb not null default '{}',
  event_type_suggestion event_type,
  era_relevance text,
  vibe text,
  relevance_score numeric(5, 2) check (relevance_score is null or (relevance_score >= 0 and relevance_score <= 100)),
  confidence numeric(5, 2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  created_at timestamptz not null default now()
);

create index event_classifications_event_idx on event_classifications(event_id);

-- Per-genre classifier scores live in event_genres(source='ai', confidence)
-- and in the raw payload above.

-- ---------------------------------------------------------------------------
-- Analytics
-- Single append-only table; ticket_clicked rows double as the outbound
-- click ledger for promoter traffic reporting.
-- ---------------------------------------------------------------------------

create table analytics_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'event_viewed', 'event_saved', 'event_unsaved', 'interested', 'going',
    'rsvp_cleared', 'ticket_clicked', 'event_shared', 'promoter_viewed',
    'genre_selected', 'location_selected', 'event_submitted'
  )),
  member_id uuid references members(id) on delete set null,
  anon_id text,
  event_id uuid references events(id) on delete set null,
  promoter_id uuid references promoters(id) on delete set null,
  genre_id uuid references genres(id) on delete set null,
  metadata jsonb not null default '{}',
  path text,
  created_at timestamptz not null default now()
);

create index analytics_events_type_idx on analytics_events(event_type, created_at);
create index analytics_events_event_idx on analytics_events(event_id) where event_id is not null;
