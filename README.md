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
npm run db:reset && npm run dev &
npm run verify
```
