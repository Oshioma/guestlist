insert into editorial_sections (slug, name, description, active)
values (
  'events',
  'Event Articles',
  'Member-written stories, previews, reviews and perspectives about events.',
  true
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  active = excluded.active;
