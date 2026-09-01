-- A visible first-person memory means its contributor was at the event.
-- Backfill existing memories without changing any attendance/privacy choice
-- the member has already made.
insert into archive_attendance (
  member_id,
  archive_event_id,
  certainty,
  visibility
)
select distinct
  member_id,
  archive_event_id,
  'sure',
  'public'
from archive_memories
where status = 'visible'
on conflict (member_id, archive_event_id) do nothing;

