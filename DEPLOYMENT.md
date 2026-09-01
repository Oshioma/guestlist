# Deploying Guestlist to production

Guestlist is a Next.js app backed by PostgreSQL. You need three things:
a Postgres database, a Node host (Vercel is the easiest), and a handful of
environment variables. ~30 minutes end to end.

## 1. Create the database

Use Supabase (or Neon, RDS — any Postgres 14+).

- **Supabase**: create a project, then grab two connection strings from
  *Project Settings → Database*:
  - **Direct connection** (port 5432) — used once, to run migrations.
  - **Transaction pooler** (port 6543) — used by the deployed app.
- If a connection fails with an SSL error, append `?sslmode=require`.

## 2. Apply the schema

**Option A (recommended)** — from your own machine, in the repo:

```bash
DATABASE_URL="postgres://...direct-connection...:5432/postgres" npm run db:migrate
```

This applies `db/migrations/001–003` in order and records them in
`_migrations`, so future deploys just re-run the same command for new
migrations.

**Option B** — paste the contents of `db/migrations/001_events_platform.sql`,
`002_event_supply_engine.sql`, `003_promoter_network.sql` (in that order)
into the SQL editor, then record them:

```sql
create table if not exists _migrations (
  name text primary key, applied_at timestamptz not null default now()
);
insert into _migrations (name) values
  ('001_events_platform.sql'),
  ('002_event_supply_engine.sql'),
  ('003_promoter_network.sql')
on conflict (name) do nothing;
```

## 3. Seed production data

Run `db/production_setup.sql` in the SQL editor. It inserts the real genre
taxonomy (12 parents + 16 subgenres), idempotently.

**Do NOT run `npm run db:seed` against production** — the dev seed is
fictional test data and it truncates tables.

## 4. Deploy the app (Vercel)

1. vercel.com → *Add New Project* → import the `Oshioma/global` GitHub repo.
   Framework auto-detects as Next.js; no build settings needed.
2. Set environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the **pooler** connection string (port 6543) |
| `SESSION_SECRET` | a long random string — `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | *(optional but recommended)* an Anthropic API key from console.anthropic.com — enables AI extraction; without it, imports run structured-data-only and everything lands in admin review |
| `CRON_SECRET` | another `openssl rand -hex 32` — **required for scheduled source scans.** Vercel Cron only sends an `Authorization` header when this variable exists, and the job rejects unauthenticated calls, so without it the schedule runs and gets 401s silently |
| `SUPPLY_CRON_SECRET` | *(optional)* the same idea, for an external scheduler you drive yourself |

   Never set `SUPPLY_FETCH_ALLOW_HOSTS` in production (dev/test only).
3. Deploy, and check the preview URL loads `/events`.

## 5. Point the domain

In Vercel → project → *Domains*, add `guestlist.net` (and `www`), then
update your DNS as Vercel instructs (A record `76.76.21.21` for the apex,
CNAME `cname.vercel-dns.com` for www). This replaces the old static-site
hosting entirely — the landing page now lives at `/` inside the app.

## 6. Create your admin account

1. Visit `https://guestlist.net/signup` and register normally.
2. In the SQL editor:

```sql
update members set role = 'admin' where lower(email) = lower('you@guestlist.net');
```

3. Reload the site — an **Admin** link appears in the header.

## 7. Schedule source polling

`vercel.json` already schedules `/api/jobs/scan-sources` every six hours, so
there is nothing to install — but it only works once `CRON_SECRET` is set in
the project's environment variables (step 4). Vercel attaches that value as a
bearer token on the cron request; with no value set, no header is sent, and
the job answers 401 and scans nothing.

A source is only scanned on that schedule once it is polling, and a source
starts polling when its first scan actually brings back an event. Add it,
**Scan now**, and it puts itself on the schedule.

Any external scheduler still works if you prefer one — cron-job.org, a
GitHub Actions schedule, a server crontab:

```
*/30 * * * *  curl -s -X POST https://guestlist.net/api/jobs/scan-sources \
                -H "Authorization: Bearer $SUPPLY_CRON_SECRET"
```

## 8. Smoke test

- `/events` — empty state renders with "Add an event" prompt (no events yet).
- `/admin/events` (as admin) — queues render.
- `/admin/sources` → **+ Add Source** → add a promoter events page →
  **Scan now** → review what lands in ADMIN → EVENTS → NEW.
- Publish one event; confirm it appears on `/events` and GET TICKETS
  redirects (and logs a `ticket_clicked` row in `analytics_events`).
- `/promoters` — promoters appear once events/promoters exist.

## 9. First real-world extraction validation

From any machine with normal internet access:

```bash
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/manual-extract.ts --scan https://somepromoter.com/events
```

It fetches respectfully (one listing fetch, max two event extractions,
delays between requests) and prints per-field extraction results. Run it
against ~15–20 independent promoter/venue/festival sites; the admin
**Supply** log records structured-data hit rates, AI token usage, and
failure states for every extraction.

## Ongoing

- New migrations: `DATABASE_URL=... npm run db:migrate` (direct connection).
- Local dev: `cp .env.example .env.local`, `npm install`, `npm run db:reset`,
  `npm run dev` — dev accounts all use password `guestlist`.
- Test suites: `npm run verify` (81), `npm run test:supply` (161),
  `npm run verify:v2b` (124) — all against a local dev server + database.
