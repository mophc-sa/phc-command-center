-- =============================================================================
-- Pricing loop PR 2 (moved from PR 3 with Mo's agreement): a pricer enters the
-- supplier's prices on their behalf.
--
-- Phase 7B froze supplier quotes with their BOQ revision: "a frozen BOQ
-- revision freezes everything priced against it". The pricing loop freezes the
-- quantities BEFORE the supplier prices them (boq_frozen -> at_supplier ->
-- supplier_priced), so no supplier price could ever be saved. The two guards
-- below are 7B's, verbatim, plus one exception: a write on a frozen revision is
-- admitted only when pricing_enter_supplier_quote has set the transaction-local
-- flag FOR THAT REVISION and the revision's pricing file is at_supplier. The
-- flag alone opens nothing, and a direct table write never sets it. Outside
-- pricing files (no pricing file, or a file in any other state) 7B behaves
-- exactly as before. The quantities stay frozen: boq_lines is untouched.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._pricing_supplier_entry_open(_revision_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _revision_id IS NOT NULL
     AND coalesce(current_setting('phc.pricing_supplier_entry', true), '') = _revision_id::text
     AND EXISTS (SELECT 1 FROM public.pricing_files f
                  WHERE f.boq_revision_id = _revision_id AND f.state = 'at_supplier');
$$;
REVOKE ALL ON FUNCTION public._pricing_supplier_entry_open(uuid) FROM PUBLIC, anon, authenticated;

-- Phase 7B's guard, verbatim except for _entry.
CREATE OR REPLACE FUNCTION public.supplier_quote_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE _boq_ccy CHAR(3); _rev UUID; _propagating BOOLEAN; _entry BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Supplier quotes cannot be deleted — supersede or cancel instead. | لا تُحذف عروض المورّدين.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  _rev := NEW.boq_revision_id;
  -- Set only by propagate_freeze_to_supplier_quotes(), transaction-local.
  _propagating := coalesce(current_setting('phc.freezing_boq_revision', true), '') = 'on';
  -- Set only by pricing_enter_supplier_quote(), for one revision, while its file is at the supplier.
  _entry := public._pricing_supplier_entry_open(_rev);

  IF NOT _propagating AND (
       NEW.frozen_at IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.frozen_at END)
    OR NEW.frozen_by IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.frozen_by END)) THEN
    RAISE EXCEPTION 'frozen_at/frozen_by are set by freezing the BOQ revision, not on the quote. | التجميد يتم على مراجعة الـBOQ.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A frozen BOQ revision freezes everything priced against it.
  IF NOT _propagating AND NOT _entry AND public.boq_revision_is_frozen(_rev) THEN
    RAISE EXCEPTION 'The BOQ revision is frozen; its supplier quotes cannot change. | مراجعة الـBOQ مجمّدة.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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

-- Phase 7B's line guard, verbatim except for the entry exception.
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

  IF public.boq_revision_is_frozen(_q.boq_revision_id)
     AND NOT public._pricing_supplier_entry_open(_q.boq_revision_id) THEN
    RAISE EXCEPTION 'The BOQ revision is frozen; its supplier lines cannot change.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The line must price a line of the SAME revision.
  SELECT l.revision_id INTO _line_rev FROM public.boq_lines l WHERE l.id = NEW.boq_line_id;
  IF _line_rev IS DISTINCT FROM _q.boq_revision_id THEN
    RAISE EXCEPTION 'This BOQ line belongs to a different revision than the supplier quote. | البند يخص مراجعة أخرى.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Selecting from a superseded quote would pin the estimate to a replaced price.
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

-- A bounded non-negative decimal as text: NULL/empty is fine (nothing entered);
-- otherwise digits with an optional fraction, below 10^_whole after rounding to _scale.
CREATE OR REPLACE FUNCTION public._pricing_supplier_num_ok(_t text, _whole integer, _scale integer)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _t IS NULL OR _t = '' THEN true
    WHEN _t !~ '^[0-9]+(\.[0-9]+)?$' OR char_length(_t) > 40 THEN false
    ELSE round(_t::numeric, _scale) < 10::numeric ^ _whole
  END;
$$;
REVOKE ALL ON FUNCTION public._pricing_supplier_num_ok(text, integer, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_enter_supplier_quote(_file_id uuid, _vendor_id uuid, _lines jsonb, _terms jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; q public.supplier_quotes; old_q public.supplier_quotes;
        ccy text; code text; n integer := 0; e record; bad_ord bigint; vday date; ccy_in text;
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
  -- Terms: lead time is whole days (0-9999), the date is a real date, text is bounded.
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

  -- Lock order: estimation -> price -> file. This RPC touches neither of the first two.
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
  IF EXISTS (SELECT 1 FROM public.supplier_quotes sq
              WHERE sq.boq_revision_id = f.boq_revision_id AND sq.is_current
                AND sq.status NOT IN ('cancelled','superseded') AND sq.vendor_id <> _vendor_id) THEN
    RAISE EXCEPTION 'This file already has another supplier''s prices; one supplier per file in this release. | لهذا الملف أسعار مورد آخر؛ مورد واحد لكل ملف في هذا الإصدار.' USING ERRCODE = 'P0001';
  END IF;

  SELECT b.currency INTO ccy FROM public.boq_revisions r JOIN public.boqs b ON b.id = r.boq_id WHERE r.id = f.boq_revision_id;
  SELECT o.project_code INTO code FROM public.opportunities o WHERE o.id = f.opportunity_id;
  -- Flag value = the one revision this call may write to.
  PERFORM set_config('phc.pricing_supplier_entry', f.boq_revision_id::text, true);

  SELECT * INTO old_q FROM public.supplier_quotes
   WHERE boq_revision_id = f.boq_revision_id AND vendor_id = _vendor_id AND is_current FOR UPDATE;
  IF FOUND AND old_q.status IN ('cancelled','superseded') THEN
    -- A dead quote: retire it and start a fresh one, so the grid never sees two.
    UPDATE public.supplier_quotes SET is_current = false WHERE id = old_q.id;
    old_q := NULL;
  END IF;

  IF old_q.id IS NULL THEN
    INSERT INTO public.supplier_quotes (boq_revision_id, vendor_id, rfq_reference, status, response_received_at, currency,
                                        lead_time_days, payment_terms, valid_until, notes, created_by,
                                        revision_number, supersedes_id)
    VALUES (f.boq_revision_id, _vendor_id, code, 'responses_received', now(), coalesce(ccy_in, 'SAR'),
            nullif(_terms->>'lead_time_days','')::integer, nullif(btrim(coalesce(_terms->>'payment_terms','')), ''),
            vday, 'Entered on behalf of the supplier', u,
            coalesce((SELECT max(s.revision_number) + 1 FROM public.supplier_quotes s
                       WHERE s.boq_revision_id = f.boq_revision_id AND s.vendor_id = _vendor_id), 1),
            (SELECT s.id FROM public.supplier_quotes s
              WHERE s.boq_revision_id = f.boq_revision_id AND s.vendor_id = _vendor_id
              ORDER BY s.revision_number DESC LIMIT 1))
    RETURNING * INTO q;
  ELSE
    -- Entering again corrects the same quote in place: still one current quote.
    UPDATE public.supplier_quotes
       SET response_received_at = now(),
           status = CASE WHEN status IN ('draft','sent') THEN 'responses_received'::public.supplier_quote_status ELSE status END,
           currency = coalesce(ccy_in, currency),
           lead_time_days = coalesce(nullif(_terms->>'lead_time_days','')::integer, lead_time_days),
           payment_terms  = coalesce(nullif(btrim(coalesce(_terms->>'payment_terms','')), ''), payment_terms),
           valid_until    = coalesce(vday, valid_until)
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

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.supplier_prices_entered', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'supplier_quote_id', q.id, 'vendor_id', _vendor_id,
                             'lines', n, 'currency', q.currency, 'on_behalf', true));
  RETURN jsonb_build_object('supplier_quote_id', q.id, 'lines', n);
END $$;
REVOKE ALL ON FUNCTION public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb) TO authenticated;
