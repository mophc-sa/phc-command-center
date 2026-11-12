-- =============================================================================
-- Data sync, two rules learned on the first production run (2026-11-12):
-- 1. Excel stores a carriage return inside some sales codes as the literal text
--    "_x000D_" ("OM23011-R8_x000D_"); the code is the same quotation, so the
--    normaliser drops it (11 duplicate deals came from it).
-- 2. A quotation the file still calls SUBMITTED but whose follow-up is DEAD is
--    over (Mo: follow the file): it is planned as lost, "Dead (master list follow-up)".
-- The rest of data_sync_plan is 20261113100000's.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.data_sync_norm_code(_code text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(upper(regexp_replace(regexp_replace(coalesce(_code, ''), '_x000D_', '', 'gi'), '\s+', '', 'g')),
                               '-R(E)?V\.?0*([0-9]+)', '-REV\2', 'g'), '');
$$;
REVOKE ALL ON FUNCTION public.data_sync_norm_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_sync_norm_code(text) TO service_role;

CREATE OR REPLACE FUNCTION public.data_sync_plan(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE run public.data_sync_runs; r record; d record; target uuid; cur public.opportunities; want text; changes jsonb;
        last_moved timestamptz; owner uuid; code_prefix text; comp uuid; v numeric; s jsonb;
BEGIN
  SELECT * INTO run FROM public.data_sync_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND OR run.status NOT IN ('staged','planned') THEN
    RAISE EXCEPTION 'Only a staged or planned run can be planned.' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.data_sync_rows WHERE run_id = _run_id AND sheet = 'duplicates';
  UPDATE public.data_sync_rows SET action = NULL, opportunity_id = NULL, reason = NULL, detail = '{}'::jsonb
   WHERE run_id = _run_id;
  UPDATE public.data_sync_rows SET code_norm = public.data_sync_norm_code(payload->>'code') WHERE run_id = _run_id;

  -- 4a. Duplicates: one live deal per sales code; the others are archived.
  CREATE TEMP TABLE IF NOT EXISTS _ds_canon (code text PRIMARY KEY, opp uuid) ON COMMIT DROP;
  TRUNCATE _ds_canon;
  INSERT INTO _ds_canon
  SELECT DISTINCT ON (c) c, id FROM (
    SELECT o.id, public._data_sync_opp_code(o.extra_data) c, o.created_at,
           (o.extra_data ? 'promotion_request_id') AS promoted,
           (SELECT count(*) FROM public.activities a WHERE a.related_opportunity_id = o.id) AS acts
      FROM public.opportunities o WHERE o.stage IS DISTINCT FROM 'archived') x
   WHERE c IS NOT NULL
   ORDER BY c, promoted DESC, acts DESC, created_at ASC;
  INSERT INTO public.data_sync_rows (run_id, sheet, payload, code_norm, action, opportunity_id, reason, detail)
  SELECT _run_id, 'duplicates', jsonb_build_object('code', k.code), k.code, 'archive_duplicate', o.id,
         'Same sales code as the deal kept', jsonb_build_object('keep', k.opp)
    FROM public.opportunities o JOIN _ds_canon k ON k.code = public._data_sync_opp_code(o.extra_data)
   WHERE o.stage IS DISTINCT FROM 'archived' AND o.id <> k.opp;

  -- 4b. Quotation rows. A code listed twice in the file: the latest row decides, the others are reviewed.
  FOR r IN
    SELECT x.*, row_number() OVER (PARTITION BY x.code_norm
             ORDER BY (x.payload->>'last_update') DESC NULLS LAST, x.row_no DESC) AS rn
      FROM public.data_sync_rows x WHERE x.run_id = _run_id AND x.sheet = 'quotations'
  LOOP
    IF r.code_norm IS NULL THEN
      UPDATE public.data_sync_rows SET action = 'review', reason = 'No sales code' WHERE id = r.id; CONTINUE;
    END IF;
    IF r.rn > 1 THEN
      UPDATE public.data_sync_rows SET action = 'skip', reason = 'An older row of the same code in the file' WHERE id = r.id; CONTINUE;
    END IF;
    want := public._data_sync_target_stage(r.payload->>'status', (r.payload->>'received')::date, run.as_of);
    -- 2026-11-12 (Mo): a follow-up marked DEAD in the file closes an open quotation.
    IF want IN ('open','rfq_received') AND upper(btrim(coalesce(r.payload->>'follow_up', ''))) = 'DEAD' THEN
      want := 'lost';
    END IF;
    IF want IS NULL THEN
      UPDATE public.data_sync_rows SET action = 'review', reason = 'Unknown status: ' || coalesce(r.payload->>'status', '(empty)') WHERE id = r.id; CONTINUE;
    END IF;
    v := CASE WHEN jsonb_typeof(r.payload->'amount') = 'number' AND (r.payload->>'amount')::numeric > 0 THEN round((r.payload->>'amount')::numeric, 2) END;
    code_prefix := upper(substring(r.code_norm FROM '^[A-Z]+'));
    owner := NULL;
    SELECT m.user_id INTO owner FROM public.historical_sales_owner_map m WHERE m.prefix = code_prefix;
    comp := NULL;
    IF nullif(btrim(r.payload->>'client'), '') IS NOT NULL THEN
      SELECT c.id INTO comp FROM public.companies c WHERE lower(btrim(c.name)) = lower(btrim(r.payload->>'client'))
       ORDER BY c.created_at LIMIT 1;
    END IF;
    SELECT opp INTO target FROM _ds_canon WHERE code = r.code_norm;

    IF target IS NULL THEN
      UPDATE public.data_sync_rows SET action = 'create', detail = jsonb_build_object(
        'stage', want, 'value', v, 'owner', owner, 'company', comp, 'needs_owner', owner IS NULL,
        'needs_value', v IS NULL)
       WHERE id = r.id;
      CONTINUE;
    END IF;

    SELECT * INTO cur FROM public.opportunities WHERE id = target;
    SELECT max(h.created_at) INTO last_moved FROM public.stage_transition_history h
     WHERE h.record_type = 'opportunity' AND h.record_id = target;
    changes := '{}'::jsonb;
    -- Stage.
    IF want = 'open' THEN
      IF cur.sales_stage = 'won' THEN
        UPDATE public.data_sync_rows SET action = 'review', opportunity_id = target,
               reason = 'Won in the system, open in the file' WHERE id = r.id; CONTINUE;
      ELSIF cur.sales_stage IN ('lost','on_hold') THEN
        changes := changes || jsonb_build_object('sales_stage', 'jih');
      END IF;
    ELSIF want IS DISTINCT FROM cur.sales_stage::text THEN
      changes := changes || jsonb_build_object('sales_stage', want);
    END IF;
    IF changes ? 'sales_stage' AND last_moved IS NOT NULL
       AND last_moved::date > coalesce((r.payload->>'last_update')::date, (r.payload->>'submitted')::date, '1900-01-01'::date) THEN
      UPDATE public.data_sync_rows SET action = 'review', opportunity_id = target,
             reason = 'The system moved the stage after the file''s last update',
             detail = jsonb_build_object('file_stage', want, 'system_stage', cur.sales_stage, 'moved_at', last_moved)
       WHERE id = r.id; CONTINUE;
    END IF;
    IF changes->>'sales_stage' = 'won' THEN
      changes := changes || jsonb_build_object('won_at', coalesce(r.payload->>'last_update', r.payload->>'submitted', run.as_of::text));
    ELSIF changes->>'sales_stage' = 'lost' THEN
      changes := changes || jsonb_build_object('lost_at', coalesce(r.payload->>'last_update', r.payload->>'submitted', run.as_of::text),
        'loss_reason', coalesce(cur.loss_reason, CASE
          WHEN upper(btrim(coalesce(r.payload->>'follow_up', ''))) = 'DEAD' THEN 'Dead (master list follow-up)'
          WHEN upper(btrim(r.payload->>'status')) = 'DECLINE' THEN 'Declined (master list)'
          WHEN upper(btrim(r.payload->>'status')) = 'NOT SUBMITTED' THEN 'Not submitted (master list)' ELSE 'Lost (master list)' END));
    END IF;
    -- Value, dates, missing data.
    IF v IS NOT NULL AND v IS DISTINCT FROM cur.quotation_value THEN changes := changes || jsonb_build_object('quotation_value', v); END IF;
    IF (r.payload->>'last_update') IS NOT NULL
       AND (cur.last_activity_at IS NULL OR cur.last_activity_at::date < (r.payload->>'last_update')::date) THEN
      changes := changes || jsonb_build_object('last_activity_at', r.payload->>'last_update');
    END IF;
    IF cur.owner_id IS NULL AND owner IS NOT NULL THEN changes := changes || jsonb_build_object('owner_id', owner); END IF;
    IF cur.company_id IS NULL AND comp IS NOT NULL THEN changes := changes || jsonb_build_object('company_id', comp); END IF;
    IF cur.company_id IS NULL AND comp IS NULL AND nullif(btrim(r.payload->>'client'), '') IS NOT NULL THEN
      changes := changes || jsonb_build_object('create_company', btrim(r.payload->>'client'));
    END IF;
    IF cur.expected_contract_date IS NULL AND coalesce(changes->>'sales_stage', cur.sales_stage::text) IN ('jih','rfq_received')
       AND coalesce(r.payload->>'submitted', r.payload->>'received') IS NOT NULL THEN
      changes := changes || jsonb_build_object('expected_contract_date',
        (coalesce((r.payload->>'submitted')::date, (r.payload->>'received')::date) + 90)::text);
    END IF;
    UPDATE public.data_sync_rows SET action = 'update', opportunity_id = target,
           detail = jsonb_build_object('changes', changes, 'needs_owner', cur.owner_id IS NULL AND owner IS NULL)
     WHERE id = r.id;
  END LOOP;

  -- 4c. Weekly report notes go to the matched deal.
  UPDATE public.data_sync_rows x SET action = CASE WHEN k.opp IS NULL THEN 'review' ELSE 'note' END,
         opportunity_id = k.opp, reason = CASE WHEN k.opp IS NULL THEN 'Weekly note for a code with no deal' END
    FROM (SELECT y.id, c.opp FROM public.data_sync_rows y LEFT JOIN _ds_canon c ON c.code = y.code_norm
           WHERE y.run_id = _run_id AND y.sheet = 'weekly') k
   WHERE x.id = k.id;

  SELECT jsonb_object_agg(coalesce(action, 'unplanned') || ':' || sheet, n) INTO s
    FROM (SELECT action, sheet, count(*) n FROM public.data_sync_rows WHERE run_id = _run_id GROUP BY 1, 2) z;
  UPDATE public.data_sync_runs SET status = 'planned', planned_at = now(), summary = coalesce(s, '{}'::jsonb) WHERE id = _run_id;
  RETURN coalesce(s, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.data_sync_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_sync_plan(uuid) TO service_role;
