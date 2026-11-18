-- =============================================================================
-- Master list import (Omar's CRM review, point 16; Mo, 2026-11-18).
--
-- The Master list sync page reads the file in the browser, plans it with
-- src/lib/master-list-import.ts (tender = code number + value; one record per
-- contractor, value counted once; won never pulled back to open), shows new /
-- update / conflict rows, and the person approves each one. This function
-- applies only the approved items, as one recorded data_sync run:
--   · a deal changed in the system after the file's last update is NOT
--     overwritten: the item is skipped and reported (no silent overwrite);
--   · every change keeps its before/after in data_sync_changes;
--   · the whole file row is kept on the deal (extra_data.master_list_2026_11).
-- Who: sales leadership, the BD manager and sales ops (Marie), system admin.
-- =============================================================================

-- The import runs as the person (Marie is not a commercial manager), so the
-- deal guards let it through on a flag only this function sets. The flag is a
-- transaction-local setting a client cannot set through the API.
CREATE OR REPLACE FUNCTION public.protect_commercial_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_commercial_manager(auth.uid())
     AND coalesce(current_setting('phc.master_list_import', true), '') <> 'on' THEN
    IF NEW.stage IS DISTINCT FROM OLD.stage
       AND NEW.stage IN ('won', 'lost', 'archived') THEN
      RAISE EXCEPTION 'Commercial stage changes must go through sales-os-api';
    END IF;
    IF NEW.sales_stage IS DISTINCT FROM OLD.sales_stage THEN
      RAISE EXCEPTION 'Sales-stage changes must go through sales-os-api';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_opportunity_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND auth.uid() IS NOT NULL
     AND NOT public.is_commercial_manager(auth.uid())
     AND coalesce(current_setting('phc.master_list_import', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Only a commercial manager can change the opportunity owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_opportunity_money()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND coalesce(current_setting('phc.quote_value', true), '') <> 'on'
     AND coalesce(current_setting('phc.master_list_import', true), '') <> 'on'
     AND (NEW.quotation_value     IS DISTINCT FROM OLD.quotation_value
       OR NEW.estimated_value_min IS DISTINCT FROM OLD.estimated_value_min
       OR NEW.estimated_value_max IS DISTINCT FROM OLD.estimated_value_max
       OR NEW.contract_value      IS DISTINCT FROM OLD.contract_value)
     AND NOT public.can_edit_total_value(auth.uid()) THEN
    RAISE EXCEPTION 'Only Finance or the BD Manager may change a deal''s values (estimate, quotation, contract). | تعديل قيم الفرصة (التقدير، عرض السعر، العقد) يقتصر على الماليّة أو مدير التطوير.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.master_list_import(_file_name text, _as_of date, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid := auth.uid();
  run uuid;
  it jsonb; r jsonb; ch jsonb; c jsonb;
  o public.opportunities;
  oid uuid; comp uuid; counted uuid; st text; pr text; edited text[];
  created_ids jsonb := '{}'::jsonb;
  n_upd int := 0; n_new int := 0; n_res int := 0; n_skip int := 0; n_st int := 0; n_act int := 0;
  skipped jsonb := '[]'::jsonb;
BEGIN
  IF u IS NULL OR NOT (public.is_commercial_manager(u)
       OR public.has_any_role(u, ARRAY['bd_manager','sales_ops','system_admin']::public.app_role[])) THEN
    RAISE EXCEPTION 'Only sales leadership, the BD manager or sales ops import the master list. | استيراد القائمة الرئيسية لقيادة المبيعات أو مدير تطوير الأعمال أو عمليات المبيعات.'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Nothing approved to import.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.data_sync_runs (source, file_name, as_of, actor_id, actor_label, status, planned_at, applied_at)
  VALUES ('master_list', _file_name, coalesce(_as_of, current_date), u, 'Master list import (page)', 'applied', now(), now())
  RETURNING id INTO run;
  PERFORM set_config('phc.data_sync', 'on', true);
  PERFORM set_config('phc.master_list_import', 'on', true);

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    r := it->'row'; ch := coalesce(it->'changes', '{}'::jsonb); c := it->'contact';
    st := ch->>'sales_stage';
    pr := upper(coalesce(r->>'priority', ''));
    counted := CASE WHEN it->>'counted_on' ~ '^[0-9a-f-]{36}$' THEN (it->>'counted_on')::uuid
                    WHEN it->>'counted_on' IS NOT NULL THEN (created_ids->>(it->>'counted_on'))::uuid END;
    oid := nullif(it->>'deal_id', '')::uuid;

    IF it->>'kind' = 'create' OR (it->>'kind' = 'conflict' AND oid IS NULL) THEN
      comp := public._data_sync_company(run, coalesce(c->>'company', r->>'client'));
      INSERT INTO public.opportunities (project_name, owner_id, company_id, client, location, currency, created_by,
                                        sales_stage, stage, flow_type, quotation_value, won_at, lost_at, loss_reason,
                                        last_activity_at, commercial_handoff_status, extra_data)
      VALUES (coalesce(r->>'project', r->>'code'), nullif(ch->>'owner_id', '')::uuid, comp, coalesce(c->>'company', r->>'client'),
              r->>'location', 'SAR', u, st::public.sales_stage,
              (CASE st WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'quotation' END)::public.opportunity_stage,
              (CASE WHEN upper(coalesce(r->>'route', '')) LIKE 'TENDER%' THEN 'tender_converted' ELSE 'direct_rfq' END)::public.flow_type,
              CASE WHEN counted IS NULL THEN nullif(ch->>'quotation_value', '')::numeric END,
              CASE WHEN st = 'won' THEN coalesce(r->>'last_update', _as_of::text)::timestamptz END,
              CASE WHEN st = 'lost' THEN coalesce(r->>'last_update', _as_of::text)::timestamptz END,
              CASE WHEN st = 'lost' THEN CASE WHEN pr = 'DEAD PROJECT' THEN 'Dead project (master list)' ELSE 'Lost (master list)' END END,
              (r->>'last_update')::timestamptz, 'with_sales',
              jsonb_build_object('source', 'data_sync', 'sales_code', r->>'code', 'data_sync_run', run))
      RETURNING id INTO oid;
      INSERT INTO public.data_sync_changes (run_id, entity, entity_id, kind, after) VALUES (run, 'opportunity', oid, 'create', jsonb_build_object('code', r->>'code', 'counted_on', counted));
      created_ids := created_ids || jsonb_build_object(it->>'key', oid);
      n_new := n_new + 1;
    ELSE
      SELECT * INTO o FROM public.opportunities WHERE id = oid FOR UPDATE;
      IF NOT FOUND THEN
        skipped := skipped || jsonb_build_object('key', it->>'key', 'reason', 'deal not found'); n_skip := n_skip + 1; CONTINUE;
      END IF;
      -- No silent overwrite: a person changed the stage or value after the file's last update.
      SELECT array_agg(DISTINCT f) INTO edited
        FROM public.audit_log a CROSS JOIN LATERAL jsonb_object_keys(a.after_value) f
       WHERE a.entity_type = 'opportunity' AND a.entity_id = o.id AND a.action = 'opportunity.fields_changed'
         AND a.actor_type <> 'data_sync' AND ch ? f AND f IN ('sales_stage', 'quotation_value')
         AND public.riyadh_date(a.created_at) >= coalesce((r->>'last_update')::date, coalesce(_as_of, current_date));
      IF edited IS NOT NULL THEN
        skipped := skipped || jsonb_build_object('key', it->>'key', 'deal', o.id, 'reason', 'changed in the system after the file: ' || array_to_string(edited, ', '));
        n_skip := n_skip + 1; CONTINUE;
      END IF;
      INSERT INTO public.data_sync_changes (run_id, entity, entity_id, kind, before, after)
      VALUES (run, 'opportunity', o.id, 'update',
              jsonb_build_object('stage', o.stage, 'sales_stage', o.sales_stage, 'quotation_value', o.quotation_value, 'won_at', o.won_at,
                                 'lost_at', o.lost_at, 'loss_reason', o.loss_reason, 'exclusion_reason', o.exclusion_reason,
                                 'owner_id', o.owner_id, 'last_activity_at', o.last_activity_at, 'tier', o.tier,
                                 'next_action', o.next_action, 'next_action_due', o.next_action_due, 'extra_data', o.extra_data),
              ch || jsonb_build_object('kind', it->>'kind'));
      UPDATE public.opportunities SET
        exclusion_reason = CASE WHEN it->>'kind' = 'restore' THEN NULL ELSE exclusion_reason END,
        sales_stage = coalesce(st::public.sales_stage, sales_stage),
        won_at = CASE WHEN st = 'won' AND sales_stage IS DISTINCT FROM 'won' THEN coalesce(r->>'last_update', _as_of::text)::timestamptz ELSE won_at END,
        lost_at = CASE WHEN st = 'lost' AND sales_stage IS DISTINCT FROM 'lost' THEN coalesce(r->>'last_update', _as_of::text)::timestamptz ELSE lost_at END,
        loss_reason = CASE WHEN st = 'lost' THEN coalesce(loss_reason, CASE WHEN pr = 'DEAD PROJECT' THEN 'Dead project (master list)' ELSE 'Lost (master list)' END) ELSE loss_reason END,
        quotation_value = CASE WHEN counted IS NOT NULL THEN NULL ELSE coalesce(nullif(ch->>'quotation_value', '')::numeric, quotation_value) END,
        last_activity_at = greatest(last_activity_at, nullif(ch->>'last_activity_at', '')::timestamptz),
        owner_id = coalesce(owner_id, nullif(ch->>'owner_id', '')::uuid)
      WHERE id = o.id;
      IF it->>'kind' = 'restore' THEN n_res := n_res + 1; ELSE n_upd := n_upd + 1; END IF;
    END IF;

    -- Every column of the file row, on the deal.
    UPDATE public.opportunities SET
      stage = CASE WHEN it->>'kind' = 'restore' OR sales_stage IN ('won', 'lost') OR stage IN ('won', 'lost')
                   THEN (CASE sales_stage WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'quotation' END)::public.opportunity_stage
                   ELSE stage END,
      tier = CASE WHEN pr LIKE 'PRIORITY - A%' THEN 'A'::public.priority_tier WHEN pr = 'PRIORITY B' THEN 'B'::public.priority_tier
                  WHEN pr = 'NOT PRIORITY' THEN 'C'::public.priority_tier ELSE tier END,
      action_required = CASE WHEN pr = 'NEED FOLLOW-UP' THEN true ELSE action_required END,
      next_action = coalesce(nullif(it->>'next_action', ''), next_action),
      next_action_due = CASE WHEN sales_stage IN ('won', 'lost') THEN next_action_due ELSE coalesce((r->>'next_action_date')::date, next_action_due) END,
      hold_reason = CASE WHEN sales_stage = 'on_hold' AND hold_reason IS NULL THEN 'On hold in the master list' ELSE hold_reason END,
      verbal_award_date = CASE WHEN sales_stage = 'verbally_awarded' AND verbal_award_date IS NULL
                               THEN coalesce((r->>'last_update')::date, _as_of) ELSE verbal_award_date END,
      extra_data = (coalesce(extra_data, '{}'::jsonb) - 'duplicate_of') || jsonb_strip_nulls(jsonb_build_object(
        'master_list_2026_11', r || jsonb_build_object('row_no', it->'row_nos', 'codes', it->'codes'),
        'master_list_2026_11_synced_at', now(), 'main_client', r->>'client', 'jih_tender', r->>'route',
        'quotation_status', r->>'status', 'po_status', r->>'po_status', 'agreement_status', r->>'agreement_status',
        'master_list_priority', r->>'priority', 'data_sync_run', run,
        'value_counted_on', counted, 'quote_group_role', CASE WHEN counted IS NOT NULL THEN 'secondary' END,
        'contractor_quote_value', CASE WHEN counted IS NOT NULL THEN nullif(r->>'amount', '')::numeric END))
    WHERE id = oid;

    IF nullif(btrim(c->>'name'), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.stakeholders s WHERE s.opportunity_id = oid AND lower(btrim(s.name)) = lower(btrim(c->>'name'))) THEN
      INSERT INTO public.stakeholders (opportunity_id, name, title, email, phone, organization, role_code, notes)
      VALUES (oid, btrim(c->>'name'), c->>'title', c->>'email', c->>'phone', coalesce(c->>'company', r->>'client'),
              CASE WHEN c->>'title' ~* 'procure|purchas|buyer|commercial|tender|estimat' THEN 'procurement'
                   WHEN c->>'title' ~* 'manager|director|head|owner|ceo|gm' THEN 'decision_maker' ELSE 'other' END,
              'From the master list (' || coalesce(_file_name, 'import') || ')');
      n_st := n_st + 1;
    END IF;
    IF nullif(btrim(r->>'remarks'), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.related_opportunity_id = oid AND strpos(a.summary, left(btrim(r->>'remarks'), 80)) > 0) THEN
      INSERT INTO public.activities (activity_type, status, related_opportunity_id, owner_id, created_by, occurred_at, summary)
      SELECT 'note', 'logged', oid, owner_id, u, coalesce((r->>'last_update')::timestamptz, now()),
             'ملاحظات القائمة الرئيسية:' || E'\n' || btrim(r->>'remarks')
        FROM public.opportunities WHERE id = oid;
      n_act := n_act + 1;
    END IF;
  END LOOP;

  PERFORM set_config('phc.data_sync', '', true);
  PERFORM set_config('phc.master_list_import', '', true);
  UPDATE public.data_sync_runs SET summary = jsonb_build_object('applied', jsonb_build_object(
      'updated', n_upd, 'created', n_new, 'restored', n_res, 'skipped', n_skip, 'stakeholders', n_st, 'notes', n_act),
      'skipped', skipped)
   WHERE id = run;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'data_sync.applied', 'data_sync_run', run,
          jsonb_build_object('updated', n_upd, 'created', n_new, 'restored', n_res, 'skipped', n_skip, 'file', _file_name));
  RETURN jsonb_build_object('run_id', run, 'updated', n_upd, 'created', n_new, 'restored', n_res, 'skipped', n_skip, 'skipped_rows', skipped);
END $$;
REVOKE ALL ON FUNCTION public.master_list_import(text, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_list_import(text, date, jsonb) TO authenticated;

-- Marie (BD manager / sales ops) runs the import, so she sees the runs too.
DROP POLICY IF EXISTS "data_sync_runs readable by import roles" ON public.data_sync_runs;
CREATE POLICY "data_sync_runs readable by import roles" ON public.data_sync_runs FOR SELECT TO authenticated
  USING (public.has_any_role((SELECT auth.uid()), ARRAY['bd_manager','sales_ops','system_admin']::public.app_role[]));
