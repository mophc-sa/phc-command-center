-- =========================================================
-- PHC Sales OS — Phase 4: block direct client commercial writes.
--
-- Sensitive commercial state must move through sales-os-api (service role, which
-- runs with auth.uid() = NULL and therefore passes this guard). A logged-in
-- client (auth.uid() present) that is NOT a commercial manager may not:
--   * jump the CRM stage to a commercial outcome (won / lost / archived)
--   * edit the commercial sales_stage machine directly
-- These changes must go through the backend actions (update_opportunity_stage /
-- advance_sales_stage / the approval flow), which apply the rules + audit.
--
-- Mirrors the existing protect_opportunity_owner pattern (service role exempt
-- because auth.uid() is NULL there).
-- =========================================================
CREATE OR REPLACE FUNCTION public.protect_commercial_stage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_commercial_manager(auth.uid()) THEN
    IF NEW.stage IS DISTINCT FROM OLD.stage
       AND NEW.stage IN ('won', 'lost', 'archived') THEN
      RAISE EXCEPTION 'Commercial stage changes must go through sales-os-api';
    END IF;
    IF NEW.sales_stage IS DISTINCT FROM OLD.sales_stage THEN
      RAISE EXCEPTION 'Sales-stage changes must go through sales-os-api';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunities_protect_commercial_stage ON public.opportunities;
CREATE TRIGGER trg_opportunities_protect_commercial_stage
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.protect_commercial_stage();
