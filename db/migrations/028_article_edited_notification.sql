-- An author can edit their own piece after it is published — it is their
-- writing, and a typo should not need an editor. The desk hears about it
-- instead of being surprised by it later.
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'friend_arrived', 'friend_pinged_you', 'event_room_message',
    'event_alert', 'event_reminder', 'connection_going', 'close_friend_going',
    'travel_digest', 'city_digest', 'promoter_review',
    'archive_activity', 'promoter_announcement',
    'admin_new_member', 'admin_new_article', 'admin_review_waiting',
    'admin_article_edited'
  ));

-- One UNREAD "this changed" per admin per article: somebody fixing five typos
-- in a row is one thing that happened, not five.
create unique index notifications_admin_article_edited_idx
  on notifications(member_id, article_id)
  where type = 'admin_article_edited' and read_at is null;
