-- import_batches: analyzer output
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS detected_header_row_index integer,
  ADD COLUMN IF NOT EXISTS structure_confidence numeric,
  ADD COLUMN IF NOT EXISTS structure_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parser_version text;

-- import_rows: per-row analyzer output + review queue
ALTER TABLE public.import_rows
  ADD COLUMN IF NOT EXISTS original_row_number integer,
  ADD COLUMN IF NOT EXISTS normalized_data jsonb,
  ADD COLUMN IF NOT EXISTS target_entity text,
  ADD COLUMN IF NOT EXISTS confidence_score numeric,
  ADD COLUMN IF NOT EXISTS confidence_reasons jsonb,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='import_rows_review_status_check') THEN
    ALTER TABLE public.import_rows
      ADD CONSTRAINT import_rows_review_status_check
      CHECK (review_status IN ('pending','reviewed','excluded','accepted','manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='import_rows_target_entity_check') THEN
    ALTER TABLE public.import_rows
      ADD CONSTRAINT import_rows_target_entity_check
      CHECK (target_entity IS NULL OR target_entity IN (
        'companies','contacts','projects','opportunities_leads','rfq_tender','unmapped','manual_review'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS import_rows_needs_review_idx
  ON public.import_rows (batch_id) WHERE needs_review = true;

-- import_mappings: source + confidence
ALTER TABLE public.import_mappings
  ADD COLUMN IF NOT EXISTS confidence_score numeric,
  ADD COLUMN IF NOT EXISTS mapping_source text NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='import_mappings_source_check') THEN
    ALTER TABLE public.import_mappings
      ADD CONSTRAINT import_mappings_source_check
      CHECK (mapping_source IN ('auto','user','suggested','manual_review'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
