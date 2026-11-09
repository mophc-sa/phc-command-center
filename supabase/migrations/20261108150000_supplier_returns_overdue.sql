-- =============================================================================
-- Pricing loop PR 3, part 5: returned lines reopen alone; Zayed hears when the
-- supplier is late.
--
-- Returning lines (spec section 1: supplier_priced -> at_supplier, and
-- price_review -> at_supplier) goes through PR 1's pricing_file_move, so the
-- lock order, the note rule (kept in cost_note) and the return of the price
-- under review stay in one place. This RPC adds what the supplier needs: only
-- the chosen lines reopen, a new reply-by date, and an optional message the
-- supplier reads (the internal note stays internal).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pricing_return_lines_to_supplier(_file_id uuid, _boq_line_ids uuid[], _reply_by date,
  _note text, _message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; inv public.supplier_invitations; n integer;
        today date := public._pricing_today();
        -- The supplier reads this: control characters are stripped, newlines kept.
        msg text := nullif(btrim(regexp_replace(coalesce(_message, ''), '[\x01-\x09\x0B-\x1F\x7F]', '', 'g')), '');
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance send lines back to the supplier. | إرجاع البنود للمورد للتقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _boq_line_ids IS NULL OR cardinality(_boq_line_ids) = 0 OR cardinality(_boq_line_ids) > 2000
     OR (SELECT count(DISTINCT x) FROM unnest(_boq_line_ids) x) <> cardinality(_boq_line_ids) THEN
    RAISE EXCEPTION 'Choose the lines that go back (each once). | اختر البنود المُرجعة (كل بند مرة).' USING ERRCODE = '23514';
  END IF;
  IF _reply_by IS NULL OR _reply_by < today OR _reply_by > today + 180 THEN
    RAISE EXCEPTION 'The reply-by date is from today and within 180 days. | موعد الرد من اليوم وخلال 180 يوماً.' USING ERRCODE = '23514';
  END IF;
  IF char_length(btrim(coalesce(_note, ''))) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Say why the lines go back (up to 1000 characters). | اذكر سبب إرجاع البنود (حتى 1000 حرف).' USING ERRCODE = '23514';
  END IF;
  IF char_length(coalesce(msg, '')) > 1000 THEN
    RAISE EXCEPTION 'The message to the supplier is up to 1000 characters. | الرسالة للمورد حتى 1000 حرف.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state NOT IN ('supplier_priced','price_review') THEN
    RAISE EXCEPTION 'Lines go back to the supplier from cost review or price review. | تُرجع البنود للمورد من مراجعة التكلفة أو مراجعة السعر.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_invitations i
                  WHERE i.file_id = f.id AND i.boq_revision_id = f.boq_revision_id AND i.status = 'submitted') THEN
    RAISE EXCEPTION 'This file has no supplier request to return lines to; send it back with a note instead. | لا يوجد طلب مورد لإرجاع البنود إليه؛ أرجع الملف بملاحظة بدلاً من ذلك.' USING ERRCODE = 'P0001';
  END IF;

  -- PR 1's move: locks the file's price, then the file (estimation -> price ->
  -- file), checks the path, keeps the note in cost_note and returns the price
  -- under review. The request is locked after it, so the order is never
  -- file-then-price. The checks above are unlocked reads for clear errors; the
  -- ones below run again with the file and the request locked.
  PERFORM public.pricing_file_move(_file_id, 'at_supplier', _note);
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  SELECT * INTO inv FROM public.supplier_invitations i
   WHERE i.file_id = f.id AND i.boq_revision_id = f.boq_revision_id AND i.status = 'submitted'
   ORDER BY i.submitted_at DESC NULLS LAST, i.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This file has no supplier request to return lines to; send it back with a note instead. | لا يوجد طلب مورد لإرجاع البنود إليه؛ أرجع الملف بملاحظة بدلاً من ذلك.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_boq_line_ids) x
              WHERE NOT EXISTS (SELECT 1 FROM public.supplier_invitation_lines il
                                 WHERE il.invitation_id = inv.id AND il.boq_line_id = x)) THEN
    RAISE EXCEPTION 'A line is not in the supplier''s request. | أحد البنود ليس في طلب المورد.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.supplier_invitations
     SET status = 'reopened', reply_by = _reply_by, return_message = msg, updated_at = now()
   WHERE id = inv.id;
  UPDATE public.supplier_invitation_lines SET state = 'reopened'
   WHERE invitation_id = inv.id AND boq_line_id = ANY(_boq_line_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.lines_returned_to_supplier', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'invitation_id', inv.id, 'lines', n, 'reply_by', _reply_by));
  RETURN jsonb_build_object('invitation_id', inv.id, 'lines', n);
END $$;
REVOKE ALL ON FUNCTION public.pricing_return_lines_to_supplier(uuid, uuid[], date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_return_lines_to_supplier(uuid, uuid[], date, text, text) TO authenticated;

-- Zayed (estimation and finance) hears once per request and reply-by date when
-- the supplier is late. The Supplier tab also shows it on read.
CREATE OR REPLACE FUNCTION public.pricing_notify_overdue_suppliers()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0; today date := public._pricing_today();
BEGIN
  FOR r IN
    SELECT i.id, i.reply_by, i.project_code, f.id AS file_id, f.opportunity_id
      FROM public.supplier_invitations i
      JOIN public.pricing_files f ON f.id = i.file_id
     WHERE i.status IN ('sent','opened','reopened') AND f.state = 'at_supplier'
       AND f.boq_revision_id = i.boq_revision_id AND i.reply_by < today
  LOOP
    n := n + public.emit_notification_to_roles(
      ARRAY['estimation_manager','finance_manager']::public.app_role[],
      'pricing_supplier_overdue', 'opportunity', r.opportunity_id, r.project_code,
      'The supplier has not replied; the reply-by date was ' || r.reply_by::text || '.',
      'attention', 'supplier_reply_overdue', 'supplier_overdue:' || r.id || ':' || r.reply_by::text,
      jsonb_build_object('pricing_file_id', r.file_id));
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pricing_notify_overdue_suppliers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_notify_overdue_suppliers() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — the supplier overdue reminder is not scheduled.';
    RETURN;
  END IF;
  PERFORM cron.unschedule('pricing-supplier-overdue') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pricing-supplier-overdue');
  -- 05:15 UTC = 08:15 in Riyadh.
  PERFORM cron.schedule('pricing-supplier-overdue', '15 5 * * *', $job$ SELECT public.pricing_notify_overdue_suppliers(); $job$);
END $$;

-- =============================================================================
-- Closing what the supplier isolation sweep found (Task 5 fix round 1).
--
-- next_sales_code allocates the next free sales code and reads every profile's
-- code. Its only callers are the assign_sales_code trigger (SECURITY DEFINER,
-- runs as the owner) and the one-off backfill, so clients lose EXECUTE.
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.next_sales_code(text, text) FROM PUBLIC, anon, authenticated;

-- The archive helpers answer only to someone who may read the archive. A
-- session with no user (owner, service role, cron) still gets the answer: the
-- archive views and promote_historical_row call these with the reader's own
-- session, and both already require can_read_historical_sales (promotion's
-- approvers are a subset). Anyone else gets NULL.
CREATE OR REPLACE FUNCTION public.historical_collision_class(_row_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _m RECORD; _identical_earlier INT; _identical_later INT; _differing INT; _siblings INT;
        _uid UUID := auth.uid();
BEGIN
  IF _uid IS NOT NULL AND NOT public.can_read_historical_sales(_uid) THEN RETURN NULL; END IF;

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

  IF _m.revision_no IS NOT NULL THEN RETURN 'TRUE_REVISION'; END IF;

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

  SELECT count(*) INTO _differing
    FROM public.historical_sales_mapped s
   WHERE s.base_code = _m.base_code AND NOT s.code_placeholder AND s.row_id <> _row_id
     AND (lower(btrim(coalesce(s.client_name_raw,'')))  IS DISTINCT FROM lower(btrim(coalesce(_m.client_name_raw,'')))
       OR lower(btrim(coalesce(s.project_name_raw,''))) IS DISTINCT FROM lower(btrim(coalesce(_m.project_name_raw,''))));

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
                THEN 'EXACT_DUPLICATE_PRIMARY'
                ELSE 'DISTINCT_BUSINESS_PURSUIT' END;
  END IF;

  RETURN 'HUMAN_REVIEW_REQUIRED';
END; $$;

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
   WHERE m.row_id = _row_id
     AND (auth.uid() IS NULL OR public.can_read_historical_sales(auth.uid()));
$$;
