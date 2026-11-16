-- =============================================================================
-- Data sync never silently overwrites a person's edit.
--
-- The master-list sync (20261113100000 / 20261113110000) planned a change from
-- the deal as it was at planning time and applied it later without looking
-- again: a quotation_value Finance corrected between "plan" and "apply" — or
-- after the file was last updated — was replaced by the file's older figure.
-- Undo restored every field to its pre-sync value, wiping anything a person
-- had changed since the sync.
--
-- 1. data_sync_plan: unchanged except that an 'update' row now also records
--    detail.before — the deal's value of every field the plan will change.
--    (Body is 20261113110000's, read back from production 2026-11-16.)
-- 2. data_sync_apply: before writing an update row it re-checks the deal.
--      * a planned field no longer holds detail.before   → changed after planning
--      * audit_log (20261116150200) shows someone other than the sync changed a
--        planned field on or after the file's last update (or the plan, when
--        the file has no date)                            → edited after the file
--    Either way the row becomes action = 'review' with the field names, shows
--    in data_sync_review, and the deal is left untouched. quotation_value is
--    covered like every other planned field. Rows planned before this
--    migration have no detail.before; for them only the audit check applies.
-- 3. data_sync_undo: restores a field only while it still holds the value the
--    sync wrote; a field changed since is kept and counted (fields_kept).
--    extra_data is restored key by key — only the keys the sync wrote —
--    instead of replacing the whole object.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.data_sync_plan(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           detail = jsonb_build_object('changes', changes, 'needs_owner', cur.owner_id IS NULL AND owner IS NULL,
             -- 20261116150300: what the deal held when planned, so apply can tell if it moved since.
             'before', (SELECT coalesce(jsonb_object_agg(k, to_jsonb(cur)->k), '{}'::jsonb)
                          FROM jsonb_object_keys(changes) k WHERE to_jsonb(cur) ? k))
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
END $function$

;
REVOKE ALL ON FUNCTION public.data_sync_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_sync_plan(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.data_sync_apply(_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE run public.data_sync_runs; r record; o public.opportunities; ch jsonb; comp uuid; newid uuid; n_upd int := 0; n_new int := 0;
        n_dup int := 0; n_note int := 0; st text; who record; extra jsonb;
        n_rev int := 0; moved text[];
        -- Written only into an empty field (coalesce below), or a stamp that moves on its own:
        -- these cannot overwrite a person's value, so they never block a row.
        fill_only constant text[] := ARRAY['owner_id', 'company_id', 'expected_contract_date', 'last_activity_at'];
BEGIN
  SELECT * INTO run FROM public.data_sync_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND OR run.status <> 'planned' THEN RAISE EXCEPTION 'Only a planned run can be applied.' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('phc.data_sync', 'on', true);

  -- Duplicates.
  FOR r IN SELECT * FROM public.data_sync_rows WHERE run_id = _run_id AND action = 'archive_duplicate' LOOP
    SELECT * INTO o FROM public.opportunities WHERE id = r.opportunity_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND OR o.stage = 'archived';
    INSERT INTO public.data_sync_changes (run_id, entity, entity_id, kind, before, after)
    VALUES (_run_id, 'opportunity', o.id, 'archive_duplicate',
            jsonb_build_object('stage', o.stage, 'exclusion_reason', o.exclusion_reason, 'extra_data', o.extra_data),
            jsonb_build_object('duplicate_of', r.detail->>'keep'));
    UPDATE public.opportunities SET stage = 'archived', exclusion_reason = 'duplicate_opportunity',
           extra_data = coalesce(extra_data, '{}'::jsonb) || jsonb_build_object('duplicate_of', r.detail->>'keep', 'data_sync_run', _run_id)
     WHERE id = o.id;
    n_dup := n_dup + 1;
  END LOOP;

  -- Updates.
  FOR r IN SELECT * FROM public.data_sync_rows WHERE run_id = _run_id AND action = 'update' LOOP
    SELECT * INTO o FROM public.opportunities WHERE id = r.opportunity_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    ch := r.detail->'changes';
    -- 20261116150300: never overwrite an edit. An overwriting field (stage, value,
    -- loss reason, outcome dates) that moved since the plan, or that anyone but the sync changed on/after the file's last
    -- update, sends the row to review and leaves the deal alone.
    SELECT array_agg(b.k ORDER BY b.k) INTO moved
      FROM jsonb_each(coalesce(r.detail->'before', '{}'::jsonb)) b(k, v)
     WHERE to_jsonb(o)->b.k IS DISTINCT FROM b.v AND NOT b.k = ANY (fill_only);
    IF moved IS NULL THEN
      SELECT array_agg(DISTINCT f ORDER BY f) INTO moved
        FROM public.audit_log a CROSS JOIN LATERAL jsonb_object_keys(a.after_value) f
       WHERE a.entity_type = 'opportunity' AND a.entity_id = o.id AND a.action = 'opportunity.fields_changed'
         AND a.actor_type <> 'data_sync' AND ch ? f AND NOT f = ANY (fill_only)
         AND public.riyadh_date(a.created_at) >= coalesce((r.payload->>'last_update')::date,
               (r.payload->>'submitted')::date, public.riyadh_date(run.planned_at));
    END IF;
    IF moved IS NOT NULL THEN
      UPDATE public.data_sync_rows SET action = 'review',
             reason = 'Changed in the system after the master list: ' || array_to_string(moved, ', '),
             detail = detail || jsonb_build_object('changed_fields', to_jsonb(moved))
       WHERE id = r.id;
      n_rev := n_rev + 1;
      CONTINUE;
    END IF;
    comp := CASE WHEN ch ? 'create_company' THEN public._data_sync_company(_run_id, ch->>'create_company') ELSE (ch->>'company_id')::uuid END;
    extra := jsonb_strip_nulls(jsonb_build_object('update_log', r.payload->>'update_log', 'follow_up', r.payload->>'follow_up',
               'source_date_received', r.payload->>'received', 'source_date_submitted', r.payload->>'submitted',
               'master_list_status', r.payload->>'status', 'master_list_last_update', r.payload->>'last_update',
               'data_sync_run', _run_id));
    INSERT INTO public.data_sync_changes (run_id, entity, entity_id, kind, before, after)
    VALUES (_run_id, 'opportunity', o.id, 'update',
            jsonb_build_object('sales_stage', o.sales_stage, 'won_at', o.won_at, 'lost_at', o.lost_at, 'loss_reason', o.loss_reason,
                               'quotation_value', o.quotation_value, 'last_activity_at', o.last_activity_at, 'owner_id', o.owner_id,
                               'company_id', o.company_id, 'expected_contract_date', o.expected_contract_date, 'extra_data', o.extra_data),
            ch || jsonb_build_object('company_id', comp));
    UPDATE public.opportunities SET
      sales_stage = coalesce((ch->>'sales_stage')::public.sales_stage, sales_stage),
      won_at = CASE WHEN ch ? 'won_at' THEN (ch->>'won_at')::timestamptz ELSE won_at END,
      lost_at = CASE WHEN ch ? 'lost_at' THEN (ch->>'lost_at')::timestamptz ELSE lost_at END,
      loss_reason = CASE WHEN ch ? 'loss_reason' THEN ch->>'loss_reason' ELSE loss_reason END,
      quotation_value = coalesce((ch->>'quotation_value')::numeric, quotation_value),
      last_activity_at = coalesce((ch->>'last_activity_at')::timestamptz, last_activity_at),
      owner_id = coalesce(owner_id, (ch->>'owner_id')::uuid),
      company_id = coalesce(company_id, comp),
      expected_contract_date = coalesce(expected_contract_date, (ch->>'expected_contract_date')::date),
      extra_data = coalesce(extra_data, '{}'::jsonb) || extra
     WHERE id = o.id;
    n_upd := n_upd + 1;
  END LOOP;

  -- New deals.
  FOR r IN SELECT * FROM public.data_sync_rows WHERE run_id = _run_id AND action = 'create' LOOP
    st := r.detail->>'stage';
    comp := coalesce((r.detail->>'company')::uuid, public._data_sync_company(_run_id, r.payload->>'client'));
    INSERT INTO public.opportunities (project_name, owner_id, company_id, client, location, currency, created_by,
                                      sales_stage, stage, flow_type, quotation_value, won_at, lost_at, loss_reason,
                                      expected_contract_date, last_activity_at, commercial_handoff_status, extra_data)
    VALUES (coalesce(nullif(btrim(r.payload->>'project'), ''), r.payload->>'code'), (r.detail->>'owner')::uuid, comp,
            r.payload->>'client', r.payload->>'location', 'SAR', run.actor_id,
            (CASE st WHEN 'open' THEN 'jih' ELSE st END)::public.sales_stage, 'quotation',
            (CASE WHEN upper(coalesce(r.payload->>'route', '')) LIKE 'TENDER%' THEN 'tender_converted' ELSE 'direct_rfq' END)::public.flow_type,
            (r.detail->>'value')::numeric,
            CASE WHEN st = 'won' THEN coalesce(r.payload->>'last_update', r.payload->>'submitted', run.as_of::text)::timestamptz END,
            CASE WHEN st = 'lost' THEN coalesce(r.payload->>'last_update', r.payload->>'submitted', run.as_of::text)::timestamptz END,
            CASE WHEN st = 'lost' THEN CASE upper(btrim(r.payload->>'status')) WHEN 'DECLINE' THEN 'Declined (master list)'
                 WHEN 'NOT SUBMITTED' THEN 'Not submitted (master list)' ELSE 'Lost (master list)' END END,
            CASE WHEN st IN ('open','rfq_received') AND coalesce(r.payload->>'submitted', r.payload->>'received') IS NOT NULL
                 THEN coalesce((r.payload->>'submitted')::date, (r.payload->>'received')::date) + 90 END,
            (r.payload->>'last_update')::timestamptz, 'with_sales',
            jsonb_strip_nulls(jsonb_build_object('source', 'data_sync', 'sales_code', r.payload->>'code', 'jih_tender', r.payload->>'route',
              'quotation_status', r.payload->>'status', 'email_subject', r.payload->>'email_subject', 'update_log', r.payload->>'update_log',
              'follow_up', r.payload->>'follow_up', 'source_date_received', r.payload->>'received',
              'source_date_submitted', r.payload->>'submitted', 'amount_raw', r.payload->>'amount_raw', 'data_sync_run', _run_id)))
    RETURNING id INTO newid;
    UPDATE public.data_sync_rows SET opportunity_id = newid WHERE id = r.id;
    INSERT INTO public.data_sync_changes (run_id, entity, entity_id, kind, after) VALUES (_run_id, 'opportunity', newid, 'create', jsonb_build_object('code', r.payload->>'code'));
    n_new := n_new + 1;
  END LOOP;

  -- Weekly report notes.
  FOR r IN SELECT * FROM public.data_sync_rows WHERE run_id = _run_id AND action = 'note' LOOP
    SELECT * INTO o FROM public.opportunities WHERE id = r.opportunity_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.data_sync_changes (run_id, entity, entity_id, kind, before, after)
    VALUES (_run_id, 'opportunity', o.id, 'update', jsonb_build_object('extra_data', o.extra_data), jsonb_build_object('weekly_update', r.payload));
    UPDATE public.opportunities SET extra_data = coalesce(extra_data, '{}'::jsonb)
             || jsonb_build_object('weekly_update', jsonb_strip_nulls(jsonb_build_object('note', r.payload->>'notes', 'last_update', r.payload->>'last_update')))
     WHERE id = o.id;
    n_note := n_note + 1;
  END LOOP;

  PERFORM set_config('phc.data_sync', '', true);
  -- One summary per owner instead of a notice per deal.
  FOR who IN
    SELECT op.owner_id, count(*) n FROM public.data_sync_changes ch2 JOIN public.opportunities op ON op.id = ch2.entity_id
     WHERE ch2.run_id = _run_id AND ch2.entity = 'opportunity' AND ch2.kind IN ('update','create') AND op.owner_id IS NOT NULL
     GROUP BY 1
  LOOP
    PERFORM public.emit_notification(who.owner_id, 'data_sync_summary', 'opportunity', NULL, 'Master list sync',
      who.n || ' of your deals were updated from the master list (as of ' || run.as_of || '). | حُدّثت ' || who.n || ' من صفقاتك من القائمة الرئيسية (حتى ' || run.as_of || ').',
      'info', 'data_sync', 'data_sync:' || _run_id, jsonb_build_object('run_id', _run_id));
  END LOOP;

  UPDATE public.data_sync_runs SET status = 'applied', applied_at = now(),
         summary = summary || jsonb_build_object('applied', jsonb_build_object('updated', n_upd, 'created', n_new, 'duplicates_archived', n_dup, 'notes', n_note, 'sent_to_review', n_rev))
   WHERE id = _run_id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (run.actor_id, 'system', 'data_sync.applied', 'data_sync_run', _run_id,
          jsonb_build_object('updated', n_upd, 'created', n_new, 'duplicates_archived', n_dup, 'notes', n_note, 'sent_to_review', n_rev, 'source', run.source, 'as_of', run.as_of));
  RETURN jsonb_build_object('updated', n_upd, 'created', n_new, 'duplicates_archived', n_dup, 'notes', n_note, 'sent_to_review', n_rev);
END $function$;
REVOKE ALL ON FUNCTION public.data_sync_apply(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_sync_apply(uuid) TO service_role;

-- 3. Undo: put back only what still holds the sync's value.
CREATE OR REPLACE FUNCTION public._data_sync_restore_extra(_cur jsonb, _before jsonb, _keys text[])
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT (coalesce(_cur, '{}'::jsonb) - _keys)
      || coalesce((SELECT jsonb_object_agg(key, value) FROM jsonb_each(coalesce(_before, '{}'::jsonb)) WHERE key = ANY (_keys)), '{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public._data_sync_restore_extra(jsonb, jsonb, text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.data_sync_undo(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE run public.data_sync_runs; c record; n int := 0; kept int := 0; b jsonb; o public.opportunities;
        wrote jsonb; back text[];
BEGIN
  SELECT * INTO run FROM public.data_sync_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND OR run.status <> 'applied' THEN RAISE EXCEPTION 'Only an applied run can be undone.' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('phc.data_sync', 'on', true);
  FOR c IN SELECT * FROM public.data_sync_changes WHERE run_id = _run_id AND entity = 'opportunity' ORDER BY id DESC LOOP
    b := c.before;
    SELECT * INTO o FROM public.opportunities WHERE id = c.entity_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    IF c.kind = 'create' THEN
      UPDATE public.opportunities SET stage = 'archived', exclusion_reason = 'other',
             extra_data = coalesce(extra_data, '{}'::jsonb) || jsonb_build_object('data_sync_undone', _run_id)
       WHERE id = c.entity_id;
    ELSIF c.kind = 'archive_duplicate' THEN
      IF o.stage = 'archived' AND o.exclusion_reason = 'duplicate_opportunity' THEN
        UPDATE public.opportunities SET stage = (b->>'stage')::public.opportunity_stage,
               exclusion_reason = (b->>'exclusion_reason')::public.exclusion_reason,
               extra_data = public._data_sync_restore_extra(extra_data, b->'extra_data', ARRAY['duplicate_of', 'data_sync_run'])
         WHERE id = c.entity_id;
      ELSE
        kept := kept + 1;
      END IF;
    ELSIF b ? 'sales_stage' THEN
      -- The sync's value per field, typed like the column, so '2026-01-01' and a timestamptz compare equal.
      wrote := to_jsonb(jsonb_populate_record(NULL::public.opportunities, c.after));
      SELECT array_agg(k) INTO back
        FROM unnest(ARRAY['sales_stage', 'loss_reason', 'quotation_value', 'last_activity_at', 'owner_id',
                          'company_id', 'expected_contract_date']) k
       WHERE c.after ? k AND to_jsonb(o)->k IS NOT DISTINCT FROM wrote->k;
      kept := kept + (SELECT count(*) FROM jsonb_object_keys(c.after) k
                       WHERE k IN ('sales_stage', 'loss_reason', 'quotation_value', 'last_activity_at', 'owner_id',
                                   'company_id', 'expected_contract_date')
                         AND NOT k = ANY (coalesce(back, '{}')));
      back := coalesce(back, '{}');
      UPDATE public.opportunities SET
             sales_stage = CASE WHEN 'sales_stage' = ANY (back) THEN (b->>'sales_stage')::public.sales_stage ELSE sales_stage END,
             loss_reason = CASE WHEN 'loss_reason' = ANY (back) THEN b->>'loss_reason' ELSE loss_reason END,
             quotation_value = CASE WHEN 'quotation_value' = ANY (back) THEN (b->>'quotation_value')::numeric ELSE quotation_value END,
             last_activity_at = CASE WHEN 'last_activity_at' = ANY (back) THEN (b->>'last_activity_at')::timestamptz ELSE last_activity_at END,
             owner_id = CASE WHEN 'owner_id' = ANY (back) THEN (b->>'owner_id')::uuid ELSE owner_id END,
             company_id = CASE WHEN 'company_id' = ANY (back) THEN (b->>'company_id')::uuid ELSE company_id END,
             expected_contract_date = CASE WHEN 'expected_contract_date' = ANY (back) THEN (b->>'expected_contract_date')::date ELSE expected_contract_date END,
             extra_data = public._data_sync_restore_extra(extra_data, b->'extra_data',
               ARRAY['update_log', 'follow_up', 'source_date_received', 'source_date_submitted',
                     'master_list_status', 'master_list_last_update', 'data_sync_run'])
       WHERE id = c.entity_id;
    ELSE
      UPDATE public.opportunities SET extra_data = public._data_sync_restore_extra(extra_data, b->'extra_data', ARRAY['weekly_update'])
       WHERE id = c.entity_id;
    END IF;
    n := n + 1;
  END LOOP;
  PERFORM set_config('phc.data_sync', '', true);
  UPDATE public.data_sync_runs SET status = 'undone', undone_at = now() WHERE id = _run_id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (run.actor_id, 'system', 'data_sync.undone', 'data_sync_run', _run_id,
          jsonb_build_object('changes_reversed', n, 'fields_kept', kept));
  RETURN jsonb_build_object('changes_reversed', n, 'fields_kept', kept);
END $$;
REVOKE ALL ON FUNCTION public.data_sync_undo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_sync_undo(uuid) TO service_role;
