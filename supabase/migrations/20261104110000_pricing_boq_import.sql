-- =============================================================================
-- Pricing loop PR 2, part 2: BOQ lines entered in the pricing file.
--
-- Zayed checks the BOQ against the drawings and the location plan, then
-- freezes it (spec §1 package_review → boq_frozen). The Excel file is parsed
-- and mapped in the browser (src/lib/boq-import.ts); the lines arrive here as
-- JSON, are validated, and go into a DRAFT revision of the deal's BOQ, with the
-- structured attributes PR 1 added (install type, size, weight, mount height,
-- screen, floor cut). A line typed by hand is the same call with one line.
-- The freeze is the existing Phase 7A one-way door (frozen_at), stamped from
-- the session, and the move is pricing_file_move's, so its checks still run.
-- =============================================================================

-- A number as text: digits with an optional decimal part. NULL is fine.
CREATE OR REPLACE FUNCTION public._pricing_num_ok(_v text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _v IS NULL OR _v ~ '^[0-9]+(\.[0-9]+)?$';
$$;
REVOKE ALL ON FUNCTION public._pricing_num_ok(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_boq_import(_file_id uuid, _lines jsonb, _replace boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; rev public.boq_revisions;
        b_id uuid; prev uuid; next_no integer; first_no integer; n integer;
        bad_ord bigint; bad_why text[];
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may enter BOQ lines. | إدخال بنود الكميات يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Add at least one line. | أضف بنداً واحداً على الأقل.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(_lines) > 2000 THEN
    RAISE EXCEPTION 'At most 2000 lines at a time. | 2000 بند كحد أقصى في المرة.' USING ERRCODE = '23514';
  END IF;

  -- The first line that is not valid, with the reason in both languages.
  SELECT e.ord, x.why INTO bad_ord, bad_why
    FROM jsonb_array_elements(_lines) WITH ORDINALITY AS e(v, ord)
    CROSS JOIN LATERAL (SELECT CASE
      WHEN jsonb_typeof(e.v) <> 'object' THEN ARRAY['not a line','ليس بنداً']
      WHEN btrim(coalesce(e.v->>'sign_type','')) = '' THEN ARRAY['sign type is empty','نوع اللوحة فارغ']
      WHEN e.v->>'quantity' IS NULL THEN ARRAY['quantity is missing','الكمية غير موجودة']
      WHEN NOT public._pricing_num_ok(e.v->>'quantity') THEN ARRAY['quantity is not a number','الكمية ليست رقماً']
      WHEN (e.v->>'quantity')::numeric <= 0 THEN ARRAY['quantity must be above zero','الكمية يجب أن تكون أكبر من صفر']
      WHEN nullif(e.v->>'install_type','') IS NOT NULL
           AND NOT ((e.v->>'install_type') = ANY (enum_range(NULL::public.install_type)::text[]))
        THEN ARRAY['unknown install type','نوع تركيب غير معروف']
      WHEN NOT public._pricing_num_ok(nullif(e.v->>'width_mm',''))
        OR NOT public._pricing_num_ok(nullif(e.v->>'height_mm',''))
        THEN ARRAY['width and height are millimetres','العرض والارتفاع بالمليمتر']
      WHEN (nullif(e.v->>'width_mm',''))::numeric = 0 OR (nullif(e.v->>'height_mm',''))::numeric = 0
        THEN ARRAY['width and height must be above zero','العرض والارتفاع يجب أن يكونا أكبر من صفر']
      WHEN NOT public._pricing_num_ok(nullif(e.v->>'weight_kg',''))
        OR NOT public._pricing_num_ok(nullif(e.v->>'mount_height_m',''))
        THEN ARRAY['weight and mount height are numbers','الوزن وارتفاع التركيب أرقام']
      WHEN (e.v ? 'has_screen' AND jsonb_typeof(e.v->'has_screen') NOT IN ('boolean','null'))
        OR (e.v ? 'needs_floor_cut' AND jsonb_typeof(e.v->'needs_floor_cut') NOT IN ('boolean','null'))
        THEN ARRAY['screen and floor cut are yes or no','الشاشة وقص الأرضية نعم أو لا']
    END AS why) x
   WHERE x.why IS NOT NULL
   ORDER BY e.ord LIMIT 1;
  IF bad_ord IS NOT NULL THEN
    RAISE EXCEPTION 'Line % is not valid: %. | السطر % غير صالح: %.', bad_ord, bad_why[1], bad_ord, bad_why[2]
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state <> 'package_review' THEN
    RAISE EXCEPTION 'BOQ lines are entered during package review. | تُدخل بنود الكميات أثناء دراسة الباكيج.'
      USING ERRCODE = 'P0001';
  END IF;

  IF f.boq_revision_id IS NOT NULL THEN
    SELECT * INTO rev FROM public.boq_revisions WHERE id = f.boq_revision_id FOR NO KEY UPDATE;
  END IF;
  IF rev.id IS NULL OR rev.frozen_at IS NOT NULL THEN
    -- A new draft revision of the deal's BOQ, which becomes its current one.
    b_id := rev.boq_id;
    IF b_id IS NULL THEN
      SELECT b.id INTO b_id FROM public.boqs b
       WHERE b.related_opportunity_id = f.opportunity_id ORDER BY b.created_at, b.id LIMIT 1;
    END IF;
    IF b_id IS NULL THEN
      INSERT INTO public.boqs (related_opportunity_id, title, source, created_by)
      VALUES (f.opportunity_id, 'Pricing BOQ', 'pricing_file', u) RETURNING id INTO b_id;
    END IF;
    SELECT r.id INTO prev FROM public.boq_revisions r WHERE r.boq_id = b_id AND r.is_current FOR NO KEY UPDATE;
    SELECT coalesce(max(r.revision_number), 0) + 1 INTO next_no FROM public.boq_revisions r WHERE r.boq_id = b_id;
    IF prev IS NOT NULL THEN
      UPDATE public.boq_revisions SET is_current = false WHERE id = prev;
    END IF;
    INSERT INTO public.boq_revisions (boq_id, revision_number, status, source_type, notes, created_by, is_current)
    VALUES (b_id, next_no, 'draft', 'manual', 'Entered in the pricing file', u, true)
    RETURNING * INTO rev;
    IF prev IS NOT NULL THEN
      UPDATE public.boq_revisions SET superseded_by = rev.id, superseded_at = now() WHERE id = prev;
    END IF;
    UPDATE public.pricing_files SET boq_revision_id = rev.id, updated_at = now() WHERE id = f.id;
  END IF;

  IF _replace THEN
    DELETE FROM public.boq_lines WHERE revision_id = rev.id;
  END IF;
  SELECT coalesce(max(l.line_number), 0) INTO first_no FROM public.boq_lines l WHERE l.revision_id = rev.id;

  INSERT INTO public.boq_lines (revision_id, line_number, sort_order, sign_type, description, dimensions,
                                material, mounting, illumination, finish, location, quantity, unit,
                                install_type, width_mm, height_mm, weight_kg, mount_height_m,
                                has_screen, needs_floor_cut, item_source)
  SELECT rev.id, first_no + e.ord, first_no + e.ord,
         btrim(e.v->>'sign_type'),
         nullif(btrim(e.v->>'description'), ''), nullif(btrim(e.v->>'dimensions'), ''),
         nullif(btrim(e.v->>'material'), ''), nullif(btrim(e.v->>'mounting'), ''),
         nullif(btrim(e.v->>'illumination'), ''), nullif(btrim(e.v->>'finish'), ''),
         nullif(btrim(e.v->>'location'), ''),
         (e.v->>'quantity')::numeric, nullif(btrim(e.v->>'unit'), ''),
         (nullif(e.v->>'install_type', ''))::public.install_type,
         (nullif(e.v->>'width_mm', ''))::numeric, (nullif(e.v->>'height_mm', ''))::numeric,
         (nullif(e.v->>'weight_kg', ''))::numeric, (nullif(e.v->>'mount_height_m', ''))::numeric,
         coalesce((e.v->>'has_screen')::boolean, false), coalesce((e.v->>'needs_floor_cut')::boolean, false),
         'pricing_file'
    FROM jsonb_array_elements(_lines) WITH ORDINALITY AS e(v, ord);
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.boq_lines_entered', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'revision_id', rev.id, 'inserted', n, 'replaced', _replace));
  RETURN jsonb_build_object('revision_id', rev.id, 'revision_number', rev.revision_number, 'inserted', n);
END $$;
REVOKE ALL ON FUNCTION public.pricing_boq_import(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_boq_import(uuid, jsonb, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_boq_line_delete(_file_id uuid, _line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may remove BOQ lines. | حذف بنود الكميات يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND OR f.state <> 'package_review' THEN
    RAISE EXCEPTION 'BOQ lines are changed during package review. | تُعدَّل بنود الكميات أثناء دراسة الباكيج.'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.boq_lines l WHERE l.id = _line_id AND l.revision_id = f.boq_revision_id) THEN
    RAISE EXCEPTION 'That line is not in this file''s BOQ. | هذا البند ليس في كميات هذا الملف.' USING ERRCODE = '23514';
  END IF;
  -- boq_lines_guard refuses this once the revision is frozen.
  DELETE FROM public.boq_lines WHERE id = _line_id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.boq_line_removed', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'line_id', _line_id));
END $$;
REVOKE ALL ON FUNCTION public.pricing_boq_line_delete(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_boq_line_delete(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_freeze_boq(_file_id uuid, _status text DEFAULT 'verified', _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; rev public.boq_revisions; price_id uuid;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may freeze the BOQ. | تجميد الكميات يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  IF _status IS NULL OR _status NOT IN ('verified','partially_verified') THEN
    RAISE EXCEPTION 'A frozen BOQ is verified or partially verified. | الكميات المجمّدة إما متحققة أو متحققة جزئياً.'
      USING ERRCODE = '23514';
  END IF;
  -- Lock order across the branch is estimation, price, file. A file in package
  -- review has no price, but pricing_file_move takes it first when there is one,
  -- so this does too and never holds the file before a price.
  SELECT internal_price_id INTO price_id FROM public.pricing_files WHERE id = _file_id;
  IF price_id IS NOT NULL THEN
    PERFORM 1 FROM public.internal_prices WHERE id = price_id FOR UPDATE;
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.internal_price_id IS DISTINCT FROM price_id THEN
    RAISE EXCEPTION 'The pricing file changed while it was being frozen; try again. | تغيّر ملف التسعير أثناء التجميد؛ أعد المحاولة.'
      USING ERRCODE = 'P0001';
  END IF;
  IF f.state <> 'package_review' THEN
    RAISE EXCEPTION 'The BOQ is frozen at the end of package review. | تُجمَّد الكميات في نهاية دراسة الباكيج.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO rev FROM public.boq_revisions WHERE id = f.boq_revision_id FOR NO KEY UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.boq_lines l WHERE l.revision_id = rev.id) THEN
    RAISE EXCEPTION 'Enter or attach BOQ lines before freezing. | أدخل بنود الكميات أو اربطها قبل التجميد.'
      USING ERRCODE = 'P0001';
  END IF;
  IF rev.frozen_at IS NULL THEN
    -- The Phase 7A freeze; propagate_freeze_to_supplier_quotes runs after it.
    UPDATE public.boq_revisions
       SET frozen_at = now(), frozen_by = u, status = _status::public.boq_revision_status
     WHERE id = rev.id;
  END IF;
  PERFORM public.pricing_file_move(f.id, 'boq_frozen', _note);
  PERFORM public.pricing_suggest_extras(f.id);
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_freeze_boq(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_freeze_boq(uuid, text, text) TO authenticated;
