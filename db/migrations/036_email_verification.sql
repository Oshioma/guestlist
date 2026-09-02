-- IS THIS ADDRESS REAL?
--
-- Guestlist has never asked. Anyone could sign up with anything@anywhere and
-- be at a public /members/ page a second later, which is how a page of
-- gibberish ends up on the site. A link in an inbox is the cheapest honest
-- proof that somebody is a person, and unlike a phone number it asks for
-- nothing we would not already hold.
--
-- EVERYONE WHO IS ALREADY HERE IS TREATED AS VERIFIED. They joined under the
-- old rules and it is not their job to re-prove themselves because we changed
-- our minds; locking real members out of their own profiles to catch a spam
-- account would be a far worse outcome than the spam account.
alter table members
  add column if not exists email_verified_at timestamptz;

update members set email_verified_at = coalesce(email_verified_at, created_at, now())
 where email_verified_at is null;

-- Tokens are stored only as a SHA-256 hash, the same rule the password reset
-- table follows: a leak of this table must not let anyone verify an address
-- they do not own.
create table if not exists email_verifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_verifications_member_idx
  on email_verifications (member_id, created_at desc);
create index if not exists email_verifications_expiry_idx
  on email_verifications (expires_at);

comment on column members.email_verified_at is
  'When this address was proved reachable. Backfilled for everyone who joined before verification existed.';
