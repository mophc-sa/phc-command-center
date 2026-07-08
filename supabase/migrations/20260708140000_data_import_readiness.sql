-- =========================================================
-- Data Import Center — Phase 1.1 real-data readiness (gap closer).
--
-- Adds the remaining staging-only fields the readiness spec calls for. Nothing
-- here writes to or references live CRM tables. Additive + idempotent.
--
-- Core safety rule unchanged: data stays in import_* staging tables. There is
-- still NO enabled commit path into companies/contacts/opportunities/etc.
-- =========================================================

-- 1. import_rows: separate EXCLUSION from soft-delete, and capture edit reason.
--    (Previously exclusion reused deleted_at/deleted_by; keep those for true
--    soft-delete and use dedicated columns for exclusion.)
ALTER TABLE public.import_rows
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edit_reason text;

-- 2. import_batches: persist the real-data readiness checklist (Section J).
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS readiness_checklist jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3. import_duplicate_candidates: reason codes + match scope + matched fields
--    + suggested action, so real-data dedup can explain itself (Section E).
ALTER TABLE public.import_duplicate_candidates
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS matched_fields text[],
  ADD COLUMN IF NOT EXISTS suggested_action text,
  ADD COLUMN IF NOT EXISTS match_scope text NOT NULL DEFAULT 'existing_crm';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'import_dupes_match_scope_check'
  ) THEN
    ALTER TABLE public.import_duplicate_candidates
      ADD CONSTRAINT import_dupes_match_scope_check
      CHECK (match_scope IN ('within_file', 'existing_crm', 'previous_batch'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS import_rows_excluded_idx
  ON public.import_rows (batch_id) WHERE is_excluded = true;
