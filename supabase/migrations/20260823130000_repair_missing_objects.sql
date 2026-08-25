-- =========================================================
-- INTEGRITY REPAIR — re-create objects that recorded migrations created and
-- something later removed outside the migration history.
--
-- WHAT IS WRONG
-- -------------
-- Seven objects are missing from production even though the migrations that
-- create them are recorded as applied, with their statements stored:
--
--   20260714210000_business_destinations   (54 statements recorded)
--     public.account_interactions                  table
--     public.quotation_updates                     table
--     public.sales_actuals_monthly                 table
--     public.account_interactions_set_updated_at   function
--     public.sales_actuals_monthly_set_updated_at  function
--     …plus their indexes, triggers and 12 RLS policies
--
--   20260713180000_perf_indexes            (2 statements recorded)
--     public.opportunities_last_activity_at_idx    index
--     public.follow_ups_due_date_owner_idx         index
--
-- Both migrations really ran — the CLI stored their statements, and
-- 20260714210000's sibling from the same day (import_intelligence_v2) survives
-- intact with all five of its tables present. So this is not a failed apply.
-- The objects were created and then removed directly against production
-- without the schema_migrations row being touched, which is why the CLI will
-- never re-run either file.
--
-- The pattern fits a manual tidy-up: what vanished is exactly three empty
-- tables and two indexes that any "unused objects" review would flag on a
-- database this small. Postgres does not log DDL by default and audit_log
-- records only application actions, so who and when is not recoverable — only
-- that it did not go through a migration.
--
-- WHY REPAIR RATHER THAN RETIRE
-- -----------------------------
-- Nothing can currently reach the three tables. `import_batches.target_entity`
-- has a CHECK constraint listing ten permitted destinations and none of them is
-- these, and a candidate's entity_type is copied verbatim from that column — so
-- the database itself refuses a batch aimed at them. The UI's TARGET_ENTITIES
-- list does not offer them either, and of 171 import candidates ever created on
-- production, all 171 are `companies`. The wider CHECK on
-- import_record_candidates.entity_type and the three entries in the Edge
-- Function ENTITY_TABLE_MAP are vestigial.
--
-- So they are unreachable today and deleting them would be defensible. They are
-- re-created instead for one reason: the drift is the hazard, not the tables.
-- `supabase db diff` currently emits a 62-statement drop list, 60 of which are
-- these objects. Anyone generating a migration from that diff, or running
-- `db push` against a shadow database, acts on that list — and a diff that is
-- loud about things nobody intends to change is a diff nobody reads, which is
-- where the next piece of real drift will hide.
--
-- Re-creating costs three empty tables and two indexes, and is reversible. If
-- the feature is genuinely dead, retire it deliberately: a migration that drops
-- the tables AND removes the application references AND is recorded.
--
-- WHY THE DDL BELOW IS COPIED, NOT REWRITTEN
-- ------------------------------------------
-- It is the two original migrations' bodies byte for byte. A first draft of
-- this file retyped the definitions from memory and got them materially wrong —
-- invented columns (`metric_value` for `actual_value`), a fabricated
-- update_type list, ON DELETE CASCADE where the original said SET NULL, and a
-- four-column unique index where the original has five. Tables that look right
-- and are not would have left the diff non-empty in a new and more confusing
-- way. The repair has to reproduce history, so it reproduces the file.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- No business data is touched. Every statement is IF NOT EXISTS or an
-- idempotent DROP-then-CREATE of a policy or trigger, so applying it twice is a
-- no-op and applying it where the objects already exist changes nothing. No
-- existing table is altered.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============================================================
-- PART 1 — verbatim from 20260714210000_business_destinations.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_interactions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id        uuid        REFERENCES public.contacts(id) ON DELETE SET NULL,
  interaction_type  text        NOT NULL
    CHECK (interaction_type IN (
      'visit',
      'call',
      'email',
      'whatsapp',
      'meeting',
      'event',
      'prequalification',
      'vendor_portal',
      'site_visit',
      'proposal',
      'follow_up',
      'note'
    )),
  interaction_date  date        NOT NULL,
  summary           text        NOT NULL,
  feedback          text,
  outcome           text,
  next_action       text,
  next_action_due   date,
  priority          text
    CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'critical')),
  source_batch_id   uuid        REFERENCES public.import_batches(id) ON DELETE SET NULL,
  source_row_id     uuid        REFERENCES public.import_rows(id) ON DELETE SET NULL,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_interactions TO authenticated;
GRANT ALL ON public.account_interactions TO service_role;

ALTER TABLE public.account_interactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS account_interactions_company_idx      ON public.account_interactions (company_id);
CREATE INDEX IF NOT EXISTS account_interactions_contact_idx      ON public.account_interactions (contact_id);
CREATE INDEX IF NOT EXISTS account_interactions_date_idx         ON public.account_interactions (interaction_date);
CREATE INDEX IF NOT EXISTS account_interactions_source_batch_idx ON public.account_interactions (source_batch_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.account_interactions_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS account_interactions_updated_at ON public.account_interactions;
CREATE TRIGGER account_interactions_updated_at
  BEFORE UPDATE ON public.account_interactions
  FOR EACH ROW EXECUTE FUNCTION public.account_interactions_set_updated_at();

-- RLS policies
-- Read: any sales contributor
DROP POLICY IF EXISTS "account_interactions_select" ON public.account_interactions;
CREATE POLICY "account_interactions_select"
  ON public.account_interactions FOR SELECT TO authenticated
  USING (public.is_sales_contributor(auth.uid()));

-- Insert: pipeline operators, OR the record's creator (who is the company owner proxy)
DROP POLICY IF EXISTS "account_interactions_insert" ON public.account_interactions;
CREATE POLICY "account_interactions_insert"
  ON public.account_interactions FOR INSERT TO authenticated
  WITH CHECK (
    public.is_pipeline_operator(auth.uid())
    OR created_by = auth.uid()
  );

-- Update: pipeline operators, OR the original creator
DROP POLICY IF EXISTS "account_interactions_update" ON public.account_interactions;
CREATE POLICY "account_interactions_update"
  ON public.account_interactions FOR UPDATE TO authenticated
  USING (
    public.is_pipeline_operator(auth.uid())
    OR created_by = auth.uid()
  )
  WITH CHECK (
    public.is_pipeline_operator(auth.uid())
    OR created_by = auth.uid()
  );

-- Delete: platform admins only (soft-delete preferred; hard-delete guarded)
DROP POLICY IF EXISTS "account_interactions_delete" ON public.account_interactions;
CREATE POLICY "account_interactions_delete"
  ON public.account_interactions FOR DELETE TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ============================================================
-- 2. quotation_updates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quotation_updates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id     uuid        REFERENCES public.quotations(id) ON DELETE SET NULL,
  opportunity_id   uuid        REFERENCES public.opportunities(id) ON DELETE SET NULL,
  update_date      date        NOT NULL,
  update_type      text        NOT NULL
    CHECK (update_type IN (
      'status_change',
      'follow_up',
      'revision',
      'client_feedback',
      'submission',
      'negotiation',
      'clarification',
      'note'
    )),
  status_before    text,
  status_after     text,
  summary          text        NOT NULL,
  next_action      text,
  next_action_due  date,
  source_batch_id  uuid        REFERENCES public.import_batches(id) ON DELETE SET NULL,
  source_row_id    uuid        REFERENCES public.import_rows(id) ON DELETE SET NULL,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Prevent exact duplicate events: same quotation + date + summary
  UNIQUE (quotation_id, update_date, summary)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotation_updates TO authenticated;
GRANT ALL ON public.quotation_updates TO service_role;

ALTER TABLE public.quotation_updates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS quotation_updates_quotation_idx    ON public.quotation_updates (quotation_id);
CREATE INDEX IF NOT EXISTS quotation_updates_opportunity_idx  ON public.quotation_updates (opportunity_id);
CREATE INDEX IF NOT EXISTS quotation_updates_date_idx         ON public.quotation_updates (update_date);
CREATE INDEX IF NOT EXISTS quotation_updates_source_batch_idx ON public.quotation_updates (source_batch_id);

-- RLS policies
-- Read: any sales contributor
DROP POLICY IF EXISTS "quotation_updates_select" ON public.quotation_updates;
CREATE POLICY "quotation_updates_select"
  ON public.quotation_updates FOR SELECT TO authenticated
  USING (public.is_sales_contributor(auth.uid()));

-- Insert: pipeline operators
DROP POLICY IF EXISTS "quotation_updates_insert" ON public.quotation_updates;
CREATE POLICY "quotation_updates_insert"
  ON public.quotation_updates FOR INSERT TO authenticated
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- Update: pipeline operators
DROP POLICY IF EXISTS "quotation_updates_update" ON public.quotation_updates;
CREATE POLICY "quotation_updates_update"
  ON public.quotation_updates FOR UPDATE TO authenticated
  USING (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- Delete: platform admins only
DROP POLICY IF EXISTS "quotation_updates_delete" ON public.quotation_updates;
CREATE POLICY "quotation_updates_delete"
  ON public.quotation_updates FOR DELETE TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ============================================================
-- 3. sales_actuals_monthly
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sales_actuals_monthly (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  year                  integer     NOT NULL CHECK (year >= 2010 AND year <= 2100),
  month                 integer     NOT NULL CHECK (month >= 1 AND month <= 12),
  owner_id              uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  team_label            text,
  metric_type           text        NOT NULL
    CHECK (metric_type IN (
      'awarded_value',
      'target_value',
      'pipeline_value',
      'quotation_value',
      'activity_count'
    )),
  actual_value          numeric(18,2) NOT NULL DEFAULT 0,
  currency              text        NOT NULL DEFAULT 'SAR',
  is_legacy_aggregate   boolean     NOT NULL DEFAULT false,
  source_batch_id       uuid        REFERENCES public.import_batches(id) ON DELETE SET NULL,
  source_row_id         uuid        REFERENCES public.import_rows(id) ON DELETE SET NULL,
  source_profile_id     uuid        REFERENCES public.import_source_profiles(id) ON DELETE SET NULL,
  notes                 text,
  created_by            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One row per (year, month, owner-or-team, metric, profile). Expressions are
-- valid in a unique index, not in a table-level UNIQUE constraint.
CREATE UNIQUE INDEX IF NOT EXISTS sales_actuals_unique_metric_idx
  ON public.sales_actuals_monthly (
    year,
    month,
    COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid),
    metric_type,
    COALESCE(source_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_actuals_monthly TO authenticated;
GRANT ALL ON public.sales_actuals_monthly TO service_role;

ALTER TABLE public.sales_actuals_monthly ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS sales_actuals_year_month_idx      ON public.sales_actuals_monthly (year, month);
CREATE INDEX IF NOT EXISTS sales_actuals_owner_idx           ON public.sales_actuals_monthly (owner_id);
CREATE INDEX IF NOT EXISTS sales_actuals_source_batch_idx    ON public.sales_actuals_monthly (source_batch_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.sales_actuals_monthly_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS sales_actuals_monthly_updated_at ON public.sales_actuals_monthly;
CREATE TRIGGER sales_actuals_monthly_updated_at
  BEFORE UPDATE ON public.sales_actuals_monthly
  FOR EACH ROW EXECUTE FUNCTION public.sales_actuals_monthly_set_updated_at();

-- RLS policies
-- Read: pipeline operators (includes managers, sales_ops, bd_manager; NOT plain salesperson)
DROP POLICY IF EXISTS "sales_actuals_select" ON public.sales_actuals_monthly;
CREATE POLICY "sales_actuals_select"
  ON public.sales_actuals_monthly FOR SELECT TO authenticated
  USING (public.is_pipeline_operator(auth.uid()));

-- Insert: commercial managers OR system_admin
DROP POLICY IF EXISTS "sales_actuals_insert" ON public.sales_actuals_monthly;
CREATE POLICY "sales_actuals_insert"
  ON public.sales_actuals_monthly FOR INSERT TO authenticated
  WITH CHECK (
    public.is_commercial_manager(auth.uid())
    OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
  );

-- Update: commercial managers OR system_admin
DROP POLICY IF EXISTS "sales_actuals_update" ON public.sales_actuals_monthly;
CREATE POLICY "sales_actuals_update"
  ON public.sales_actuals_monthly FOR UPDATE TO authenticated
  USING (
    public.is_commercial_manager(auth.uid())
    OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
  )
  WITH CHECK (
    public.is_commercial_manager(auth.uid())
    OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
  );

-- Delete: system_admin only
DROP POLICY IF EXISTS "sales_actuals_delete" ON public.sales_actuals_monthly;
CREATE POLICY "sales_actuals_delete"
  ON public.sales_actuals_monthly FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'system_admin'::public.app_role));

-- ============================================================
-- 4. Schema cache refresh
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- PART 2 — verbatim from 20260713180000_perf_indexes.sql
--
-- The indexed columns still exist on production, so these are drop-in
-- re-creations. Created non-concurrently, matching the original; on four
-- opportunities the lock is momentary.
-- ============================================================

CREATE INDEX IF NOT EXISTS opportunities_last_activity_at_idx
  ON public.opportunities (last_activity_at DESC NULLS LAST);

-- Index 2: follow_ups — (due_date, owner_id) partial index
-- Supports follow-up inbox and workspace queries:
--   WHERE status <> 'completed'
--   ORDER BY due_date ASC
-- Partial index excludes completed rows so it stays small
-- and focused on the hot path (active follow-ups).
CREATE INDEX IF NOT EXISTS follow_ups_due_date_owner_idx
  ON public.follow_ups (due_date, owner_id)
  WHERE status <> 'completed';
