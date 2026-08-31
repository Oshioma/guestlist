-- 013: MIXES ON SCENES.
--
-- A mix can now belong to a scene/club directly ("a classic Thunder and
-- Joy tape") as well as to a specific archived night. At least one target
-- is always required; scene pages roll up both their own mixes and the
-- mixes of their archived nights.

alter table archive_mixes
  add column scene_entity_id uuid references scene_entities(id) on delete cascade;
alter table archive_mixes
  alter column archive_event_id drop not null;
alter table archive_mixes add constraint archive_mixes_target
  check (archive_event_id is not null or scene_entity_id is not null);

create index archive_mixes_scene_idx on archive_mixes (scene_entity_id, status);
create unique index archive_mixes_scene_url_idx on archive_mixes (scene_entity_id, url)
  where scene_entity_id is not null and archive_event_id is null;
