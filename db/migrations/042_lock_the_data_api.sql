-- 042: shut the Supabase Data API, because Guestlist does not use it.
--
-- The advisor is right that RLS is off, and wrong about what to do next — it
-- assumes Supabase Auth, and Guestlist does not use any of it:
--
--   * The app talks to Postgres directly. lib/db.ts is a `pg` Pool on
--     DATABASE_URL. Nothing goes through PostgREST.
--   * Supabase is used for ONE thing: Storage, server-side, with the service
--     role key (lib/archive/media.ts). There is no supabase-js in the app and
--     no anon key anywhere in it.
--   * Signing in is our own gl_session cookie against our own members table.
--     auth.uid() is null on every request that could ever reach this database
--     through the Data API, so a policy written as `member_id = auth.uid()`
--     would match no rows at all. It would look like security and be nothing.
--
-- So there is no per-user access model to write. Every table here is
-- backend-only, and the honest expression of that is RLS on, no policies, and
-- no grant to anon or authenticated. Migration 030 already did exactly this
-- for the membership tables; this finishes the job for the rest.
--
-- It cannot lock the app out. The app connects as the role that owns these
-- tables, and an owner bypasses RLS unless FORCE ROW LEVEL SECURITY is set,
-- which nothing here sets.
--
-- One consequence worth stating: the public-read policies on artist_videos
-- (migration 014) become inert, because a revoked table grant stops PostgREST
-- before a policy is ever consulted. They were written for a public read path
-- that was never built. If one is ever wanted, it is a grant plus a policy,
-- decided deliberately rather than inherited from a default.

-- ---------------------------------------------------------------------------
-- 1. RLS on everything in public that does not have it.
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. No grants for the two roles the Data API answers as.
--
-- Guarded on the roles existing: a plain Postgres (every developer's machine,
-- and CI) has no anon or authenticated, and `npm run db:reset` must not care.
-- ---------------------------------------------------------------------------
do $$
declare r text; t record;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = r) then continue; end if;

    for t in
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    loop
      execute format('revoke all on table public.%I from %I', t.relname, r);
    end loop;

    execute format('revoke all on all sequences in schema public from %I', r);
    execute format('revoke all on all functions in schema public from %I', r);

    -- Without this the next migration re-opens the door: Supabase ships
    -- default privileges that grant every new table in public to these roles.
    execute format('alter default privileges in schema public revoke all on tables from %I', r);
    execute format('alter default privileges in schema public revoke all on sequences from %I', r);
    execute format('alter default privileges in schema public revoke all on functions from %I', r);

    -- The door itself. Without USAGE on the schema, PostgREST cannot see a
    -- table to ask about it, whatever the grants and policies say.
    execute format('revoke usage on schema public from %I', r);
  end loop;
end $$;
