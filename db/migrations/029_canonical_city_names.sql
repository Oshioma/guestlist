-- ONE CITY, ONE SPELLING.
--
-- City names are typed by people, so they arrive as "dar es salaam",
-- "LONDON", "Dar es salaam". On a page of members that reads as
-- carelessness, and it is the kind people notice first.
--
-- Two passes, in this order:
--
--   1. Names no rule gets right, listed by hand.
--   2. A general casing pass, applied ONLY to values that are visibly wrong —
--      all lower, all upper, or carrying a lowercase word that is not one of
--      the small words a city name keeps lowercase. A name already written
--      with deliberate inner capitals (McCarthy, DeSoto) is left alone: this
--      migration fixes carelessness, it does not overrule people.

create temporary table city_alias (alias text primary key, canonical text not null) on commit drop;
insert into city_alias (alias, canonical) values
  ('dar es salaam', 'Dar es Salaam'), ('dar-es-salaam', 'Dar es Salaam'),
  ('daressalaam', 'Dar es Salaam'), ('dar es-salaam', 'Dar es Salaam'),
  ('n''djamena', 'N''Djamena'),
  ('s-hertogenbosch', '''s-Hertogenbosch'), ('''s-hertogenbosch', '''s-Hertogenbosch'),
  ('sao paulo', 'São Paulo'), ('são paulo', 'São Paulo'), ('san jose', 'San José'),
  ('malmo', 'Malmö'), ('zurich', 'Zürich'), ('dusseldorf', 'Düsseldorf'),
  ('koln', 'Köln'), ('goteborg', 'Göteborg'), ('medellin', 'Medellín'),
  ('bogota', 'Bogotá'), ('brasilia', 'Brasília'), ('reykjavik', 'Reykjavík'),
  ('nimes', 'Nîmes'), ('orleans', 'Orléans'), ('quebec city', 'Québec City');

-- The same rule the application uses, in SQL. pg_temp makes it session-local,
-- so it cleans up after itself.
create or replace function pg_temp.canonical_city(raw text) returns text as $fn$
  select case
    when coalesce(btrim(raw), '') = '' then null
    else (
      select string_agg(
        case
          when ord > 1 and lower(w) = any (array[
            'es','el','al','ad','ar','as','bin','ibn',
            'de','del','della','di','da','das','dos','do','la','le','les',
            'lo','los','las','du','des','e','y',
            'van','von','der','den','ter','te','op','aan','auf','am','an',
            'bei','im','ob','zu','zur',
            'of','the','on','upon','in','under','by','and','at',
            'sur','sous','lès','aux'
          ]) then lower(w)
          else upper(left(w, 1)) || lower(substr(w, 2))
        end, ' ' order by ord)
      from regexp_split_to_table(regexp_replace(btrim(raw), '\s+', ' ', 'g'), ' ')
           with ordinality as t(w, ord)
    )
  end
$fn$ language sql immutable;

-- A value worth touching: visibly careless, and not deliberately capitalised
-- inside a word.
create or replace function pg_temp.needs_city_fix(raw text) returns boolean as $fn$
  select coalesce(btrim(raw), '') <> ''
     and raw !~ '[a-z][A-Z]'
     and raw is distinct from pg_temp.canonical_city(raw)
$fn$ language sql immutable;

-- Pass 1: the hand-written names.
update locations      set name      = a.canonical from city_alias a where kind = 'city' and lower(btrim(name)) = a.alias and name is distinct from a.canonical;
update members        set home_city = a.canonical from city_alias a where lower(btrim(home_city)) = a.alias and home_city is distinct from a.canonical;
update events         set city      = a.canonical from city_alias a where lower(btrim(city))      = a.alias and city      is distinct from a.canonical;
update venues         set city      = a.canonical from city_alias a where lower(btrim(city))      = a.alias and city      is distinct from a.canonical;
update promoters      set city      = a.canonical from city_alias a where lower(btrim(city))      = a.alias and city      is distinct from a.canonical;
update event_sources  set city      = a.canonical from city_alias a where lower(btrim(city))      = a.alias and city      is distinct from a.canonical;
update archive_events set city      = a.canonical from city_alias a where lower(btrim(city))      = a.alias and city      is distinct from a.canonical;
update scene_entities set city      = a.canonical from city_alias a where lower(btrim(city))      = a.alias and city      is distinct from a.canonical;

-- Pass 2: the general casing pass.
update locations      set name      = pg_temp.canonical_city(name)      where kind = 'city' and pg_temp.needs_city_fix(name);
update members        set home_city = pg_temp.canonical_city(home_city) where pg_temp.needs_city_fix(home_city);
update events         set city      = pg_temp.canonical_city(city)      where pg_temp.needs_city_fix(city);
update venues         set city      = pg_temp.canonical_city(city)      where pg_temp.needs_city_fix(city);
update promoters      set city      = pg_temp.canonical_city(city)      where pg_temp.needs_city_fix(city);
update event_sources  set city      = pg_temp.canonical_city(city)      where pg_temp.needs_city_fix(city);
update archive_events set city      = pg_temp.canonical_city(city)      where pg_temp.needs_city_fix(city);
update scene_entities set city      = pg_temp.canonical_city(city)      where pg_temp.needs_city_fix(city);

-- A member's displayed city should agree with the place they are actually
-- filed under, so the two can never drift apart on screen.
update members m set home_city = l.name
  from locations l
 where l.id = m.home_location_id and m.home_city is distinct from l.name;
