-- GUESTLIST MEMBERSHIP — £30/month, GET IN FREE — and GUESTLIST MARKET.
--
-- Four things live here:
--
--   1. Membership & billing. The plan table allows more tiers later without a
--      schema change; only one row is seeded. `memberships` is the ONLY source
--      of truth for who is a member — the browser never decides that. Stripe
--      events land in an append-only ledger keyed by Stripe's own event id so
--      a replayed webhook is a no-op. A waitlist collects demand before
--      payments are switched on.
--
--   2. GET ME IN. A member asks Guestlist to get them into an event. The
--      request carries everything the desk needs to fulfil it and everything
--      finance needs afterwards (what it cost us, what it was worth). When it
--      is confirmed it links to a real row on the promoter's guestlist, so the
--      member is on the same door list as everyone else.
--
--   3. Promoter relationships. Every request is a reason to talk to a
--      promoter; the outreach ledger records each conversation and its
--      outcome, and the promoter row gains the state of that relationship
--      (from "never contacted" to "gives us a standing allocation").
--      Counts — requests generated, members sent, places supplied, value
--      delivered — are DERIVED from member_access_requests, never stored.
--
--   4. Market. Independent businesses Guestlist has chosen, each with a
--      member offer. Offers are typed (percentage, fixed, free item, upgrade,
--      package, member-only, other) — the schema is not built around a
--      percentage column. A claim mints a single-use code; there is no
--      permanent public code to copy and share.
--
-- Every new table is locked with RLS and granted only to the service role,
-- matching 017_guestlist_manager_security.sql: the app authorises in code.

-- ---------------------------------------------------------------------------
-- 1. Membership & billing
-- ---------------------------------------------------------------------------

create table if not exists membership_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price_pence integer not null check (price_pence >= 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  interval text not null default 'month' check (interval in ('month', 'year')),
  stripe_price_id text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into membership_plans (code, name, price_pence, currency, interval, sort_order)
values ('member_monthly', 'Guestlist Membership', 3000, 'GBP', 'month', 0)
on conflict (code) do nothing;

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  plan_id uuid not null references membership_plans(id),
  status text not null default 'incomplete'
    check (status in ('incomplete', 'trialing', 'active', 'past_due', 'cancelled', 'expired')),
  -- Who is paying. Most members pay Stripe; some are ours to give — DJs,
  -- promoters, journalists, partners, competition winners. A complimentary
  -- membership may carry an expiry in current_period_end; a lifetime one
  -- never expires. Stripe never overrides a gift.
  billing_source text not null default 'stripe'
    check (billing_source in ('stripe', 'complimentary', 'lifetime', 'manual')),
  granted_by_member_id uuid references members(id) on delete set null,
  grant_note text,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  -- The first time this person became a paying member. Survives lapses and
  -- rejoins: "Member since 2026" should stay true.
  member_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One membership row per person. Rejoining reuses the row.
create unique index if not exists uq_memberships_member on memberships(member_id);
create index if not exists idx_memberships_status on memberships(status);
create index if not exists idx_memberships_stripe_customer on memberships(stripe_customer_id)
  where stripe_customer_id is not null;

create table if not exists membership_billing_events (
  id bigint generated always as identity primary key,
  stripe_event_id text not null unique,
  event_type text not null,
  member_id uuid references members(id) on delete set null,
  membership_id uuid references memberships(id) on delete set null,
  amount_pence integer,
  currency text,
  payload jsonb not null default '{}',
  processed_at timestamptz not null default now()
);

create index if not exists idx_billing_events_member on membership_billing_events(member_id, processed_at desc);
create index if not exists idx_billing_events_type on membership_billing_events(event_type, processed_at desc);

-- Demand before launch. A signed-in member joins with one press; a visitor
-- leaves an email. One row per address.
create table if not exists membership_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  member_id uuid references members(id) on delete set null,
  source text not null default 'membership_page',
  created_at timestamptz not null default now()
);

create unique index if not exists uq_membership_waitlist_email on membership_waitlist(lower(email));

-- ---------------------------------------------------------------------------
-- 2. GET ME IN
-- ---------------------------------------------------------------------------

create table if not exists member_access_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  promoter_id uuid references promoters(id) on delete set null,
  places integer not null default 1 check (places between 1 and 10),
  member_note text,
  status text not null default 'requested'
    check (status in (
      'requested', 'reviewing', 'contacting_promoter',
      'confirmed_free', 'discounted', 'purchased_by_guestlist',
      'waitlisted', 'unavailable', 'cancelled', 'attended'
    )),
  fulfilment_method text
    check (fulfilment_method is null or fulfilment_method in (
      'promoter_guestlist', 'venue', 'guestlist_allocation', 'purchased', 'partner', 'other'
    )),
  -- WHY it did not happen is the business intelligence: forty requests we
  -- could not fulfil because nobody had the promoter's number is a different
  -- problem from a £300 VIP ticket.
  decline_reason text
    check (decline_reason is null or decline_reason in (
      'promoter_declined', 'no_allocation', 'sold_out', 'too_expensive',
      'no_response', 'too_late', 'fair_use', 'other'
    )),
  -- Money is integer minor units + an explicit currency. Never floats.
  guestlist_cost_pence integer not null default 0 check (guestlist_cost_pence >= 0),
  ticket_value_pence integer check (ticket_value_pence is null or ticket_value_pence >= 0),
  member_price_pence integer check (member_price_pence is null or member_price_pence >= 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  -- What the member reads. The operational status stays internal.
  member_message text,
  admin_notes text,
  guestlist_entry_id uuid references event_guestlist_entries(id) on delete set null,
  handled_by_member_id uuid references members(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  responded_at timestamptz,
  updated_at timestamptz not null default now()
);

-- One live request per member per event; closed ones may accumulate.
create unique index if not exists uq_access_request_live
  on member_access_requests(event_id, member_id)
  where status in ('requested', 'reviewing', 'contacting_promoter', 'waitlisted',
                   'confirmed_free', 'discounted', 'purchased_by_guestlist');

create index if not exists idx_access_requests_status on member_access_requests(status, requested_at desc);
create index if not exists idx_access_requests_member on member_access_requests(member_id, requested_at desc);
create index if not exists idx_access_requests_event on member_access_requests(event_id);
create index if not exists idx_access_requests_promoter on member_access_requests(promoter_id)
  where promoter_id is not null;

create table if not exists member_access_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references member_access_requests(id) on delete cascade,
  actor_member_id uuid references members(id) on delete set null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_access_request_events_request
  on member_access_request_events(request_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Promoter relationships — EXTEND promoters, never duplicate them.
-- ---------------------------------------------------------------------------

alter table promoters add column if not exists contact_email text;
alter table promoters add column if not exists contact_phone text;
alter table promoters add column if not exists relationship_status text not null default 'none'
  check (relationship_status in ('none', 'contacted', 'responding', 'supplying', 'partner', 'declined'));
alter table promoters add column if not exists relationship_notes text;
-- A standing allocation: "4 places on the list every Saturday" — the end state
-- of the loop. Free text, because every promoter phrases it differently.
alter table promoters add column if not exists standard_allocation text;
alter table promoters add column if not exists allocation_notes text;
alter table promoters add column if not exists allocation_agreed_at timestamptz;

create table if not exists promoter_contacts (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references promoters(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 140),
  role text,
  email text,
  phone text,
  instagram text,
  notes text,
  is_primary boolean not null default false,
  created_by_member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_promoter_contacts_promoter on promoter_contacts(promoter_id);

-- Every conversation with a promoter, and what came of it.
create table if not exists promoter_outreach (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references promoters(id) on delete cascade,
  request_id uuid references member_access_requests(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  actor_member_id uuid references members(id) on delete set null,
  channel text not null default 'email'
    check (channel in ('email', 'phone', 'whatsapp', 'instagram', 'in_person', 'other')),
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  summary text not null,
  outcome text not null default 'pending'
    check (outcome in ('pending', 'free_places', 'discount', 'declined', 'no_response')),
  places_offered integer check (places_offered is null or places_offered >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_promoter_outreach_promoter on promoter_outreach(promoter_id, created_at desc);
create index if not exists idx_promoter_outreach_request on promoter_outreach(request_id)
  where request_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Guestlist Market
-- ---------------------------------------------------------------------------

create table if not exists market_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0,
  active boolean not null default true
);

-- The taxonomy is Guestlist's. Businesses pick from it; they do not extend it.
insert into market_categories (name, slug, sort_order) values
  ('Restaurant', 'restaurant', 10), ('Bar', 'bar', 20), ('Café', 'cafe', 30),
  ('Clothing', 'clothing', 40), ('Record shop', 'record-shop', 50),
  ('Music equipment', 'music-equipment', 60), ('Studio', 'studio', 70),
  ('Hotel', 'hotel', 80), ('Wellness', 'wellness', 90),
  ('Experience', 'experience', 100), ('Creative', 'creative', 110),
  ('Independent brand', 'independent-brand', 120), ('Local service', 'local-service', 130)
on conflict (slug) do nothing;

create table if not exists market_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  slug text not null unique,
  tagline text,
  description text,
  logo_url text,
  hero_image_url text,
  category_id uuid references market_categories(id) on delete set null,
  location_id uuid references locations(id) on delete set null,
  city text,
  country text,
  address text,
  website text,
  socials jsonb not null default '{}',
  contact_name text,
  contact_email text,
  -- Nobody appears in the Market until Guestlist says so.
  status text not null default 'pending'
    check (status in ('invited', 'applied', 'pending', 'approved', 'rejected', 'paused')),
  featured boolean not null default false,
  sort_order integer not null default 0,
  admin_notes text,
  approved_at timestamptz,
  approved_by_member_id uuid references members(id) on delete set null,
  created_by_member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_market_businesses_status on market_businesses(status, featured desc, sort_order, name);
create index if not exists idx_market_businesses_category on market_businesses(category_id);

-- Who runs a business on Guestlist. Same shape as promoter_members: one
-- account, several businesses; one business, several people.
create table if not exists market_business_members (
  business_id uuid not null references market_businesses(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (business_id, member_id)
);

create index if not exists idx_market_business_members_member on market_business_members(member_id);

create table if not exists market_offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references market_businesses(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 140),
  offer_type text not null default 'other'
    check (offer_type in ('percentage', 'fixed', 'free_item', 'free_upgrade', 'package', 'member_only', 'other')),
  discount_percent integer check (discount_percent is null or discount_percent between 1 and 100),
  discount_amount_pence integer check (discount_amount_pence is null or discount_amount_pence > 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  description text,
  redemption_instructions text,
  terms text,
  -- How the member proves it. V1 mints a single-use code; the column leaves
  -- room for QR, online codes and "show your membership" later.
  redemption_method text not null default 'code'
    check (redemption_method in ('code', 'show_membership', 'online_code', 'qr', 'other')),
  -- How long a minted code stays valid once claimed.
  claim_validity_minutes integer not null default 1440 check (claim_validity_minutes between 5 and 43200),
  valid_from timestamptz,
  valid_to timestamptz,
  active boolean not null default true,
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  created_by_member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);

create index if not exists idx_market_offers_business on market_offers(business_id, active, approval_status);

create table if not exists market_offer_claims (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references market_offers(id) on delete cascade,
  business_id uuid not null references market_businesses(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  code text not null unique,
  status text not null default 'claimed'
    check (status in ('claimed', 'redeemed', 'expired', 'cancelled')),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by_member_id uuid references members(id) on delete set null,
  redemption_note text
);

create index if not exists idx_market_claims_member on market_offer_claims(member_id, claimed_at desc);
create index if not exists idx_market_claims_business on market_offer_claims(business_id, claimed_at desc);
create index if not exists idx_market_claims_offer on market_offer_claims(offer_id, status);

-- ---------------------------------------------------------------------------
-- 5. Member drops and doing good
-- ---------------------------------------------------------------------------

-- Surprise tickets, last-minute lists, secret parties. Created by admin,
-- shown to active members while they last.
create table if not exists member_drops (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 160),
  body text,
  event_id uuid references events(id) on delete set null,
  link_url text,
  places integer check (places is null or places >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'live', 'closed')),
  created_by_member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_drops_live on member_drops(status, starts_at desc);

create table if not exists member_drop_claims (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references member_drops(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed', 'confirmed', 'declined', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  unique (drop_id, member_id)
);

-- Community projects the membership supports. Ships EMPTY: nothing is claimed
-- on the site until a real project is defined here by a person.
create table if not exists good_causes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 160),
  slug text not null unique,
  summary text,
  body text,
  image_url text,
  link_url text,
  status text not null default 'draft' check (status in ('draft', 'live', 'completed', 'archived')),
  sort_order integer not null default 0,
  created_by_member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. Notifications and analytics vocabularies
-- ---------------------------------------------------------------------------

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'friend_arrived', 'friend_pinged_you', 'event_room_message',
    'event_alert', 'event_reminder', 'connection_going', 'close_friend_going',
    'travel_digest', 'city_digest', 'promoter_review',
    'archive_activity', 'promoter_announcement',
    'admin_new_member', 'admin_new_article', 'admin_review_waiting',
    'admin_article_edited',
    'membership_started', 'membership_request_update', 'market_application_update'
  ));

alter table analytics_events drop constraint analytics_events_event_type_check;
alter table analytics_events add constraint analytics_events_event_type_check check (event_type in (
  'event_viewed', 'event_saved', 'event_unsaved', 'interested', 'going', 'rsvp_cleared',
  'ticket_clicked', 'event_shared', 'promoter_viewed', 'genre_selected', 'location_selected',
  'event_submitted', 'clubmessenger_open', 'clubmessenger_event_open', 'presence_started',
  'presence_ended', 'presence_visibility_changed', 'friend_arrival_seen', 'friend_arrival_clicked',
  'ping_sent', 'ping_response', 'live_room_open', 'room_message_sent', 'going_from_clubmessenger',
  'event_click_from_clubmessenger', 'ticket_click_from_clubmessenger', 'heat_card_click',
  'recommendation_impression', 'recommendation_click', 'event_hidden', 'event_not_for_me',
  'taste_updated', 'history_added', 'scene_entity_added', 'scene_people_impression',
  'member_profile_viewed', 'connection_requested', 'connection_accepted', 'travel_plan_created',
  'city_followed', 'email_queued', 'email_rec_clicked', 'alert_created', 'email_sent',
  'email_failed', 'email_unsubscribed', 'notification_clicked', 'archive_viewed',
  'archive_item_viewed', 'i_was_there_added', 'i_was_there_removed', 'archive_contribution',
  'archive_correction', 'memory_added', 'archive_to_event_click', 'archive_search',
  'close_friend_marked', 'close_friend_unmarked', 'announcement_created', 'announcement_sent',
  'announcement_clicked', 'promoter_followers_viewed',
  'ask_question', 'ask_feedback',
  -- Membership
  'membership_page_viewed', 'membership_waitlist_joined', 'membership_checkout_started',
  'membership_started', 'membership_renewed', 'membership_payment_failed',
  'membership_cancelled', 'membership_expired', 'membership_portal_opened',
  'get_me_in_viewed', 'get_me_in_requested', 'get_me_in_guestlisted',
  'get_me_in_decided', 'get_me_in_cancelled',
  'promoter_contacted',
  -- Market
  'market_viewed', 'market_business_viewed', 'market_offer_claimed', 'market_offer_redeemed',
  'market_business_applied', 'market_business_decided',
  'member_drop_viewed', 'member_drop_claimed'
));

-- ---------------------------------------------------------------------------
-- 7. Row-level security — deny everything except the service role.
-- ---------------------------------------------------------------------------

alter table membership_plans enable row level security;
alter table memberships enable row level security;
alter table membership_billing_events enable row level security;
alter table membership_waitlist enable row level security;
alter table member_access_requests enable row level security;
alter table member_access_request_events enable row level security;
alter table promoter_contacts enable row level security;
alter table promoter_outreach enable row level security;
alter table market_categories enable row level security;
alter table market_businesses enable row level security;
alter table market_business_members enable row level security;
alter table market_offers enable row level security;
alter table market_offer_claims enable row level security;
alter table member_drops enable row level security;
alter table member_drop_claims enable row level security;
alter table good_causes enable row level security;

revoke all on table membership_plans from anon, authenticated;
revoke all on table memberships from anon, authenticated;
revoke all on table membership_billing_events from anon, authenticated;
revoke all on table membership_waitlist from anon, authenticated;
revoke all on table member_access_requests from anon, authenticated;
revoke all on table member_access_request_events from anon, authenticated;
revoke all on table promoter_contacts from anon, authenticated;
revoke all on table promoter_outreach from anon, authenticated;
revoke all on table market_categories from anon, authenticated;
revoke all on table market_businesses from anon, authenticated;
revoke all on table market_business_members from anon, authenticated;
revoke all on table market_offers from anon, authenticated;
revoke all on table market_offer_claims from anon, authenticated;
revoke all on table member_drops from anon, authenticated;
revoke all on table member_drop_claims from anon, authenticated;
revoke all on table good_causes from anon, authenticated;

grant select, insert, update, delete on table membership_plans to service_role, supabase_admin;
grant select, insert, update, delete on table memberships to service_role, supabase_admin;
grant select, insert, update, delete on table membership_billing_events to service_role, supabase_admin;
grant select, insert, update, delete on table membership_waitlist to service_role, supabase_admin;
grant select, insert, update, delete on table member_access_requests to service_role, supabase_admin;
grant select, insert, update, delete on table member_access_request_events to service_role, supabase_admin;
grant select, insert, update, delete on table promoter_contacts to service_role, supabase_admin;
grant select, insert, update, delete on table promoter_outreach to service_role, supabase_admin;
grant select, insert, update, delete on table market_categories to service_role, supabase_admin;
grant select, insert, update, delete on table market_businesses to service_role, supabase_admin;
grant select, insert, update, delete on table market_business_members to service_role, supabase_admin;
grant select, insert, update, delete on table market_offers to service_role, supabase_admin;
grant select, insert, update, delete on table market_offer_claims to service_role, supabase_admin;
grant select, insert, update, delete on table member_drops to service_role, supabase_admin;
grant select, insert, update, delete on table member_drop_claims to service_role, supabase_admin;
grant select, insert, update, delete on table good_causes to service_role, supabase_admin;
