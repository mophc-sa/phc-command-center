-- =========================================================
-- client_errors — browser error ingestion table
--
-- Populated exclusively by the error-ingest Edge Function
-- (service-role key; bypasses RLS on INSERT).
--
-- system_admin can SELECT to diagnose production issues.
-- No other role can read or write directly.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.client_errors (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  env         text,
  release     text,
  category    text,
  route       text,
  language    text,
  role        text,
  request_id  text,
  severity    text,
  error_name  text,
  error_msg   text,
  error_stack text,
  browser     jsonb,
  extra       jsonb
);

-- Keep 90 days of errors; older rows purged by scheduled job (future).
COMMENT ON TABLE public.client_errors IS
  'Scrubbed browser error payloads. Inserted by error-ingest edge function via service role. Retention: 90 days.';

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- Only system_admin may read client errors (for debugging production issues).
CREATE POLICY "client_errors_system_admin_select"
  ON public.client_errors FOR SELECT
  USING (public.is_platform_admin(auth.uid()));

-- No direct INSERT/UPDATE/DELETE for any user role —
-- the edge function writes via the service-role key which bypasses RLS.

-- ── Index ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS client_errors_received_at_idx
  ON public.client_errors (received_at DESC);

CREATE INDEX IF NOT EXISTS client_errors_severity_idx
  ON public.client_errors (severity)
  WHERE severity IN ('error', 'warning');
