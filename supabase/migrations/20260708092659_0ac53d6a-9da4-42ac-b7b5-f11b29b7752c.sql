-- =====================================================================
-- Data Import Center — Phase 1.1
-- Batch history / target grouping / parsed-row editing / safe deletion
-- =====================================================================

-- 1. import_batches: history + lifecycle fields --------------------------
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS target_entity text NOT NULL DEFAULT 'companies',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_reason text;

-- Constrain target_entity to known Phase 1.1 staging areas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'import_batches_target_entity_check'
  ) THEN
    ALTER TABLE public.import_batches
      ADD CONSTRAINT import_batches_target_entity_check
      CHECK (target_entity IN ('companies','contacts','leads','opportunities','projects','boq'));
  END IF;
END$$;

-- 2. import_rows: editing + exclusion fields -----------------------------
ALTER TABLE public.import_rows
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS is_excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS row_status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'import_rows_row_status_check'
  ) THEN
    ALTER TABLE public.import_rows
      ADD CONSTRAINT import_rows_row_status_check
      CHECK (row_status IN ('active','edited','excluded','deleted'));
  END IF;
END$$;

-- 3. Restrict hard DELETE on import_batches to system_admin only ---------
DROP POLICY IF EXISTS import_batches_delete ON public.import_batches;
CREATE POLICY import_batches_delete
  ON public.import_batches
  FOR DELETE
  USING (public.has_role(auth.uid(), 'system_admin'::public.app_role));

-- 4. Storage RLS for the private `imports` bucket ------------------------
-- Read + delete objects if user can access the parent batch.
DROP POLICY IF EXISTS imports_bucket_select ON storage.objects;
CREATE POLICY imports_bucket_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'imports'
    AND (
      public.has_any_role(auth.uid(), ARRAY[
        'system_admin','managing_director','general_manager','ceo','sales_manager'
      ]::public.app_role[])
      OR EXISTS (
        SELECT 1 FROM public.import_batches b
        WHERE split_part(storage.objects.name, '/', 1) = b.id::text
          AND b.created_by = auth.uid()
          AND public.has_role(auth.uid(), 'bd_manager'::public.app_role)
      )
    )
  );

DROP POLICY IF EXISTS imports_bucket_insert ON storage.objects;
CREATE POLICY imports_bucket_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'imports'
    AND public.has_any_role(auth.uid(), ARRAY[
      'system_admin','managing_director','general_manager','ceo','sales_manager','bd_manager'
    ]::public.app_role[])
  );

DROP POLICY IF EXISTS imports_bucket_delete ON storage.objects;
CREATE POLICY imports_bucket_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'imports'
    AND public.has_role(auth.uid(), 'system_admin'::public.app_role)
  );
