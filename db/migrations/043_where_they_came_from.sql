-- WHERE THE TRAFFIC CAME FROM.
--
-- The analytics page could say 550 people were here and could not say a word
-- about where any of them came from, because we never wrote it down. Two
-- columns fix that.
--
-- Deliberately coarse, because the alternative needs a consent banner:
--
--   referrer_host  the sending site's hostname only — 'instagram.com', never
--                  the full URL. A full referrer says which post, which search
--                  term, which private page somebody was reading. The host
--                  answers "where from" and knows nothing else.
--   country        two letters, from the CDN edge header. No IP is stored,
--                  no city, no coordinates.
--
-- Nothing here is more identifying than the random browser id already in the
-- table, which is the line we said we would not cross.

alter table analytics_events add column if not exists referrer_host text;
alter table analytics_events add column if not exists country text;

-- Both feed one grouped query over a date window, which is the only way they
-- are ever read.
create index if not exists idx_analytics_referrer
  on analytics_events(referrer_host, created_at desc) where referrer_host is not null;
create index if not exists idx_analytics_country
  on analytics_events(country, created_at desc) where country is not null;
