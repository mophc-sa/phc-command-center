-- =========================================================
-- Phase 5.1 §19 — a controlled vocabulary for opportunity roles.
--
-- ADDITIVE ONLY. No column is dropped, no value is rewritten, no row is
-- touched. The migration adds one nullable column and one constraint that can
-- only ever have applied to values written after it.
--
-- WHY A NEW COLUMN RATHER THAN A CHECK ON `role`
-- ----------------------------------------------
-- public.stakeholders.role is free text and has been since July. What it holds
-- across the historical and imported rows could not be read from here, and the
-- phase's own rule is not to rewrite history without a proven mapping. A CHECK
-- on `role` would reject every legacy row the moment anything touched it, and
-- a bulk UPDATE to make them fit would be exactly the destructive rewrite the
-- rule forbids.
--
-- So `role_code` is added beside it. New and edited relationships write the
-- controlled value; `role` is preserved verbatim as the historical record. The
-- frontend prefers role_code, falls back to a conservative reading of `role`,
-- and reports "unknown" rather than guessing — see normalizeHistoricalRole()
-- in src/lib/stakeholder-roles.ts, which never writes.
--
-- WHY TEXT + CHECK RATHER THAN AN ENUM
-- ------------------------------------
-- Adding a value to a Postgres enum cannot run inside a transaction with other
-- DDL in older versions and cannot be removed at all. A CHECK is edited by
-- replacing it, which is the operation this vocabulary will actually need when
-- the business adds a role.
--
-- RLS is untouched. stakeholders is already scoped to the deals a user can see
-- (20260910100000_hotfix_deal_attached_reads.sql), and tests/db-behaviour/
-- deal_attached_reads.sql proves owner / outsider / viewer isolation on it.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

ALTER TABLE public.stakeholders
  ADD COLUMN IF NOT EXISTS role_code TEXT;

ALTER TABLE public.stakeholders
  DROP CONSTRAINT IF EXISTS stakeholders_role_code_check;

ALTER TABLE public.stakeholders
  ADD CONSTRAINT stakeholders_role_code_check
  CHECK (
    role_code IS NULL
    OR role_code IN (
      'decision_maker', 'influencer', 'technical',
      'procurement', 'finance', 'gatekeeper', 'other'
    )
  );

COMMENT ON COLUMN public.stakeholders.role_code IS
  'This person''s role ON THIS OPPORTUNITY, from a closed vocabulary. Nullable because historical rows predate it and are never rewritten — read it with a fallback to the free-text `role`, and report unknown rather than guessing. The same person can hold different roles on different deals, which is why this lives on the link and not on the contact.';

COMMENT ON COLUMN public.stakeholders.role IS
  'HISTORICAL free text, preserved. New writes should set role_code instead; this column is kept so imported and legacy values are never lost or silently reinterpreted.';

-- Reading "who decides on this deal" is a per-opportunity question asked on
-- every Data Quality pass, so it gets an index rather than a sequential scan
-- of every stakeholder each time.
CREATE INDEX IF NOT EXISTS stakeholders_opportunity_role_code_idx
  ON public.stakeholders (opportunity_id, role_code)
  WHERE role_code IS NOT NULL;
