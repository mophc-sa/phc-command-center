-- =============================================================================
-- Sales definitions, wave 1 (Mo, 2026-11-18, from Omar's CRM review):
--
-- 1. A hold keeps the sales stage. sales_stage = 'on_hold' replaced the stage
--    the deal was at, so resuming meant guessing it. hold_from_stage records
--    it whenever a deal goes on hold; the deal page shows the kept stage with
--    the hold badge and resumes to it. The 9 deals on hold today are filled
--    from their stage history, else from the November 2026 master list status
--    (Submitted - Discount = jih_bafo), else jih (a submitted quotation).
--
-- 2. The company target stands on its own. It was the sum of every person's
--    annual row, so a coordinator's target changed the company figure. A row
--    with user_id NULL is now the company target for its period; readers use
--    it when present and fall back to the sum. The 2022-2025 company targets,
--    imported onto Omar's account (notes "هدف شركة"), move to company rows.
--    2026 = SAR 40,000,000 (Mo, 2026-11-17).
-- =============================================================================

-- 1. Hold keeps the stage.
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS hold_from_stage public.sales_stage;
COMMENT ON COLUMN public.opportunities.hold_from_stage IS
  'The sales stage the deal was at when it went on hold; it resumes to this stage.';

CREATE OR REPLACE FUNCTION public.keep_stage_on_hold()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.sales_stage = 'on_hold' AND OLD.sales_stage IS DISTINCT FROM 'on_hold' THEN
    NEW.hold_from_stage := OLD.sales_stage;
  ELSIF NEW.sales_stage IS DISTINCT FROM 'on_hold' AND OLD.sales_stage = 'on_hold' THEN
    NEW.hold_from_stage := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_opportunities_keep_stage_on_hold ON public.opportunities;
CREATE TRIGGER trg_opportunities_keep_stage_on_hold
  BEFORE UPDATE OF sales_stage ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.keep_stage_on_hold();

-- Backfill the deals on hold now. The guards let a data-sync write through.
SELECT set_config('phc.data_sync', 'on', true);
UPDATE public.opportunities o
   SET hold_from_stage = coalesce(
         (SELECT h.from_stage::public.sales_stage FROM public.stage_transition_history h
           WHERE h.record_type = 'opportunity' AND h.record_id = o.id AND h.to_stage = 'on_hold'
             AND h.from_stage IN ('rfq_received','jih','jih_bafo','under_negotiation','verbally_awarded')
           ORDER BY h.created_at DESC LIMIT 1),
         CASE WHEN o.extra_data->'master_list_2026_11'->>'status' ILIKE '%discount%' THEN 'jih_bafo'::public.sales_stage END,
         'jih'::public.sales_stage)
 WHERE o.sales_stage = 'on_hold' AND o.hold_from_stage IS NULL;
SELECT set_config('phc.data_sync', '', true);

-- 2. The company target is its own row (user_id NULL).
ALTER TABLE public.sales_targets ALTER COLUMN user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_targets_company_period
  ON public.sales_targets (period_type, period_start) WHERE user_id IS NULL;
COMMENT ON COLUMN public.sales_targets.user_id IS
  'The person the target belongs to; NULL = the company target for the period (used instead of the sum of personal rows).';

UPDATE public.sales_targets SET user_id = NULL
 WHERE notes LIKE '%هدف شركة%' AND period_type = 'annual' AND period_start < '2026-01-01'
   AND NOT EXISTS (SELECT 1 FROM public.sales_targets c WHERE c.user_id IS NULL
                    AND c.period_type = sales_targets.period_type AND c.period_start = sales_targets.period_start);

INSERT INTO public.sales_targets (user_id, period_type, period_start, sales_target, notes)
SELECT NULL, 'annual', '2026-01-01', 40000000, 'Company target 2026 (Mo, 2026-11-17)'
 WHERE NOT EXISTS (SELECT 1 FROM public.sales_targets WHERE user_id IS NULL AND period_type = 'annual' AND period_start = '2026-01-01');

-- 3. Signed sales count from a recorded contract or PO. The deal page's contract
--    panel (contracts.signed_on) is where it is entered; the deal takes that date
--    as contract_signed_date when it has none, which is what the targets read.
CREATE OR REPLACE FUNCTION public.contract_signed_to_opportunity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.signed_on IS NOT NULL AND NEW.opportunity_id IS NOT NULL THEN
    UPDATE public.opportunities SET contract_signed_date = NEW.signed_on
     WHERE id = NEW.opportunity_id AND contract_signed_date IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_signed_to_opportunity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contracts_signed_to_opportunity ON public.contracts;
CREATE TRIGGER trg_contracts_signed_to_opportunity
  AFTER INSERT OR UPDATE OF signed_on ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contract_signed_to_opportunity();
