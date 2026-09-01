-- "IT" is not the name of a country.
--
-- Scraped pages and feeds sometimes give an ISO 3166-1 alpha-2 code where a
-- country name belongs, and /explore falls back to a location's country_code
-- when country_name is empty — so a bare "IT" was reaching the screen as a
-- country of its own, sitting beside Italy. Migration 025 folded the spelling
-- variants together; this does the same for the codes.
create temporary table country_code_name (code text primary key, canonical text not null) on commit drop;
insert into country_code_name (code, canonical) values
  ('gb', 'United Kingdom'), ('ie', 'Ireland'), ('fr', 'France'), ('de', 'Germany'),
  ('it', 'Italy'), ('es', 'Spain'), ('pt', 'Portugal'), ('nl', 'Netherlands'),
  ('be', 'Belgium'), ('lu', 'Luxembourg'), ('ch', 'Switzerland'), ('at', 'Austria'),
  ('cz', 'Czechia'), ('pl', 'Poland'), ('hu', 'Hungary'), ('ro', 'Romania'),
  ('bg', 'Bulgaria'), ('gr', 'Greece'), ('hr', 'Croatia'), ('si', 'Slovenia'),
  ('sk', 'Slovakia'), ('rs', 'Serbia'), ('me', 'Montenegro'), ('al', 'Albania'),
  ('mt', 'Malta'), ('cy', 'Cyprus'), ('se', 'Sweden'), ('no', 'Norway'),
  ('dk', 'Denmark'), ('fi', 'Finland'), ('is', 'Iceland'), ('ee', 'Estonia'),
  ('lv', 'Latvia'), ('lt', 'Lithuania'), ('ua', 'Ukraine'), ('tr', 'Turkey'),
  ('il', 'Israel'), ('ae', 'United Arab Emirates'), ('sa', 'Saudi Arabia'),
  ('eg', 'Egypt'), ('ma', 'Morocco'), ('tn', 'Tunisia'), ('za', 'South Africa'),
  ('ng', 'Nigeria'), ('gh', 'Ghana'), ('ke', 'Kenya'), ('tz', 'Tanzania'),
  ('ug', 'Uganda'), ('sn', 'Senegal'), ('ci', 'Côte d''Ivoire'),
  ('us', 'United States'), ('ca', 'Canada'), ('mx', 'Mexico'), ('br', 'Brazil'),
  ('ar', 'Argentina'), ('cl', 'Chile'), ('co', 'Colombia'), ('pe', 'Peru'),
  ('uy', 'Uruguay'), ('au', 'Australia'), ('nz', 'New Zealand'), ('jp', 'Japan'),
  ('kr', 'South Korea'), ('cn', 'China'), ('hk', 'Hong Kong'), ('tw', 'Taiwan'),
  ('sg', 'Singapore'), ('th', 'Thailand'), ('vn', 'Vietnam'), ('id', 'Indonesia'),
  ('my', 'Malaysia'), ('ph', 'Philippines'), ('in', 'India'), ('jm', 'Jamaica'),
  ('tt', 'Trinidad and Tobago'), ('bb', 'Barbados'), ('cu', 'Cuba'),
  ('do', 'Dominican Republic');

-- Only the NAME columns are rewritten. locations.country_code is an ISO code
-- on purpose and stays exactly as it is.
update locations set country_name = c.canonical
  from country_code_name c
 where lower(trim(country_name)) = c.code;
update events set country = c.canonical
  from country_code_name c
 where lower(trim(country)) = c.code;
update event_sources set country = c.canonical
  from country_code_name c
 where lower(trim(country)) = c.code;
update promoters set country = c.canonical
  from country_code_name c
 where lower(trim(country)) = c.code;
update venues set country = c.canonical
  from country_code_name c
 where lower(trim(country)) = c.code;
update members set home_country = c.canonical
  from country_code_name c
 where lower(trim(home_country)) = c.code;
update archive_events set country_name = c.canonical
  from country_code_name c
 where lower(trim(country_name)) = c.code;
update scene_entities set country_name = c.canonical
  from country_code_name c
 where lower(trim(country_name)) = c.code;

-- A location that has a code but no name at all can be given one now, which
-- is what stops /explore falling back to the bare code in the first place.
update locations set country_name = c.canonical
  from country_code_name c
 where country_name is null and lower(trim(country_code)) = c.code;
