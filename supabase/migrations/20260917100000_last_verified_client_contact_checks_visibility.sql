-- =============================================================================
-- The function has to be callable by the browser after all — so it now checks.
--
-- WHAT 20260916100000 GOT WRONG
-- ----------------------------
-- It revoked EXECUTE from PUBLIC, anon and authenticated on the reasoning that
-- every real caller reaches the function through an object owned by postgres —
-- run_sales_automations, pipeline_by_stage, sla_breaches — and that such an
-- object executes the function with the OWNER's privileges.
--
-- That is true for TABLE access inside a non-security_invoker view. It is NOT
-- true for FUNCTION execution: EXECUTE is checked at runtime against the
-- CURRENT user, whatever the view's owner is. So revoking it did not close a
-- door quietly — it broke both views for every signed-in user. Confirmed
-- against production: SELECT on pipeline_by_stage and sla_breaches returned
-- 42501 "permission denied for function last_verified_client_contact".
--
-- The behavioural half of the test for 20260916100000 did not catch this,
-- because the behaviour harness runs `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA
-- public TO rls_tester`. rls_tester therefore held a direct grant the real
-- `authenticated` role does not, and the views kept working locally. That
-- blanket grant was named as a hazard in the previous migration's own test
-- header, and it still took production to expose it.
--
-- So authenticated EXECUTE IS genuinely required, and the answer is the other
-- one the brief offered: let it be called, and make it refuse to answer about
-- a deal the caller cannot read.
--
-- THE CHECK
-- ---------
-- can_read_opportunity_record() is the existing approved predicate; no
-- authorization logic is restated here. It admits the deal's owner, the
-- pipeline operators (MD, GM, CEO, sales_manager, bd_manager, sales_ops) and
-- estimation/finance — a SUPERSET of can_read_sales_analytics(), which is what
-- gates analytics_scope_opportunities and therefore both views. Every reader
-- who can reach a row in those views already passes this predicate, so no view
-- loses a row it used to show.
--
-- auth.uid() IS NULL is the internal path — pg_cron and the Edge Function
-- reach the database with no subject, which is this codebase's existing
-- convention for "not a user". It is safe as a bypass ONLY because anon and
-- PUBLIC remain revoked from 20260916100000: an anonymous caller also has no
-- subject, and must never be allowed to take this branch. Do not grant EXECUTE
-- to anon.
--
-- NOT AN ORACLE
-- -------------
-- An unauthorized caller gets NULL — the same answer as a deal with no
-- recorded contact, and the same answer as a UUID that does not exist.
-- Existence, ownership and contact history are all indistinguishable from
-- outside.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.last_verified_client_contact(_opportunity_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT max(a.occurred_at)
    FROM public.activities a
   WHERE a.related_opportunity_id = _opportunity_id
     AND (
       a.activity_type IN ('call', 'visit', 'meeting')
       OR (a.activity_type IN ('email_draft', 'whatsapp_draft') AND a.status = 'sent')
     )
     AND (
       -- pg_cron / Edge Function / owner: no subject, not a user.
       (SELECT auth.uid()) IS NULL
       -- Otherwise the caller must be entitled to read the deal itself.
       OR public.can_read_opportunity_record(_opportunity_id, (SELECT auth.uid()))
     );
$$;

-- Restored deliberately: the views cannot work without it. anon and PUBLIC
-- stay revoked — re-granting either would hand the auth.uid() IS NULL branch
-- to anonymous callers and reopen the disclosure this pair of migrations
-- exists to close.
GRANT EXECUTE ON FUNCTION public.last_verified_client_contact(UUID) TO authenticated;

COMMENT ON FUNCTION public.last_verified_client_contact(UUID) IS
  'When the client was last actually contacted, or NULL when nothing in the '
  'system proves contact ever happened. NULL means UNKNOWN, never "nobody '
  'called": the import path records no activity history, so promoted '
  'historical deals return NULL while carrying years of real relationship. A '
  'note is written to ourselves and an unsent draft reached nobody, so neither '
  'counts. Mirrors isMeaningfulClientActivity() in src/lib/attention.ts — the '
  'two must not drift. '
  'SECURITY DEFINER, so it enforces visibility itself via '
  'can_read_opportunity_record(): a caller who cannot read the opportunity '
  'gets NULL, indistinguishable from no contact and from a UUID that does not '
  'exist. authenticated holds EXECUTE because pipeline_by_stage and '
  'sla_breaches call it and function EXECUTE is checked against the CALLER, '
  'not the view owner. anon and PUBLIC must stay revoked (20260916100000): '
  'they would take the auth.uid() IS NULL internal branch.';
