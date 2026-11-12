-- =============================================================================
-- Commercial & Finance part 2, B4: variation orders and executed quantities
-- (design docs/superpowers/specs/2026-11-12-contract-variations-design.md).
-- A variation is priced through the pricing loop as a file of its own beside the
-- deal's main file; the client's acceptance adds its value, a `variation`
-- payment and its lines to the approved contract. At close-out the rep records
-- the executed quantity per contract line; the final payment is reduced by the
-- shortfall of the contract's own lines.
-- =============================================================================

-- 1. Variation files beside the main one.
ALTER TABLE public.pricing_files
  ADD COLUMN IF NOT EXISTS variation_contract_id uuid REFERENCES public.contracts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS variation_number integer CHECK (variation_number IS NULL OR variation_number >= 1),
  ADD COLUMN IF NOT EXISTS variation_accepted_at timestamptz;
ALTER TABLE public.pricing_files DROP CONSTRAINT IF EXISTS pricing_files_variation_numbered;
ALTER TABLE public.pricing_files ADD CONSTRAINT pricing_files_variation_numbered
  CHECK ((variation_contract_id IS NULL) = (variation_number IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS pricing_files_variation_number ON public.pricing_files (variation_contract_id, variation_number)
  WHERE variation_contract_id IS NOT NULL;
DROP INDEX IF EXISTS public.pricing_files_one_open_per_deal;
CREATE UNIQUE INDEX IF NOT EXISTS pricing_files_one_open_main_per_deal
  ON public.pricing_files (opportunity_id) WHERE state <> 'closed' AND variation_contract_id IS NULL;

-- The RFQ path opens and finds the main file only (same body, the new predicate).
CREATE OR REPLACE FUNCTION public._pricing_file_open(_opportunity_id uuid, _rfq_id uuid, _actor uuid)
RETURNS public.pricing_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files;
BEGIN
  SELECT * INTO f FROM public.pricing_files
   WHERE opportunity_id = _opportunity_id AND state <> 'closed' AND variation_contract_id IS NULL FOR UPDATE;
  IF FOUND THEN RETURN f; END IF;
  INSERT INTO public.pricing_files (opportunity_id, rfq_id, opened_by, state_changed_by)
  VALUES (_opportunity_id, _rfq_id, _actor, _actor)
  ON CONFLICT (opportunity_id) WHERE state <> 'closed' AND variation_contract_id IS NULL DO NOTHING
  RETURNING * INTO f;
  IF NOT FOUND THEN
    SELECT * INTO f FROM public.pricing_files
     WHERE opportunity_id = _opportunity_id AND state <> 'closed' AND variation_contract_id IS NULL FOR UPDATE;
    RETURN f;
  END IF;
  INSERT INTO public.pricing_file_events (file_id, from_state, to_state, actor_id, note)
  VALUES (f.id, NULL, 'received', _actor, CASE WHEN _actor IS NULL THEN 'Opened with the RFQ' END);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (_actor, CASE WHEN _actor IS NULL THEN 'system' ELSE 'user' END, 'pricing_file.opened',
          'opportunity', _opportunity_id, jsonb_build_object('file_id', f.id, 'rfq_id', _rfq_id));
  RETURN f;
END $$;
REVOKE ALL ON FUNCTION public._pricing_file_open(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 2. Payments and lines of variations; executed quantities.
ALTER TABLE public.contract_payments DROP CONSTRAINT IF EXISTS contract_payments_kind_check;
ALTER TABLE public.contract_payments ADD CONSTRAINT contract_payments_kind_check
  CHECK (kind IN ('advance','drawings_approval','mir','wir','other','variation'));
ALTER TABLE public.contract_payments
  ADD COLUMN IF NOT EXISTS variation_file_id uuid REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS amount_before_executed numeric(16,2);
ALTER TABLE public.contract_lines
  ADD COLUMN IF NOT EXISTS variation_file_id uuid REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS executed_quantity numeric(14,3) CHECK (executed_quantity IS NULL OR executed_quantity >= 0);

-- 3. The quotation of a variation has its own header (the rest of the PR 4 body is unchanged).
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

  -- B4: the file's own quotation header (a variation has its own, <code>-VO<n>), or a new one.
  SELECT r.quotation_id INTO q_id FROM public.quotation_revisions r
   WHERE r.pricing_file_id = f.id ORDER BY r.created_at DESC LIMIT 1;
  IF q_id IS NULL THEN
    INSERT INTO public.quotations (quote_number, related_opportunity_id, owner_id, value, currency, status, created_by)
    VALUES (coalesce(nullif(btrim(o.project_code), ''), 'Q-' || left(o.id::text, 8))
              || CASE WHEN f.variation_contract_id IS NOT NULL THEN '-VO' || f.variation_number ELSE '' END,
            o.id, o.owner_id, p.proposed_price, 'SAR', 'draft', u)
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

-- 4. Open a variation (deal owner or pipeline operator, approved contract).
CREATE OR REPLACE FUNCTION public.contract_variation_open(_contract_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); c public.contracts; n int; b uuid := gen_random_uuid(); rv uuid := gen_random_uuid();
        f public.pricing_files; r text := nullif(btrim(_reason), ''); code text;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_record_contract_terms(c.opportunity_id, u) THEN
    RAISE EXCEPTION 'The deal owner or the sales or BD manager opens a variation. | يفتح أمرَ التغيير صاحبُ الصفقة أو مدير المبيعات أو تطوير الأعمال.' USING ERRCODE = '42501';
  END IF;
  IF c.terms_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'A variation is opened on an approved contract. | يُفتح أمر التغيير على عقد معتمد.' USING ERRCODE = 'P0001';
  END IF;
  IF r IS NULL OR char_length(r) > 1000 THEN
    RAISE EXCEPTION 'Say what the variation is for. | اذكر سبب أمر التغيير.' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(max(variation_number), 0) + 1 INTO n FROM public.pricing_files WHERE variation_contract_id = c.id;
  INSERT INTO public.boqs (id, related_opportunity_id, title) VALUES (b, c.opportunity_id, 'VO-' || n);
  INSERT INTO public.boq_revisions (id, boq_id, revision_number, status, source_type, notes, created_by, is_current)
  VALUES (rv, b, 1, 'draft', 'manual', 'Variation ' || n || ': ' || left(r, 200), u, true);
  INSERT INTO public.pricing_files (opportunity_id, variation_contract_id, variation_number, boq_revision_id, opened_by, state_changed_by)
  VALUES (c.opportunity_id, c.id, n, rv, u, u) RETURNING * INTO f;
  INSERT INTO public.pricing_file_events (file_id, from_state, to_state, actor_id, note)
  VALUES (f.id, NULL, 'received', u, 'VO-' || n || ': ' || r);
  SELECT coalesce(project_code, project_name) INTO code FROM public.opportunities WHERE id = c.opportunity_id;
  PERFORM public.emit_notification_to_roles(ARRAY['estimation_manager','finance_manager']::public.app_role[],
    'pricing_variation_opened', 'opportunity', c.opportunity_id, code || ' VO-' || n,
    'A variation needs pricing. | أمر تغيير يحتاج تسعيراً.', 'attention', 'pricing_variation_opened',
    'variation_opened:' || f.id, jsonb_build_object('pricing_file_id', f.id));
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_variation.opened', 'opportunity', c.opportunity_id,
          jsonb_build_object('contract_id', c.id, 'file_id', f.id, 'number', n));
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.contract_variation_open(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_variation_open(uuid, text) TO authenticated;

-- 5. The client accepts the variation's quotation.
CREATE OR REPLACE FUNCTION public.contract_variation_accept(_file_id uuid, _accepted_on date, _client_reference text, _document_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; c public.contracts; qr public.quotation_revisions; pos int; base int; code text;
BEGIN
  -- Permission first, so an unknown file and a forbidden one look the same.
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  SELECT * INTO c FROM public.contracts WHERE id = f.variation_contract_id FOR UPDATE;
  IF f.id IS NULL OR c.id IS NULL OR NOT public.can_record_contract_terms(c.opportunity_id, u) THEN
    RAISE EXCEPTION 'The deal owner or the sales or BD manager records the client''s acceptance. | يسجّل موافقة العميل صاحبُ الصفقة أو مدير المبيعات أو تطوير الأعمال.' USING ERRCODE = '42501';
  END IF;
  IF f.variation_accepted_at IS NOT NULL OR f.state <> 'quoted' THEN
    RAISE EXCEPTION 'Only a quoted variation, once. | أمر تغيير صدر عرضه، مرة واحدة.' USING ERRCODE = 'P0001';
  END IF;
  IF _accepted_on IS NULL OR _accepted_on > current_date THEN
    RAISE EXCEPTION 'The acceptance date is today or earlier. | تاريخ الموافقة اليوم أو قبله.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO qr FROM public.quotation_revisions
   WHERE pricing_file_id = f.id AND is_current AND status IN ('approved','submitted') ORDER BY created_at DESC LIMIT 1;
  IF qr.id IS NULL THEN
    RAISE EXCEPTION 'The variation has no quotation for the client. | لا يوجد عرض سعر لأمر التغيير.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('contract.terms', c.id::text, true);
  SELECT coalesce(max(position), 0) + 1 INTO pos FROM public.contract_payments WHERE contract_id = c.id;
  INSERT INTO public.contract_payments (contract_id, position, kind, label, pct, amount, variation_file_id)
  VALUES (c.id, pos, 'variation', 'VO-' || f.variation_number, 100, qr.subtotal_excl_vat, f.id);
  SELECT coalesce(max(line_number), 0) INTO base FROM public.contract_lines WHERE contract_id = c.id;
  INSERT INTO public.contract_lines (contract_id, line_number, description, quantity, unit, line_total, variation_file_id)
  SELECT c.id, base + row_number() OVER (ORDER BY l.line_number), l.description, l.quantity, l.unit, l.line_total, f.id
    FROM public.quotation_revision_lines l WHERE l.revision_id = qr.id;
  UPDATE public.contracts SET contract_value = contract_value + qr.subtotal_excl_vat WHERE id = c.id;
  PERFORM set_config('contract.terms', '', true);
  UPDATE public.pricing_files SET variation_accepted_at = now() WHERE id = f.id;
  SELECT coalesce(project_code, project_name) INTO code FROM public.opportunities WHERE id = c.opportunity_id;
  PERFORM public.emit_notification_to_roles(ARRAY['finance_manager']::public.app_role[],
    'contract_variation_accepted', 'opportunity', c.opportunity_id, code || ' VO-' || f.variation_number,
    'The client accepted a variation; it is added to the contract. | وافق العميل على أمر تغيير وأُضيف للعقد.', 'info',
    'contract_variation_accepted', 'variation_accepted:' || f.id, jsonb_build_object('contract_id', c.id, 'pricing_file_id', f.id));
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_variation.accepted', 'opportunity', c.opportunity_id,
          jsonb_build_object('contract_id', c.id, 'file_id', f.id, 'client_reference', nullif(btrim(_client_reference), ''),
                             'document_path', nullif(btrim(_document_path), ''), 'accepted_on', _accepted_on));
  RETURN jsonb_build_object('contract_id', c.id, 'payment_position', pos);
END $$;
REVOKE ALL ON FUNCTION public.contract_variation_accept(uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_variation_accept(uuid, date, text, text) TO authenticated;

-- 6. Executed quantities (close-out). The final payment is the last base WIR
-- payment (else the last base payment); it must have nothing due yet.
CREATE OR REPLACE FUNCTION public.contract_executed_record(_contract_id uuid, _lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); c public.contracts; x jsonb; l public.contract_lines; e numeric; fin public.contract_payments;
        shortfall numeric;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_record_contract_terms(c.opportunity_id, u) THEN
    RAISE EXCEPTION 'The deal owner or the sales or BD manager records executed quantities. | يسجّل الكميات المنفذة صاحبُ الصفقة أو مدير المبيعات أو تطوير الأعمال.' USING ERRCODE = '42501';
  END IF;
  IF c.terms_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'On an approved contract. | على عقد معتمد.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO fin FROM public.contract_payments WHERE contract_id = c.id AND variation_file_id IS NULL
   ORDER BY (kind = 'wir') DESC, position DESC LIMIT 1 FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.contract_dues WHERE payment_id = fin.id AND status = 'open') THEN
    RAISE EXCEPTION 'The final payment is already due; record executed quantities before its approval. | الدفعة النهائية مستحقة؛ سجّل الكميات المنفذة قبل اعتمادها.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_lines) <> 'array' THEN RAISE EXCEPTION 'Lines expected. | البنود مطلوبة.' USING ERRCODE = '23514'; END IF;
  PERFORM set_config('contract.terms', c.id::text, true);
  FOR x IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO l FROM public.contract_lines WHERE id = (x->>'line_id')::uuid AND contract_id = c.id AND variation_file_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'A line is not one of this contract''s own. | بند ليس من بنود هذا العقد.' USING ERRCODE = '23514'; END IF;
    e := (x->>'executed')::numeric;
    IF e IS NULL OR e < 0 OR e > l.quantity THEN
      RAISE EXCEPTION 'Executed is between 0 and the contract quantity (%); more needs a variation. | المنفذ بين 0 والكمية المتعاقد عليها (%)؛ الزيادة تحتاج أمر تغيير.',
        l.quantity, l.quantity USING ERRCODE = '23514';
    END IF;
    UPDATE public.contract_lines SET executed_quantity = e WHERE id = l.id;
  END LOOP;
  SELECT coalesce(sum(cl.line_total - round(cl.line_total * coalesce(cl.executed_quantity, cl.quantity) / cl.quantity, 2)), 0)
    INTO shortfall FROM public.contract_lines cl WHERE cl.contract_id = c.id AND cl.variation_file_id IS NULL;
  IF shortfall > coalesce(fin.amount_before_executed, fin.amount) THEN
    RAISE EXCEPTION 'The shortfall (%) is more than the final payment; finance must settle it. | النقص (%) أكبر من الدفعة النهائية؛ تسويه المالية.',
      shortfall, shortfall USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.contract_payments SET amount_before_executed = coalesce(amount_before_executed, amount),
         amount = coalesce(amount_before_executed, amount) - shortfall
   WHERE id = fin.id;
  PERFORM set_config('contract.terms', '', true);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'contract_executed.recorded', 'opportunity', c.opportunity_id,
          jsonb_build_object('contract_id', c.id, 'shortfall', shortfall));
  RETURN jsonb_build_object('contract_id', c.id, 'shortfall', shortfall);
END $$;
REVOKE ALL ON FUNCTION public.contract_executed_record(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_executed_record(uuid, jsonb) TO authenticated;

-- 7. What was executed, against the contract (invoker: the contract's row security decides).
CREATE OR REPLACE VIEW public.contract_execution_summary WITH (security_invoker = true) AS
SELECT c.id AS contract_id, c.opportunity_id, c.contract_value,
       coalesce(sum(round(l.line_total * coalesce(l.executed_quantity, l.quantity) / l.quantity, 2)), 0)::numeric(16,2) AS executed_value,
       coalesce(sum(l.line_total - round(l.line_total * coalesce(l.executed_quantity, l.quantity) / l.quantity, 2))
                FILTER (WHERE l.variation_file_id IS NULL), 0)::numeric(16,2) AS shortfall,
       coalesce(sum(l.line_total) FILTER (WHERE l.variation_file_id IS NOT NULL), 0)::numeric(16,2) AS variations_value,
       bool_or(l.executed_quantity IS NOT NULL) AS executed_recorded
  FROM public.contracts c
  LEFT JOIN public.contract_lines l ON l.contract_id = c.id
 WHERE c.terms_status = 'approved'
 GROUP BY c.id;
GRANT SELECT ON public.contract_execution_summary TO authenticated;

-- 8. Left to invoice follows the payments (a variation adds one; executed quantities reduce the final one).
CREATE OR REPLACE VIEW public.contract_billing_summary WITH (security_invoker = true) AS
SELECT c.id AS contract_id, c.opportunity_id, c.contract_value,
       coalesce(inv.excl, 0)::numeric(16,2) AS invoiced_excl_vat,
       (coalesce(pay.total, 0) - coalesce(inv.excl, 0))::numeric(16,2) AS left_to_invoice,
       coalesce(inv.incl, 0)::numeric(16,2) AS invoiced_incl_vat,
       coalesce(rec.received, 0)::numeric(16,2) AS received,
       (coalesce(inv.incl, 0) - coalesce(rec.received, 0))::numeric(16,2) AS outstanding,
       coalesce(late.amount, 0)::numeric(16,2) AS late_outstanding,
       coalesce(ni.n, 0)::int AS dues_not_invoiced,
       coalesce(ni.amount, 0)::numeric(16,2) AS amount_not_invoiced
  FROM public.contracts c
  LEFT JOIN LATERAL (SELECT sum(p.amount) AS total FROM public.contract_payments p WHERE p.contract_id = c.id) pay ON TRUE
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

-- 9. The queue tells a variation file from the main one (columns appended; the rest unchanged from 20261104100000).
CREATE OR REPLACE VIEW public.pricing_queue AS
  SELECT f.id AS file_id, f.state, f.state_changed_at, f.created_at, f.due_at,
         f.needs_info_items, f.needs_info_due,
         f.opportunity_id, o.project_name, o.project_code, o.owner_id,
         CASE WHEN public.can_view_all_sales_data((SELECT auth.uid()))
                OR o.owner_id = (SELECT auth.uid()) THEN o.contract_value END AS contract_value,
         CASE WHEN public.can_view_all_sales_data((SELECT auth.uid()))
                OR o.owner_id = (SELECT auth.uid()) THEN o.quotation_value END AS quotation_value,
         CASE WHEN public.can_view_all_sales_data((SELECT auth.uid()))
                OR o.owner_id = (SELECT auth.uid()) THEN o.estimated_value_max END AS estimated_value_max,
         f.boq_revision_id, f.estimation_id, f.internal_price_id, f.closed_reason,
         f.variation_number, f.variation_contract_id
    FROM public.pricing_files f
    JOIN public.opportunities o ON o.id = f.opportunity_id
   WHERE public.is_pricer((SELECT auth.uid()))
      OR (public.can_approve_final_price((SELECT auth.uid()))
          AND (public.can_view_all_sales_data((SELECT auth.uid()))
               OR public.can_read_boq(f.opportunity_id, (SELECT auth.uid()))))
      OR (public.can_read_commercial_cost((SELECT auth.uid()))
          AND public.can_read_boq(f.opportunity_id, (SELECT auth.uid())));
REVOKE ALL ON public.pricing_queue FROM anon, authenticated;
GRANT SELECT ON public.pricing_queue TO authenticated;
