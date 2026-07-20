-- Adds a 'rolled_back' status + tracking columns to import_batches, so a
-- committed batch's CRM writes can be reversed via import_record_links.
-- Does not touch commit itself (still disabled, Phase 2-gated) — this only
-- prepares the undo path for whenever commit is approved.

ALTER TABLE public.import_batches
  DROP CONSTRAINT IF EXISTS import_batches_status_check;

ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_status_check
  CHECK (status IN (
    'uploading','parsing','mapping','validating','duplicate_review',
    'pending_approval','approved','dry_run','committed','rolled_back',
    'failed','cancelled'
  ));

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS rolled_back_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
