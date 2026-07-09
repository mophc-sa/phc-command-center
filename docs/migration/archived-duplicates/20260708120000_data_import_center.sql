-- Data Import Center Phase 1 — staging tables, company matching fields, storage bucket
-- Scope: pipeline only. No production commit. Dry-run safety enabled.

-- ==========================================================================
-- 1. Company matching fields
-- ==========================================================================
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cr_number text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS website_domain text;

-- Unique partial index on cr_number (non-null, non-empty)
CREATE UNIQUE INDEX IF NOT EXISTS companies_cr_number_uniq
  ON public.companies (cr_number)
  WHERE cr_number IS NOT NULL AND cr_number <> '';

CREATE INDEX IF NOT EXISTS companies_website_domain_idx
  ON public.companies (website_domain)
  WHERE website_domain IS NOT NULL;

-- ==========================================================================
-- 2. Import staging tables
-- ==========================================================================

-- Batch: one import session
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'uploading'
    CHECK (status IN (
      'uploading','parsing','mapping','validating','duplicate_review',
      'pending_approval','approved','dry_run','committed','failed','cancelled'
    )),
  source_type text NOT NULL DEFAULT 'file' CHECK (source_type IN ('file','api','manual')),
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  dry_run boolean NOT NULL DEFAULT true,
  ai_suggestions_enabled boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  committed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- File: uploaded file metadata (no raw content stored in DB)
CREATE TABLE IF NOT EXISTS public.import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('csv','xlsx')),
  file_size_bytes bigint NOT NULL,
  storage_path text NOT NULL,
  sheet_name text,
  header_row integer NOT NULL DEFAULT 1,
  row_count integer,
  column_names text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Mapping: column mapping configuration
CREATE TABLE IF NOT EXISTS public.import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  source_column text NOT NULL,
  target_table text NOT NULL,
  target_column text NOT NULL,
  transform text,
  is_key boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, source_column)
);

-- Row: parsed row data with validation status
CREATE TABLE IF NOT EXISTS public.import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw_data jsonb NOT NULL,
  mapped_data jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','valid','error','duplicate','skipped','committed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Error: validation errors per row
CREATE TABLE IF NOT EXISTS public.import_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  row_id uuid REFERENCES public.import_rows(id) ON DELETE CASCADE,
  row_number integer,
  column_name text,
  error_type text NOT NULL CHECK (error_type IN (
    'required','type_mismatch','format','range','length',
    'unique_violation','reference','custom'
  )),
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('error','warning','info')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Duplicate candidates: potential matches found during dedup
CREATE TABLE IF NOT EXISTS public.import_duplicate_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  row_id uuid NOT NULL REFERENCES public.import_rows(id) ON DELETE CASCADE,
  existing_record_id uuid NOT NULL,
  existing_table text NOT NULL,
  match_type text NOT NULL CHECK (match_type IN ('exact','fuzzy','cr_number','domain','name')),
  confidence numeric(5,2) NOT NULL DEFAULT 0,
  resolution text CHECK (resolution IN ('skip','merge','create_new','pending')),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Approval queue: approval workflow
CREATE TABLE IF NOT EXISTS public.import_approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action IN ('approve','reject','request_changes')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision text CHECK (decision IN ('approved','rejected','changes_requested')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Record links: tracks which production records were created from import rows
CREATE TABLE IF NOT EXISTS public.import_record_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  row_id uuid NOT NULL REFERENCES public.import_rows(id) ON DELETE CASCADE,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created','updated','skipped')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================================
-- 3. Indexes for staging tables
-- ==========================================================================
CREATE INDEX IF NOT EXISTS import_batches_created_by_idx ON public.import_batches (created_by);
CREATE INDEX IF NOT EXISTS import_batches_status_idx ON public.import_batches (status);
CREATE INDEX IF NOT EXISTS import_files_batch_idx ON public.import_files (batch_id);
CREATE INDEX IF NOT EXISTS import_rows_batch_idx ON public.import_rows (batch_id);
CREATE INDEX IF NOT EXISTS import_rows_status_idx ON public.import_rows (batch_id, status);
CREATE INDEX IF NOT EXISTS import_errors_batch_idx ON public.import_errors (batch_id);
CREATE INDEX IF NOT EXISTS import_errors_row_idx ON public.import_errors (row_id);
CREATE INDEX IF NOT EXISTS import_dupes_batch_idx ON public.import_duplicate_candidates (batch_id);
CREATE INDEX IF NOT EXISTS import_dupes_row_idx ON public.import_duplicate_candidates (row_id);
CREATE INDEX IF NOT EXISTS import_approval_batch_idx ON public.import_approval_queue (batch_id);
CREATE INDEX IF NOT EXISTS import_links_batch_idx ON public.import_record_links (batch_id);
CREATE INDEX IF NOT EXISTS import_links_target_idx ON public.import_record_links (target_table, target_id);

-- ==========================================================================
-- 4. Enable RLS on all import tables
-- ==========================================================================
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_duplicate_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_approval_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_record_links ENABLE ROW LEVEL SECURITY;

-- ==========================================================================
-- 5. RLS policies — role-based access
-- ==========================================================================

-- Helper: import-capable roles (can view all batches)
-- system_admin, managing_director, general_manager, ceo, sales_manager
-- bd_manager: own batches only
-- salesperson, viewer: blocked

-- import_batches
CREATE POLICY import_batches_select ON public.import_batches FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
  OR (has_role(auth.uid(), 'bd_manager'::app_role) AND created_by = auth.uid())
);

CREATE POLICY import_batches_insert ON public.import_batches FOR INSERT WITH CHECK (
  has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
  OR (has_role(auth.uid(), 'bd_manager'::app_role) AND created_by = auth.uid())
);

CREATE POLICY import_batches_update ON public.import_batches FOR UPDATE USING (
  has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
  OR (has_role(auth.uid(), 'bd_manager'::app_role) AND created_by = auth.uid())
);

-- import_files: same visibility as parent batch
CREATE POLICY import_files_select ON public.import_files FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.import_batches b WHERE b.id = batch_id
    AND (has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
         OR (has_role(auth.uid(), 'bd_manager'::app_role) AND b.created_by = auth.uid())))
);

CREATE POLICY import_files_insert ON public.import_files FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.import_batches b WHERE b.id = batch_id
    AND (has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
         OR (has_role(auth.uid(), 'bd_manager'::app_role) AND b.created_by = auth.uid())))
);

-- import_mappings: same visibility as parent batch
CREATE POLICY import_mappings_all ON public.import_mappings FOR ALL USING (
  EXISTS (SELECT 1 FROM public.import_batches b WHERE b.id = batch_id
    AND (has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
         OR (has_role(auth.uid(), 'bd_manager'::app_role) AND b.created_by = auth.uid())))
);

-- import_rows: same visibility as parent batch
CREATE POLICY import_rows_all ON public.import_rows FOR ALL USING (
  EXISTS (SELECT 1 FROM public.import_batches b WHERE b.id = batch_id
    AND (has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
         OR (has_role(auth.uid(), 'bd_manager'::app_role) AND b.created_by = auth.uid())))
);

-- import_errors: same visibility as parent batch
CREATE POLICY import_errors_all ON public.import_errors FOR ALL USING (
  EXISTS (SELECT 1 FROM public.import_batches b WHERE b.id = batch_id
    AND (has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
         OR (has_role(auth.uid(), 'bd_manager'::app_role) AND b.created_by = auth.uid())))
);

-- import_duplicate_candidates: same visibility
CREATE POLICY import_dupes_all ON public.import_duplicate_candidates FOR ALL USING (
  EXISTS (SELECT 1 FROM public.import_batches b WHERE b.id = batch_id
    AND (has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
         OR (has_role(auth.uid(), 'bd_manager'::app_role) AND b.created_by = auth.uid())))
);

-- import_approval_queue: same visibility
CREATE POLICY import_approval_all ON public.import_approval_queue FOR ALL USING (
  EXISTS (SELECT 1 FROM public.import_batches b WHERE b.id = batch_id
    AND (has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
         OR (has_role(auth.uid(), 'bd_manager'::app_role) AND b.created_by = auth.uid())))
);

-- import_record_links: same visibility
CREATE POLICY import_links_all ON public.import_record_links FOR ALL USING (
  EXISTS (SELECT 1 FROM public.import_batches b WHERE b.id = batch_id
    AND (has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
         OR (has_role(auth.uid(), 'bd_manager'::app_role) AND b.created_by = auth.uid())))
);

-- ==========================================================================
-- 6. Storage bucket for import files
-- ==========================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imports',
  'imports',
  false,
  10485760, -- 10 MB
  ARRAY['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel','text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS: upload/read only for import-capable roles
CREATE POLICY imports_bucket_select ON storage.objects FOR SELECT USING (
  bucket_id = 'imports'
  AND has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::app_role[])
);

CREATE POLICY imports_bucket_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'imports'
  AND has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager','bd_manager']::app_role[])
);

-- ==========================================================================
-- 7. Updated_at trigger for import_batches
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.import_batches_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS import_batches_updated_at ON public.import_batches;
CREATE TRIGGER import_batches_updated_at
  BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.import_batches_set_updated_at();
