-- =========================================================
-- PHASE 7B — supplier quotes and the cost side of a BOQ.
--
-- WHAT DID NOT EXIST
-- ------------------
-- Nothing. `vendors` is a directory — name, scope, materials, contact, lead
-- time — and `vendors_private.reference_prices` is a free-text column. There
-- was no supplier quote, no per-line cost, no way to compare two suppliers on
-- the same BOQ line. Phase 7A gave a BOQ line a `unit_price`; this is where
-- that number comes from.
--
-- WHY THE LINE IS THE UNIT OF COMPARISON
-- --------------------------------------
-- Every supplier line points at a `boq_line_id`, not at the quote as a whole.
-- That is the entire value: the pylon can come from one supplier and the totems
-- from another, and the comparison view answers "who is cheapest for THIS line"
-- rather than "whose total is smaller", which is the question estimation
-- actually asks.
--
-- HISTORY BY SUPERSEDE, NOT EDIT
-- ------------------------------
-- A supplier revising their price creates a new row with revision_number + 1
-- and supersedes_id pointing back; the old row loses is_current and keeps its
-- figures. Same pattern as BOQ revisions and Phase 6 documents, for the same
-- reason — the price we were quoted in March is a fact about March.
--
-- FREEZING IS PROPAGATED, NOT DECIDED TWICE
-- -----------------------------------------
-- There is exactly one freeze decision in the system and it belongs to the BOQ
-- revision. A supplier quote cannot be frozen on its own: frozen_at/frozen_by
-- are stamped onto it by a trigger when its revision freezes, copied from the
-- revision so the two can never disagree about who froze it or when. Any
-- attempt to set those columns by hand is refused.
--
-- The stamp is a record, not a second gate — enforcement still reads
-- boq_revision_is_frozen(). Without the stamp the 'frozen' status was
-- unreachable and a frozen quote carried no evidence on its own row of when it
-- stopped being editable. Terminal states survive: a cancelled or superseded
-- quote keeps its status and is stamped, rather than being relabelled 'frozen'.
--
-- COST IS THE RAWEST DATA HERE
-- ----------------------------
-- Supplier unit cost is the floor beneath everything else, so it is gated more
-- tightly than the BOQ: can_read_commercial_cost() only — estimation, finance,
-- MD/GM/CEO. NOT the pipeline. Phase 7A established that sales_manager,
-- bd_manager and sales_ops run on selling price; a supplier's unit cost is the
-- one number that would let them reverse the margin exactly.
--
-- Column privileges do the work RLS cannot: unit_cost and line_cost are revoked
-- from `authenticated` outright, so no PostgREST query can name them.
--
-- SELECTION HAS NO SEPARATE APPROVAL, DELIBERATELY
-- ------------------------------------------------
-- estimation_manager selects, and who and when is recorded. The commercial
-- consequence of a poor supplier choice arrives in the margin, which already
-- passes commercial review, finance review and the GM. A fourth gate on the
-- supplier itself would add a delay without adding a decision-maker who knows
-- something the later three do not.
--
-- WHAT THIS DOES NOT TOUCH
-- ------------------------
-- `vendors` gains one generated column and one index for duplicate detection.
-- `vendors_private` is untouched; its reference_prices column is deprecated by
-- comment rather than dropped, because dropping it is a data decision and this
-- is a schema one. No vendor data is migrated. The vendors blanket-read
-- exposure is NOT addressed here — it is a real finding and deserves its own
-- decision rather than being absorbed into a feature phase.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.supplier_quote_status AS ENUM (
    'draft', 'sent', 'responses_received', 'evaluation',
    'selected', 'frozen', 'cancelled', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 1. Vendor duplicate DETECTION (the one approved addition) ======
-- Two spellings of one supplier produce two quote trails and a comparison that
-- silently omits half the prices.
--
-- DETECTION, NOT PREVENTION. An earlier draft made this a UNIQUE index, which
-- refuses the insert outright. That is the wrong trade: the normaliser strips
-- company suffixes, so "Al Rajhi Trading" and "Al Rajhi Group" both reduce to
-- "al rajhi" — and those can be two genuinely different firms. A hard block
-- would leave procurement unable to register a real supplier at all, with no
-- override, and the workaround would be to misspell the name on purpose. A
-- false positive here must cost a second look, never a blocked vendor.
--
-- Deliberately narrow: casefold, strip Arabic diacritics and tatweel, drop
-- punctuation, collapse whitespace, and remove the handful of company suffixes
-- that differ between two records for the same firm. It is not a fuzzy matcher
-- and does not try to be — it catches "Al Rajhi Co." vs "AL-RAJHI CO", not
-- "Rajhi Contracting" vs "Al Rajhi Contracting Ltd".
CREATE OR REPLACE FUNCTION public.normalize_vendor_name(_name TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT nullif(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(coalesce(_name, '')),
        -- Arabic diacritics (harakat) and tatweel carry no identity.
        '[ـً-ْ]', '', 'g'),
      -- Punctuation and the usual company-suffix noise.
      '\m(co|llc|ltd|limited|company|est|establishment|corp|corporation|trading|group|intl|international)\M|[[:punct:]]', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;

COMMENT ON FUNCTION public.normalize_vendor_name IS
  'Casefold + strip Arabic diacritics/tatweel + drop punctuation and common company suffixes, for duplicate DETECTION only. Not a fuzzy matcher: it catches spelling and punctuation variants of the same name, not different names for the same firm.';

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS name_normalized TEXT
  GENERATED ALWAYS AS (public.normalize_vendor_name(name)) STORED;

-- Non-unique: this index makes the lookup fast, it does not enforce anything.
-- (Dropped defensively in case an earlier draft's unique index is present.)
DROP INDEX IF EXISTS public.vendors_name_normalized_unique;
CREATE INDEX IF NOT EXISTS vendors_name_normalized_idx
  ON public.vendors (name_normalized) WHERE name_normalized IS NOT NULL;

COMMENT ON COLUMN public.vendors.name_normalized IS
  'Generated. Exists so two spellings of one supplier can be FOUND, not so one can be refused. Never displayed. See vendor_duplicate_candidates.';

-- What procurement looks at: names that collapse to the same key. Advisory —
-- a row here means "check these two", not "one of these is invalid".
CREATE OR REPLACE VIEW public.vendor_duplicate_candidates AS
  SELECT name_normalized,
         count(*)                       AS vendor_count,
         array_agg(id ORDER BY created_at) AS vendor_ids,
         array_agg(name ORDER BY created_at) AS vendor_names
    FROM public.vendors
   WHERE name_normalized IS NOT NULL
   GROUP BY name_normalized
  HAVING count(*) > 1;

COMMENT ON VIEW public.vendor_duplicate_candidates IS
  'Vendors whose names normalise identically — a prompt to review, never a constraint. Suffix stripping means two different firms can legitimately appear here, so nothing acts on this automatically.';
GRANT SELECT ON public.vendor_duplicate_candidates TO authenticated;

COMMENT ON COLUMN public.vendors_private.reference_prices IS
  'DEPRECATED as a pricing source since Phase 7B — free text was never comparable. Real supplier pricing lives in supplier_quote_lines. Kept because removing it is a data decision, not a schema one.';

-- ============ 2. Supplier quotes ============
CREATE TABLE IF NOT EXISTS public.supplier_quotes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_revision_id      UUID NOT NULL REFERENCES public.boq_revisions(id) ON DELETE RESTRICT,
  vendor_id            UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,

  -- The external handle. Kept as its own column so a future supplier portal has
  -- something to quote back that is not an internal uuid.
  rfq_reference        TEXT,
  status               public.supplier_quote_status NOT NULL DEFAULT 'draft',

  sent_at              TIMESTAMPTZ,
  response_received_at TIMESTAMPTZ,
  valid_until          DATE,
  currency             CHAR(3) NOT NULL DEFAULT 'SAR',
  lead_time_days       INTEGER,
  payment_terms        TEXT,
  notes                TEXT,

  revision_number      INTEGER NOT NULL DEFAULT 1,
  supersedes_id        UUID REFERENCES public.supplier_quotes(id) ON DELETE SET NULL,
  is_current           BOOLEAN NOT NULL DEFAULT TRUE,

  -- Stamped by propagation when the BOQ revision freezes. Never set by hand.
  frozen_at            TIMESTAMPTZ,
  frozen_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  cancel_reason        TEXT,
  -- Nullable on purpose: a portal-submitted quote has no internal author.
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Mirrors 7A's boq_revisions_freeze_consistent.
  CONSTRAINT sq_freeze_consistent   CHECK ((frozen_at IS NULL) = (frozen_by IS NULL)),
  CONSTRAINT sq_frozen_has_stamp    CHECK (status <> 'frozen' OR frozen_at IS NOT NULL),
  CONSTRAINT sq_revision_positive   CHECK (revision_number >= 1),
  CONSTRAINT sq_not_self_superseding CHECK (supersedes_id IS DISTINCT FROM id),
  CONSTRAINT sq_lead_time_sane      CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  CONSTRAINT sq_validity_after_send CHECK (valid_until IS NULL OR sent_at IS NULL
                                           OR valid_until >= sent_at::date),
  -- A cancellation nobody explained is a dead end for whoever finds it.
  CONSTRAINT sq_cancel_has_reason   CHECK (status <> 'cancelled' OR btrim(coalesce(cancel_reason,'')) <> ''),
  CONSTRAINT sq_superseded_not_current CHECK (NOT (status = 'superseded' AND is_current))
);

-- One live quote per supplier per revision. A second is a revision, not a race.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_quotes_one_current
  ON public.supplier_quotes (boq_revision_id, vendor_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS supplier_quotes_revision ON public.supplier_quotes (boq_revision_id);
CREATE INDEX IF NOT EXISTS supplier_quotes_vendor   ON public.supplier_quotes (vendor_id);
CREATE INDEX IF NOT EXISTS supplier_quotes_status   ON public.supplier_quotes (status);

COMMENT ON TABLE public.supplier_quotes IS
  'One supplier''s response to one BOQ revision. Revising means a new row superseding the old, never an edit. Freezes with its BOQ revision rather than on its own.';

-- ============ 3. Supplier quote lines ============
CREATE TABLE IF NOT EXISTS public.supplier_quote_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_quote_id UUID NOT NULL REFERENCES public.supplier_quotes(id) ON DELETE RESTRICT,
  -- The join that makes comparison per-line rather than per-quote.
  boq_line_id       UUID NOT NULL REFERENCES public.boq_lines(id) ON DELETE RESTRICT,

  -- COST, excluding VAT. Revoked from authenticated below.
  unit_cost         NUMERIC(14,2),
  quantity          NUMERIC(14,3),
  line_cost         NUMERIC(16,2),

  is_selected       BOOLEAN NOT NULL DEFAULT FALSE,
  selected_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  selected_at       TIMESTAMPTZ,
  selection_note    TEXT,

  lead_time_days    INTEGER,
  alternate_spec    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sql_cost_not_negative CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT sql_qty_not_negative  CHECK (quantity IS NULL OR quantity >= 0),
  CONSTRAINT sql_select_consistent CHECK ((is_selected = FALSE) OR (selected_by IS NOT NULL AND selected_at IS NOT NULL))
);

-- Exactly one chosen supplier per BOQ line.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_quote_lines_one_selected
  ON public.supplier_quote_lines (boq_line_id) WHERE is_selected;
CREATE INDEX IF NOT EXISTS sql_quote ON public.supplier_quote_lines (supplier_quote_id);
CREATE INDEX IF NOT EXISTS sql_line  ON public.supplier_quote_lines (boq_line_id);

COMMENT ON COLUMN public.supplier_quote_lines.unit_cost IS
  'Supplier unit cost, EXCLUDING VAT. Revoked from the authenticated role — the one number that would let the pipeline reverse the margin exactly. Reachable only through supplier_quote_costs.';

-- ============ 4. Guards ============
CREATE OR REPLACE FUNCTION public.supplier_quote_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE _boq_ccy CHAR(3); _rev UUID; _propagating BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Supplier quotes cannot be deleted — supersede or cancel instead. | لا تُحذف عروض المورّدين.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  _rev := NEW.boq_revision_id;
  -- Set only by propagate_freeze_to_supplier_quotes(), transaction-local.
  _propagating := coalesce(current_setting('phc.freezing_boq_revision', true), '') = 'on';

  -- The freeze stamp is the propagation trigger's to write. A hand-set
  -- frozen_at would be a second freeze decision, which is the thing this
  -- design exists to prevent.
  IF NOT _propagating AND (
       NEW.frozen_at IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.frozen_at END)
    OR NEW.frozen_by IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.frozen_by END)) THEN
    RAISE EXCEPTION 'frozen_at/frozen_by are set by freezing the BOQ revision, not on the quote. | التجميد يتم على مراجعة الـBOQ.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A frozen BOQ revision freezes everything priced against it.
  IF NOT _propagating AND public.boq_revision_is_frozen(_rev) THEN
    RAISE EXCEPTION 'The BOQ revision is frozen; its supplier quotes cannot change. | مراجعة الـBOQ مجمّدة.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Currency must match the BOQ. A USD quote against a SAR BOQ is storable but
  -- not comparable, and pretending to convert it would be worse than refusing.
  SELECT b.currency INTO _boq_ccy
    FROM public.boq_revisions r JOIN public.boqs b ON b.id = r.boq_id
   WHERE r.id = _rev;
  IF _boq_ccy IS NOT NULL AND NEW.currency <> _boq_ccy THEN
    RAISE EXCEPTION 'Supplier quote currency % does not match the BOQ currency % — conversion is not performed. | عملة عرض المورّد لا تطابق عملة الـBOQ.',
      NEW.currency, _boq_ccy USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS supplier_quotes_guard ON public.supplier_quotes;
CREATE TRIGGER supplier_quotes_guard BEFORE INSERT OR UPDATE ON public.supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION public.supplier_quote_guard();
DROP TRIGGER IF EXISTS supplier_quotes_no_delete ON public.supplier_quotes;
CREATE TRIGGER supplier_quotes_no_delete BEFORE DELETE ON public.supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION public.supplier_quote_guard();

CREATE OR REPLACE FUNCTION public.supplier_quote_line_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE _q RECORD; _line_rev UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Supplier quote lines cannot be deleted. | لا تُحذف بنود عرض المورّد.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT q.boq_revision_id, q.is_current, q.status INTO _q
    FROM public.supplier_quotes q WHERE q.id = NEW.supplier_quote_id;

  IF public.boq_revision_is_frozen(_q.boq_revision_id) THEN
    RAISE EXCEPTION 'The BOQ revision is frozen; its supplier lines cannot change.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The line must price a line of the SAME revision. Without this a quote could
  -- silently price rev 1 while attached to rev 2, and the comparison would be
  -- arithmetic on two different scopes.
  SELECT l.revision_id INTO _line_rev FROM public.boq_lines l WHERE l.id = NEW.boq_line_id;
  IF _line_rev IS DISTINCT FROM _q.boq_revision_id THEN
    RAISE EXCEPTION 'This BOQ line belongs to a different revision than the supplier quote. | البند يخص مراجعة أخرى.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Selecting from a superseded quote would pin the estimate to a price the
  -- supplier has already replaced.
  IF NEW.is_selected AND NOT coalesce(_q.is_current, FALSE) THEN
    RAISE EXCEPTION 'A superseded supplier quote cannot be selected. | لا يُختار عرض مورّد مُستبدَل.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Stamp the selector from the session, not from the payload.
  IF NEW.is_selected AND (TG_OP = 'INSERT' OR NOT coalesce(OLD.is_selected, FALSE)) THEN
    NEW.selected_by := coalesce(NEW.selected_by, auth.uid());
    NEW.selected_at := coalesce(NEW.selected_at, now());
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS supplier_quote_lines_guard ON public.supplier_quote_lines;
CREATE TRIGGER supplier_quote_lines_guard BEFORE INSERT OR UPDATE ON public.supplier_quote_lines
  FOR EACH ROW EXECUTE FUNCTION public.supplier_quote_line_guard();
DROP TRIGGER IF EXISTS supplier_quote_lines_no_delete ON public.supplier_quote_lines;
CREATE TRIGGER supplier_quote_lines_no_delete BEFORE DELETE ON public.supplier_quote_lines
  FOR EACH ROW EXECUTE FUNCTION public.supplier_quote_line_guard();

-- ============ 4b. Freeze propagation ============
-- Freezing a BOQ revision stamps its supplier quotes. SECURITY DEFINER because
-- the person freezing the revision is not necessarily allowed to UPDATE the
-- quotes, and this is not their decision to make — it is a consequence of one
-- they already made.
CREATE OR REPLACE FUNCTION public.propagate_freeze_to_supplier_quotes()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- One-way and once: only on the NULL -> NOT NULL transition.
  IF NEW.frozen_at IS NULL OR OLD.frozen_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('phc.freezing_boq_revision', 'on', TRUE);

  UPDATE public.supplier_quotes q
     SET frozen_at = NEW.frozen_at,
         frozen_by = NEW.frozen_by,
         -- A cancelled or superseded quote keeps the status that explains it;
         -- overwriting it with 'frozen' would erase why it is not in play.
         status    = CASE WHEN q.status IN ('cancelled', 'superseded')
                          THEN q.status ELSE 'frozen'::public.supplier_quote_status END
   WHERE q.boq_revision_id = NEW.id
     AND q.frozen_at IS NULL;

  PERFORM set_config('phc.freezing_boq_revision', 'off', TRUE);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS boq_revisions_freeze_supplier_quotes ON public.boq_revisions;
CREATE TRIGGER boq_revisions_freeze_supplier_quotes
  AFTER UPDATE OF frozen_at ON public.boq_revisions
  FOR EACH ROW EXECUTE FUNCTION public.propagate_freeze_to_supplier_quotes();

COMMENT ON FUNCTION public.propagate_freeze_to_supplier_quotes IS
  'Stamps frozen_at/frozen_by onto a revision''s supplier quotes when the revision freezes. The only writer of those columns; the guard refuses every other one.';

-- ============ 5. RLS ============
ALTER TABLE public.supplier_quotes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_quote_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supplier quotes readable by cost holders" ON public.supplier_quotes;
CREATE POLICY "Supplier quotes readable by cost holders"
  ON public.supplier_quotes FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid()))
         AND public.can_read_boq_revision(boq_revision_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Supplier quotes creatable by estimation or pipeline" ON public.supplier_quotes;
CREATE POLICY "Supplier quotes creatable by estimation or pipeline"
  ON public.supplier_quotes FOR INSERT TO authenticated
  WITH CHECK (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
              OR public.is_pipeline_operator((SELECT auth.uid())));

DROP POLICY IF EXISTS "Supplier quotes updatable by estimation or pipeline" ON public.supplier_quotes;
CREATE POLICY "Supplier quotes updatable by estimation or pipeline"
  ON public.supplier_quotes FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
         OR public.is_pipeline_operator((SELECT auth.uid())))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
              OR public.is_pipeline_operator((SELECT auth.uid())));

DROP POLICY IF EXISTS "Supplier lines readable by cost holders" ON public.supplier_quote_lines;
CREATE POLICY "Supplier lines readable by cost holders"
  ON public.supplier_quote_lines FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid()))
         AND EXISTS (SELECT 1 FROM public.supplier_quotes q
                      WHERE q.id = supplier_quote_lines.supplier_quote_id
                        AND public.can_read_boq_revision(q.boq_revision_id, (SELECT auth.uid()))));

-- Estimation prices and selects. The pipeline may raise an RFQ but does not put
-- numbers on it.
DROP POLICY IF EXISTS "Supplier lines writable by estimation" ON public.supplier_quote_lines;
CREATE POLICY "Supplier lines writable by estimation"
  ON public.supplier_quote_lines FOR INSERT TO authenticated
  WITH CHECK (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role));

DROP POLICY IF EXISTS "Supplier lines updatable by estimation" ON public.supplier_quote_lines;
CREATE POLICY "Supplier lines updatable by estimation"
  ON public.supplier_quote_lines FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role));

-- No DELETE policy on either table.

-- ============ 6. Column privileges ============
REVOKE ALL ON public.supplier_quote_lines FROM authenticated, anon;
GRANT SELECT (
  id, supplier_quote_id, boq_line_id, quantity, is_selected, selected_by,
  selected_at, selection_note, lead_time_days, alternate_spec, created_at
) ON public.supplier_quote_lines TO authenticated;
GRANT INSERT, UPDATE ON public.supplier_quote_lines TO authenticated;
-- unit_cost and line_cost are deliberately absent.

REVOKE ALL ON public.supplier_quotes FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.supplier_quotes TO authenticated;

-- ============ 7. Views ============
CREATE OR REPLACE VIEW public.supplier_quote_costs AS
  SELECT l.id, l.supplier_quote_id, l.boq_line_id, q.boq_revision_id, q.vendor_id,
         v.name AS vendor_name, q.status, q.currency, q.is_current, q.revision_number,
         l.unit_cost, l.quantity, l.line_cost,
         l.is_selected, l.selected_by, l.selected_at, l.selection_note,
         l.lead_time_days, l.alternate_spec
    FROM public.supplier_quote_lines l
    JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
    JOIN public.vendors v         ON v.id = q.vendor_id
   WHERE public.can_read_commercial_cost((SELECT auth.uid()))
     AND public.can_read_boq_revision(q.boq_revision_id, (SELECT auth.uid()));

COMMENT ON VIEW public.supplier_quote_costs IS
  'Supplier line costs with the vendor name, for estimation, finance and MD/GM/CEO only. All figures EXCLUDE VAT. Runs as owner because the cost columns are revoked from authenticated, so it enforces both the row rule and the role rule itself.';
GRANT SELECT ON public.supplier_quote_costs TO authenticated;

-- What estimation actually looks at: every live supplier against one BOQ line,
-- with the spread and which one was taken.
CREATE OR REPLACE VIEW public.supplier_comparison AS
  SELECT l.boq_line_id,
         bl.revision_id,
         bl.sign_type,
         count(*)                                        AS quotes_received,
         min(l.unit_cost)                                AS lowest_unit_cost,
         max(l.unit_cost)                                AS highest_unit_cost,
         round(avg(l.unit_cost), 2)                      AS average_unit_cost,
         (max(l.unit_cost) - min(l.unit_cost))           AS spread,
         max(l.unit_cost) FILTER (WHERE l.is_selected)   AS selected_unit_cost,
         max(v.name)      FILTER (WHERE l.is_selected)   AS selected_vendor,
         bool_or(l.is_selected)                          AS has_selection
    FROM public.supplier_quote_lines l
    JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id AND q.is_current
    JOIN public.vendors v         ON v.id = q.vendor_id
    JOIN public.boq_lines bl      ON bl.id = l.boq_line_id
   WHERE public.can_read_commercial_cost((SELECT auth.uid()))
     AND public.can_read_boq_revision(q.boq_revision_id, (SELECT auth.uid()))
   GROUP BY l.boq_line_id, bl.revision_id, bl.sign_type;

COMMENT ON VIEW public.supplier_comparison IS
  'Per BOQ line: how many live quotes, the range, and which supplier was taken. Superseded quotes are excluded — comparing against a price the supplier has replaced is how the wrong number gets chosen. Same two gates as supplier_quote_costs.';
GRANT SELECT ON public.supplier_comparison TO authenticated;
