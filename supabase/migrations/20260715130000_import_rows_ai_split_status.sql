-- Add "ai_split" to import_rows.row_status CHECK constraint.
-- Rows inserted by the AI split-proposal promotion flow (promoteProposalToRow)
-- use row_status = 'ai_split', which was missing from the original constraint.

ALTER TABLE public.import_rows
  DROP CONSTRAINT IF EXISTS import_rows_row_status_check;

ALTER TABLE public.import_rows
  ADD CONSTRAINT import_rows_row_status_check
  CHECK (row_status IN ('active', 'edited', 'excluded', 'deleted', 'ai_split'));
