-- =========================================================
-- ai_agent_runs was missing a SELECT policy.
--
-- 20260708130050_ai_foundation.sql enabled RLS and granted table-level
-- SELECT to `authenticated` on ai_agent_runs (and 3 sibling tables) via a
-- loop, but never added a row-level policy for it. With RLS enabled and
-- no permissive policy, Postgres denies every row to the `authenticated`
-- role regardless of the GRANT — so any real user querying this table saw
-- zero rows, while a service-role/CLI query (which bypasses RLS) saw the
-- real data. This is why the "Agent Activity" dashboard widget and page
-- always reported "hasn't run yet" even after agents had run.
--
-- Mirrors the legacy public.agent_runs table's own policy
-- ("Agent runs readable" ... USING (true), 20260701193202): run history
-- is operational visibility, not sensitive data, so any authenticated
-- user may read it.
-- =========================================================

CREATE POLICY "AI agent runs readable" ON public.ai_agent_runs
  FOR SELECT TO authenticated USING (true);
