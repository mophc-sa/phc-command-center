-- =========================================================
-- Explicit deny policy for ai_agent_requests (SEC/INFO)
--
-- This table is service_role-only by design: the AI orchestrator
-- Edge Function runs as service_role and bypasses RLS entirely.
-- Authenticated users have no GRANT on this table, so they can
-- never reach rows regardless of RLS. However, Supabase Advisor
-- flags "RLS enabled, no policies" as INFO.
--
-- Adding a vacuously-false policy for `authenticated` silences
-- the advisor and makes the intent explicit in the schema itself.
-- =========================================================

CREATE POLICY "ai_agent_requests — service role only, authenticated blocked"
  ON public.ai_agent_requests
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
