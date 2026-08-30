-- 010: ORGANISE THE SOURCE GRAPH BY PLACE AND GENRE.
--
-- Sources (promoter sites, venue calendars, festivals, labels, blogs) get a
-- city + country and a set of genres, so the admin Sources desk can be
-- browsed per country instead of one flat list, and filtered by genre.

alter table event_sources
  add column if not exists city text,
  add column if not exists country text;

create table if not exists event_source_genres (
  source_id uuid not null references event_sources(id) on delete cascade,
  genre_id uuid not null references genres(id) on delete cascade,
  primary key (source_id, genre_id)
);

create index if not exists event_sources_country_city_idx on event_sources (country, city);
create index if not exists event_source_genres_genre_idx on event_source_genres (genre_id);
