-- V2D Retention Engine: live email delivery, member event alerts, in-app
-- notification centre, deduplication + fatigue control, unsubscribe,
-- admin safety switches. Builds on the V2C outbox — no second email system.

-- ---------------------------------------------------------------------------
-- 1. EMAIL OUTBOX → full delivery lifecycle.
--    queued(pending) → processing → sent / failed / suppressed / bounced
--    dev_logged remains the no-credentials outcome. dedupe_key makes every
--    queue operation idempotent: running a job twice cannot double-send.
-- ---------------------------------------------------------------------------

alter table email_outbox drop constraint email_outbox_status_check;
alter table email_outbox add constraint email_outbox_status_check
  check (status in ('pending', 'processing', 'sent', 'failed', 'suppressed', 'bounced', 'dev_logged'));

alter table email_outbox add column body_html text;
alter table email_outbox add column attempt_count integer not null default 0;
alter table email_outbox add column last_attempt_at timestamptz;
alter table email_outbox add column provider_message_id text;
alter table email_outbox add column error_category text
  check (error_category is null or error_category in ('temporary', 'permanent'));
alter table email_outbox add column dedupe_key text;

create unique index email_outbox_dedupe_idx on email_outbox(dedupe_key)
  where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- 2. SUPPRESSIONS — the unsubscribe ledger. Checked at queue AND send time.
--    scope 'all' stops every non-essential email; a type scope stops one
--    alert family. Transactional/security email is classified separately in
--    code and never suppressed by 'recommendations'.
-- ---------------------------------------------------------------------------

create table email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  member_id uuid references members(id) on delete cascade,
  scope text not null default 'all',
  source text not null default 'unsubscribe'
    check (source in ('unsubscribe', 'bounce', 'admin')),
  created_at timestamptz not null default now(),
  unique (email, scope)
);

create index email_suppressions_email_idx on email_suppressions(email);

-- ---------------------------------------------------------------------------
-- 3. NOTIFICATIONS → one centre for club + retention alerts.
--    event_alert is deliberately ONE type: an event that matches five of a
--    member's signals produces ONE notification whose payload carries every
--    reason, priority-ordered. Structured data, not pre-rendered text.
-- ---------------------------------------------------------------------------

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    -- Club Messenger (V1)
    'friend_arrived', 'friend_pinged_you', 'event_room_message',
    -- Retention engine (V2D)
    'event_alert',        -- new relevant event (multi-reason, deduped per event)
    'event_reminder',     -- you're going, it's tomorrow
    'connection_going',   -- a connection marked Going on an event you care about
    'travel_digest',      -- events found for an upcoming trip
    'city_digest',        -- new events in a followed city
    'promoter_review'     -- (team members) events waiting for review
  ));

alter table notifications add column promoter_id uuid references promoters(id) on delete cascade;
alter table notifications add column emailed_at timestamptz; -- delivery state per channel

-- Dedupe: one event_alert / event_reminder per member per event, ever.
create unique index notifications_event_alert_dedupe_idx
  on notifications(member_id, type, event_id)
  where type in ('event_alert', 'event_reminder') and event_id is not null;

-- One connection_going per member+actor+event.
create unique index notifications_connection_going_dedupe_idx
  on notifications(member_id, actor_member_id, event_id)
  where type = 'connection_going';

-- ---------------------------------------------------------------------------
-- 4. MEMBER ALERT PREFERENCES — extend the existing member_email_prefs
--    (no parallel system). Conservative defaults: high-intent follows are
--    on; broad genre/city signals default to digest, not instant email.
-- ---------------------------------------------------------------------------

alter table member_email_prefs add column event_reminders boolean not null default true;
alter table member_email_prefs add column alert_frequency text not null default 'daily'
  check (alert_frequency in ('instant', 'daily', 'weekly', 'off'));

-- ---------------------------------------------------------------------------
-- 5. CLOSE FRIENDS FOUNDATION — structural tier only (no UI yet); a future
--    close-friend layer must not require a schema break.
-- ---------------------------------------------------------------------------

alter table member_connections add column tier text not null default 'connection'
  check (tier in ('connection', 'close_friend'));

-- ---------------------------------------------------------------------------
-- 6. SYSTEM SETTINGS — admin safety switches. Stopping runaway email must
--    never require a deployment.
-- ---------------------------------------------------------------------------

create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references members(id) on delete set null
);

-- ---------------------------------------------------------------------------
-- 7. ANALYTICS — retention signals.
-- ---------------------------------------------------------------------------

alter table analytics_events drop constraint analytics_events_event_type_check;
alter table analytics_events add constraint analytics_events_event_type_check
  check (event_type in (
    'event_viewed', 'event_saved', 'event_unsaved', 'interested', 'going',
    'rsvp_cleared', 'ticket_clicked', 'event_shared', 'promoter_viewed',
    'genre_selected', 'location_selected', 'event_submitted',
    'clubmessenger_open', 'clubmessenger_event_open',
    'presence_started', 'presence_ended', 'presence_visibility_changed',
    'friend_arrival_seen', 'friend_arrival_clicked',
    'ping_sent', 'ping_response',
    'live_room_open', 'room_message_sent',
    'going_from_clubmessenger', 'event_click_from_clubmessenger',
    'ticket_click_from_clubmessenger', 'heat_card_click',
    'recommendation_impression', 'recommendation_click',
    'event_hidden', 'event_not_for_me',
    'taste_updated', 'history_added', 'scene_entity_added',
    'scene_people_impression', 'member_profile_viewed',
    'connection_requested', 'connection_accepted',
    'travel_plan_created', 'city_followed',
    'email_queued', 'email_rec_clicked',
    -- V2D
    'alert_created', 'email_sent', 'email_failed',
    'email_unsubscribed', 'notification_clicked'
  ));

create index notifications_email_pending_idx on notifications(member_id, created_at)
  where emailed_at is null;
