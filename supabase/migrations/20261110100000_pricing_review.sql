-- =============================================================================
-- Pricing loop, PR 4 part 1: finance (Zayed) reviews the price the GM (Kalas) proposed.
-- The review moves the price; the file follows it (pricing_file_follow_price).
-- Who may approve stays in internal_price_transition_guard (finance, not the
-- proposer, not the figure's author, file in price_review). This RPC adds the
-- state check, the reason rule and the audit row, so the screen never writes
-- internal_prices directly.
-- Also: the loop's notifications (spec §2) as one trigger on the file's events,
-- and two rights the screens need.
-- =============================================================================

-- 1. Who may issue a quotation (spec §2: the BD manager; plan default: also the sales manager).
CREATE OR REPLACE FUNCTION public.can_issue_quotation(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.has_app_access(_user_id), false)
     AND public.has_any_role(_user_id, ARRAY['bd_manager','sales_manager']::public.app_role[]);
$$;
REVOKE ALL ON FUNCTION public.can_issue_quotation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_issue_quotation(uuid) TO authenticated;
COMMENT ON FUNCTION public.can_issue_quotation IS
  'Who issues and sends a quotation from an approved pricing file: the BD manager and the sales manager (PR 4 plan default).';

-- Finance, as the review checks it.
CREATE OR REPLACE FUNCTION public._pricing_is_finance_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.has_app_access(_user_id), false)
     AND public.has_role(_user_id, 'finance_manager'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public._pricing_is_finance_manager(uuid) FROM PUBLIC, anon, authenticated;

-- 2. Rights for the screens (adds is_finance and can_issue_quotation).
CREATE OR REPLACE FUNCTION public.pricing_my_rights()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'is_pricer',           coalesce(public.is_pricer(auth.uid()), false),
    'is_gm',               coalesce(public.can_approve_final_price(auth.uid()), false),
    'can_read_cost',       coalesce(public.can_read_commercial_cost(auth.uid()), false),
    'can_set_margins',     coalesce(public.can_set_pricing_margins(auth.uid()), false),
    'is_finance',          coalesce(public._pricing_is_finance_manager(auth.uid()), false),
    'can_issue_quotation', coalesce(public.can_issue_quotation(auth.uid()), false));
$$;
REVOKE ALL ON FUNCTION public.pricing_my_rights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_my_rights() TO authenticated;

-- 3. The review.
CREATE OR REPLACE FUNCTION public.pricing_file_review(_file_id uuid, _decision text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; r text := nullif(btrim(_reason), ''); price_id uuid;
BEGIN
  IF NOT public._pricing_is_finance_manager(u) THEN
    RAISE EXCEPTION 'Finance reviews the selling price. | مراجعة سعر البيع للمالية.' USING ERRCODE = '42501';
  END IF;
  IF _decision IS NULL OR _decision NOT IN ('approve','return') THEN
    RAISE EXCEPTION 'Choose approve or return. | اختر الاعتماد أو الإرجاع.' USING ERRCODE = '23514';
  END IF;
  IF _decision = 'return' AND r IS NULL THEN
    RAISE EXCEPTION 'A return needs a reason. | الإرجاع يحتاج سبباً.' USING ERRCODE = '23514';
  END IF;
  -- Lock order: the price, then the file (as pricing_file_move).
  SELECT internal_price_id INTO price_id FROM public.pricing_files WHERE id = _file_id;
  IF price_id IS NOT NULL THEN
    PERFORM 1 FROM public.internal_prices WHERE id = price_id FOR UPDATE;
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514'; END IF;
  IF f.state <> 'price_review' OR f.internal_price_id IS NULL OR f.internal_price_id IS DISTINCT FROM price_id THEN
    RAISE EXCEPTION 'There is no price waiting for review on this file. | لا يوجد سعر بانتظار المراجعة في هذا الملف.'
      USING ERRCODE = 'P0001';
  END IF;

  -- The guard decides whether this reviewer may make the move (and says why not).
  IF _decision = 'approve' THEN
    UPDATE public.internal_prices SET status = 'gm_approved' WHERE id = f.internal_price_id;
  ELSE
    UPDATE public.internal_prices SET status = 'returned', return_reason = r WHERE id = f.internal_price_id;
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.reviewed', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'internal_price_id', f.internal_price_id,
                             'decision', _decision, 'has_reason', r IS NOT NULL));
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_review(uuid, text, text) TO authenticated;

-- 4. Notifications (spec §2). One trigger on the append-only event log, so every
-- path that moves a file (an RPC, the follow trigger) notifies the same way.
-- Bodies carry no cost, margin or return reason: a notice can be forwarded.
-- The deal's code is the title (as in PR 3's overdue notice).
CREATE OR REPLACE FUNCTION public._pricing_notify_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files; o record; meta jsonb;
BEGIN
  IF NEW.to_state NOT IN ('price_review','selling_build','approved','needs_info') THEN RETURN NEW; END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = NEW.file_id;
  SELECT op.id, op.owner_id, coalesce(op.project_code, op.project_name, 'Pricing file') AS code
    INTO o FROM public.opportunities op WHERE op.id = f.opportunity_id;
  meta := jsonb_build_object('pricing_file_id', f.id);

  IF NEW.to_state = 'price_review' THEN
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
DROP TRIGGER IF EXISTS pricing_file_events_notify ON public.pricing_file_events;
CREATE TRIGGER pricing_file_events_notify AFTER INSERT ON public.pricing_file_events
  FOR EACH ROW EXECUTE FUNCTION public._pricing_notify_event();
