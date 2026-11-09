-- =============================================================================
-- Pricing loop PR 3, part 4: the supplier submits; entry on behalf follows the request.
--
-- Submit writes a NEW supplier_quotes revision (Phase 7B's supersede pattern):
-- the vendor's previous current quote on the revision is superseded, so there
-- is always one current quote per vendor and the selling grid never counts two
-- (multi_quote_lines). Every line of the request gets a row: this round's
-- values for the open lines, the previous values for the locked ones. The
-- supplier confirms the spec's sentence; the text, the time and the exact file
-- versions are stored per submission. The request then locks, the file moves
-- at_supplier -> supplier_priced (the supplier is the actor), and Kalas and
-- Zayed are notified.
--
-- Entry on behalf (PR 2) now follows the request: it is refused for a vendor
-- other than the open request's, it closes the request as entered on behalf,
-- it keeps the supplier's original file (spec decision 4), and it supersedes a
-- portal quote instead of overwriting it, so what the supplier submitted stays
-- on record.
-- =============================================================================

ALTER TABLE public.supplier_quotes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal','portal','on_behalf')),
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.supplier_quotes.source IS
  'internal = Phase 7B (typed by estimation); portal = the supplier submitted it; on_behalf = a pricer entered the supplier''s prices (pricing_enter_supplier_quote). Rows before PR 3 stay internal.';
COMMENT ON COLUMN public.supplier_quotes.source_document_id IS
  'Entry on behalf: the supplier''s own Excel or PDF, attached to the deal.';

CREATE TABLE IF NOT EXISTS public.supplier_invitation_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id     uuid NOT NULL REFERENCES public.supplier_invitations(id) ON DELETE RESTRICT,
  supplier_quote_id uuid NOT NULL REFERENCES public.supplier_quotes(id) ON DELETE RESTRICT,
  source            text NOT NULL CHECK (source IN ('portal','on_behalf')),
  submitted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  confirmation_text text,
  confirmation_lang text CHECK (confirmation_lang IN ('en','ar')),
  confirmed_files   jsonb,
  lines             integer NOT NULL,
  CONSTRAINT sis_portal_confirmed CHECK (source <> 'portal'
    OR (confirmation_text IS NOT NULL AND confirmation_lang IS NOT NULL AND confirmed_files IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS supplier_invitation_submissions_invitation
  ON public.supplier_invitation_submissions (invitation_id, submitted_at);
ALTER TABLE public.supplier_invitation_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_invitation_submissions FROM anon, authenticated;
GRANT SELECT ON public.supplier_invitation_submissions TO authenticated;
GRANT ALL ON public.supplier_invitation_submissions TO service_role;
CREATE POLICY "Supplier submissions readable by pricers and cost readers" ON public.supplier_invitation_submissions
  FOR SELECT TO authenticated USING (public.is_pricer(auth.uid()) OR public.can_read_commercial_cost(auth.uid()));
CREATE POLICY audit_session_boundary ON public.supplier_invitation_submissions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- The sentence the supplier confirms (spec section 2). The client sends only the language.
CREATE OR REPLACE FUNCTION public.supplier_portal_confirmation(_lang text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _lang
    WHEN 'en' THEN 'My prices are based only on the files attached to this request; any material or spec difference is written on its line.'
    WHEN 'ar' THEN 'أسعاري مبنية فقط على الملفات المرفقة بهذا الطلب، وأي اختلاف في الخامة أو المواصفة مكتوب على سطره.'
  END;
$$;

CREATE OR REPLACE FUNCTION public.supplier_portal_submit(_invitation_id uuid, _lines jsonb, _terms jsonb, _confirm_lang text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); v uuid := public._supplier_session_vendor();
        inv public.supplier_invitations; f public.pricing_files; old_q public.supplier_quotes; q public.supplier_quotes;
        today date := public._pricing_today(); vday date; lead integer; pay text; bad_ord bigint;
        open_count integer; conf text; files jsonb; price_id uuid;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'Sign in to the supplier portal with two-step verification. | سجّل الدخول لبوابة المورد بالتحقق بخطوتين.' USING ERRCODE = '42501';
  END IF;
  conf := public.supplier_portal_confirmation(_confirm_lang);
  IF conf IS NULL THEN
    RAISE EXCEPTION 'Confirm that your prices are based only on the attached files. | أكّد أن أسعارك مبنية فقط على الملفات المرفقة.' USING ERRCODE = '23514';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 OR jsonb_array_length(_lines) > 2000
     OR _terms IS NULL OR jsonb_typeof(_terms) <> 'object' THEN
    RAISE EXCEPTION 'Send the lines and the terms. | أرسل البنود والشروط.' USING ERRCODE = '23514';
  END IF;
  -- Terms: all three are required from the portal.
  IF coalesce(_terms->>'lead_time_days', '') !~ '^[0-9]{1,4}$'
     OR jsonb_typeof(_terms->'payment_terms') IS DISTINCT FROM 'string'
     OR char_length(btrim(_terms->>'payment_terms')) NOT BETWEEN 1 AND 500
     OR coalesce(_terms->>'valid_until', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Give the lead time in whole days (up to 9999), the payment terms (up to 500 characters) and the valid-until date. | أدخل مدة التوريد بالأيام الكاملة (حتى 9999) وشروط الدفع (حتى 500 حرف) وتاريخ صلاحية العرض.'
      USING ERRCODE = '23514';
  END IF;
  BEGIN
    vday := (_terms->>'valid_until')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'The valid-until date does not exist. | تاريخ الصلاحية غير موجود.' USING ERRCODE = '23514';
  END;
  IF vday < today THEN
    RAISE EXCEPTION 'The valid-until date is today or later. | تاريخ الصلاحية اليوم أو بعده.' USING ERRCODE = '23514';
  END IF;
  lead := (_terms->>'lead_time_days')::integer;
  pay := btrim(_terms->>'payment_terms');
  SELECT x.ord INTO bad_ord FROM jsonb_array_elements(_lines) WITH ORDINALITY AS x(v, ord)
   WHERE jsonb_typeof(x.v) <> 'object'
      OR coalesce(x.v->>'line_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (x.v ? 'unit_cost' AND jsonb_typeof(x.v->'unit_cost') NOT IN ('number','string','null'))
      OR (x.v ? 'unit_cost_with_screen' AND jsonb_typeof(x.v->'unit_cost_with_screen') NOT IN ('number','string','null'))
      OR NOT public._pricing_supplier_num_ok(nullif(x.v->>'unit_cost',''), 12, 2)
      OR NOT public._pricing_supplier_num_ok(nullif(x.v->>'unit_cost_with_screen',''), 12, 2)
      OR (x.v ? 'spec_difference' AND jsonb_typeof(x.v->'spec_difference') NOT IN ('string','null'))
      OR char_length(coalesce(x.v->>'spec_difference','')) > 500
   ORDER BY x.ord LIMIT 1;
  IF bad_ord IS NOT NULL THEN
    RAISE EXCEPTION 'Line % is not valid: prices are numbers below 1,000,000,000,000 and the note is up to 500 characters. | السطر % غير صالح: الأسعار أرقام أقل من 1,000,000,000,000 والملاحظة حتى 500 حرف.', bad_ord, bad_ord
      USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT x.v->>'line_id') FROM jsonb_array_elements(_lines) x(v)) <> jsonb_array_length(_lines) THEN
    RAISE EXCEPTION 'A line appears twice. | بند مكرر.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) x(v) WHERE nullif(x.v->>'unit_cost','') IS NOT NULL) THEN
    RAISE EXCEPTION 'Price at least one line. | سعّر بنداً واحداً على الأقل.' USING ERRCODE = '23514';
  END IF;

  -- Lock order: estimation -> price -> file -> request. This RPC touches no
  -- estimation; a file that carries a price (it came back from review) locks that
  -- price before the file, as pricing_file_move does.
  SELECT * INTO inv FROM public.supplier_invitations i WHERE i.id = _invitation_id AND i.vendor_id = v AND i.status <> 'cancelled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This request is not available. | هذا الطلب غير متاح.' USING ERRCODE = '42501';
  END IF;
  SELECT pf.internal_price_id INTO price_id FROM public.pricing_files pf WHERE pf.id = inv.file_id;
  IF price_id IS NOT NULL THEN
    PERFORM 1 FROM public.internal_prices ip WHERE ip.id = price_id FOR UPDATE;
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = inv.file_id FOR UPDATE;
  IF f.internal_price_id IS DISTINCT FROM price_id THEN
    RAISE EXCEPTION 'The pricing file changed while it was being submitted; try again. | تغيّر ملف التسعير أثناء الإرسال؛ أعد المحاولة.';
  END IF;
  SELECT * INTO inv FROM public.supplier_invitations WHERE id = inv.id FOR UPDATE;
  IF NOT public._supplier_invitation_editable(inv) THEN
    RAISE EXCEPTION 'This request is closed; it can no longer be changed. | هذا الطلب مغلق ولا يمكن تغييره.' USING ERRCODE = 'P0001';
  END IF;
  -- The payload names exactly the lines this round may change.
  SELECT count(*) INTO open_count FROM public.supplier_invitation_lines il
   WHERE il.invitation_id = inv.id AND il.state IN ('open','reopened');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) x(v)
              WHERE NOT EXISTS (SELECT 1 FROM public.supplier_invitation_lines il
                                 WHERE il.id = (x.v->>'line_id')::uuid AND il.invitation_id = inv.id
                                   AND il.state IN ('open','reopened')))
     OR jsonb_array_length(_lines) <> open_count THEN
    RAISE EXCEPTION 'Send every open line of this request, priced or left empty, and no other line. | أرسل كل بند مفتوح في هذا الطلب، مسعّراً أو فارغاً، ولا بند غيره.'
      USING ERRCODE = '23514';
  END IF;

  -- line_cost is numeric(16,2): refuse a price times quantity that would not fit, naming the line.
  SELECT coalesce(bl.line_number, 0) INTO bad_ord FROM jsonb_array_elements(_lines) x(v)
    JOIN public.supplier_invitation_lines il ON il.id = (x.v->>'line_id')::uuid AND il.invitation_id = inv.id
    JOIN public.boq_lines bl ON bl.id = il.boq_line_id
   WHERE nullif(x.v->>'unit_cost','') IS NOT NULL
     AND abs(round(nullif(x.v->>'unit_cost','')::numeric * bl.quantity, 2)) >= 100000000000000
   ORDER BY bl.line_number NULLS LAST LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Line %: the price times the quantity is too large. | السطر %: السعر × الكمية أكبر من المسموح.', bad_ord, bad_ord
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('file_id', sf.id, 'document_id', sf.document_id, 'name', sf.display_name,
                                               'checksum', sf.checksum, 'object_version', sf.object_version,
                                               'object_updated_at', sf.object_updated_at) ORDER BY sf.display_name), '[]'::jsonb)
    INTO files FROM public.supplier_invitation_files sf WHERE sf.invitation_id = inv.id;

  -- PR 2's entry exception: this revision only, while its file is at the supplier.
  PERFORM set_config('phc.pricing_supplier_entry', inv.boq_revision_id::text, true);
  SELECT * INTO old_q FROM public.supplier_quotes sq
   WHERE sq.boq_revision_id = inv.boq_revision_id AND sq.vendor_id = v AND sq.is_current FOR UPDATE;
  IF FOUND THEN
    UPDATE public.supplier_quotes
       SET is_current = false,
           status = CASE WHEN status = 'cancelled' THEN status ELSE 'superseded'::public.supplier_quote_status END
     WHERE id = old_q.id;
  END IF;
  INSERT INTO public.supplier_quotes (boq_revision_id, vendor_id, rfq_reference, status, response_received_at, currency,
                                      lead_time_days, payment_terms, valid_until, notes, created_by,
                                      revision_number, supersedes_id, source)
  VALUES (inv.boq_revision_id, v, inv.project_code, 'responses_received', now(), 'SAR',
          lead, pay, vday, 'Submitted through the supplier portal', u,
          coalesce((SELECT max(s.revision_number) + 1 FROM public.supplier_quotes s
                     WHERE s.boq_revision_id = inv.boq_revision_id AND s.vendor_id = v), 1),
          old_q.id, 'portal')
  RETURNING * INTO q;
  -- Every line of the request: this round's values for the open lines, the
  -- previous live values for the locked ones.
  INSERT INTO public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, unit_cost_with_screen,
                                           alternate_spec, quantity, line_cost)
  SELECT q.id, s.boq_line_id, s.unit_cost, s.with_screen, s.spec, s.quantity, round(s.unit_cost * s.quantity, 2)
    FROM (
      SELECT il.boq_line_id, bl.quantity,
             CASE WHEN p.v IS NOT NULL THEN nullif(p.v->>'unit_cost','')::numeric(14,2) ELSE prev.unit_cost END AS unit_cost,
             CASE WHEN p.v IS NOT NULL THEN nullif(p.v->>'unit_cost_with_screen','')::numeric(14,2) ELSE prev.unit_cost_with_screen END AS with_screen,
             CASE WHEN p.v IS NOT NULL THEN nullif(btrim(coalesce(p.v->>'spec_difference','')), '') ELSE prev.alternate_spec END AS spec
        FROM public.supplier_invitation_lines il
        JOIN public.boq_lines bl ON bl.id = il.boq_line_id
        LEFT JOIN LATERAL (SELECT x.v FROM jsonb_array_elements(_lines) x(v) WHERE (x.v->>'line_id')::uuid = il.id) p ON true
        LEFT JOIN public.supplier_quote_lines prev
               ON prev.supplier_quote_id = old_q.id AND prev.boq_line_id = il.boq_line_id
              AND old_q.status NOT IN ('cancelled','superseded')
       WHERE il.invitation_id = inv.id) s;
  PERFORM set_config('phc.pricing_supplier_entry', '', true);

  UPDATE public.supplier_invitation_lines SET state = 'submitted' WHERE invitation_id = inv.id AND state IN ('open','reopened');
  UPDATE public.supplier_invitations
     SET status = 'submitted', submitted_at = now(), opened_at = coalesce(opened_at, now()), updated_at = now()
   WHERE id = inv.id;
  INSERT INTO public.supplier_invitation_submissions (invitation_id, supplier_quote_id, source, submitted_by,
                                                      confirmation_text, confirmation_lang, confirmed_files, lines)
  VALUES (inv.id, q.id, 'portal', u, conf, _confirm_lang, files, open_count);
  f := public._pricing_file_apply(f, 'supplier_priced', u, NULL);

  -- Kalas (the GM) and Zayed (estimation and finance): the supplier has priced.
  PERFORM public.emit_notification_to_roles(
    ARRAY['general_manager','estimation_manager','finance_manager']::public.app_role[],
    'pricing_supplier_submitted', 'opportunity', f.opportunity_id, inv.project_code,
    'The supplier submitted prices for ' || open_count || ' lines.', 'attention', 'supplier_quote_submitted',
    'supplier_submitted:' || q.id, jsonb_build_object('pricing_file_id', f.id));
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'supplier_portal.submitted', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'invitation_id', inv.id, 'supplier_quote_id', q.id, 'lines', open_count));
  RETURN jsonb_build_object('lines', open_count);
END $$;
REVOKE ALL ON FUNCTION public.supplier_portal_submit(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_portal_submit(uuid, jsonb, jsonb, text) TO authenticated;


-- PR 3 Task 4: the supplier reads its own submitted prices after the file has moved on.
-- Task 3's read hid everything once the file left at_supplier, which is exactly
-- what a submission does (at_supplier -> supplier_priced). Only the lines and the
-- supplier's own current quote are admitted (rd); files, the return message and
-- editing still need the request to be live.
CREATE OR REPLACE FUNCTION public.supplier_portal_invitation(_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.supplier_invitations := public._supplier_invitation_for_session(_invitation_id);
        ed boolean; lv boolean; rd boolean; q public.supplier_quotes;
BEGIN
  ed := public._supplier_invitation_editable(inv);
  lv := public._supplier_invitation_live(inv);
  -- Once submitted, the file moves on (supplier_priced and later). The supplier
  -- keeps reading ITS OWN prices and terms for that revision; the files, the
  -- return message and every edit still need a live request.
  rd := lv OR (inv.status = 'submitted' AND EXISTS (SELECT 1 FROM public.pricing_files f
                                                      WHERE f.id = inv.file_id AND f.boq_revision_id = inv.boq_revision_id));
  IF inv.status = 'sent' AND ed THEN
    UPDATE public.supplier_invitations SET status = 'opened', opened_at = now(), updated_at = now()
     WHERE id = inv.id RETURNING * INTO inv;
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    SELECT auth.uid(), 'user', 'supplier_portal.opened', 'opportunity', f.opportunity_id,
           jsonb_build_object('status', 'sent'),
           jsonb_build_object('invitation_id', inv.id, 'file_id', inv.file_id, 'status', 'opened')
      FROM public.pricing_files f WHERE f.id = inv.file_id;
  END IF;
  -- The supplier's own live quote for THIS request: one linked to a submission of
  -- this invitation (the portal's, or PHC's entry on its behalf for it). Never a
  -- pre-freeze Phase 7B quote PHC typed for the same vendor on the same revision.
  SELECT * INTO q FROM public.supplier_quotes sq
   WHERE rd AND sq.boq_revision_id = inv.boq_revision_id AND sq.vendor_id = inv.vendor_id
     AND sq.is_current AND sq.status NOT IN ('cancelled','superseded')
     AND EXISTS (SELECT 1 FROM public.supplier_invitation_submissions s
                  WHERE s.invitation_id = inv.id AND s.supplier_quote_id = sq.id);
  RETURN jsonb_build_object(
    'invitation_id', inv.id,
    'project_code', inv.project_code,
    'reply_by', inv.reply_by,
    'sent_at', inv.sent_at,
    'instructions', inv.instructions,
    'return_message', CASE WHEN inv.status = 'reopened' AND lv THEN inv.return_message END,
    'status', public._supplier_portal_status(inv),
    'editable', ed,
    'terms', jsonb_build_object('lead_time_days', q.lead_time_days, 'payment_terms', q.payment_terms,
                                'valid_until', q.valid_until),
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'line_id', il.id, 'line_number', bl.line_number, 'sign_type', bl.sign_type,
               'description', bl.description, 'dimensions', bl.dimensions, 'material', bl.material,
               'mounting', bl.mounting, 'illumination', bl.illumination, 'finish', bl.finish,
               'quantity', bl.quantity, 'unit', bl.unit, 'width_mm', bl.width_mm, 'height_mm', bl.height_mm,
               'has_screen', bl.has_screen, 'state', il.state,
               'editable', ed AND il.state IN ('open','reopened'),
               'unit_cost', ql.unit_cost, 'unit_cost_with_screen', ql.unit_cost_with_screen,
               'spec_difference', ql.alternate_spec)
             ORDER BY bl.line_number NULLS LAST, bl.sort_order NULLS LAST, il.id)
        FROM public.supplier_invitation_lines il
        JOIN public.boq_lines bl ON bl.id = il.boq_line_id
        LEFT JOIN public.supplier_quote_lines ql ON ql.supplier_quote_id = q.id AND ql.boq_line_id = il.boq_line_id
       WHERE rd AND il.invitation_id = inv.id), '[]'::jsonb),
    'files', coalesce((
      SELECT jsonb_agg(jsonb_build_object('file_id', sf.id, 'name', sf.display_name, 'size_bytes', sf.size_bytes,
                                          'mime_type', sf.mime_type) ORDER BY sf.display_name)
        FROM public.supplier_invitation_files sf WHERE lv AND sf.invitation_id = inv.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.supplier_portal_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_portal_invitation(uuid) TO authenticated;

-- Entry on behalf (PR 2, 20261104160000) with the request rules. A new
-- optional parameter, so the old signature is dropped first (an overload would
-- leave the old rules callable).
DROP FUNCTION IF EXISTS public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.pricing_enter_supplier_quote(_file_id uuid, _vendor_id uuid, _lines jsonb,
  _terms jsonb DEFAULT '{}'::jsonb, _document_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; q public.supplier_quotes; old_q public.supplier_quotes;
        carry public.supplier_quotes; inv public.supplier_invitations; code text; n integer := 0; e record; bad_ord bigint; vday date; ccy_in text;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance enter supplier prices. | أسعار المورد يُدخلها التقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _file_id IS NULL OR _vendor_id IS NULL THEN
    RAISE EXCEPTION 'Choose the file and the supplier. | اختر الملف والمورد.' USING ERRCODE = '23514';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 OR jsonb_array_length(_lines) > 2000
     OR _terms IS NULL OR jsonb_typeof(_terms) <> 'object' THEN
    RAISE EXCEPTION 'Give at least one line, and terms as lead time (days), payment terms, valid-until date and currency. | أدخل بنداً واحداً على الأقل، والشروط: مدة التوريد بالأيام وشروط الدفع وتاريخ الصلاحية والعملة.' USING ERRCODE = '23514';
  END IF;
  IF coalesce(nullif(_terms->>'lead_time_days',''), '0') !~ '^[0-9]{1,4}$'
     OR (_terms ? 'payment_terms' AND jsonb_typeof(_terms->'payment_terms') NOT IN ('string','null'))
     OR char_length(coalesce(_terms->>'payment_terms','')) > 500
     OR (_terms ? 'valid_until' AND jsonb_typeof(_terms->'valid_until') NOT IN ('string','null'))
     OR coalesce(nullif(_terms->>'valid_until',''), '2000-01-01') !~ '^\d{4}-\d{2}-\d{2}$'
     OR (_terms ? 'currency' AND jsonb_typeof(_terms->'currency') NOT IN ('string','null'))
     OR coalesce(nullif(_terms->>'currency',''), 'SAR') !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'The terms are not valid: lead time in whole days (up to 9999), payment terms up to 500 characters, a valid-until date (YYYY-MM-DD) and a 3-letter currency. | الشروط غير صالحة: مدة التوريد بالأيام الكاملة (حتى 9999)، وشروط الدفع حتى 500 حرف، وتاريخ صلاحية (YYYY-MM-DD)، وعملة من 3 أحرف.' USING ERRCODE = '23514';
  END IF;
  BEGIN
    vday := nullif(_terms->>'valid_until','')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'The valid-until date does not exist. | تاريخ الصلاحية غير موجود.' USING ERRCODE = '23514';
  END;
  ccy_in := nullif(_terms->>'currency','');

  SELECT x.ord INTO bad_ord FROM jsonb_array_elements(_lines) WITH ORDINALITY AS x(v, ord)
   WHERE jsonb_typeof(x.v) <> 'object'
      OR coalesce(x.v->>'boq_line_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (x.v ? 'unit_cost' AND jsonb_typeof(x.v->'unit_cost') NOT IN ('number','string','null'))
      OR (x.v ? 'unit_cost_with_screen' AND jsonb_typeof(x.v->'unit_cost_with_screen') NOT IN ('number','string','null'))
      OR NOT public._pricing_supplier_num_ok(nullif(x.v->>'unit_cost',''), 12, 2)
      OR NOT public._pricing_supplier_num_ok(nullif(x.v->>'unit_cost_with_screen',''), 12, 2)
      OR (x.v ? 'alternate_spec' AND jsonb_typeof(x.v->'alternate_spec') NOT IN ('string','null'))
      OR char_length(coalesce(x.v->>'alternate_spec','')) > 500
   ORDER BY x.ord LIMIT 1;
  IF bad_ord IS NOT NULL THEN
    RAISE EXCEPTION 'Line % is not valid: prices are numbers below 1,000,000,000,000 and the spec note is up to 500 characters. | السطر % غير صالح: الأسعار أرقام أقل من 1,000,000,000,000 وملاحظة المواصفة حتى 500 حرف.', bad_ord, bad_ord USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT x.v->>'boq_line_id') FROM jsonb_array_elements(_lines) x(v)) <> jsonb_array_length(_lines) THEN
    RAISE EXCEPTION 'A BOQ line appears twice. | بند من الكميات مكرر.' USING ERRCODE = '23514';
  END IF;

  -- Lock order: estimation -> price -> file -> request. This RPC touches neither of the first two.
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state <> 'at_supplier' THEN
    RAISE EXCEPTION 'Supplier prices are entered while the file is at the supplier. | تُدخل أسعار المورد والملف عند المورد.' USING ERRCODE = 'P0001';
  END IF;
  IF f.boq_revision_id IS NULL OR NOT public.boq_revision_is_frozen(f.boq_revision_id) THEN
    RAISE EXCEPTION 'The file has no frozen BOQ revision. | لا توجد مراجعة كميات مجمّدة للملف.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) x(v)
              WHERE NOT EXISTS (SELECT 1 FROM public.boq_lines l
                                 WHERE l.id = (x.v->>'boq_line_id')::uuid AND l.revision_id = f.boq_revision_id)) THEN
    RAISE EXCEPTION 'A line is not in this file''s BOQ. | أحد البنود ليس في كميات هذا الملف.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = _vendor_id) THEN
    RAISE EXCEPTION 'Unknown supplier. | المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  -- PR 3: the open request names the file's supplier.
  SELECT * INTO inv FROM public.supplier_invitations i
   WHERE i.file_id = f.id AND i.boq_revision_id = f.boq_revision_id
     AND i.status IN ('sent','opened','reopened') FOR UPDATE;
  IF FOUND AND inv.vendor_id <> _vendor_id THEN
    RAISE EXCEPTION 'This file was sent to another supplier through the portal; cancel that request first. | أُرسل هذا الملف لمورد آخر عبر البوابة؛ ألغِ ذلك الطلب أولاً.' USING ERRCODE = 'P0001';
  END IF;
  -- PR 3: the supplier's original file, attached to this deal or its RFQ.
  IF _document_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.documents dd
         JOIN public.document_links l ON l.document_id = dd.id AND l.unlinked_at IS NULL
        WHERE dd.id = _document_id AND dd.deleted_at IS NULL
          AND ((l.entity_type = 'opportunity' AND l.entity_id = f.opportunity_id)
            OR (l.entity_type = 'rfq' AND f.rfq_id IS NOT NULL AND l.entity_id = f.rfq_id))) THEN
    RAISE EXCEPTION 'The supplier''s file is not attached to this deal. | ملف المورد ليس مرفقاً بهذه الفرصة.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_quotes sq
              WHERE sq.boq_revision_id = f.boq_revision_id AND sq.is_current
                AND sq.status NOT IN ('cancelled','superseded') AND sq.vendor_id <> _vendor_id) THEN
    RAISE EXCEPTION 'This file already has another supplier''s prices; one supplier per file in this release. | لهذا الملف أسعار مورد آخر؛ مورد واحد لكل ملف في هذا الإصدار.' USING ERRCODE = 'P0001';
  END IF;

  SELECT o.project_code INTO code FROM public.opportunities o WHERE o.id = f.opportunity_id;
  PERFORM set_config('phc.pricing_supplier_entry', f.boq_revision_id::text, true);

  SELECT * INTO old_q FROM public.supplier_quotes
   WHERE boq_revision_id = f.boq_revision_id AND vendor_id = _vendor_id AND is_current FOR UPDATE;
  -- A dead quote is retired; a portal quote is superseded so the supplier's own submission stays on record.
  -- The supplier's own terms (lead time, payment terms, validity) carry forward
  -- from that portal quote unless the pricer gives new ones.
  IF FOUND AND (old_q.status IN ('cancelled','superseded') OR old_q.source = 'portal') THEN
    IF old_q.source = 'portal' AND old_q.status NOT IN ('cancelled','superseded') THEN
      carry := old_q;
    END IF;
    UPDATE public.supplier_quotes
       SET is_current = false,
           status = CASE WHEN status IN ('cancelled','superseded') THEN status ELSE 'superseded'::public.supplier_quote_status END
     WHERE id = old_q.id;
    old_q := NULL;
  END IF;

  IF old_q.id IS NULL THEN
    INSERT INTO public.supplier_quotes (boq_revision_id, vendor_id, rfq_reference, status, response_received_at, currency,
                                        lead_time_days, payment_terms, valid_until, notes, created_by,
                                        revision_number, supersedes_id, source, source_document_id)
    VALUES (f.boq_revision_id, _vendor_id, code, 'responses_received', now(), coalesce(ccy_in, 'SAR'),
            coalesce(nullif(_terms->>'lead_time_days','')::integer, carry.lead_time_days),
            coalesce(nullif(btrim(coalesce(_terms->>'payment_terms','')), ''), carry.payment_terms),
            coalesce(vday, carry.valid_until), 'Entered on behalf of the supplier', u,
            coalesce((SELECT max(s.revision_number) + 1 FROM public.supplier_quotes s
                       WHERE s.boq_revision_id = f.boq_revision_id AND s.vendor_id = _vendor_id), 1),
            (SELECT s.id FROM public.supplier_quotes s
              WHERE s.boq_revision_id = f.boq_revision_id AND s.vendor_id = _vendor_id
              ORDER BY s.revision_number DESC LIMIT 1),
            'on_behalf', _document_id)
    RETURNING * INTO q;
  ELSE
    -- Entering again corrects the same quote in place: still one current quote.
    UPDATE public.supplier_quotes
       SET response_received_at = now(),
           status = CASE WHEN status IN ('draft','sent') THEN 'responses_received'::public.supplier_quote_status ELSE status END,
           currency = coalesce(ccy_in, currency),
           lead_time_days = coalesce(nullif(_terms->>'lead_time_days','')::integer, lead_time_days),
           payment_terms  = coalesce(nullif(btrim(coalesce(_terms->>'payment_terms','')), ''), payment_terms),
           valid_until    = coalesce(vday, valid_until),
           source = 'on_behalf',
           source_document_id = coalesce(_document_id, source_document_id)
     WHERE id = old_q.id RETURNING * INTO q;
  END IF;

  FOR e IN
    SELECT (x.v->>'boq_line_id')::uuid AS line_id,
           nullif(x.v->>'unit_cost','')::numeric(14,2) AS unit_cost,
           nullif(x.v->>'unit_cost_with_screen','')::numeric(14,2) AS with_screen,
           nullif(btrim(coalesce(x.v->>'alternate_spec','')), '') AS alt
      FROM jsonb_array_elements(_lines) x(v)
  LOOP
    UPDATE public.supplier_quote_lines l
       SET unit_cost = e.unit_cost, unit_cost_with_screen = e.with_screen, alternate_spec = e.alt,
           quantity = bl.quantity, line_cost = round(e.unit_cost * bl.quantity, 2)
      FROM public.boq_lines bl
     WHERE l.supplier_quote_id = q.id AND l.boq_line_id = e.line_id AND bl.id = e.line_id;
    IF NOT FOUND THEN
      INSERT INTO public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, unit_cost_with_screen,
                                               alternate_spec, quantity, line_cost)
      SELECT q.id, bl.id, e.unit_cost, e.with_screen, e.alt, bl.quantity, round(e.unit_cost * bl.quantity, 2)
        FROM public.boq_lines bl WHERE bl.id = e.line_id;
    END IF;
    n := n + 1;
  END LOOP;
  -- This call replaces the entry: a line it no longer prices is cleared (rows are never deleted).
  UPDATE public.supplier_quote_lines l
     SET unit_cost = NULL, unit_cost_with_screen = NULL, alternate_spec = NULL, line_cost = NULL
   WHERE l.supplier_quote_id = q.id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) x(v) WHERE (x.v->>'boq_line_id')::uuid = l.boq_line_id)
     AND (l.unit_cost IS NOT NULL OR l.unit_cost_with_screen IS NOT NULL OR l.alternate_spec IS NOT NULL);
  PERFORM set_config('phc.pricing_supplier_entry', '', true);

  -- PR 3: an open request for this supplier closes as entered on behalf.
  IF inv.id IS NOT NULL THEN
    UPDATE public.supplier_invitation_lines SET state = 'submitted' WHERE invitation_id = inv.id AND state IN ('open','reopened');
    UPDATE public.supplier_invitations SET status = 'submitted', submitted_at = now(), updated_at = now() WHERE id = inv.id;
    INSERT INTO public.supplier_invitation_submissions (invitation_id, supplier_quote_id, source, submitted_by, lines)
    VALUES (inv.id, q.id, 'on_behalf', u, n);
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.supplier_prices_entered', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'supplier_quote_id', q.id, 'vendor_id', _vendor_id,
                             'lines', n, 'currency', q.currency, 'on_behalf', true,
                             'invitation_id', inv.id, 'document_id', _document_id));
  RETURN jsonb_build_object('supplier_quote_id', q.id, 'lines', n);
END $$;
REVOKE ALL ON FUNCTION public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb, uuid) TO authenticated;
