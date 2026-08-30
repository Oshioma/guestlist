-- V2B: Promoter network — claiming, teams, self-serve events, analytics,
-- follows surfacing, listing states, audit trail.

-- ---------------------------------------------------------------------------
-- Promoter profile + claim state
-- ---------------------------------------------------------------------------

alter table promoters
  add column hero_image_url text,
  add column city text,
  add column country text,
  add column socials jsonb not null default '{}',
  add column claim_status text not null default 'unclaimed'
    check (claim_status in ('unclaimed', 'claim_pending', 'verified', 'rejected', 'suspended'));

-- Verified promoters keep promoters.verified = true (public badge); the
-- claim_status carries the account/ownership lifecycle.

create table promoter_genres (
  promoter_id uuid not null references promoters(id) on delete cascade,
  genre_id uuid not null references genres(id) on delete cascade,
  primary key (promoter_id, genre_id)
);

alter table venues
  add column description text,
  add column hero_image_url text;

-- ---------------------------------------------------------------------------
-- Claims (audit history preserved: one row per claim attempt)
-- ---------------------------------------------------------------------------

create table promoter_claims (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references promoters(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  claimant_name text not null,
  claimant_role text,
  email text not null,
  phone text,
  website text,
  notes text,
  -- Claimant email domain matches the promoter's official website domain.
  domain_match boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'info_requested')),
  admin_note text,
  decided_by uuid references members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index promoter_claims_promoter_idx on promoter_claims(promoter_id, created_at desc);
create index promoter_claims_status_idx on promoter_claims(status, created_at desc);

-- ---------------------------------------------------------------------------
-- Teams: promoter ↔ account is many-to-many with roles. Never hardcoded on
-- the user row.
-- ---------------------------------------------------------------------------

create table promoter_members (
  promoter_id uuid not null references promoters(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'analyst')),
  created_at timestamptz not null default now(),
  primary key (promoter_id, member_id)
);

create index promoter_members_member_idx on promoter_members(member_id);

create table promoter_invites (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references promoters(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'editor', 'analyst')),
  token_hash text not null unique,
  invited_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references members(id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Event listing state (orthogonal to the moderation status enum):
-- a cancelled event stays published but is clearly marked and loses its CTA.
-- ---------------------------------------------------------------------------

alter table events
  add column listing_status text not null default 'confirmed'
    check (listing_status in ('confirmed', 'sold_out', 'cancelled', 'postponed', 'rescheduled'));

-- ---------------------------------------------------------------------------
-- Event claims: a verified promoter asserting "this is our event" on an
-- event imported from elsewhere. Strong domain evidence can auto-approve;
-- everything else waits for admin.
-- ---------------------------------------------------------------------------

create table event_claims (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  promoter_id uuid not null references promoters(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  evidence text,
  auto_approved boolean not null default false,
  decided_by uuid references members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, promoter_id)
);

-- ---------------------------------------------------------------------------
-- Audit trail for important promoter/admin actions
-- ---------------------------------------------------------------------------

create table audit_log (
  id bigint generated always as identity primary key,
  actor_member_id uuid references members(id) on delete set null,
  promoter_id uuid references promoters(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  source_id uuid references event_sources(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_log_promoter_idx on audit_log(promoter_id, created_at desc);
create index audit_log_event_idx on audit_log(event_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Notification foundation: rows only, no delivery platform yet.
-- ---------------------------------------------------------------------------

create table promoter_notifications (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references promoters(id) on delete cascade,
  type text not null check (type in (
    'events_found', 'event_needs_review', 'event_published',
    'ticket_url_missing', 'possible_duplicate', 'claim_approved',
    'claim_rejected', 'claim_info_requested', 'source_failing'
  )),
  event_id uuid references events(id) on delete cascade,
  source_id uuid references event_sources(id) on delete set null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index promoter_notifications_idx on promoter_notifications(promoter_id, created_at desc);
