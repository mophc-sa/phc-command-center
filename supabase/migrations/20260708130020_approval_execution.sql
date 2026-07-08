-- =========================================================
-- PHC Sales OS — Phase 2: Approval Execution Engine support.
--
-- Until now, approving a request only flipped approvals.status to 'approved';
-- the ORIGINAL requested action was never applied, and the request payload
-- (e.g. the verbal-award contact fields) was discarded when the approval was
-- created. This migration lets an approval carry the action it represents so
-- the backend can execute it on approval, exactly once.
--
--   requested_action   — the sales-os-api action to run on approval
--                        (e.g. 'advance_sales_stage', 'execute_tender_conversion')
--   requested_payload  — the JSON payload captured at request time
--   execution_status   — not_run | executed | failed | skipped
--   executed_at / executed_by / execution_error — execution audit fields
--
-- Additive + idempotent. No data is rewritten.
-- =========================================================
ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS requested_action text,
  ADD COLUMN IF NOT EXISTS requested_payload jsonb,
  ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'not_run',
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS execution_error text;

-- Guard the small set of valid execution states.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approvals_execution_status_check'
  ) THEN
    ALTER TABLE public.approvals
      ADD CONSTRAINT approvals_execution_status_check
      CHECK (execution_status IN ('not_run', 'executed', 'failed', 'skipped'));
  END IF;
END $$;

-- Fast lookup of approvals still awaiting execution.
CREATE INDEX IF NOT EXISTS idx_approvals_execution_status
  ON public.approvals (execution_status)
  WHERE execution_status <> 'executed';
