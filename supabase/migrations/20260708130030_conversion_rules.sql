-- =========================================================
-- PHC Sales OS — Phase 3: lock PHC commercial rules into RFQ/Tender -> JIH.
--
-- A tender or RFQ may only convert to a JIH opportunity when the PHC conversion
-- gates pass (suitable project stage, open signage package, >= 300k SAR signage
-- value, contact plan ready, confirmed main contractor, acceptable package
-- status/confidence, and a clear reason). Sub-300k conversions require an
-- executive exception approval.
--
-- These columns capture the Tender Conversion Review answers so the backend can
-- validate server-side (no client-only bypass) and keep an auditable snapshot.
-- Equivalents already on the schema are REUSED, not duplicated:
--   * tenders.signage_potential (confidence_level) == signage package confidence
--   * tenders.main_contractor_id                    -> presence feeds the review
-- =========================================================

-- ---- Tenders ---------------------------------------------------------------
ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS estimated_signage_value numeric(16,2),
  ADD COLUMN IF NOT EXISTS signage_package_status public.signage_package_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS main_contractor_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_plan_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS project_stage_suitable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS package_not_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conversion_reason text,
  ADD COLUMN IF NOT EXISTS below_300k_exception_approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL;

-- ---- RFQs ------------------------------------------------------------------
-- RFQs have no confidence column yet, so add one here (unlike tenders).
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS estimated_signage_value numeric(16,2),
  ADD COLUMN IF NOT EXISTS signage_package_status public.signage_package_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS signage_package_confidence public.confidence_level NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS main_contractor_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_plan_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS project_stage_suitable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS package_not_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conversion_reason text,
  ADD COLUMN IF NOT EXISTS below_300k_exception_approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL;
