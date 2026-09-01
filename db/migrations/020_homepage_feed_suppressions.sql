-- Durable editorial suppressions for @guestlist posts shown on homepage surfaces.
-- Suppressing an item never changes or deletes the source post or channel draft.
create table homepage_feed_suppressions (
  source text not null,
  external_id text not null,
  suppressed_by uuid references members(id) on delete set null,
  suppressed_at timestamptz not null default now(),
  primary key (source, external_id),
  check (source in ('website', 'x')),
  check (length(external_id) between 1 and 200)
);

create index homepage_feed_suppressions_suppressed_at_idx
  on homepage_feed_suppressions(suppressed_at desc);

