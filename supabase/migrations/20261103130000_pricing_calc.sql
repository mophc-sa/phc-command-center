-- =============================================================================
-- Pricing loop, part 4: installation cost and the extras that must not be missed.
-- "If I miss one of these items I lose its value" (meeting 75 [01:17]): every
-- suggestion must be accepted or dismissed (with a reason) before a price can
-- be proposed. The guard lives on internal_prices in the next migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pricing_installation_cost(
  _type public.install_type, _weight_kg numeric, _mount_height_m numeric,
  _floor_cut boolean, _on date DEFAULT current_date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.base_rate
       + r.per_kg_over * greatest(0, coalesce(_weight_kg,0) - coalesce(r.weight_threshold_kg, coalesce(_weight_kg,0)))
       + r.per_m_over  * greatest(0, coalesce(_mount_height_m,0) - coalesce(r.height_threshold_m, coalesce(_mount_height_m,0)))
       + CASE WHEN coalesce(_floor_cut,false) THEN r.floor_cut_add ELSE 0 END
       + CASE WHEN _type = 'ceiling' AND r.height_threshold_m IS NOT NULL
                   AND coalesce(_mount_height_m,0) > r.height_threshold_m THEN r.scaffold_add ELSE 0 END
    FROM public.installation_rates r
   WHERE r.install_type = _type
     AND r.effective_from <= _on AND (r.effective_to IS NULL OR r.effective_to > _on)
     AND public.can_read_commercial_cost(auth.uid())
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.pricing_installation_cost(public.install_type, numeric, numeric, boolean, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_installation_cost(public.install_type, numeric, numeric, boolean, date) TO authenticated;

CREATE TABLE IF NOT EXISTS public.pricing_file_extras (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id        uuid NOT NULL REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  catalog_id     uuid NOT NULL REFERENCES public.pricing_extras_catalog(id) ON DELETE RESTRICT,
  quantity       numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  rate           numeric(14,2) NOT NULL CHECK (rate >= 0),
  status         text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','accepted','dismissed')),
  dismiss_reason text,
  source_line_id uuid REFERENCES public.boq_lines(id) ON DELETE SET NULL,
  decided_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_file_extras_dismiss_reason CHECK (status <> 'dismissed' OR length(btrim(coalesce(dismiss_reason,''))) > 0)
);
-- One suggestion per catalog item per file; accepting more is a quantity.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_file_extras_one_per_item ON public.pricing_file_extras (file_id, catalog_id);
ALTER TABLE public.pricing_file_extras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_file_extras FROM anon, authenticated;
GRANT SELECT ON public.pricing_file_extras TO authenticated;
GRANT ALL ON public.pricing_file_extras TO service_role;
DROP POLICY IF EXISTS "Cost holders read file extras" ON public.pricing_file_extras;
CREATE POLICY "Cost holders read file extras" ON public.pricing_file_extras FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost(auth.uid()));

CREATE OR REPLACE FUNCTION public.pricing_suggest_extras(_file_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; n integer;
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_approve_final_price(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state::text NOT IN ('boq_frozen','at_supplier','supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Extras can only be suggested after the BOQ is frozen and before the price goes to review. | لا يمكن اقتراح البنود الإضافية إلا بعد تجميد الكميات وقبل إرسال السعر للمراجعة.' USING ERRCODE = 'P0001';
  END IF;
  IF f.boq_revision_id IS NULL THEN
    RAISE EXCEPTION 'The file has no BOQ revision yet. | لا يوجد إصدار كميات في الملف بعد.' USING ERRCODE = '23514';
  END IF;
  -- Undecided suggestions from an older revision must not block Propose forever.
  DELETE FROM public.pricing_file_extras x
   WHERE x.file_id = f.id AND x.status = 'suggested'
     AND (x.source_line_id IS NULL
          OR x.source_line_id NOT IN (SELECT l.id FROM public.boq_lines l WHERE l.revision_id = f.boq_revision_id));
  WITH hits AS (
    SELECT DISTINCT ON (c.id) c.id AS catalog_id, c.default_rate, l.id AS line_id
      FROM public.boq_lines l
      JOIN public.pricing_extras_catalog c ON c.active
       AND ((l.install_type IS NOT NULL AND l.install_type = ANY (c.suggest_for))
            OR (c.suggest_min_height_m IS NOT NULL AND coalesce(l.mount_height_m,0) >= c.suggest_min_height_m))
     WHERE l.revision_id = f.boq_revision_id
     ORDER BY c.id, l.line_number NULLS LAST
  ), ins AS (
    INSERT INTO public.pricing_file_extras (file_id, catalog_id, rate, source_line_id)
    SELECT f.id, h.catalog_id, h.default_rate, h.line_id FROM hits h
    ON CONFLICT (file_id, catalog_id) DO NOTHING
    RETURNING 1)
  SELECT count(*)::int INTO n FROM ins;
  IF n > 0 THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
    VALUES (u, 'user', 'pricing_file.extras_suggested', 'opportunity', f.opportunity_id,
            jsonb_build_object('file_id', f.id, 'count', n));
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pricing_suggest_extras(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_suggest_extras(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_decide_extra(_extra_id uuid, _accept boolean,
  _quantity numeric DEFAULT NULL, _rate numeric DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); e public.pricing_file_extras; f public.pricing_files;
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_approve_final_price(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  IF (_quantity IS NOT NULL AND _quantity < 0) OR (_rate IS NOT NULL AND _rate < 0) THEN
    RAISE EXCEPTION 'Quantity and rate cannot be negative. | الكمية والسعر لا يمكن أن يكونا سالبين.' USING ERRCODE = '23514';
  END IF;
  IF NOT _accept AND length(btrim(coalesce(_reason,''))) = 0 THEN
    RAISE EXCEPTION 'Say why this item is not needed. | اذكر سبب عدم الحاجة لهذا البند.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO e FROM public.pricing_file_extras WHERE id = _extra_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown item. | البند غير موجود.' USING ERRCODE = '23514'; END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = e.file_id FOR SHARE;
  IF f.state::text NOT IN ('supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Extras are locked once the price is under review. | البنود الإضافية تُقفل بعد إرسال السعر للمراجعة.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.pricing_file_extras
     SET status = CASE WHEN _accept THEN 'accepted' ELSE 'dismissed' END,
         quantity = coalesce(_quantity, quantity), rate = coalesce(_rate, rate),
         dismiss_reason = CASE WHEN _accept THEN NULL ELSE btrim(_reason) END,
         decided_by = u, decided_at = now()
   WHERE id = _extra_id RETURNING * INTO e;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.extra_decided', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', e.file_id, 'extra_id', e.id, 'catalog_id', e.catalog_id,
                             'status', e.status, 'quantity', e.quantity, 'rate', e.rate,
                             'dismiss_reason', e.dismiss_reason));
  RETURN to_jsonb(e);
END $$;
REVOKE ALL ON FUNCTION public.pricing_decide_extra(uuid, boolean, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_decide_extra(uuid, boolean, numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_open_suggestions(_file_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_read_commercial_cost(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*)::int FROM public.pricing_file_extras WHERE file_id = _file_id AND status = 'suggested');
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_open_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_open_suggestions(uuid) TO authenticated;
