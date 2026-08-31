-- =============================================================================
-- reference_projects: the one import target still missing extra_data.
--
-- 20260714100000 gave companies, contacts and leads an extra_data jsonb so an
-- imported column with no matching CRM field is preserved rather than dropped.
-- 20260727140000 closed the same gap for the other seven pipeline targets
-- (opportunities, projects, quotations, follow_ups, boqs, rfqs, tenders) and
-- named them exhaustively -- but reference_projects was not on that list,
-- because at the time nothing imported into it.
--
-- Something does now. Importing PHC's reference portfolio surfaced the gap:
-- reference_projects has no extra_data, no source, and no notes column, so
-- there was nowhere at all to record where a row came from. Rows landed
-- identifiable only by created_at -- a timestamp is not provenance, and the
-- next import into this table would have had no way to tell its rows from
-- these.
--
-- Additive and idempotent, matching the two migrations above exactly: the
-- column plus its GIN index, nothing else. No existing row changes, and no
-- policy is touched -- reference_projects keeps the RLS it already has.
-- =============================================================================

ALTER TABLE public.reference_projects ADD COLUMN IF NOT EXISTS extra_data jsonb;

CREATE INDEX IF NOT EXISTS idx_reference_projects_extra_data
  ON public.reference_projects USING gin(extra_data);

COMMENT ON COLUMN public.reference_projects.extra_data IS
  'Import provenance and any source column with no matching field here. Mirrors the extra_data contract on companies/contacts/leads and the seven targets in 20260727140000 -- this table was the last one without it.';
