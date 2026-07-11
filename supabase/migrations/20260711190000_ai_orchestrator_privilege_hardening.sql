-- =========================================================
-- PHC Sales OS — Sprint 10: AI Orchestrator privilege hardening.
--
-- Follow-up to 20260711180000_ai_orchestrator.sql (already applied — this
-- migration is purely additive and does not edit it). The post-push
-- preflight for that migration found:
--
-- 1. This Supabase project has pre-existing `ALTER DEFAULT PRIVILEGES` for
--    the public schema (standard project provisioning, not introduced by
--    either AI migration) that automatically grants broad raw table
--    privileges — SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER —
--    to `anon` and `authenticated` on every new table, including all three
--    AI tables. RLS is enabled on all three with policies that correctly
--    restrict `anon` to zero rows and `authenticated` to only its intended
--    rows (confirmed live: neither role has BYPASSRLS, so Postgres's
--    documented RLS default-deny fully neutralizes these grants today).
--    This migration removes the unused grants explicitly anyway, as defense
--    in depth — the same principle 20260711180000 already applied to
--    `REVOKE DELETE ... FROM authenticated` on the two audit-facing tables,
--    now extended and made symmetric across all three tables and both
--    non-service roles.
-- 2. `CREATE POLICY "Outputs readable by requester with entity access or
--    commercial manager"` (70 characters) exceeded PostgreSQL's 63-byte
--    identifier limit and was silently truncated at apply time to
--    `"Outputs readable by requester with entity access or commercial "`
--    (63 bytes, trailing space, "manager" dropped entirely) — confirmed via
--    the NOTICE emitted during that migration's `db push` and verified
--    against the live `pg_policies` row. This migration drops that exact
--    live (truncated) name and recreates the identical policy under a
--    short, stable name that can never truncate.
--
-- Purely a privilege/policy-naming hardening — no column, constraint,
-- index, RPC, ownership-helper, or business-table change of any kind.
-- =========================================================

-- ---- 1. ai_agent_requests: remove all direct anon/authenticated access ------
-- This table was already correctly ungranted for these two roles in
-- 20260711180000 (no GRANT statement ever targeted them) — the broad access
-- seen live comes entirely from the project's default privileges described
-- above. This makes the removal explicit rather than relying solely on "we
-- never granted it."
REVOKE ALL PRIVILEGES ON TABLE public.ai_agent_requests
FROM anon, authenticated;

-- ---- 2. ai_agent_trace_events / ai_agent_outputs: remove write privileges ---
-- authenticated keeps SELECT (reasserted explicitly in step 3) — everything
-- else is removed from both roles.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.ai_agent_trace_events, public.ai_agent_outputs
FROM anon, authenticated;

-- anon must end up with literally zero privileges on every AI table (step 5
-- of the brief) — including SELECT, which step 2 above deliberately left
-- untouched so it could still be reasserted for authenticated in step 3.
REVOKE SELECT
ON TABLE public.ai_agent_trace_events, public.ai_agent_outputs
FROM anon;

-- ---- 3. Reassert the intended authenticated read grant -----------------------
GRANT SELECT
ON TABLE public.ai_agent_trace_events,
         public.ai_agent_outputs
TO authenticated;

-- ---- 4. Reassert service-role privileges (the Edge Function's actor) --------
GRANT ALL PRIVILEGES
ON TABLE public.ai_agent_requests,
         public.ai_agent_trace_events,
         public.ai_agent_outputs
TO service_role;

-- ---- 6. Rename the truncated output-read policy ------------------------------
-- Drops the EXACT live (truncated) identifier — note the literal trailing
-- space before the closing quote, which is significant: PostgreSQL
-- truncated the original 70-character name to exactly 63 bytes ending in
-- "commercial " (the word "manager" was dropped entirely, not abbreviated).
-- Recreated under a short, stable name with the identical USING expression,
-- byte-for-byte unchanged from 20260711180000 — no access-control logic is
-- altered here, only the identifier.
DROP POLICY IF EXISTS "Outputs readable by requester with entity access or commercial " ON public.ai_agent_outputs;

CREATE POLICY "AI outputs readable by authorized users" ON public.ai_agent_outputs
  FOR SELECT TO authenticated
  USING (
    (requested_by = auth.uid() AND (entity_id IS NULL OR public.ai_output_entity_still_owned(entity_type, entity_id, auth.uid())))
    OR public.is_commercial_manager(auth.uid())
  );

-- The trace-events read policy's name ("Trace events readable by requester
-- or platform admin", 51 characters) is well within the 63-byte limit and
-- was not truncated — left unchanged, per instructions.
