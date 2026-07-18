-- =========================================================
-- PHC Sales OS — Business Destination Tables
--
-- Three tables that receive committed import candidates and
-- store real CRM events produced by the import pipeline:
--
--   * account_interactions   — touchpoints with a company/contact
--                              (visits, calls, meetings, etc.)
--   * quotation_updates      — timeline events on a quotation or
--                              opportunity (status changes, revisions…)
--   * sales_actuals_monthly  — monthly performance metrics, including
--                              historical aggregates imported from Excel
--
-- RLS model:
--   account_interactions  — read: is_sales_contributor(); write: is_pipeline_operator() OR company owner
--   quotation_updates     — read: is_sales_contributor(); write: is_pipeline_operator()
--   sales_actuals_monthly — read: is_pipeline_operator(); write: is_commercial_manager() OR system_admin
--
-- Non-destructive: CREATE TABLE IF NOT EXISTS + additive. No data changes.
-- Rollback: DROP TABLE sales_actuals_monthly, quotation_updates,
--   account_interactions CASCADE;
-- =========================================================

-- ============================================================
-- 1. account_interactions
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
