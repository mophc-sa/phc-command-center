-- =========================================================
-- PHC Sales OS — Phase 1: Intake form field additions.
--
-- Additive only: 5 new ENUM types, 7 new nullable columns (date_received
-- defaults to today so existing rows get a sane value) on public.inbox_items.
-- The legacy `scope`/`location` TEXT columns are left untouched — new
-- typed columns are added alongside them rather than altering in place,
-- so no historical free-text value is ever cast or lost.
-- =========================================================

CREATE TYPE public.inbox_client_type AS ENUM ('main_client', 'contractor_jih', 'contractor_tender', 'consultant');
CREATE TYPE public.inbox_project_type AS ENUM ('jih', 'tender');
CREATE TYPE public.inbox_rfq_from AS ENUM ('owner_developer', 'main_contractor', 'consultant');
CREATE TYPE public.inbox_scope AS ENUM (
  'supply_and_installation', 'supply_only_signage', 'supply_installation_others',
  'supply_only_others', 'mockup_sample_request', 'installation_only'
);
CREATE TYPE public.inbox_location AS ENUM (
  'riyadh', 'jeddah', 'makkah', 'madinah', 'dammam', 'al_khobar', 'dhahran',
  'jubail', 'taif', 'tabuk', 'abha', 'yanbu', 'jazan', 'buraydah', 'hail'
);

ALTER TABLE public.inbox_items
  ADD COLUMN client_type public.inbox_client_type,
  ADD COLUMN project_type public.inbox_project_type,
  ADD COLUMN project_number TEXT,
  ADD COLUMN rfq_from public.inbox_rfq_from,
  ADD COLUMN date_received DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN scope_type public.inbox_scope,
  ADD COLUMN location_city public.inbox_location;

COMMENT ON COLUMN public.inbox_items.scope_type IS
'Fixed-vocabulary scope classification for the Phase 1 Intake form. The pre-existing free-text `scope` column is kept for historical rows and is no longer written to by the form.';
COMMENT ON COLUMN public.inbox_items.location_city IS
'Fixed-vocabulary Saudi city for the Phase 1 Intake form. The pre-existing free-text `location` column is kept for historical rows and is no longer written to by the form.';
