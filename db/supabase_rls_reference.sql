-- REFERENCE ONLY — not applied to the local Postgres database.
--
-- When this schema is moved onto Supabase, members/auth_sessions are replaced
-- by auth.users + a profiles table and these RLS policies apply. Locally,
-- the same access rules are enforced in the application layer (lib/auth.ts
-- guards + per-route checks), which is the single place to swap out.
--
-- Access model:
--   * Anyone (anon) can read LIVE events and their genres/artists/images,
--     plus venues, promoters, genres, artists.
--   * Members can read/write their own member_event_actions, member_genres,
--     member_follows, and event_submissions.
--   * Going/interested rows are readable by any authenticated member
--     (powers "Who's Going"); display of the list to anon users is a
--     product decision made in the app (counts + avatars only).
--   * Only admins (profiles.role = 'admin') can write events, venues,
--     promoters, artists, event_sources, or read non-live events.
--   * analytics_events is insert-only for everyone, readable by admins.

-- Example policies (adjust table names to the Supabase profile setup):

-- alter table events enable row level security;
-- create policy "live events are public" on events
--   for select using (status = 'live');
-- create policy "admins manage events" on events
--   for all using (exists (
--     select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'
--   ));

-- alter table member_event_actions enable row level security;
-- create policy "members manage own actions" on member_event_actions
--   for all using (member_id = auth.uid()) with check (member_id = auth.uid());
-- create policy "rsvps visible to members" on member_event_actions
--   for select using (auth.role() = 'authenticated');

-- alter table event_submissions enable row level security;
-- create policy "members create submissions" on event_submissions
--   for insert with check (submitted_by = auth.uid());
-- create policy "members read own submissions" on event_submissions
--   for select using (submitted_by = auth.uid());

-- alter table analytics_events enable row level security;
-- create policy "anyone can log" on analytics_events for insert with check (true);
