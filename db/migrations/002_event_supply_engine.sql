-- Event Supply Engine V2A: real extraction, source scanning, provenance,
-- multi-source evidence, trust levels, observability.

-- ---------------------------------------------------------------------------
-- Source trust + polling
-- ---------------------------------------------------------------------------

alter table event_sources
  add column trust text not null default 'new'
    check (trust in ('new', 'trusted', 'restricted', 'blocked')),
  add column polling_enabled boolean not null default false,
  add column poll_frequency_hours integer not null default 24
    check (poll_frequency_hours >= 1),
  add column feed_url text;

-- ---------------------------------------------------------------------------
-- Extraction runs: one row per attempt to turn a URL into an event.
-- Carries the validated extraction payload, per-field confidence and
-- provenance, duplicate assessment, relevance, failure state, and cost/
-- performance metrics ("what does importing 1,000 events cost?").
-- ---------------------------------------------------------------------------

create table extractions (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  canonical_url text,
  source_id uuid references event_sources(id) on delete set null,
  submission_id uuid references event_submissions(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  status text not null default 'processing' check (status in (
    'processing', 'succeeded', 'duplicate_linked',
    'invalid_url', 'unsafe_url', 'fetch_failed', 'not_found',
    'blocked_by_site', 'too_large', 'unsupported_content',
    'not_an_event', 'not_relevant', 'insufficient_information',
    'ai_extraction_failed', 'invalid_date', 'possible_duplicate', 'failed'
  )),
  failure_detail text,
  payload jsonb,
  field_confidence jsonb not null default '{}',
  field_sources jsonb not null default '{}',
  warnings jsonb not null default '[]',
  overall_confidence numeric(5, 2)
    check (overall_confidence is null or (overall_confidence >= 0 and overall_confidence <= 100)),
  relevance text check (relevance in ('relevant', 'not_relevant', 'unknown')),
  duplicate_state text not null default 'none'
    check (duplicate_state in ('none', 'possible', 'likely', 'exact')),
  duplicate_score numeric(5, 2),
  duplicate_of uuid references events(id) on delete set null,
  structured_data_found boolean not null default false,
  ai_used boolean not null default false,
  ai_model text,
  ai_input_tokens integer,
  ai_output_tokens integer,
  fetch_ms integer,
  extract_ms integer,
  total_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index extractions_status_idx on extractions(status, created_at desc);
create index extractions_source_idx on extractions(source_id, created_at desc);
create index extractions_event_idx on extractions(event_id);
create index extractions_url_idx on extractions(url);

-- ---------------------------------------------------------------------------
-- Multiple sources of evidence per canonical event. The same night can be
-- discovered via the promoter site, the venue calendar and a member
-- submission — one event, several evidence links.
-- ---------------------------------------------------------------------------

create table event_source_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  source_id uuid references event_sources(id) on delete set null,
  extraction_id uuid references extractions(id) on delete set null,
  url text not null,
  kind text not null check (kind in ('submission', 'source_scan', 'manual', 'enrichment')),
  created_at timestamptz not null default now(),
  unique (event_id, url)
);

create index event_source_links_event_idx on event_source_links(event_id);

-- ---------------------------------------------------------------------------
-- Source scanning bookkeeping
-- ---------------------------------------------------------------------------

create table source_scans (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references event_sources(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  method text check (method in ('rss', 'html')),
  candidates_found integer not null default 0,
  new_candidates integer not null default 0,
  extracted integer not null default 0,
  failed integer not null default 0,
  duplicates integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index source_scans_source_idx on source_scans(source_id, started_at desc);

-- Candidate URLs already seen per source, so repeat scans only process new
-- links.
create table source_seen_urls (
  source_id uuid not null references event_sources(id) on delete cascade,
  url text not null,
  extraction_id uuid references extractions(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (source_id, url)
);

-- ---------------------------------------------------------------------------
-- Unknown genre proposals from classification: never auto-create genres;
-- queue the suggestion for an admin.
-- ---------------------------------------------------------------------------

create table genre_suggestions (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid references extractions(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  suggested_name text not null,
  confidence numeric(5, 2),
  status text not null default 'pending' check (status in ('pending', 'mapped', 'dismissed')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Events: canonical URL (dedupe signal, separate from source_url and
-- ticket_url).
-- ---------------------------------------------------------------------------

alter table events add column canonical_url text;
create index events_canonical_url_idx on events(canonical_url);
create index events_ticket_url_idx on events(ticket_url);

-- ---------------------------------------------------------------------------
-- Submissions: hashed submitter IP for rate limiting anonymous use.
-- ---------------------------------------------------------------------------

alter table event_submissions add column ip_hash text;
create index event_submissions_ip_idx on event_submissions(ip_hash, created_at);
create index event_submissions_member_idx on event_submissions(submitted_by, created_at);
