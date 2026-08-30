-- 011: MIXES IN THE ARCHIVE.
--
-- Recorded sets attached to archive nights. Members paste a Mixcloud,
-- SoundCloud or YouTube link; the player is embedded ON Guestlist (nobody
-- leaves the site), inside our own card design. Everything is reviewed
-- before it appears, like every other archive contribution.

create table archive_mixes (
  id uuid primary key default gen_random_uuid(),
  archive_event_id uuid not null references archive_events(id) on delete cascade,
  title text not null,
  artist_name text,
  platform text not null check (platform in ('youtube', 'soundcloud', 'mixcloud')),
  url text not null, -- canonical link on the platform
  contributed_by uuid references members(id) on delete set null,
  credit_contributor boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index archive_mixes_event_idx on archive_mixes (archive_event_id, status);
create index archive_mixes_recent_idx on archive_mixes (status, published_at desc);
create unique index archive_mixes_event_url_idx on archive_mixes (archive_event_id, url);
