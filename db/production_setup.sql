-- Production data setup for Guestlist.
-- Run AFTER the schema migrations (db/migrations/001–003) are applied.
-- Idempotent: safe to run more than once.
--
-- 1) Genre taxonomy (the dev seed is fictional test data and must NOT be
--    used in production; this block inserts only the real taxonomy).
-- 2) Admin promotion template at the bottom.

-- --- Parent genres -----------------------------------------------------

insert into genres (name, slug, sort_order) values
  ('House',        'house',          0),
  ('Drum & Bass',  'drum-and-bass',  1),
  ('Jungle',       'jungle',         2),
  ('Techno',       'techno',         3),
  ('Garage',       'garage',         4),
  ('Disco',        'disco',          5),
  ('Trance',       'trance',         6),
  ('Hardcore',     'hardcore',       7),
  ('Reggae & Dub', 'reggae-and-dub', 8),
  ('Bass',         'bass',           9),
  ('Breaks',       'breaks',        10),
  ('Balearic',     'balearic',      11)
on conflict (slug) do nothing;

-- --- Subgenres ----------------------------------------------------------

insert into genres (name, slug, parent_genre_id, sort_order)
select v.name, v.slug, g.id, v.sort_order
from (values
  ('Deep House',        'deep-house',        'house',         0),
  ('Vocal House',       'vocal-house',       'house',         1),
  ('Classic House',     'classic-house',     'house',         2),
  ('Funky House',       'funky-house',       'house',         3),
  ('Progressive House', 'progressive-house', 'house',         4),
  ('Liquid',            'liquid',            'drum-and-bass', 0),
  ('Jump Up',           'jump-up',           'drum-and-bass', 1),
  ('Rollers',           'rollers',           'drum-and-bass', 2),
  ('Neurofunk',         'neurofunk',         'drum-and-bass', 3),
  ('Old School Jungle', 'old-school-jungle', 'jungle',        0),
  ('Ragga Jungle',      'ragga-jungle',      'jungle',        1),
  ('Melodic Techno',    'melodic-techno',    'techno',        0),
  ('Hard Techno',       'hard-techno',       'techno',        1),
  ('UK Garage',         'uk-garage',         'garage',        0),
  ('2-Step',            '2-step',            'garage',        1),
  ('Speed Garage',      'speed-garage',      'garage',        2)
) as v(name, slug, parent, sort_order)
join genres g on g.slug = v.parent
on conflict (slug) do nothing;

-- --- Admin account ------------------------------------------------------
-- There is no SQL way to set a password (the app hashes with scrypt), so:
--   1. Sign up normally at https://<your-domain>/signup
--   2. Then promote that account:
--
-- update members set role = 'admin' where lower(email) = lower('you@guestlist.net');
