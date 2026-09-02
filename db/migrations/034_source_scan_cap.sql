-- How many candidates one scan of THIS source may take.
--
-- Forty is right for a venue: a club with more than forty upcoming nights is
-- rarer than a bug in our reader, and the cap is what stops a mis-read page
-- turning into a thousand fetches. It is wrong for a festival programme —
-- ADE's is hundreds — and a cap that silently stops at forty is a listing
-- truncated with no sign that it happened.
--
-- Null means "use the platform default", so nothing changes for the sources
-- that never needed to think about it.
alter table event_sources
  add column if not exists max_candidates integer;

alter table event_sources drop constraint if exists event_sources_max_candidates_check;
alter table event_sources add constraint event_sources_max_candidates_check
  check (max_candidates is null or (max_candidates >= 1 and max_candidates <= 1000));

comment on column event_sources.max_candidates is
  'Per-scan candidate ceiling for this source. Null uses SUPPLY_SCAN_MAX_CANDIDATES (40).';
