-- Forgotten password. Tokens are stored only as a SHA-256 hash: a leak of
-- this table must not let anyone reset an account, and the plain token
-- exists only in the email we send.
create table password_resets (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_ip_hash text,
  created_at timestamptz not null default now()
);

create index password_resets_member_idx on password_resets(member_id, created_at desc);
create index password_resets_expiry_idx on password_resets(expires_at);
