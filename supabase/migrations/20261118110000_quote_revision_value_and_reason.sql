-- =============================================================================
-- Quotation revisions (Omar's CRM review, point 9; Mo, 2026-11-18):
-- 1. Each revision keeps the reason it changed from the previous one
--    (change_reason), entered when the revision is recorded as sent.
-- 2. The deal's value is the CURRENT SENT revision, excluding VAT: recording a
--    revision as sent sets opportunities.quotation_value to its
--    subtotal_excl_vat. Earlier revisions keep their figures, so a 1,000,000
--    quotation revised to 900,000 shows 900,000 with the 1,000,000 kept.
--    Sending a revision does not move the sales stage.
-- The deal-value guard lets this one write through (phc.quote_value), because
-- the people allowed to send a quotation are the ones who priced it.
-- =============================================================================

ALTER TABLE public.quotation_revisions ADD COLUMN IF NOT EXISTS change_reason text;
COMMENT ON COLUMN public.quotation_revisions.change_reason IS
  'Why this revision differs from the previous one (scope, discount, client request), recorded when it is sent.';

CREATE OR REPLACE FUNCTION public.protect_opportunity_money()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND coalesce(current_setting('phc.quote_value', true), '') <> 'on'
     AND (NEW.quotation_value     IS DISTINCT FROM OLD.quotation_value
       OR NEW.estimated_value_min IS DISTINCT FROM OLD.estimated_value_min
       OR NEW.estimated_value_max IS DISTINCT FROM OLD.estimated_value_max
       OR NEW.contract_value      IS DISTINCT FROM OLD.contract_value)
     AND NOT public.can_edit_total_value(auth.uid()) THEN
    RAISE EXCEPTION 'Only Finance or the BD Manager may change a deal''s values (estimate, quotation, contract). | تعديل قيم الفرصة (التقدير، عرض السعر، العقد) يقتصر على الماليّة أو مدير التطوير.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.pricing_mark_quotation_sent(uuid);
CREATE OR REPLACE FUNCTION public.pricing_mark_quotation_sent(_revision_id uuid, _change_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); r public.quotation_revisions; opp uuid;
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
  UPDATE public.quotation_revisions
     SET status = 'submitted', change_reason = coalesce(nullif(btrim(_change_reason), ''), change_reason)
   WHERE id = r.id RETURNING * INTO r;
  UPDATE public.quotations SET status = 'submitted', issued_date = coalesce(issued_date, public._pricing_today())
   WHERE id = r.quotation_id
  RETURNING related_opportunity_id INTO opp;
  -- The current sent revision is the deal's value, excluding VAT.
  IF opp IS NOT NULL AND r.subtotal_excl_vat IS NOT NULL THEN
    PERFORM set_config('phc.quote_value', 'on', true);
    UPDATE public.opportunities SET quotation_value = r.subtotal_excl_vat
     WHERE id = opp AND quotation_value IS DISTINCT FROM r.subtotal_excl_vat;
    PERFORM set_config('phc.quote_value', '', true);
  END IF;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'quotation_revision.submitted', 'quotation_revision', r.id,
          jsonb_build_object('revision_number', r.revision_number, 'pricing_file_id', r.pricing_file_id,
                             'subtotal_excl_vat', r.subtotal_excl_vat, 'change_reason', r.change_reason, 'opportunity_id', opp));
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.pricing_mark_quotation_sent(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_mark_quotation_sent(uuid, text) TO authenticated;
