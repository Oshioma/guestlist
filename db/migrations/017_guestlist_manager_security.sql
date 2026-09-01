-- Record the Guestlist Manager security hardening already applied in production.
-- Idempotent so fresh environments and existing deployments converge safely.

alter table if exists event_guestlist_settings enable row level security;
alter table if exists event_guestlist_entries enable row level security;

revoke all on table event_guestlist_settings from anon, authenticated;
revoke all on table event_guestlist_entries from anon, authenticated;

grant select, insert, update, delete on table event_guestlist_settings to service_role;
grant select, insert, update, delete on table event_guestlist_entries to service_role;
grant select, insert, update, delete on table event_guestlist_settings to supabase_admin;
grant select, insert, update, delete on table event_guestlist_entries to supabase_admin;

create index if not exists idx_guestlist_entries_member
  on event_guestlist_entries(member_id) where member_id is not null;
create index if not exists idx_guestlist_entries_created_by
  on event_guestlist_entries(created_by_member_id) where created_by_member_id is not null;
create index if not exists idx_guestlist_settings_updated_by
  on event_guestlist_settings(updated_by_member_id) where updated_by_member_id is not null;
