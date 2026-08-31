-- Guestlist editorial publishing system. Balance is the first section, not a one-off table.

create table editorial_sections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into editorial_sections (slug, name, description, sort_order)
values ('balance', 'Balance', 'Ideas, experiences and perspectives from the Guestlist community.', 10)
on conflict (slug) do nothing;

create table articles (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references editorial_sections(id) on delete restrict,
  author_id uuid not null references members(id) on delete cascade,
  slug text not null unique,
  title text not null default '',
  subtitle text,
  excerpt text,
  body text not null default '',
  article_type text not null default 'story' check (article_type in ('story','opinion','guide','interview','reflection','photo-essay','list')),
  status text not null default 'draft' check (status in ('draft','submitted','changes_requested','approved','published','rejected','archived')),
  hero_image_url text,
  hero_image_alt text,
  image_provider text,
  image_credit text,
  image_source_url text,
  image_license_note text,
  tags text[] not null default '{}',
  reading_minutes integer not null default 1,
  featured boolean not null default false,
  admin_note text,
  submitted_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index articles_section_status_published_idx on articles(section_id, status, published_at desc);
create index articles_author_updated_idx on articles(author_id, updated_at desc);
create index articles_status_updated_idx on articles(status, updated_at desc);
create index articles_tags_gin_idx on articles using gin(tags);

create table article_views (
  id bigserial primary key,
  article_id uuid not null references articles(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  viewed_at timestamptz not null default now()
);
create index article_views_article_idx on article_views(article_id, viewed_at desc);

create table article_revisions (
  id bigserial primary key,
  article_id uuid not null references articles(id) on delete cascade,
  editor_id uuid references members(id) on delete set null,
  title text not null,
  subtitle text,
  excerpt text,
  body text not null,
  hero_image_url text,
  tags text[] not null default '{}',
  status text not null,
  created_at timestamptz not null default now()
);
create index article_revisions_article_idx on article_revisions(article_id, created_at desc);
