-- Guestlist Manager V1
-- Promoter-controlled guestlists, Guestlist.net allocation, door check-in and source attribution.

create table if not exists event_guestlist_settings (
  event_id uuid primary key references events(id) on delete cascade,
  promoter_id uuid not null references promoters(id) on delete cascade,
  mode text not null default 'promoter_only'
    check (mode in ('promoter_only', 'approve_requests', 'auto_fill')),
  max_guestlist_places integer not null default 0 check (max_guestlist_places >= 0),
  guestlist_closes_at timestamptz,
  max_plus_ones integer not null default 1 check (max_plus_ones between 0 and 10),
  updated_by_member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists event_guestlist_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  promoter_id uuid not null references promoters(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  guest_name text not null check (length(trim(guest_name)) between 1 and 140),
  plus_ones integer not null default 0 check (plus_ones between 0 and 10),
  source text not null default 'promoter'
    check (source in ('promoter','guestlist','artist','partner','competition','invite_link','member_referral')),
  status text not null default 'confirmed'
    check (status in ('pending','confirmed','declined','cancelled')),
  notes text,
  checked_in_at timestamptz,
  created_by_member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_guestlist_member_event
  on event_guestlist_entries(event_id, member_id)
  where member_id is not null and status in ('pending','confirmed');

create index if not exists idx_guestlist_entries_event_status
  on event_guestlist_entries(event_id, status, guest_name);

create index if not exists idx_guestlist_entries_promoter_created
  on event_guestlist_entries(promoter_id, created_at desc);

create index if not exists idx_guestlist_settings_promoter
  on event_guestlist_settings(promoter_id, event_id);
