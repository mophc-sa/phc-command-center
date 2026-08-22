-- =========================================================
-- PHASE 7A (1/3) — BOQ revisions and lines.
--
-- WHY NEW TABLES RATHER THAN RESHAPING boq_items
-- ----------------------------------------------
-- `boq_items` hangs directly off a BOQ with no revision between them, so there
-- is nowhere to record "this is what we priced in rev 1, and this is rev 2".
-- The AI extractor's answer to a re-run was to delete every line and re-insert,
-- which hotfix B stopped — and it was the only answer that shape allows.
--
-- `boqs`, `boq_items` and `quotations` are left exactly as they are, with their
-- data, policies and the delete guard. `boq_items` becomes the legacy read
-- path; `boq_lines` is canonical. Nothing is migrated on the day this applies,
-- and Phase 5's project-number rule keeps working against the old shape while
-- the new one fills up.
--
-- FREEZING IS THE ONE-WAY DOOR
-- ----------------------------
-- Before it, a revision is ordinary editable data — estimation must be able to
-- correct a quantity without inventing a revision each time. After it, the
-- revision and every line under it refuse UPDATE and DELETE. Superseding and
-- un-currenting stay allowed on the header because they record what happened
-- TO the revision; they do not change what it says.
--
-- No DELETE policy on either table, and a trigger behind that, so the service
-- role cannot delete either. Same pattern as Phase 6 documents and the hotfix B
-- guard, for the same reason: a script should never be one bug from erasing
-- commercial history.
--
-- source_type EXISTS FOR THE AUDIT TRAIL
-- --------------------------------------
-- Three ways a revision comes into being — a human typed it, the extractor
-- staged it and somebody promoted it, or it arrived with the historical import.
-- Recording which lets the AI's contribution be evaluated later instead of
-- guessed at, and keeps `historical_import` reserved before 7D needs it.
--
-- NO BOQ -> NO PROJECT NUMBER, EXTENDED NOT REPLACED
-- --------------------------------------------------
-- Phase 5's clause is kept verbatim so its behavioural suite passes unchanged.
-- A second clause accepts a FROZEN revision carrying verified or
-- partially_verified. A draft revision does not count: issuing a project number
-- against a BOQ still being edited is exactly what the rule exists to prevent.
--
-- COST IS PROTECTED FROM BIRTH
-- ----------------------------
-- `unit_price` and `line_total` are cost; `selling_price` is what sales see.
-- Column privileges remove the cost columns from `authenticated` outright and a
-- security-definer view hands them back to estimation, finance and MD/GM/CEO —
-- the mechanism from the commercial isolation hotfix, applied to a new table at
-- creation rather than retrofitted after an exposure.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.boq_revision_status AS ENUM (
    'draft', 'estimated_scope', 'partially_verified', 'verified', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.boq_source_type AS ENUM ('manual', 'ai_extraction', 'historical_import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Folded in here rather than a standalone enum migration: the value describes
-- the table this file creates, and a separate migration whose only content is
-- an irreversible enum addition is a rollback hazard for no benefit.
DO $$ BEGIN
  ALTER TYPE public.document_entity_type ADD VALUE IF NOT EXISTS 'boq_revision';
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- ============ 1. Revisions ============
CREATE TABLE IF NOT EXISTS public.boq_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id          UUID NOT NULL REFERENCES public.boqs(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL,
  status          public.boq_revision_status NOT NULL DEFAULT 'draft',
  source_type     public.boq_source_type NOT NULL DEFAULT 'manual',
  -- Where it came from: an extraction id, an archive row id, or null for a
  -- human. Deliberately untyped — it points into three different tables.
  source_ref      TEXT,
  notes           TEXT,

  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  frozen_at       TIMESTAMPTZ,
  frozen_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  superseded_by   UUID REFERENCES public.boq_revisions(id) ON DELETE SET NULL,
  superseded_at   TIMESTAMPTZ,
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT boq_revisions_number_positive        CHECK (revision_number >= 1),
  CONSTRAINT boq_revisions_freeze_consistent      CHECK ((frozen_at IS NULL) = (frozen_by IS NULL)),
  CONSTRAINT boq_revisions_supersede_consistent   CHECK ((superseded_by IS NULL) = (superseded_at IS NULL)),
  CONSTRAINT boq_revisions_not_self_superseding   CHECK (superseded_by IS DISTINCT FROM id),
  -- Two columns set by different code paths that must agree; stated once here
  -- rather than trusted in two places.
  CONSTRAINT boq_revisions_superseded_not_current CHECK (NOT (superseded_by IS NOT NULL AND is_current))
);

CREATE UNIQUE INDEX IF NOT EXISTS boq_revisions_number_unique ON public.boq_revisions (boq_id, revision_number);
CREATE UNIQUE INDEX IF NOT EXISTS boq_revisions_one_current   ON public.boq_revisions (boq_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS boq_revisions_boq    ON public.boq_revisions (boq_id);
CREATE INDEX IF NOT EXISTS boq_revisions_source ON public.boq_revisions (source_type);

COMMENT ON TABLE public.boq_revisions IS
  'Append-only BOQ revisions. Freezing is one-way: once frozen_at is set the revision and its lines refuse UPDATE and DELETE. Only a FROZEN revision with status verified or partially_verified satisfies the project-number rule.';
COMMENT ON COLUMN public.boq_revisions.source_type IS
  'How the revision came to exist: manual, ai_extraction (promoted from boq_extractions), or historical_import (reserved for Phase 7D). Kept so the AI path can be evaluated rather than guessed at.';

-- ============ 2. Lines ============
CREATE TABLE IF NOT EXISTS public.boq_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id   UUID NOT NULL REFERENCES public.boq_revisions(id) ON DELETE RESTRICT,
  line_number   INTEGER,

  -- The PHC signage shape, carried over from boq_items unchanged so nothing is
  -- lost when that table stops being written to.
  sign_type     TEXT NOT NULL,
  description   TEXT,
  dimensions    TEXT,
  material      TEXT,
  mounting      TEXT,
  illumination  TEXT,
  finish        TEXT,
  location      TEXT,
  quantity      NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit          TEXT,

  -- COST, excluding VAT. Revoked from `authenticated` below; reachable only
  -- through public.boq_line_costs.
  unit_price    NUMERIC(14,2),
  line_total    NUMERIC(16,2),

  -- SELLING, excluding VAT. What sales are shown.
  selling_price NUMERIC(16,2),

  item_source   TEXT,
  sort_order    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT boq_lines_quantity_not_negative   CHECK (quantity >= 0),
  CONSTRAINT boq_lines_unit_price_not_negative CHECK (unit_price IS NULL OR unit_price >= 0),
  CONSTRAINT boq_lines_selling_not_negative    CHECK (selling_price IS NULL OR selling_price >= 0)
);

CREATE INDEX IF NOT EXISTS boq_lines_revision ON public.boq_lines (revision_id);

COMMENT ON COLUMN public.boq_lines.unit_price IS
  'Cost per unit, EXCLUDING VAT. Revoked from the authenticated role — reachable only through public.boq_line_costs.';
COMMENT ON COLUMN public.boq_lines.selling_price IS
  'Line selling price, EXCLUDING VAT. Visible to anyone who may see the BOQ.';

-- ============ 3. Immutability ============
CREATE OR REPLACE FUNCTION public.boq_revision_is_frozen(_revision_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.boq_revisions r WHERE r.id = _revision_id AND r.frozen_at IS NOT NULL); $$;

CREATE OR REPLACE FUNCTION public.boq_revisions_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOQ revisions cannot be deleted — supersede instead. | لا تُحذف مراجعات الـBOQ، بل تُستبدل.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.frozen_at IS NOT NULL THEN
    IF NEW.revision_number IS DISTINCT FROM OLD.revision_number
       OR NEW.boq_id      IS DISTINCT FROM OLD.boq_id
       OR NEW.status      IS DISTINCT FROM OLD.status
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.notes       IS DISTINCT FROM OLD.notes
       OR NEW.frozen_at   IS DISTINCT FROM OLD.frozen_at
       OR NEW.created_by  IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'This BOQ revision is frozen; create a new revision instead. | هذه المراجعة مجمّدة — أنشئ مراجعة جديدة.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

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
-- Reuses can_read_boq() rather than inventing a second rule: a revision is
-- exactly as visible as the BOQ it belongs to.
CREATE OR REPLACE FUNCTION public.can_read_boq_revision(_revision_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.boq_revisions r JOIN public.boqs b ON b.id = r.boq_id
     WHERE r.id = _revision_id AND public.can_read_boq(b.related_opportunity_id, _user_id));
$$;

ALTER TABLE public.boq_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boq_lines     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "BOQ revisions readable with the BOQ" ON public.boq_revisions;
CREATE POLICY "BOQ revisions readable with the BOQ" ON public.boq_revisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.boqs b WHERE b.id = boq_revisions.boq_id
                  AND public.can_read_boq(b.related_opportunity_id, (SELECT auth.uid()))));

DROP POLICY IF EXISTS "BOQ revisions insertable by pipeline or estimation" ON public.boq_revisions;
CREATE POLICY "BOQ revisions insertable by pipeline or estimation" ON public.boq_revisions FOR INSERT TO authenticated
  WITH CHECK (public.is_pipeline_operator((SELECT auth.uid()))
              OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role));

DROP POLICY IF EXISTS "BOQ revisions updatable by pipeline or estimation" ON public.boq_revisions;
CREATE POLICY "BOQ revisions updatable by pipeline or estimation" ON public.boq_revisions FOR UPDATE TO authenticated
  USING (public.is_pipeline_operator((SELECT auth.uid()))
         OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role))
  WITH CHECK (public.is_pipeline_operator((SELECT auth.uid()))
              OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role));

DROP POLICY IF EXISTS "BOQ lines readable with the revision" ON public.boq_lines;
CREATE POLICY "BOQ lines readable with the revision" ON public.boq_lines FOR SELECT TO authenticated
  USING (public.can_read_boq_revision(revision_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "BOQ lines insertable by pipeline or estimation" ON public.boq_lines;
CREATE POLICY "BOQ lines insertable by pipeline or estimation" ON public.boq_lines FOR INSERT TO authenticated
  WITH CHECK (public.is_pipeline_operator((SELECT auth.uid()))
              OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role));

DROP POLICY IF EXISTS "BOQ lines updatable by pipeline or estimation" ON public.boq_lines;
CREATE POLICY "BOQ lines updatable by pipeline or estimation" ON public.boq_lines FOR UPDATE TO authenticated
  USING (public.is_pipeline_operator((SELECT auth.uid()))
         OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role))
  WITH CHECK (public.is_pipeline_operator((SELECT auth.uid()))
              OR public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role));

-- No DELETE policy on either table, deliberately.

-- ============ 5. Column privileges — the part RLS cannot do ============
-- Postgres ignores column grants while a table-wide SELECT grant exists, so the
-- table grant goes first and the permitted columns are re-granted by name. A
-- cost column added later is NOT granted by default, which is the right
-- failure direction.
REVOKE ALL ON public.boq_lines FROM authenticated, anon;
GRANT SELECT (
  id, revision_id, line_number, sign_type, description, dimensions, material,
  mounting, illumination, finish, location, quantity, unit, selling_price,
  item_source, sort_order, created_at
) ON public.boq_lines TO authenticated;
GRANT INSERT, UPDATE ON public.boq_lines TO authenticated;
-- unit_price and line_total are deliberately absent from the SELECT list.

REVOKE ALL ON public.boq_revisions FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.boq_revisions TO authenticated;

-- ============ 6. Cost, handed back to the roles entitled to it ============
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

-- Selling only. No cost reaches this view, so the deal owner and the pipeline
-- can use it as a headline.
CREATE OR REPLACE VIEW public.boq_revision_sales_totals AS
  SELECT r.id AS revision_id, r.boq_id, r.revision_number, r.status, r.source_type,
         r.is_current, r.frozen_at,
         sum(l.selling_price) AS selling_total, count(l.id) AS line_count
    FROM public.boq_revisions r
    LEFT JOIN public.boq_lines l ON l.revision_id = r.id
   WHERE EXISTS (SELECT 1 FROM public.boqs b WHERE b.id = r.boq_id
                  AND public.can_read_boq(b.related_opportunity_id, (SELECT auth.uid())))
   GROUP BY r.id, r.boq_id, r.revision_number, r.status, r.source_type, r.is_current, r.frozen_at;

COMMENT ON VIEW public.boq_revision_sales_totals IS
  'Selling-side roll-up per revision, EXCLUDING VAT. Contains no cost and no margin, so it is safe for the deal owner and the pipeline.';
GRANT SELECT ON public.boq_revision_sales_totals TO authenticated;

-- ============ 7. NO BOQ -> NO PROJECT NUMBER, extended ============
CREATE OR REPLACE FUNCTION public.project_has_valid_boq(_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    -- Phase 5, verbatim. Its behavioural suite must keep passing unchanged.
    SELECT 1
      FROM public.opportunities o
      JOIN public.boqs b ON b.related_opportunity_id = o.id
     WHERE o.project_id = _project_id
       AND b.status IN ('verified', 'partially_verified')
    UNION ALL
    -- Phase 7A: a FROZEN revision carrying the same statuses. A draft does not
    -- count — a project number issued against a BOQ still being edited is what
    -- the rule exists to prevent.
    SELECT 1
      FROM public.opportunities o
      JOIN public.boqs b          ON b.related_opportunity_id = o.id
      JOIN public.boq_revisions r ON r.boq_id = b.id
     WHERE o.project_id = _project_id
       AND r.frozen_at IS NOT NULL
       AND r.status IN ('verified', 'partially_verified'));
$$;

COMMENT ON FUNCTION public.project_has_valid_boq IS
  'True when a project has a verified or partially_verified BOQ — either the legacy boqs.status (Phase 5) or a FROZEN boq_revision carrying that status (Phase 7A). A draft revision does not count.';
