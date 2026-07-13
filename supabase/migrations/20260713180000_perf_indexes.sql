-- =========================================================
-- Performance indexes — Phase C Area A
--
-- Addresses two unbounded query patterns observed in the
-- Command Center:
--
-- 1. opportunities sorted by last_activity_at DESC NULLS LAST
--    (cc-core query, command-center.tsx)
--
-- 2. follow_ups filtered by owner_id + status filtered (not
--    completed) and sorted by due_at, used in follow-up
--    dashboards and the workspace view.
-- =========================================================

-- Index 1: opportunities — last_activity_at descending
-- Supports the cc-core query:
--   ORDER BY last_activity_at DESC NULLS LAST
-- Also used by any per-opportunity sort in dashboards.
CREATE INDEX IF NOT EXISTS opportunities_last_activity_at_idx
  ON public.opportunities (last_activity_at DESC NULLS LAST);

-- Index 2: follow_ups — (due_date, owner_id) partial index
-- Supports follow-up inbox and workspace queries:
--   WHERE status <> 'completed'
--   ORDER BY due_date ASC
-- Partial index excludes completed rows so it stays small
-- and focused on the hot path (active follow-ups).
CREATE INDEX IF NOT EXISTS follow_ups_due_date_owner_idx
  ON public.follow_ups (due_date, owner_id)
  WHERE status <> 'completed';
