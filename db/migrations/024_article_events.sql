-- Articles and events point at each other: a festival preview can cover five
-- nights, and one night can have both a preview and a review. Many-to-many,
-- with no "primary" article — an event's page shows everything written about
-- it, in publication order.
create table article_events (
  article_id uuid not null references articles(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  linked_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (article_id, event_id)
);

create index article_events_event_idx on article_events(event_id);
