-- WHO SAID YES.
--
-- A guestlist entry recorded who created it, which for a member's own request
-- is the member themselves — so the row could never answer the one question a
-- door actually asks: who in this organisation put this person on the list?
-- That is the fact the QR code on the confirmation email carries, and it needs
-- somewhere to live.

alter table event_guestlist_entries
  add column if not exists confirmed_by_member_id uuid references members(id) on delete set null;
alter table event_guestlist_entries
  add column if not exists confirmed_at timestamptz;

-- Entries that are already confirmed keep their history: the best available
-- answer for an old row is whoever created it, at the time it last changed.
update event_guestlist_entries
   set confirmed_by_member_id = coalesce(confirmed_by_member_id, created_by_member_id),
       confirmed_at = coalesce(confirmed_at, updated_at)
 where status = 'confirmed';
