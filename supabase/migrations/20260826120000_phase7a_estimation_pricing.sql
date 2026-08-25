-- =========================================================
-- PHASE 7A (3/3) — estimation and internal pricing.
--
-- THE STATE MACHINE IS DATA, NOT CONVENTION
-- -----------------------------------------
--   draft → cost_complete → internal_price_proposed
--         → commercial_review → finance_review → gm_pending → gm_approved
--   any state except gm_approved → returned → internal_price_proposed
--
-- Sequential, and enforced by a trigger rather than trusted to the UI. Skipping
-- is not a shortcut somebody takes under pressure; it is an error. Commercial
-- review completes before finance review, finance before GM — which is the
-- point of the chain: each gate sees the previous one's verdict.
--
-- WHY MARGIN IS STORED AND NOT DERIVED
-- ------------------------------------
-- `margin_value` and `margin_percentage` are written when the price is
-- proposed. A quotation must be able to say what the margin WAS when it was
-- approved, not what it would be if you recomputed it today against a cost that
-- has since moved. Deriving would make an approved price silently restate
-- itself, which is the same reasoning behind the Phase 6 document snapshot.
--
-- MARGIN NEVER LEAVES THE COST BOUNDARY
-- -------------------------------------
-- Both margin columns are revoked from `authenticated` and reachable only
-- through internal_price_summary, which gates on can_read_commercial_cost().
-- There is deliberately no sales-facing view of this table: the number sales
-- need is the selling price on the BOQ revision, which they already have.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.internal_price_status AS ENUM (
    'draft', 'cost_complete', 'internal_price_proposed',
    'commercial_review', 'finance_review', 'gm_pending',
    'gm_approved', 'returned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 1. Estimation ============
CREATE TABLE IF NOT EXISTS public.estimations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_revision_id   UUID NOT NULL REFERENCES public.boq_revisions(id) ON DELETE RESTRICT,
  cost_total        NUMERIC(16,2),
  wastage_pct       NUMERIC(5,2),
  installation_cost NUMERIC(16,2),
  overhead_pct      NUMERIC(5,2),
  notes             TEXT,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Once submitted the estimate stops being editable; corrections become a new
  -- estimation against the same revision.
  submitted_at      TIMESTAMPTZ,
  submitted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT est_costs_not_negative CHECK (
    coalesce(cost_total,0) >= 0 AND coalesce(installation_cost,0) >= 0),
  CONSTRAINT est_pcts_sane CHECK (
    coalesce(wastage_pct,0) >= 0 AND coalesce(overhead_pct,0) >= 0),
  CONSTRAINT est_submit_consistent CHECK ((submitted_at IS NULL) = (submitted_by IS NULL))
);

CREATE INDEX IF NOT EXISTS estimations_revision ON public.estimations (boq_revision_id);

COMMENT ON TABLE public.estimations IS
  'Cost build-up for one BOQ revision, EXCLUDING VAT. Editable until submitted_at; after that a correction is a new estimation, so the figures a price was based on stay readable.';

-- ============ 2. Internal price ============
CREATE TABLE IF NOT EXISTS public.internal_prices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimation_id          UUID NOT NULL REFERENCES public.estimations(id) ON DELETE RESTRICT,
  proposed_price         NUMERIC(16,2),
  -- Stored, not derived. See the header.
  margin_value           NUMERIC(16,2),
  margin_percentage      NUMERIC(6,2),
  status                 public.internal_price_status NOT NULL DEFAULT 'draft',

  proposed_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  proposed_at            TIMESTAMPTZ,
  commercial_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  commercial_reviewed_at TIMESTAMPTZ,
  finance_reviewed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  finance_reviewed_at    TIMESTAMPTZ,
  gm_decided_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  gm_decided_at          TIMESTAMPTZ,
  return_reason          TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ip_price_not_negative CHECK (proposed_price IS NULL OR proposed_price >= 0),
  -- A return without a stated reason is a dead end for whoever receives it.
  CONSTRAINT ip_return_has_reason CHECK (status <> 'returned' OR btrim(coalesce(return_reason,'')) <> '')
);

CREATE INDEX IF NOT EXISTS internal_prices_estimation ON public.internal_prices (estimation_id);
CREATE INDEX IF NOT EXISTS internal_prices_status     ON public.internal_prices (status);

COMMENT ON COLUMN public.internal_prices.margin_value IS
  'Margin at the moment of proposal, EXCLUDING VAT. Stored so an approved price can say what the margin WAS, not what it would be against a cost that has since moved. Revoked from authenticated — see internal_price_summary.';

-- ============ 3. The chain, enforced ============
CREATE OR REPLACE FUNCTION public.internal_price_transition_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE _ok BOOLEAN := FALSE; _uid UUID := auth.uid();
BEGIN
  IF NEW.status = OLD.status THEN
    NEW.updated_at := now();
    RETURN NEW;                       -- an edit that is not a transition
  END IF;

  IF OLD.status = 'gm_approved' THEN
    RAISE EXCEPTION 'An approved price is final; propose a new price instead. | السعر المعتمد نهائي — اقترح سعرًا جديدًا.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The chain. Anything not listed is refused, so a skip is an error rather
  -- than a shortcut somebody takes under pressure.
  _ok := (OLD.status, NEW.status) IN (
    ('draft','cost_complete'),
    ('cost_complete','internal_price_proposed'),
    ('internal_price_proposed','commercial_review'),
    ('commercial_review','finance_review'),
    ('finance_review','gm_pending'),
    ('gm_pending','gm_approved'),
    ('returned','internal_price_proposed')
  ) OR (NEW.status = 'returned' AND OLD.status <> 'gm_approved');

  IF NOT _ok THEN
    RAISE EXCEPTION 'Illegal price transition % -> %. The chain is draft, cost_complete, internal_price_proposed, commercial_review, finance_review, gm_pending, gm_approved. | انتقال غير مسموح.',
      OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  -- Who may make each move. The database decides, not the button.
  IF NEW.status = 'gm_approved' AND NOT public.can_approve_final_price(_uid) THEN
    RAISE EXCEPTION 'Only the General Manager, or an active delegate, may approve a final price. | اعتماد السعر النهائي يقتصر على المدير العام أو مفوّض ساري.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'finance_review'
     AND _uid IS NOT NULL
     AND NOT public.has_role(_uid, 'finance_manager'::public.app_role) THEN
    RAISE EXCEPTION 'Only finance may take a price into finance review.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'commercial_review'
     AND _uid IS NOT NULL
     AND NOT public.is_pipeline_operator(_uid) THEN
    RAISE EXCEPTION 'Only a pipeline operator may take a price into commercial review.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Stamp who did what, from the session rather than from the payload.
  IF NEW.status = 'commercial_review' THEN
    NEW.commercial_reviewed_by := _uid; NEW.commercial_reviewed_at := now();
  ELSIF NEW.status = 'finance_review' THEN
    NEW.finance_reviewed_by := _uid;    NEW.finance_reviewed_at := now();
  ELSIF NEW.status IN ('gm_approved','returned') THEN
    NEW.gm_decided_by := _uid;          NEW.gm_decided_at := now();
  ELSIF NEW.status = 'internal_price_proposed' THEN
    NEW.proposed_by := coalesce(NEW.proposed_by, _uid);
    NEW.proposed_at := coalesce(NEW.proposed_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS internal_prices_transition ON public.internal_prices;
CREATE TRIGGER internal_prices_transition BEFORE UPDATE ON public.internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.internal_price_transition_guard();

CREATE OR REPLACE FUNCTION public.pricing_no_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Pricing history cannot be deleted. | لا يُحذف سجل التسعير.' USING ERRCODE = 'insufficient_privilege';
END; $$;

DROP TRIGGER IF EXISTS internal_prices_no_delete ON public.internal_prices;
CREATE TRIGGER internal_prices_no_delete BEFORE DELETE ON public.internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.pricing_no_delete();
DROP TRIGGER IF EXISTS estimations_no_delete ON public.estimations;
CREATE TRIGGER estimations_no_delete BEFORE DELETE ON public.estimations
  FOR EACH ROW EXECUTE FUNCTION public.pricing_no_delete();

-- ============ 4. RLS + column privileges ============
ALTER TABLE public.estimations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Estimations readable with the revision" ON public.estimations;
CREATE POLICY "Estimations readable with the revision" ON public.estimations FOR SELECT TO authenticated
  USING (public.can_read_boq_revision(boq_revision_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Estimations writable by estimation or pipeline" ON public.estimations;
CREATE POLICY "Estimations writable by estimation or pipeline" ON public.estimations FOR INSERT TO authenticated
  WITH CHECK (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
              OR public.is_pipeline_operator((SELECT auth.uid())));

DROP POLICY IF EXISTS "Estimations updatable until submitted" ON public.estimations;
CREATE POLICY "Estimations updatable until submitted" ON public.estimations FOR UPDATE TO authenticated
  USING (submitted_at IS NULL
         AND (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
              OR public.is_pipeline_operator((SELECT auth.uid()))))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
              OR public.is_pipeline_operator((SELECT auth.uid())));

-- Row access is broader than column access, which is the split this whole phase
-- is built on. Commercial review is performed by a pipeline operator, and you
-- cannot review a price you cannot see — so the pipeline reaches the ROW. What
-- they do not reach is the margin, which is revoked at column level below.
--
-- The first draft gated this on can_read_commercial_cost() alone and the
-- behavioural suite caught it immediately: a pipeline operator could never move
-- a price into commercial_review, because the row was invisible to them. The
-- chain was unwalkable.
DROP POLICY IF EXISTS "Internal prices readable by cost holders" ON public.internal_prices;
DROP POLICY IF EXISTS "Internal prices readable by the review chain" ON public.internal_prices;
CREATE POLICY "Internal prices readable by the review chain" ON public.internal_prices FOR SELECT TO authenticated
  USING ((public.can_read_commercial_cost((SELECT auth.uid()))
          OR public.is_pipeline_operator((SELECT auth.uid())))
         AND EXISTS (SELECT 1 FROM public.estimations e
                      WHERE e.id = internal_prices.estimation_id
                        AND public.can_read_boq_revision(e.boq_revision_id, (SELECT auth.uid()))));

DROP POLICY IF EXISTS "Internal prices proposable by estimation" ON public.internal_prices;
CREATE POLICY "Internal prices proposable by estimation" ON public.internal_prices FOR INSERT TO authenticated
  WITH CHECK (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role));

-- Broad at the policy layer; the transition trigger is what decides which move
-- each role may actually make. Splitting it that way keeps one place to read
-- the chain instead of six overlapping policies.
DROP POLICY IF EXISTS "Internal prices advanced by the review chain" ON public.internal_prices;
CREATE POLICY "Internal prices advanced by the review chain" ON public.internal_prices FOR UPDATE TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid()))
         OR public.is_pipeline_operator((SELECT auth.uid())))
  WITH CHECK (public.can_read_commercial_cost((SELECT auth.uid()))
              OR public.is_pipeline_operator((SELECT auth.uid())));

-- No DELETE policy on either table.

REVOKE ALL ON public.estimations FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.estimations TO authenticated;

-- Margin never leaves the cost boundary: revoke the table grant, re-grant
-- everything except the two margin columns, and hand those back only through
-- the gated view below.
REVOKE ALL ON public.internal_prices FROM authenticated, anon;
GRANT SELECT (
  id, estimation_id, proposed_price, status, proposed_by, proposed_at,
  commercial_reviewed_by, commercial_reviewed_at, finance_reviewed_by,
  finance_reviewed_at, gm_decided_by, gm_decided_at, return_reason,
  created_at, updated_at
) ON public.internal_prices TO authenticated;
GRANT INSERT, UPDATE ON public.internal_prices TO authenticated;

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
