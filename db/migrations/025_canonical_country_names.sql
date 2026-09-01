-- One country, one name. "UK", "England", "US" and "USA" were arriving from
-- scraped pages, admin forms and member profiles as separate countries, which
-- split a single place across several headings on /explore and several
-- sections on the admin sources page.
--
-- Folding England, Scotland, Wales and Northern Ireland into the United
-- Kingdom is a deliberate call: it is the country a listing means when it
-- says it, and the alternative is one scene shown as four.
create temporary table country_alias (alias text primary key, canonical text not null) on commit drop;
insert into country_alias (alias, canonical) values
  ('uk', 'United Kingdom'),
  ('u.k.', 'United Kingdom'),
  ('gb', 'United Kingdom'),
  ('gbr', 'United Kingdom'),
  ('britain', 'United Kingdom'),
  ('great britain', 'United Kingdom'),
  ('england', 'United Kingdom'),
  ('scotland', 'United Kingdom'),
  ('wales', 'United Kingdom'),
  ('northern ireland', 'United Kingdom'),
  ('united kingdom of great britain and northern ireland', 'United Kingdom'),
  ('us', 'United States'),
  ('u.s.', 'United States'),
  ('usa', 'United States'),
  ('u.s.a.', 'United States'),
  ('america', 'United States'),
  ('united states of america', 'United States'),
  ('holland', 'Netherlands'),
  ('the netherlands', 'Netherlands'),
  ('nl', 'Netherlands'),
  ('deutschland', 'Germany'),
  ('de', 'Germany'),
  ('italia', 'Italy'),
  ('espana', 'Spain'),
  ('españa', 'Spain'),
  ('es', 'Spain'),
  ('fr', 'France'),
  ('ie', 'Ireland'),
  ('republic of ireland', 'Ireland'),
  ('czech republic', 'Czechia'),
  ('south africa (rsa)', 'South Africa'),
  ('united republic of tanzania', 'Tanzania');

update locations set country_name = a.canonical
  from country_alias a
 where lower(trim(country_name)) = a.alias and country_name is distinct from a.canonical;
update events set country = a.canonical
  from country_alias a
 where lower(trim(country)) = a.alias and country is distinct from a.canonical;
update event_sources set country = a.canonical
  from country_alias a
 where lower(trim(country)) = a.alias and country is distinct from a.canonical;
update promoters set country = a.canonical
  from country_alias a
 where lower(trim(country)) = a.alias and country is distinct from a.canonical;
update venues set country = a.canonical
  from country_alias a
 where lower(trim(country)) = a.alias and country is distinct from a.canonical;
update members set home_country = a.canonical
  from country_alias a
 where lower(trim(home_country)) = a.alias and home_country is distinct from a.canonical;
update archive_events set country_name = a.canonical
  from country_alias a
 where lower(trim(country_name)) = a.alias and country_name is distinct from a.canonical;
update scene_entities set country_name = a.canonical
  from country_alias a
 where lower(trim(country_name)) = a.alias and country_name is distinct from a.canonical;
