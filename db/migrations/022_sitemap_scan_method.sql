-- Scans can now reach a site through its sitemap, which is the only honest
-- route into a site that renders listings in JavaScript or refuses our user
-- agent on its listing page. Widen the recorded method to allow it.
alter table source_scans drop constraint if exists source_scans_method_check;
alter table source_scans add constraint source_scans_method_check
  check (method is null or method in ('rss', 'html', 'sitemap'));
