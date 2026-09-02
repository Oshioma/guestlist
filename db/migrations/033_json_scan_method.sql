-- A scan can now read a JSON listing.
--
-- ADE's programme endpoint answers with `content-type: text/html` and a body
-- that is a JSON array of events. The scanner reads the body rather than the
-- header, so 'json' is a method a scan can honestly record — and a scan whose
-- method it cannot record is a scan that fails at the last step, after the
-- work is already done.
alter table source_scans drop constraint if exists source_scans_method_check;
alter table source_scans add constraint source_scans_method_check
  check (method is null or method in ('rss', 'html', 'sitemap', 'json'));
