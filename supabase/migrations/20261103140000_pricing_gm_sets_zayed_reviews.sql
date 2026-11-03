-- =============================================================================
-- Pricing loop, part 5: Kalas sets the price, Zayed reviews it (Mo, 2026-11-03).
-- The supplier's prices go to the GM, who builds and proposes the selling price;
-- his propose is the move to gm_pending, so the Phase 8 floor guard still runs.
-- Zayed's review then completes it: for a price that belongs to a pricing file,
-- gm_approved is finance's, and only for a price the authority proposed. The
-- old chain stays legal outside pricing files. The file follows its price.
--
-- The guard is now SECURITY DEFINER (like the Phase 8 triggers on this table):
-- whether a price is in a pricing file, and whether that file has an open
-- suggestion, must not depend on what the caller's RLS lets them see. A GM
-- delegate who is not a cost holder cannot read pricing_file_extras, and a
-- check run as that caller would find no suggestion and wave the price through.
-- Every rule in it reads auth.uid() from the request, which SECURITY DEFINER
-- does not change.
-- =============================================================================

-- 2026-11-03: facts about a price, read past RLS. Internal to the guard.
CREATE OR REPLACE FUNCTION public._pricing_price_in_file(_internal_price_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.pricing_files pf WHERE pf.internal_price_id = _internal_price_id);
$$;
REVOKE ALL ON FUNCTION public._pricing_price_in_file(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._pricing_price_has_open_extras(_internal_price_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.pricing_files pf
                   JOIN public.pricing_file_extras x ON x.file_id = pf.id
                  WHERE pf.internal_price_id = _internal_price_id AND x.status = 'suggested');
$$;
REVOKE ALL ON FUNCTION public._pricing_price_has_open_extras(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.internal_price_transition_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _ok BOOLEAN := FALSE; _uid UUID := auth.uid(); _in_file BOOLEAN;
BEGIN
  -- 2026-11-03: is this price on the pricing-loop path?
  _in_file := public._pricing_price_in_file(NEW.id);

  -- 2026-11-03: a price under review is frozen, including in the statement that
  -- decides it, so what is approved is what was proposed. Return it to change it.
  IF OLD.status = 'gm_pending' AND (
       NEW.proposed_price IS DISTINCT FROM OLD.proposed_price
       OR NEW.estimation_id IS DISTINCT FROM OLD.estimation_id
       OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by) THEN
    RAISE EXCEPTION 'A price under review cannot change; return it first. | لا يُعدَّل سعر قيد المراجعة؛ أرجعه أولاً.';
  END IF;

  IF NEW.status = OLD.status THEN
    NEW.updated_at := now();
    RETURN NEW;                       -- an edit that is not a transition
  END IF;

  IF OLD.status = 'gm_approved' THEN
    RAISE EXCEPTION 'An approved price is final; propose a new price instead. | السعر المعتمد نهائي — اقترح سعرًا جديدًا.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The chain. Anything not listed is refused, so a skip is an error rather
  -- than a shortcut somebody takes under pressure.
  _ok := (OLD.status, NEW.status) IN (
    ('draft','cost_complete'),
    ('cost_complete','internal_price_proposed'),
    ('internal_price_proposed','commercial_review'),
    ('commercial_review','finance_review'),
    ('gm_pending','gm_approved'),
    ('returned','internal_price_proposed')
  )
  -- 2026-11-03: review is entered by Kalas's propose in a pricing file, and by
  -- finance's review outside one, never the other way round.
  OR (OLD.status = 'internal_price_proposed' AND NEW.status = 'gm_pending' AND _in_file)
  OR (OLD.status = 'finance_review' AND NEW.status = 'gm_pending' AND NOT _in_file)
  OR (NEW.status = 'returned' AND OLD.status <> 'gm_approved');

  IF NOT _ok THEN
    IF _in_file AND NEW.status = 'gm_pending' THEN
      RAISE EXCEPTION 'In a pricing file the GM proposes the price for review. | في ملف التسعير يقترح المدير العام السعر للمراجعة.'
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'Illegal price transition % -> %. The chain is draft, cost_complete, internal_price_proposed, commercial_review, finance_review, gm_pending, gm_approved. | انتقال غير مسموح.',
      OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  -- Who may make each move. The database decides, not the button.
  -- 2026-11-03: who completes a price. Outside pricing files: the GM, as before.
  -- Inside: finance, reviewing a price the authority set, never its own.
  IF NEW.status = 'gm_approved' THEN
    IF _in_file THEN
      IF NOT (public.has_role(_uid, 'finance_manager'::public.app_role)
              AND public.can_approve_final_price(OLD.proposed_by)
              AND OLD.proposed_by IS DISTINCT FROM _uid) THEN
        RAISE EXCEPTION 'Finance reviews and approves the price the GM set. | المالية تراجع وتعتمد السعر الذي وضعه المدير العام.'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF NOT public.can_approve_final_price(_uid) THEN
      RAISE EXCEPTION 'Only the General Manager, or an active delegate, may approve a final price. | اعتماد السعر النهائي يقتصر على المدير العام أو مفوّض ساري.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.status = 'finance_review'
     AND _uid IS NOT NULL
     AND NOT public.has_role(_uid, 'finance_manager'::public.app_role) THEN
    RAISE EXCEPTION 'Only finance may take a price into finance review.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- 2026-11-03: the one-step propose is the GM's, never with an undecided extra.
  IF OLD.status = 'internal_price_proposed' AND NEW.status = 'gm_pending' THEN
    IF NOT public.can_approve_final_price(_uid) THEN
      RAISE EXCEPTION 'The GM sets and proposes the selling price. | سعر البيع يضعه ويقترحه المدير العام.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF public._pricing_price_has_open_extras(NEW.id) THEN
      RAISE EXCEPTION 'Accept or dismiss every suggested item before proposing. | اقبل أو ارفض كل بند مقترح قبل اقتراح السعر.';
    END IF;
  END IF;
  IF NEW.status = 'commercial_review'
     AND _uid IS NOT NULL
     AND NOT public.is_pipeline_operator(_uid) THEN
    RAISE EXCEPTION 'Only a pipeline operator may take a price into commercial review.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Stamp who did what, from the session rather than from the payload.
  IF NEW.status = 'commercial_review' THEN
    NEW.commercial_reviewed_by := _uid; NEW.commercial_reviewed_at := now();
  ELSIF NEW.status = 'finance_review' THEN
    NEW.finance_reviewed_by := _uid;    NEW.finance_reviewed_at := now();
  ELSIF NEW.status = 'gm_approved' AND _in_file THEN
    -- 2026-11-03: Kalas's price, Zayed's review.
    NEW.finance_reviewed_by := _uid;    NEW.finance_reviewed_at := now();
    NEW.gm_decided_by := OLD.proposed_by; NEW.gm_decided_at := now();
  ELSIF NEW.status IN ('gm_approved','returned') THEN
    NEW.gm_decided_by := _uid;          NEW.gm_decided_at := now();
  ELSIF NEW.status = 'gm_pending' AND OLD.status = 'internal_price_proposed' THEN
    -- 2026-11-03: Kalas's propose makes him the proposer; the approval rule above
    -- trusts proposed_by, so it comes from the session, never the payload.
    NEW.proposed_by := _uid;            NEW.proposed_at := now();
  ELSIF NEW.status = 'internal_price_proposed' THEN
    NEW.proposed_by := coalesce(NEW.proposed_by, _uid);
    NEW.proposed_at := coalesce(NEW.proposed_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.internal_price_transition_guard() FROM PUBLIC, anon, authenticated;

-- 2026-11-03: the pricing file follows its price.
CREATE OR REPLACE FUNCTION public.pricing_file_follow_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files; target public.pricing_file_state;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  target := CASE NEW.status WHEN 'gm_pending' THEN 'price_review'
                            WHEN 'gm_approved' THEN 'approved'
                            WHEN 'returned' THEN 'selling_build' END;
  IF target IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO f FROM public.pricing_files WHERE internal_price_id = NEW.id AND state <> 'closed' FOR UPDATE;
  IF NOT FOUND OR f.state = target THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pricing_file_transitions t
                  WHERE t.from_state = f.state AND t.to_state = target AND t.who = 'system') THEN
    RETURN NEW;   -- e.g. lines already sent back to the supplier; the price still moves
  END IF;
  PERFORM public._pricing_file_apply(f, target, auth.uid(),
    CASE WHEN NEW.status = 'returned' THEN NEW.return_reason END);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_follow_price() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS internal_prices_zzz_pricing_file ON public.internal_prices;
CREATE TRIGGER internal_prices_zzz_pricing_file AFTER UPDATE OF status ON public.internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.pricing_file_follow_price();
