-- ADMIN NOTIFICATIONS.
--
-- Admins were the only people the notification centre never spoke to. A
-- member joined, an article was submitted, fifty events arrived from a scan,
-- and nothing said so — you found out by opening the queue and looking.
--
-- Two shapes, deliberately:
--
--   admin_new_member / admin_new_article  — one notification per happening.
--     These are rare and each one is worth a look on its own.
--
--   admin_review_waiting — a ROLLING digest, never one per event. A scan can
--     bring in fifty events at once; fifty bells would make the bell
--     worthless. There is at most one unread digest per admin at a time, and
--     it is refreshed in place as the queues change.
alter table notifications add column article_id uuid references articles(id) on delete cascade;

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'friend_arrived', 'friend_pinged_you', 'event_room_message',
    'event_alert', 'event_reminder', 'connection_going', 'close_friend_going',
    'travel_digest', 'city_digest', 'promoter_review',
    'archive_activity', 'promoter_announcement',
    'admin_new_member', 'admin_new_article', 'admin_review_waiting'
  ));

-- One notification per admin per new member, ever.
create unique index notifications_admin_new_member_idx
  on notifications(member_id, actor_member_id)
  where type = 'admin_new_member';

-- One per admin per article, ever.
create unique index notifications_admin_new_article_idx
  on notifications(member_id, article_id)
  where type = 'admin_new_article';

-- At most one UNREAD review digest per admin. Reading it clears the way for
-- the next one, so the bell reflects "there is work" rather than a history of
-- every time the number changed.
create unique index notifications_admin_review_unread_idx
  on notifications(member_id)
  where type = 'admin_review_waiting' and read_at is null;

create index notifications_article_idx on notifications(article_id) where article_id is not null;
