-- =============================================================================
-- Pricing loop PR 2, part 5: the selling grid (spec §3).
--
-- One row per BOQ line: materials from the supplier (normal or with-screen),
-- installation from the rate card (or the % fallback), the project's extras
-- and logistics spread over the lines by value, overhead, then the selling
-- price from a margin ON PRICE (Phase 8's convention) or a typed price. A
-- totals row per file computes cost exactly as Phase 8's estimation_cost_basis
-- will from the estimation pricing_file_build_price writes (next migration),
-- so the margin Kalas sees is the margin the price will carry.
--
-- Who sets what (Mo, 2026-11-03: Kalas sets the price, Zayed reviews it):
--   cost choices (screen or normal price, install-type override): a pricer or the GM;
--   selling choices (margin %, typed selling price): the GM alone.
-- Both views run as the owner and gate on cost access in their WHERE, like
-- boq_line_costs and supplier_quote_costs. Reps and the BD manager get no rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pricing_file_lines (
  file_id             uuid NOT NULL REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  boq_line_id         uuid NOT NULL REFERENCES public.boq_lines(id) ON DELETE RESTRICT,
  use_screen_price    boolean,
  install_type        public.install_type,
  margin_pct          numeric(5,2) CHECK (margin_pct IS NULL OR (margin_pct > -100 AND margin_pct < 100)),
  selling_price       numeric(16,2) CHECK (selling_price IS NULL OR selling_price >= 0),
  built_cost          numeric(16,2),
  built_selling_price numeric(16,2),
  built_at            timestamptz,
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, boq_line_id),
  CONSTRAINT pricing_file_lines_one_selling_rule CHECK (margin_pct IS NULL OR selling_price IS NULL)
);
COMMENT ON COLUMN public.pricing_file_lines.use_screen_price IS
  'NULL follows boq_lines.has_screen. Zayed picks the normal or with-screen supplier price when both exist (spec §3).';
COMMENT ON COLUMN public.pricing_file_lines.built_selling_price IS
  'The line''s selling price when the GM last built the price (pricing_file_build_price): the per-line figures behind the internal price, for the quotation (PR 4).';
ALTER TABLE public.pricing_file_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_file_lines FROM anon, authenticated;
GRANT SELECT ON public.pricing_file_lines TO authenticated;
GRANT ALL ON public.pricing_file_lines TO service_role;
DROP POLICY IF EXISTS "Cost holders read file lines" ON public.pricing_file_lines;
CREATE POLICY "Cost holders read file lines" ON public.pricing_file_lines FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid()))
         AND EXISTS (SELECT 1 FROM public.pricing_files f WHERE f.id = file_id
                      AND (public.is_pricer((SELECT auth.uid())) OR public.can_read_boq(f.opportunity_id, (SELECT auth.uid())))));
DROP POLICY IF EXISTS audit_session_boundary ON public.pricing_file_lines;
CREATE POLICY audit_session_boundary ON public.pricing_file_lines AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

CREATE OR REPLACE FUNCTION public.pricing_file_set_line(_file_id uuid, _boq_line_id uuid, _choice jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; l public.pricing_file_lines; k text;
        selling_keys boolean;
BEGIN
  IF NOT coalesce(public.is_pricer(u) OR public.can_approve_final_price(u), false) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  IF _choice IS NULL OR jsonb_typeof(_choice) <> 'object' THEN
    RAISE EXCEPTION 'A line choice is an object. | اختيار البند كائن.' USING ERRCODE = '23514';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_choice) LOOP
    IF k NOT IN ('use_screen_price','install_type','margin_pct','selling_price') THEN
      RAISE EXCEPTION 'Unknown line choice %. | اختيار غير معروف: %.', k, k USING ERRCODE = '23514';
    END IF;
  END LOOP;
  selling_keys := _choice ? 'margin_pct' OR _choice ? 'selling_price';
  IF selling_keys AND NOT coalesce(public.can_approve_final_price(u), false) THEN
    RAISE EXCEPTION 'The GM sets margins and selling prices. | الهوامش وأسعار البيع يضعها المدير العام.' USING ERRCODE = '42501';
  END IF;
  IF (_choice ? 'use_screen_price' AND jsonb_typeof(_choice->'use_screen_price') NOT IN ('boolean','null'))
     OR (_choice ? 'margin_pct' AND jsonb_typeof(_choice->'margin_pct') NOT IN ('number','null'))
     OR (_choice ? 'selling_price' AND jsonb_typeof(_choice->'selling_price') NOT IN ('number','null'))
     OR (_choice ? 'install_type' AND jsonb_typeof(_choice->'install_type') NOT IN ('string','null'))
     OR (nullif(_choice->>'install_type','') IS NOT NULL
         AND NOT ((_choice->>'install_type') = ANY (enum_range(NULL::public.install_type)::text[]))) THEN
    RAISE EXCEPTION 'A line choice has the wrong type. | نوع أحد اختيارات البند غير صحيح.' USING ERRCODE = '23514';
  END IF;
  IF (jsonb_typeof(_choice->'margin_pct') = 'number'
      AND ((_choice->>'margin_pct')::numeric <= -100 OR (_choice->>'margin_pct')::numeric >= 100))
     OR (jsonb_typeof(_choice->'selling_price') = 'number'
         AND ((_choice->>'selling_price')::numeric < 0 OR (_choice->>'selling_price')::numeric >= 100000000000000)) THEN
    RAISE EXCEPTION 'A line choice is out of range. | أحد اختيارات البند خارج النطاق.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(_choice->'margin_pct') = 'number' AND jsonb_typeof(_choice->'selling_price') = 'number' THEN
    RAISE EXCEPTION 'A line has a margin or a selling price, not both. | للبند هامش أو سعر بيع، لا الاثنان.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state::text NOT IN ('supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Line choices are made after the supplier has priced and before review. | تُضبط اختيارات البنود بعد تسعير المورد وقبل المراجعة.' USING ERRCODE = 'P0001';
  END IF;
  IF selling_keys AND f.state <> 'selling_build' THEN
    RAISE EXCEPTION 'Margins are set in the selling build. | تُضبط الهوامش في مرحلة بناء سعر البيع.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.boq_lines bl WHERE bl.id = _boq_line_id AND bl.revision_id = f.boq_revision_id) THEN
    RAISE EXCEPTION 'That line is not in this file''s BOQ. | هذا البند ليس في كميات هذا الملف.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.pricing_file_lines (file_id, boq_line_id, updated_by) VALUES (f.id, _boq_line_id, u)
  ON CONFLICT (file_id, boq_line_id) DO NOTHING;
  UPDATE public.pricing_file_lines SET
    use_screen_price = CASE WHEN _choice ? 'use_screen_price' THEN (_choice->>'use_screen_price')::boolean ELSE use_screen_price END,
    install_type     = CASE WHEN _choice ? 'install_type' THEN (nullif(_choice->>'install_type',''))::public.install_type ELSE install_type END,
    margin_pct       = CASE WHEN _choice ? 'margin_pct' THEN (_choice->>'margin_pct')::numeric
                            WHEN _choice ? 'selling_price' AND _choice->>'selling_price' IS NOT NULL THEN NULL
                            ELSE margin_pct END,
    selling_price    = CASE WHEN _choice ? 'selling_price' THEN (_choice->>'selling_price')::numeric
                            WHEN _choice ? 'margin_pct' AND _choice->>'margin_pct' IS NOT NULL THEN NULL
                            ELSE selling_price END,
    updated_by = u, updated_at = now()
   WHERE file_id = f.id AND boq_line_id = _boq_line_id
  RETURNING * INTO l;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.line_set', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'boq_line_id', _boq_line_id, 'choice', _choice));
  RETURN to_jsonb(l);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_set_line(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_set_line(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE VIEW public.pricing_selling_grid WITH (security_barrier = true) AS
WITH base AS (
  SELECT f.id AS file_id, f.boq_revision_id,
         bl.id AS boq_line_id, bl.line_number, bl.sign_type, bl.description, bl.quantity, bl.unit, bl.has_screen,
         sq.id AS supplier_quote_line_id, sq.unit_cost, sq.unit_cost_with_screen, sq.alternate_spec,
         coalesce(sq.quotes_count, 0)::int AS quotes_count,
         coalesce(pl.use_screen_price, bl.has_screen) AS use_screen_price,
         coalesce(pl.install_type, bl.install_type) AS install_type,
         pl.margin_pct AS line_margin_pct,
         pl.selling_price AS typed_selling_price,
         pl.built_cost, pl.built_selling_price,
         coalesce(i.overhead_pct, 0) AS overhead_pct,
         coalesce(i.default_margin_pct, s.default_margin_pct, 0) AS default_margin_pct,
         coalesce(s.fallback_pct, 0) AS fallback_pct,
         CASE WHEN sq.id IS NULL THEN NULL
              WHEN coalesce(pl.use_screen_price, bl.has_screen) AND sq.unit_cost_with_screen IS NOT NULL
                THEN sq.unit_cost_with_screen
              ELSE sq.unit_cost END AS unit_material,
         public.pricing_installation_cost(coalesce(pl.install_type, bl.install_type), bl.weight_kg,
                                          bl.mount_height_m, bl.needs_floor_cut) AS unit_install
    FROM public.pricing_files f
    JOIN public.boq_lines bl ON bl.revision_id = f.boq_revision_id
    LEFT JOIN public.pricing_file_lines pl ON pl.file_id = f.id AND pl.boq_line_id = bl.id
    LEFT JOIN public.pricing_file_inputs i ON i.file_id = f.id
    CROSS JOIN LATERAL (
      SELECT (SELECT r.value FROM public.logistics_rates r WHERE r.key = 'install_fallback_pct') AS fallback_pct,
             (SELECT r.value FROM public.logistics_rates r WHERE r.key = 'default_margin_pct') AS default_margin_pct) s
    LEFT JOIN LATERAL (
      SELECT l.id, l.unit_cost, l.unit_cost_with_screen, l.alternate_spec, count(*) OVER () AS quotes_count
        FROM public.supplier_quote_lines l
        JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
       WHERE l.boq_line_id = bl.id AND q.boq_revision_id = f.boq_revision_id
         AND q.is_current AND q.status NOT IN ('cancelled','superseded')
       ORDER BY q.created_at DESC, l.created_at DESC
       LIMIT 1) sq ON TRUE
   WHERE public.can_read_commercial_cost((SELECT auth.uid()))
     AND (public.is_pricer((SELECT auth.uid())) OR public.can_read_boq(f.opportunity_id, (SELECT auth.uid())))
), priced AS (
  SELECT b.*,
         round(b.unit_material * b.quantity, 2) AS materials,
         round(CASE WHEN b.unit_install IS NOT NULL THEN b.unit_install * b.quantity
                    ELSE coalesce(b.unit_material, 0) * b.quantity * b.fallback_pct / 100 END, 2) AS installation,
         CASE WHEN b.unit_install IS NOT NULL THEN 'rate' ELSE 'fallback' END AS install_basis
    FROM base b
), spread AS (
  SELECT p.*,
         sum(coalesce(p.materials, 0) + p.installation) OVER w AS value_total,
         sum(coalesce(p.materials, 0)) OVER w AS goods_total,
         count(*) OVER w AS line_count
    FROM priced p
  WINDOW w AS (PARTITION BY p.file_id)
), costed AS (
  SELECT s.*, ex.extras_total, lg.logistics_total,
         CASE WHEN s.value_total > 0 THEN (coalesce(s.materials, 0) + s.installation) / s.value_total
              ELSE 1.0 / s.line_count END AS share
    FROM spread s
    CROSS JOIN LATERAL (
      SELECT round(coalesce(sum(x.quantity * x.rate), 0), 2) AS extras_total
        FROM public.pricing_file_extras x
       WHERE x.file_id = s.file_id AND x.boq_revision_id = s.boq_revision_id AND x.status = 'accepted') ex
    CROSS JOIN LATERAL (
      SELECT round(coalesce(fi.containers, 0) * coalesce(r.container_rate, 0)
                   + s.goods_total * coalesce(r.customs_pct, 0) / 100
                   + CASE WHEN coalesce(fi.clearing, false) THEN coalesce(r.clearing_fee, 0) ELSE 0 END
                   + CASE coalesce(fi.delivery, 'none')
                       WHEN 'jeddah' THEN coalesce(r.delivery_jeddah, 0)
                       WHEN 'riyadh' THEN coalesce(r.delivery_riyadh, 0)
                       ELSE 0 END, 2) AS logistics_total
        FROM (SELECT max(lr.value) FILTER (WHERE lr.key = 'container_rate')  AS container_rate,
                     max(lr.value) FILTER (WHERE lr.key = 'customs_pct')     AS customs_pct,
                     max(lr.value) FILTER (WHERE lr.key = 'clearing_fee')    AS clearing_fee,
                     max(lr.value) FILTER (WHERE lr.key = 'delivery_jeddah') AS delivery_jeddah,
                     max(lr.value) FILTER (WHERE lr.key = 'delivery_riyadh') AS delivery_riyadh
                FROM public.logistics_rates lr) r
        LEFT JOIN public.pricing_file_inputs fi ON fi.file_id = s.file_id) lg
)
SELECT c.file_id, c.boq_line_id, c.line_number, c.sign_type, c.description, c.quantity, c.unit, c.has_screen,
       c.supplier_quote_line_id, c.unit_cost, c.unit_cost_with_screen, c.alternate_spec, c.quotes_count,
       c.use_screen_price, c.install_type, c.install_basis,
       c.materials, c.installation,
       round(c.share * c.extras_total, 2) AS extras_alloc,
       round(c.share * c.logistics_total, 2) AS logistics_alloc,
       round(lc.line_cost, 2) AS line_cost,
       c.line_margin_pct, c.typed_selling_price, c.default_margin_pct, c.overhead_pct,
       sp.selling_price,
       CASE WHEN sp.selling_price > 0 THEN round((sp.selling_price - lc.line_cost) / sp.selling_price * 100, 2) END AS margin_pct,
       c.extras_total, c.logistics_total,
       c.built_cost, c.built_selling_price,
       (c.unit_material IS NULL) AS unpriced,
       (c.use_screen_price AND c.unit_cost_with_screen IS NULL AND c.supplier_quote_line_id IS NOT NULL) AS screen_price_missing
  FROM costed c
  CROSS JOIN LATERAL (
    SELECT (coalesce(c.materials, 0) + c.installation + c.share * c.extras_total + c.share * c.logistics_total)
           * (1 + c.overhead_pct / 100) AS line_cost) lc
  CROSS JOIN LATERAL (
    SELECT CASE WHEN c.typed_selling_price IS NOT NULL THEN c.typed_selling_price
                WHEN c.unit_material IS NULL THEN NULL
                WHEN coalesce(c.line_margin_pct, c.default_margin_pct) >= 100 THEN NULL
                ELSE round(lc.line_cost / (1 - coalesce(c.line_margin_pct, c.default_margin_pct) / 100), 2)
           END AS selling_price) sp;
REVOKE ALL ON public.pricing_selling_grid FROM anon, authenticated;
GRANT SELECT ON public.pricing_selling_grid TO authenticated;
COMMENT ON VIEW public.pricing_selling_grid IS
  'Selling price per BOQ line of a pricing file. Cost: cost readers who can read the file only. Margin on price. EXCLUDING VAT.';

CREATE OR REPLACE VIEW public.pricing_selling_totals WITH (security_barrier = true) AS
SELECT a.file_id, a.line_count, a.unpriced_lines, a.multi_quote_lines, a.screen_price_missing_lines,
       a.materials_total, a.installation_total, a.extras_total, a.logistics_total, a.overhead_pct,
       c.total_cost, a.total_selling,
       a.total_selling - c.total_cost AS margin_value,
       m.margin_pct,
       public.current_margin_floor() AS floor_pct,
       coalesce(m.margin_pct < public.current_margin_floor(), false) AS below_floor
  FROM (
    SELECT g.file_id,
           count(*)::int AS line_count,
           (count(*) FILTER (WHERE g.unpriced))::int AS unpriced_lines,
           (count(*) FILTER (WHERE g.quotes_count > 1))::int AS multi_quote_lines,
           (count(*) FILTER (WHERE g.screen_price_missing))::int AS screen_price_missing_lines,
           sum(coalesce(g.materials, 0)) AS materials_total,
           sum(g.installation) AS installation_total,
           max(g.extras_total) AS extras_total,
           max(g.logistics_total) AS logistics_total,
           max(g.overhead_pct) AS overhead_pct,
           sum(g.selling_price) AS total_selling
      FROM public.pricing_selling_grid g
     GROUP BY g.file_id) a
  CROSS JOIN LATERAL (
    SELECT a.materials_total + a.extras_total + a.logistics_total + a.installation_total AS subtotal) s
  CROSS JOIN LATERAL (
    SELECT round(s.subtotal + s.subtotal * a.overhead_pct / 100, 2) AS total_cost) c
  CROSS JOIN LATERAL (
    SELECT CASE WHEN a.total_selling > 0
                THEN round((a.total_selling - c.total_cost) / a.total_selling * 100, 2) END AS margin_pct) m;
REVOKE ALL ON public.pricing_selling_totals FROM anon, authenticated;
GRANT SELECT ON public.pricing_selling_totals TO authenticated;
COMMENT ON VIEW public.pricing_selling_totals IS
  'Totals of pricing_selling_grid per file. total_cost uses estimation_cost_basis''s expression on the estimation pricing_file_build_price writes. Cost-gated through the grid.';
