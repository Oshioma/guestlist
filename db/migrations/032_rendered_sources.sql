-- A source whose listings are built in the browser.
--
-- Most sites hand a bot the same HTML they hand a person. A few ship an empty
-- shell and fetch their events afterwards, and for those the only honest way
-- in is to run the page. That costs time and money, so it is never a default
-- and never a guess: an admin ticks this box for one source at a time, after
-- a test fetch has said the page builds its listings in the browser.
alter table event_sources
  add column if not exists render_js boolean not null default false;

comment on column event_sources.render_js is
  'Fetch this source through a hosted browser because its listings are built client-side. Off by default; requires SUPPLY_RENDER_TOKEN to have any effect.';
