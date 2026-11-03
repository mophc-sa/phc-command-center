-- =============================================================================
-- Pricing loop PR 2, part 1: what a pricing file points at (spec 2026-11-03
-- §1, §5; AI_HANDOFF "PR 2 contract").
--
-- PR 1 left pricing_files.boq_revision_id / estimation_id / internal_price_id
-- unset outside fixtures, so no file could reach boq_frozen. This adds the one
-- way each link is made, each with the contract's checks:
--   * a revision attached in package review belongs to the file's deal;
--   * the estimation belongs to that revision, the price to that estimation,
--     and the price is at most internal_price_proposed when it is linked.
-- It also closes four PR 1 leftovers: open_pricing_file checks the RFQ is the
-- deal's; an RFQ moved to another deal no longer leaves the old file pointing
-- at it; the cost basis behind a price under review (or approved) is frozen;
-- and the screens get one call that says what the caller may do, plus a queue.
-- =============================================================================

-- 1. What the caller may do. The screens mirror it; SQL still decides.
CREATE OR REPLACE FUNCTION public.pricing_my_rights()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'is_pricer',     coalesce(public.is_pricer(auth.uid()), false),
    'is_gm',         coalesce(public.can_approve_final_price(auth.uid()), false),
    'can_read_cost', coalesce(public.can_read_commercial_cost(auth.uid()), false));
$$;
REVOKE ALL ON FUNCTION public.pricing_my_rights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_my_rights() TO authenticated;

-- 2. PR 1 deferred: the RFQ, when given, must be the deal's.
CREATE OR REPLACE FUNCTION public.open_pricing_file(_opportunity_id uuid, _rfq_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may open a pricing file. | فتح ملف التسعير يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opportunities WHERE id = _opportunity_id) THEN
    RAISE EXCEPTION 'Unknown deal. | الفرصة غير موجودة.' USING ERRCODE = '23514';
  END IF;
  IF _rfq_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.rfqs r WHERE r.id = _rfq_id AND r.opportunity_id = _opportunity_id) THEN
    RAISE EXCEPTION 'That RFQ belongs to another deal. | طلب التسعير هذا يخص فرصة أخرى.' USING ERRCODE = '23514';
  END IF;
  f := public._pricing_file_open(_opportunity_id, _rfq_id, u);
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.open_pricing_file(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_pricing_file(uuid, uuid) TO authenticated;

-- 3. PR 1 deferred: an RFQ moved from deal A to deal B. A's open file is
-- re-pointed to A's latest other live RFQ (or its link cleared); it is never
-- closed here, because whether A still needs a price is a pricer's call.
-- The trigger rfqs_open_pricing_file (20261103100000) stays as it is.
CREATE OR REPLACE FUNCTION public.pricing_file_on_rfq()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE other uuid; moved integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.opportunity_id IS NOT NULL THEN
    SELECT r.id INTO other FROM public.rfqs r
     WHERE r.opportunity_id = OLD.opportunity_id AND r.id <> NEW.id AND r.archived_at IS NULL
     ORDER BY r.created_at DESC, r.id DESC LIMIT 1;
    UPDATE public.pricing_files SET rfq_id = other, updated_at = now()
     WHERE opportunity_id = OLD.opportunity_id AND state <> 'closed' AND rfq_id = NEW.id;
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF moved > 0 THEN
      INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
              'pricing_file.rfq_repointed', 'opportunity', OLD.opportunity_id,
              jsonb_build_object('moved_rfq_id', NEW.id, 'rfq_id', other,
                                 'to_opportunity_id', NEW.opportunity_id));
    END IF;
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    PERFORM public._pricing_file_open(NEW.opportunity_id, NEW.id, NULL);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_on_rfq() FROM PUBLIC, anon, authenticated;

-- 4. Attach a BOQ revision during package review (an AI-extracted or hand-made
-- revision of this deal). BOQ import (next migration) attaches its own.
CREATE OR REPLACE FUNCTION public.pricing_file_attach_revision(_file_id uuid, _revision_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; r public.boq_revisions;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may attach a BOQ revision. | ربط إصدار الكميات يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state <> 'package_review' THEN
    RAISE EXCEPTION 'A BOQ revision is attached during package review. | يُربط إصدار الكميات أثناء دراسة الباكيج.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT r2.* INTO r FROM public.boq_revisions r2 JOIN public.boqs b ON b.id = r2.boq_id
   WHERE r2.id = _revision_id AND b.related_opportunity_id = f.opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That BOQ revision is not this deal''s. | إصدار الكميات هذا لا يخص هذه الفرصة.' USING ERRCODE = '23514';
  END IF;
  IF r.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'That BOQ revision was replaced by a newer one. | استُبدل إصدار الكميات هذا بإصدار أحدث.'
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.pricing_files SET boq_revision_id = r.id, updated_at = now()
   WHERE id = f.id RETURNING * INTO f;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.revision_attached', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'revision_id', r.id));
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_attach_revision(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_attach_revision(uuid, uuid) TO authenticated;

-- 5. Link the estimation and price the selling build creates. Internal: only
-- pricing_file_build_price (20261104150000) calls it. Every check of the PR 2
-- contract lives here, so no caller can link around them.
CREATE OR REPLACE FUNCTION public._pricing_file_link_price(_file_id uuid, _estimation_id uuid, _price_id uuid)
RETURNS public.pricing_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files; e public.estimations;
        p_est uuid; p_status public.internal_price_status;
BEGIN
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.boq_revision_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.boq_revisions r JOIN public.boqs b ON b.id = r.boq_id
        WHERE r.id = f.boq_revision_id AND b.related_opportunity_id = f.opportunity_id) THEN
    RAISE EXCEPTION 'The file''s BOQ revision is not its deal''s. | إصدار الكميات في الملف لا يخص فرصته.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO e FROM public.estimations WHERE id = _estimation_id;
  IF NOT FOUND OR e.boq_revision_id IS DISTINCT FROM f.boq_revision_id THEN
    RAISE EXCEPTION 'The estimation is not for this file''s BOQ revision. | التقدير لا يخص إصدار الكميات في هذا الملف.' USING ERRCODE = '23514';
  END IF;
  SELECT p.estimation_id, p.status INTO p_est, p_status FROM public.internal_prices p WHERE p.id = _price_id;
  IF NOT FOUND OR p_est IS DISTINCT FROM e.id THEN
    RAISE EXCEPTION 'The price is not for this estimation. | السعر لا يخص هذا التقدير.' USING ERRCODE = '23514';
  END IF;
  IF p_status NOT IN ('draft','cost_complete','internal_price_proposed') THEN
    RAISE EXCEPTION 'Only a draft or proposed price is linked to a file, never one under review or decided. | لا يُربط بالملف إلا سعر مسودة أو مقترح.'
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.pricing_files SET estimation_id = e.id, internal_price_id = _price_id, updated_at = now()
   WHERE id = f.id RETURNING * INTO f;
  RETURN f;
END $$;
REVOKE ALL ON FUNCTION public._pricing_file_link_price(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 6. PR 1 deferred: the cost basis is frozen while the file's price is under
-- review, and after it is approved, so what Zayed reviews and what is
-- approved are the cost Kalas priced from. Notes still save. Outside pricing
-- files nothing changes.
CREATE OR REPLACE FUNCTION public.estimation_frozen_under_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.cost_total, NEW.wastage_pct, NEW.installation_cost, NEW.overhead_pct, NEW.boq_revision_id)
       IS DISTINCT FROM (OLD.cost_total, OLD.wastage_pct, OLD.installation_cost, OLD.overhead_pct, OLD.boq_revision_id)
     AND EXISTS (SELECT 1 FROM public.internal_prices p
                   JOIN public.pricing_files pf ON pf.internal_price_id = p.id
                  WHERE p.estimation_id = NEW.id AND p.status IN ('gm_pending','gm_approved')) THEN
    RAISE EXCEPTION 'The cost behind a price under review or approved cannot change; return the price first. | لا تتغير التكلفة خلف سعر قيد المراجعة أو معتمد؛ أرجع السعر أولاً.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.estimation_frozen_under_review() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS estimations_frozen_under_review ON public.estimations;
CREATE TRIGGER estimations_frozen_under_review BEFORE UPDATE ON public.estimations
  FOR EACH ROW EXECUTE FUNCTION public.estimation_frozen_under_review();

-- 7. The pricing queue: every file with its deal's name, code, owner and
-- value fields (the screen computes the value with opportunityValue()). No
-- cost. Pricers and the GM read all; other cost readers read what they can
-- read of the deal. Reps and the BD manager read nothing here.
CREATE OR REPLACE VIEW public.pricing_queue AS
  SELECT f.id AS file_id, f.state, f.state_changed_at, f.created_at, f.due_at,
         f.needs_info_items, f.needs_info_due,
         f.opportunity_id, o.project_name, o.project_code, o.owner_id,
         o.contract_value, o.quotation_value, o.estimated_value_max,
         f.boq_revision_id, f.estimation_id, f.internal_price_id, f.closed_reason
    FROM public.pricing_files f
    JOIN public.opportunities o ON o.id = f.opportunity_id
   WHERE public.is_pricer((SELECT auth.uid()))
      OR public.can_approve_final_price((SELECT auth.uid()))
      OR (public.can_read_commercial_cost((SELECT auth.uid()))
          AND public.can_read_boq(f.opportunity_id, (SELECT auth.uid())));
REVOKE ALL ON public.pricing_queue FROM anon, authenticated;
GRANT SELECT ON public.pricing_queue TO authenticated;
COMMENT ON VIEW public.pricing_queue IS
  'Pricing files with their deal for the /pricing queue and the file header. No cost. Pricers and the GM read all; other cost readers what they can read of the deal.';
