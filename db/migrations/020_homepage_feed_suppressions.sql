-- Editorial-only suppression for the @guestlist website feed.
-- This never deletes or alters the corresponding post on X.
create table if not exists homepage_feed_suppressions (
  draft_id uuid primary key references channel_drafts(id) on delete cascade,
  retired_by uuid references members(id) on delete set null,
  retired_at timestamptz not null default now()
);

create index if not exists homepage_feed_suppressions_retired_idx
  on homepage_feed_suppressions(retired_at desc);
