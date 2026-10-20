-- =========================================================
-- Opportunity money fields: enforced in the database, not only on screen.
--
-- Client rule (2026-08-03): Finance and the BD Manager set a deal's values.
-- Until now only the deal page enforced it (canEditTotalValue in
-- src/lib/roles.ts hides the fields). RLS lets an owner update their own
-- deal, so a salesperson could still change quotation_value,
-- estimated_value_min, estimated_value_max or contract_value straight
-- through the API. Found while shipping project tracking (PR #351).
--
-- This trigger closes that gap, modelled on protect_rfq_estimated_value()
-- (20260727180000), which guards rfqs.estimated_value the same way:
--
--   * A signed-in caller (auth.uid() IS NOT NULL) who fails
--     can_edit_total_value() -- finance_manager or bd_manager; system_admin
--     was removed in 20260812100000 -- cannot change any of the four
--     columns. The whole update is refused, not quietly trimmed, so the
--     caller sees why.
--   * Writing a column back to the value it already holds is not a change
--     and passes (IS DISTINCT FROM), so a form that resends the row is fine.
--   * Service-role writes (auth.uid() IS NULL) pass. That is the sales-os-api
--     edge function -- stage advance records contract_value at
--     contract_received through its service client, after its own manager
--     gate -- plus import and historical promotion.
--   * INSERT is not guarded: creating a deal with a starting estimate (RFQ,
--     tender and lead conversion) stays as it is.
--
-- Write paths checked before adding it: the only browser write of these
-- columns is updateOpportunityFigures (opportunity-collab-actions.ts), and
-- the deal page sends the money fields only to canEditTotalValue users.
-- updateContract writes the separate `contracts` table, not this one.
--
-- SAFETY: additive. One function and one trigger; no data or schema change.
-- Revert: DROP TRIGGER trg_protect_opportunity_money ON public.opportunities;
--         DROP FUNCTION public.protect_opportunity_money();
-- =========================================================

CREATE OR REPLACE FUNCTION public.protect_opportunity_money()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.quotation_value     IS DISTINCT FROM OLD.quotation_value
       OR NEW.estimated_value_min IS DISTINCT FROM OLD.estimated_value_min
       OR NEW.estimated_value_max IS DISTINCT FROM OLD.estimated_value_max
       OR NEW.contract_value      IS DISTINCT FROM OLD.contract_value)
     AND NOT public.can_edit_total_value(auth.uid()) THEN
    RAISE EXCEPTION 'Only Finance or the BD Manager may change a deal''s values (estimate, quotation, contract). | تعديل قيم الفرصة (التقدير، عرض السعر، العقد) يقتصر على الماليّة أو مدير التطوير.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_opportunity_money() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.protect_opportunity_money() IS
  'Refuses a signed-in caller without can_edit_total_value() (finance_manager, '
  'bd_manager) changing quotation_value, estimated_value_min/max or '
  'contract_value on an opportunity. Service-role writes pass. Client rule '
  '2026-08-03.';

DROP TRIGGER IF EXISTS trg_protect_opportunity_money ON public.opportunities;
CREATE TRIGGER trg_protect_opportunity_money
  BEFORE UPDATE OF quotation_value, estimated_value_min, estimated_value_max, contract_value
  ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.protect_opportunity_money();
