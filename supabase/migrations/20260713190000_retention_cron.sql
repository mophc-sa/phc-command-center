-- =============================================================================
-- Retention cleanup via pg_cron
--
-- audit_log:     rows older than 2 years are deleted (compliance-safe window
--                for an internal sales OS with no legal hold requirements).
-- client_errors: rows older than 90 days are deleted (short-lived debug data).
--
-- Jobs run at 02:30 UTC daily, staggered from the weekly AI report job (03:00).
-- The DO $$ guard makes the migration idempotent on projects without pg_cron /
-- pg_net, so applying it to a vanilla Supabase project will not fail.
-- =============================================================================

DO $$
BEGIN
  -- Guard: pg_cron must be installed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not available — skipping retention cron jobs.';
    RETURN;
  END IF;

  -- audit_log retention: delete rows older than 2 years.
  PERFORM cron.schedule(
    'audit-log-retention',
    '30 2 * * *',   -- 02:30 UTC daily
    $cron$
      DELETE FROM public.audit_log
      WHERE  timestamp < now() - INTERVAL '2 years';
    $cron$
  );

  -- client_errors retention: delete rows older than 90 days.
  PERFORM cron.schedule(
    'client-errors-retention',
    '35 2 * * *',   -- 02:35 UTC daily (5-min stagger)
    $cron$
      DELETE FROM public.client_errors
      WHERE  created_at < now() - INTERVAL '90 days';
    $cron$
  );

  RAISE NOTICE 'Retention cron jobs registered.';
END;
$$;
