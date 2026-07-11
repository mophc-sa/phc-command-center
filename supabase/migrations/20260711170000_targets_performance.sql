-- =========================================================
-- PHC Sales OS — Sprint 9: Targets & Performance
--
-- 1. Adds a conversion-rate target (percentage) alongside the existing
--    sales/pipeline/quotation/activity/reactivation targets, so managers can
--    set an explicit won-vs-closed conversion goal per salesperson. A CHECK
--    constraint enforces the 0-100 range at the DB layer as defense in
--    depth alongside client-side and sales-actions.ts validation.
-- 2. Fixes public.sales_targets RLS, which still hardcoded
--    ARRAY['sales_manager','ceo'] from the Sprint-7 migration that created
--    it — predating the Phase-1 commercial-authority helpers. This meant
--    managing_director / general_manager could not read or set targets even
--    though they hold commercial authority everywhere else. Rewritten to use
--    public.is_commercial_manager(), the canonical predicate (see
--    20260708130010_commercial_authority_helpers.sql), consistent with every
--    other commercial-authority gate in the schema.
--
-- Non-destructive: additive column + in-place policy replacement. No data
-- migration required (existing rows default conversion_target to 0, meaning
-- "no conversion target set" until a manager sets one). public.sales_targets
-- is empty in every environment as of this migration, so the CHECK
-- constraint has nothing to validate retroactively.
-- =========================================================

ALTER TABLE public.sales_targets
  ADD COLUMN conversion_target NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE public.sales_targets
  ADD CONSTRAINT sales_targets_conversion_target_range_check
  CHECK (conversion_target >= 0 AND conversion_target <= 100);

COMMENT ON COLUMN public.sales_targets.conversion_target IS
  'Target won/closed conversion rate for the period, as a percentage (0-100).';

DROP POLICY IF EXISTS "Targets readable by self or Manager/CEO" ON public.sales_targets;
DROP POLICY IF EXISTS "Targets managed by Manager/CEO" ON public.sales_targets;

CREATE POLICY "Targets readable by self or commercial manager" ON public.sales_targets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_commercial_manager(auth.uid()));
CREATE POLICY "Targets managed by commercial manager" ON public.sales_targets FOR ALL TO authenticated
  USING (public.is_commercial_manager(auth.uid()))
  WITH CHECK (public.is_commercial_manager(auth.uid()));
