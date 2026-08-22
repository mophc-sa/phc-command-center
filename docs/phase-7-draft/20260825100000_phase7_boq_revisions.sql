-- =========================================================
-- PHASE 7 (1/4) — BOQ revisions and lines.
--
-- WHY NEW TABLES RATHER THAN RESHAPING boq_items
-- ----------------------------------------------
-- `boq_items` hangs directly off a BOQ with no revision between them, so there
-- is nowhere to put "this is what we priced in rev 1, and this is rev 2". The
-- AI extractor's answer to a re-run was to delete every line and re-insert —
-- which is what hotfix B stopped, and it was the only answer that shape allows.
--
-- `boq_items` is left exactly where it is, with its data (zero rows today) and
-- its policies. It becomes the legacy read path; `boq_lines` is canonical. That
-- keeps Phase 5's project-number governance working untouched while the new
-- model lands, and means nothing has to be migrated on the day this applies.
--
-- WHAT MAKES A REVISION IMMUTABLE
-- -------------------------------
-- Freezing is a one-way door: `frozen_at` set once, and from that moment the
-- revision's own row and every line under it refuse UPDATE and DELETE. Before
-- freezing, a draft revision is ordinary editable data — estimation needs to be
-- able to correct a quantity without inventing a new revision each time.
--
-- There is no DELETE policy on either table and a trigger backs that up, so the
-- service role cannot delete either. Same pattern as Phase 6 documents and the
-- hotfix B guard, for the same reason: an extractor or a script should never be
-- one bug away from erasing commercial history.
--
-- NO BOQ → NO PROJECT NUMBER
-- --------------------------
-- Phase 5's rule is extended, not replaced. `project_has_valid_boq()` accepted
-- a `boqs` row with status verified/partially_verified; it now also accepts a
-- FROZEN revision with one of those statuses. A draft revision does not count —
-- an unfrozen revision is a work in progress, and issuing a project number
-- against something still being edited is exactly what the rule exists to stop.
-- The legacy clause stays so the Phase 5 behavioural suite keeps passing.
--
-- COST IS PROTECTED THE SAME WAY AS boq_items
-- -------------------------------------------
-- `unit_price` and `line_total` are cost; `selling_price` is what sales see.
-- Column privileges remove the cost columns from `authenticated` outright and
-- a security-definer view hands them back to estimation, finance and MD/GM/CEO
-- — the mechanism from the commercial isolation hotfix, applied to the new
-- table from birth rather than retrofitted.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.boq_revision_status AS ENUM (
    'draft',              -- being built or corrected
    'estimated_scope',    -- our estimate, no client document
    'partially_verified', -- some of it confirmed against a real BOQ
    'verified',           -- confirmed against the client's BOQ
    'superseded'          -- replaced by a later revision
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 1. Revisions ============
CREATE TABLE IF NOT EXISTS public.boq_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id          UUID NOT NULL REFERENCES public.boqs(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL,
  status          public.boq_revision_status NOT NULL DEFAULT 'draft',
  notes           TEXT,

  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The one-way door. Null means editable.
  frozen_at       TIMESTAMPTZ,
  frozen_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  superseded_by   UUID REFERENCES public.boq_revisions(id) ON DELETE SET NULL,
  superseded_at   TIMESTAMPTZ,
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT boq_revisions_number_positive     CHECK (revision_number >= 1),
  CONSTRAINT boq_revisions_freeze_consistent   CHECK ((frozen_at IS NULL) = (frozen_by IS NULL)),
  CONSTRAINT boq_revisions_supersede_consistent CHECK ((superseded_by IS NULL) = (superseded_at IS NULL)),
  CONSTRAINT boq_revisions_not_self_superseding CHECK (superseded_by IS DISTINCT FROM id),
  -- A superseded revision is not the current one. Stated as a constraint
  -- because the two are set by different code paths and would otherwise drift.
  CONSTRAINT boq_revisions_superseded_not_current CHECK (NOT (superseded_by IS NOT NULL AND is_current))
);

CREATE UNIQUE INDEX IF NOT EXISTS boq_revisions_number_unique
  ON public.boq_revisions (boq_id, revision_number);

-- One current revision per BOQ. Partial, so superseded rows do not contend.
CREATE UNIQUE INDEX IF NOT EXISTS boq_revisions_one_current
  ON public.boq_revisions (boq_id) WHERE is_current;

CREATE INDEX IF NOT EXISTS boq_revisions_boq ON public.boq_revisions (boq_id);

COMMENT ON TABLE public.boq_revisions IS
  'Append-only BOQ revisions. Freezing is one-way: once frozen_at is set, the revision and its lines refuse UPDATE and DELETE. Only a FROZEN revision with status verified or partially_verified satisfies the project-number rule.';

-- ============ 2. Lines ============
CREATE TABLE IF NOT EXISTS public.boq_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id     UUID NOT NULL REFERENCES public.boq_revisions(id) ON DELETE RESTRICT,
  line_number     INTEGER,

  -- PHC signage shape, carried over from boq_items so nothing is lost.
  sign_type       TEXT NOT NULL,
  description     TEXT,
  dimensions      TEXT,
  material        TEXT,
  mounting        TEXT,
  illumination    TEXT,
  finish          TEXT,
  location        TEXT,

  quantity        NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit            TEXT,

  -- COST. Revoked from `authenticated` below; readable only through
  -- boq_line_costs. Excluding VAT, like every price in Phase 7.
  unit_price      NUMERIC(14,2),
  line_total      NUMERIC(16,2),

  -- SELLING. What sales are shown. Also excluding VAT.
  selling_price   NUMERIC(16,2),

  source_ref      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT boq_lines_quantity_not_negative CHECK (quantity >= 0),
  CONSTRAINT boq_lines_unit_price_not_negative CHECK (unit_price IS NULL OR unit_price >= 0),
  CONSTRAINT boq_lines_selling_not_negative CHECK (selling_price IS NULL OR selling_price >= 0)
);

CREATE INDEX IF NOT EXISTS boq_lines_revision ON public.boq_lines (revision_id);

COMMENT ON COLUMN public.boq_lines.unit_price IS
  'Cost per unit, EXCLUDING VAT. Revoked from the authenticated role — reachable only through public.boq_line_costs.';
COMMENT ON COLUMN public.boq_lines.selling_price IS
  'Line selling price, EXCLUDING VAT. Visible to anyone who may see the BOQ.';

-- ============ 3. Immutability ============
CREATE OR REPLACE FUNCTION public.boq_revision_is_frozen(_revision_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.boq_revisions r WHERE r.id = _revision_id AND r.frozen_at IS NOT NULL); $$;

CREATE OR REPLACE FUNCTION public.boq_revisions_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOQ revisions cannot be deleted — supersede instead. | لا تُحذف مراجعات الـBOQ، بل تُستبدل.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.frozen_at IS NOT NULL THEN
    -- Superseding and un-currenting are the only edits a frozen revision
    -- accepts: they record what happened to it, they do not change what it says.
    IF NEW.revision_number IS DISTINCT FROM OLD.revision_number
       OR NEW.boq_id     IS DISTINCT FROM OLD.boq_id
       OR NEW.status     IS DISTINCT FROM OLD.status
       OR NEW.notes      IS DISTINCT FROM OLD.notes
       OR NEW.frozen_at  IS DISTINCT FROM OLD.frozen_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'This BOQ revision is frozen; create a new revision instead. | هذه المراجعة مجمّدة — أنشئ مراجعة جديدة.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Unfreezing is never allowed, frozen or not.
  IF OLD.frozen_at IS NOT NULL AND NEW.frozen_at IS NULL THEN
    RAISE EXCEPTION 'A frozen BOQ revision cannot be unfrozen.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS boq_revisions_guard_upd ON public.boq_revisions;
CREATE TRIGGER boq_revisions_guard_upd BEFORE UPDATE ON public.boq_revisions
  FOR EACH ROW EXECUTE FUNCTION public.boq_revisions_guard();
DROP TRIGGER IF EXISTS boq_revisions_guard_del ON public.boq_revisions;
CREATE TRIGGER boq_revisions_guard_del BEFORE DELETE ON public.boq_revisions
  FOR EACH ROW EXECUTE FUNCTION public.boq_revisions_guard();

CREATE OR REPLACE FUNCTION public.boq_lines_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE _rev UUID;
BEGIN
  _rev := CASE TG_OP WHEN 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  IF public.boq_revision_is_frozen(_rev) THEN
    RAISE EXCEPTION 'The BOQ revision is frozen; its lines cannot be changed or removed. | مراجعة الـBOQ مجمّدة — لا يمكن تعديل بنودها أو حذفها.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS boq_lines_guard_all ON public.boq_lines;
CREATE TRIGGER boq_lines_guard_all BEFORE INSERT OR UPDATE OR DELETE ON public.boq_lines
  FOR EACH ROW EXECUTE FUNCTION public.boq_lines_guard();

-- ============ 4. Visibility ============
-- Reuses can_read_boq() from the commercial isolation hotfix rather than
-- inventing a second rule: a revision is exactly as visible as its BOQ.
CREATE OR REPLACE FUNCTION public.can_read_boq_revision(_revision_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.boq_revisions r
      JOIN public.boqs b ON b.id = r.boq_id
     WHERE r.id = _revision_id
       AND public.can_read_boq(b.related_opportunity_id, _user_id)
  );
$$;

ALTER TABLE public.boq_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boq_lines     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "BOQ revisions readable with the BOQ" ON public.boq_revisions;
CREATE POLICY "BOQ revisions readable with the BOQ"
  ON public.boq_revisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.boqs b WHERE b.id = boq_revisions.boq_id
                  AND public.can_read_boq(b.related_opportunity_id, (SELECT auth.uid()))));

DROP POLICY IF EXISTS "BOQ revisions writable by pipeline or estimation" ON public.boq_revisions;
CREATE POLICY "BOQ revisions writable by pipeline or estimation"
  ON public.boq_revisions FOR INSERT TO authenticated
  WITH CHECK (
    public.is_pipeline_operator((SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
  );

DROP POLICY IF EXISTS "BOQ revisions updatable by pipeline or estimation" ON public.boq_revisions;
CREATE POLICY "BOQ revisions updatable by pipeline or estimation"
  ON public.boq_revisions FOR UPDATE TO authenticated
  USING (
    public.is_pipeline_operator((SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
  )
  WITH CHECK (
    public.is_pipeline_operator((SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
  );
-- No DELETE policy.

DROP POLICY IF EXISTS "BOQ lines readable with the revision" ON public.boq_lines;
CREATE POLICY "BOQ lines readable with the revision"
  ON public.boq_lines FOR SELECT TO authenticated
  USING (public.can_read_boq_revision(revision_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "BOQ lines writable by pipeline or estimation" ON public.boq_lines;
CREATE POLICY "BOQ lines writable by pipeline or estimation"
  ON public.boq_lines FOR INSERT TO authenticated
  WITH CHECK (
    public.is_pipeline_operator((SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
  );

DROP POLICY IF EXISTS "BOQ lines updatable by pipeline or estimation" ON public.boq_lines;
CREATE POLICY "BOQ lines updatable by pipeline or estimation"
  ON public.boq_lines FOR UPDATE TO authenticated
  USING (
    public.is_pipeline_operator((SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
  )
  WITH CHECK (
    public.is_pipeline_operator((SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
  );
-- No DELETE policy.

-- ============ 5. Column privileges — cost is not a column anyone selects ============
REVOKE ALL ON public.boq_lines FROM authenticated, anon;
GRANT SELECT (
  id, revision_id, line_number, sign_type, description, dimensions, material,
  mounting, illumination, finish, location, quantity, unit, selling_price,
  source_ref, created_at
) ON public.boq_lines TO authenticated;
GRANT INSERT, UPDATE ON public.boq_lines TO authenticated;
-- unit_price and line_total are deliberately absent from the SELECT list.

REVOKE ALL ON public.boq_revisions FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.boq_revisions TO authenticated;

-- Cost, handed back to the roles entitled to it. Same shape as boq_item_costs.
CREATE OR REPLACE VIEW public.boq_line_costs AS
  SELECT l.id, l.revision_id, l.line_number, l.sign_type, l.quantity, l.unit,
         l.unit_price, l.line_total, l.selling_price,
         (l.selling_price - l.line_total) AS margin_value,
         CASE WHEN l.selling_price IS NULL OR l.selling_price = 0 THEN NULL
              ELSE round(((l.selling_price - l.line_total) / l.selling_price) * 100, 2) END AS margin_pct
    FROM public.boq_lines l
   WHERE public.can_read_commercial_cost((SELECT auth.uid()))
     AND public.can_read_boq_revision(l.revision_id, (SELECT auth.uid()));

COMMENT ON VIEW public.boq_line_costs IS
  'Cost and margin per BOQ line, for estimation, finance and MD/GM/CEO only. All figures EXCLUDE VAT. Runs as owner because the base columns are revoked from authenticated, so it enforces both the row rule and the role rule itself.';
GRANT SELECT ON public.boq_line_costs TO authenticated;

CREATE OR REPLACE VIEW public.boq_revision_sales_totals AS
  SELECT r.id AS revision_id, r.boq_id, r.revision_number, r.status, r.is_current, r.frozen_at,
         sum(l.selling_price) AS selling_total,
         count(l.id)          AS line_count
    FROM public.boq_revisions r
    LEFT JOIN public.boq_lines l ON l.revision_id = r.id
   WHERE EXISTS (SELECT 1 FROM public.boqs b WHERE b.id = r.boq_id
                  AND public.can_read_boq(b.related_opportunity_id, (SELECT auth.uid())))
   GROUP BY r.id, r.boq_id, r.revision_number, r.status, r.is_current, r.frozen_at;

COMMENT ON VIEW public.boq_revision_sales_totals IS
  'Selling-side roll-up per revision, EXCLUDING VAT. No cost reaches this view, so the deal owner and the pipeline can use it.';
GRANT SELECT ON public.boq_revision_sales_totals TO authenticated;

-- ============ 6. NO BOQ → NO PROJECT NUMBER, extended ============
-- The Phase 5 clause is kept verbatim so its behavioural suite still passes;
-- the revision clause is added beside it. Only a FROZEN revision counts — a
-- draft is a work in progress, and issuing a project number against something
-- still being edited is what the rule exists to prevent.
CREATE OR REPLACE FUNCTION public.project_has_valid_boq(_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Phase 5, unchanged.
    SELECT 1
      FROM public.opportunities o
      JOIN public.boqs b ON b.related_opportunity_id = o.id
     WHERE o.project_id = _project_id
       AND b.status IN ('verified', 'partially_verified')
    UNION ALL
    -- Phase 7: a frozen revision carrying the same statuses.
    SELECT 1
      FROM public.opportunities o
      JOIN public.boqs b          ON b.related_opportunity_id = o.id
      JOIN public.boq_revisions r ON r.boq_id = b.id
     WHERE o.project_id = _project_id
       AND r.frozen_at IS NOT NULL
       AND r.status IN ('verified', 'partially_verified')
  );
$$;

COMMENT ON FUNCTION public.project_has_valid_boq IS
  'True when a project has a verified or partially_verified BOQ — either the legacy boqs.status (Phase 5) or a FROZEN boq_revision carrying that status (Phase 7). A draft revision does not count: issuing a project number against a BOQ still being edited is what this rule exists to prevent.';
