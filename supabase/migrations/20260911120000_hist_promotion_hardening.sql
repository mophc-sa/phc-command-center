-- =========================================================
-- PROMOTION HARDENING — making an archived sale into a working deal.
--
-- Phase 7D built the queue, the mandatory mappings, the one-at-a-time rule and
-- the provenance. It is kept. What it did not do is make the resulting record
-- usable, and this migration fixes exactly that, in four places.
--
-- 1. STAGE — the bug that would have made the whole exercise pointless.
--
--    promote_historical_row() inserted an opportunity with project_name,
--    owner_id, company_id, currency, created_by and extra_data. It set no
--    sales_stage, and the column has no default, so every promoted deal landed
--    NULL. Every Phase 10 view filters `WHERE sales_stage NOT IN ('won','lost')`
--    and NULL fails that predicate, so the deal would have been invisible in
--    pipeline_by_stage, sales_forecast, loss_analysis and team_performance —
--    while conversion_summary, which has no such filter, would still have
--    counted it in total_deals. The arithmetic would not have reconciled:
--    total_deals <> won + lost + open_deals.
--
--    This is not a hypothetical. crm-actions.ts:218 already records it
--    happening: "Found live 2026-08-05: 2 of 4 production opportunities were
--    orphaned this way."
--
--    D6 is preserved rather than excepted. Every promoted opportunity is
--    created at rfq_received and then TRANSITIONED, with a
--    stage_transition_history row for each hop and an audit_log entry, exactly
--    as applySalesStage does it for a deal a human moves by hand. There is no
--    hidden historical exception and no direct creation at jih.
--
-- 2. VALUE — one resolver, not a value copied around to satisfy each reader.
--
--    The archive amount is a submitted quotation figure excluding VAT, so it
--    is written to quotation_value and to nothing else. opportunity_value()
--    already resolves contract -> quotation -> estimated_max, and the frontend
--    opportunityValue() uses the same precedence.
--
--    The one reader that disagreed was computeJihPipelineTotal(), which summed
--    estimated_value_max alone and drives My Workspace — the salesperson's own
--    screen. That is fixed in the frontend to call the shared resolver, NOT by
--    also writing the number into estimated_value_max here. Duplicating a
--    figure into a second column to satisfy one caller is how two dashboards
--    start reporting different totals for the same pipeline.
--
-- 3. REVERSIBILITY — the existing pattern, made to actually work.
--
--    Opportunities have no archived_at column on purpose: 20260711160000
--    skipped them because "it already has an 'archived' stage value", and
--    record-lifecycle.ts states the rule outright — opportunities are never
--    hard-deleted, they use stage='archived'. So voiding reuses that and
--    invents neither a column nor a sales stage.
--
--    Two things had to change for it to bite. analytics_scope_opportunities
--    did not exclude archived rows, so all six Phase 10 views would have kept
--    counting a voided deal; it does now, in one place rather than six. And
--    resolveCanonicalStage() checked sales_stage BEFORE the archived branch,
--    so an archived row with a live sales_stage still resolved to that stage —
--    the archived branch was unreachable for exactly the rows that need it.
--    That is fixed in the frontend alongside this.
--
--    A void keeps everything: the request row, its provenance, its audit
--    trail, and the link to the opportunity it archived. It does not touch the
--    archive — nothing here ever writes to historical_sales_rows. And it frees
--    the archive row for a corrected promotion later, which is why 'voided'
--    had to join the two statuses the open-request index already ignores.
--
-- 4. THE HISTORICAL QUOTATION — evidence, not a modern quotation wearing a hat.
--
--    A 2026 record IS a quotation: it has a number (the sales code), a value,
--    a status and an issue date. Recording it as one is what makes "submitted
--    quotations" countable and lets a rep carry on from where the file
--    actually is.
--
--    It goes into `quotations`, never into `quotation_revisions`. Phase 7C
--    revisions are gated on a frozen BOQ revision, a gm_approved internal
--    price and an exact price match; the archive has no BOQ, no estimation and
--    no approval, and manufacturing those to get through the gate would be
--    forging the commercial record. So the historical quotation is flagged
--    is_historical, carries its archive row id, and is immutable by trigger.
--
--    Continuing the work is still possible and is the point: a rep raises a
--    proper Phase 7C quotation_revision against that quotation, which goes
--    through the modern gates like any other. The historical row stays as the
--    evidence of what was sent in 2026; the revision is what happens next.
--
-- NOTHING IS PROMOTED BY THIS MIGRATION. It changes the mechanism only.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Historical quotations ============
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS is_historical BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS historical_row_id UUID REFERENCES public.historical_sales_rows(id) ON DELETE RESTRICT,
  -- The archive's own code, verbatim and NOT unique. quote_number is a
  -- canonical identity this system assigns; this is what the spreadsheet said.
  -- They differ whenever one legacy code covers several pursuits — see
  -- historical_quote_number() below.
  ADD COLUMN IF NOT EXISTS legacy_sales_code TEXT;

CREATE INDEX IF NOT EXISTS quotations_legacy_sales_code
  ON public.quotations (legacy_sales_code) WHERE legacy_sales_code IS NOT NULL;

COMMENT ON COLUMN public.quotations.legacy_sales_code IS
  'The sales code exactly as the archive holds it. Deliberately not unique: 33 codes are shared by 79 archive rows, most often one project quoted to several competing contractors. Search and reconciliation use this; identity uses quote_number.';

-- One historical quotation per archive row PER VERSION — not one ever.
--
-- "One ever" was the first attempt and it was wrong in a way only the void
-- path revealed: voiding keeps the original quotation as evidence rather than
-- deleting it, so a corrected promotion of the same archive row needs to write
-- a second one. A unique index on historical_row_id alone made the correction
-- impossible, which would have left "reversible" true only until somebody
-- tried to use it.
--
-- The guarantee that actually matters — at most one LIVE promotion per archive
-- row — is enforced where it belongs, by historical_promotion_one_open on the
-- request table.
-- At most one LIVE historical quotation per archive row. Not "one ever": a
-- void keeps the original as evidence and a corrected promotion writes a new
-- one, so the index has to let the voided row stay while the replacement
-- appears. Voiding sets status='expired', and a historical quotation's status
-- cannot change by any other route (the immutability trigger sees to that), so
-- excluding expired rows here is a safe expression of exactly that intent.
CREATE UNIQUE INDEX IF NOT EXISTS quotations_historical_row_live_unique
  ON public.quotations (historical_row_id)
  WHERE historical_row_id IS NOT NULL AND status <> 'expired';
DROP INDEX IF EXISTS public.quotations_historical_row_unique;
DROP INDEX IF EXISTS public.quotations_historical_row_version_unique;

CREATE INDEX IF NOT EXISTS quotations_is_historical
  ON public.quotations (is_historical) WHERE is_historical;

-- A historical flag is a statement about where the row came from, so it may
-- only be set by the promotion function, and only together with a source row.
ALTER TABLE public.quotations DROP CONSTRAINT IF EXISTS quotations_historical_needs_source;
ALTER TABLE public.quotations
  ADD CONSTRAINT quotations_historical_needs_source
  CHECK (is_historical = (historical_row_id IS NOT NULL));

COMMENT ON COLUMN public.quotations.is_historical IS
  'TRUE for a quotation imported from the read-only sales archive as evidence of what was actually sent. It did NOT pass Phase 7C governance — no BOQ revision, no gm_approved internal price, no approval chain — and must never be presented as though it had. Immutable by trigger; a rep continues the deal by raising a modern quotation_revision against it.';

CREATE OR REPLACE FUNCTION public.historical_quotation_is_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_historical THEN
      RAISE EXCEPTION 'A historical quotation is archive evidence and cannot be deleted — void the promotion instead. | عرض السعر التاريخي دليل أرشيفي ولا يُحذف.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  -- Nothing may turn an ordinary quotation into a historical one, or the
  -- reverse: that would let a modern draft acquire archive provenance it never
  -- had, or a historical record shed the flag that says it skipped the gates.
  IF NEW.is_historical IS DISTINCT FROM OLD.is_historical
     OR NEW.historical_row_id IS DISTINCT FROM OLD.historical_row_id THEN
    RAISE EXCEPTION 'The historical origin of a quotation cannot be changed. | لا يُغيَّر مصدر عرض السعر.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT OLD.is_historical THEN
    RETURN NEW;
  END IF;

  -- The one permitted edit: the void path archiving it. Everything that
  -- describes what was sent in 2026 is frozen.
  IF coalesce(current_setting('phc.promoting_historical', true), '') <> 'on'
     AND (NEW.quote_number IS DISTINCT FROM OLD.quote_number
       OR NEW.value        IS DISTINCT FROM OLD.value
       OR NEW.currency     IS DISTINCT FROM OLD.currency
       OR NEW.status       IS DISTINCT FROM OLD.status
       OR NEW.issued_date  IS DISTINCT FROM OLD.issued_date
       OR NEW.version      IS DISTINCT FROM OLD.version
       OR NEW.legacy_sales_code IS DISTINCT FROM OLD.legacy_sales_code
     OR NEW.related_opportunity_id IS DISTINCT FROM OLD.related_opportunity_id) THEN
    RAISE EXCEPTION 'A historical quotation records what was sent and cannot be edited — raise a new quotation revision to change the commercial terms. | عرض السعر التاريخي لا يُعدَّل.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS quotations_historical_immutable ON public.quotations;
CREATE TRIGGER quotations_historical_immutable
  BEFORE UPDATE OR DELETE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.historical_quotation_is_immutable();

-- ============ 1b. Collision classification, and canonical quote identity ============
--
-- Two problems, one cause: the archive reuses a sales code for things that are
-- not the same deal.
--
-- WHAT A SHARED CODE ACTUALLY MEANS
-- Three different situations look identical from the code alone, and guessing
-- between them is how unrelated jobs get merged:
--
--   one project, several competing main contractors — the standard signage
--     pattern, and genuinely separate pursuits (FA26034 quoted to five
--     contractors on one KAFD package)
--   the same spreadsheet row entered twice (OM26006, identical in client,
--     project, amount, code and submission date)
--   a real revision superseding an earlier quotation
--
-- The first is decidable from evidence: a different client or a different site
-- means a different pursuit. So is the second: every identifying field equal
-- means a repeated row, and the earliest one is the real record. The third is
-- only ever asserted when the code itself carries a revision suffix — never
-- inferred from a shared base, which was the whole trap.
--
-- Anything left over is genuinely ambiguous and is refused. The point of
-- classifying is not to be clever, it is to leave a human only the cases where
-- a human is actually needed.
CREATE OR REPLACE FUNCTION public.historical_collision_class(_row_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _m RECORD; _identical_earlier INT; _identical_later INT; _differing INT; _siblings INT;
BEGIN
  SELECT m.*, r.row_number INTO _m
    FROM public.historical_sales_mapped m
    JOIN public.historical_sales_rows r ON r.id = m.row_id
   WHERE m.row_id = _row_id;
  IF NOT FOUND THEN RETURN 'UNKNOWN'; END IF;

  IF _m.base_code IS NULL OR _m.code_placeholder THEN RETURN 'NO_COLLISION'; END IF;

  SELECT count(*) INTO _siblings
    FROM public.historical_sales_mapped s
   WHERE s.base_code = _m.base_code AND NOT s.code_placeholder AND s.row_id <> _row_id;
  IF _siblings = 0 THEN RETURN 'NO_COLLISION'; END IF;

  -- A revision is asserted only by the code, never by the company it keeps.
  IF _m.revision_no IS NOT NULL THEN RETURN 'TRUE_REVISION'; END IF;

  -- Identical in every identifying field = the same row entered twice. The
  -- earliest archive row is the record; the rest are repeats.
  SELECT count(*) INTO _identical_earlier
    FROM public.historical_sales_mapped s
    JOIN public.historical_sales_rows sr ON sr.id = s.row_id
   WHERE s.row_id <> _row_id
     AND s.sales_code_raw    IS NOT DISTINCT FROM _m.sales_code_raw
     AND lower(btrim(coalesce(s.client_name_raw,'')))  = lower(btrim(coalesce(_m.client_name_raw,'')))
     AND lower(btrim(coalesce(s.project_name_raw,''))) = lower(btrim(coalesce(_m.project_name_raw,'')))
     AND s.amount_excl_vat   IS NOT DISTINCT FROM _m.amount_excl_vat
     AND sr.row_number < _m.row_number;
  IF _identical_earlier > 0 THEN RETURN 'EXACT_DUPLICATE_REJECTED'; END IF;

  -- Every sibling differs in who it went to or what site it covers.
  SELECT count(*) INTO _differing
    FROM public.historical_sales_mapped s
   WHERE s.base_code = _m.base_code AND NOT s.code_placeholder AND s.row_id <> _row_id
     AND (lower(btrim(coalesce(s.client_name_raw,'')))  IS DISTINCT FROM lower(btrim(coalesce(_m.client_name_raw,'')))
       OR lower(btrim(coalesce(s.project_name_raw,''))) IS DISTINCT FROM lower(btrim(coalesce(_m.project_name_raw,''))));

  -- The other side of the duplicate test: siblings identical to this row that
  -- come AFTER it. This row is then the first of a repeated group, which makes
  -- it the record rather than a repeat.
  --
  -- Without this branch the keeper of a duplicate pair fell through to
  -- HUMAN_REVIEW_REQUIRED — the classifier rejected the copy and then could not
  -- say the original was fine, so a fully decidable pair still cost a decision.
  SELECT count(*) INTO _identical_later
    FROM public.historical_sales_mapped s
    JOIN public.historical_sales_rows sr ON sr.id = s.row_id
   WHERE s.row_id <> _row_id
     AND s.base_code = _m.base_code AND NOT s.code_placeholder
     AND s.sales_code_raw    IS NOT DISTINCT FROM _m.sales_code_raw
     AND lower(btrim(coalesce(s.client_name_raw,'')))  = lower(btrim(coalesce(_m.client_name_raw,'')))
     AND lower(btrim(coalesce(s.project_name_raw,''))) = lower(btrim(coalesce(_m.project_name_raw,'')))
     AND s.amount_excl_vat   IS NOT DISTINCT FROM _m.amount_excl_vat
     AND sr.row_number > _m.row_number;

  IF _differing + _identical_later = _siblings THEN
    RETURN CASE WHEN _identical_later > 0
                THEN 'EXACT_DUPLICATE_PRIMARY'      -- the original of a repeated row
                ELSE 'DISTINCT_BUSINESS_PURSUIT' END;
  END IF;

  -- Some sibling matches on both client and project but is not identical —
  -- a different amount or date with no revision marker to explain it.
  RETURN 'HUMAN_REVIEW_REQUIRED';
END; $$;

COMMENT ON FUNCTION public.historical_collision_class IS
  'Why an archive row shares a sales code with another: NO_COLLISION, DISTINCT_BUSINESS_PURSUIT (different client or site — the multi-contractor pattern), EXACT_DUPLICATE_PRIMARY (the first of a repeated row, and the one that counts), EXACT_DUPLICATE_REJECTED (an earlier row is identical in every field), TRUE_REVISION (the code itself carries a revision suffix) or HUMAN_REVIEW_REQUIRED. Promotion accepts the first three and refuses the rest, so a person is asked only where the evidence genuinely runs out.';

-- Canonical quote identity.
--
-- The obvious shortcut — reuse the legacy code and bump `version` — is wrong,
-- and quietly so. version means one thing in this schema: a commercial
-- revision of the same quotation. Writing OM26060 as versions 1, 2 and 3 would
-- state that we revised our price twice, when what actually happened is that
-- we quoted the same CEER package to C&P, MOBCO and MARCO. A reader comparing
-- "versions" would be comparing three different clients.
--
-- So identity is derived from the ARCHIVE rather than from promotion order:
-- a code used once is used as-is, and a code the archive shares is qualified
-- by the row it came from. Two runs produce the same answer, and the sequence
-- promotions happen in cannot change anybody's quote number.
CREATE OR REPLACE FUNCTION public.historical_quote_number(_row_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN c.shared > 1
              THEN m.sales_code_raw || '/' || r.row_number::TEXT
              ELSE m.sales_code_raw END
    FROM public.historical_sales_mapped m
    JOIN public.historical_sales_rows r ON r.id = m.row_id
   CROSS JOIN LATERAL (
     SELECT count(*) AS shared FROM public.historical_sales_mapped s
      WHERE s.sales_code_raw = m.sales_code_raw
   ) c
   WHERE m.row_id = _row_id;
$$;

COMMENT ON FUNCTION public.historical_quote_number IS
  'The canonical quote number for a promoted archive row: the legacy code where the archive uses it once, and legacy-code/row-number where it does not. Deterministic from the archive, so promotion order cannot change it. The untouched legacy value always remains in quotations.legacy_sales_code.';

REVOKE ALL ON FUNCTION public.historical_collision_class(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.historical_quote_number(UUID)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.historical_collision_class(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.historical_quote_number(UUID)    TO authenticated;

-- ============ 2. What a request now has to say ============
ALTER TABLE public.historical_promotion_requests
  ADD COLUMN IF NOT EXISTS promoted_quotation_id UUID REFERENCES public.quotations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS duplicate_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE public.historical_promotion_requests DROP CONSTRAINT IF EXISTS hpr_voided_stamped;
ALTER TABLE public.historical_promotion_requests
  ADD CONSTRAINT hpr_voided_stamped CHECK (
    status <> 'voided'
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason,'')) <> ''));

-- A voided request has released its archive row, so a corrected promotion can
-- be raised. Same reasoning that already excludes rejected and cancelled.
DROP INDEX IF EXISTS public.historical_promotion_one_open;
CREATE UNIQUE INDEX historical_promotion_one_open
  ON public.historical_promotion_requests (row_id)
  WHERE status NOT IN ('rejected', 'cancelled', 'voided');

CREATE UNIQUE INDEX IF NOT EXISTS historical_promotion_one_quotation
  ON public.historical_promotion_requests (promoted_quotation_id)
  WHERE promoted_quotation_id IS NOT NULL;

COMMENT ON COLUMN public.historical_promotion_requests.duplicate_reviewed IS
  'Set by a human when another archive row shares this one''s base sales code. The 2026 set contains three shapes of collision — one project quoted to several contractors (legitimate), an identical repeated spreadsheet row (not), and one code reused for different jobs (unresolved) — and no rule tells them apart, so promotion refuses to guess and asks.';

-- ============ 3. Lifecycle: promoted -> voided ============
CREATE OR REPLACE FUNCTION public.historical_promotion_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _ok BOOLEAN; _uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Promotion requests cannot be deleted — cancel, reject or void instead. | لا تُحذف طلبات الترقية.'
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

  IF OLD.status IN ('promoted','rejected','cancelled','voided')
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND (NEW.company_id       IS DISTINCT FROM OLD.company_id
       OR NEW.owner_user_id    IS DISTINCT FROM OLD.owner_user_id
       OR NEW.project_name     IS DISTINCT FROM OLD.project_name
       OR NEW.amount_excl_vat  IS DISTINCT FROM OLD.amount_excl_vat
       OR NEW.row_id           IS DISTINCT FROM OLD.row_id) THEN
    RAISE EXCEPTION 'A % promotion request is closed and cannot be re-mapped. | الطلب مغلق.', OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Both stamps belong to the functions, never to a hand-written UPDATE.
  IF (NEW.promoted_opportunity_id IS DISTINCT FROM OLD.promoted_opportunity_id
      OR NEW.promoted_quotation_id IS DISTINCT FROM OLD.promoted_quotation_id)
     AND coalesce(current_setting('phc.promoting_historical', true), '') <> 'on' THEN
    RAISE EXCEPTION 'promoted_opportunity_id and promoted_quotation_id are set by promote_historical_row(), not by hand. | تُضبط عبر الدالة فقط.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _ok := (OLD.status, NEW.status) IN (
      ('draft',          'pending_review'),
      ('pending_review', 'draft'),
      ('pending_review', 'approved'),
      ('pending_review', 'rejected'),
      ('approved',       'promoted'),
      ('approved',       'rejected'),
      ('draft',          'cancelled'),
      ('pending_review', 'cancelled'),
      ('approved',       'cancelled'),
      ('promoted',       'voided')          -- the reversal, and the only way out of promoted
    );
    IF NOT _ok THEN
      RAISE EXCEPTION 'Invalid promotion transition % -> %. | انتقال غير مسموح.', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;

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

    IF NEW.status = 'voided' THEN
      IF coalesce(current_setting('phc.promoting_historical', true), '') <> 'on' THEN
        RAISE EXCEPTION 'A promotion is voided through void_historical_promotion(), which also archives the opportunity. | استخدم دالة الإلغاء.'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT public.can_approve_historical_promotion(_uid) THEN
        RAISE EXCEPTION 'Only sales leadership may void a historical promotion. | الإلغاء يقتصر على قيادة المبيعات.'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.voided_by := coalesce(NEW.voided_by, _uid);
      NEW.voided_at := coalesce(NEW.voided_at, now());
    END IF;

    IF NEW.status = 'pending_review' THEN
      NEW.requested_at := coalesce(NEW.requested_at, now());
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

-- ============ 4. Promotion ============
CREATE OR REPLACE FUNCTION public.promote_historical_row(_request_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _r RECORD; _m RECORD; _sm RECORD;
  _opp UUID; _quote UUID; _uid UUID := auth.uid();
  _flow public.flow_type; _provenance JSONB; _collision TEXT; _quote_number TEXT;
BEGIN
  IF NOT public.can_approve_historical_promotion(_uid) THEN
    RAISE EXCEPTION 'Only sales leadership may promote a historical record. | الترقية تقتصر على قيادة المبيعات.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO _r FROM public.historical_promotion_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such promotion request.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Idempotent: a retried call returns what already exists rather than
  -- creating a second opportunity for the same archive row.
  IF _r.status = 'promoted' THEN
    RETURN _r.promoted_opportunity_id;
  END IF;

  IF _r.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved request can be promoted (this one is %). | يجب اعتماد الطلب أولاً.', _r.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO _m FROM public.historical_sales_mapped WHERE row_id = _r.row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The archive row has no mapping — run remap_historical_sales() first. | لا توجد بيانات مُشتقّة لهذا السجل.'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ---- the gates, all of them refusals rather than repairs ----

  IF _r.owner_user_id IS NULL OR NOT public.is_active_user(_r.owner_user_id) THEN
    RAISE EXCEPTION 'A promoted deal needs an active owner — an ownerless opportunity is invisible under RLS and nobody would ever work it. | يجب تعيين مالك نشِط.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _r.company_id IS NULL THEN
    RAISE EXCEPTION 'A promoted deal needs a mapped company — none is created here. | يجب ربط شركة قائمة.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _m.code_placeholder THEN
    RAISE EXCEPTION 'Sales code "%" is a bare owner prefix used as a placeholder, not a quotation number — 48 archive rows share five such values and promoting them would merge unrelated jobs. | رمز مبدئي غير صالح.', _m.sales_code_raw
      USING ERRCODE = 'check_violation';
  END IF;
  IF _m.code_unparsed OR _m.sales_code_raw IS NULL THEN
    RAISE EXCEPTION 'The archive row has no usable sales code, so the quotation would have no number. | لا يوجد رمز مبيعات صالح.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _m.route IS NULL THEN
    RAISE EXCEPTION 'The archive row has no determinate route (JIH or TENDER), which decides flow_type. | مسار السجل غير محدد.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _m.date_submitted IS NULL THEN
    RAISE EXCEPTION 'The archive shows no submission date, so there is no evidence a quotation was ever issued — this batch promotes submitted work only. | لا يوجد تاريخ تقديم.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO _sm FROM public.historical_sales_status_map WHERE source_status = upper(btrim(_m.status_raw));
  IF NOT FOUND OR NOT _sm.promotable_active THEN
    RAISE EXCEPTION 'Archive status "%" is not promotable in this activation batch — only SUBMITTED, WAITING FOR CLIENT and FOR ACTION are. | الحالة غير مؤهلة للترقية.', _m.status_raw
      USING ERRCODE = 'check_violation';
  END IF;
  IF _sm.canonical_sales_stage IS NULL OR _sm.canonical_handoff_status IS NULL THEN
    RAISE EXCEPTION 'No stage rule is recorded for archive status "%". | لا توجد قاعدة مرحلة لهذه الحالة.', _m.status_raw
      USING ERRCODE = 'check_violation';
  END IF;

  IF _r.amount_excl_vat IS NULL THEN
    RAISE EXCEPTION 'A promoted deal carries the quoted figure; an absent amount cannot become a zero-value pipeline entry. | لا يمكن ترقية سجل بلا قيمة.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Collision, decided from evidence rather than referred to a person by
  -- default. Only the classes the archive cannot settle need a human, and
  -- duplicate_reviewed is the override for exactly those.
  _collision := public.historical_collision_class(_r.row_id);

  IF _collision = 'EXACT_DUPLICATE_REJECTED' THEN
    RAISE EXCEPTION 'An earlier archive row is identical in code, client, project and amount — this is the same quotation entered twice, and only the first is promotable. Both archive rows are kept. | صف مكرر حرفيًا.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _collision = 'TRUE_REVISION' AND NOT _r.duplicate_reviewed THEN
    RAISE EXCEPTION 'Sales code % carries a revision suffix, so it supersedes an earlier quotation. This batch imports submitted work as standalone quotations and does not rebuild revision chains — confirm explicitly before promoting. | الرمز يحمل رقم مراجعة.', _m.sales_code_raw
      USING ERRCODE = 'check_violation';
  END IF;

  IF _collision = 'HUMAN_REVIEW_REQUIRED' AND NOT _r.duplicate_reviewed THEN
    RAISE EXCEPTION 'Base code % is shared with a row matching on client and project but differing elsewhere, with no revision marker to explain it — the archive cannot settle this one. | تعارض يحتاج قرارًا بشريًا.', _m.base_code
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---- provenance ----
  -- Identifying context only. The full 23-column source record stays in
  -- historical_sales_rows one join away; copying it here would create a second
  -- copy that can drift from the immutable one.
  _provenance := jsonb_build_object(
    'source',               'historical_promotion',
    'historical_row_id',    _r.row_id,
    'historical_batch_id',  _m.batch_id,
    'promotion_request_id', _r.id,
    'source_route',         upper(_m.route),
    'source_sales_code',    _m.sales_code_raw,
    'source_base_code',     _m.base_code,
    'source_status',        _m.status_raw,
    'source_follow_up',     _m.follow_up_raw,
    'source_client_name',   _m.client_name_raw,
    'source_project_name',  _m.project_name_raw,
    'source_owner_prefix',  _m.owner_prefix,
    'source_owner_label',   _m.owner_label,
    'source_date_received', _m.date_received,
    'source_date_submitted',_m.date_submitted,
    'source_amount_raw',    _m.amount_raw,
    'collision_class',      _collision,
    'promoted_at',          now()
  );

  -- Tender-origin rows are contractor-specific pursuits, not tender entities:
  -- 23 of them span only 15 distinct projects, so creating one tender each
  -- would report half again as many tenders as exist. The origin is recorded
  -- on the opportunity and a deterministic tender-parent reconciliation can
  -- link them later.
  _flow := CASE WHEN _m.route = 'tender' THEN 'tender_converted' ELSE 'direct_rfq' END::public.flow_type;

  -- ---- create at rfq_received (D6), then transition ----
  INSERT INTO public.opportunities (
    project_name, owner_id, company_id, currency, created_by,
    sales_stage, stage, flow_type,
    client, main_contractor, location,
    quotation_value,
    commercial_handoff_status,
    last_activity_at,
    extra_data
  ) VALUES (
    _r.project_name, _r.owner_user_id, _r.company_id, _r.currency, _uid,
    'rfq_received', 'quotation', _flow,
    _m.client_name_raw, _m.client_name_raw, _m.project_location,
    _r.amount_excl_vat,
    'with_sales',
    _m.date_submitted::timestamptz,
    _provenance
  ) RETURNING id INTO _opp;

  INSERT INTO public.stage_transition_history (record_type, record_id, from_stage, to_stage, actor_id, notes)
  VALUES ('opportunity', _opp, NULL, 'rfq_received', _uid,
          format('Historical promotion of archive row %s (%s). Created at rfq_received per D6.', _m.sales_code_raw, _r.row_id));

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after_value)
  VALUES (_uid, 'historical_promotion.created', 'opportunity', _opp, _provenance);

  -- The explicit, audited hop to where the file actually is.
  UPDATE public.opportunities
     SET sales_stage               = _sm.canonical_sales_stage::public.sales_stage,
         commercial_handoff_status = _sm.canonical_handoff_status,
         commercial_handoff_at     = _m.date_submitted::timestamptz,
         commercial_handoff_by     = _uid
   WHERE id = _opp;

  INSERT INTO public.stage_transition_history (record_type, record_id, from_stage, to_stage, actor_id, notes)
  VALUES ('opportunity', _opp, 'rfq_received', _sm.canonical_sales_stage, _uid,
          format('Archive status %s, submitted %s. Handoff set to %s.',
                 _m.status_raw, _m.date_submitted, _sm.canonical_handoff_status));

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before_value, after_value)
  VALUES (_uid, 'sales_stage.changed', 'opportunity', _opp,
          jsonb_build_object('from','rfq_received'),
          jsonb_build_object('to', _sm.canonical_sales_stage, 'handoff', _sm.canonical_handoff_status,
                             'source','historical_promotion'));

  -- ---- the historical quotation ----
  -- version is ALWAYS 1. Nothing imported from the archive is a revision of
  -- anything else in the system, and version is the column that says otherwise.
  -- Where one legacy code covers several pursuits, they are told apart by
  -- distinct quote_numbers — never by version, which would render three
  -- contractors as three price revisions of one deal.
  _quote_number := public.historical_quote_number(_r.row_id);

  INSERT INTO public.quotations (
    quote_number, version, related_opportunity_id, owner_id, value, currency,
    status, issued_date, created_by, notes, is_historical, historical_row_id,
    legacy_sales_code
  ) VALUES (
    _quote_number, 1, _opp, _r.owner_user_id, _r.amount_excl_vat, _r.currency,
    coalesce(_m.status_canonical, 'submitted')::public.quotation_status,
    _m.date_submitted, _uid,
    format('Imported from the historical sales archive (row %s, batch %s). Archive status: %s. This quotation did NOT pass Phase 7C governance — no BOQ revision, no internal price approval, no approval chain.',
           _m.sales_code_raw, _m.batch_id, _m.status_raw),
    TRUE, _r.row_id, _m.sales_code_raw
  ) RETURNING id INTO _quote;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after_value)
  VALUES (_uid, 'historical_promotion.quotation_created', 'quotation', _quote, _provenance);

  PERFORM set_config('phc.promoting_historical', 'on', TRUE);
  UPDATE public.historical_promotion_requests
     SET status = 'promoted',
         promoted_opportunity_id = _opp,
         promoted_quotation_id   = _quote,
         promoted_by = _uid,
         promoted_at = now()
   WHERE id = _request_id;
  PERFORM set_config('phc.promoting_historical', 'off', TRUE);

  RETURN _opp;
END; $$;

COMMENT ON FUNCTION public.promote_historical_row IS
  'Creates exactly one opportunity and one historical quotation from an approved request. Creates no company, user or project, and writes nothing to the archive. Opens at rfq_received and transitions explicitly (D6), logging both hops to stage_transition_history and audit_log. Idempotent: promoting twice returns the first opportunity.';

REVOKE ALL ON FUNCTION public.promote_historical_row(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_historical_row(UUID) TO authenticated;

-- ============ 5. Void ============
CREATE OR REPLACE FUNCTION public.void_historical_promotion(_request_id UUID, _reason TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _r RECORD; _uid UUID := auth.uid(); _from TEXT;
BEGIN
  IF NOT public.can_approve_historical_promotion(_uid) THEN
    RAISE EXCEPTION 'Only sales leadership may void a historical promotion. | الإلغاء يقتصر على قيادة المبيعات.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(coalesce(_reason,'')) = '' THEN
    RAISE EXCEPTION 'Voiding a promotion needs a reason. | يجب توضيح سبب الإلغاء.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO _r FROM public.historical_promotion_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such promotion request.' USING ERRCODE = 'no_data_found';
  END IF;

  IF _r.status = 'voided' THEN
    RETURN _r.promoted_opportunity_id;      -- idempotent, like promotion
  END IF;
  IF _r.status <> 'promoted' THEN
    RAISE EXCEPTION 'Only a promoted request can be voided (this one is %). | لا يمكن إلغاء طلب غير مُرقّى.', _r.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT sales_stage::TEXT INTO _from FROM public.opportunities WHERE id = _r.promoted_opportunity_id;

  PERFORM set_config('phc.promoting_historical', 'on', TRUE);

  -- stage='archived' is the existing soft-disable for an opportunity
  -- (20260711160000; record-lifecycle.ts). Nothing is deleted, sales_stage is
  -- left as it was so the history still reads correctly, and
  -- analytics_scope_opportunities below is what takes it out of the numbers.
  UPDATE public.opportunities
     SET stage = 'archived', action_required = FALSE
   WHERE id = _r.promoted_opportunity_id;

  -- The quotation stops counting as a live submitted quotation but is kept,
  -- and hands its canonical number back so a corrected promotion can take it.
  -- quote_number is an identity this system assigns, not source data — the
  -- archive value stays untouched in legacy_sales_code, which is what any
  -- reconciliation reads. Bumping `version` instead would have been the easy
  -- move and would have recorded a correction as a price revision.
  UPDATE public.quotations
     SET status = 'expired',
         quote_number = quote_number || '#VOID-' || left(_r.id::TEXT, 8)
   WHERE id = _r.promoted_quotation_id;

  UPDATE public.historical_promotion_requests
     SET status = 'voided', voided_by = _uid, voided_at = now(), void_reason = _reason
   WHERE id = _request_id;

  PERFORM set_config('phc.promoting_historical', 'off', TRUE);

  INSERT INTO public.stage_transition_history (record_type, record_id, from_stage, to_stage, actor_id, notes)
  VALUES ('opportunity', _r.promoted_opportunity_id, _from, 'archived', _uid,
          format('Historical promotion voided: %s', _reason));

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before_value, after_value)
  VALUES (_uid, 'historical_promotion.voided', 'opportunity', _r.promoted_opportunity_id,
          jsonb_build_object('sales_stage', _from, 'stage', 'quotation'),
          jsonb_build_object('stage','archived','reason',_reason,
                             'promotion_request_id', _r.id,
                             'historical_row_id', _r.row_id));

  RETURN _r.promoted_opportunity_id;
END; $$;

COMMENT ON FUNCTION public.void_historical_promotion IS
  'Reverses a promotion without deleting anything: archives the opportunity via the existing stage=archived pattern, expires the historical quotation, and moves the request to voided with a reason. The archive is untouched and the row becomes promotable again, so a corrected promotion can follow. Idempotent.';

REVOKE ALL ON FUNCTION public.void_historical_promotion(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_historical_promotion(UUID, TEXT) TO authenticated;

-- ============ 6. Archived deals leave the numbers ============
-- One place, so all six Phase 10 views inherit it rather than six chances to
-- forget. A voided promotion disappears from pipeline, forecast, conversion,
-- loss analysis and team performance together.
CREATE OR REPLACE VIEW public.analytics_scope_opportunities AS
  SELECT o.*
    FROM public.opportunities o
   WHERE o.stage IS DISTINCT FROM 'archived'
     AND (public.can_read_sales_analytics((SELECT auth.uid()))
          OR o.owner_id = (SELECT auth.uid()));

COMMENT ON VIEW public.analytics_scope_opportunities IS
  'The opportunity set the current reader is entitled to aggregate: everything for management and finance, own deals for everyone else. Archived opportunities are excluded here rather than in each view — stage=archived is the record-lifecycle soft-delete for an opportunity (20260711160000), and a voided historical promotion uses it.';
GRANT SELECT ON public.analytics_scope_opportunities TO authenticated;

-- ============ 7. The archive says what became of each row ============
-- Dropped and recreated for the same reason as the search view below:
-- CREATE OR REPLACE VIEW can only append columns, and collision_class belongs
-- beside the promotion state it qualifies.
DROP VIEW IF EXISTS public.historical_sales_promotion_status;
CREATE VIEW public.historical_sales_promotion_status AS
  SELECT m.row_id,
         r.row_number,
         m.sales_code_raw,
         m.client_name_raw,
         m.project_name_raw,
         m.status_raw,
         m.amount_excl_vat,
         COALESCE(req.status::TEXT, 'not_promoted')          AS promotion_status,
         req.id                                              AS promotion_request_id,
         req.promoted_opportunity_id,
         req.promoted_quotation_id,
         req.promoted_at,
         req.voided_at,
         req.void_reason,
         public.historical_collision_class(m.row_id) AS collision_class,
         -- The one question a reader of the archive actually has: is this the
         -- same deal I am looking at in the pipeline, or a separate one?
         (req.status = 'promoted')                           AS is_live_in_crm
    FROM public.historical_sales_mapped m
    JOIN public.historical_sales_rows r ON r.id = m.row_id
    LEFT JOIN LATERAL (
      SELECT p.* FROM public.historical_promotion_requests p
       WHERE p.row_id = m.row_id
       ORDER BY (p.status = 'promoted') DESC, p.created_at DESC
       LIMIT 1
    ) req ON TRUE
   WHERE public.can_read_historical_sales((SELECT auth.uid()));

COMMENT ON VIEW public.historical_sales_promotion_status IS
  'What became of each archive row: not_promoted, in review, promoted (with the opportunity and quotation it became) or voided (with the reason). The archive stays read-only — this reads the promotion queue beside it rather than stamping anything on the row. Without it, a promoted deal appears in the archive and in the pipeline with nothing saying they are the same deal.';
GRANT SELECT ON public.historical_sales_promotion_status TO authenticated;

-- The searchable archive gains the same answer, plus the FOLLOW-UP cell.
-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW can only
-- append columns, and follow_up belongs beside the status it qualifies rather
-- than tacked on the end where nobody reading the row would see it.
DROP VIEW IF EXISTS public.historical_sales_search;
CREATE VIEW public.historical_sales_search AS
  SELECT
    m.row_id,
    m.batch_id,
    m.sales_code_raw          AS sales_code,
    m.base_code,
    m.revision_no,
    m.variant,
    m.owner_prefix,
    m.owner_user_id,
    m.owner_label             AS owner,
    m.client_name_raw         AS client,
    m.company_id,
    m.company_matched,
    m.project_name_raw        AS project,
    m.project_location        AS location,
    m.route,
    m.status_raw              AS status,
    m.status_canonical,
    m.follow_up_raw           AS follow_up,
    m.amount_excl_vat         AS amount,
    m.currency,
    m.date_received,
    m.date_submitted,
    m.contact_name,
    public.historical_raw_get(r.raw, '^EMAIL SUBJECT$') AS email_subject,
    public.historical_raw_get(r.raw, '^UPDATE LOG$')    AS update_log,
    r.row_number,
    COALESCE(req.status::TEXT, 'not_promoted')          AS promotion_status,
    req.promoted_opportunity_id,
    req.promoted_quotation_id,
    public.historical_collision_class(m.row_id)         AS collision_class,
    lower(concat_ws(' ',
      m.sales_code_raw, m.base_code, m.client_name_raw, m.project_name_raw,
      m.project_location, m.owner_label, m.status_raw, m.contact_name
    ))                        AS search_text
  FROM public.historical_sales_mapped m
  JOIN public.historical_sales_rows   r ON r.id = m.row_id
  LEFT JOIN LATERAL (
    SELECT p.* FROM public.historical_promotion_requests p
     WHERE p.row_id = m.row_id
     ORDER BY (p.status = 'promoted') DESC, p.created_at DESC
     LIMIT 1
  ) req ON TRUE
 WHERE public.can_read_historical_sales((SELECT auth.uid()));

GRANT SELECT ON public.historical_sales_search TO authenticated;
