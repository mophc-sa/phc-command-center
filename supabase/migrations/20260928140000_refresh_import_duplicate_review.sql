-- Replace a rerun's staging suggestions atomically, preserving matching decisions.
CREATE OR REPLACE FUNCTION public.refresh_import_duplicate_review(_batch_id uuid, _candidates jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.import_batches; previous jsonb;
BEGIN
  SELECT * INTO b FROM public.import_batches WHERE id=_batch_id FOR UPDATE;
  IF NOT FOUND OR b.status IN ('committed','rolled_back','cancelled') THEN
    RAISE EXCEPTION 'Only an editable import batch can refresh duplicate review';
  END IF;
  IF jsonb_typeof(_candidates) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Candidates must be an array'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(_candidates) x WHERE NOT EXISTS(
    SELECT 1 FROM public.import_rows r WHERE r.id=(x->>'row_id')::uuid AND r.batch_id=_batch_id
      AND r.status IN ('valid','duplicate') AND NOT coalesce(r.is_excluded,false)
      AND r.row_status NOT IN ('excluded','deleted'))) THEN RAISE EXCEPTION 'Candidate row is not eligible in this batch'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO previous
    FROM public.import_duplicate_candidates d WHERE batch_id=_batch_id;
  DELETE FROM public.import_duplicate_candidates WHERE batch_id=_batch_id;
  INSERT INTO public.import_duplicate_candidates(batch_id,row_id,existing_record_id,existing_table,match_type,
    confidence,resolution,resolved_by,resolved_at,match_scope,reason_code,matched_fields,suggested_action)
  SELECT _batch_id,(x->>'row_id')::uuid,(x->>'existing_record_id')::uuid,x->>'existing_table',x->>'match_type',
    (x->>'confidence')::numeric,coalesce(old->>'resolution','pending'),(old->>'resolved_by')::uuid,
    (old->>'resolved_at')::timestamptz,x->>'match_scope',x->>'reason_code',
    ARRAY(SELECT jsonb_array_elements_text(x->'matched_fields')),x->>'suggested_action'
  FROM jsonb_array_elements(_candidates) x
  LEFT JOIN LATERAL (
    SELECT p AS old FROM jsonb_array_elements(previous) p
    WHERE p->>'row_id'=x->>'row_id' AND p->>'existing_record_id'=x->>'existing_record_id'
      AND p->>'existing_table'=x->>'existing_table' AND p->>'match_type'=x->>'match_type'
      AND p->>'match_scope'=x->>'match_scope'
    ORDER BY p->>'resolved_at' DESC NULLS LAST LIMIT 1
  ) prior ON true;
  UPDATE public.import_rows SET status='valid' WHERE batch_id=_batch_id AND status='duplicate';
  UPDATE public.import_rows SET status='duplicate' WHERE batch_id=_batch_id AND id IN (
    SELECT (x->>'row_id')::uuid FROM jsonb_array_elements(_candidates) x);
  UPDATE public.import_batches SET status='pending_approval', duplicate_rows=(
    SELECT count(DISTINCT x->>'row_id') FROM jsonb_array_elements(_candidates) x) WHERE id=_batch_id;
END $$;
REVOKE ALL ON FUNCTION public.refresh_import_duplicate_review(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_import_duplicate_review(uuid,jsonb) TO service_role;
