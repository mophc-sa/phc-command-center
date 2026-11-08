-- =============================================================================
-- Pricing loop PR 2, part 3: what /pricing/settings edits, and the inputs a
-- pricing file carries into the selling price (spec §3, §4.3).
--
-- * Two pricing defaults live beside the logistics rates (one key/value table,
--   one settings card, one audit trigger): the installation fallback % (PR 1
--   had nowhere to keep it: logistics_rates.key has a closed CHECK) and the
--   default margin on price. Each value says since when it is in force; its
--   history is the audit_log rows pricing_settings_audit already writes.
-- * Margin settings are not cost rates (Mo, 2026-11-03): the global default
--   margin and the margin floor are changed by the GM (Kalas) or finance
--   (Zayed), not by an estimation-only pricer. can_set_pricing_margins() is
--   that one predicate. The fallback %, the other rates and the catalog stay
--   with any pricer. A file's own default margin is a selling input: the GM's.
-- * The extras catalog gains "suggest for a cinema project" (spec §3) and the
--   same in-force date for its default rate. The suggester does not read the
--   flag yet: the cinema suggestion is Task 4's.
-- * Installation rates already have date ranges (PR 1). Changing one is a
--   close-and-open, done in one call so two people cannot leave a gap.
-- * The margin floor (Phase 8 margin_policies): one call closes the floor in
--   force and opens the new one; it is the only way the floor changes (direct
--   INSERT/UPDATE on margin_policies is revoked).
-- * pricing_file_inputs: per file, cost inputs (logistics, overhead, cinema)
--   for a pricer or the GM, and the default margin for the GM alone.
-- Lock order stays estimation -> price -> file; nothing here takes a price lock.
-- =============================================================================

-- 0. Who may change the margin settings. has_role / can_approve_final_price
-- already require an active profile and, for GM and finance, an aal2 session.
CREATE OR REPLACE FUNCTION public.can_set_pricing_margins(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- coalesce: belt and braces; has_app_access itself now fails closed (0b below).
  SELECT coalesce(_user_id IS NOT NULL
     AND (public.can_approve_final_price(_user_id)
          OR public.has_role(_user_id, 'finance_manager'::public.app_role)), false);
$$;
REVOKE ALL ON FUNCTION public.can_set_pricing_margins(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_set_pricing_margins(uuid) TO authenticated;
COMMENT ON FUNCTION public.can_set_pricing_margins IS
  'Who may change the global default margin and the margin floor: the GM (or a price-authority delegate) and finance (Mo, 2026-11-03). An estimation-only pricer may not; a file''s own default margin stays the GM''s.';

-- 0b. Fail closed. has_app_access was NULL, not false, for an MFA-role user whose
-- JWT carries no aal claim (auth.jwt()->>'aal' is NULL), and every predicate built
-- on it (is_pricer, can_approve_final_price, can_read_commercial_cost,
-- is_active_user) inherited the NULL, so an `IF NOT pred(u)` gate let the call
-- through. Same body as 20260928100000, wrapped in coalesce(..., false).
CREATE OR REPLACE FUNCTION public.has_app_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND status = 'active')
    AND (NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id
      AND role IN ('general_manager','finance_manager','sales_manager','system_admin','managing_director')
    ) OR (auth.uid() = _user_id AND auth.jwt()->>'aal' = 'aal2')), false);
$$;
REVOKE ALL ON FUNCTION public.has_app_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_app_access(uuid) TO authenticated, service_role;

-- 0c. The screens learn the margin right from the same call as the others
-- (Task 1's body plus can_set_margins).
CREATE OR REPLACE FUNCTION public.pricing_my_rights()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'is_pricer',       coalesce(public.is_pricer(auth.uid()), false),
    'is_gm',           coalesce(public.can_approve_final_price(auth.uid()), false),
    'can_read_cost',   coalesce(public.can_read_commercial_cost(auth.uid()), false),
    'can_set_margins', coalesce(public.can_set_pricing_margins(auth.uid()), false));
$$;
REVOKE ALL ON FUNCTION public.pricing_my_rights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_my_rights() TO authenticated;

-- 0d. The floor changes only through pricing_set_margin_floor (rationale, audit,
-- contiguity). Nothing in src/ or supabase/functions writes the table directly.
-- SELECT stays; the SECURITY DEFINER RPC does not need the grants.
REVOKE INSERT, UPDATE ON public.margin_policies FROM authenticated;

-- 1. Two pricing defaults beside the logistics rates.
ALTER TABLE public.logistics_rates DROP CONSTRAINT IF EXISTS logistics_rates_key_check;
ALTER TABLE public.logistics_rates ADD CONSTRAINT logistics_rates_key_check CHECK (key IN (
  'container_rate','customs_pct','clearing_fee','delivery_jeddah','delivery_riyadh',
  'install_fallback_pct','default_margin_pct'));
ALTER TABLE public.logistics_rates DROP CONSTRAINT IF EXISTS logistics_rates_pct_below_100;
ALTER TABLE public.logistics_rates ADD CONSTRAINT logistics_rates_pct_below_100
  CHECK (key NOT IN ('customs_pct','install_fallback_pct','default_margin_pct') OR value < 100);
ALTER TABLE public.logistics_rates ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT current_date;
INSERT INTO public.logistics_rates (key, value, currency, note) VALUES
  ('install_fallback_pct', 10, '%', 'Installation as a % of materials when a line has no type or no rate in force. Plan default, confirm with Zayed'),
  ('default_margin_pct',   25, '%', 'Starting margin on price for a line with none set. Plan default, confirm with Kalas')
ON CONFLICT (key) DO NOTHING;
COMMENT ON TABLE public.logistics_rates IS
  'Logistics defaults (container, customs %, clearing, inland delivery) and two pricing defaults (install_fallback_pct, default_margin_pct). Cost: cost holders read, pricers edit the rates and the fallback %; the GM or finance edit default_margin_pct. effective_from = in force since; history in audit_log.';

-- Same as PR 1, plus the in-force date when the value changes.
CREATE OR REPLACE FUNCTION public.logistics_rates_stamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := pg_catalog.now();
  NEW.effective_from := CASE WHEN NEW.value IS DISTINCT FROM OLD.value THEN current_date ELSE OLD.effective_from END;
  RETURN NEW;
END $$;

-- Who may edit which key. RLS lets a pricer or a margin setter reach the table;
-- this says which row each may change, and answers with 42501 (RLS alone would
-- silently skip the row). It fires before logistics_rates_stamp (name order).
-- A job with no session (migration, service role) is not a user and passes.
CREATE OR REPLACE FUNCTION public.logistics_rates_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL THEN RETURN NEW; END IF;
  IF 'default_margin_pct' IN (OLD.key, NEW.key) THEN
    IF NOT public.can_set_pricing_margins(u) THEN
      RAISE EXCEPTION 'Only the GM or finance change the default margin. | الهامش الافتراضي يغيّره المدير العام أو المالية.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT coalesce(public.is_pricer(u), false) THEN
    RAISE EXCEPTION 'Only estimation or finance change cost rates. | أسعار التكلفة يغيّرها التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.logistics_rates_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS logistics_rates_guard ON public.logistics_rates;
CREATE TRIGGER logistics_rates_guard BEFORE UPDATE ON public.logistics_rates
  FOR EACH ROW EXECUTE FUNCTION public.logistics_rates_guard();

-- The PR 1 policy admitted pricers only; the GM must reach the margin row too.
-- The guard trigger narrows each person to the keys they own.
DROP POLICY IF EXISTS "Pricers write logistics_rates" ON public.logistics_rates;
DROP POLICY IF EXISTS "Pricers and margin setters write logistics_rates" ON public.logistics_rates;
CREATE POLICY "Pricers and margin setters write logistics_rates" ON public.logistics_rates FOR UPDATE TO authenticated
  USING (public.is_pricer(auth.uid()) OR public.can_set_pricing_margins(auth.uid()))
  WITH CHECK (public.is_pricer(auth.uid()) OR public.can_set_pricing_margins(auth.uid()));

-- 2. Catalog: the cinema suggestion and the in-force date of the default rate.
ALTER TABLE public.pricing_extras_catalog
  ADD COLUMN IF NOT EXISTS suggest_if_cinema boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT current_date;
CREATE OR REPLACE FUNCTION public.pricing_extras_catalog_stamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.effective_from := current_date;
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.effective_from := CASE WHEN NEW.default_rate IS DISTINCT FROM OLD.default_rate
                               THEN current_date ELSE OLD.effective_from END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_extras_catalog_stamp() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pricing_extras_catalog_stamp ON public.pricing_extras_catalog;
CREATE TRIGGER pricing_extras_catalog_stamp BEFORE INSERT OR UPDATE ON public.pricing_extras_catalog
  FOR EACH ROW EXECUTE FUNCTION public.pricing_extras_catalog_stamp();

-- 3. Change an installation rate from a date, in one call.
CREATE OR REPLACE FUNCTION public.pricing_set_installation_rate(
  _type public.install_type, _from date, _base_rate numeric,
  _per_kg_over numeric DEFAULT 0, _weight_threshold_kg numeric DEFAULT NULL,
  _per_m_over numeric DEFAULT 0, _height_threshold_m numeric DEFAULT NULL,
  _floor_cut_add numeric DEFAULT 0, _scaffold_add numeric DEFAULT 0, _crane_add numeric DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); r public.installation_rates;
BEGIN
  IF NOT coalesce(public.is_pricer(u), false) THEN
    RAISE EXCEPTION 'Only estimation or finance set installation rates. | أسعار التركيب يضعها التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  IF _type IS NULL OR _from IS NULL OR _from < current_date THEN
    RAISE EXCEPTION 'A rate starts today or later. | يبدأ السعر اليوم أو بعده.' USING ERRCODE = '23514';
  END IF;
  IF _base_rate IS NULL OR _base_rate < 0
     OR least(coalesce(_per_kg_over,0), coalesce(_per_m_over,0), coalesce(_floor_cut_add,0),
              coalesce(_scaffold_add,0), coalesce(_crane_add,0)) < 0
     OR coalesce(_weight_threshold_kg,0) < 0 OR coalesce(_height_threshold_m,0) < 0 THEN
    RAISE EXCEPTION 'Rates and thresholds cannot be negative. | الأسعار والحدود لا تكون سالبة.' USING ERRCODE = '23514';
  END IF;
  -- One type's rates are a chain of dates; serialize changes to that type.
  PERFORM pg_advisory_xact_lock(hashtext('installation_rates:' || _type::text));
  IF EXISTS (SELECT 1 FROM public.installation_rates WHERE install_type = _type AND effective_from > _from) THEN
    RAISE EXCEPTION 'A later rate for this type is already set; change that one. | يوجد سعر لاحق لهذا النوع؛ عدّله هو.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO r FROM public.installation_rates WHERE install_type = _type AND effective_from = _from;
  IF FOUND THEN
    UPDATE public.installation_rates
       SET base_rate = _base_rate, per_kg_over = coalesce(_per_kg_over,0), weight_threshold_kg = _weight_threshold_kg,
           per_m_over = coalesce(_per_m_over,0), height_threshold_m = _height_threshold_m,
           floor_cut_add = coalesce(_floor_cut_add,0), scaffold_add = coalesce(_scaffold_add,0),
           crane_add = coalesce(_crane_add,0)
     WHERE id = r.id RETURNING * INTO r;
  ELSE
    UPDATE public.installation_rates SET effective_to = _from
     WHERE install_type = _type AND effective_from < _from AND (effective_to IS NULL OR effective_to > _from);
    INSERT INTO public.installation_rates (install_type, base_rate, per_kg_over, weight_threshold_kg, per_m_over,
                                           height_threshold_m, floor_cut_add, scaffold_add, crane_add, effective_from)
    VALUES (_type, _base_rate, coalesce(_per_kg_over,0), _weight_threshold_kg, coalesce(_per_m_over,0),
            _height_threshold_m, coalesce(_floor_cut_add,0), coalesce(_scaffold_add,0), coalesce(_crane_add,0), _from)
    RETURNING * INTO r;
  END IF;
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.pricing_set_installation_rate(public.install_type, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_set_installation_rate(public.install_type, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated;

-- 4. The margin floor is Kalas' or finance's (not an estimation-only pricer's).
-- Within one moment a second change corrects the first (a policy cannot start
-- and end at the same instant).
CREATE OR REPLACE FUNCTION public.pricing_set_margin_floor(_min_margin_pct numeric, _rationale text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); m public.margin_policies;
BEGIN
  IF NOT coalesce(public.can_set_pricing_margins(u), false) THEN
    RAISE EXCEPTION 'Only the GM or finance set the margin floor. | الحد الأدنى للهامش يضعه المدير العام أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _min_margin_pct IS NULL OR _min_margin_pct < -100 OR _min_margin_pct > 100
     OR length(btrim(coalesce(_rationale,''))) = 0 THEN
    RAISE EXCEPTION 'Give a floor between -100 and 100 and say why. | حدد حداً بين -100 و100 واذكر السبب.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('margin_policies'));
  IF EXISTS (SELECT 1 FROM public.margin_policies WHERE effective_from > now()) THEN
    RAISE EXCEPTION 'A future floor is already set. | يوجد حد مستقبلي محدد.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO m FROM public.margin_policies WHERE effective_from = now();
  IF FOUND THEN
    UPDATE public.margin_policies SET min_margin_pct = _min_margin_pct, rationale = btrim(_rationale), created_by = u
     WHERE id = m.id RETURNING * INTO m;
  ELSE
    UPDATE public.margin_policies SET effective_to = now()
     WHERE effective_from < now() AND (effective_to IS NULL OR effective_to > now());
    INSERT INTO public.margin_policies (min_margin_pct, effective_from, rationale, created_by)
    VALUES (_min_margin_pct, now(), btrim(_rationale), u) RETURNING * INTO m;
  END IF;
  -- The floor is read by cost holders only (Phase 8); the audit row points at
  -- the policy row, which keeps the figure and the reason.
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'margin_policy.set', 'margin_policy', m.id,
          jsonb_build_object('margin_policy_id', m.id));
  RETURN to_jsonb(m);
END $$;
REVOKE ALL ON FUNCTION public.pricing_set_margin_floor(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_set_margin_floor(numeric, text) TO authenticated;

-- 5. The inputs a file carries into the selling price.
CREATE TABLE IF NOT EXISTS public.pricing_file_inputs (
  file_id            uuid PRIMARY KEY REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  is_cinema          boolean NOT NULL DEFAULT false,
  containers         numeric(8,2) NOT NULL DEFAULT 0 CHECK (containers >= 0),
  delivery           text NOT NULL DEFAULT 'none' CHECK (delivery IN ('none','jeddah','riyadh')),
  clearing           boolean NOT NULL DEFAULT false,
  overhead_pct       numeric(5,2) NOT NULL DEFAULT 0 CHECK (overhead_pct >= 0 AND overhead_pct < 100),
  default_margin_pct numeric(5,2) CHECK (default_margin_pct IS NULL OR (default_margin_pct > -100 AND default_margin_pct < 100)),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pricing_file_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_file_inputs FROM anon, authenticated;
GRANT SELECT ON public.pricing_file_inputs TO authenticated;
GRANT ALL ON public.pricing_file_inputs TO service_role;
DROP POLICY IF EXISTS "Cost holders read file inputs" ON public.pricing_file_inputs;
CREATE POLICY "Cost holders read file inputs" ON public.pricing_file_inputs FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid()))
         AND EXISTS (SELECT 1 FROM public.pricing_files f WHERE f.id = file_id
                      AND (public.is_pricer((SELECT auth.uid())) OR public.can_read_boq(f.opportunity_id, (SELECT auth.uid())))));
DROP POLICY IF EXISTS audit_session_boundary ON public.pricing_file_inputs;
CREATE POLICY audit_session_boundary ON public.pricing_file_inputs AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- 6. The pricing inputs RPC. (The cinema suggestion itself is Task 4's.)
CREATE OR REPLACE FUNCTION public.pricing_file_set_inputs(_file_id uuid, _inputs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; i public.pricing_file_inputs;
        k text; was_cinema boolean;
BEGIN
  IF NOT coalesce(public.is_pricer(u) OR public.can_approve_final_price(u), false) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  -- Final review, 2026-11-08: the inputs are cost (RLS shows them to cost readers
  -- only) and the call returns them, so a GM delegate who cannot read cost may
  -- not set them either. Pricers always read cost.
  IF NOT coalesce(public.can_read_commercial_cost(u), false) THEN
    RAISE EXCEPTION 'Pricing inputs need cost access. | مُدخلات التسعير تحتاج صلاحية رؤية التكلفة.' USING ERRCODE = '42501';
  END IF;
  IF _inputs IS NULL OR jsonb_typeof(_inputs) <> 'object' THEN
    RAISE EXCEPTION 'Pricing inputs are an object. | مُدخلات التسعير كائن.' USING ERRCODE = '23514';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_inputs) LOOP
    IF k NOT IN ('is_cinema','containers','delivery','clearing','overhead_pct','default_margin_pct') THEN
      RAISE EXCEPTION 'Unknown pricing input %. | مُدخل تسعير غير معروف: %.', k, k USING ERRCODE = '23514';
    END IF;
  END LOOP;
  -- The file's margin is a selling input: the GM's alone (finance sets the
  -- global default and the floor, not the price).
  IF _inputs ? 'default_margin_pct' AND NOT coalesce(public.can_approve_final_price(u), false) THEN
    RAISE EXCEPTION 'The GM sets the margin. | الهامش يضعه المدير العام.' USING ERRCODE = '42501';
  END IF;
  IF (_inputs ? 'is_cinema' AND jsonb_typeof(_inputs->'is_cinema') <> 'boolean')
     OR (_inputs ? 'clearing' AND jsonb_typeof(_inputs->'clearing') <> 'boolean')
     OR (_inputs ? 'containers' AND jsonb_typeof(_inputs->'containers') <> 'number')
     OR (_inputs ? 'overhead_pct' AND jsonb_typeof(_inputs->'overhead_pct') <> 'number')
     OR (_inputs ? 'default_margin_pct' AND jsonb_typeof(_inputs->'default_margin_pct') NOT IN ('number','null'))
     OR (_inputs ? 'delivery' AND coalesce(_inputs->>'delivery','') NOT IN ('none','jeddah','riyadh')) THEN
    RAISE EXCEPTION 'A pricing input has the wrong type. | نوع أحد مُدخلات التسعير غير صحيح.' USING ERRCODE = '23514';
  END IF;
  -- Ranges as the table's columns allow them, so a bad number is 23514, not a numeric overflow.
  IF (_inputs ? 'containers' AND ((_inputs->>'containers')::numeric < 0 OR (_inputs->>'containers')::numeric >= 1000000))
     OR (_inputs ? 'overhead_pct' AND ((_inputs->>'overhead_pct')::numeric < 0 OR (_inputs->>'overhead_pct')::numeric >= 100))
     OR (_inputs ? 'default_margin_pct' AND jsonb_typeof(_inputs->'default_margin_pct') = 'number'
         AND ((_inputs->>'default_margin_pct')::numeric <= -100 OR (_inputs->>'default_margin_pct')::numeric >= 100)) THEN
    RAISE EXCEPTION 'A pricing input is out of range. | أحد مُدخلات التسعير خارج النطاق.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state::text NOT IN ('boq_frozen','at_supplier','supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Pricing inputs are set after the BOQ is frozen and before the price goes to review. | تُضبط مُدخلات التسعير بعد تجميد الكميات وقبل إرسال السعر للمراجعة.'
      USING ERRCODE = 'P0001';
  END IF;
  IF _inputs ? 'default_margin_pct' AND f.state <> 'selling_build' THEN
    RAISE EXCEPTION 'The margin is set in the selling build. | يُضبط الهامش في مرحلة بناء سعر البيع.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.pricing_file_inputs (file_id, updated_by) VALUES (f.id, u) ON CONFLICT (file_id) DO NOTHING;
  SELECT x.is_cinema INTO was_cinema FROM public.pricing_file_inputs x WHERE x.file_id = f.id FOR UPDATE;
  UPDATE public.pricing_file_inputs SET
    is_cinema          = CASE WHEN _inputs ? 'is_cinema' THEN (_inputs->>'is_cinema')::boolean ELSE is_cinema END,
    containers         = CASE WHEN _inputs ? 'containers' THEN (_inputs->>'containers')::numeric ELSE containers END,
    delivery           = CASE WHEN _inputs ? 'delivery' THEN _inputs->>'delivery' ELSE delivery END,
    clearing           = CASE WHEN _inputs ? 'clearing' THEN (_inputs->>'clearing')::boolean ELSE clearing END,
    overhead_pct       = CASE WHEN _inputs ? 'overhead_pct' THEN (_inputs->>'overhead_pct')::numeric ELSE overhead_pct END,
    default_margin_pct = CASE WHEN _inputs ? 'default_margin_pct' THEN (_inputs->>'default_margin_pct')::numeric ELSE default_margin_pct END,
    updated_by = u, updated_at = now()
   WHERE file_id = f.id RETURNING * INTO i;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.inputs_set', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id,
                             'keys', (SELECT jsonb_agg(x ORDER BY x) FROM jsonb_object_keys(_inputs) x)));
  -- A file with no BOQ revision yet has nothing to suggest against.
  IF i.is_cinema IS DISTINCT FROM was_cinema AND f.boq_revision_id IS NOT NULL THEN
    PERFORM public.pricing_suggest_extras(f.id);
  END IF;
  RETURN to_jsonb(i);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_set_inputs(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_set_inputs(uuid, jsonb) TO authenticated;
