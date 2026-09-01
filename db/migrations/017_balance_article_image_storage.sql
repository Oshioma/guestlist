-- Storage bucket for article images we host ourselves (Pexels does not allow
-- permanent hotlinking, so a selected image is copied here).
--
-- storage.buckets only exists on Supabase. A local Postgres has no storage
-- schema, so guard the insert rather than breaking `npm run db:reset` for
-- everyone working outside Supabase.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets not present (not Supabase) — skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'balance-article-images',
    'balance-article-images',
    true,
    12582912,
    array['image/jpeg','image/png','image/webp']
  )
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
end $$;
