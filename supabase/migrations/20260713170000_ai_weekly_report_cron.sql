-- =========================================================
-- AI Weekly Report — pg_cron scheduled job
--
-- Calls generate_ai_weekly_report via sales-os-api edge
-- function every Sunday at 06:00 GST (= 03:00 UTC) using
-- the pg_net extension which is enabled on all Supabase
-- projects (Pro tier+).
--
-- To activate, execute the SELECT statement below after
-- deployment. The job is idempotent (cron.schedule checks
-- by name) and can be removed with:
--
--   SELECT cron.unschedule('ai-weekly-report');
--
-- Prerequisites:
--   • pg_cron enabled (Dashboard → Extensions → pg_cron)
--   • pg_net enabled (Dashboard → Extensions → pg_net)
--   • AI_PROVIDER and the matching provider secret key
--     set in Edge Function secrets (C1 prerequisite)
--   • SERVICE_ROLE_KEY set as a Postgres config variable:
--       ALTER DATABASE postgres
--         SET app.settings.service_role_key = '<your_key>';
-- =========================================================

-- Schedule: every Sunday at 03:00 UTC (= 06:00 GST / AST)
-- The DO block below is a no-op if pg_cron or pg_net are
-- not yet enabled; the cron job will need to be registered
-- manually after enabling both extensions.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) THEN
    PERFORM cron.schedule(
      'ai-weekly-report',                -- job name (unique)
      '0 3 * * 0',                       -- every Sunday 03:00 UTC
      $cron$
        SELECT net.http_post(
          url     := current_setting('app.settings.supabase_url') || '/functions/v1/sales-os-api',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
          ),
          body    := '{"action":"generate_ai_weekly_report"}'::jsonb
        );
      $cron$
    );
  END IF;
END;
$$;

COMMENT ON EXTENSION pg_cron IS
  'Required for ai-weekly-report scheduled job (Sunday 03:00 UTC = 06:00 GST).';
