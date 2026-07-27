-- =============================================================================
-- Extend extra_data (dynamic import columns) to every import target table.
--
-- 20260714100000_extra_data_fields.sql added extra_data jsonb to companies,
-- contacts, and leads so import columns with no matching CRM field are
-- preserved rather than discarded. The other 7 tables the import pipeline
-- can target (ImportTargetEntity in src/lib/import-actions.ts) never got
-- the same column, so mapping a column to "Additional Data" for a batch
-- targeting any of them had no real destination — commit_candidates simply
-- spread the unmapped value as a literal (nonexistent) top-level insert
-- column, which failed the whole row's write outright. This migration
-- closes that gap for every remaining target: opportunities, projects,
-- quotations, follow_ups, boqs, rfqs, tenders.
-- =============================================================================

ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS extra_data jsonb;
ALTER TABLE public.projects      ADD COLUMN IF NOT EXISTS extra_data jsonb;
ALTER TABLE public.quotations    ADD COLUMN IF NOT EXISTS extra_data jsonb;
ALTER TABLE public.follow_ups    ADD COLUMN IF NOT EXISTS extra_data jsonb;
ALTER TABLE public.boqs          ADD COLUMN IF NOT EXISTS extra_data jsonb;
ALTER TABLE public.rfqs          ADD COLUMN IF NOT EXISTS extra_data jsonb;
ALTER TABLE public.tenders       ADD COLUMN IF NOT EXISTS extra_data jsonb;

CREATE INDEX IF NOT EXISTS idx_opportunities_extra_data ON public.opportunities USING gin(extra_data);
CREATE INDEX IF NOT EXISTS idx_projects_extra_data      ON public.projects      USING gin(extra_data);
CREATE INDEX IF NOT EXISTS idx_quotations_extra_data    ON public.quotations    USING gin(extra_data);
CREATE INDEX IF NOT EXISTS idx_follow_ups_extra_data    ON public.follow_ups    USING gin(extra_data);
CREATE INDEX IF NOT EXISTS idx_boqs_extra_data          ON public.boqs          USING gin(extra_data);
CREATE INDEX IF NOT EXISTS idx_rfqs_extra_data          ON public.rfqs          USING gin(extra_data);
CREATE INDEX IF NOT EXISTS idx_tenders_extra_data       ON public.tenders       USING gin(extra_data);

COMMENT ON COLUMN public.opportunities.extra_data IS 'Free-form fields from data import that do not map to a known CRM column. Keys = original source column names.';
COMMENT ON COLUMN public.projects.extra_data      IS 'Free-form fields from data import that do not map to a known CRM column. Keys = original source column names.';
COMMENT ON COLUMN public.quotations.extra_data    IS 'Free-form fields from data import that do not map to a known CRM column. Keys = original source column names.';
COMMENT ON COLUMN public.follow_ups.extra_data    IS 'Free-form fields from data import that do not map to a known CRM column. Keys = original source column names.';
COMMENT ON COLUMN public.boqs.extra_data           IS 'Free-form fields from data import that do not map to a known CRM column. Keys = original source column names.';
COMMENT ON COLUMN public.rfqs.extra_data           IS 'Free-form fields from data import that do not map to a known CRM column. Keys = original source column names.';
COMMENT ON COLUMN public.tenders.extra_data        IS 'Free-form fields from data import that do not map to a known CRM column. Keys = original source column names.';
