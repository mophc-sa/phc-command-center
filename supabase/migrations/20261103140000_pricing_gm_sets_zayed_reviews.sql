-- =============================================================================
-- Pricing loop, part 5: Kalas sets the price, Zayed reviews it (Mo, 2026-11-03).
-- The supplier's prices go to the GM, who builds and proposes the selling price;
-- his propose is the move to gm_pending, so the Phase 8 floor guard still runs.
-- Zayed's review then completes it: for a price that belongs to a pricing file,
-- gm_approved is finance's, and only for a price the authority proposed. The
-- old chain stays legal outside pricing files. The file follows its price.
--
-- The guard is now SECURITY DEFINER (like the Phase 8 triggers on this table):
-- whether a price is in a pricing file, the file's state, and whether that file
-- has an open suggestion must not depend on what the caller's RLS lets them
-- see. A GM delegate who is not a cost holder cannot read pricing_file_extras,
-- and a check run as that caller would find no suggestion and wave the price
-- through. Every rule in it reads auth.uid() from the request, which SECURITY
-- DEFINER does not change.
--
-- Lock order: a price row, then its pricing file. A price move locks the price
-- (the UPDATE) and then the file (the follow trigger); pricing_file_move takes
-- them in the same order (20261103110000).
-- =============================================================================

-- 2026-11-03: a price belongs to at most one pricing file, so "the price's
-- file" has one answer.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_files_one_per_price
  ON public.pricing_files (internal_price_id) WHERE internal_price_id IS NOT NULL;

-- 2026-11-03: facts about a price, read past RLS. Internal to the guard.
-- The state of the price's pricing file; NULL when it is in none.
CREATE OR REPLACE FUNCTION public._pricing_price_file_state(_internal_price_id uuid)
RETURNS public.pricing_file_state LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pf.state FROM public.pricing_files pf WHERE pf.internal_price_id = _internal_price_id;
$$;
REVOKE ALL ON FUNCTION public._pricing_price_file_state(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._pricing_price_has_open_extras(_internal_price_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.pricing_files pf
                   JOIN public.pricing_file_extras x ON x.file_id = pf.id
                  WHERE pf.internal_price_id = _internal_price_id AND x.status = 'suggested');
$$;
REVOKE ALL ON FUNCTION public._pricing_price_has_open_extras(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.internal_price_transition_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _ok BOOLEAN := FALSE; _uid UUID := auth.uid();
        _file_state public.pricing_file_state; _in_file BOOLEAN;
        _is_finance BOOLEAN; _is_proposer BOOLEAN;
BEGIN
  -- 2026-11-03: is this price on the pricing-loop path, and where is its file?
  _file_state := public._pricing_price_file_state(NEW.id);
  _in_file := _file_state IS NOT NULL;

  IF OLD.status = 'gm_approved' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'An approved price is final; propose a new price instead. | السعر المعتمد نهائي — اقترح سعرًا جديدًا.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- 2026-11-03: an approved price is what gets quoted, so no column of it may
    -- change. The margin columns are recomputed by internal_prices_compute_margin
    -- (which runs before this guard) and updated_at is this guard's; they are
    -- compared out, and the row is kept as it was, so the margin it was approved
    -- at stays the margin it says.
    IF (to_jsonb(NEW) - ARRAY['margin_value','margin_percentage','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['margin_value','margin_percentage','updated_at']) THEN
      RAISE EXCEPTION 'An approved price is final; propose a new price instead. | السعر المعتمد نهائي — اقترح سعرًا جديدًا.';
    END IF;
    RETURN OLD;
  END IF;

  -- 2026-11-03: a price under review is frozen, including in the statement that
  -- decides it, so what is approved is what was proposed. Return it to change it.
  IF OLD.status = 'gm_pending' AND (
       NEW.proposed_price IS DISTINCT FROM OLD.proposed_price
       OR NEW.estimation_id IS DISTINCT FROM OLD.estimation_id
       OR NEW.below_floor_justification IS DISTINCT FROM OLD.below_floor_justification
       OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
       OR NEW.proposed_at IS DISTINCT FROM OLD.proposed_at) THEN
    RAISE EXCEPTION 'A price under review cannot change; return it first. | لا يُعدَّل سعر قيد المراجعة؛ أرجعه أولاً.';
  END IF;

  -- 2026-11-03: in a pricing file the price is the GM's to set; estimation and
  -- finance may draft it. Nobody else changes the figure, its cost basis or its
  -- floor justification, whether or not the statement also moves the price.
  IF _in_file AND (
       NEW.proposed_price IS DISTINCT FROM OLD.proposed_price
       OR NEW.estimation_id IS DISTINCT FROM OLD.estimation_id
       OR NEW.below_floor_justification IS DISTINCT FROM OLD.below_floor_justification)
     AND NOT (coalesce(public.can_approve_final_price(_uid), FALSE)
              OR coalesce(public.is_pricer(_uid), FALSE)) THEN
    RAISE EXCEPTION 'In a pricing file only the GM or a pricer edits the price. | في ملف التسعير لا يعدّل السعر إلا المدير العام أو المسعّر.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = OLD.status THEN
    -- 2026-11-03: who proposed and who reviewed are recorded by the moves below,
    -- never edited in between.
    IF NEW.proposed_by               IS DISTINCT FROM OLD.proposed_by
       OR NEW.proposed_at            IS DISTINCT FROM OLD.proposed_at
       OR NEW.commercial_reviewed_by IS DISTINCT FROM OLD.commercial_reviewed_by
       OR NEW.commercial_reviewed_at IS DISTINCT FROM OLD.commercial_reviewed_at
       OR NEW.finance_reviewed_by    IS DISTINCT FROM OLD.finance_reviewed_by
       OR NEW.finance_reviewed_at    IS DISTINCT FROM OLD.finance_reviewed_at
       OR NEW.gm_decided_by          IS DISTINCT FROM OLD.gm_decided_by
       OR NEW.gm_decided_at          IS DISTINCT FROM OLD.gm_decided_at THEN
      RAISE EXCEPTION 'Who proposed or reviewed a price is recorded by its moves, not edited. | من اقترح السعر أو راجعه يُسجَّل بالانتقالات ولا يُعدَّل.';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;                       -- an edit that is not a transition
  END IF;

  -- The chain. Anything not listed is refused, so a skip is an error rather
  -- than a shortcut somebody takes under pressure.
  _ok := (OLD.status, NEW.status) IN (
    ('draft','cost_complete'),
    ('cost_complete','internal_price_proposed'),
    ('commercial_review','finance_review'),
    ('gm_pending','gm_approved'),
    ('returned','internal_price_proposed')
  )
  -- 2026-11-03: review is entered by Kalas's propose in a pricing file, and by
  -- the commercial and finance reviews outside one, never the other way round.
  OR (OLD.status = 'internal_price_proposed' AND NEW.status = 'gm_pending' AND _in_file)
  OR (OLD.status = 'internal_price_proposed' AND NEW.status = 'commercial_review' AND NOT _in_file)
  OR (OLD.status = 'finance_review' AND NEW.status = 'gm_pending' AND NOT _in_file)
  OR (NEW.status = 'returned' AND OLD.status <> 'gm_approved');

  IF NOT _ok THEN
    IF _in_file AND NEW.status IN ('gm_pending','commercial_review') THEN
      RAISE EXCEPTION 'In a pricing file the GM proposes the price for review. | في ملف التسعير يقترح المدير العام السعر للمراجعة.'
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'Illegal price transition % -> %. The chain is draft, cost_complete, internal_price_proposed, commercial_review, finance_review, gm_pending, gm_approved. | انتقال غير مسموح.',
      OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  -- Who may make each move. The database decides, not the button.
  -- 2026-11-03: who completes a price. Outside pricing files: the GM, as before.
  -- Inside: finance, reviewing a price the authority set, never its own, while
  -- the file is in price review.
  IF NEW.status = 'gm_approved' THEN
    IF _in_file THEN
      IF NOT (public.has_role(_uid, 'finance_manager'::public.app_role)
              AND public.can_approve_final_price(OLD.proposed_by)
              AND OLD.proposed_by IS DISTINCT FROM _uid) THEN
        RAISE EXCEPTION 'Finance reviews and approves the price the GM set. | المالية تراجع وتعتمد السعر الذي وضعه المدير العام.'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF _file_state <> 'price_review' THEN
        RAISE EXCEPTION 'A price is approved while its file is in price review. | يُعتمد السعر وملفه في مراجعة السعر.';
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
  -- 2026-11-03: the one-step propose is the GM's, from the selling build, never
  -- with an undecided extra.
  IF OLD.status = 'internal_price_proposed' AND NEW.status = 'gm_pending' THEN
    IF NOT public.can_approve_final_price(_uid) THEN
      RAISE EXCEPTION 'The GM sets and proposes the selling price. | سعر البيع يضعه ويقترحه المدير العام.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF _file_state <> 'selling_build' THEN
      RAISE EXCEPTION 'A price is proposed from the selling build. | يُقترح السعر من مرحلة بناء سعر البيع.';
    END IF;
    IF public._pricing_price_has_open_extras(NEW.id) THEN
      RAISE EXCEPTION 'Accept or dismiss every suggested item before proposing. | اقبل أو ارفض كل بند مقترح قبل اقتراح السعر.';
    END IF;
  END IF;
  -- 2026-11-03: in a pricing file a price is returned by finance (the reviewer)
  -- or by whoever proposed it. pricing_file_move also returns it when a pricer
  -- sends lines back to the supplier from price review; the file is already at
  -- the supplier by then.
  IF NEW.status = 'returned' AND _in_file THEN
    _is_finance  := coalesce(public.has_role(_uid, 'finance_manager'::public.app_role), FALSE);
    _is_proposer := _uid IS NOT NULL AND OLD.proposed_by IS NOT DISTINCT FROM _uid;
    IF NOT (_is_finance OR _is_proposer
            OR (OLD.status = 'gm_pending' AND _file_state = 'at_supplier'
                AND coalesce(public.is_pricer(_uid), FALSE))) THEN
      RAISE EXCEPTION 'Only finance, or whoever proposed the price, may return it. | إرجاع السعر يقتصر على المالية أو من اقترحه.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.status = 'commercial_review'
     AND _uid IS NOT NULL
     AND NOT public.is_pipeline_operator(_uid) THEN
    RAISE EXCEPTION 'Only a pipeline operator may take a price into commercial review.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Stamp who did what, from the session rather than from the payload.
  IF _in_file THEN
    -- 2026-11-03: in a pricing file the proposal and review stamps are only ever
    -- the guard's.
    NEW.proposed_by            := OLD.proposed_by;            NEW.proposed_at            := OLD.proposed_at;
    NEW.commercial_reviewed_by := OLD.commercial_reviewed_by; NEW.commercial_reviewed_at := OLD.commercial_reviewed_at;
    NEW.finance_reviewed_by    := OLD.finance_reviewed_by;    NEW.finance_reviewed_at    := OLD.finance_reviewed_at;
    NEW.gm_decided_by          := OLD.gm_decided_by;          NEW.gm_decided_at          := OLD.gm_decided_at;
  END IF;
  IF NEW.status = 'commercial_review' THEN
    NEW.commercial_reviewed_by := _uid; NEW.commercial_reviewed_at := now();
  ELSIF NEW.status = 'finance_review' THEN
    NEW.finance_reviewed_by := _uid;    NEW.finance_reviewed_at := now();
  ELSIF NEW.status = 'gm_approved' AND _in_file THEN
    -- 2026-11-03: Kalas's price, Zayed's review.
    NEW.finance_reviewed_by := _uid;    NEW.finance_reviewed_at := now();
    NEW.gm_decided_by := OLD.proposed_by; NEW.gm_decided_at := now();
  ELSIF NEW.status = 'returned' AND _in_file THEN
    -- 2026-11-03: the GM taking back his own price is his decision; finance's
    -- return is its review, and the GM has decided nothing this round. A pricer
    -- sending lines back is recorded by the file event and the audit row.
    IF _is_proposer AND public.can_approve_final_price(_uid) THEN
      NEW.gm_decided_by := _uid;        NEW.gm_decided_at := now();
    ELSIF _is_finance THEN
      NEW.finance_reviewed_by := _uid;  NEW.finance_reviewed_at := now();
      NEW.gm_decided_by := NULL;        NEW.gm_decided_at := NULL;
    END IF;
  ELSIF NEW.status IN ('gm_approved','returned') THEN
    NEW.gm_decided_by := _uid;          NEW.gm_decided_at := now();
  ELSIF NEW.status = 'gm_pending' AND OLD.status = 'internal_price_proposed' THEN
    -- 2026-11-03: Kalas's propose makes him the proposer; the approval rule above
    -- trusts proposed_by, so it comes from the session, never the payload.
    NEW.proposed_by := _uid;            NEW.proposed_at := now();
  ELSIF NEW.status = 'internal_price_proposed' AND _in_file THEN
    -- 2026-11-03: whoever puts a price in a file up again is its proposer, so
    -- nobody returns a price while posing as the one who proposed it.
    NEW.proposed_by := _uid;            NEW.proposed_at := now();
  ELSIF NEW.status = 'internal_price_proposed' THEN
    NEW.proposed_by := coalesce(NEW.proposed_by, _uid);
    NEW.proposed_at := coalesce(NEW.proposed_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.internal_price_transition_guard() FROM PUBLIC, anon, authenticated;

-- 2026-11-03: a price a user creates starts as a draft or a proposal and earns
-- every later status through the guard above. Without this, estimation could
-- insert a row already gm_approved, and a quotation would carry it. Migrations,
-- fixtures and SECURITY DEFINER code run as the owner, not as authenticated.
CREATE OR REPLACE FUNCTION public.internal_price_insert_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NEW.status NOT IN ('draft','internal_price_proposed') THEN
    RAISE EXCEPTION 'A new price starts as a draft or a proposal; review moves it on. | يبدأ السعر الجديد مسودة أو مقترحًا، والمراجعة تنقله بعد ذلك.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.internal_price_insert_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS internal_prices_insert_guard ON public.internal_prices;
CREATE TRIGGER internal_prices_insert_guard BEFORE INSERT ON public.internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.internal_price_insert_guard();

-- 2026-11-03: the pricing file follows its price, and every move of a price in
-- a pricing file is audited.
CREATE OR REPLACE FUNCTION public.pricing_file_follow_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files; target public.pricing_file_state; _uid uuid := auth.uid();
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO f FROM public.pricing_files WHERE internal_price_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (_uid, CASE WHEN _uid IS NULL THEN 'system' ELSE 'user' END, 'internal_price.' || NEW.status,
          'internal_price', NEW.id,
          jsonb_build_object('file_id', f.id, 'from', OLD.status, 'to', NEW.status,
                             'proposed_price', NEW.proposed_price));

  IF f.state = 'closed' THEN RETURN NEW; END IF;
  target := CASE NEW.status WHEN 'gm_pending' THEN 'price_review'
                            WHEN 'gm_approved' THEN 'approved'
                            WHEN 'returned' THEN 'selling_build' END;
  IF target IS NULL OR f.state = target THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pricing_file_transitions t
                  WHERE t.from_state = f.state AND t.to_state = target AND t.who = 'system') THEN
    RETURN NEW;   -- e.g. lines already sent back to the supplier; the price still moves
  END IF;
  PERFORM public._pricing_file_apply(f, target, _uid,
    CASE WHEN NEW.status = 'returned' THEN NEW.return_reason END);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_follow_price() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS internal_prices_zzz_pricing_file ON public.internal_prices;
CREATE TRIGGER internal_prices_zzz_pricing_file AFTER UPDATE OF status ON public.internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.pricing_file_follow_price();
