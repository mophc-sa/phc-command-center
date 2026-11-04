-- =============================================================================
-- Pricing loop PR 2, part 6: Kalas builds the selling price and proposes it.
--
-- Build writes the grid into the Phase 7A/8 engine so its rules apply
-- unchanged: an estimation (cost_total = materials + extras + logistics,
-- installation_cost, wastage 0, overhead) and an internal price at the grid's
-- total. Phase 8's compute_margin then derives the margin from
-- estimation_cost_basis, which on these figures is exactly the grid's
-- total_cost (pricing_selling_totals uses the same expression). The client
-- never supplies a margin or a total.
--
-- AI_HANDOFF PR 2 contract: these functions run as the owner, so
-- internal_price_insert_guard (authenticated callers only) does not reach
-- build. It inserts a price at internal_price_proposed and nothing else, and
-- links through _pricing_file_link_price, which re-checks every rule.
-- figure_set_by and proposed_by are stamped from auth.uid() by the PR 1
-- guards (not from the payload), so Kalas is both and Zayed can approve.
--
-- Lock order (branch-wide): estimation, then price, then file.
--   build: reads the file unlocked; locks the estimation, then the price, then
--   the file (_pricing_file_assert_link: it must still link what was read);
--   writes both; _pricing_file_link_price re-locks the price (already held)
--   and takes the file. The totals are read again once the file is locked and
--   must match what was written, else the build is refused as stale.
--   propose: build, then one UPDATE of the price (the follow trigger locks the
--   file, already held by this transaction).
--
-- Supplier selection (supplier_quote_lines.is_selected) is not used in pricing
-- files: estimation_cost_basis would take the selected lines' cost and ignore
-- the grid, so a revision with a selected line is refused.
-- =============================================================================

-- The file must still point at the estimation and price this build read and
-- locked. Locks the file (order: estimation, price, file). Called by build; a
-- separate function so the refusal can be tested directly.
CREATE OR REPLACE FUNCTION public._pricing_file_assert_link(_file_id uuid, _estimation_id uuid, _price_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur_est uuid; cur_price uuid; found_file boolean;
BEGIN
  SELECT f.estimation_id, f.internal_price_id INTO cur_est, cur_price
    FROM public.pricing_files f WHERE f.id = _file_id FOR UPDATE;
  found_file := FOUND;
  IF NOT found_file OR cur_est IS DISTINCT FROM _estimation_id OR cur_price IS DISTINCT FROM _price_id THEN
    RAISE EXCEPTION 'The file changed, try again. | تغيّر الملف، أعد المحاولة.' USING ERRCODE = 'P0001';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._pricing_file_assert_link(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_build_price(_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; p public.internal_prices; e public.estimations;
        t record; t2 record; reuse_est boolean;
BEGIN
  IF NOT coalesce(public.can_approve_final_price(u), false) THEN
    RAISE EXCEPTION 'The GM builds the selling price. | سعر البيع يبنيه المدير العام.' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(public.can_read_commercial_cost(u), false) THEN
    RAISE EXCEPTION 'Building the price needs cost access. | بناء السعر يحتاج صلاحية رؤية التكلفة.' USING ERRCODE = '42501';
  END IF;

  -- Unlocked read, to know what to lock. The state is re-checked under the
  -- file lock by _pricing_file_link_price.
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state <> 'selling_build' THEN
    RAISE EXCEPTION 'The price is built in the selling build. | يُبنى السعر في مرحلة بناء سعر البيع.' USING ERRCODE = 'P0001';
  END IF;
  IF f.boq_revision_id IS NULL OR NOT public.boq_revision_is_frozen(f.boq_revision_id) THEN
    RAISE EXCEPTION 'The file''s BOQ is not frozen. | كميات الملف غير مجمّدة.' USING ERRCODE = 'P0001';
  END IF;

  -- Lock order: estimation, then price, (then the file, in the link call).
  IF f.estimation_id IS NOT NULL THEN
    SELECT * INTO e FROM public.estimations WHERE id = f.estimation_id FOR UPDATE;
  END IF;
  IF f.internal_price_id IS NOT NULL THEN
    SELECT * INTO p FROM public.internal_prices WHERE id = f.internal_price_id FOR UPDATE;
    IF p.status NOT IN ('internal_price_proposed','returned') THEN
      RAISE EXCEPTION 'The file''s price is %, so it cannot be rebuilt. | سعر الملف في حالة %، فلا يمكن إعادة بنائه.', p.status, p.status
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- Both locked: the file must still link to exactly what was read above, else a
  -- concurrent build linked another price and this one would be orphaned.
  PERFORM public._pricing_file_assert_link(f.id, f.estimation_id, f.internal_price_id);

  IF EXISTS (SELECT 1 FROM public.supplier_quote_lines l JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
              WHERE q.boq_revision_id = f.boq_revision_id AND l.is_selected) THEN
    RAISE EXCEPTION 'A supplier line on this BOQ revision is marked selected, so the margin would ignore the grid; open a new BOQ revision. | أحد بنود المورد في هذا الإصدار مُعلَّم كمختار فيتجاهل الهامش الجدول؛ افتح إصدار كميات جديداً.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO t FROM public.pricing_selling_totals WHERE file_id = f.id;
  -- Two IFs, not one OR: an unassigned record must not be read.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The file has no lines to price. | لا توجد بنود للتسعير في الملف.' USING ERRCODE = 'P0001';
  END IF;
  IF t.line_count = 0 THEN
    RAISE EXCEPTION 'The file has no lines to price. | لا توجد بنود للتسعير في الملف.' USING ERRCODE = 'P0001';
  END IF;
  IF t.unpriced_lines > 0 THEN
    RAISE EXCEPTION '% line(s) have no price yet (no supplier price in SAR, or no margin). | % بند بلا سعر بعد (لا سعر مورد بالريال أو لا هامش).', t.unpriced_lines, t.unpriced_lines
      USING ERRCODE = 'P0001';
  END IF;
  IF t.screen_price_missing_lines > 0 THEN
    RAISE EXCEPTION '% line(s) use the with-screen price but the supplier gave none; enter it or choose the normal price. | % بند يستخدم سعر الشاشة ولم يحدده المورد؛ أدخله أو اختر السعر العادي.', t.screen_price_missing_lines, t.screen_price_missing_lines
      USING ERRCODE = 'P0001';
  END IF;
  IF t.multi_quote_lines > 0 THEN
    RAISE EXCEPTION 'A line has prices from more than one supplier; one supplier per file in this release. | أحد البنود له أسعار من أكثر من مورد؛ مورد واحد لكل ملف في هذا الإصدار.'
      USING ERRCODE = 'P0001';
  END IF;
  IF t.total_selling IS NULL OR t.total_selling <= 0 THEN
    RAISE EXCEPTION 'The selling total is zero. | إجمالي البيع صفر.' USING ERRCODE = 'P0001';
  END IF;

  -- The estimation: the file's own while it is for this revision and no price
  -- on it is under review or approved (those are frozen, Task 1).
  reuse_est := e.id IS NOT NULL AND e.boq_revision_id = f.boq_revision_id
               AND NOT EXISTS (SELECT 1 FROM public.internal_prices ip
                                WHERE ip.estimation_id = e.id AND ip.status IN ('gm_pending','gm_approved'));
  IF reuse_est THEN
    UPDATE public.estimations
       SET cost_total = t.materials_total + t.extras_total + t.logistics_total,
           installation_cost = t.installation_total, wastage_pct = 0, overhead_pct = t.overhead_pct
     WHERE id = e.id RETURNING * INTO e;
  ELSE
    INSERT INTO public.estimations (boq_revision_id, cost_total, installation_cost, wastage_pct, overhead_pct, notes, created_by)
    VALUES (f.boq_revision_id, t.materials_total + t.extras_total + t.logistics_total,
            t.installation_total, 0, t.overhead_pct, 'Built from pricing file ' || f.id::text, u)
    RETURNING * INTO e;
  END IF;

  -- The price: the file's own while it is a proposal or returned, else a new
  -- proposal. Never inserted or set past internal_price_proposed.
  IF p.id IS NOT NULL THEN
    UPDATE public.internal_prices
       SET proposed_price = t.total_selling, estimation_id = e.id, status = 'internal_price_proposed',
           below_floor_justification = NULL
     WHERE id = p.id RETURNING * INTO p;
  ELSE
    INSERT INTO public.internal_prices (estimation_id, proposed_price, status, proposed_by, proposed_at)
    VALUES (e.id, t.total_selling, 'internal_price_proposed', u, now())
    RETURNING * INTO p;
  END IF;

  -- Takes the file lock, re-checks the state and the link contract.
  PERFORM public._pricing_file_link_price(f.id, e.id, p.id);

  -- With the file locked: the figures written are the figures now on the grid.
  SELECT * INTO t2 FROM public.pricing_selling_totals WHERE file_id = f.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The file changed while the price was being built; try again. | تغيّر الملف أثناء بناء السعر؛ أعد المحاولة.' USING ERRCODE = 'P0001';
  END IF;
  IF t2.total_selling IS DISTINCT FROM t.total_selling OR t2.total_cost IS DISTINCT FROM t.total_cost
     OR t2.unpriced_lines > 0 OR t2.multi_quote_lines > 0 THEN
    RAISE EXCEPTION 'The file changed while the price was being built; try again. | تغيّر الملف أثناء بناء السعر؛ أعد المحاولة.' USING ERRCODE = 'P0001';
  END IF;

  -- The per-line figures behind this price, for the quotation (PR 4).
  INSERT INTO public.pricing_file_lines (file_id, boq_line_id, built_cost, built_selling_price, built_at, updated_by)
  SELECT g.file_id, g.boq_line_id, g.line_cost, g.selling_price, now(), u
    FROM public.pricing_selling_grid g WHERE g.file_id = f.id
  ON CONFLICT (file_id, boq_line_id) DO UPDATE
     SET built_cost = EXCLUDED.built_cost, built_selling_price = EXCLUDED.built_selling_price,
         built_at = EXCLUDED.built_at;

  -- Lines no longer on the current revision keep no built figures.
  UPDATE public.pricing_file_lines pl
     SET built_cost = NULL, built_selling_price = NULL, built_at = NULL
   WHERE pl.file_id = f.id
     AND NOT EXISTS (SELECT 1 FROM public.boq_lines bl WHERE bl.id = pl.boq_line_id AND bl.revision_id = f.boq_revision_id);

  -- The lines of the current revision must add up to the price.
  IF (SELECT sum(pl.built_selling_price) FROM public.pricing_file_lines pl
        JOIN public.boq_lines bl ON bl.id = pl.boq_line_id
       WHERE pl.file_id = f.id AND bl.revision_id = f.boq_revision_id) IS DISTINCT FROM p.proposed_price THEN
    RAISE EXCEPTION 'The line prices do not add up to the price; try again. | أسعار البنود لا تساوي السعر؛ أعد المحاولة.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.price_built', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'internal_price_id', p.id, 'estimation_id', e.id,
                             'proposed_price', p.proposed_price, 'total_cost', t.total_cost,
                             'margin_pct', p.margin_percentage));
  RETURN jsonb_build_object('internal_price_id', p.id, 'estimation_id', e.id,
                            'total_cost', t.total_cost, 'total_selling', t.total_selling,
                            'margin_pct', p.margin_percentage, 'floor_pct', t.floor_pct,
                            'below_floor', t.below_floor);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_build_price(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_build_price(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_propose(_file_id uuid, _expected_total numeric, _expected_total_cost numeric, _justification text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); b jsonb; f public.pricing_files; j text := nullif(btrim(_justification), '');
BEGIN
  b := public.pricing_file_build_price(_file_id);
  -- The total and the cost the GM saw: a changed overhead moves the cost, not the typed total.
  IF (b->>'total_selling')::numeric IS DISTINCT FROM _expected_total
     OR (b->>'total_cost')::numeric IS DISTINCT FROM _expected_total_cost THEN
    RAISE EXCEPTION 'The price changed since you built it (now %, cost %); check it and propose again. | تغيّر السعر منذ بنائه (الآن %، التكلفة %)؛ راجعه واقترحه مجدداً.',
      b->>'total_selling', b->>'total_cost', b->>'total_selling', b->>'total_cost' USING ERRCODE = 'P0001';
  END IF;
  -- The existing in-file propose path: the transition guard (GM, selling build,
  -- no open extras), the floor guard and the file-follow trigger all run here.
  -- The justification is this proposal's own: nothing stored is carried over.
  UPDATE public.internal_prices
     SET status = 'gm_pending', below_floor_justification = j
   WHERE id = (b->>'internal_price_id')::uuid;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  SELECT u, 'user', 'pricing_file.proposed', 'opportunity', pf.opportunity_id,
         jsonb_build_object('file_id', pf.id, 'internal_price_id', pf.internal_price_id,
                            'total_selling', _expected_total, 'total_cost', _expected_total_cost,
                            'below_floor_justification', j)
    FROM public.pricing_files pf WHERE pf.id = _file_id;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_propose(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_propose(uuid, numeric, numeric, text) TO authenticated;
