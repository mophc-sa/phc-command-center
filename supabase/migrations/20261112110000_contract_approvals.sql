-- =============================================================================
-- Commercial & Finance part 2, B2: execution approvals make payments due
-- (design docs/superpowers/specs/2026-11-12-contract-approvals-design.md).
-- The rep records an approval (drawings, MIR, WIR or another payment) with the
-- share of the work it covers; each approval creates a due: that share of the
-- payment, due credit_days after the approval. The advance falls due when
-- finance approves the terms. The drawings approval's submitted and approved
-- dates give the consultant delay, which shifts the later expected dates.
-- B3 invoices against contract_dues.
-- =============================================================================

-- 1. Consultant delay on the contract (set by the approval RPCs, guarded like the other terms).
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS consultant_delay_days integer NOT NULL DEFAULT 0
  CHECK (consultant_delay_days >= 0);

-- 2. Approvals and dues.
CREATE TABLE IF NOT EXISTS public.contract_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id    uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  payment_id     uuid NOT NULL REFERENCES public.contract_payments(id) ON DELETE RESTRICT,
  approved_on    date NOT NULL,
  share_pct      numeric(6,3) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  submitted_on   date,
  reference      text CHECK (reference IS NULL OR char_length(reference) <= 200),
  document_path  text CHECK (document_path IS NULL OR char_length(document_path) <= 500),
  note           text CHECK (note IS NULL OR char_length(note) <= 1000),
  recorded_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz,
  voided_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason    text CHECK (void_reason IS NULL OR char_length(void_reason) <= 1000),
  CONSTRAINT contract_approvals_void_consistent CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS contract_approvals_payment ON public.contract_approvals (payment_id);

CREATE TABLE IF NOT EXISTS public.contract_dues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  payment_id   uuid NOT NULL REFERENCES public.contract_payments(id) ON DELETE RESTRICT,
  approval_id  uuid UNIQUE REFERENCES public.contract_approvals(id) ON DELETE RESTRICT,
  share_pct    numeric(6,3) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  amount       numeric(16,2) NOT NULL CHECK (amount >= 0),
  event_on     date NOT NULL,
  due_on       date NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','void')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_dues_payment ON public.contract_dues (payment_id);
CREATE INDEX IF NOT EXISTS contract_dues_due ON public.contract_dues (due_on) WHERE status = 'open';
COMMENT ON TABLE public.contract_dues IS
  'B2: what is due on a contract: one row per approval (and the advance on approval of the terms). amount is the payment''s amount times the share; the due that brings a payment to 100% takes the remainder. due_on = event_on + credit_days. B3 invoices against these.';

ALTER TABLE public.contract_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_dues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Contract approvals readable with the contract" ON public.contract_approvals;
CREATE POLICY "Contract approvals readable with the contract" ON public.contract_approvals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = contract_id
                  AND public.can_read_contract(c.opportunity_id, c.responsible_user_id, c.created_by, (SELECT auth.uid()))));
DROP POLICY IF EXISTS "Contract dues readable with the contract" ON public.contract_dues;
CREATE POLICY "Contract dues readable with the contract" ON public.contract_dues FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = contract_id
                  AND public.can_read_contract(c.opportunity_id, c.responsible_user_id, c.created_by, (SELECT auth.uid()))));
DROP POLICY IF EXISTS audit_session_boundary ON public.contract_approvals;
CREATE POLICY audit_session_boundary ON public.contract_approvals AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
DROP POLICY IF EXISTS audit_session_boundary ON public.contract_dues;
CREATE POLICY audit_session_boundary ON public.contract_dues AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
REVOKE ALL ON public.contract_approvals, public.contract_dues FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contract_approvals, public.contract_dues TO authenticated;
GRANT ALL ON public.contract_approvals, public.contract_dues TO service_role;
DROP TRIGGER IF EXISTS contract_approvals_guard ON public.contract_approvals;
CREATE TRIGGER contract_approvals_guard BEFORE INSERT OR UPDATE OR DELETE ON public.contract_approvals
  FOR EACH ROW EXECUTE FUNCTION public.contract_children_guard();
DROP TRIGGER IF EXISTS contract_dues_guard ON public.contract_dues;
CREATE TRIGGER contract_dues_guard BEFORE INSERT OR UPDATE OR DELETE ON public.contract_dues
  FOR EACH ROW EXECUTE FUNCTION public.contract_children_guard();

-- The contract guard (20261112100000) also protects consultant_delay_days.
CREATE OR REPLACE FUNCTION public.contracts_terms_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._contract_terms_writing(NEW.id) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND (NEW.terms_status IS NOT NULL OR NEW.quotation_revision_id IS NOT NULL
                           OR NEW.consultant_delay_days <> 0) THEN
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
    OR NEW.consultant_delay_days IS DISTINCT FROM OLD.consultant_delay_days
    OR (OLD.terms_status IS NOT NULL AND NEW.contract_value IS DISTINCT FROM OLD.contract_value)) THEN
    RAISE EXCEPTION 'Contract terms change only through the contract card and its review. | شروط العقد تتغير من بطاقة العقد ومراجعتها فقط.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- 3. Internal: write a due for a payment's share (remainder when it completes the payment).
CREATE OR REPLACE FUNCTION public._contract_add_due(_payment_id uuid, _approval_id uuid, _share numeric, _event_on date)
RETURNS public.contract_dues LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.contract_payments; c public.contracts; done_share numeric; done_amount numeric; amt numeric; d public.contract_dues;
BEGIN
  SELECT * INTO p FROM public.contract_payments WHERE id = _payment_id FOR UPDATE;
  SELECT * INTO c FROM public.contracts WHERE id = p.contract_id;
  SELECT coalesce(sum(share_pct), 0), coalesce(sum(amount), 0) INTO done_share, done_amount
    FROM public.contract_dues WHERE payment_id = p.id AND status = 'open';
  IF done_share + _share > 100 THEN
    RAISE EXCEPTION 'This payment is already % %% due; at most % %% is left. | هذه الدفعة مستحقة بنسبة % %%؛ المتبقي % %% كحد أقصى.',
      done_share, 100 - done_share, done_share, 100 - done_share USING ERRCODE = '23514';
  END IF;
  amt := CASE WHEN done_share + _share = 100 THEN p.amount - done_amount ELSE round(p.amount * _share / 100, 2) END;
  INSERT INTO public.contract_dues (contract_id, payment_id, approval_id, share_pct, amount, event_on, due_on)
  VALUES (p.contract_id, p.id, _approval_id, _share, amt, _event_on, _event_on + coalesce(c.credit_days, 0))
  RETURNING * INTO d;
  PERFORM public.emit_notification_to_roles(ARRAY['finance_manager']::public.app_role[],
    'contract_due', 'opportunity', c.opportunity_id,
    (SELECT coalesce(project_code, project_name) FROM public.opportunities WHERE id = c.opportunity_id),
    'A contract payment is due for invoicing. | دفعة عقد مستحقة للفوترة.', 'info', 'contract_due',
    'contract_due:' || d.id, jsonb_build_object('contract_id', c.id, 'due_id', d.id));
  RETURN d;
END $$;
REVOKE ALL ON FUNCTION public._contract_add_due(uuid, uuid, numeric, date) FROM PUBLIC, anon, authenticated;

-- 4. The advance falls due when finance approves the terms.
CREATE OR REPLACE FUNCTION public._contract_advance_on_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  IF NEW.terms_status = 'approved' AND OLD.terms_status IS DISTINCT FROM 'approved' THEN
    FOR p IN SELECT id FROM public.contract_payments WHERE contract_id = NEW.id AND kind = 'advance' ORDER BY position LOOP
      PERFORM public._contract_add_due(p.id, NULL, 100, coalesce(NEW.signed_on, current_date));
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._contract_advance_on_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS contracts_advance_due ON public.contracts;
CREATE TRIGGER contracts_advance_due AFTER UPDATE OF terms_status ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public._contract_advance_on_approval();

-- 5. Record an approval.
CREATE OR REPLACE FUNCTION public.contract_approval_record(_contract_id uuid, _payment_id uuid, _approved_on date,
  _share_pct numeric, _submitted_on date, _reference text, _document_path text, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); c public.contracts; p public.contract_payments; a_id uuid := gen_random_uuid(); delay int;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_record_contract_terms(c.opportunity_id, u) THEN
    RAISE EXCEPTION 'The deal owner or the sales or BD manager records approvals. | يسجّل الاعتمادات صاحبُ الصفقة أو مدير المبيعات أو تطوير الأعمال.' USING ERRCODE = '42501';
  END IF;
  IF c.terms_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Finance approves the contract terms first. | تعتمد المالية شروط العقد أولاً.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO p FROM public.contract_payments WHERE id = _payment_id AND contract_id = c.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That payment is not on this contract. | هذه الدفعة ليست في هذا العقد.' USING ERRCODE = '23514'; END IF;
  IF p.kind = 'advance' THEN
    RAISE EXCEPTION 'The advance falls due when the contract is approved. | الدفعة المقدمة تستحق عند اعتماد العقد.' USING ERRCODE = 'P0001';
  END IF;
  IF _approved_on IS NULL OR _approved_on > current_date OR (c.signed_on IS NOT NULL AND _approved_on < c.signed_on) THEN
    RAISE EXCEPTION 'The approval date is between the signing date and today. | تاريخ الاعتماد بين تاريخ التوقيع واليوم.' USING ERRCODE = '23514';
  END IF;
  IF _share_pct IS NULL OR _share_pct <= 0 OR _share_pct > 100 THEN
    RAISE EXCEPTION 'The share of work is above 0%% and at most 100%%. | نسبة العمل أكبر من 0%% ولا تتجاوز 100%%.' USING ERRCODE = '23514';
  END IF;
  IF p.kind = 'drawings_approval' AND (_submitted_on IS NULL OR _submitted_on > _approved_on) THEN
    RAISE EXCEPTION 'Give the date the drawings were submitted, on or before the approval. | أدخل تاريخ تقديم الرسومات، في يوم الاعتماد أو قبله.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('contract.terms', c.id::text, true);
  INSERT INTO public.contract_approvals (id, contract_id, payment_id, approved_on, share_pct, submitted_on, reference,
                                        document_path, note, recorded_by)
  VALUES (a_id, c.id, p.id, _approved_on, _share_pct, CASE WHEN p.kind = 'drawings_approval' THEN _submitted_on END,
          nullif(btrim(_reference), ''), nullif(btrim(_document_path), ''), nullif(btrim(_note), ''), u);
  PERFORM public._contract_add_due(p.id, a_id, _share_pct, _approved_on);
  -- The consultant delay: drawings days beyond those allowed, over every live drawings approval.
  SELECT coalesce(sum(greatest(0, a.approved_on - a.submitted_on - coalesce(c.drawings_days, 0))), 0)::int INTO delay
    FROM public.contract_approvals a JOIN public.contract_payments cp ON cp.id = a.payment_id
   WHERE a.contract_id = c.id AND cp.kind = 'drawings_approval' AND a.voided_at IS NULL;
  UPDATE public.contracts SET consultant_delay_days = delay WHERE id = c.id;
  PERFORM set_config('contract.terms', '', true);

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_approval.recorded', 'opportunity', c.opportunity_id,
          jsonb_build_object('contract_id', c.id, 'approval_id', a_id, 'kind', p.kind, 'share_pct', _share_pct));
  RETURN a_id;
END $$;
REVOKE ALL ON FUNCTION public.contract_approval_record(uuid, uuid, date, numeric, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_approval_record(uuid, uuid, date, numeric, date, text, text, text) TO authenticated;

-- 6. Void an approval (finance, with a reason). B3 refuses this once its due is invoiced.
CREATE OR REPLACE FUNCTION public.contract_approval_void(_approval_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); a public.contract_approvals; c public.contracts; r text := nullif(btrim(_reason), ''); delay int;
BEGIN
  IF NOT (coalesce(public.has_app_access(u), false) AND public.has_role(u, 'finance_manager'::public.app_role)) THEN
    RAISE EXCEPTION 'Finance voids an approval. | إلغاء الاعتماد للمالية.' USING ERRCODE = '42501';
  END IF;
  IF r IS NULL THEN RAISE EXCEPTION 'Say why. | اذكر السبب.' USING ERRCODE = '23514'; END IF;
  SELECT * INTO a FROM public.contract_approvals WHERE id = _approval_id FOR UPDATE;
  IF NOT FOUND OR a.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown or already voided approval. | اعتماد غير موجود أو ملغى.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM public.contracts WHERE id = a.contract_id FOR UPDATE;
  PERFORM set_config('contract.terms', c.id::text, true);
  UPDATE public.contract_approvals SET voided_at = now(), voided_by = u, void_reason = r WHERE id = a.id;
  UPDATE public.contract_dues SET status = 'void' WHERE approval_id = a.id;
  SELECT coalesce(sum(greatest(0, x.approved_on - x.submitted_on - coalesce(c.drawings_days, 0))), 0)::int INTO delay
    FROM public.contract_approvals x JOIN public.contract_payments cp ON cp.id = x.payment_id
   WHERE x.contract_id = c.id AND cp.kind = 'drawings_approval' AND x.voided_at IS NULL;
  UPDATE public.contracts SET consultant_delay_days = delay WHERE id = c.id;
  PERFORM set_config('contract.terms', '', true);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_approval.voided', 'opportunity', c.opportunity_id,
          jsonb_build_object('contract_id', c.id, 'approval_id', a.id));
  RETURN jsonb_build_object('id', a.id, 'voided', true);
END $$;
REVOKE ALL ON FUNCTION public.contract_approval_void(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_approval_void(uuid, text) TO authenticated;

-- 7. The schedule: each payment with its expected date (shifted by the consultant
-- delay for the payments after the drawings), what is due and when. Invoker: row
-- security on contracts and the child tables decides who reads it.
CREATE OR REPLACE VIEW public.contract_payment_schedule WITH (security_invoker = true) AS
SELECT p.id AS payment_id, p.contract_id, p.position, p.kind, p.label, p.pct, p.amount, p.expected_on,
       CASE WHEN p.kind IN ('mir','wir') AND p.expected_on IS NOT NULL
            THEN p.expected_on + c.consultant_delay_days ELSE p.expected_on END AS expected_on_adjusted,
       coalesce(d.share_due, 0)::numeric(6,3) AS share_due,
       coalesce(d.amount_due, 0)::numeric(16,2) AS amount_due,
       d.next_due_on
  FROM public.contract_payments p
  JOIN public.contracts c ON c.id = p.contract_id
  LEFT JOIN LATERAL (
    SELECT sum(x.share_pct) AS share_due, sum(x.amount) AS amount_due, min(x.due_on) AS next_due_on
      FROM public.contract_dues x WHERE x.payment_id = p.id AND x.status = 'open') d ON TRUE;
GRANT SELECT ON public.contract_payment_schedule TO authenticated;
