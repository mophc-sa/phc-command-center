-- =========================================================
-- Sales OS pilot — Sprint 5: Sales Action Queue.
--
-- Reuses the existing public.opportunity_flags table as the queue store
-- rather than creating a new table. That table is already the polymorphic
-- "action required / risk" store (linked_record_type + linked_record_id,
-- action_owner_id, due_date, priority, status, created_by), already has a
-- dedicated route (Action Center) reading it, and already has an automation
-- engine (run_automations, in sales-os-api) that raises rows into it. Sprint
-- 5 additively extends this table and its enum rather than duplicating it.
--
-- queue_action_type is a NEW, dedicated enum for the Sprint 5 "type" field
-- (the 10 daily-action-engine reasons a queue item exists). It is kept
-- separate from the existing action_type enum (what business action a
-- salesperson must take, e.g. "request_boq" — used elsewhere already) and
-- from risk_flag (what risk exists, e.g. "margin_risk"). A queue item can
-- still carry an action_type/risk_flag where one already fits (e.g.
-- rfq_review_needed also sets action_type='follow_up_required'); this new
-- column is what the Action Queue UI groups and filters by.
--
-- flag_status gains 5 new values so a queue item's lifecycle matches the
-- Sprint 5 spec exactly: open, in_progress, completed, dismissed,
-- escalated, blocked. 'resolved' is kept for backward compatibility with
-- any existing rows; going forward the app writes 'completed' instead.
--
-- No new RLS policies: these are new columns on an existing, already-RLS-
-- protected table. The existing "Flags editable by sales team" policy
-- already governs who may write them.
-- =========================================================

CREATE TYPE public.queue_action_type AS ENUM (
  'follow_up_due',
  'follow_up_overdue',
  'missing_data',
  'rfq_review_needed',
  'tender_review_needed',
  'approval_needed',
  'quotation_follow_up',
  'no_next_action',
  'inactive_tier_a_opportunity',
  'contract_evidence_missing'
);

ALTER TYPE public.flag_status ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE public.flag_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.flag_status ADD VALUE IF NOT EXISTS 'dismissed';
ALTER TYPE public.flag_status ADD VALUE IF NOT EXISTS 'escalated';
ALTER TYPE public.flag_status ADD VALUE IF NOT EXISTS 'blocked';

ALTER TABLE public.opportunity_flags
  ADD COLUMN IF NOT EXISTS queue_action_type public.queue_action_type,
  ADD COLUMN IF NOT EXISTS recommended_action TEXT,
  ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_flags_queue_action_type ON public.opportunity_flags(queue_action_type);
CREATE INDEX IF NOT EXISTS idx_flags_status_due_date ON public.opportunity_flags(status, due_date);

NOTIFY pgrst, 'reload schema';
