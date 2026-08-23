-- =========================================================
-- PHASE 8 — margin integrity: the commercial and finance chain.
--
-- WHAT WAS ALREADY THERE
-- ----------------------
-- 7A built the chain itself: estimations, internal_prices, and a sequential
-- status walk from draft through commercial review and finance review to a
-- GM decision. That part works and is not touched here.
--
-- WHAT WAS MISSING, AND IT IS THE IMPORTANT PART
-- ----------------------------------------------
-- Every number the chain approves was typed by a person:
--
--   * estimations.cost_total       — typed
--   * internal_prices.margin_value — typed
--   * internal_prices.margin_percentage — typed
--
-- None of them was reconciled against anything. 7B knows the actual cost of
-- every supplier line that was selected, and nothing compared the two. So the
-- margin the GM approved could be any figure at all, and the system would
-- record the approval as though it meant something. The one control the whole
-- commercial chain exists to provide — that the price clears cost by an
-- acceptable amount — was an honour system.
--
-- (boq_cost_totals does sum line costs, but from `boq_items`, the pre-7A
-- legacy table. It never saw a boq_revision or a supplier quote.)
--
-- MARGIN IS DERIVED, NOT DECLARED
-- -------------------------------
-- A trigger now computes margin_value and margin_percentage from the proposed
-- price and the estimation's cost basis, on every insert and update, ignoring
-- whatever the caller supplied. Not validated-and-rejected — computed. A margin
-- is an arithmetic consequence of two other numbers; treating it as an input
-- is what allowed it to disagree with them.
--
-- The columns stay revoked from `authenticated` exactly as 7A left them, so
-- this changes what the figure MEANS without changing who can see it.
--
-- COST BASIS PREFERS WHAT WAS ACTUALLY COMMITTED
-- ----------------------------------------------
-- When supplier lines have been selected for the BOQ revision, their total is
-- the cost basis. The typed cost_total is the fallback for the estimating
-- stage before any supplier has been chosen. Preferring the typed figure once
-- real supplier costs exist would mean ignoring the only number in the system
-- that someone has actually agreed to pay.
--
-- A FLOOR THE GM CANNOT WALK PAST BY ACCIDENT
-- -------------------------------------------
-- margin_policies carries a minimum margin percentage. Below it, the price
-- cannot reach the GM without a written justification. It is deliberately not
-- a hard block: a strategic loss-leader is a real decision, and a system that
-- forbids it gets worked around. What it must not be is silent.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. What one estimation actually costs ============
-- SECURITY DEFINER because the pipeline operators who walk the chain cannot
-- read supplier costs, and must not need to in order for the margin behind
-- them to be computed correctly.
CREATE OR REPLACE FUNCTION public.estimation_cost_basis(_estimation_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _e         RECORD;
  _supplier  NUMERIC;
  _material  NUMERIC;
  _subtotal  NUMERIC;
BEGIN
  SELECT e.cost_total, e.wastage_pct, e.installation_cost, e.overhead_pct, e.boq_revision_id
    INTO _e
    FROM public.estimations e WHERE e.id = _estimation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- What the selected suppliers actually cost, if any have been chosen.
  SELECT sum(l.line_cost)
    INTO _supplier
    FROM public.supplier_quote_lines l
    JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
   WHERE l.is_selected
     AND q.boq_revision_id = _e.boq_revision_id;

  _material := coalesce(_supplier, _e.cost_total, 0);
  _subtotal := _material
             + (_material * coalesce(_e.wastage_pct, 0) / 100)
             + coalesce(_e.installation_cost, 0);

  RETURN round(_subtotal + (_subtotal * coalesce(_e.overhead_pct, 0) / 100), 2);
END; $$;

COMMENT ON FUNCTION public.estimation_cost_basis IS
  'The authoritative cost of an estimation: selected supplier costs when they exist, the typed cost_total until then, plus wastage, installation and overhead in that order. SECURITY DEFINER so the pipeline can advance a price without being able to read the supplier costs behind it.';

-- ============ 2. Margin is computed, never accepted ============
-- 7A sized margin_percentage as NUMERIC(6,2), capping it at ±9999.99. That was
-- safe only while a human typed the figure and typed a sane one. Computing it
-- changes the exposure: a proposed price far below cost — a fat-fingered 1
-- against a 130,000 cost — yields about -13,000,000%, and the INSERT fails with
-- "numeric field overflow" instead of recording an obviously bad price for
-- someone to see and reject.
--
-- Widened rather than clamped. Clamping would store a number that is not the
-- margin, and the whole point of this phase is that the figure means what it
-- says. Widening a numeric's precision rewrites no data and loses nothing.
-- internal_price_summary reads the column, and Postgres will not retype a
-- column a view depends on. Dropped and rebuilt verbatim from the 7A
-- definition — same columns, same order, same two gates. The only difference
-- is the widened precision it now carries through.
DROP VIEW IF EXISTS public.internal_price_summary;

ALTER TABLE public.internal_prices
  ALTER COLUMN margin_percentage TYPE NUMERIC(12,2);

CREATE OR REPLACE VIEW public.internal_price_summary AS
  SELECT p.id, p.estimation_id, e.boq_revision_id, p.status,
         p.proposed_price, p.margin_value, p.margin_percentage,
         e.cost_total, e.installation_cost, e.wastage_pct, e.overhead_pct,
         p.proposed_by, p.proposed_at,
         p.commercial_reviewed_by, p.commercial_reviewed_at,
         p.finance_reviewed_by, p.finance_reviewed_at,
         p.gm_decided_by, p.gm_decided_at, p.return_reason
    FROM public.internal_prices p
    JOIN public.estimations e ON e.id = p.estimation_id
   WHERE public.can_read_commercial_cost((SELECT auth.uid()))
     AND public.can_read_boq_revision(e.boq_revision_id, (SELECT auth.uid()));

COMMENT ON VIEW public.internal_price_summary IS
  'Price with its margin and the cost it came from, for estimation, finance and MD/GM/CEO only. All figures EXCLUDE VAT. There is deliberately no sales-facing equivalent: the number sales need is the selling price on the BOQ revision.';
GRANT SELECT ON public.internal_price_summary TO authenticated;

CREATE OR REPLACE FUNCTION public.internal_price_compute_margin()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _cost NUMERIC;
BEGIN
  _cost := public.estimation_cost_basis(NEW.estimation_id);

  IF _cost IS NULL OR NEW.proposed_price IS NULL THEN
    NEW.margin_value      := NULL;
    NEW.margin_percentage := NULL;
    RETURN NEW;
  END IF;

  NEW.margin_value := round(NEW.proposed_price - _cost, 2);

  -- Margin on price, not on cost: a 20% margin means 20% of what the client
  -- pays. Mixing the two conventions is how two departments report different
  -- numbers for the same deal.
  NEW.margin_percentage := CASE
    WHEN NEW.proposed_price = 0 THEN NULL
    ELSE round((NEW.proposed_price - _cost) / NEW.proposed_price * 100, 2)
  END;

  RETURN NEW;
END; $$;

-- Runs BEFORE the 7A chain guard so the floor check below sees the computed
-- figure rather than whatever arrived in the payload.
DROP TRIGGER IF EXISTS internal_prices_compute_margin ON public.internal_prices;
CREATE TRIGGER internal_prices_compute_margin
  BEFORE INSERT OR UPDATE ON public.internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.internal_price_compute_margin();

COMMENT ON FUNCTION public.internal_price_compute_margin IS
  'Derives margin_value and margin_percentage from the proposed price and the estimation cost basis, discarding any supplied value. Margin is arithmetic, not an input.';

-- ============ 3. The floor ============
CREATE TABLE IF NOT EXISTS public.margin_policies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_margin_pct     NUMERIC(5,2) NOT NULL,
  effective_from     TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to       TIMESTAMPTZ,
  rationale          TEXT,
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mp_pct_sane   CHECK (min_margin_pct >= -100 AND min_margin_pct <= 100),
  CONSTRAINT mp_range_sane CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- One policy in force at a time. Overlapping floors would make "the minimum
-- margin" a question with two answers.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.margin_policies DROP CONSTRAINT IF EXISTS margin_policies_no_overlap;
ALTER TABLE public.margin_policies ADD CONSTRAINT margin_policies_no_overlap
  EXCLUDE USING gist (tstzrange(effective_from, effective_to) WITH &&);

COMMENT ON TABLE public.margin_policies IS
  'The minimum acceptable margin, over time. Not a hard block — a strategic loss-leader is a real decision — but below the floor a price cannot reach the GM without a written justification.';

CREATE OR REPLACE FUNCTION public.current_margin_floor()
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.min_margin_pct FROM public.margin_policies p
   WHERE now() >= p.effective_from
     AND (p.effective_to IS NULL OR now() < p.effective_to)
   ORDER BY p.effective_from DESC LIMIT 1;
$$;

ALTER TABLE public.internal_prices
  ADD COLUMN IF NOT EXISTS below_floor_justification TEXT;

COMMENT ON COLUMN public.internal_prices.below_floor_justification IS
  'Required to send a below-floor price to the GM. Free text on purpose: the reason a deal is worth taking thin is never one of a fixed list.';

CREATE OR REPLACE FUNCTION public.internal_price_floor_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _floor NUMERIC;
BEGIN
  IF NEW.status <> 'gm_pending' OR OLD.status = 'gm_pending' THEN
    RETURN NEW;
  END IF;

  _floor := public.current_margin_floor();
  IF _floor IS NULL THEN RETURN NEW; END IF;          -- no policy set, no gate

  IF NEW.margin_percentage IS NULL THEN
    RAISE EXCEPTION 'A price with no computable margin cannot go to the GM — the estimation has no cost basis. | لا يمكن رفع سعر بلا هامش محسوب.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.margin_percentage < _floor
     AND btrim(coalesce(NEW.below_floor_justification, '')) = '' THEN
    -- No literal percent signs: in RAISE, % is the placeholder and %% is a
    -- literal, so mixing them here is a compile error waiting to happen.
    RAISE EXCEPTION 'Margin of % is below the floor of % and carries no justification. | الهامش أقل من الحد الأدنى بلا مبرر.',
      NEW.margin_percentage, _floor USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

-- Fires after the margin trigger, so it tests the computed figure.
DROP TRIGGER IF EXISTS internal_prices_zz_floor_guard ON public.internal_prices;
CREATE TRIGGER internal_prices_zz_floor_guard
  BEFORE UPDATE ON public.internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.internal_price_floor_guard();

-- ============ 4. RLS on the policy table ============
ALTER TABLE public.margin_policies ENABLE ROW LEVEL SECURITY;

-- The floor is commercial information: the set that may see cost may see it.
DROP POLICY IF EXISTS "Margin policies readable by cost holders" ON public.margin_policies;
CREATE POLICY "Margin policies readable by cost holders"
  ON public.margin_policies FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid())));

-- Only the authority that approves prices may move the floor those approvals
-- are measured against.
DROP POLICY IF EXISTS "Margin policies settable by final price authority" ON public.margin_policies;
CREATE POLICY "Margin policies settable by final price authority"
  ON public.margin_policies FOR INSERT TO authenticated
  WITH CHECK (public.can_approve_final_price((SELECT auth.uid()))
              AND created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Margin policies closable by final price authority" ON public.margin_policies;
CREATE POLICY "Margin policies closable by final price authority"
  ON public.margin_policies FOR UPDATE TO authenticated
  USING (public.can_approve_final_price((SELECT auth.uid())))
  WITH CHECK (public.can_approve_final_price((SELECT auth.uid())));

-- No DELETE policy: a superseded floor is closed with effective_to, not erased.
CREATE OR REPLACE FUNCTION public.margin_policy_no_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Margin policies are closed with effective_to, never deleted. | لا تُحذف سياسات الهامش.'
    USING ERRCODE = 'insufficient_privilege';
END; $$;

DROP TRIGGER IF EXISTS margin_policies_no_delete ON public.margin_policies;
CREATE TRIGGER margin_policies_no_delete BEFORE DELETE ON public.margin_policies
  FOR EACH ROW EXECUTE FUNCTION public.margin_policy_no_delete();

REVOKE ALL ON public.margin_policies FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.margin_policies TO authenticated;

-- ============ 5. What estimation and finance actually look at ============
CREATE OR REPLACE VIEW public.estimation_cost_reconciliation AS
  SELECT e.id AS estimation_id,
         e.boq_revision_id,
         e.cost_total            AS typed_cost_total,
         sup.supplier_cost,
         e.wastage_pct,
         e.installation_cost,
         e.overhead_pct,
         public.estimation_cost_basis(e.id) AS cost_basis,
         -- The number worth looking at: how far the typed figure sits from
         -- what the chosen suppliers actually quoted.
         CASE WHEN sup.supplier_cost IS NULL OR e.cost_total IS NULL OR e.cost_total = 0 THEN NULL
              ELSE round((sup.supplier_cost - e.cost_total) / e.cost_total * 100, 2)
         END AS typed_vs_supplier_pct,
         sup.selected_lines
    FROM public.estimations e
    LEFT JOIN LATERAL (
      SELECT sum(l.line_cost) AS supplier_cost, count(*) AS selected_lines
        FROM public.supplier_quote_lines l
        JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
       WHERE l.is_selected AND q.boq_revision_id = e.boq_revision_id
    ) sup ON TRUE
   WHERE public.can_read_commercial_cost((SELECT auth.uid()))
     AND public.can_read_boq_revision(e.boq_revision_id, (SELECT auth.uid()));

COMMENT ON VIEW public.estimation_cost_reconciliation IS
  'Typed cost against actual selected supplier cost, with the derived basis. The gate that was missing: an estimate nobody reconciled is an estimate nobody checked.';
GRANT SELECT ON public.estimation_cost_reconciliation TO authenticated;

-- The queue: what is waiting on whom. No margin here — this is a worklist, and
-- it is read by the pipeline as well as by finance.
CREATE OR REPLACE VIEW public.commercial_review_queue AS
  SELECT ip.id AS internal_price_id,
         ip.estimation_id,
         e.boq_revision_id,
         b.related_opportunity_id,
         ip.status,
         CASE ip.status
           WHEN 'internal_price_proposed' THEN 'commercial'
           WHEN 'commercial_review'       THEN 'finance'
           WHEN 'finance_review'          THEN 'gm'
           WHEN 'gm_pending'              THEN 'gm'
           WHEN 'returned'                THEN 'estimation'
           ELSE NULL
         END AS awaiting,
         ip.proposed_at,
         ip.commercial_reviewed_at,
         ip.finance_reviewed_at,
         ip.updated_at,
         -- How long it has been sitting. Phase 13's SLA rules will read this.
         round(extract(epoch FROM now() - ip.updated_at) / 86400, 1) AS days_waiting
    FROM public.internal_prices ip
    JOIN public.estimations e   ON e.id = ip.estimation_id
    JOIN public.boq_revisions r ON r.id = e.boq_revision_id
    JOIN public.boqs b          ON b.id = r.boq_id
   WHERE ip.status IN ('internal_price_proposed','commercial_review','finance_review','gm_pending','returned')
     AND (public.can_read_commercial_cost((SELECT auth.uid()))
          OR public.is_pipeline_operator((SELECT auth.uid())));

COMMENT ON VIEW public.commercial_review_queue IS
  'Prices waiting on a decision and who owes it. Carries no cost or margin, so the pipeline can see its own queue without seeing the numbers behind it.';
GRANT SELECT ON public.commercial_review_queue TO authenticated;
