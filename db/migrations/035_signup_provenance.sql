-- Where a signup came from, and whether a person has been seen since.
--
-- Guestlist had nothing between a script and a public member page. These two
-- columns are what let us count signups per connection and keep a profile
-- nobody has touched out of the places we advertise members.
--
-- The IP is hashed with a salt before it is written: useful for counting,
-- useless for identifying, and never displayed anywhere.
alter table members
  add column if not exists signup_ip_hash text;

create index if not exists members_signup_ip_idx
  on members (signup_ip_hash, created_at desc)
  where signup_ip_hash is not null;

comment on column members.signup_ip_hash is
  'Salted hash of the address a signup came from. Rate limiting only; never shown, never reversible.';
