-- 014: every member needs a profile slug.
--
-- Signup never generated one (only the dev seed did), so members who
-- registered on the live site have slug = null and every link to their
-- profile renders /members/null. Backfill the same shape the app now
-- generates at signup: slugified display name + first 6 chars of the id.

update members
   set slug = coalesce(
        nullif(
          left(
            regexp_replace(
              regexp_replace(lower(display_name), '[^a-z0-9]+', '-', 'g'),
              '^-+|-+$', '', 'g'),
            40),
          ''),
        'member')
      || '-' || left(id::text, 6)
 where slug is null;
