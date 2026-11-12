-- =============================================================================
-- Pricing loop, PR 4 part 3: a client change opens the next round (spec §1 "quoted").
-- The old supplier request belongs to the old BOQ revision and is never reused
-- (AI_HANDOFF contract for PR 4), so the round starts again at package review on
-- a fresh, unfrozen copy of the BOQ that supersedes the quoted one (the same copy
-- pricing_boq_import makes, 20261104110000). The client's current quotation stays
-- valid until the next issue supersedes it.
-- The PR 1 move quoted -> boq_frozen stays legal for a pricer who froze a new
-- revision some other way. A discount without quantity changes goes through BAFO.
-- =============================================================================

CREATE OR REPLACE VIEW public.pricing_file_transitions AS
SELECT * FROM (VALUES
  ('received'::public.pricing_file_state,       'package_review'::public.pricing_file_state, 'pricer'),
  ('package_review',  'needs_info',      'rpc_needs_info'),
  ('needs_info',      'package_review',  'rpc_answer'),
  ('package_review',  'boq_frozen',      'pricer'),
  ('boq_frozen',      'at_supplier',     'pricer'),
  ('at_supplier',     'supplier_priced', 'pricer'),
  ('supplier_priced', 'at_supplier',     'pricer'),
  ('supplier_priced', 'selling_build',   'gm'),
  ('selling_build',   'price_review',    'system'),
  ('price_review',    'approved',        'system'),
  ('price_review',    'selling_build',   'system'),
  ('price_review',    'at_supplier',     'pricer'),
  ('approved',        'quoted',          'system'),
  ('quoted',          'boq_frozen',      'pricer'),
  ('quoted',          'package_review',  'rpc_client_round')
) AS t(from_state, to_state, who);
GRANT SELECT ON public.pricing_file_transitions TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_client_round(_file_id uuid, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; old_rev public.boq_revisions; new_rev public.boq_revisions;
        n text := nullif(btrim(_note), ''); next_no int;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Estimation or finance opens a client round. | جولة العميل يفتحها التقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF n IS NULL THEN
    RAISE EXCEPTION 'Say what the client changed. | اذكر ما غيّره العميل.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514'; END IF;
  IF f.state <> 'quoted' THEN
    RAISE EXCEPTION 'A client round starts from a quoted file. | جولة العميل تبدأ من ملف صدر عرضه.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO old_rev FROM public.boq_revisions WHERE id = f.boq_revision_id FOR NO KEY UPDATE;
  SELECT coalesce(max(r.revision_number), 0) + 1 INTO next_no FROM public.boq_revisions r WHERE r.boq_id = old_rev.boq_id;
  -- Whatever revision is current on this BOQ gives way to the new one.
  UPDATE public.boq_revisions SET is_current = false WHERE boq_id = old_rev.boq_id AND is_current;
  INSERT INTO public.boq_revisions (boq_id, revision_number, status, source_type, notes, created_by, is_current)
  VALUES (old_rev.boq_id, next_no, 'draft', 'manual', 'Client round: ' || left(n, 200), u, true)
  RETURNING * INTO new_rev;
  UPDATE public.boq_revisions SET superseded_by = new_rev.id, superseded_at = now()
   WHERE id = old_rev.id AND superseded_by IS NULL;
  -- The copy pricing_boq_import makes: every column but the cost ones and the old
  -- selling price, which the new round's grid rebuilds.
  INSERT INTO public.boq_lines (revision_id, line_number, sort_order, sign_type, description, dimensions,
                                material, mounting, illumination, finish, location, quantity, unit,
                                item_source, install_type, width_mm, height_mm,
                                weight_kg, mount_height_m, has_screen, needs_floor_cut)
  SELECT new_rev.id, l.line_number, l.sort_order, l.sign_type, l.description, l.dimensions,
         l.material, l.mounting, l.illumination, l.finish, l.location, l.quantity, l.unit,
         l.item_source, l.install_type, l.width_mm, l.height_mm,
         l.weight_kg, l.mount_height_m, l.has_screen, l.needs_floor_cut
    FROM public.boq_lines l WHERE l.revision_id = old_rev.id
   ORDER BY l.line_number, l.sort_order, l.created_at, l.id;

  UPDATE public.pricing_files SET boq_revision_id = new_rev.id, updated_at = now() WHERE id = f.id RETURNING * INTO f;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.client_round', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'from_revision', old_rev.id, 'to_revision', new_rev.id));
  RETURN to_jsonb(public._pricing_file_apply(f, 'package_review', u, n));
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_client_round(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_client_round(uuid, text) TO authenticated;
