-- A scan is a job, not a request. The desk starts one and watches it, so the
-- row has to carry everything the desk shows: what each extraction came back
-- as, and — when a scan hits its time budget — what it left for next time.
--
-- Until now `outcomes` lived only in the return value of the function that
-- produced it. That was fine while the admin held a request open for the whole
-- scan and read the reply. It stops being fine the moment the scan outlives
-- the request that asked for it.

alter table source_scans add column if not exists outcomes jsonb not null default '{}'::jsonb;
alter table source_scans add column if not exists note text;

-- A scan killed mid-flight (a function timeout, a deploy) left its row saying
-- 'running' for ever, and the desk had no way to tell that from a scan still
-- working. Anything still running from before this migration is finished off
-- honestly rather than left to spin.
update source_scans
   set status = 'failed',
       error = coalesce(error, 'Scan stopped before it finished'),
       finished_at = coalesce(finished_at, started_at)
 where status = 'running';
