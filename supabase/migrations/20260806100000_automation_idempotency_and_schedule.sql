-- =========================================================
-- PHC Sales OS — Make run_automations idempotent, then schedule it.
--
-- Audit (docs/migration/automation-idempotency-audit.md, 2026-08-05) concluded
-- that the automation engine must NOT go on a scheduler as it stood. Two
-- defects, both invisible at the manual cadence it ran at:
--
--   1. Dedup was check-then-insert with no unique constraint — a textbook
--      TOCTOU race. Harmless while runs were rare and manual; a scheduler adds
--      exactly the second concurrent writer that makes it likely.
--
--   2. Dedup only consulted ACTIVE statuses. The rules test the underlying
--      condition, not the flag, so closing a flag without fixing the condition
--      meant the next run raised a fresh one. Already visible in production:
--      two records carried duplicate flags of the same queue_action_type
--      (one completed, one active). At a daily cadence the standing conditions
--      would have produced roughly 270 junk flags a month against a queue
--      holding 12 open items.
--
-- Fix: identify the *occurrence*, not just its type. `condition_key` carries
-- the value that made the condition true (a due date, an approval id). While
-- that value is unchanged the flag is the same occurrence, so a dismissed flag
-- stays dismissed. When it changes — the follow-up is rescheduled — the key
-- changes and a new flag is correct.
--
-- ⚠️ DEPLOY ORDER: apply this migration BEFORE deploying sales-os-api.
-- The handler writes `condition_key`; without the column the insert fails.
-- =========================================================

-- ============ 1. condition_key ============
ALTER TABLE public.opportunity_flags
  ADD COLUMN IF NOT EXISTS condition_key TEXT;

COMMENT ON COLUMN public.opportunity_flags.condition_key IS
  'Identifies the specific occurrence that raised this flag (e.g. the follow-up''s due date, the approval id). Together with linked_record_id + queue_action_type it is the idempotency key for run_automations: same key = same occurrence = do not raise again, whatever the flag''s status.';

-- ============ 2. Deduplicate before constraining ============
-- The unique index cannot be created while duplicates exist. Keep the most
-- recent row per (record, type) and drop older ones, but ONLY where the older
-- row is already closed — an active duplicate is a real queue item someone may
-- be working, and deleting it silently would be worse than leaving it.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY linked_record_type, linked_record_id, queue_action_type
           ORDER BY created_at DESC
         ) AS rn
    FROM public.opportunity_flags
   WHERE queue_action_type IS NOT NULL
)
DELETE FROM public.opportunity_flags f
 USING ranked r
 WHERE f.id = r.id
   AND r.rn > 1
   AND f.status IN ('completed', 'resolved', 'dismissed');

-- Backfill a placeholder for pre-existing rows so the index below can include
-- them. '' means "raised before fingerprinting existed" — it does not collide
-- with any real key, which always carries a date or an id.
UPDATE public.opportunity_flags
   SET condition_key = ''
 WHERE condition_key IS NULL;

-- ============ 3. Enforce the invariant ============
-- Partial: only automation-raised rows carry a queue_action_type. Flags raised
-- by the scoring engine or by hand leave it NULL and are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_flags_condition_dedup
    ON public.opportunity_flags (linked_record_type, linked_record_id, queue_action_type, condition_key)
 WHERE queue_action_type IS NOT NULL;

-- ============ 4. Run log ============
-- Without this, a scheduler that stops firing is indistinguishable from a quiet
-- day: the queue simply goes silent. Read it to answer "did automations run?".
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  raised      INT,
  trigger     TEXT NOT NULL DEFAULT 'manual',   -- manual | cron
  error       TEXT
);

GRANT SELECT ON public.automation_runs TO authenticated;
GRANT ALL    ON public.automation_runs TO service_role;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

-- Readable by the same people who may run the engine; writes are service_role
-- only (the handler), so no INSERT/UPDATE policy for authenticated is granted.
CREATE POLICY "Automation runs readable by sales admins"
  ON public.automation_runs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::public.app_role[]));

CREATE INDEX IF NOT EXISTS idx_automation_runs_started ON public.automation_runs (started_at DESC);

-- ============ 5. Schedule ============
--
-- ⚠️ REGISTERED THEN UNSCHEDULED ON 2026-08-06 — DO NOT RE-ENABLE UNTIL AUTH IS SOLVED.
--
-- The job registers and fires correctly (verified: cron.job_run_details shows
-- `succeeded`, and net._http_response shows the request reaching the function).
-- But the function answers 401 {"error":"Not authenticated"}, and so does a
-- direct curl with the service_role key AND with the new-format sb_secret key.
--
-- The cause is not this migration and not Vault. `sales-os-api` runs with
-- verify_jwt = true (supabase/config.toml), so Supabase's gateway validates the
-- caller's JWT as a USER token before the function is reached. A service key is
-- not a user token, so no machine caller can get through the gateway at all.
--
-- Making cron work therefore requires a security decision, not a config tweak:
-- either turn verify_jwt off for a function that gates stage advancement,
-- approvals and deletions and re-implement caller checks in code, or give
-- run_automations its own authenticated path. Both need review before either is
-- built — an easy version of this becomes a bypass into sensitive actions.
--
-- Everything above this line is applied and working. Only the block below is
-- inert; it self-skips unless the prerequisites exist.
-- Daily at 04:00 UTC (07:00 AST) — before the sales day starts, so the queue is
-- populated when people open it. No-op if pg_cron / pg_net are unavailable, so
-- this migration stays safe on environments without them (local, CI).
--
-- Requires the Vault secret `sales_os_service_key` (same value sales-os-api
-- resolves via _shared/service-key-resolver.ts). If it is absent the job is not
-- created — deliberately: a scheduled job authenticating with a hardcoded key
-- would be worse than no job.
DO $$
DECLARE
  _svc_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_cron/pg_net not installed — skipping automation schedule.';
    RETURN;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO _svc_key
      FROM vault.decrypted_secrets WHERE name = 'sales_os_service_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _svc_key := NULL;
  END;

  IF _svc_key IS NULL THEN
    RAISE NOTICE 'Vault secret sales_os_service_key missing — skipping automation schedule.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('run-automations-daily')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-automations-daily');

  PERFORM cron.schedule(
    'run-automations-daily',
    '0 4 * * *',
    format($job$
      SELECT net.http_post(
        url     := 'https://lrfdtoexyeghrzynapyn.supabase.co/functions/v1/sales-os-api',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer %s'),
        body    := jsonb_build_object('action', 'run_automations', 'trigger', 'cron')
      );
    $job$, _svc_key)
  );

  RAISE NOTICE 'Scheduled run-automations-daily at 04:00 UTC.';
END $$;

-- To remove the schedule:
--   SELECT cron.unschedule('run-automations-daily');
-- To see recent runs:
--   SELECT * FROM public.automation_runs ORDER BY started_at DESC LIMIT 20;
