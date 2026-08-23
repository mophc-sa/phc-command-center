-- =========================================================
-- PHASE 7C (2/3) — quotation revisions, VAT snapshots, submission gate.
--
-- WHAT EXISTED
-- ------------
-- `quotations` has a `version` integer and a `status` enum that already
-- includes 'revised'. That is a counter, not a revision: editing a quotation
-- overwrites the figures, so the number we sent the client in March is gone
-- the moment someone re-quotes in April. There was no record of what was
-- actually submitted, and no VAT anywhere in the schema.
--
-- `quotations` is NOT modified here. It stays the live header — owner, client,
-- status, follow-up dates — and gains a revision trail beside it. Rewriting a
-- table the pipeline reads constantly, to add columns only the new flow needs,
-- would be a much larger blast radius for no gain.
--
-- THE SNAPSHOT IS THE POINT
-- -------------------------
-- A revision freezes its commercial terms the moment it leaves 'draft'. Not at
-- submission — at the point it is sent for approval. Otherwise the number the
-- GM approves and the number the client receives are two different things that
-- happen to share a row, which is the exact failure this phase exists to make
-- impossible.
--
-- VAT IS COMPUTED, NEVER TYPED
-- ----------------------------
-- vat_amount and total_incl_vat are GENERATED columns. Storing them as plain
-- numerics would let a client-side rounding difference, or a stale form,
-- persist a total that does not equal subtotal + VAT — and nothing downstream
-- would ever notice. Per the approved decision there is no `vat_treatment`
-- column: the rate is a number on the revision, defaulting to the Saudi 15%,
-- and a zero-rated or exempt line is expressed as vat_rate = 0 rather than as
-- a category someone has to interpret.
--
-- Every other money column in this system EXCLUDES VAT (7A internal_prices,
-- 7B supplier costs). subtotal_excl_vat keeps that convention explicit in the
-- name so nobody has to guess which side of VAT they are on.
--
-- THE PRICE CANNOT DRIFT FROM THE ONE THE GM APPROVED
-- ---------------------------------------------------
-- A revision carries internal_price_id. To reach 'approved' the linked price
-- must be gm_approved AND subtotal_excl_vat must equal its proposed_price to
-- the halala. There is deliberately no tolerance: "close enough to the
-- approved price" is not a thing a quotation gets to be.
--
-- This does not add a second GM approval on top of 7A's. 7A decides the price;
-- 7C proves the document carries that price and no other, and requires
-- can_approve_final_price() to sign the document off.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.quotation_revision_status AS ENUM (
    'draft', 'pending_approval', 'approved', 'submitted', 'superseded', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 1. Who may read a quotation ============
-- Mirrors the quotations SELECT policy exactly, as a SECURITY DEFINER helper so
-- the revision table can reuse it without a policy-on-policy lookup. Kept as a
-- single expression so a future change to quotation visibility has one obvious
-- place to land instead of two that can drift apart.
CREATE OR REPLACE FUNCTION public.can_read_quotation(_quotation_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.quotations q
     WHERE q.id = _quotation_id
       AND (q.owner_id = _user_id
            OR public.can_read_boq(q.related_opportunity_id, _user_id))
  );
$$;

COMMENT ON FUNCTION public.can_read_quotation IS
  'Whether a user may read one quotation, matching the quotations SELECT policy: the owner, or someone with BOQ-level reach into its opportunity. Deliberately not can_view_all_sales_data.';

-- ============ 2. Quotation revisions ============
CREATE TABLE IF NOT EXISTS public.quotation_revisions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id      UUID NOT NULL REFERENCES public.quotations(id) ON DELETE RESTRICT,

  revision_number   INTEGER NOT NULL DEFAULT 1,
  supersedes_id     UUID REFERENCES public.quotation_revisions(id) ON DELETE SET NULL,
  is_current        BOOLEAN NOT NULL DEFAULT TRUE,
  status            public.quotation_revision_status NOT NULL DEFAULT 'draft',

  -- Provenance. Both nullable while drafting; both required to leave 'draft'.
  boq_revision_id   UUID REFERENCES public.boq_revisions(id) ON DELETE RESTRICT,
  internal_price_id UUID REFERENCES public.internal_prices(id) ON DELETE RESTRICT,

  -- ---- the commercial snapshot, frozen once this leaves 'draft' ----
  currency          CHAR(3) NOT NULL DEFAULT 'SAR',
  subtotal_excl_vat NUMERIC(16,2) NOT NULL,
  vat_rate          NUMERIC(5,4)  NOT NULL DEFAULT 0.15,
  vat_amount        NUMERIC(16,2)
                      GENERATED ALWAYS AS (round(subtotal_excl_vat * vat_rate, 2)) STORED,
  total_incl_vat    NUMERIC(16,2)
                      GENERATED ALWAYS AS (subtotal_excl_vat + round(subtotal_excl_vat * vat_rate, 2)) STORED,

  valid_until       DATE,
  payment_terms     TEXT,
  delivery_terms    TEXT,
  scope_summary     TEXT,
  client_reference  TEXT,

  issued_at         TIMESTAMPTZ,
  submitted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at      TIMESTAMPTZ,
  approved_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  withdrawn_reason  TEXT,
  return_reason     TEXT,

  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT qr_revision_positive     CHECK (revision_number >= 1),
  CONSTRAINT qr_not_self_superseding  CHECK (supersedes_id IS DISTINCT FROM id),
  CONSTRAINT qr_subtotal_not_negative CHECK (subtotal_excl_vat >= 0),
  -- A rate outside 0..1 is a percentage someone typed as 15 instead of 0.15.
  CONSTRAINT qr_vat_rate_fraction     CHECK (vat_rate >= 0 AND vat_rate <= 1),
  CONSTRAINT qr_superseded_not_current CHECK (NOT (status = 'superseded' AND is_current)),
  CONSTRAINT qr_submitted_stamped     CHECK (status <> 'submitted'
                                             OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
  CONSTRAINT qr_approved_stamped      CHECK (status NOT IN ('approved','submitted')
                                             OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  -- A withdrawal nobody explained is a dead end for whoever finds it later.
  CONSTRAINT qr_withdrawn_has_reason  CHECK (status <> 'withdrawn'
                                             OR btrim(coalesce(withdrawn_reason,'')) <> ''),
  CONSTRAINT qr_validity_after_issue  CHECK (valid_until IS NULL OR issued_at IS NULL
                                             OR valid_until >= issued_at::date)
);

-- One live revision per quotation. A second is a revision, not a race.
CREATE UNIQUE INDEX IF NOT EXISTS quotation_revisions_one_current
  ON public.quotation_revisions (quotation_id) WHERE is_current;
CREATE UNIQUE INDEX IF NOT EXISTS quotation_revisions_number
  ON public.quotation_revisions (quotation_id, revision_number);
CREATE INDEX IF NOT EXISTS quotation_revisions_quotation ON public.quotation_revisions (quotation_id);
CREATE INDEX IF NOT EXISTS quotation_revisions_status    ON public.quotation_revisions (status);
CREATE INDEX IF NOT EXISTS quotation_revisions_price     ON public.quotation_revisions (internal_price_id);

COMMENT ON TABLE public.quotation_revisions IS
  'Immutable commercial snapshots of a quotation. The figures freeze when a revision leaves draft, so the number approved and the number sent are provably the same one. Revising means a new row superseding the old, never an edit.';
COMMENT ON COLUMN public.quotation_revisions.subtotal_excl_vat IS
  'Selling price EXCLUDING VAT, matching every other money column in the system. Must equal the gm_approved internal price exactly to leave draft.';
COMMENT ON COLUMN public.quotation_revisions.vat_amount IS
  'GENERATED. Never typed, so a stale form or a client-side rounding difference cannot persist a total that disagrees with subtotal + VAT.';
COMMENT ON COLUMN public.quotation_revisions.vat_rate IS
  'Fraction, not percent. Defaults to the Saudi 0.15. Zero-rated and exempt are expressed as 0 rather than as a separate treatment column, per the approved VAT decision.';

-- ============ 3. The guard ============
CREATE OR REPLACE FUNCTION public.quotation_revision_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _ok         BOOLEAN;
  _price      RECORD;
  _uid        UUID := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Quotation revisions cannot be deleted — supersede or withdraw instead. | لا تُحذف مراجعات عرض السعر.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(NEW.created_by, _uid);
    -- A revision may only be born in draft. Inserting one straight into
    -- 'approved' would walk around every gate below.
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'A quotation revision starts as draft. | تبدأ المراجعة كمسودة.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- ---- the snapshot is immutable once it leaves draft ----
  IF OLD.status <> 'draft' AND (
       NEW.subtotal_excl_vat IS DISTINCT FROM OLD.subtotal_excl_vat
    OR NEW.vat_rate          IS DISTINCT FROM OLD.vat_rate
    OR NEW.currency          IS DISTINCT FROM OLD.currency
    OR NEW.boq_revision_id   IS DISTINCT FROM OLD.boq_revision_id
    OR NEW.internal_price_id IS DISTINCT FROM OLD.internal_price_id
    OR NEW.quotation_id      IS DISTINCT FROM OLD.quotation_id
    OR NEW.revision_number   IS DISTINCT FROM OLD.revision_number) THEN
    RAISE EXCEPTION 'The commercial snapshot is frozen once the revision leaves draft — supersede it with a new revision. | تجمّد القيم بعد مغادرة المسودة.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---- a submitted revision is a historical fact ----
  -- Only its lifecycle may move after this point: superseded when a newer
  -- revision replaces it, or withdrawn with a reason. Terms, dates and the
  -- client-facing text are what the client already has.
  IF OLD.status = 'submitted' AND (
       NEW.valid_until      IS DISTINCT FROM OLD.valid_until
    OR NEW.payment_terms    IS DISTINCT FROM OLD.payment_terms
    OR NEW.delivery_terms   IS DISTINCT FROM OLD.delivery_terms
    OR NEW.scope_summary    IS DISTINCT FROM OLD.scope_summary
    OR NEW.issued_at        IS DISTINCT FROM OLD.issued_at
    OR NEW.submitted_at     IS DISTINCT FROM OLD.submitted_at
    OR NEW.submitted_by     IS DISTINCT FROM OLD.submitted_by) THEN
    RAISE EXCEPTION 'A submitted quotation revision cannot be edited. | لا تُعدّل مراجعة مُرسَلة.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---- sequential lifecycle ----
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _ok := (OLD.status, NEW.status) IN (
      ('draft',            'pending_approval'),
      ('pending_approval', 'draft'),              -- returned for rework
      ('pending_approval', 'approved'),
      ('approved',         'submitted'),
      ('approved',         'superseded'),
      ('submitted',        'superseded'),
      ('draft',            'withdrawn'),
      ('pending_approval', 'withdrawn'),
      ('approved',         'withdrawn'),
      ('submitted',        'withdrawn')
    );
    -- 'approved' -> 'draft' is deliberately absent. Reopening an approved
    -- revision for editing is how an approved number becomes a different one.
    IF NOT _ok THEN
      RAISE EXCEPTION 'Invalid quotation revision transition % -> %. | انتقال غير مسموح.',
        OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'pending_approval' OR NEW.status = 'approved' THEN
      IF NEW.internal_price_id IS NULL OR NEW.boq_revision_id IS NULL THEN
        RAISE EXCEPTION 'A quotation revision needs both a BOQ revision and an internal price before approval. | تحتاج المراجعة إلى BOQ وسعر داخلي.'
          USING ERRCODE = 'check_violation';
      END IF;

      -- The BOQ it is priced from must be frozen. Quoting off a revision that
      -- can still change means the scope can move after the price is fixed.
      IF NOT public.boq_revision_is_frozen(NEW.boq_revision_id) THEN
        RAISE EXCEPTION 'The BOQ revision must be frozen before its quotation can be approved. | يجب تجميد مراجعة الـBOQ أولاً.'
          USING ERRCODE = 'check_violation';
      END IF;

      SELECT ip.status, ip.proposed_price INTO _price
        FROM public.internal_prices ip WHERE ip.id = NEW.internal_price_id;

      IF _price.status IS DISTINCT FROM 'gm_approved'::public.internal_price_status THEN
        RAISE EXCEPTION 'The internal price is not GM-approved (status %). | السعر الداخلي غير معتمد من الإدارة العامة.',
          coalesce(_price.status::text, 'missing') USING ERRCODE = 'insufficient_privilege';
      END IF;

      -- To the halala. There is no tolerance band on purpose: "close enough to
      -- the approved price" is not a state a quotation is allowed to be in.
      IF NEW.subtotal_excl_vat IS DISTINCT FROM _price.proposed_price THEN
        RAISE EXCEPTION 'Quotation subtotal % does not match the GM-approved price %. | القيمة لا تطابق السعر المعتمد.',
          NEW.subtotal_excl_vat, _price.proposed_price USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- ---- the GM gate on the document itself ----
    IF NEW.status = 'approved' THEN
      IF NOT public.can_approve_final_price(_uid) THEN
        RAISE EXCEPTION 'Only the GM, or an active delegate, may approve a quotation revision. | اعتماد عرض السعر يقتصر على الإدارة العامة.'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.approved_by := coalesce(NEW.approved_by, _uid);
      NEW.approved_at := coalesce(NEW.approved_at, now());
    END IF;

    IF NEW.status = 'submitted' THEN
      NEW.submitted_by := coalesce(NEW.submitted_by, _uid);
      NEW.submitted_at := coalesce(NEW.submitted_at, now());
      NEW.issued_at    := coalesce(NEW.issued_at, now());
    END IF;

    IF NEW.status = 'superseded' THEN
      NEW.is_current := FALSE;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS quotation_revisions_guard ON public.quotation_revisions;
CREATE TRIGGER quotation_revisions_guard
  BEFORE INSERT OR UPDATE ON public.quotation_revisions
  FOR EACH ROW EXECUTE FUNCTION public.quotation_revision_guard();

DROP TRIGGER IF EXISTS quotation_revisions_no_delete ON public.quotation_revisions;
CREATE TRIGGER quotation_revisions_no_delete
  BEFORE DELETE ON public.quotation_revisions
  FOR EACH ROW EXECUTE FUNCTION public.quotation_revision_guard();

-- ============ 4. RLS ============
ALTER TABLE public.quotation_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Quotation revisions readable with the quotation" ON public.quotation_revisions;
CREATE POLICY "Quotation revisions readable with the quotation"
  ON public.quotation_revisions FOR SELECT TO authenticated
  USING (public.can_read_quotation(quotation_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Quotation revisions creatable by the deal's people" ON public.quotation_revisions;
CREATE POLICY "Quotation revisions creatable by the deal's people"
  ON public.quotation_revisions FOR INSERT TO authenticated
  WITH CHECK (public.can_read_quotation(quotation_id, (SELECT auth.uid()))
              AND (public.is_pipeline_operator((SELECT auth.uid()))
                   OR EXISTS (SELECT 1 FROM public.quotations q
                               WHERE q.id = quotation_id AND q.owner_id = (SELECT auth.uid()))));

-- The GM must be able to move a revision to 'approved' even without a personal
-- stake in the deal, so the UPDATE reach is deliberately wider than INSERT.
-- What they may actually change is decided by the guard, not by this policy.
DROP POLICY IF EXISTS "Quotation revisions updatable by the deal's people or the GM" ON public.quotation_revisions;
CREATE POLICY "Quotation revisions updatable by the deal's people or the GM"
  ON public.quotation_revisions FOR UPDATE TO authenticated
  USING (public.can_read_quotation(quotation_id, (SELECT auth.uid()))
         OR public.can_approve_final_price((SELECT auth.uid())))
  WITH CHECK (public.can_read_quotation(quotation_id, (SELECT auth.uid()))
              OR public.can_approve_final_price((SELECT auth.uid())));

-- No DELETE policy. The trigger refuses the service role too.

REVOKE ALL ON public.quotation_revisions FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.quotation_revisions TO authenticated;

-- ============ 5. What the pipeline reads ============
CREATE OR REPLACE VIEW public.quotation_current_revision AS
  SELECT r.quotation_id,
         r.id AS revision_id,
         r.revision_number,
         r.status,
         r.currency,
         r.subtotal_excl_vat,
         r.vat_rate,
         r.vat_amount,
         r.total_incl_vat,
         r.valid_until,
         r.issued_at,
         r.submitted_at,
         r.approved_at,
         q.quote_number,
         q.related_opportunity_id
    FROM public.quotation_revisions r
    JOIN public.quotations q ON q.id = r.quotation_id
   WHERE r.is_current
     AND public.can_read_quotation(r.quotation_id, (SELECT auth.uid()));

COMMENT ON VIEW public.quotation_current_revision IS
  'The live revision of each quotation with its VAT breakdown. No cost and no margin — those stay in 7A/7B behind can_read_commercial_cost().';
GRANT SELECT ON public.quotation_current_revision TO authenticated;
