-- V2G: GUESTLIST INTELLIGENCE CORE + @GUESTLIST ON X.
--
-- Architecture: GUESTLIST DATA → INTELLIGENCE (channel-independent
-- opportunities with grounded evidence) → DRAFTS (human-approved, state
-- machine enforced AT THE DATABASE) → CHANNELS (X adapter, website module).
-- X is a channel, never the brain. Nothing AI-generated can reach POSTING
-- without a human approval recorded — a trigger guarantees it below.

-- ---------------------------------------------------------------------------
-- 1. Intelligence opportunities — channel-independent, evidence-backed.
-- ---------------------------------------------------------------------------

create table intelligence_opportunities (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in (
    'TONIGHT_PICK', 'TONIGHT_PATTERN', 'WEEKEND_PATTERN', 'NEW_EVENT',
    'NEW_LINEUP', 'NOTABLE_LINEUP', 'ARTIST_APPEARANCE', 'PROMOTER_ACTIVITY',
    'CITY_MOMENT', 'GENRE_MOMENT', 'EVENT_MOMENTUM', 'WORTH_TRAVELLING_FOR',
    'ARCHIVE_ANNIVERSARY', 'ON_THIS_NIGHT', 'ARCHIVE_FLYER',
    'I_WAS_THERE_MOMENT', 'EDITORIAL_OBSERVATION'
  )),
  headline text not null,
  reason text not null,              -- "why we noticed", human-readable
  suggested_angle text,              -- one-line editorial angle
  score numeric(8,2) not null default 0,
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  city text,
  location_id uuid references locations(id) on delete set null,
  genres text[] not null default '{}',
  linked_event_ids uuid[] not null default '{}',
  linked_artist_names text[] not null default '{}',
  linked_promoter_ids uuid[] not null default '{}',
  linked_venue_ids uuid[] not null default '{}',
  linked_archive_event_ids uuid[] not null default '{}',
  linked_archive_media_ids uuid[] not null default '{}',
  -- The grounded evidence pack (versioned) — every AI factual claim must
  -- trace back to this.
  evidence jsonb not null default '{}',
  channels text[] not null default '{x,website}', -- suitability, not routing
  fingerprint text not null,          -- type + subject + date bucket dedupe
  detected_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'open'
    check (status in ('open', 'drafted', 'dismissed', 'expired', 'published'))
);

create unique index intelligence_opportunities_fingerprint_idx
  on intelligence_opportunities(fingerprint);
create index intelligence_opportunities_status_idx
  on intelligence_opportunities(status, score desc, detected_at desc);

-- ---------------------------------------------------------------------------
-- 2. Channel drafts — the human-approval state machine.
-- ---------------------------------------------------------------------------

create table channel_drafts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references intelligence_opportunities(id) on delete set null,
  channel text not null default 'x' check (channel in ('x', 'website')),
  kind text not null default 'post' check (kind in ('post', 'reply')),
  reply_to_mention_id uuid,          -- fk added after x_mentions exists
  body text not null,
  original_body text not null,       -- the untouched AI draft (learning data)
  media jsonb not null default '[]', -- [{archive_media_id, path, rights}]
  link_url text,                     -- the Guestlist link (carries ?src=)
  attribution_src text,              -- e.g. gx-1a2b3c4d
  ai_model text,
  voice_version text,
  prompt_version text,
  evidence_snapshot jsonb not null default '{}', -- evidence at draft time
  status text not null default 'drafted' check (status in (
    'drafted', 'edited', 'approved', 'scheduled', 'posting', 'posted',
    'rejected', 'failed', 'expired', 'needs_review', 'budget_paused'
  )),
  edited_by uuid references members(id) on delete set null,
  approved_by uuid references members(id) on delete set null,
  approved_at timestamptz,
  scheduled_for timestamptz,
  schedule_timezone text,            -- explicit tz, no server-local guessing
  estimated_cost_usd numeric(10, 6) not null default 0,
  posted_at timestamptz,
  external_id text,                  -- X post id
  post_url text,
  needs_review_reason text,
  rejection_reason text check (rejection_reason is null or rejection_reason in (
    'not_interesting', 'too_promotional', 'wrong_tone', 'factually_weak',
    'repetitive', 'bad_timing', 'already_covered', 'other'
  )),
  rejection_note text,
  error text,
  fingerprint text,                  -- wording fingerprint for repetition guard
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index channel_drafts_status_idx on channel_drafts(status, created_at desc);
create index channel_drafts_scheduled_idx on channel_drafts(scheduled_for)
  where status in ('scheduled', 'budget_paused');

-- THE ABSOLUTE RULE, ENFORCED IN THE DATABASE: nothing transitions to
-- POSTING/POSTED without a recorded human approval. UI bugs, service bugs
-- and rogue jobs all hit this wall.
create or replace function enforce_draft_approval() returns trigger as $$
begin
  if new.status in ('posting', 'posted')
     and (new.approved_by is null or new.approved_at is null) then
    raise exception 'draft % cannot reach % without human approval', new.id, new.status;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger channel_drafts_approval_gate
  before insert or update on channel_drafts
  for each row execute function enforce_draft_approval();

-- ---------------------------------------------------------------------------
-- 3. Social accounts — @guestlist connection (tokens stored ENCRYPTED).
-- ---------------------------------------------------------------------------

create table social_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('x')),
  handle text,
  external_user_id text,
  access_token_enc text,             -- AES-256-GCM, never plaintext
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'error')),
  connected_by uuid references members(id) on delete set null,
  connected_at timestamptz,
  last_api_call_at timestamptz,
  last_post_at timestamptz,
  last_mention_sync_at timestamptz,
  mention_cursor text,               -- newest ingested X post id (since_id)
  last_error text,
  unique (platform)
);

-- ---------------------------------------------------------------------------
-- 4. X usage ledger + billing periods — the money trail.
-- ---------------------------------------------------------------------------

create table x_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  operation text not null,           -- post_create / post_create_link / mention_read / …
  endpoint text,
  resources integer not null default 1,
  estimated_cost_usd numeric(10, 6) not null default 0,
  confirmed_cost_usd numeric(10, 6), -- only when X genuinely reports it
  priority text not null default 'medium'
    check (priority in ('critical', 'high', 'medium', 'low')),
  http_status integer,
  x_request_id text,
  opportunity_id uuid references intelligence_opportunities(id) on delete set null,
  draft_id uuid references channel_drafts(id) on delete set null,
  mention_id uuid,                   -- fk added below
  job text,
  detail text,
  created_at timestamptz not null default now()
);

create index x_usage_ledger_period_idx on x_usage_ledger(created_at);

-- X moved to prepaid pay-per-use credits (Feb 2026): the billing period is
-- the credit/spending-limit cycle, not automatically a calendar month —
-- so periods are explicit rows the admin can align with the X console.
create table x_billing_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  budget_usd numeric(10, 2) not null default 50,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);

-- ---------------------------------------------------------------------------
-- 5. X mentions — the @guestlist inbox.
-- ---------------------------------------------------------------------------

create table x_mentions (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,  -- dedupe at the database
  author_handle text,
  author_external_id text,
  text text not null,
  conversation_id text,
  in_reply_to_external_id text,
  created_at_x timestamptz,
  classification text check (classification is null or classification in (
    'EVENT_QUESTION', 'GENERAL_MENTION', 'PROMOTER', 'EVENT_SUBMISSION',
    'SPAM', 'ABUSE', 'OTHER'
  )),
  intent jsonb not null default '{}',   -- {city, date, genre, ...} parsed
  matched_event_ids uuid[] not null default '{}',
  status text not null default 'new'
    check (status in ('new', 'classified', 'drafted', 'replied', 'ignored')),
  draft_id uuid references channel_drafts(id) on delete set null,
  ingested_at timestamptz not null default now()
);

alter table channel_drafts add constraint channel_drafts_reply_mention_fk
  foreign key (reply_to_mention_id) references x_mentions(id) on delete set null;
alter table x_usage_ledger add constraint x_usage_ledger_mention_fk
  foreign key (mention_id) references x_mentions(id) on delete set null;

create index x_mentions_status_idx on x_mentions(status, ingested_at desc);

-- ---------------------------------------------------------------------------
-- 6. Repetition protection — recently discussed entities + wording.
-- ---------------------------------------------------------------------------

create table content_fingerprints (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'event', 'artist', 'promoter', 'venue', 'city', 'genre',
    'archive_event', 'archive_media', 'wording'
  )),
  entity_key text not null,          -- id / normalized name / wording hash
  draft_id uuid references channel_drafts(id) on delete cascade,
  posted_at timestamptz not null default now()
);

create index content_fingerprints_lookup_idx
  on content_fingerprints(kind, entity_key, posted_at desc);

-- ---------------------------------------------------------------------------
-- 7. Audit — every sensitive @guestlist action, no invisible publishing.
-- ---------------------------------------------------------------------------

create table guestlist_x_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null,              -- drafted/edited/approved/scheduled/posted/
                                     -- rejected/budget_override/kill_switch/…
  actor_member_id uuid references members(id) on delete set null,
  opportunity_id uuid references intelligence_opportunities(id) on delete set null,
  draft_id uuid references channel_drafts(id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);

create index guestlist_x_audit_idx on guestlist_x_audit(created_at desc);
