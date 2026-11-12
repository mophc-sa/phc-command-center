-- =============================================================================
-- Pricing loop, PR 5: the supplier quote check (spec decision 8b).
-- Mo, 2026-11-12: compare the frozen BOQ with the supplier's quote as data, with
-- no reading of drawings. The three checks asked for (a line with no price, a
-- screen line with no screen price, a spec change) plus a quantity that differs
-- from the BOQ are fixed rules, so they are rules here, not a model: the same
-- answer every time, testable, no provider and no function deploy. A quote in a
-- currency other than the BOQ's is refused by the 7B guard and never gets here.
-- As the spec says of the AI review: it only lists and notifies; it never moves
-- a file or a price. The supplier is not notified automatically (the spec waits
-- for Zayed to check the review first): Zayed returns the listed lines with a
-- prepared message through the existing return-lines path, after reading it.
-- =============================================================================

-- 1. The issues, per BOQ line of the file's current revision. Internal: the
-- notice runs it in the supplier's session, so it reads past row security; the
-- public wrapper below checks the caller. Same current-quote choice as
-- pricing_selling_grid (the newest current, live quote line for the line).
CREATE OR REPLACE FUNCTION public._pricing_quote_issues(_file_id uuid)
RETURNS TABLE (boq_line_id uuid, line_number integer, sign_type text, issues text[],
               boq_quantity numeric, quoted_quantity numeric, spec_note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lines AS (
    SELECT bl.id, bl.line_number, bl.sign_type, bl.quantity AS boq_quantity,
           coalesce(pl.use_screen_price, bl.has_screen) AS wants_screen,
           sq.id AS quote_line_id, sq.unit_cost, sq.unit_cost_with_screen,
           sq.quantity AS quoted_quantity, nullif(btrim(sq.alternate_spec), '') AS spec_note
      FROM public.pricing_files f
      JOIN public.boq_lines bl ON bl.revision_id = f.boq_revision_id
      LEFT JOIN public.pricing_file_lines pl ON pl.file_id = f.id AND pl.boq_line_id = bl.id
      LEFT JOIN LATERAL (
        SELECT l.id, l.unit_cost, l.unit_cost_with_screen, l.quantity, l.alternate_spec
          FROM public.supplier_quote_lines l
          JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
         WHERE l.boq_line_id = bl.id AND q.boq_revision_id = f.boq_revision_id
           AND q.is_current AND q.status NOT IN ('cancelled','superseded')
         ORDER BY q.created_at DESC, l.created_at DESC
         LIMIT 1) sq ON TRUE
     WHERE f.id = _file_id
  )
  SELECT l.id, l.line_number, l.sign_type,
         array_remove(ARRAY[
           CASE WHEN l.quote_line_id IS NULL OR l.unit_cost IS NULL THEN 'no_price' END,
           CASE WHEN l.unit_cost IS NOT NULL AND l.wants_screen AND l.unit_cost_with_screen IS NULL
                THEN 'screen_price_missing' END,
           CASE WHEN l.unit_cost IS NOT NULL AND l.quoted_quantity IS NOT NULL
                     AND l.quoted_quantity IS DISTINCT FROM l.boq_quantity THEN 'quantity_differs' END,
           CASE WHEN l.spec_note IS NOT NULL THEN 'spec_differs' END
         ], NULL),
         l.boq_quantity, l.quoted_quantity, l.spec_note
    FROM lines l
   WHERE l.quote_line_id IS NULL OR l.unit_cost IS NULL
      OR (l.wants_screen AND l.unit_cost_with_screen IS NULL)
      OR (l.quoted_quantity IS NOT NULL AND l.quoted_quantity IS DISTINCT FROM l.boq_quantity)
      OR l.spec_note IS NOT NULL
   ORDER BY l.line_number NULLS LAST, l.id;
$$;
REVOKE ALL ON FUNCTION public._pricing_quote_issues(uuid) FROM PUBLIC, anon, authenticated;

-- 2. The check for the screens: pricers, and cost readers who can read the deal
-- (the GM, the sales manager), as for the Cost review tab. No price column.
CREATE OR REPLACE FUNCTION public.pricing_quote_check(_file_id uuid)
RETURNS TABLE (boq_line_id uuid, line_number integer, sign_type text, issues text[],
               boq_quantity numeric, quoted_quantity numeric, spec_note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); opp uuid;
BEGIN
  SELECT opportunity_id INTO opp FROM public.pricing_files WHERE id = _file_id;
  IF NOT (public.is_pricer(u)
          OR (public.can_read_commercial_cost(u) AND opp IS NOT NULL AND public.can_read_boq(opp, u))) THEN
    RAISE EXCEPTION 'The quote check is for estimation, finance and cost readers. | فحص عرض المورد للتقدير والمالية ومن يقرأ التكلفة.'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._pricing_quote_issues(_file_id);
END $$;
REVOKE ALL ON FUNCTION public.pricing_quote_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_quote_check(uuid) TO authenticated;

-- 3. The notice when the supplier's prices arrive (portal submit, entry on
-- behalf or a pricer's move): counts only, to estimation and finance. Added to
-- the loop's notice trigger (20261110100000); the other branches are unchanged.
CREATE OR REPLACE FUNCTION public._pricing_quote_check_notice(_file_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (
    SELECT count(*) AS lines,
           count(*) FILTER (WHERE 'no_price' = ANY(issues)) AS no_price,
           count(*) FILTER (WHERE 'screen_price_missing' = ANY(issues)) AS no_screen,
           count(*) FILTER (WHERE 'quantity_differs' = ANY(issues)) AS qty,
           count(*) FILTER (WHERE 'spec_differs' = ANY(issues)) AS spec
      FROM public._pricing_quote_issues(_file_id))
  SELECT CASE WHEN c.lines = 0
    THEN 'Quote check: every line is priced as asked. | فحص عرض المورد: كل البنود مسعّرة كما طُلب.'
    ELSE format('Quote check: %s lines need attention (%s). | فحص عرض المورد: %s بنود تحتاج مراجعة (%s).',
      c.lines,
      concat_ws(', ',
        CASE WHEN c.no_price  > 0 THEN c.no_price  || ' without a price' END,
        CASE WHEN c.no_screen > 0 THEN c.no_screen || ' missing the screen price' END,
        CASE WHEN c.qty       > 0 THEN c.qty       || ' quantity differs' END,
        CASE WHEN c.spec      > 0 THEN c.spec      || ' spec differs' END),
      c.lines,
      concat_ws('، ',
        CASE WHEN c.no_price  > 0 THEN c.no_price  || ' بلا سعر' END,
        CASE WHEN c.no_screen > 0 THEN c.no_screen || ' بلا سعر الشاشة' END,
        CASE WHEN c.qty       > 0 THEN c.qty       || ' كمية مختلفة' END,
        CASE WHEN c.spec      > 0 THEN c.spec      || ' مواصفة مختلفة' END))
  END FROM c;
$$;
REVOKE ALL ON FUNCTION public._pricing_quote_check_notice(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._pricing_notify_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files; o record; meta jsonb;
BEGIN
  IF NEW.to_state NOT IN ('price_review','selling_build','approved','needs_info','supplier_priced') THEN RETURN NEW; END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = NEW.file_id;
  SELECT op.id, op.owner_id, coalesce(op.project_code, op.project_name, 'Pricing file') AS code
    INTO o FROM public.opportunities op WHERE op.id = f.opportunity_id;
  meta := jsonb_build_object('pricing_file_id', f.id);

  IF NEW.to_state = 'supplier_priced' THEN
    PERFORM public.emit_notification_to_roles(ARRAY['estimation_manager','finance_manager']::public.app_role[],
      'pricing_quote_check', 'opportunity', o.id, o.code,
      public._pricing_quote_check_notice(f.id),
      'info', 'pricing_quote_check', 'pricing_quote_check:' || NEW.id, meta);
  ELSIF NEW.to_state = 'price_review' THEN
    PERFORM public.emit_notification_to_roles(ARRAY['finance_manager']::public.app_role[],
      'pricing_price_review', 'opportunity', o.id, o.code,
      'A selling price is waiting for your review. | سعر بيع بانتظار مراجعتك.',
      'attention', 'pricing_price_review', 'pricing_review:' || NEW.id, meta);
  ELSIF NEW.to_state = 'selling_build' AND NEW.from_state = 'price_review' THEN
    PERFORM public.emit_notification_to_roles(ARRAY['general_manager']::public.app_role[],
      'pricing_price_returned', 'opportunity', o.id, o.code,
      'Finance returned the selling price; the reason is on the file. | أرجعت المالية سعر البيع؛ السبب في الملف.',
      'attention', 'pricing_price_returned', 'pricing_returned:' || NEW.id, meta);
  ELSIF NEW.to_state = 'approved' THEN
    PERFORM public.emit_notification_to_roles(ARRAY['bd_manager']::public.app_role[],
      'pricing_price_approved', 'opportunity', o.id, o.code,
      'The selling price is approved; issue the quotation. | اعتُمد سعر البيع؛ أصدر عرض السعر.',
      'info', 'pricing_price_approved', 'pricing_approved_bd:' || NEW.id, meta);
    IF o.owner_id IS NOT NULL THEN
      PERFORM public.emit_notification(o.owner_id,
        'pricing_price_approved', 'opportunity', o.id, o.code,
        'The selling price for your deal is approved. | اعتُمد سعر البيع لصفقتك.',
        'info', 'pricing_price_approved', 'pricing_approved_rep:' || NEW.id, meta);
    END IF;
  ELSIF NEW.to_state = 'needs_info' AND o.owner_id IS NOT NULL THEN
    PERFORM public.emit_notification(o.owner_id,
      'pricing_needs_info', 'opportunity', o.id, o.code,
      'Pricing needs information from you before it can continue. | التسعير يحتاج معلومات منك ليكمل.',
      'attention', 'pricing_needs_info', 'pricing_needs_info:' || NEW.id, meta);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._pricing_notify_event() FROM PUBLIC, anon, authenticated;
