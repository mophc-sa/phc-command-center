-- =============================================================================
-- Pricing loop, PR 4 part 2: the quotation.
-- The BD manager (Marie) issues the quotation from the price finance approved:
-- a new revision whose subtotal is that price, with a snapshot of the selling
-- line totals (the GM's built selling prices, which sum to the price). The
-- snapshot holds selling figures only; no cost column exists on it.
-- Plan Q1 (default): a revision issued from a pricing file is approved by the
-- issue itself. The GM set the price and finance approved it, so a second GM
-- signature on the same number adds nothing. Outside pricing files Phase 7C's
-- GM gate is unchanged. The issue RPC marks the one revision it writes with a
-- transaction-local flag (as pricing.proposing does for Propose, 20261104150000);
-- PostgREST cannot set custom settings, so nothing else can claim it.
-- =============================================================================

-- 1. Which pricing file a revision came from.
ALTER TABLE public.quotation_revisions
  ADD COLUMN IF NOT EXISTS pricing_file_id uuid REFERENCES public.pricing_files(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS quotation_revisions_pricing_file ON public.quotation_revisions (pricing_file_id);
COMMENT ON COLUMN public.quotation_revisions.pricing_file_id IS
  'The pricing file this revision was issued from (PR 4). Set only by pricing_issue_quotation; never changed.';

-- 2. The lines the client receives.
CREATE TABLE IF NOT EXISTS public.quotation_revision_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id  uuid NOT NULL REFERENCES public.quotation_revisions(id) ON DELETE RESTRICT,
  line_number  integer NOT NULL,
  description  text NOT NULL,
  quantity     numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit         text,
  line_total   numeric(16,2) NOT NULL CHECK (line_total >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, line_number)
);
COMMENT ON TABLE public.quotation_revision_lines IS
  'Selling line totals of a quotation revision, copied from the pricing file''s built selling prices when the quotation is issued. They sum to the revision subtotal. Selling figures only; written only by pricing_issue_quotation, never changed.';
ALTER TABLE public.quotation_revision_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Quotation lines readable with the quotation" ON public.quotation_revision_lines;
CREATE POLICY "Quotation lines readable with the quotation" ON public.quotation_revision_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotation_revisions r
                  WHERE r.id = revision_id
                    AND public.can_read_quotation(r.quotation_id, (SELECT auth.uid()))));
DROP POLICY IF EXISTS audit_session_boundary ON public.quotation_revision_lines;
CREATE POLICY audit_session_boundary ON public.quotation_revision_lines AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
REVOKE ALL ON public.quotation_revision_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.quotation_revision_lines TO authenticated;
GRANT ALL ON public.quotation_revision_lines TO service_role;

CREATE OR REPLACE FUNCTION public.quotation_revision_lines_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Quotation lines are a snapshot; issue a new revision instead. | بنود العرض ثابتة؛ أصدر مراجعة جديدة.'
    USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION public.quotation_revision_lines_frozen() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS quotation_revision_lines_frozen ON public.quotation_revision_lines;
CREATE TRIGGER quotation_revision_lines_frozen BEFORE UPDATE OR DELETE ON public.quotation_revision_lines
  FOR EACH ROW EXECUTE FUNCTION public.quotation_revision_lines_frozen();

-- 3. The guard (Phase 7C body, 20260828110000, unchanged apart from the three
-- PR 4 blocks marked below).
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
    -- PR 4: only the issue RPC writes a revision that claims a pricing file.
    IF NEW.pricing_file_id IS NOT NULL
       AND coalesce(current_setting('pricing.issuing', true), '') IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'A quotation from a pricing file is issued from the file. | عرض السعر من ملف التسعير يُصدر من الملف.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
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

  -- PR 4: which file a revision came from is set at issue and never changed.
  IF NEW.pricing_file_id IS DISTINCT FROM OLD.pricing_file_id THEN
    RAISE EXCEPTION 'A quotation''s pricing file cannot change. | لا يتغير ملف التسعير لعرض السعر.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---- the snapshot is immutable once it leaves draft ----
  IF OLD.status <> 'draft' AND (
       NEW.subtotal_excl_vat IS DISTINCT FROM OLD.subtotal_excl_vat
    OR NEW.vat_rate          IS DISTINCT FROM OLD.vat_rate
    OR NEW.currency          IS DISTINCT FROM OLD.currency
    OR NEW.boq_revision_id   IS DISTINCT FROM OLD.boq_revision_id
    OR NEW.internal_price_id IS DISTINCT FROM OLD.internal_price_id
    OR NEW.quotation_id      IS DISTINCT FROM OLD.quotation_id
    OR NEW.revision_number   IS DISTINCT FROM OLD.revision_number
    OR NEW.pricing_file_id   IS DISTINCT FROM OLD.pricing_file_id) THEN
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
    -- PR 4 (plan Q1): a revision issued from a pricing file carries the price the
    -- GM set and finance approved (checked above to the halala), so the issue
    -- RPC approves it; nothing else can, since only it sets this flag.
    IF NEW.status = 'approved' THEN
      IF NOT (public.can_approve_final_price(_uid)
              OR (NEW.pricing_file_id IS NOT NULL
                  AND coalesce(current_setting('pricing.issuing', true), '') = NEW.id::text)) THEN
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

-- 4. Issue.
CREATE OR REPLACE FUNCTION public.pricing_issue_quotation(_file_id uuid, _valid_until date,
  _payment_terms text, _delivery_terms text, _scope_summary text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; p public.internal_prices; o public.opportunities;
        q_id uuid; prev public.quotation_revisions; rev_id uuid := gen_random_uuid(); n int; lines_sum numeric;
        today date := public._pricing_today();
BEGIN
  IF NOT public.can_issue_quotation(u) THEN
    RAISE EXCEPTION 'The BD or sales manager issues the quotation. | يصدر عرضَ السعر مديرُ تطوير الأعمال أو مدير المبيعات.'
      USING ERRCODE = '42501';
  END IF;
  IF _valid_until IS NULL OR _valid_until < today OR _valid_until > today + 180 THEN
    RAISE EXCEPTION 'Validity must be between today and 180 days from now. | الصلاحية بين اليوم و180 يوماً.' USING ERRCODE = '23514';
  END IF;
  -- Lock order: the price, then the file (as pricing_file_move).
  SELECT * INTO p FROM public.internal_prices
   WHERE id = (SELECT internal_price_id FROM public.pricing_files WHERE id = _file_id) FOR UPDATE;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514'; END IF;
  IF f.state <> 'approved' OR f.internal_price_id IS DISTINCT FROM p.id OR p.status IS DISTINCT FROM 'gm_approved' THEN
    RAISE EXCEPTION 'The quotation is issued once the price is approved, once per round. | يصدر العرض بعد اعتماد السعر، مرة في كل جولة.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT sum(pl.built_selling_price) INTO lines_sum
    FROM public.pricing_file_lines pl JOIN public.boq_lines bl ON bl.id = pl.boq_line_id
   WHERE pl.file_id = f.id AND bl.revision_id = f.boq_revision_id AND pl.built_at IS NOT NULL;
  IF lines_sum IS DISTINCT FROM p.proposed_price THEN
    RAISE EXCEPTION 'The lines do not add up to the approved price; ask finance. | البنود لا تساوي السعر المعتمد؛ راجع المالية.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO o FROM public.opportunities WHERE id = f.opportunity_id;

  -- The deal's quotation header from this loop, or a new one.
  SELECT r.quotation_id INTO q_id FROM public.quotation_revisions r
    JOIN public.pricing_files pf ON pf.id = r.pricing_file_id
   WHERE pf.opportunity_id = f.opportunity_id ORDER BY r.created_at DESC LIMIT 1;
  IF q_id IS NULL THEN
    INSERT INTO public.quotations (quote_number, related_opportunity_id, owner_id, value, currency, status, created_by)
    VALUES (coalesce(nullif(btrim(o.project_code), ''), 'Q-' || left(o.id::text, 8)), o.id, o.owner_id,
            p.proposed_price, 'SAR', 'draft', u)
    RETURNING id INTO q_id;
  END IF;

  -- The client's current revision is superseded by the new one.
  SELECT * INTO prev FROM public.quotation_revisions WHERE quotation_id = q_id AND is_current FOR UPDATE;
  SELECT coalesce(max(revision_number), 0) + 1 INTO n FROM public.quotation_revisions WHERE quotation_id = q_id;
  IF prev.id IS NOT NULL THEN
    IF prev.status IN ('approved','submitted') THEN
      UPDATE public.quotation_revisions SET status = 'superseded' WHERE id = prev.id;
    ELSIF prev.status IN ('draft','pending_approval') THEN
      UPDATE public.quotation_revisions SET status = 'withdrawn', withdrawn_reason = 'Replaced by revision ' || n,
             is_current = false WHERE id = prev.id;
    ELSE
      UPDATE public.quotation_revisions SET is_current = false WHERE id = prev.id;
    END IF;
  END IF;

  PERFORM set_config('pricing.issuing', rev_id::text, true);
  INSERT INTO public.quotation_revisions (id, quotation_id, revision_number, supersedes_id, is_current, status,
         boq_revision_id, internal_price_id, pricing_file_id, currency, subtotal_excl_vat,
         valid_until, payment_terms, delivery_terms, scope_summary, created_by)
  VALUES (rev_id, q_id, n, prev.id, true, 'draft', f.boq_revision_id, p.id, f.id, 'SAR', p.proposed_price,
          _valid_until, nullif(btrim(_payment_terms), ''), nullif(btrim(_delivery_terms), ''),
          nullif(btrim(_scope_summary), ''), u);
  INSERT INTO public.quotation_revision_lines (revision_id, line_number, description, quantity, unit, line_total)
  SELECT rev_id, row_number() OVER (ORDER BY bl.line_number NULLS LAST, bl.id),
         coalesce(nullif(btrim(concat_ws(' — ', nullif(btrim(bl.sign_type), ''), nullif(btrim(bl.description), ''))), ''), 'Line'),
         bl.quantity, bl.unit, pl.built_selling_price
    FROM public.pricing_file_lines pl JOIN public.boq_lines bl ON bl.id = pl.boq_line_id
   WHERE pl.file_id = f.id AND bl.revision_id = f.boq_revision_id AND pl.built_at IS NOT NULL;
  UPDATE public.quotation_revisions SET status = 'pending_approval' WHERE id = rev_id;
  UPDATE public.quotation_revisions SET status = 'approved' WHERE id = rev_id;
  PERFORM set_config('pricing.issuing', '', true);
  UPDATE public.quotations SET value = p.proposed_price, version = n, valid_until = _valid_until,
         status = 'approved_for_submission'
   WHERE id = q_id;

  PERFORM public._pricing_file_apply(f, 'quoted', u, 'Rev ' || (n - 1));
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.quotation_issued', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'revision_id', rev_id, 'revision_number', n));
  RETURN rev_id;
END $$;
REVOKE ALL ON FUNCTION public.pricing_issue_quotation(uuid, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_issue_quotation(uuid, date, text, text, text) TO authenticated;

-- 5. Mark sent (Marie sends the PDF herself; this records it).
CREATE OR REPLACE FUNCTION public.pricing_mark_quotation_sent(_revision_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); r public.quotation_revisions;
BEGIN
  IF NOT public.can_issue_quotation(u) THEN
    RAISE EXCEPTION 'The BD or sales manager records the sending. | يسجّل الإرسالَ مديرُ تطوير الأعمال أو مدير المبيعات.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.quotation_revisions WHERE id = _revision_id FOR UPDATE;
  IF NOT FOUND OR r.pricing_file_id IS NULL THEN
    RAISE EXCEPTION 'Unknown quotation revision. | مراجعة العرض غير موجودة.' USING ERRCODE = '23514';
  END IF;
  IF r.status <> 'approved' OR NOT r.is_current THEN
    RAISE EXCEPTION 'Only the current approved revision can be sent. | تُرسل المراجعة الحالية المعتمدة فقط.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.quotation_revisions SET status = 'submitted' WHERE id = r.id RETURNING * INTO r;
  UPDATE public.quotations SET status = 'submitted', issued_date = coalesce(issued_date, public._pricing_today())
   WHERE id = r.quotation_id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'quotation_revision.submitted', 'quotation_revision', r.id,
          jsonb_build_object('revision_number', r.revision_number, 'pricing_file_id', r.pricing_file_id));
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.pricing_mark_quotation_sent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_mark_quotation_sent(uuid) TO authenticated;
