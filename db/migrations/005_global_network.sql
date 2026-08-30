-- V2C Global Cultural Network.
--
-- Guestlist is ONE GLOBAL NETWORK: structured geography (ISO 3166 country
-- codes + IANA timezones), member cultural profiles (explicit taste stays
-- separate from inferred behaviour), rave history as first-class historical
-- entities, person-to-person connections (distinct from follows), travel
-- plans, privacy controls, blocking, an email outbox, and the analytics
-- needed to measure all of it. Nothing here assumes the UK.

-- ---------------------------------------------------------------------------
-- 1. LOCATIONS — canonical geography. City strings stay on events/venues as
-- a display cache; the location row is the identity ("London" == "London UK"
-- == "LONDON"). kind='destination' covers places that aren't a single city
-- (Ibiza the island, Zanzibar the archipelago).
-- ---------------------------------------------------------------------------

create table locations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'city' check (kind in ('city', 'region', 'country', 'destination')),
  name text not null,
  normalized_name text not null,
  slug text not null unique,
  region text,
  country_code char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'), -- ISO 3166-1 alpha-2
  country_name text,
  latitude double precision,
  longitude double precision,
  timezone text, -- IANA, e.g. Europe/London, Africa/Dar_es_Salaam
  created_at timestamptz not null default now(),
  unique (kind, normalized_name, country_code)
);

create index locations_country_idx on locations(country_code);

alter table events add column location_id uuid references locations(id) on delete set null;
alter table venues add column location_id uuid references locations(id) on delete set null;
alter table members add column home_location_id uuid references locations(id) on delete set null;

create index events_location_idx on events(location_id) where status = 'live';
create index venues_location_idx on venues(location_id);

-- Cities/places a member follows (home lives on members.home_location_id).
create table member_locations (
  member_id uuid not null references members(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, location_id)
);

-- ---------------------------------------------------------------------------
-- 2. TRAVEL PLANS — temporary relevance. Private by default; recommendation
-- code may use private plans internally but must never expose them.
-- ---------------------------------------------------------------------------

create table travel_plans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  visibility text not null default 'private' check (visibility in ('private', 'connections', 'public')),
  created_at timestamptz not null default now()
);

create index travel_plans_member_idx on travel_plans(member_id, start_date);
create index travel_plans_dates_idx on travel_plans(location_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- 3. RAVE HISTORY — historical culture is NOT forced into current venues.
-- A scene entity is a club, venue, promoter, recurring party, festival,
-- scene, or city-era that people identify with. It can optionally link to a
-- current Guestlist venue/promoter where a real lineage exists.
-- Member-added entities start 'pending' and go through admin moderation.
-- ---------------------------------------------------------------------------

create table scene_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  entity_type text not null check (entity_type in ('club', 'venue', 'promoter', 'party', 'festival', 'scene', 'city')),
  city text,
  country_code char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  country_name text,
  active_from_year smallint check (active_from_year is null or active_from_year between 1950 and 2100),
  active_to_year smallint check (active_to_year is null or active_to_year between 1950 and 2100),
  description text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references members(id) on delete set null,
  venue_id uuid references venues(id) on delete set null,     -- lineage to a current venue
  promoter_id uuid references promoters(id) on delete set null, -- lineage to a current promoter
  created_at timestamptz not null default now()
);

-- Dedupe: same normalized name + type + city + country is the same thing.
-- Two clubs called "The End" in different countries are legitimately distinct.
create unique index scene_entities_dedupe_idx on scene_entities(
  normalized_name, entity_type,
  coalesce(lower(city), ''), coalesce(country_code, '--')
);
create index scene_entities_status_idx on scene_entities(status);
create index scene_entities_country_idx on scene_entities(country_code, entity_type);

-- "I was there" — the member↔historical-entity relationship. Reused later
-- for archive events/flyers/photos by pointing more entity rows at it.
create table member_scene_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  entity_id uuid not null references scene_entities(id) on delete cascade,
  from_year smallint check (from_year is null or from_year between 1950 and 2100),
  to_year smallint check (to_year is null or to_year between 1950 and 2100),
  created_at timestamptz not null default now(),
  unique (member_id, entity_id)
);

create index member_scene_history_entity_idx on member_scene_history(entity_id);
create index member_scene_history_member_idx on member_scene_history(member_id);

-- What the member was into at that place (optional).
create table member_scene_history_genres (
  history_id uuid not null references member_scene_history(id) on delete cascade,
  genre_id uuid not null references genres(id) on delete cascade,
  primary key (history_id, genre_id)
);

-- ---------------------------------------------------------------------------
-- 4. CONNECTIONS — person-to-person, distinct from follows. CONNECT, not
-- "add friend": pending → connected / declined. Blocking is unilateral and
-- lives in its own table so it also covers non-connected members.
-- ---------------------------------------------------------------------------

create table member_connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references members(id) on delete cascade,
  addressee_id uuid not null references members(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'connected', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

-- One relationship per pair regardless of direction.
create unique index member_connections_pair_idx on member_connections(
  least(requester_id, addressee_id), greatest(requester_id, addressee_id)
);
create index member_connections_addressee_idx on member_connections(addressee_id, status);

create table member_blocks (
  blocker_id uuid not null references members(id) on delete cascade,
  blocked_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index member_blocks_blocked_idx on member_blocks(blocked_id);

create table member_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references members(id) on delete cascade,
  reported_id uuid not null references members(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index member_reports_status_idx on member_reports(status, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. PRIVACY — per-member controls. No row = defaults. Recommendation
-- explanations may only use mutually visible signals; these flags are the
-- source of truth for what is visible.
-- ---------------------------------------------------------------------------

create table member_privacy (
  member_id uuid primary key references members(id) on delete cascade,
  profile_public boolean not null default true,       -- profile visible to other members
  show_taste boolean not null default true,           -- music genres on profile
  show_history boolean not null default true,         -- rave history on profile + matching explanations
  show_history_years boolean not null default true,   -- exact years vs just the place
  show_home_city boolean not null default true,
  show_going boolean not null default true,           -- appear in Who's Going lists
  scene_discovery boolean not null default true,      -- eligible for People From Your Scene
  allow_connection_requests boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. MEMBER CULTURAL PROFILE FIELDS
-- ---------------------------------------------------------------------------

alter table members add column slug text unique;
alter table members add column bio text check (bio is null or char_length(bio) <= 600);
alter table members add column raving_since smallint
  check (raving_since is null or raving_since between 1950 and 2100);
alter table members add column now_doing text check (now_doing is null or char_length(now_doing) <= 160);
alter table members add column looking_for text check (looking_for is null or char_length(looking_for) <= 160);

-- ---------------------------------------------------------------------------
-- 7. NEGATIVE FEEDBACK — Hide / Not for me. A recommendation signal and a
-- hard exclusion from that member's recommendations.
-- ---------------------------------------------------------------------------

create table event_feedback (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  kind text not null check (kind in ('hide', 'not_for_me')),
  reason text check (reason is null or reason in
    ('wrong_music', 'too_far', 'bad_date', 'not_this_promoter', 'other')),
  created_at timestamptz not null default now(),
  unique (member_id, event_id)
);

create index event_feedback_member_idx on event_feedback(member_id);

-- ---------------------------------------------------------------------------
-- 8. EMAIL — one reusable outbox for member + promoter email. Delivery is a
-- provider behind lib/email.ts; rows are queued here and sent by the cron
-- job. Preferences below; nothing is sent that a member/promoter opted out
-- of. In development, "sent" mail is marked dev_logged.
-- ---------------------------------------------------------------------------

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  member_id uuid references members(id) on delete cascade,
  promoter_id uuid references promoters(id) on delete cascade,
  email_type text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dev_logged')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_outbox_status_idx on email_outbox(status, created_at);

create table member_email_prefs (
  member_id uuid primary key references members(id) on delete cascade,
  followed_promoter_events boolean not null default true,
  followed_venue_events boolean not null default true,
  followed_artist_events boolean not null default true,
  genre_in_home_city boolean not null default false,
  travel_events boolean not null default true,
  connection_going boolean not null default false,
  weekly_digest boolean not null default true,
  updated_at timestamptz not null default now()
);

create table promoter_email_prefs (
  promoter_id uuid primary key references promoters(id) on delete cascade,
  transactional boolean not null default true, -- invites, claim decisions, source errors
  new_events_found boolean not null default true,
  weekly_digest boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 9. PROMOTER DUPLICATE RESOLUTION — verified promoters flag duplicates of
-- their own events; destructive merges stay with Guestlist admins.
-- ---------------------------------------------------------------------------

create table event_duplicate_requests (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references promoters(id) on delete cascade,
  requested_by uuid not null references members(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  duplicate_of_event_id uuid not null references events(id) on delete cascade,
  action text not null check (action in ('same_event', 'link_source', 'keep_both', 'request_merge')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (event_id <> duplicate_of_event_id)
);

create index event_duplicate_requests_status_idx on event_duplicate_requests(status, created_at desc);

-- ---------------------------------------------------------------------------
-- 10. LANGUAGE READINESS — events keep their original language; no
-- automatic translation of names. English-first product, global content.
-- ---------------------------------------------------------------------------

alter table events add column original_language char(2); -- ISO 639-1, null = unknown/en

-- ---------------------------------------------------------------------------
-- 11. ANALYTICS — V2C product signals (reason codes ride in metadata).
-- ---------------------------------------------------------------------------

alter table analytics_events drop constraint analytics_events_event_type_check;
alter table analytics_events add constraint analytics_events_event_type_check
  check (event_type in (
    'event_viewed', 'event_saved', 'event_unsaved', 'interested', 'going',
    'rsvp_cleared', 'ticket_clicked', 'event_shared', 'promoter_viewed',
    'genre_selected', 'location_selected', 'event_submitted',
    'clubmessenger_open', 'clubmessenger_event_open',
    'presence_started', 'presence_ended', 'presence_visibility_changed',
    'friend_arrival_seen', 'friend_arrival_clicked',
    'ping_sent', 'ping_response',
    'live_room_open', 'room_message_sent',
    'going_from_clubmessenger', 'event_click_from_clubmessenger',
    'ticket_click_from_clubmessenger', 'heat_card_click',
    -- V2C
    'recommendation_impression', 'recommendation_click',
    'event_hidden', 'event_not_for_me',
    'taste_updated', 'history_added', 'scene_entity_added',
    'scene_people_impression', 'member_profile_viewed',
    'connection_requested', 'connection_accepted',
    'travel_plan_created', 'city_followed',
    'email_queued', 'email_rec_clicked'
  ));

-- ---------------------------------------------------------------------------
-- 12. PERFORMANCE — indexes for common global query dimensions that were
-- missing. (city/country/date/genre/promoter/venue indexes exist from V1.)
-- ---------------------------------------------------------------------------

create index member_event_actions_rsvp_idx on member_event_actions(event_id, rsvp)
  where rsvp is not null;
create index events_start_live_idx on events(start_at) where status = 'live';

-- ---------------------------------------------------------------------------
-- 13. BACKFILL — canonical locations from existing city/country strings.
-- Known country names → ISO codes; unknowns keep a null code (fixable in
-- admin later). Timezone comes from the events already in that city.
-- ---------------------------------------------------------------------------

create or replace function _v2c_country_code(name text) returns char(2)
language sql immutable as $$
  select case lower(coalesce(name, ''))
    when 'united kingdom' then 'GB' when 'uk' then 'GB' when 'england' then 'GB'
    when 'scotland' then 'GB' when 'wales' then 'GB'
    when 'spain' then 'ES' when 'netherlands' then 'NL' when 'germany' then 'DE'
    when 'france' then 'FR' when 'italy' then 'IT' when 'portugal' then 'PT'
    when 'croatia' then 'HR' when 'belgium' then 'BE' when 'ireland' then 'IE'
    when 'tanzania' then 'TZ' when 'south africa' then 'ZA' when 'kenya' then 'KE'
    when 'united states' then 'US' when 'usa' then 'US' when 'us' then 'US'
    when 'canada' then 'CA' when 'mexico' then 'MX' when 'brazil' then 'BR'
    when 'australia' then 'AU' when 'new zealand' then 'NZ' when 'japan' then 'JP'
    when 'thailand' then 'TH' when 'indonesia' then 'ID' when 'india' then 'IN'
    when 'united arab emirates' then 'AE' when 'austria' then 'AT'
    when 'switzerland' then 'CH' when 'czech republic' then 'CZ' when 'czechia' then 'CZ'
    when 'poland' then 'PL' when 'hungary' then 'HU' when 'romania' then 'RO'
    when 'greece' then 'GR' when 'malta' then 'MT' when 'cyprus' then 'CY'
    when 'colombia' then 'CO' when 'argentina' then 'AR' when 'chile' then 'CL'
    when 'nigeria' then 'NG' when 'ghana' then 'GH' when 'morocco' then 'MA'
    when 'egypt' then 'EG' when 'israel' then 'IL' when 'turkey' then 'TR'
    when 'sweden' then 'SE' when 'norway' then 'NO' when 'denmark' then 'DK'
    when 'finland' then 'FI' when 'iceland' then 'IS' when 'serbia' then 'RS'
    when 'south korea' then 'KR' when 'china' then 'CN' when 'singapore' then 'SG'
    else null
  end
$$;

insert into locations (kind, name, normalized_name, slug, country_code, country_name, timezone, latitude, longitude)
select 'city',
       src.city,
       lower(trim(src.city)),
       -- Bare slugs (/london, /berlin); a country suffix only when two real
       -- cities share a name.
       regexp_replace(lower(trim(src.city)), '[^a-z0-9]+', '-', 'g')
         || case when count(*) over (partition by lower(trim(src.city))) > 1
                 then coalesce('-' || lower(_v2c_country_code(src.country)), '-2')
                 else '' end,
       _v2c_country_code(src.country),
       src.country,
       src.tz,
       src.lat,
       src.lng
  from (
    select city, country, tz, lat, lng,
           row_number() over (
             partition by lower(trim(city)), _v2c_country_code(country)
             order by tz nulls last, lat nulls last
           ) as rn
      from (
        select e.city, e.country,
               mode() within group (order by e.timezone) as tz,
               avg(e.latitude) as lat, avg(e.longitude) as lng
          from events e where e.city is not null
         group by e.city, e.country
        union all
        select v.city, v.country, null, avg(v.latitude), avg(v.longitude)
          from venues v where v.city is not null
         group by v.city, v.country
        union all
        select m.home_city, m.home_country, null, null, null
          from members m where m.home_city is not null
         group by m.home_city, m.home_country
      ) all_places
  ) src
 where src.rn = 1
on conflict (kind, normalized_name, country_code) do nothing;

update events e set location_id = l.id
  from locations l
 where e.city is not null and e.location_id is null
   and l.kind = 'city' and l.normalized_name = lower(trim(e.city))
   and l.country_code is not distinct from _v2c_country_code(e.country);

update venues v set location_id = l.id
  from locations l
 where v.city is not null and v.location_id is null
   and l.kind = 'city' and l.normalized_name = lower(trim(v.city))
   and l.country_code is not distinct from _v2c_country_code(v.country);

update members m set home_location_id = l.id
  from locations l
 where m.home_city is not null and m.home_location_id is null
   and l.kind = 'city' and l.normalized_name = lower(trim(m.home_city))
   and l.country_code is not distinct from _v2c_country_code(m.home_country);

-- Member profile slugs from display names (+ short id for uniqueness).
update members set slug =
  regexp_replace(lower(display_name), '[^a-z0-9]+', '-', 'g') || '-' || left(id::text, 6)
 where slug is null;

drop function _v2c_country_code(text);
