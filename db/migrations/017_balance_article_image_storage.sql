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
