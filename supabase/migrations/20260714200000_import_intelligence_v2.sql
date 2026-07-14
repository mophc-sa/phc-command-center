-- =========================================================
-- PHC Sales OS — Import Intelligence v2
--
-- Adds the second-generation import intelligence layer:
--   * import_source_profiles  — named, recurring source templates with
--                               column alias maps and routing rules
--   * import_sheets           — per-sheet classification within a file
--   * import_record_candidates — proposed CRM records extracted from rows
--   * import_candidate_links   — relationships between candidates
--   * import_field_provenance  — per-field audit trail from source column
--
-- Also adds nullable columns to existing tables:
--   * import_batches: file_fingerprint, source_profile_id, schema_signature
--   * import_rows:    sheet_id
--
-- Helper: can_access_import_batch(uuid) — central RLS predicate used by
-- every new table. A caller passes if they created the batch, or hold
-- is_pipeline_operator() / is_platform_admin().
--
-- Non-destructive: additive + idempotent. No data modifications.
-- Rollback: DROP TABLE import_field_provenance, import_candidate_links,
--   import_record_candidates, import_sheets, import_source_profiles CASCADE;
--   DROP FUNCTION can_access_import_batch;
--   ALTER TABLE import_batches DROP COLUMN file_fingerprint, ...;
--   ALTER TABLE import_rows DROP COLUMN sheet_id;
-- =========================================================

-- ============================================================
-- 0. Central batch-access predicate
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_access_import_batch(_batch_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- caller created the batch
    EXISTS (
      SELECT 1 FROM public.import_batches b
      WHERE b.id = _batch_uuid
        AND b.created_by = auth.uid()
    )
    OR public.is_pipeline_operator(auth.uid())
    OR public.is_platform_admin(auth.uid())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_import_batch(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_access_import_batch(uuid) TO authenticated;

-- ============================================================
-- 1. import_source_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.import_source_profiles (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text        NOT NULL,
  source_kind               text        NOT NULL
    CHECK (source_kind IN (
      'client_relations',
      'project_reference',
      'sales_overview',
      'protenders_leads',
      'quotation_masterlist',
      'weekly_sales_update',
      'unknown'
    )),
  description               text,
  expected_dataset_types    text[]      NOT NULL DEFAULT '{}',
  schema_signature          text,
  known_column_aliases      jsonb       NOT NULL DEFAULT '{}',
  identity_rules            jsonb       NOT NULL DEFAULT '{}',
  routing_rules             jsonb       NOT NULL DEFAULT '{}',
  is_recurring              boolean     NOT NULL DEFAULT false,
  owner_id                  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  last_successful_batch_id  uuid        REFERENCES public.import_batches(id) ON DELETE SET NULL,
  last_imported_at          timestamptz,
  created_by                uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_source_profiles TO authenticated;
GRANT ALL ON public.import_source_profiles TO service_role;

ALTER TABLE public.import_source_profiles ENABLE ROW LEVEL SECURITY;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.import_source_profiles_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS import_source_profiles_updated_at ON public.import_source_profiles;
CREATE TRIGGER import_source_profiles_updated_at
  BEFORE UPDATE ON public.import_source_profiles
  FOR EACH ROW EXECUTE FUNCTION public.import_source_profiles_set_updated_at();

-- RLS policies
DROP POLICY IF EXISTS "import_source_profiles_select" ON public.import_source_profiles;
CREATE POLICY "import_source_profiles_select"
  ON public.import_source_profiles FOR SELECT TO authenticated
  USING (
    public.is_pipeline_operator(auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "import_source_profiles_insert" ON public.import_source_profiles;
CREATE POLICY "import_source_profiles_insert"
  ON public.import_source_profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "import_source_profiles_update" ON public.import_source_profiles;
CREATE POLICY "import_source_profiles_update"
  ON public.import_source_profiles FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR owner_id = auth.uid()
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR owner_id = auth.uid()
  );

DROP POLICY IF EXISTS "import_source_profiles_delete" ON public.import_source_profiles;
CREATE POLICY "import_source_profiles_delete"
  ON public.import_source_profiles FOR DELETE TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ============================================================
-- 2. import_sheets
-- ============================================================
CREATE TABLE IF NOT EXISTS public.import_sheets (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              uuid        NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  file_id               uuid        NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
  sheet_name            text        NOT NULL,
  sheet_index           integer     NOT NULL,
  detected_dataset_type text
    CHECK (detected_dataset_type IS NULL OR detected_dataset_type IN (
      'client_relations',
      'project_reference',
      'sales_overview',
      'protenders_leads',
      'quotation_masterlist',
      'weekly_sales_update',
      'unknown'
    )),
  title_rows            integer     NOT NULL DEFAULT 0,
  header_row_index      integer     NOT NULL DEFAULT 0,
  data_start_row        integer     NOT NULL DEFAULT 1,
  -- [{name, index, canonical_name, confidence}]
  column_manifest       jsonb       NOT NULL DEFAULT '[]',
  row_count             integer     NOT NULL DEFAULT 0,
  ai_confidence         numeric(4,3)
    CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  status                text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'classified', 'error')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, file_id, sheet_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_sheets TO authenticated;
GRANT ALL ON public.import_sheets TO service_role;

ALTER TABLE public.import_sheets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS import_sheets_batch_idx  ON public.import_sheets (batch_id);
CREATE INDEX IF NOT EXISTS import_sheets_file_idx   ON public.import_sheets (file_id);

-- RLS — same batch-access pattern as import_rows
DROP POLICY IF EXISTS "import_sheets_all" ON public.import_sheets;
CREATE POLICY "import_sheets_all"
  ON public.import_sheets FOR ALL TO authenticated
  USING (public.can_access_import_batch(batch_id))
  WITH CHECK (public.can_access_import_batch(batch_id));

-- ============================================================
-- 3. import_record_candidates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.import_record_candidates (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            uuid        NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  file_id             uuid        REFERENCES public.import_files(id) ON DELETE CASCADE,
  sheet_id            uuid        REFERENCES public.import_sheets(id) ON DELETE SET NULL,
  source_row_id       uuid        REFERENCES public.import_rows(id) ON DELETE CASCADE,
  entity_type         text        NOT NULL
    CHECK (entity_type IN (
      'companies',
      'contacts',
      'leads',
      'opportunities',
      'projects',
      'quotations',
      'follow_ups',
      'account_interactions',
      'quotation_updates',
      'sales_actuals'
    )),
  proposed_action     text        NOT NULL DEFAULT 'create'
    CHECK (proposed_action IN (
      'create',
      'update',
      'no_change',
      'needs_review',
      'conflict',
      'duplicate'
    )),
  identity_key        text,
  existing_record_id  uuid,
  existing_table      text,
  proposed_payload    jsonb       NOT NULL DEFAULT '{}',
  changed_fields      text[]      NOT NULL DEFAULT '{}',
  confidence          numeric(4,3)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reason              text,
  review_status       text        NOT NULL DEFAULT 'pending'
    CHECK (review_status IN (
      'pending',
      'approved',
      'rejected',
      'edited',
      'needs_review'
    )),
  reviewed_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_record_candidates TO authenticated;
GRANT ALL ON public.import_record_candidates TO service_role;

ALTER TABLE public.import_record_candidates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS import_candidates_batch_idx          ON public.import_record_candidates (batch_id);
CREATE INDEX IF NOT EXISTS import_candidates_source_row_idx     ON public.import_record_candidates (source_row_id);
CREATE INDEX IF NOT EXISTS import_candidates_entity_type_idx    ON public.import_record_candidates (entity_type);
CREATE INDEX IF NOT EXISTS import_candidates_proposed_action_idx ON public.import_record_candidates (proposed_action);
CREATE INDEX IF NOT EXISTS import_candidates_review_status_idx  ON public.import_record_candidates (review_status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.import_record_candidates_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS import_record_candidates_updated_at ON public.import_record_candidates;
CREATE TRIGGER import_record_candidates_updated_at
  BEFORE UPDATE ON public.import_record_candidates
  FOR EACH ROW EXECUTE FUNCTION public.import_record_candidates_set_updated_at();

-- RLS
DROP POLICY IF EXISTS "import_record_candidates_all" ON public.import_record_candidates;
CREATE POLICY "import_record_candidates_all"
  ON public.import_record_candidates FOR ALL TO authenticated
  USING (public.can_access_import_batch(batch_id))
  WITH CHECK (public.can_access_import_batch(batch_id));

-- ============================================================
-- 4. import_candidate_links
-- ============================================================
CREATE TABLE IF NOT EXISTS public.import_candidate_links (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                 uuid        NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  source_candidate_id      uuid        NOT NULL REFERENCES public.import_record_candidates(id) ON DELETE CASCADE,
  target_candidate_id      uuid        NOT NULL REFERENCES public.import_record_candidates(id) ON DELETE CASCADE,
  relationship_type        text        NOT NULL
    CHECK (relationship_type IN (
      'contact_of',
      'project_of',
      'opportunity_of',
      'quotation_of',
      'rfq_of',
      'follow_up_of',
      'interaction_of',
      'update_of',
      'child_of'
    )),
  existing_relationship_id uuid,
  confidence               numeric(4,3)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reason                   text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_candidate_id, target_candidate_id, relationship_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_candidate_links TO authenticated;
GRANT ALL ON public.import_candidate_links TO service_role;

ALTER TABLE public.import_candidate_links ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS import_candidate_links_batch_idx  ON public.import_candidate_links (batch_id);
CREATE INDEX IF NOT EXISTS import_candidate_links_source_idx ON public.import_candidate_links (source_candidate_id);
CREATE INDEX IF NOT EXISTS import_candidate_links_target_idx ON public.import_candidate_links (target_candidate_id);

-- RLS
DROP POLICY IF EXISTS "import_candidate_links_all" ON public.import_candidate_links;
CREATE POLICY "import_candidate_links_all"
  ON public.import_candidate_links FOR ALL TO authenticated
  USING (public.can_access_import_batch(batch_id))
  WITH CHECK (public.can_access_import_batch(batch_id));

-- ============================================================
-- 5. import_field_provenance
-- ============================================================
CREATE TABLE IF NOT EXISTS public.import_field_provenance (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid        NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  candidate_id      uuid        NOT NULL REFERENCES public.import_record_candidates(id) ON DELETE CASCADE,
  source_row_id     uuid        REFERENCES public.import_rows(id) ON DELETE CASCADE,
  source_column     text        NOT NULL,
  source_value      text,
  normalised_value  text,
  confidence        numeric(4,3)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  transform_applied text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_field_provenance TO authenticated;
GRANT ALL ON public.import_field_provenance TO service_role;

ALTER TABLE public.import_field_provenance ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS import_field_provenance_candidate_idx ON public.import_field_provenance (candidate_id);
CREATE INDEX IF NOT EXISTS import_field_provenance_batch_idx     ON public.import_field_provenance (batch_id);

-- RLS
DROP POLICY IF EXISTS "import_field_provenance_all" ON public.import_field_provenance;
CREATE POLICY "import_field_provenance_all"
  ON public.import_field_provenance FOR ALL TO authenticated
  USING (public.can_access_import_batch(batch_id))
  WITH CHECK (public.can_access_import_batch(batch_id));

-- ============================================================
-- 6. Extend existing tables (additive, idempotent)
-- ============================================================

-- import_batches: fingerprint + profile link + schema_signature
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS file_fingerprint    text,
  ADD COLUMN IF NOT EXISTS source_profile_id   uuid
    REFERENCES public.import_source_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schema_signature    text;

-- import_rows: sheet reference
ALTER TABLE public.import_rows
  ADD COLUMN IF NOT EXISTS sheet_id uuid
    REFERENCES public.import_sheets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS import_rows_sheet_idx
  ON public.import_rows (sheet_id)
  WHERE sheet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS import_batches_source_profile_idx
  ON public.import_batches (source_profile_id)
  WHERE source_profile_id IS NOT NULL;

-- ============================================================
-- 7. Schema cache refresh
-- ============================================================
NOTIFY pgrst, 'reload schema';
