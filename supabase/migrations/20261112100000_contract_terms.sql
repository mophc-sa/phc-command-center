-- =============================================================================
-- Commercial & Finance part 2, B1: the contract's terms and payment schedule
-- (design docs/superpowers/specs/2026-11-12-contract-terms-design.md).
-- The rep records the contract from the client's current quotation (value,
-- lines as the contract quantities), the execution period, the credit period
-- and the payments (template: advance, drawings approval, MIR, WIR; total 100%).
-- Finance reviews: approve (terms frozen) or return with a reason; never the
-- terms' own author. `contracts` is extended (one meaning of "contract"); its
-- existing stage, panel and policies are unchanged. The terms columns and the
-- two child tables change only through the three RPCs below: a transaction-local
-- flag (as pricing.proposing) lets the guards tell an RPC's write from a direct one.
-- =============================================================================

-- 1. The terms on the contract.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS quotation_revision_id uuid REFERENCES public.quotation_revisions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS terms_status text CHECK (terms_status IN ('draft','in_review','returned','approved')),
  ADD COLUMN IF NOT EXISTS value_difference_reason text CHECK (value_difference_reason IS NULL OR char_length(value_difference_reason) <= 1000),
  ADD COLUMN IF NOT EXISTS signed_on date,
  ADD COLUMN IF NOT EXISTS drawings_days integer CHECK (drawings_days IS NULL OR drawings_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS supply_install_days integer CHECK (supply_install_days IS NULL OR supply_install_days BETWEEN 0 AND 730),
  ADD COLUMN IF NOT EXISTS handover_days integer CHECK (handover_days IS NULL OR handover_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS credit_days integer CHECK (credit_days IS NULL OR credit_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS terms_saved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_reason text CHECK (return_reason IS NULL OR char_length(return_reason) <= 1000),
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.contracts.terms_status IS
  'B1 (2026-11-12): the commercial terms'' review, separate from the signature stage. draft -> in_review -> approved, in_review -> returned -> in_review. Moved only by contract_terms_*.';
-- One contract with open terms per deal.
CREATE UNIQUE INDEX IF NOT EXISTS contracts_one_open_terms
  ON public.contracts (opportunity_id) WHERE terms_status IN ('draft','in_review','returned');

-- 2. The payments and the quantities.
CREATE TABLE IF NOT EXISTS public.contract_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('advance','drawings_approval','mir','wir','other')),
  label       text CHECK (label IS NULL OR char_length(label) <= 200),
  pct         numeric(6,3) NOT NULL CHECK (pct > 0 AND pct <= 100),
  amount      numeric(16,2) NOT NULL CHECK (amount >= 0),
  expected_on date,
  -- B2: when the event happened, and when the payment is due (event + credit days).
  event_on    date,
  due_on      date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, position)
);
CREATE TABLE IF NOT EXISTS public.contract_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  description text NOT NULL,
  quantity    numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit        text,
  line_total  numeric(16,2) NOT NULL CHECK (line_total >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, line_number)
);
COMMENT ON TABLE public.contract_payments IS
  'B1: a contract''s payment schedule. Amounts are computed by contract_terms_save from the percentages (the last takes the rounding remainder); expected_on from the execution period. event_on and due_on are set by B2.';
COMMENT ON TABLE public.contract_lines IS
  'B1: the contract quantities, copied from the quotation revision the contract follows. The reference for executed quantities (B4).';

ALTER TABLE public.contract_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Contract payments readable with the contract" ON public.contract_payments;
CREATE POLICY "Contract payments readable with the contract" ON public.contract_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = contract_id
                  AND public.can_read_contract(c.opportunity_id, c.responsible_user_id, c.created_by, (SELECT auth.uid()))));
DROP POLICY IF EXISTS "Contract lines readable with the contract" ON public.contract_lines;
CREATE POLICY "Contract lines readable with the contract" ON public.contract_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = contract_id
                  AND public.can_read_contract(c.opportunity_id, c.responsible_user_id, c.created_by, (SELECT auth.uid()))));
DROP POLICY IF EXISTS audit_session_boundary ON public.contract_payments;
CREATE POLICY audit_session_boundary ON public.contract_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
DROP POLICY IF EXISTS audit_session_boundary ON public.contract_lines;
CREATE POLICY audit_session_boundary ON public.contract_lines AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
REVOKE ALL ON public.contract_payments, public.contract_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contract_payments, public.contract_lines TO authenticated;
GRANT ALL ON public.contract_payments, public.contract_lines TO service_role;

-- 3. Guards: the terms change only through the RPCs (their flag names the contract).
CREATE OR REPLACE FUNCTION public._contract_terms_writing(_contract_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('contract.terms', true), '') = _contract_id::text;
$$;
REVOKE ALL ON FUNCTION public._contract_terms_writing(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contracts_terms_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._contract_terms_writing(NEW.id) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND (NEW.terms_status IS NOT NULL OR NEW.quotation_revision_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Contract terms are recorded from the deal page. | تُسجَّل شروط العقد من صفحة الصفقة.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (
       NEW.terms_status IS DISTINCT FROM OLD.terms_status
    OR NEW.quotation_revision_id IS DISTINCT FROM OLD.quotation_revision_id
    OR NEW.value_difference_reason IS DISTINCT FROM OLD.value_difference_reason
    OR NEW.signed_on IS DISTINCT FROM OLD.signed_on
    OR NEW.drawings_days IS DISTINCT FROM OLD.drawings_days
    OR NEW.supply_install_days IS DISTINCT FROM OLD.supply_install_days
    OR NEW.handover_days IS DISTINCT FROM OLD.handover_days
    OR NEW.credit_days IS DISTINCT FROM OLD.credit_days
    OR NEW.terms_saved_by IS DISTINCT FROM OLD.terms_saved_by
    OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.return_reason IS DISTINCT FROM OLD.return_reason
    OR NEW.document_id IS DISTINCT FROM OLD.document_id
    OR (OLD.terms_status IS NOT NULL AND NEW.contract_value IS DISTINCT FROM OLD.contract_value)) THEN
    RAISE EXCEPTION 'Contract terms change only through the contract card and its review. | شروط العقد تتغير من بطاقة العقد ومراجعتها فقط.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_terms_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS contracts_terms_guard ON public.contracts;
CREATE TRIGGER contracts_terms_guard BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_terms_guard();

CREATE OR REPLACE FUNCTION public.contract_children_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.contract_id ELSE NEW.contract_id END;
BEGIN
  -- The cascade from deleting a contract is not a terms change (contracts have no DELETE policy).
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = cid) THEN RETURN OLD; END IF;
  IF NOT public._contract_terms_writing(cid) THEN
    RAISE EXCEPTION 'Payments and quantities change only through the contract card. | الدفعات والكميات تتغير من بطاقة العقد فقط.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.contract_children_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS contract_payments_guard ON public.contract_payments;
CREATE TRIGGER contract_payments_guard BEFORE INSERT OR UPDATE OR DELETE ON public.contract_payments
  FOR EACH ROW EXECUTE FUNCTION public.contract_children_guard();
DROP TRIGGER IF EXISTS contract_lines_guard ON public.contract_lines;
CREATE TRIGGER contract_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.contract_lines
  FOR EACH ROW EXECUTE FUNCTION public.contract_children_guard();

-- 4. Who records: the deal owner or a pipeline operator (sales, BD, MD, GM, CEO, sales ops).
CREATE OR REPLACE FUNCTION public.can_record_contract_terms(_opportunity_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.has_app_access(_user_id), false)
     AND (public.is_pipeline_operator(_user_id)
          OR EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = _opportunity_id AND o.owner_id = _user_id));
$$;
-- Internal to the RPCs: the screens mirror it from the roles and the deal owner.
REVOKE ALL ON FUNCTION public.can_record_contract_terms(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 5. Save (create or update the deal's open draft).
CREATE OR REPLACE FUNCTION public.contract_terms_save(_opportunity_id uuid, _terms jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); o public.opportunities; qr public.quotation_revisions; c public.contracts;
        val numeric; reason text; signed date; d_days int; s_days int; h_days int; cr_days int;
        pays jsonb := coalesce(_terms->'payments', '[]'::jsonb); total numeric; n int; p jsonb; i int := 0;
        running numeric := 0; amt numeric; exp date; k text;
BEGIN
  IF NOT public.can_record_contract_terms(_opportunity_id, u) THEN
    RAISE EXCEPTION 'The deal owner or the sales or BD manager records the contract. | يسجّل العقدَ صاحبُ الصفقة أو مدير المبيعات أو تطوير الأعمال.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.opportunities WHERE id = _opportunity_id FOR UPDATE;
  -- The client's current quotation: the deal's newest current revision that was approved or sent.
  SELECT r.* INTO qr FROM public.quotation_revisions r JOIN public.quotations q ON q.id = r.quotation_id
   WHERE q.related_opportunity_id = _opportunity_id AND r.is_current AND r.status IN ('approved','submitted')
   ORDER BY r.created_at DESC LIMIT 1;
  IF qr.id IS NULL THEN
    RAISE EXCEPTION 'Issue and send the quotation before recording the contract. | أصدر عرض السعر وأرسله قبل تسجيل العقد.' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    val := round(coalesce((_terms->>'value')::numeric, qr.subtotal_excl_vat), 2);
    signed := nullif(_terms->>'signed_on', '')::date;
    d_days := coalesce((_terms->>'drawings_days')::int, 5);
    s_days := coalesce((_terms->>'supply_install_days')::int, 45);
    h_days := coalesce((_terms->>'handover_days')::int, 10);
    cr_days := coalesce((_terms->>'credit_days')::int, 30);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'A value, date or number of days is not valid. | قيمة أو تاريخ أو عدد أيام غير صالح.' USING ERRCODE = '23514';
  END;
  reason := nullif(btrim(_terms->>'value_difference_reason'), '');
  IF val <= 0 THEN RAISE EXCEPTION 'The contract value must be above zero. | قيمة العقد يجب أن تكون أكبر من صفر.' USING ERRCODE = '23514'; END IF;
  IF val <> qr.subtotal_excl_vat AND reason IS NULL THEN
    RAISE EXCEPTION 'The contract value differs from the quotation (%); say why. | قيمة العقد تختلف عن عرض السعر (%)؛ اذكر السبب.',
      qr.subtotal_excl_vat, qr.subtotal_excl_vat USING ERRCODE = '23514';
  END IF;
  IF least(d_days, s_days, h_days, cr_days) < 0 THEN
    RAISE EXCEPTION 'Days cannot be negative. | لا تكون الأيام سالبة.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(pays) <> 'array' OR jsonb_array_length(pays) = 0 THEN
    RAISE EXCEPTION 'Add at least one payment. | أضف دفعة واحدة على الأقل.' USING ERRCODE = '23514';
  END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(pays) LOOP
    IF coalesce(p->>'kind', '') NOT IN ('advance','drawings_approval','mir','wir','other') THEN
      RAISE EXCEPTION 'Unknown payment kind. | نوع دفعة غير معروف.' USING ERRCODE = '23514';
    END IF;
    IF (p->>'pct') IS NULL OR (p->>'pct')::numeric <= 0 OR (p->>'pct')::numeric > 100 THEN
      RAISE EXCEPTION 'Each payment is above 0%% and at most 100%%. | كل دفعة أكبر من 0%% ولا تتجاوز 100%%.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  SELECT sum((x->>'pct')::numeric) INTO total FROM jsonb_array_elements(pays) x;
  IF total <> 100 THEN
    RAISE EXCEPTION 'The payments add up to %%%; they must add up to 100%%. | مجموع الدفعات %%%؛ يجب أن يكون 100%%.', total, total USING ERRCODE = '23514';
  END IF;

  SELECT * INTO c FROM public.contracts
   WHERE opportunity_id = _opportunity_id AND terms_status IN ('draft','in_review','returned') FOR UPDATE;
  IF c.id IS NOT NULL AND c.terms_status = 'in_review' THEN
    RAISE EXCEPTION 'Finance is reviewing this contract; wait for the review. | المالية تراجع هذا العقد؛ انتظر المراجعة.' USING ERRCODE = 'P0001';
  END IF;
  IF c.id IS NULL AND EXISTS (SELECT 1 FROM public.contracts WHERE opportunity_id = _opportunity_id AND terms_status = 'approved') THEN
    RAISE EXCEPTION 'The approved contract is final; a change goes through a variation. | العقد المعتمد نهائي؛ أي تغيير يمر عبر أمر تغيير.' USING ERRCODE = 'P0001';
  END IF;

  IF c.id IS NULL THEN
    c.id := gen_random_uuid();
    PERFORM set_config('contract.terms', c.id::text, true);
    INSERT INTO public.contracts (id, opportunity_id, contract_name, client, contract_value, currency, created_by, terms_status)
    VALUES (c.id, o.id, o.project_name, o.client, val, 'SAR', u, 'draft');
  ELSE
    PERFORM set_config('contract.terms', c.id::text, true);
  END IF;
  UPDATE public.contracts SET
    quotation_revision_id = qr.id, contract_value = val, value_difference_reason = CASE WHEN val <> qr.subtotal_excl_vat THEN reason END,
    contract_reference_number = coalesce(nullif(btrim(_terms->>'reference'), ''), contract_reference_number),
    signed_on = signed, start_date = coalesce(signed, start_date),
    end_date = CASE WHEN signed IS NOT NULL THEN signed + d_days + s_days + h_days ELSE end_date END,
    drawings_days = d_days, supply_install_days = s_days, handover_days = h_days, credit_days = cr_days,
    document_id = nullif(_terms->>'document_id', '')::uuid, terms_saved_by = u,
    terms_status = CASE WHEN terms_status = 'returned' THEN 'returned' ELSE 'draft' END
   WHERE id = c.id;

  DELETE FROM public.contract_payments WHERE contract_id = c.id;
  n := jsonb_array_length(pays);
  FOR p IN SELECT * FROM jsonb_array_elements(pays) LOOP
    i := i + 1;
    amt := CASE WHEN i < n THEN round(val * (p->>'pct')::numeric / 100, 2) ELSE val - running END;
    running := running + amt;
    k := p->>'kind';
    exp := CASE WHEN signed IS NULL THEN NULL
                WHEN k = 'advance' THEN signed
                WHEN k = 'drawings_approval' THEN signed + d_days
                WHEN k = 'mir' THEN signed + d_days + s_days
                WHEN k = 'wir' THEN signed + d_days + s_days + h_days
                ELSE nullif(p->>'expected_on', '')::date END;
    INSERT INTO public.contract_payments (contract_id, position, kind, label, pct, amount, expected_on)
    VALUES (c.id, i, k, nullif(btrim(p->>'label'), ''), (p->>'pct')::numeric, amt, exp);
  END LOOP;
  DELETE FROM public.contract_lines WHERE contract_id = c.id;
  INSERT INTO public.contract_lines (contract_id, line_number, description, quantity, unit, line_total)
  SELECT c.id, l.line_number, l.description, l.quantity, l.unit, l.line_total
    FROM public.quotation_revision_lines l WHERE l.revision_id = qr.id;
  PERFORM set_config('contract.terms', '', true);

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_terms.saved', 'opportunity', o.id,
          jsonb_build_object('contract_id', c.id, 'quotation_revision_id', qr.id, 'payments', n,
                             'differs_from_quotation', val <> qr.subtotal_excl_vat));
  RETURN c.id;
END $$;
REVOKE ALL ON FUNCTION public.contract_terms_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_terms_save(uuid, jsonb) TO authenticated;

-- 6. Submit for finance's review.
CREATE OR REPLACE FUNCTION public.contract_terms_submit(_contract_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); c public.contracts; code text;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_record_contract_terms(c.opportunity_id, u) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  IF c.terms_status NOT IN ('draft','returned') THEN
    RAISE EXCEPTION 'Only a draft or a returned contract is sent for review. | تُرسل للمراجعة مسودة أو عقد مُرجع فقط.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('contract.terms', c.id::text, true);
  UPDATE public.contracts SET terms_status = 'in_review', submitted_by = u, submitted_at = now()
   WHERE id = c.id RETURNING * INTO c;
  PERFORM set_config('contract.terms', '', true);
  SELECT coalesce(project_code, project_name) INTO code FROM public.opportunities WHERE id = c.opportunity_id;
  PERFORM public.emit_notification_to_roles(ARRAY['finance_manager']::public.app_role[],
    'contract_review', 'opportunity', c.opportunity_id, code,
    'A contract is waiting for your review. | عقد بانتظار مراجعتك.', 'attention', 'contract_review',
    'contract_review:' || c.id || ':' || extract(epoch FROM c.submitted_at)::bigint, jsonb_build_object('contract_id', c.id));
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_terms.submitted', 'opportunity', c.opportunity_id, jsonb_build_object('contract_id', c.id));
  RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION public.contract_terms_submit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_terms_submit(uuid) TO authenticated;

-- 7. Finance reviews.
CREATE OR REPLACE FUNCTION public.contract_terms_review(_contract_id uuid, _decision text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); c public.contracts; r text := nullif(btrim(_reason), ''); code text; who uuid;
BEGIN
  IF NOT (coalesce(public.has_app_access(u), false) AND public.has_role(u, 'finance_manager'::public.app_role)) THEN
    RAISE EXCEPTION 'Finance reviews the contract. | مراجعة العقد للمالية.' USING ERRCODE = '42501';
  END IF;
  IF _decision IS NULL OR _decision NOT IN ('approve','return') THEN
    RAISE EXCEPTION 'Choose approve or return. | اختر الاعتماد أو الإرجاع.' USING ERRCODE = '23514';
  END IF;
  IF _decision = 'return' AND r IS NULL THEN
    RAISE EXCEPTION 'A return needs a reason. | الإرجاع يحتاج سبباً.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND OR c.terms_status IS DISTINCT FROM 'in_review' THEN
    RAISE EXCEPTION 'This contract is not waiting for review. | هذا العقد ليس بانتظار المراجعة.' USING ERRCODE = 'P0001';
  END IF;
  IF u IN (c.submitted_by, c.terms_saved_by) THEN
    RAISE EXCEPTION 'You cannot review a contract you recorded. | لا تراجع عقداً سجّلته بنفسك.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('contract.terms', c.id::text, true);
  UPDATE public.contracts SET
    terms_status = CASE WHEN _decision = 'approve' THEN 'approved' ELSE 'returned' END,
    return_reason = CASE WHEN _decision = 'return' THEN r END,
    reviewed_by = u, reviewed_at = now()
   WHERE id = c.id RETURNING * INTO c;
  PERFORM set_config('contract.terms', '', true);
  SELECT coalesce(project_code, project_name), owner_id INTO code, who FROM public.opportunities WHERE id = c.opportunity_id;
  who := coalesce(c.submitted_by, who);
  IF who IS NOT NULL THEN
    PERFORM public.emit_notification(who,
      CASE WHEN _decision = 'approve' THEN 'contract_approved' ELSE 'contract_returned' END,
      'opportunity', c.opportunity_id, code,
      CASE WHEN _decision = 'approve' THEN 'Finance approved the contract. | اعتمدت المالية العقد.'
           ELSE 'Finance returned the contract; the reason is on the deal. | أرجعت المالية العقد؛ السبب في الصفقة.' END,
      CASE WHEN _decision = 'approve' THEN 'info' ELSE 'attention' END, 'contract_review',
      'contract_reviewed:' || c.id || ':' || extract(epoch FROM c.reviewed_at)::bigint, jsonb_build_object('contract_id', c.id));
  END IF;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_terms.reviewed', 'opportunity', c.opportunity_id,
          jsonb_build_object('contract_id', c.id, 'decision', _decision));
  RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION public.contract_terms_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_terms_review(uuid, text, text) TO authenticated;
