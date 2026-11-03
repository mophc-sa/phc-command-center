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

-- The first thing wrong with one imported line, as {English, Arabic}, or NULL.
-- Every number is held to its boq_lines column (precision and scale), so a bad
-- value is a 23514 that names the field, never a raw 22003 or CHECK error.
-- Text columns are unbounded TEXT; the caps here are for sanity, not the column.
CREATE OR REPLACE FUNCTION public._pricing_boq_line_problem(_v jsonb)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE s record; typ text; t text; r numeric;
BEGIN
  IF jsonb_typeof(_v) IS DISTINCT FROM 'object' THEN
    RETURN ARRAY['not a line','ليس بنداً'];
  END IF;

  -- Sign type: required text.
  typ := jsonb_typeof(_v->'sign_type');
  IF typ IS DISTINCT FROM 'string' OR btrim(_v->>'sign_type') = '' THEN
    RETURN CASE WHEN typ IS NULL OR typ = 'null' OR btrim(coalesce(_v->>'sign_type','')) = ''
                THEN ARRAY['sign type is empty','نوع اللوحة فارغ']
                ELSE ARRAY['sign type must be text','نوع اللوحة يجب أن يكون نصاً'] END;
  END IF;
  IF char_length(btrim(_v->>'sign_type')) > 120 THEN
    RETURN ARRAY['sign type is longer than 120 characters','نوع اللوحة أطول من 120 حرفاً'];
  END IF;

  -- Numbers: (key, whole digits the column holds, decimals, must be above zero, English, Arabic).
  FOR s IN SELECT * FROM (VALUES
      ('quantity',       11, 3, true,  'quantity',     'الكمية'),
      ('width_mm',        9, 1, true,  'width',        'العرض'),
      ('height_mm',       9, 1, true,  'height',       'الارتفاع'),
      ('weight_kg',       8, 2, false, 'weight',       'الوزن'),
      ('mount_height_m',  4, 2, false, 'mount height', 'ارتفاع التركيب')
    ) AS x(k, whole, scl, pos, en, ar)
  LOOP
    typ := jsonb_typeof(_v->s.k);
    IF typ IS NULL OR typ = 'null' OR (typ = 'string' AND (_v->>s.k) = '') THEN
      IF s.k = 'quantity' THEN RETURN ARRAY['quantity is missing','الكمية غير موجودة']; END IF;
      CONTINUE;
    END IF;
    t := _v->>s.k;
    IF typ NOT IN ('number','string') OR t !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN ARRAY[s.en || ' is not a number', s.ar || ' ليس رقماً'];
    END IF;
    IF char_length(t) > 40 THEN
      RETURN ARRAY[s.en || ' is too large', s.ar || ' كبير جداً'];
    END IF;
    r := round(t::numeric, s.scl);
    IF r < 0 THEN
      RETURN ARRAY[s.en || ' cannot be negative', s.ar || ' لا يكون سالباً'];
    END IF;
    IF s.pos AND r = 0 THEN
      RETURN ARRAY[s.en || ' must be above zero', s.ar || ' يجب أن يكون أكبر من صفر'];
    END IF;
    IF r >= 10::numeric ^ s.whole THEN
      RETURN ARRAY[s.en || ' must be below ' || (10::numeric ^ s.whole)::bigint,
                   s.ar || ' يجب أن يكون أقل من ' || (10::numeric ^ s.whole)::bigint];
    END IF;
  END LOOP;

  -- Install type: one of the enum.
  typ := jsonb_typeof(_v->'install_type');
  IF typ IS NOT NULL AND typ <> 'null' AND (_v->>'install_type') <> '' THEN
    IF typ <> 'string' OR NOT ((_v->>'install_type') = ANY (enum_range(NULL::public.install_type)::text[])) THEN
      RETURN ARRAY['unknown install type','نوع تركيب غير معروف'];
    END IF;
  END IF;

  -- Free text: a string, within its cap.
  FOR s IN SELECT * FROM (VALUES
      ('description', 500, 'description',  'الوصف'),
      ('dimensions',  120, 'dimensions',   'الأبعاد'),
      ('material',    120, 'material',     'الخامة'),
      ('mounting',    120, 'mounting',     'طريقة التثبيت'),
      ('illumination',120, 'illumination', 'الإضاءة'),
      ('finish',      120, 'finish',       'التشطيب'),
      ('location',    120, 'location',     'الموقع'),
      ('unit',        120, 'unit',         'الوحدة')
    ) AS x(k, cap, en, ar)
  LOOP
    typ := jsonb_typeof(_v->s.k);
    IF typ IS NULL OR typ = 'null' THEN CONTINUE; END IF;
    IF typ <> 'string' THEN
      RETURN ARRAY[s.en || ' must be text', s.ar || ' يجب أن يكون نصاً'];
    END IF;
    IF char_length(btrim(_v->>s.k)) > s.cap THEN
      RETURN ARRAY[s.en || ' is longer than ' || s.cap || ' characters', s.ar || ' أطول من ' || s.cap || ' حرفاً'];
    END IF;
  END LOOP;

  -- Yes/no flags.
  IF jsonb_typeof(_v->'has_screen') NOT IN ('boolean','null') THEN
    RETURN ARRAY['screen must be yes or no','الشاشة يجب أن تكون نعم أو لا'];
  END IF;
  IF jsonb_typeof(_v->'needs_floor_cut') NOT IN ('boolean','null') THEN
    RETURN ARRAY['floor cut must be yes or no','قص الأرضية يجب أن يكون نعم أو لا'];
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._pricing_boq_line_problem(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_boq_import(_file_id uuid, _lines jsonb, _replace boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; rev public.boq_revisions;
        b_id uuid; prev uuid; made uuid; next_no integer; first_no integer; n integer; copied integer := 0;
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
    CROSS JOIN LATERAL (SELECT public._pricing_boq_line_problem(e.v) AS why) x
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
    IF rev.superseded_by IS NOT NULL OR NOT rev.is_current THEN
      RAISE EXCEPTION 'This file''s BOQ revision was replaced by a newer one; attach the current one. | استُبدل إصدار الكميات في هذا الملف بإصدار أحدث؛ اربط الإصدار الحالي.'
        USING ERRCODE = 'P0001';
    END IF;
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
    made := rev.id;
    IF prev IS NOT NULL THEN
      UPDATE public.boq_revisions SET superseded_by = rev.id, superseded_at = now() WHERE id = prev;
      IF NOT _replace THEN
        -- Adding to a revision that cannot change: the new one starts as a copy
        -- of it (every column but the cost ones and the old selling price, which
        -- the new round's grid rebuilds), so it replaces the whole set,
        -- not just the lines that were added.
        INSERT INTO public.boq_lines (revision_id, line_number, sort_order, sign_type, description, dimensions,
                                      material, mounting, illumination, finish, location, quantity, unit,
                                      item_source, install_type, width_mm, height_mm,
                                      weight_kg, mount_height_m, has_screen, needs_floor_cut)
        SELECT rev.id, l.line_number, l.sort_order, l.sign_type, l.description, l.dimensions,
               l.material, l.mounting, l.illumination, l.finish, l.location, l.quantity, l.unit,
               l.item_source, l.install_type, l.width_mm, l.height_mm,
               l.weight_kg, l.mount_height_m, l.has_screen, l.needs_floor_cut
          FROM public.boq_lines l WHERE l.revision_id = prev
         ORDER BY l.line_number, l.sort_order, l.created_at, l.id;
        GET DIAGNOSTICS copied = ROW_COUNT;
      END IF;
    END IF;
    UPDATE public.pricing_files SET boq_revision_id = rev.id, updated_at = now() WHERE id = f.id;
  END IF;

  IF _replace THEN
    IF EXISTS (SELECT 1 FROM public.supplier_quote_lines sl JOIN public.boq_lines l ON l.id = sl.boq_line_id
                WHERE l.revision_id = rev.id) THEN
      RAISE EXCEPTION 'A supplier quote prices these lines; they cannot be replaced. | عرض مورّد يسعّر هذه البنود؛ لا يمكن استبدالها.'
        USING ERRCODE = 'P0001';
    END IF;
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
          jsonb_build_object('file_id', f.id, 'revision_id', rev.id, 'created_revision_id', made,
                             'superseded_revision_id', prev, 'copied_forward', copied,
                             'inserted', n, 'replaced', _replace));
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
  IF EXISTS (SELECT 1 FROM public.supplier_quote_lines sl WHERE sl.boq_line_id = _line_id) THEN
    RAISE EXCEPTION 'A supplier quote prices this line; it cannot be removed. | عرض مورّد يسعّر هذا البند؛ لا يمكن حذفه.'
      USING ERRCODE = 'P0001';
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
  IF FOUND AND (rev.superseded_by IS NOT NULL OR NOT rev.is_current) THEN
    RAISE EXCEPTION 'This file''s BOQ revision was replaced by a newer one; attach the current one. | استُبدل إصدار الكميات في هذا الملف بإصدار أحدث؛ اربط الإصدار الحالي.'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.boq_lines l WHERE l.revision_id = rev.id) THEN
    RAISE EXCEPTION 'Enter or attach BOQ lines before freezing. | أدخل بنود الكميات أو اربطها قبل التجميد.'
      USING ERRCODE = 'P0001';
  END IF;
  IF rev.frozen_at IS NOT NULL THEN
    -- Already frozen (attached that way): accept it only if it was verified.
    IF rev.status NOT IN ('verified','partially_verified') THEN
      RAISE EXCEPTION 'This BOQ revision is frozen but not verified; attach a verified one. | إصدار الكميات مجمّد لكنه غير متحقق منه؛ اربط إصداراً متحققاً منه.'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- The Phase 7A freeze; propagate_freeze_to_supplier_quotes runs after it.
    UPDATE public.boq_revisions
       SET frozen_at = now(), frozen_by = u, status = _status::public.boq_revision_status
     WHERE id = rev.id;
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
    VALUES (u, 'user', 'boq_revision.frozen', 'boq_revision', rev.id,
            jsonb_build_object('revision_id', rev.id, 'status', _status, 'file_id', f.id,
                               'opportunity_id', f.opportunity_id));
  END IF;
  PERFORM public.pricing_file_move(f.id, 'boq_frozen', _note);
  PERFORM public.pricing_suggest_extras(f.id);
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_freeze_boq(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_freeze_boq(uuid, text, text) TO authenticated;
