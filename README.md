# Guestlist

Community / content / experiences platform for the generation that grew up
around rave, club and electronic music culture.

## What's here

- **Landing page** at `/` (the original static page, ported; source preserved
  in `legacy/index.html`).
- **Events platform V1**:
  - `/events` — curated discovery: For You / This Weekend / Day Parties /
    Nightlife / Festivals / Worth Travelling For, genre chips (with
    subgenres), filters (near me, date, location, genre, type, price),
    sorting, mobile filter sheet, empty states.
  - `/events/[slug]` — editorial event detail: hero, lineup, promoter, map
    link, GET TICKETS (outbound clicks recorded via `/out/[id]`).
  - Interested / Going / Save + Who's Going drawer.
  - `/events/submit` — paste-a-link event submission (ingestion pipeline with
    a stub extractor; everything lands in admin review).
  - `/admin/events` — review queues (New / Needs Review / Live / Rejected /
    Past), publish/edit/reject, duplicate flags, manual event create/edit.
  - `/admin/sources` — the independent event-source graph foundation.

- **Event Supply Engine V2A** (`lib/supply/`): finds and imports events from
  independent websites with minimal human effort.
  - SSRF-hardened server-side fetcher (`safeFetch.ts`): http/https only,
    private/loopback/link-local/metadata ranges blocked at DNS-lookup time,
    redirect re-validation, timeouts, size caps, honest GuestlistBot UA.
  - Structured-data-first extraction (`structured.ts`): JSON-LD schema.org
    Event, OpenGraph, meta, canonical, feeds — then Claude fills gaps
    (`ai.ts`, requires `ANTHROPIC_API_KEY`; degrades to structured-only
    without it). Page content is framed as untrusted data; AI output is
    zod-validated and application code controls every write.
  - Normalisation in the event's own timezone, controlled-taxonomy genre
    mapping (unknowns → `genre_suggestions` for admins), conservative
    venue/promoter/artist matching, multi-signal duplicate scoring, and
    multi-source evidence links per canonical event.
  - Deterministic per-field confidence + provenance shown in the admin
    review UI; conservative auto-publish only for TRUSTED sources
    (thresholds in `lib/supply/config.ts`, env-overridable).
  - Source scanning (`scanner.ts`): known listing page or RSS/Atom feed →
    candidate event links → seen-URL memory → capped extraction. SCAN NOW
    per source in admin; scheduled polling via
    `POST /api/jobs/scan-sources` with `Authorization: Bearer
    $SUPPLY_CRON_SECRET` (wire to cron/Vercel Cron; e.g. every 30 min).
  - `/admin/supply`: extraction log with failure states, retries and
    cost/performance metrics (AI tokens, durations, structured-data hits).
  - Rate-limited public submissions (member/IP per-hour caps).

- **Promoter Network V2B**: the database starts feeding itself.
  - Public profiles: `/promoters` directory, `/promoters/[slug]`,
    `/venues/[slug]`, `/artists/[slug]`, with Follow (feeds For You ranking)
    and the organiser block on event pages.
  - Claiming: `/promoters/[slug]/claim` → admin review at `/admin/promoters`
    (domain evidence recorded, never auto-approved; full claim audit
    history; UNCLAIMED → CLAIM PENDING → VERIFIED / REJECTED / SUSPENDED).
  - Promoter dashboard at `/promoter`: overview stats + onboarding, event
    management (create/edit/confirm/ignore/cancel/sold out/reschedule),
    website connection using the V2A source system (connect → scan →
    "we found N events" → confirm), analytics (views, unique viewers,
    ticket clicks + CTR, RSVPs, followers, top events, aggregate-only
    audience insights), profile editing, team management.
  - Teams: `promoter_members` roles OWNER / ADMIN / EDITOR / ANALYST with
    token invites; permissions enforced server-side in every API.
  - Event listing states: sold out / cancelled / postponed / rescheduled —
    cancelled events stay visible, clearly marked, with ticket redirects
    disabled.
  - Event claiming ("Is this your event?") with domain auto-approval or
    admin review; every important promoter action lands in `audit_log`;
    notification rows stored for future delivery.

## Stack

- Next.js (App Router, TypeScript), hand-rolled CSS design system.
- PostgreSQL with plain SQL migrations (`db/migrations/`) — written to be
  applied to Supabase unchanged. RLS policy plan for the Supabase move:
  `db/supabase_rls_reference.sql`.
- Lightweight cookie-session auth (`lib/auth.ts`) — the single module to swap
  for Supabase Auth later.

## Local development

```bash
cp .env.example .env.local        # point DATABASE_URL at local Postgres
npm install
npm run db:migrate                # apply migrations
npm run db:seed                   # FICTIONAL dev data (~26 events)
npm run dev
```

Dev accounts (all password `guestlist`): admin `oshi@guestlist.net`, members
`dev-nadia@example.com`, `dev-marcus@example.com`, …

## Verification

`scripts/verify.mjs` exercises the full journey (admin create → publish →
discovery → filters → RSVP → who's going → ticket click → submissions →
dedupe → permissions) against a running server with DB assertions:

```bash
npm run db:reset && npm run dev &   # requires SUPPLY_FETCH_ALLOW_HOSTS=127.0.0.1 in .env.local (dev/test only)
npm run verify
```

The promoter network has its own suite — `node scripts/verify-v2b.mjs`
(108 checks: claims, teams, permission boundaries, source connection,
import queue, lifecycle states, follows, analytics, event claiming,
suspension — including the full promoter loop end to end).

The Event Supply Engine has its own deterministic suite —
`npm run test:supply` — 153 checks over fixtures with an injected fetcher
and mock AI clients (SSRF hardening, structured extraction, AI merge paths,
normalisation, genre mapping, dedupe, scanning, auto-publish rules). No
live websites in CI; `scripts/manual-extract.ts` is a manual harness for
respectful spot-checks against real pages.
