-- =============================================================================
-- Commercial & Finance part 2, B3: invoices, receipts, claims, lateness
-- (design docs/superpowers/specs/2026-11-12-contract-billing-design.md).
-- The tax invoice is issued in the accounting system (ZATCA); finance records it
-- here against the dues it covers (B2). Its amount is the sum of those dues, so
-- it cannot disagree with them; VAT is generated. It is due credit_days after
-- its date. Finance records receipts; the rep or finance logs claims. A daily
-- job escalates late invoices in three tiers and tells finance about dues past
-- their date that nobody invoiced.
-- =============================================================================

-- 1. Tables.
CREATE TABLE IF NOT EXISTS public.contract_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  invoice_number   text NOT NULL CHECK (char_length(btrim(invoice_number)) BETWEEN 1 AND 60),
  invoice_date     date NOT NULL,
  amount_excl_vat  numeric(16,2) NOT NULL CHECK (amount_excl_vat >= 0),
  vat_rate         numeric(5,4) NOT NULL DEFAULT 0.15 CHECK (vat_rate >= 0 AND vat_rate <= 1),
  vat_amount       numeric(16,2) GENERATED ALWAYS AS (round(amount_excl_vat * vat_rate, 2)) STORED,
  total_incl_vat   numeric(16,2) GENERATED ALWAYS AS (amount_excl_vat + round(amount_excl_vat * vat_rate, 2)) STORED,
  due_on           date NOT NULL,
  note             text CHECK (note IS NULL OR char_length(note) <= 1000),
  recorded_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  voided_at        timestamptz,
  voided_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason      text CHECK (void_reason IS NULL OR char_length(void_reason) <= 1000),
  CONSTRAINT contract_invoices_void_consistent CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_invoices_number
  ON public.contract_invoices (contract_id, lower(btrim(invoice_number))) WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS public.contract_invoice_dues (
  invoice_id  uuid NOT NULL REFERENCES public.contract_invoices(id) ON DELETE CASCADE,
  due_id      uuid NOT NULL REFERENCES public.contract_dues(id) ON DELETE RESTRICT,
  live        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (invoice_id, due_id)
);
-- A due is on at most one live invoice.
CREATE UNIQUE INDEX IF NOT EXISTS contract_invoice_dues_once ON public.contract_invoice_dues (due_id) WHERE live;

CREATE TABLE IF NOT EXISTS public.contract_receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES public.contract_invoices(id) ON DELETE RESTRICT,
  received_on  date NOT NULL,
  amount       numeric(16,2) NOT NULL CHECK (amount > 0),
  reference    text CHECK (reference IS NULL OR char_length(reference) <= 200),
  note         text CHECK (note IS NULL OR char_length(note) <= 1000),
  recorded_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,
  voided_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason  text CHECK (void_reason IS NULL OR char_length(void_reason) <= 1000),
  CONSTRAINT contract_receipts_void_consistent CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);

CREATE TABLE IF NOT EXISTS public.contract_claims (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  invoice_id    uuid REFERENCES public.contract_invoices(id) ON DELETE SET NULL,
  claimed_on    date NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('email','letter','call','meeting','other')),
  note          text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  follow_up_on  date,
  recorded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One record of each escalation sent, so the daily job sends each tier once.
CREATE TABLE IF NOT EXISTS public.contract_escalations (
  subject_id  uuid NOT NULL,
  tier        smallint NOT NULL,
  sent_on     date NOT NULL,
  PRIMARY KEY (subject_id, tier)
);

-- 2. Row security: read with the contract; writes through the RPCs only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contract_invoices','contract_receipts','contract_claims'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s readable with the contract" ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY "%s readable with the contract" ON public.%I FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = contract_id
                      AND public.can_read_contract(c.opportunity_id, c.responsible_user_id, c.created_by, (SELECT auth.uid()))))$p$, t, t);
    EXECUTE format('DROP POLICY IF EXISTS audit_session_boundary ON public.%I', t);
    EXECUTE format($p$CREATE POLICY audit_session_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())))$p$, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_guard', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.contract_children_guard()', t || '_guard', t);
  END LOOP;
END $$;
ALTER TABLE public.contract_invoice_dues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Invoice dues readable with the contract" ON public.contract_invoice_dues;
CREATE POLICY "Invoice dues readable with the contract" ON public.contract_invoice_dues FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contract_invoices i JOIN public.contracts c ON c.id = i.contract_id
                  WHERE i.id = invoice_id
                    AND public.can_read_contract(c.opportunity_id, c.responsible_user_id, c.created_by, (SELECT auth.uid()))));
DROP POLICY IF EXISTS audit_session_boundary ON public.contract_invoice_dues;
CREATE POLICY audit_session_boundary ON public.contract_invoice_dues AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
REVOKE ALL ON public.contract_invoice_dues FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contract_invoice_dues TO authenticated;
GRANT ALL ON public.contract_invoice_dues TO service_role;
ALTER TABLE public.contract_escalations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_session_boundary ON public.contract_escalations;
CREATE POLICY audit_session_boundary ON public.contract_escalations AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
REVOKE ALL ON public.contract_escalations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.contract_escalations TO service_role;

CREATE OR REPLACE FUNCTION public.contract_invoice_dues_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid;
BEGIN
  SELECT contract_id INTO cid FROM public.contract_invoices
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF TG_OP = 'DELETE' AND cid IS NULL THEN RETURN OLD; END IF;
  IF NOT public._contract_terms_writing(cid) THEN
    RAISE EXCEPTION 'Invoices change only through finance''s actions. | الفواتير تتغير من إجراءات المالية فقط.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.contract_invoice_dues_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS contract_invoice_dues_guard ON public.contract_invoice_dues;
CREATE TRIGGER contract_invoice_dues_guard BEFORE INSERT OR UPDATE OR DELETE ON public.contract_invoice_dues
  FOR EACH ROW EXECUTE FUNCTION public.contract_invoice_dues_guard();

-- 3. Helpers.
CREATE OR REPLACE FUNCTION public._is_finance_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.has_app_access(_user_id), false) AND public.has_role(_user_id, 'finance_manager'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public._is_finance_manager(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Record an invoice (finance): its amount is the sum of the dues it covers.
CREATE OR REPLACE FUNCTION public.contract_invoice_record(_contract_id uuid, _number text, _invoice_date date,
  _due_ids uuid[], _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); c public.contracts; n text := nullif(btrim(_number), ''); inv uuid := gen_random_uuid();
        found_n int; total numeric;
BEGIN
  IF NOT public._is_finance_manager(u) THEN
    RAISE EXCEPTION 'Finance records invoices. | تسجيل الفواتير للمالية.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND OR c.terms_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Invoices are recorded on an approved contract. | تُسجَّل الفواتير على عقد معتمد.' USING ERRCODE = 'P0001';
  END IF;
  IF n IS NULL THEN RAISE EXCEPTION 'Give the invoice number from the accounting system. | أدخل رقم الفاتورة من النظام المحاسبي.' USING ERRCODE = '23514'; END IF;
  IF _invoice_date IS NULL OR _invoice_date > current_date THEN
    RAISE EXCEPTION 'The invoice date is today or earlier. | تاريخ الفاتورة اليوم أو قبله.' USING ERRCODE = '23514';
  END IF;
  IF coalesce(array_length(_due_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Pick at least one due to invoice. | اختر استحقاقاً واحداً على الأقل.' USING ERRCODE = '23514';
  END IF;
  SELECT count(*), sum(d.amount) INTO found_n, total FROM public.contract_dues d
   WHERE d.id = ANY(_due_ids) AND d.contract_id = c.id AND d.status = 'open';
  IF found_n <> (SELECT count(DISTINCT x) FROM unnest(_due_ids) x) THEN
    RAISE EXCEPTION 'Only open dues of this contract can be invoiced. | تُفوتر الاستحقاقات المفتوحة لهذا العقد فقط.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.contract_invoice_dues x WHERE x.due_id = ANY(_due_ids) AND x.live) THEN
    RAISE EXCEPTION 'A due is already on an invoice. | أحد الاستحقاقات مفوتر سابقاً.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.contract_invoices WHERE contract_id = c.id AND voided_at IS NULL
              AND lower(btrim(invoice_number)) = lower(n)) THEN
    RAISE EXCEPTION 'This invoice number is already recorded on this contract. | رقم الفاتورة هذا مسجّل على هذا العقد.' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('contract.terms', c.id::text, true);
  INSERT INTO public.contract_invoices (id, contract_id, invoice_number, invoice_date, amount_excl_vat, due_on, note, recorded_by)
  VALUES (inv, c.id, n, _invoice_date, total, _invoice_date + coalesce(c.credit_days, 0), nullif(btrim(_note), ''), u);
  INSERT INTO public.contract_invoice_dues (invoice_id, due_id) SELECT DISTINCT inv, x FROM unnest(_due_ids) x;
  PERFORM set_config('contract.terms', '', true);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_invoice.recorded', 'opportunity', c.opportunity_id,
          jsonb_build_object('contract_id', c.id, 'invoice_id', inv, 'dues', array_length(_due_ids, 1)));
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public.contract_invoice_record(uuid, text, date, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_invoice_record(uuid, text, date, uuid[], text) TO authenticated;

-- 5. Void an invoice (finance, nothing received on it): its dues can be invoiced again.
CREATE OR REPLACE FUNCTION public.contract_invoice_void(_invoice_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); i public.contract_invoices; r text := nullif(btrim(_reason), '');
BEGIN
  IF NOT public._is_finance_manager(u) THEN RAISE EXCEPTION 'Finance voids invoices. | إلغاء الفواتير للمالية.' USING ERRCODE = '42501'; END IF;
  IF r IS NULL THEN RAISE EXCEPTION 'Say why. | اذكر السبب.' USING ERRCODE = '23514'; END IF;
  SELECT * INTO i FROM public.contract_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND OR i.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Unknown or already voided invoice. | فاتورة غير موجودة أو ملغاة.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.contract_receipts WHERE invoice_id = i.id AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'Money was received on this invoice; void the receipts first. | استُلم مبلغ على هذه الفاتورة؛ ألغِ المقبوضات أولاً.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('contract.terms', i.contract_id::text, true);
  UPDATE public.contract_invoices SET voided_at = now(), voided_by = u, void_reason = r WHERE id = i.id;
  UPDATE public.contract_invoice_dues SET live = false WHERE invoice_id = i.id;
  PERFORM set_config('contract.terms', '', true);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_invoice.voided', 'contract', i.contract_id, jsonb_build_object('invoice_id', i.id));
  RETURN jsonb_build_object('id', i.id, 'voided', true);
END $$;
REVOKE ALL ON FUNCTION public.contract_invoice_void(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_invoice_void(uuid, text) TO authenticated;

-- 6. Receipts (finance).
CREATE OR REPLACE FUNCTION public.contract_receipt_record(_invoice_id uuid, _received_on date, _amount numeric,
  _reference text, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); i public.contract_invoices; got numeric; rid uuid := gen_random_uuid();
BEGIN
  IF NOT public._is_finance_manager(u) THEN RAISE EXCEPTION 'Finance records receipts. | تسجيل المقبوضات للمالية.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.contract_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND OR i.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Unknown or voided invoice. | فاتورة غير موجودة أو ملغاة.' USING ERRCODE = 'P0001'; END IF;
  IF _received_on IS NULL OR _received_on > current_date OR _received_on < i.invoice_date THEN
    RAISE EXCEPTION 'The date is between the invoice date and today. | التاريخ بين تاريخ الفاتورة واليوم.' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(amount), 0) INTO got FROM public.contract_receipts WHERE invoice_id = i.id AND voided_at IS NULL;
  IF _amount IS NULL OR _amount <= 0 OR got + _amount > i.total_incl_vat THEN
    RAISE EXCEPTION 'The amount is above 0 and at most what is outstanding (%). | المبلغ أكبر من صفر ولا يتجاوز المتبقي (%).',
      i.total_incl_vat - got, i.total_incl_vat - got USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('contract.terms', i.contract_id::text, true);
  INSERT INTO public.contract_receipts (id, contract_id, invoice_id, received_on, amount, reference, note, recorded_by)
  VALUES (rid, i.contract_id, i.id, _received_on, round(_amount, 2), nullif(btrim(_reference), ''), nullif(btrim(_note), ''), u);
  PERFORM set_config('contract.terms', '', true);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_receipt.recorded', 'contract', i.contract_id, jsonb_build_object('invoice_id', i.id, 'receipt_id', rid));
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.contract_receipt_record(uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_receipt_record(uuid, date, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.contract_receipt_void(_receipt_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); rc public.contract_receipts; r text := nullif(btrim(_reason), '');
BEGIN
  IF NOT public._is_finance_manager(u) THEN RAISE EXCEPTION 'Finance voids receipts. | إلغاء المقبوضات للمالية.' USING ERRCODE = '42501'; END IF;
  IF r IS NULL THEN RAISE EXCEPTION 'Say why. | اذكر السبب.' USING ERRCODE = '23514'; END IF;
  SELECT * INTO rc FROM public.contract_receipts WHERE id = _receipt_id FOR UPDATE;
  IF NOT FOUND OR rc.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Unknown or already voided receipt. | مقبوض غير موجود أو ملغى.' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('contract.terms', rc.contract_id::text, true);
  UPDATE public.contract_receipts SET voided_at = now(), voided_by = u, void_reason = r WHERE id = rc.id;
  PERFORM set_config('contract.terms', '', true);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_receipt.voided', 'contract', rc.contract_id, jsonb_build_object('receipt_id', rc.id));
  RETURN jsonb_build_object('id', rc.id, 'voided', true);
END $$;
REVOKE ALL ON FUNCTION public.contract_receipt_void(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_receipt_void(uuid, text) TO authenticated;

-- 7. Claims (the deal owner, a pipeline operator, or finance).
CREATE OR REPLACE FUNCTION public.contract_claim_record(_contract_id uuid, _invoice_id uuid, _claimed_on date,
  _channel text, _note text, _follow_up_on date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); c public.contracts; cid uuid := gen_random_uuid();
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id;
  IF NOT FOUND OR NOT (public.can_record_contract_terms(c.opportunity_id, u) OR public._is_finance_manager(u)) THEN
    RAISE EXCEPTION 'The deal owner, the sales or BD manager or finance logs claims. | يسجّل المطالبات صاحبُ الصفقة أو مدير المبيعات أو تطوير الأعمال أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _channel IS NULL OR _channel NOT IN ('email','letter','call','meeting','other') THEN
    RAISE EXCEPTION 'Choose how the claim was made. | اختر وسيلة المطالبة.' USING ERRCODE = '23514';
  END IF;
  IF nullif(btrim(_note), '') IS NULL OR _claimed_on IS NULL OR _claimed_on > current_date
     OR (_follow_up_on IS NOT NULL AND _follow_up_on < _claimed_on) THEN
    RAISE EXCEPTION 'A note, a claim date up to today and a follow-up on or after it. | ملاحظة وتاريخ مطالبة حتى اليوم ومتابعة في يومها أو بعده.' USING ERRCODE = '23514';
  END IF;
  IF _invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contract_invoices WHERE id = _invoice_id AND contract_id = c.id) THEN
    RAISE EXCEPTION 'That invoice is not on this contract. | هذه الفاتورة ليست على هذا العقد.' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('contract.terms', c.id::text, true);
  INSERT INTO public.contract_claims (id, contract_id, invoice_id, claimed_on, channel, note, follow_up_on, recorded_by)
  VALUES (cid, c.id, _invoice_id, _claimed_on, _channel, btrim(_note), _follow_up_on, u);
  PERFORM set_config('contract.terms', '', true);
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.contract_claim_record(uuid, uuid, date, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_claim_record(uuid, uuid, date, text, text, date) TO authenticated;

-- 8. B2's void refuses an approval whose due is on a live invoice.
CREATE OR REPLACE FUNCTION public._contract_approval_not_invoiced()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL AND EXISTS (
       SELECT 1 FROM public.contract_dues d JOIN public.contract_invoice_dues x ON x.due_id = d.id AND x.live
        WHERE d.approval_id = NEW.id) THEN
    RAISE EXCEPTION 'This approval''s due is invoiced; void the invoice first. | استحقاق هذا الاعتماد مفوتر؛ ألغِ الفاتورة أولاً.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._contract_approval_not_invoiced() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS contract_approvals_not_invoiced ON public.contract_approvals;
CREATE TRIGGER contract_approvals_not_invoiced BEFORE UPDATE OF voided_at ON public.contract_approvals
  FOR EACH ROW EXECUTE FUNCTION public._contract_approval_not_invoiced();

-- 9. Views (invoker: the contract's row security decides who reads them).
CREATE OR REPLACE VIEW public.contract_receivables WITH (security_invoker = true) AS
SELECT i.id AS invoice_id, i.contract_id, c.opportunity_id, i.invoice_number, i.invoice_date, i.due_on,
       i.amount_excl_vat, i.total_incl_vat,
       coalesce(r.received, 0)::numeric(16,2) AS received,
       (i.total_incl_vat - coalesce(r.received, 0))::numeric(16,2) AS outstanding,
       CASE WHEN i.total_incl_vat - coalesce(r.received, 0) > 0 THEN greatest(0, current_date - i.due_on) ELSE 0 END AS days_late,
       CASE WHEN i.total_incl_vat - coalesce(r.received, 0) <= 0 THEN 0
            WHEN current_date - i.due_on >= 60 THEN 3
            WHEN current_date - i.due_on >= 30 THEN 2
            WHEN current_date - i.due_on >= 1 THEN 1 ELSE 0 END AS tier
  FROM public.contract_invoices i
  JOIN public.contracts c ON c.id = i.contract_id
  LEFT JOIN LATERAL (SELECT sum(x.amount) AS received FROM public.contract_receipts x
                      WHERE x.invoice_id = i.id AND x.voided_at IS NULL) r ON TRUE
 WHERE i.voided_at IS NULL;
GRANT SELECT ON public.contract_receivables TO authenticated;

CREATE OR REPLACE VIEW public.contract_billing_summary WITH (security_invoker = true) AS
SELECT c.id AS contract_id, c.opportunity_id, c.contract_value,
       coalesce(inv.excl, 0)::numeric(16,2) AS invoiced_excl_vat,
       (c.contract_value - coalesce(inv.excl, 0))::numeric(16,2) AS left_to_invoice,
       coalesce(inv.incl, 0)::numeric(16,2) AS invoiced_incl_vat,
       coalesce(rec.received, 0)::numeric(16,2) AS received,
       (coalesce(inv.incl, 0) - coalesce(rec.received, 0))::numeric(16,2) AS outstanding,
       coalesce(late.amount, 0)::numeric(16,2) AS late_outstanding,
       coalesce(ni.n, 0)::int AS dues_not_invoiced,
       coalesce(ni.amount, 0)::numeric(16,2) AS amount_not_invoiced
  FROM public.contracts c
  LEFT JOIN LATERAL (SELECT sum(i.amount_excl_vat) AS excl, sum(i.total_incl_vat) AS incl
                       FROM public.contract_invoices i WHERE i.contract_id = c.id AND i.voided_at IS NULL) inv ON TRUE
  LEFT JOIN LATERAL (SELECT sum(x.amount) AS received FROM public.contract_receipts x
                      WHERE x.contract_id = c.id AND x.voided_at IS NULL) rec ON TRUE
  LEFT JOIN LATERAL (SELECT sum(v.outstanding) AS amount FROM public.contract_receivables v
                      WHERE v.contract_id = c.id AND v.days_late > 0) late ON TRUE
  LEFT JOIN LATERAL (SELECT count(*) AS n, sum(d.amount) AS amount FROM public.contract_dues d
                      WHERE d.contract_id = c.id AND d.status = 'open'
                        AND NOT EXISTS (SELECT 1 FROM public.contract_invoice_dues x WHERE x.due_id = d.id AND x.live)) ni ON TRUE
 WHERE c.terms_status = 'approved';
GRANT SELECT ON public.contract_billing_summary TO authenticated;

-- 10. Daily escalation (service only). Returns how many notices it sent.
CREATE OR REPLACE FUNCTION public.contract_collections_escalate(_today date DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := coalesce(_today, public._pricing_today()); r record; n int := 0; t smallint; code text;
BEGIN
  FOR r IN
    SELECT i.id, i.invoice_number, i.due_on, c.opportunity_id, o.owner_id, coalesce(o.project_code, o.project_name) AS code,
           i.total_incl_vat - coalesce((SELECT sum(x.amount) FROM public.contract_receipts x
                                         WHERE x.invoice_id = i.id AND x.voided_at IS NULL), 0) AS outstanding
      FROM public.contract_invoices i JOIN public.contracts c ON c.id = i.contract_id
      JOIN public.opportunities o ON o.id = c.opportunity_id
     WHERE i.voided_at IS NULL AND i.due_on < d
  LOOP
    CONTINUE WHEN r.outstanding <= 0;
    FOR t IN SELECT g FROM generate_series(1, 3) g LOOP
      CONTINUE WHEN d - r.due_on < CASE t WHEN 1 THEN 1 WHEN 2 THEN 30 ELSE 60 END;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.contract_escalations WHERE subject_id = r.id AND tier = t);
      INSERT INTO public.contract_escalations (subject_id, tier, sent_on) VALUES (r.id, t, d);
      n := n + 1;
      IF t = 1 AND r.owner_id IS NOT NULL THEN
        PERFORM public.emit_notification(r.owner_id, 'contract_invoice_late', 'opportunity', r.opportunity_id, r.code,
          'Invoice ' || r.invoice_number || ' is past its due date: claim it. | الفاتورة ' || r.invoice_number || ' تجاوزت تاريخ استحقاقها: طالب بها.',
          'attention', 'contract_invoice_late', 'invoice_late:' || r.id || ':1', jsonb_build_object('invoice_id', r.id, 'tier', 1));
      ELSIF t = 2 THEN
        PERFORM public.emit_notification_to_roles(ARRAY['sales_manager']::public.app_role[], 'contract_invoice_late', 'opportunity',
          r.opportunity_id, r.code,
          'Invoice ' || r.invoice_number || ' is 30 days late. | الفاتورة ' || r.invoice_number || ' متأخرة 30 يوماً.',
          'attention', 'contract_invoice_late', 'invoice_late:' || r.id || ':2', jsonb_build_object('invoice_id', r.id, 'tier', 2));
      ELSIF t = 3 THEN
        PERFORM public.emit_notification_to_roles(ARRAY['general_manager']::public.app_role[], 'contract_invoice_late', 'opportunity',
          r.opportunity_id, r.code,
          'Invoice ' || r.invoice_number || ' is 60 days late and needs escalation. | الفاتورة ' || r.invoice_number || ' متأخرة 60 يوماً وتحتاج تصعيداً.',
          'critical', 'contract_invoice_late', 'invoice_late:' || r.id || ':3', jsonb_build_object('invoice_id', r.id, 'tier', 3));
      END IF;
    END LOOP;
  END LOOP;
  -- Dues past their date that nobody invoiced: once, to finance.
  FOR r IN
    SELECT d2.id, c.opportunity_id, coalesce(o.project_code, o.project_name) AS code
      FROM public.contract_dues d2 JOIN public.contracts c ON c.id = d2.contract_id
      JOIN public.opportunities o ON o.id = c.opportunity_id
     WHERE d2.status = 'open' AND d2.due_on < d
       AND NOT EXISTS (SELECT 1 FROM public.contract_invoice_dues x WHERE x.due_id = d2.id AND x.live)
       AND NOT EXISTS (SELECT 1 FROM public.contract_escalations e WHERE e.subject_id = d2.id AND e.tier = 0)
  LOOP
    INSERT INTO public.contract_escalations (subject_id, tier, sent_on) VALUES (r.id, 0, d);
    n := n + 1;
    PERFORM public.emit_notification_to_roles(ARRAY['finance_manager']::public.app_role[], 'contract_due_not_invoiced', 'opportunity',
      r.opportunity_id, r.code, 'A contract payment is past its date and not invoiced. | دفعة عقد تجاوزت تاريخها ولم تُفوتر.',
      'attention', 'contract_due_not_invoiced', 'due_not_invoiced:' || r.id, jsonb_build_object('due_id', r.id));
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.contract_collections_escalate(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_collections_escalate(date) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'contract-collections-escalate';
    PERFORM cron.schedule('contract-collections-escalate', '30 5 * * *', $job$ SELECT public.contract_collections_escalate(); $job$);
  END IF;
END $$;
