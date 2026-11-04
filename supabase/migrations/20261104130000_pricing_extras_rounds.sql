-- =============================================================================
-- Pricing loop PR 2, part 4: extras that must not be missed, per round.
--
-- PR 1 deferred items, both closed here:
-- * Suggest-vs-propose race. pricing_suggest_extras could add a suggestion
--   while Kalas's propose was checking for open ones. Both now take the file
--   row lock: suggest directly, the propose check after the price row (the
--   lock order of 20261103140000). The check is VOLATILE so, once it has the
--   lock, its next statement sees a suggestion committed while it waited.
-- * Rounds. A client revision is a new frozen BOQ revision on the same file;
--   its decided extras used to suppress the new round's suggestions for the
--   same item ("one per catalog item per file"). An extra now belongs to the
--   revision it was made for, so each round is suggested and decided afresh,
--   and old rounds stay as history.
-- Also: a cinema project suggests the catalog items marked suggest_if_cinema
-- (spec §3), and Kalas or Zayed can add any catalog item by hand.
-- =============================================================================

ALTER TABLE public.pricing_file_extras
  ADD COLUMN IF NOT EXISTS boq_revision_id uuid REFERENCES public.boq_revisions(id) ON DELETE RESTRICT;
UPDATE public.pricing_file_extras x
   SET boq_revision_id = coalesce(
         (SELECT l.revision_id FROM public.boq_lines l WHERE l.id = x.source_line_id),
         (SELECT f.boq_revision_id FROM public.pricing_files f WHERE f.id = x.file_id))
 WHERE x.boq_revision_id IS NULL;

-- An extra inserted without a round belongs to the file's current revision.
CREATE OR REPLACE FUNCTION public.pricing_file_extras_round()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.boq_revision_id IS NULL THEN
    SELECT f.boq_revision_id INTO NEW.boq_revision_id FROM public.pricing_files f WHERE f.id = NEW.file_id;
  END IF;
  IF NEW.boq_revision_id IS NULL THEN
    RAISE EXCEPTION 'An extra belongs to a BOQ revision; attach one to the file first. | البند الإضافي يتبع إصدار كميات؛ اربط إصداراً بالملف أولاً.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_extras_round() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pricing_file_extras_round ON public.pricing_file_extras;
CREATE TRIGGER pricing_file_extras_round BEFORE INSERT ON public.pricing_file_extras
  FOR EACH ROW EXECUTE FUNCTION public.pricing_file_extras_round();
ALTER TABLE public.pricing_file_extras ALTER COLUMN boq_revision_id SET NOT NULL;

DROP INDEX IF EXISTS public.pricing_file_extras_one_per_item;
CREATE UNIQUE INDEX IF NOT EXISTS pricing_file_extras_one_per_item_per_round
  ON public.pricing_file_extras (file_id, boq_revision_id, catalog_id);

-- The catalog items a file's current revision expects as extras: line-based hits
-- plus the cinema items. One definition for the suggester and the Propose check,
-- so neither depends on the other having run. The caller holds the file lock.
CREATE OR REPLACE FUNCTION public._pricing_expected_extras(_file_id uuid)
RETURNS TABLE (catalog_id uuid, default_rate numeric, line_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH f AS (
    SELECT pf.id, pf.boq_revision_id,
           coalesce((SELECT i.is_cinema FROM public.pricing_file_inputs i WHERE i.file_id = pf.id), false) AS cinema
      FROM public.pricing_files pf WHERE pf.id = _file_id
  ), line_hits AS (
    SELECT DISTINCT ON (c.id) c.id AS catalog_id, c.default_rate, l.id AS line_id
      FROM f
      JOIN public.boq_lines l ON l.revision_id = f.boq_revision_id
      JOIN public.pricing_extras_catalog c ON c.active
       AND ((l.install_type IS NOT NULL AND l.install_type = ANY (c.suggest_for))
            OR (c.suggest_min_height_m IS NOT NULL AND coalesce(l.mount_height_m,0) >= c.suggest_min_height_m))
     ORDER BY c.id, l.line_number NULLS LAST
  ), cinema_hits AS (
    SELECT c.id AS catalog_id, c.default_rate, NULL::uuid AS line_id
      FROM f, public.pricing_extras_catalog c
     WHERE f.cinema AND f.boq_revision_id IS NOT NULL AND c.active AND c.suggest_if_cinema
  )
  SELECT DISTINCT ON (h.catalog_id) h.catalog_id, h.default_rate, h.line_id
    FROM (SELECT * FROM line_hits UNION ALL SELECT * FROM cinema_hits) h
   ORDER BY h.catalog_id, h.line_id NULLS LAST
$$;
REVOKE ALL ON FUNCTION public._pricing_expected_extras(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_suggest_extras(_file_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; n integer; cinema boolean; purged integer; withdrawn integer;
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_approve_final_price(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  -- 2026-11-04: the file lock, so a suggestion and Kalas's propose cannot interleave.
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state::text NOT IN ('boq_frozen','at_supplier','supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Extras can only be suggested after the BOQ is frozen and before the price goes to review. | لا يمكن اقتراح البنود الإضافية إلا بعد تجميد الكميات وقبل إرسال السعر للمراجعة.' USING ERRCODE = 'P0001';
  END IF;
  IF f.boq_revision_id IS NULL THEN
    RAISE EXCEPTION 'The file has no BOQ revision yet. | لا يوجد إصدار كميات في الملف بعد.' USING ERRCODE = '23514';
  END IF;
  cinema := coalesce((SELECT i.is_cinema FROM public.pricing_file_inputs i WHERE i.file_id = f.id), false);

  -- Undecided suggestions from an older round no longer block Propose.
  WITH d AS (DELETE FROM public.pricing_file_extras x
              WHERE x.file_id = f.id AND x.status = 'suggested' AND x.boq_revision_id <> f.boq_revision_id
              RETURNING 1)
  SELECT count(*)::int INTO purged FROM d;
  IF purged > 0 THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
    VALUES (u, 'user', 'pricing_file.extras_old_round_purged', 'opportunity', f.opportunity_id,
            jsonb_build_object('file_id', f.id, 'revision_id', f.boq_revision_id, 'count', purged));
  END IF;
  -- An undecided cinema suggestion goes when the project is no longer a cinema.
  IF NOT cinema THEN
    WITH d AS (DELETE FROM public.pricing_file_extras x
                WHERE x.file_id = f.id AND x.status = 'suggested' AND x.source_line_id IS NULL
                  AND x.catalog_id IN (SELECT c.id FROM public.pricing_extras_catalog c WHERE c.suggest_if_cinema)
                RETURNING 1)
    SELECT count(*)::int INTO withdrawn FROM d;
    IF withdrawn > 0 THEN
      INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (u, 'user', 'pricing_file.extras_cinema_withdrawn', 'opportunity', f.opportunity_id,
              jsonb_build_object('file_id', f.id, 'revision_id', f.boq_revision_id, 'count', withdrawn));
    END IF;
  END IF;

  WITH ins AS (
    INSERT INTO public.pricing_file_extras (file_id, boq_revision_id, catalog_id, rate, source_line_id)
    SELECT f.id, f.boq_revision_id, h.catalog_id, h.default_rate, h.line_id FROM public._pricing_expected_extras(f.id) h
    ON CONFLICT (file_id, boq_revision_id, catalog_id) DO NOTHING
    RETURNING 1)
  SELECT count(*)::int INTO n FROM ins;
  IF n > 0 THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
    VALUES (u, 'user', 'pricing_file.extras_suggested', 'opportunity', f.opportunity_id,
            jsonb_build_object('file_id', f.id, 'revision_id', f.boq_revision_id, 'count', n));
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pricing_suggest_extras(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_suggest_extras(uuid) TO authenticated;

-- Called by internal_price_transition_guard while the price row is locked.
CREATE OR REPLACE FUNCTION public._pricing_price_has_open_extras(_internal_price_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files;
BEGIN
  SELECT * INTO f FROM public.pricing_files WHERE internal_price_id = _internal_price_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Blocked when a current-round extra is undecided, or when an expected item has no
  -- row this round at all (suggest never ran, e.g. package_review -> boq_frozen).
  RETURN EXISTS (SELECT 1 FROM public.pricing_file_extras x
                  WHERE x.file_id = f.id AND x.boq_revision_id = f.boq_revision_id
                    AND x.status = 'suggested')
      OR EXISTS (SELECT 1 FROM public._pricing_expected_extras(f.id) h
                  WHERE NOT EXISTS (SELECT 1 FROM public.pricing_file_extras x
                                     WHERE x.file_id = f.id AND x.boq_revision_id = f.boq_revision_id
                                       AND x.catalog_id = h.catalog_id));
END $$;
REVOKE ALL ON FUNCTION public._pricing_price_has_open_extras(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_open_suggestions(_file_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_read_commercial_cost(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  -- Exactly what _pricing_price_has_open_extras blocks Propose on: undecided rows of the
  -- current round, plus expected catalog items that have no row this round.
  RETURN (SELECT count(*)::int FROM public.pricing_file_extras x
            JOIN public.pricing_files f ON f.id = x.file_id
           WHERE x.file_id = _file_id AND x.boq_revision_id = f.boq_revision_id AND x.status = 'suggested')
       + (SELECT count(*)::int FROM public._pricing_expected_extras(_file_id) h
           WHERE NOT EXISTS (SELECT 1 FROM public.pricing_file_extras x
                               JOIN public.pricing_files f ON f.id = x.file_id
                              WHERE x.file_id = _file_id AND x.boq_revision_id = f.boq_revision_id
                                AND x.catalog_id = h.catalog_id));
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_open_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_open_suggestions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_add_extra(_file_id uuid, _catalog_id uuid, _quantity numeric, _rate numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; c public.pricing_extras_catalog; e public.pricing_file_extras;
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_approve_final_price(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 OR (_rate IS NOT NULL AND _rate < 0) THEN
    RAISE EXCEPTION 'Give a quantity above zero and a rate that is not negative. | حدد كمية أكبر من صفر وسعراً غير سالب.' USING ERRCODE = '23514';
  END IF;
  -- Within the columns' precision (numeric(14,3) and numeric(14,2)), so a bad number is 23514, not an overflow.
  IF _quantity > 99999999999.999 OR (_rate IS NOT NULL AND _rate > 999999999999.99) THEN
    RAISE EXCEPTION 'The quantity or rate is too large. | الكمية أو السعر أكبر من الحد المسموح.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state::text NOT IN ('supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Extras are added after the supplier has priced and before the price goes to review. | تُضاف البنود الإضافية بعد تسعير المورد وقبل إرسال السعر للمراجعة.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM public.pricing_extras_catalog WHERE id = _catalog_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inactive catalog item. | بند الكتالوج غير موجود أو غير مفعّل.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.pricing_file_extras (file_id, boq_revision_id, catalog_id, quantity, rate, status, decided_by, decided_at)
  VALUES (f.id, f.boq_revision_id, c.id, _quantity, coalesce(_rate, c.default_rate), 'accepted', u, now())
  ON CONFLICT (file_id, boq_revision_id, catalog_id) DO UPDATE
     SET status = 'accepted', quantity = EXCLUDED.quantity, rate = EXCLUDED.rate,
         dismiss_reason = NULL, decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at
  RETURNING * INTO e;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.extra_added', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'extra_id', e.id, 'catalog_id', c.id,
                             'quantity', e.quantity, 'rate', e.rate));
  -- The rate is cost: only a reader of cost gets it back.
  IF public.can_read_commercial_cost(u) THEN RETURN to_jsonb(e); END IF;
  RETURN to_jsonb(e) - 'rate';
END $$;
REVOKE ALL ON FUNCTION public.pricing_add_extra(uuid, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_add_extra(uuid, uuid, numeric, numeric) TO authenticated;
