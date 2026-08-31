-- YouTube OAuth connection for owner-authorized caption downloads.
-- Tokens are encrypted in application code before storage; this table is server-only.

create table youtube_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'youtube' unique check (provider = 'youtube'),
  channel_id text,
  channel_title text,
  encrypted_refresh_token text not null,
  granted_scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table youtube_oauth_connections enable row level security;

-- Intentionally no public grants or public policies. Admin/server DB access only.
