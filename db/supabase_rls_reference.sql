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

-- ── Club Messenger (migration 004) ──────────────────────────────────────────
-- Presence privacy is THE hard requirement: a presence row must only be
-- selectable by its owner, by mutual friends (visibility = 'friends'), or by
-- people going/present at the same event (visibility = 'event'). Invisible
-- rows are owner-only. The server-side predicate lives in
-- lib/clubmessenger.ts presenceVisibleSql(); these policies are its RLS
-- equivalent for a Supabase Auth migration.

-- create or replace function is_friend(a uuid, b uuid) returns boolean
-- language sql stable security definer as $$
--   select exists (select 1 from member_follows f1 where f1.member_id = a
--                    and f1.entity_type = 'member' and f1.entity_id = b)
--      and exists (select 1 from member_follows f2 where f2.member_id = b
--                    and f2.entity_type = 'member' and f2.entity_id = a)
-- $$;

-- alter table event_presence enable row level security;
-- create policy "own presence" on event_presence
--   for all using (member_id = auth.uid()) with check (member_id = auth.uid());
-- create policy "friends see friends presence" on event_presence
--   for select using (visibility = 'friends' and is_friend(auth.uid(), member_id));
-- create policy "event scope presence" on event_presence
--   for select using (visibility = 'event' and (
--     exists (select 1 from member_event_actions mea where mea.member_id = auth.uid()
--               and mea.event_id = event_presence.event_id and mea.rsvp = 'going')
--     or exists (select 1 from event_presence p2 where p2.member_id = auth.uid()
--               and p2.event_id = event_presence.event_id
--               and p2.left_at is null and p2.expires_at > now())));

-- alter table event_room_messages enable row level security;
-- create policy "room access read" on event_room_messages
--   for select using (deleted_at is null and (
--     exists (select 1 from member_event_actions mea where mea.member_id = auth.uid()
--               and mea.event_id = event_room_messages.event_id and mea.rsvp = 'going')
--     or exists (select 1 from event_presence p where p.member_id = auth.uid()
--               and p.event_id = event_room_messages.event_id
--               and p.arrived_at > now() - interval '18 hours')));
-- create policy "room access write" on event_room_messages
--   for insert with check (member_id = auth.uid() /* + same access predicate */);

-- alter table club_pings enable row level security;
-- create policy "pings visible to participants" on club_pings
--   for select using (from_member = auth.uid() or to_member = auth.uid());
-- create policy "send pings" on club_pings
--   for insert with check (from_member = auth.uid());
-- create policy "answer pings" on club_pings
--   for update using (to_member = auth.uid());

-- alter table notifications enable row level security;
-- create policy "own notifications" on notifications
--   for select using (member_id = auth.uid());
-- create policy "mark own read" on notifications
--   for update using (member_id = auth.uid());
-- (inserts happen server-side with the service role only)

-- alter table notification_preferences enable row level security;
-- create policy "own preferences" on notification_preferences
--   for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- alter table room_message_reports enable row level security;
-- create policy "report as yourself" on room_message_reports
--   for insert with check (reporter_id = auth.uid());
-- create policy "admins read reports" on room_message_reports
--   for select using (exists (
--     select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Cleanup job (run on a schedule; presence is temporal data):
--   update event_presence set left_at = expires_at
--    where left_at is null and expires_at < now();
--   delete from event_presence where arrived_at < now() - interval '30 days';
--   delete from event_room_messages where created_at < now() - interval '30 days';
--   delete from club_pings where created_at < now() - interval '30 days';
--   delete from notifications where created_at < now() - interval '60 days';

-- ── V2C Global network (migration 005) ──────────────────────────────────────
-- Server-side enforcement lives in lib/privacy.ts, lib/connections.ts and
-- lib/scene.ts; these are the equivalent policies for a Supabase Auth move.

-- alter table member_privacy enable row level security;
-- create policy "own privacy" on member_privacy
--   for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- alter table member_connections enable row level security;
-- create policy "participants see their connections" on member_connections
--   for select using (requester_id = auth.uid() or addressee_id = auth.uid());
-- create policy "request as yourself" on member_connections
--   for insert with check (requester_id = auth.uid());
-- create policy "addressee responds" on member_connections
--   for update using (addressee_id = auth.uid());

-- alter table member_blocks enable row level security;
-- create policy "own blocks" on member_blocks
--   for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- alter table member_scene_history enable row level security;
-- create policy "own history writes" on member_scene_history
--   for all using (member_id = auth.uid()) with check (member_id = auth.uid());
-- create policy "visible history reads" on member_scene_history
--   for select using (member_id = auth.uid() or coalesce((
--     select mp.profile_public and mp.show_history
--       from member_privacy mp where mp.member_id = member_scene_history.member_id), true));

-- alter table travel_plans enable row level security;
-- create policy "own travel" on travel_plans
--   for all using (member_id = auth.uid()) with check (member_id = auth.uid());
-- (public/connections travel visibility is served through the API layer;
--  recommendation reads run under the service role.)

-- alter table event_feedback enable row level security;
-- create policy "own feedback" on event_feedback
--   for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- alter table member_locations enable row level security;
-- create policy "own places" on member_locations
--   for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- alter table member_email_prefs enable row level security;
-- create policy "own email prefs" on member_email_prefs
--   for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- locations + scene_entities (approved) are public reference data:
-- alter table locations enable row level security;
-- create policy "places are public" on locations for select using (true);
-- alter table scene_entities enable row level security;
-- create policy "approved entities public" on scene_entities
--   for select using (status = 'approved' or created_by = auth.uid());
-- (writes via API/service role only; email_outbox, member_reports and
--  event_duplicate_requests are service-role/admin surfaces.)

-- ── V2D Retention engine (migration 006) ────────────────────────────────────
-- email_outbox, email_suppressions and system_settings are service-role /
-- admin surfaces — no member-facing policies (never selectable by clients).
-- notifications already carries owner-only policies above; the new alert
-- types inherit them. member_email_prefs is covered by "own email prefs".
-- Unsubscribe links are authenticated by HMAC token, not by session.
