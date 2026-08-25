-- =========================================================
-- PHASE 7D — promoting an archived sale into the live CRM.
--
-- WHAT EXISTS
-- -----------
-- 679 quotation records from 2022-2026 sit in a read-only staging layer:
-- historical_sales_rows (the raw jsonb, immutable by trigger),
-- historical_sales_mapped (the parsed projection) and three lookup tables.
-- Every one of those tables has exactly one policy, a SELECT. There is no
-- write path from the application, and this phase does not add one.
--
-- Today 0 of 679 rows are promotable: nine of ten owner prefixes have no user
-- account, and 373 client names matched no company. Those are mapping
-- decisions nobody has made yet, which is precisely why promotion needs a
-- queue rather than a button.
--
-- THE ARCHIVE IS NEVER TOUCHED
-- ----------------------------
-- Promotion creates an opportunity and records the link ON THE REQUEST. It
-- does not write to historical_sales_rows or historical_sales_mapped — not a
-- status flag, not a "promoted" boolean, nothing. The archive is what the
-- spreadsheet said in 2022 and it stays that way; whether we later made a CRM
-- record out of it is a fact about us, not about the archive.
--
-- MAPPINGS ARE MANDATORY, NOT SUGGESTED
-- -------------------------------------
-- A request cannot leave draft without a real company, a real user as owner, a
-- project name and a canonical status. Nothing is auto-created: no fake users,
-- no companies invented from a client string, no projects conjured to satisfy
-- a foreign key. If the mapping does not exist, the request waits — which is
-- the honest outcome, because the alternative is 373 companies named after
-- whatever someone typed into a spreadsheet three years ago.
--
-- An absent amount is allowed but must be explained: 92 rows have no figure,
-- and coercing those to zero would quietly understate the pipeline by exactly
-- the amount it hides.
--
-- ONE AT A TIME, BY CONSTRUCTION
-- ------------------------------
-- "No bulk conversion" is enforced by a statement-level trigger that counts
-- actual transitions into approved/promoted and refuses more than one per
-- statement. A comment asking people not to bulk-promote would survive exactly
-- until the first deadline. Editing many drafts in one statement is still
-- fine — only the act that creates CRM data is serialised.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.historical_promotion_status AS ENUM (
    'draft', 'pending_review', 'approved', 'rejected', 'promoted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 1. Who may approve a promotion ============
-- Promotion creates live pipeline data with an owner and a company, so it
-- belongs to sales leadership. Deliberately NOT is_commercial_manager (which
-- reaches wider than intended), NOT is_platform_admin (system_admin is an
-- operator, not a commercial decision-maker), and NOT can_view_all_sales_data
-- (viewer reads everything and decides nothing). The GM is included because
-- they already carry final commercial authority, not because promotion needs
-- them.
CREATE OR REPLACE FUNCTION public.can_approve_historical_promotion(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    _user_id IS NOT NULL
    AND public.is_active_user(_user_id)
    AND (
      public.has_role(_user_id, 'sales_manager'::public.app_role)
      OR public.has_role(_user_id, 'bd_manager'::public.app_role)
      OR public.has_role(_user_id, 'general_manager'::public.app_role)
    );
$$;

COMMENT ON FUNCTION public.can_approve_historical_promotion IS
  'Authority to turn an archived sale into a live opportunity: sales_manager, bd_manager or the GM. Returns TRUE or FALSE, never NULL. Excludes viewer and system_admin by construction.';

-- ============ 2. The review queue ============
CREATE TABLE IF NOT EXISTS public.historical_promotion_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id            UUID NOT NULL REFERENCES public.historical_sales_rows(id) ON DELETE RESTRICT,
  status            public.historical_promotion_status NOT NULL DEFAULT 'draft',

  -- ---- the mandatory mappings ----
  -- All four must be present to leave draft. None of them is ever created by
  -- this system on the requester's behalf.
  company_id        UUID REFERENCES public.companies(id) ON DELETE RESTRICT,
  owner_user_id     UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  project_name      TEXT,
  status_canonical  TEXT,

  -- An absent figure is a fact about the source, not a zero.
  amount_excl_vat     NUMERIC(16,2),
  amount_absent_reason TEXT,
  currency          CHAR(3) NOT NULL DEFAULT 'SAR',

  mapping_notes     TEXT,

  requested_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at      TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  decision_notes    TEXT,
  rejection_reason  TEXT,

  -- Filled by promote_historical_row(), never by hand.
  promoted_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  promoted_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  promoted_at       TIMESTAMPTZ,

  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hpr_amount_explained CHECK (
    amount_excl_vat IS NOT NULL OR btrim(coalesce(amount_absent_reason,'')) <> ''
    OR status = 'draft'),
  CONSTRAINT hpr_amount_not_negative CHECK (amount_excl_vat IS NULL OR amount_excl_vat >= 0),
  CONSTRAINT hpr_rejected_has_reason CHECK (status <> 'rejected'
    OR btrim(coalesce(rejection_reason,'')) <> ''),
  CONSTRAINT hpr_reviewed_stamped CHECK (status NOT IN ('approved','rejected')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT hpr_promoted_stamped CHECK (status <> 'promoted'
    OR (promoted_opportunity_id IS NOT NULL AND promoted_by IS NOT NULL AND promoted_at IS NOT NULL))
);

-- One live request per archive row. A rejected or cancelled request may be
-- retried; an open or completed one may not be duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS historical_promotion_one_open
  ON public.historical_promotion_requests (row_id)
  WHERE status NOT IN ('rejected', 'cancelled');

-- An archive row is promoted at most once, ever.
CREATE UNIQUE INDEX IF NOT EXISTS historical_promotion_one_opportunity
  ON public.historical_promotion_requests (promoted_opportunity_id)
  WHERE promoted_opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS historical_promotion_status ON public.historical_promotion_requests (status);
CREATE INDEX IF NOT EXISTS historical_promotion_row    ON public.historical_promotion_requests (row_id);

COMMENT ON TABLE public.historical_promotion_requests IS
  'The review queue between the read-only sales archive and the live CRM. Holds the mappings a human decided; promotion reads them and creates exactly one opportunity. The archive itself is never written to.';

-- ============ 3. Lifecycle and mandatory mappings ============
CREATE OR REPLACE FUNCTION public.historical_promotion_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _ok BOOLEAN; _uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Promotion requests cannot be deleted — cancel or reject instead. | لا تُحذف طلبات الترقية.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by   := coalesce(NEW.created_by, _uid);
    NEW.requested_by := coalesce(NEW.requested_by, _uid);
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'A promotion request starts as draft. | يبدأ الطلب كمسودة.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- A finished request is a record of a decision, not a working document.
  IF OLD.status IN ('promoted','rejected','cancelled')
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND (NEW.company_id       IS DISTINCT FROM OLD.company_id
       OR NEW.owner_user_id    IS DISTINCT FROM OLD.owner_user_id
       OR NEW.project_name     IS DISTINCT FROM OLD.project_name
       OR NEW.amount_excl_vat  IS DISTINCT FROM OLD.amount_excl_vat
       OR NEW.row_id           IS DISTINCT FROM OLD.row_id) THEN
    RAISE EXCEPTION 'A % promotion request is closed and cannot be re-mapped. | الطلب مغلق.', OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The promotion stamp belongs to promote_historical_row().
  IF NEW.promoted_opportunity_id IS DISTINCT FROM OLD.promoted_opportunity_id
     AND coalesce(current_setting('phc.promoting_historical', true), '') <> 'on' THEN
    RAISE EXCEPTION 'promoted_opportunity_id is set by promote_historical_row(), not by hand. | يُضبط عبر الدالة فقط.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _ok := (OLD.status, NEW.status) IN (
      ('draft',          'pending_review'),
      ('pending_review', 'draft'),           -- returned for re-mapping
      ('pending_review', 'approved'),
      ('pending_review', 'rejected'),
      ('approved',       'promoted'),
      ('approved',       'rejected'),
      ('draft',          'cancelled'),
      ('pending_review', 'cancelled'),
      ('approved',       'cancelled')
    );
    IF NOT _ok THEN
      RAISE EXCEPTION 'Invalid promotion transition % -> %. | انتقال غير مسموح.', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;

    -- ---- mandatory mappings, checked on the way out of draft ----
    IF NEW.status = 'pending_review' THEN
      IF NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'A promotion request needs a mapped company — none is created automatically. | يجب ربط شركة قائمة.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.owner_user_id IS NULL THEN
        RAISE EXCEPTION 'A promotion request needs a real user as owner — legacy owner labels are not accounts. | يجب تعيين مالك حقيقي.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF btrim(coalesce(NEW.project_name,'')) = '' THEN
        RAISE EXCEPTION 'A promotion request needs a project name. | يجب إدخال اسم المشروع.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF btrim(coalesce(NEW.status_canonical,'')) = '' THEN
        RAISE EXCEPTION 'A promotion request needs a canonical status — 103 archive statuses are still undecided. | يجب تحديد الحالة.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.amount_excl_vat IS NULL AND btrim(coalesce(NEW.amount_absent_reason,'')) = '' THEN
        RAISE EXCEPTION 'An absent amount must be explained rather than treated as zero. | يجب توضيح غياب القيمة.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.status IN ('approved','rejected') THEN
      IF NOT public.can_approve_historical_promotion(_uid) THEN
        RAISE EXCEPTION 'Only sales leadership may decide a historical promotion. | القرار يقتصر على قيادة المبيعات.'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.reviewed_by := coalesce(NEW.reviewed_by, _uid);
      NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
    END IF;

    IF NEW.status = 'pending_review' THEN
      NEW.requested_at := coalesce(NEW.requested_at, now());
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS historical_promotion_guard ON public.historical_promotion_requests;
CREATE TRIGGER historical_promotion_guard
  BEFORE INSERT OR UPDATE ON public.historical_promotion_requests
  FOR EACH ROW EXECUTE FUNCTION public.historical_promotion_guard();

DROP TRIGGER IF EXISTS historical_promotion_no_delete ON public.historical_promotion_requests;
CREATE TRIGGER historical_promotion_no_delete
  BEFORE DELETE ON public.historical_promotion_requests
  FOR EACH ROW EXECUTE FUNCTION public.historical_promotion_guard();

-- ============ 4. No bulk conversion ============
-- Counts real transitions into approved/promoted within one statement. An
-- UPDATE touching fifty drafts is fine; one that approves two records is not.
CREATE OR REPLACE FUNCTION public.historical_promotion_no_bulk()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE _n INT;
BEGIN
  SELECT count(*) INTO _n
    FROM new_rows a JOIN old_rows b ON b.id = a.id
   WHERE a.status IN ('approved','promoted')
     AND a.status IS DISTINCT FROM b.status;

  IF _n > 1 THEN
    RAISE EXCEPTION 'Historical promotion is one record at a time; this statement decided % of them. | الترقية سجل واحد في كل مرة.', _n
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS historical_promotion_requests_no_bulk ON public.historical_promotion_requests;
CREATE TRIGGER historical_promotion_requests_no_bulk
  AFTER UPDATE ON public.historical_promotion_requests
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.historical_promotion_no_bulk();

COMMENT ON FUNCTION public.historical_promotion_no_bulk IS
  'Refuses a statement that approves or promotes more than one archive record. The one control that makes "no bulk conversion" a property of the database rather than a habit.';

-- ============ 5. The promotion itself ============
-- SECURITY DEFINER because it writes an opportunity, which the requester may
-- not be able to insert directly. It creates exactly one, from mappings a
-- human already committed to, and nothing else: no company, no user, no
-- project, no quotation.
CREATE OR REPLACE FUNCTION public.promote_historical_row(_request_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _r RECORD; _opp UUID; _uid UUID := auth.uid();
BEGIN
  IF NOT public.can_approve_historical_promotion(_uid) THEN
    RAISE EXCEPTION 'Only sales leadership may promote a historical record. | الترقية تقتصر على قيادة المبيعات.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO _r FROM public.historical_promotion_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such promotion request.' USING ERRCODE = 'no_data_found';
  END IF;

  IF _r.status = 'promoted' THEN
    -- Idempotent rather than an error: a retried call returns the opportunity
    -- that already exists instead of creating a second one.
    RETURN _r.promoted_opportunity_id;
  END IF;

  IF _r.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved request can be promoted (this one is %). | يجب اعتماد الطلب أولاً.', _r.status
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.opportunities (project_name, owner_id, company_id, currency, created_by, extra_data)
    VALUES (
      _r.project_name,
      _r.owner_user_id,
      _r.company_id,
      _r.currency,
      _uid,
      -- Provenance from the CRM side, so an opportunity can always be traced
      -- back without the archive having to point forwards.
      jsonb_build_object(
        'source', 'historical_promotion',
        'historical_row_id', _r.row_id,
        'promotion_request_id', _r.id)
    )
    RETURNING id INTO _opp;

  PERFORM set_config('phc.promoting_historical', 'on', TRUE);
  UPDATE public.historical_promotion_requests
     SET status = 'promoted',
         promoted_opportunity_id = _opp,
         promoted_by = _uid,
         promoted_at = now()
   WHERE id = _request_id;
  PERFORM set_config('phc.promoting_historical', 'off', TRUE);

  RETURN _opp;
END; $$;

COMMENT ON FUNCTION public.promote_historical_row IS
  'Creates exactly one opportunity from an approved promotion request. Creates no company, user, project or quotation, and writes nothing to the archive. Idempotent: promoting twice returns the first opportunity.';

REVOKE ALL ON FUNCTION public.promote_historical_row(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_historical_row(UUID) TO authenticated;

-- ============ 6. RLS ============
ALTER TABLE public.historical_promotion_requests ENABLE ROW LEVEL SECURITY;

-- The queue is visible to whoever may read the archive it draws from, so the
-- people doing the mapping can see their own work in progress.
DROP POLICY IF EXISTS "Promotion requests readable with the archive" ON public.historical_promotion_requests;
CREATE POLICY "Promotion requests readable with the archive"
  ON public.historical_promotion_requests FOR SELECT TO authenticated
  USING (public.can_read_historical_sales((SELECT auth.uid())));

DROP POLICY IF EXISTS "Promotion requests creatable by archive readers" ON public.historical_promotion_requests;
CREATE POLICY "Promotion requests creatable by archive readers"
  ON public.historical_promotion_requests FOR INSERT TO authenticated
  WITH CHECK (public.can_read_historical_sales((SELECT auth.uid())));

DROP POLICY IF EXISTS "Promotion requests updatable by archive readers" ON public.historical_promotion_requests;
CREATE POLICY "Promotion requests updatable by archive readers"
  ON public.historical_promotion_requests FOR UPDATE TO authenticated
  USING (public.can_read_historical_sales((SELECT auth.uid())))
  WITH CHECK (public.can_read_historical_sales((SELECT auth.uid())));

-- No DELETE policy. The trigger refuses the service role too.
REVOKE ALL ON public.historical_promotion_requests FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.historical_promotion_requests TO authenticated;

-- ============ 7. The queue, with what is still missing ============
CREATE OR REPLACE VIEW public.historical_promotion_queue AS
  SELECT r.id AS request_id,
         r.row_id,
         r.status,
         m.sales_code_raw,
         m.client_name_raw,
         m.project_name_raw,
         m.owner_prefix,
         m.owner_label,
         m.status_raw,
         m.amount_excl_vat AS archive_amount,
         r.company_id,
         r.owner_user_id,
         r.project_name,
         r.status_canonical,
         r.amount_excl_vat,
         r.promoted_opportunity_id,
         r.requested_at,
         r.reviewed_at,
         r.promoted_at,
         -- What a reviewer still has to supply. Computed here so the UI cannot
         -- disagree with the trigger about what "ready" means.
         ARRAY_REMOVE(ARRAY[
           CASE WHEN r.company_id IS NULL THEN 'company' END,
           CASE WHEN r.owner_user_id IS NULL THEN 'owner' END,
           CASE WHEN btrim(coalesce(r.project_name,'')) = '' THEN 'project_name' END,
           CASE WHEN btrim(coalesce(r.status_canonical,'')) = '' THEN 'status' END,
           CASE WHEN r.amount_excl_vat IS NULL
                 AND btrim(coalesce(r.amount_absent_reason,'')) = '' THEN 'amount' END
         ], NULL) AS missing_mappings
    FROM public.historical_promotion_requests r
    LEFT JOIN public.historical_sales_mapped m ON m.row_id = r.row_id
   WHERE public.can_read_historical_sales((SELECT auth.uid()));

COMMENT ON VIEW public.historical_promotion_queue IS
  'The review queue beside the archive values it came from, with missing_mappings listing exactly what still blocks the request. Same gate as the archive.';
GRANT SELECT ON public.historical_promotion_queue TO authenticated;
