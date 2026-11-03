-- =============================================================================
-- Pricing loop, part 2: the pricing file's path, enforced.
-- Anything not in pricing_file_transitions is refused, so a skip is an error
-- rather than a shortcut. 'pricer' = Zayed (is_pricer), 'gm' = Kalas
-- (can_approve_final_price): the supplier's prices go to Kalas, who sets the
-- price (Mo, 2026-11-03). 'system' moves are made by triggers only (Task 5 for
-- price_review/approved, PR 4 for quoted); RPC callers can never make them.
-- =============================================================================

CREATE OR REPLACE VIEW public.pricing_file_transitions AS
SELECT * FROM (VALUES
  ('received'::public.pricing_file_state,       'package_review'::public.pricing_file_state, 'pricer'),
  ('package_review',  'needs_info',      'rpc_needs_info'),
  ('needs_info',      'package_review',  'rpc_answer'),
  ('package_review',  'boq_frozen',      'pricer'),
  ('boq_frozen',      'at_supplier',     'pricer'),
  ('at_supplier',     'supplier_priced', 'pricer'),
  ('supplier_priced', 'at_supplier',     'pricer'),
  ('supplier_priced', 'selling_build',   'gm'),
  ('selling_build',   'price_review',    'system'),
  ('price_review',    'approved',        'system'),
  ('price_review',    'selling_build',   'system'),
  ('price_review',    'at_supplier',     'pricer'),
  ('approved',        'quoted',          'system'),
  ('quoted',          'boq_frozen',      'pricer')
) AS t(from_state, to_state, who);
GRANT SELECT ON public.pricing_file_transitions TO authenticated;

-- The one place a state changes. Callers pass who they are acting as.
-- Final review I4: a note on a move out of a cost stage is cost reasoning (which
-- supplier lines go back, why), so it is kept in cost_note, which reps cannot
-- read. A close keeps its reason readable: it is the deal's answer to "why did
-- pricing stop", and closed_reason on the file carries the same text.
CREATE OR REPLACE FUNCTION public._pricing_file_apply(_file public.pricing_files, _to public.pricing_file_state,
                                                       _actor uuid, _note text)
RETURNS public.pricing_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files; n text := nullif(btrim(coalesce(_note,'')), '');
        is_cost boolean := _file.state IN ('supplier_priced','selling_build','price_review') AND _to <> 'closed';
BEGIN
  UPDATE public.pricing_files
     SET state = _to, state_changed_at = now(), state_changed_by = _actor, updated_at = now(),
         closed_reason = CASE WHEN _to = 'closed' THEN n ELSE closed_reason END
   WHERE id = _file.id RETURNING * INTO f;
  INSERT INTO public.pricing_file_events (file_id, from_state, to_state, actor_id, note, cost_note)
  VALUES (f.id, _file.state, _to, _actor,
          CASE WHEN is_cost THEN NULL ELSE n END,
          CASE WHEN is_cost THEN n END);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (_actor, CASE WHEN _actor IS NULL THEN 'system' ELSE 'user' END, 'pricing_file.moved',
          'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'from', _file.state, 'to', _to));
  RETURN f;
END $$;
REVOKE ALL ON FUNCTION public._pricing_file_apply(public.pricing_files, public.pricing_file_state, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_move(_file_id uuid, _to public.pricing_file_state, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; rule text; price_id uuid;
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_approve_final_price(u)) THEN
    RAISE EXCEPTION 'Only estimation, finance or the GM may move a pricing file. | تحريك ملف التسعير يقتصر على التقدير أو المالية أو المدير العام.'
      USING ERRCODE = '42501';
  END IF;
  -- Lock order: the file's price, then the file. A price move takes them in that
  -- order (the UPDATE locks the price, its follow trigger then locks the file,
  -- Task 5), so taking them the other way here could deadlock against it.
  SELECT internal_price_id INTO price_id FROM public.pricing_files WHERE id = _file_id;
  IF price_id IS NOT NULL THEN
    PERFORM 1 FROM public.internal_prices WHERE id = price_id FOR UPDATE;
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514'; END IF;
  IF f.internal_price_id IS DISTINCT FROM price_id THEN
    RAISE EXCEPTION 'The pricing file changed while it was being moved; try again. | تغيّر ملف التسعير أثناء تحريكه؛ أعد المحاولة.';
  END IF;
  IF f.state = 'closed' THEN RAISE EXCEPTION 'This pricing file is closed. | ملف التسعير مغلق.'; END IF;

  IF _to = 'closed' THEN
    IF NOT public.is_pricer(u) THEN
      RAISE EXCEPTION 'Only estimation or finance may close a pricing file. | إغلاق ملف التسعير يقتصر على التقدير أو المالية.' USING ERRCODE = '42501';
    END IF;
    IF length(btrim(coalesce(_note,''))) = 0 THEN
      RAISE EXCEPTION 'Closing needs a reason. | الإغلاق يحتاج سبباً.';
    END IF;
    RETURN to_jsonb(public._pricing_file_apply(f, _to, u, _note));
  END IF;

  SELECT who INTO rule FROM public.pricing_file_transitions WHERE from_state = f.state AND to_state = _to;
  IF rule IS NULL OR rule NOT IN ('pricer','gm') THEN
    RAISE EXCEPTION 'Illegal pricing move % -> %. | انتقال غير مسموح في ملف التسعير.', f.state, _to;
  END IF;
  IF rule = 'pricer' AND NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'This step is estimation''s. | هذه الخطوة للتقدير والمالية.' USING ERRCODE = '42501';
  END IF;
  IF rule = 'gm' AND NOT public.can_approve_final_price(u) THEN
    RAISE EXCEPTION 'The GM sets the selling price. | سعر البيع يضعه المدير العام.' USING ERRCODE = '42501';
  END IF;

  IF _to = 'boq_frozen' AND NOT EXISTS (
       SELECT 1 FROM public.boq_revisions r WHERE r.id = f.boq_revision_id AND r.frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Freeze a BOQ revision on this file first. | جمّد إصدار جدول الكميات أولاً.';
  END IF;
  -- A client round needs a revision frozen AFTER the latest quote, i.e. a new one.
  IF f.state = 'quoted' AND _to = 'boq_frozen' AND NOT EXISTS (
       SELECT 1 FROM public.boq_revisions r
        WHERE r.id = f.boq_revision_id AND r.frozen_at IS NOT NULL
          AND r.frozen_at > (SELECT max(e.created_at) FROM public.pricing_file_events e
                              WHERE e.file_id = f.id AND e.to_state = 'quoted')) THEN
    RAISE EXCEPTION 'A client revision needs a new frozen BOQ revision. | مراجعة العميل تحتاج إصدار كميات جديداً مجمّداً.';
  END IF;
  IF _to = 'at_supplier' AND f.state IN ('supplier_priced','price_review') AND length(btrim(coalesce(_note,''))) = 0 THEN
    RAISE EXCEPTION 'Say which lines go back to the supplier. | اذكر الأسطر المُرجعة للمورد.';
  END IF;

  f := public._pricing_file_apply(f, _to, u, _note);
  -- Sending lines back from price review also returns Kalas's price; the
  -- follow trigger (Task 5) sees the file already at at_supplier and leaves it.
  IF _to = 'at_supplier' AND f.internal_price_id IS NOT NULL THEN
    UPDATE public.internal_prices SET status = 'returned', return_reason = _note
     WHERE id = f.internal_price_id AND status = 'gm_pending';
  END IF;
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_move(uuid, public.pricing_file_state, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_move(uuid, public.pricing_file_state, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_set_needs_info(_file_id uuid, _items text[], _due date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; clean text[];
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may ask for missing items. | طلب النواقص يقتصر على التقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(btrim(i)) INTO clean FROM unnest(coalesce(_items,'{}')) i WHERE length(btrim(i)) > 0;
  IF coalesce(array_length(clean,1),0) = 0 OR _due IS NULL OR _due < current_date THEN
    RAISE EXCEPTION 'List at least one missing item and a due date from today. | اذكر بنداً ناقصاً واحداً على الأقل وموعداً من اليوم.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND OR f.state <> 'package_review' THEN
    RAISE EXCEPTION 'Missing items can be asked during package review only. | النواقص تُطلب أثناء دراسة الباكيج فقط.';
  END IF;
  UPDATE public.pricing_files SET needs_info_items = clean, needs_info_due = _due WHERE id = f.id RETURNING * INTO f;
  RETURN to_jsonb(public._pricing_file_apply(f, 'needs_info', u, array_to_string(clean, '; ')));
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_set_needs_info(uuid, text[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_set_needs_info(uuid, text[], date) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_answer_needs_info(_file_id uuid, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files;
BEGIN
  -- Permission first, so an unknown id and a forbidden file look the same.
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  IF NOT FOUND OR NOT (public.is_pricer(u) OR (public.is_sales_contributor(u) AND public.can_read_boq(f.opportunity_id, u))) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF f.state <> 'needs_info' THEN RAISE EXCEPTION 'Nothing is waiting for an answer. | لا توجد نواقص بانتظار الرد.'; END IF;
  UPDATE public.pricing_files SET needs_info_due = NULL WHERE id = f.id RETURNING * INTO f;
  RETURN to_jsonb(public._pricing_file_apply(f, 'package_review', u, _note));
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_answer_needs_info(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_answer_needs_info(uuid, text) TO authenticated;
