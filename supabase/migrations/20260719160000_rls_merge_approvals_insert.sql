-- =========================================================
-- Merge approvals INSERT policies (PERF)
--
-- After the previous merge pass, approvals still has two INSERT
-- policies for the same role (authenticated):
--   1. "Approvals requestable by salesperson" — very tight WITH
--      CHECK: salesperson role, self-authored, status=pending.
--   2. "Approvals writable by commercial managers — insert" —
--      pipeline_operator can insert without constraints.
--
-- These are safe to merge: the salesperson branch has its own
-- restricted conditions, the operator branch is open. Combining
-- with OR preserves both semantics in a single policy.
-- =========================================================

DROP POLICY IF EXISTS "Approvals requestable by salesperson"           ON public.approvals;
DROP POLICY IF EXISTS "Approvals writable by commercial managers — insert" ON public.approvals;

CREATE POLICY "Approvals insertable by salesperson or pipeline operator"
  ON public.approvals FOR INSERT TO authenticated
  WITH CHECK (
    -- Pipeline operators (BD/sales managers/etc.) can create any approval
    is_pipeline_operator((select auth.uid()))
    OR (
      -- Salespeople can only submit requests for themselves in pending state
      has_any_role((select auth.uid()), ARRAY['salesperson'::app_role])
      AND requested_by = (select auth.uid())
      AND status = 'pending'::approval_status
    )
  );
