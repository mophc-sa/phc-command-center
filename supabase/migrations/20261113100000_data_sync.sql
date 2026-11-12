-- =============================================================================
-- Data sync from the master quotation list (design
-- docs/superpowers/specs/2026-11-12-data-sync-design.md, approved by Mo 2026-11-12).
-- A run stages the file's rows, plans per sales code (merge duplicates, update,
-- create, review), and applies the plan as the server: the opportunity guards
-- let service writes through ("must go through sales-os-api"); a person cannot
-- call these functions. Every change keeps its before and after, so the whole
-- run can be undone. The file wins unless the system moved the stage after the
-- row's last update. Nothing is deleted.
-- =============================================================================

-- 1. Runs, staged rows, changes.
CREATE TABLE IF NOT EXISTS public.data_sync_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  file_name   text,
  as_of       date NOT NULL,
  status      text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','planned','applied','undone')),
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label text,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  planned_at  timestamptz,
  applied_at  timestamptz,
  undone_at   timestamptz
);
CREATE TABLE IF NOT EXISTS public.data_sync_rows (
  id              bigserial PRIMARY KEY,
  run_id          uuid NOT NULL REFERENCES public.data_sync_runs(id) ON DELETE CASCADE,
  sheet           text NOT NULL,
  row_no          integer,
  payload         jsonb NOT NULL,
  code_norm       text,
  action          text CHECK (action IN ('update','create','archive_duplicate','review','skip','note')),
  opportunity_id  uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  reason          text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS data_sync_rows_run ON public.data_sync_rows (run_id, sheet);
CREATE TABLE IF NOT EXISTS public.data_sync_changes (
  id         bigserial PRIMARY KEY,
  run_id     uuid NOT NULL REFERENCES public.data_sync_runs(id) ON DELETE CASCADE,
  entity     text NOT NULL CHECK (entity IN ('opportunity','company')),
  entity_id  uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('create','update','archive_duplicate')),
  before     jsonb,
  after      jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_sync_changes_run ON public.data_sync_changes (run_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['data_sync_runs','data_sync_rows','data_sync_changes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s readable by commercial managers" ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY "%s readable by commercial managers" ON public.%I FOR SELECT TO authenticated
      USING (public.is_commercial_manager((SELECT auth.uid())))$p$, t, t);
    EXECUTE format('DROP POLICY IF EXISTS audit_session_boundary ON public.%I', t);
    EXECUTE format($p$CREATE POLICY audit_session_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())))$p$, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- 2. Stage notices are summarised per owner during a sync (the rest of the body is 20260819100000's).
CREATE OR REPLACE FUNCTION public.notify_opportunity_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name TEXT := COALESCE(NEW.project_name, 'Untitled');
BEGIN
  -- Data sync (20261113100000): a bulk sync from the master list sends each
  -- owner one summary instead of a notice per deal. Only data_sync_apply and
  -- data_sync_undo set this, transaction-local; nothing else changes.
  IF coalesce(current_setting('phc.data_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  -- ---- Sales stage changed → the owner ------------------------------------
  IF TG_OP = 'UPDATE' AND OLD.sales_stage IS DISTINCT FROM NEW.sales_stage THEN
    PERFORM public.emit_notification(
      NEW.owner_id,
      'stage_changed', 'opportunity', NEW.id,
      _name,
      'Stage moved to ' || COALESCE(NEW.sales_stage::TEXT, 'unset') || '.',
      CASE WHEN NEW.sales_stage IN ('won','lost') THEN 'attention' ELSE 'info' END,
      'stage_changed',
      -- Keyed on the destination: moving jih→jih_bafo→jih notifies twice,
      -- which is correct, but a repeated write of the same stage does not.
      'stage:' || COALESCE(NEW.sales_stage::TEXT, 'null'),
      jsonb_build_object('from', OLD.sales_stage, 'to', NEW.sales_stage)
    );
  END IF;

  -- ---- Commercial handoff changed → the owner ------------------------------
  IF TG_OP = 'UPDATE'
     AND OLD.commercial_handoff_status IS DISTINCT FROM NEW.commercial_handoff_status
  THEN
    PERFORM public.emit_notification(
      NEW.owner_id,
      'handoff_changed', 'opportunity', NEW.id,
      _name,
      'Commercial handoff is now ' || COALESCE(NEW.commercial_handoff_status, 'unset') || '.',
      'info', 'handoff_changed',
      'handoff:' || COALESCE(NEW.commercial_handoff_status, 'null'),
      jsonb_build_object('from', OLD.commercial_handoff_status, 'to', NEW.commercial_handoff_status)
    );
  END IF;

  -- ---- Reassigned → the new owner -----------------------------------------
  IF TG_OP = 'UPDATE'
     AND OLD.owner_id IS DISTINCT FROM NEW.owner_id
     AND NEW.owner_id IS NOT NULL
  THEN
    PERFORM public.emit_notification(
      NEW.owner_id,
      'assigned', 'opportunity', NEW.id,
      _name, 'This opportunity was assigned to you.',
      'attention', 'assignment_changed',
      'assigned:' || NEW.owner_id::TEXT,
      NULL
    );
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$$;

-- 3. Helpers.
CREATE OR REPLACE FUNCTION public.data_sync_norm_code(_code text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(upper(regexp_replace(coalesce(_code, ''), '\s+', '', 'g')),
                               '-R(E)?V\.?0*([0-9]+)', '-REV\2', 'g'), '');
$$;
REVOKE ALL ON FUNCTION public.data_sync_norm_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_sync_norm_code(text) TO service_role;

-- The deal's sales code as the imports and the archive stored it.
CREATE OR REPLACE FUNCTION public._data_sync_opp_code(_extra jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT public.data_sync_norm_code(coalesce(_extra->>'source_sales_code', _extra->>'sales_code'));
$$;
REVOKE ALL ON FUNCTION public._data_sync_opp_code(jsonb) FROM PUBLIC, anon, authenticated;

-- The file's status: the stage it means, and whether it closes the deal.
CREATE OR REPLACE FUNCTION public._data_sync_target_stage(_status text, _received date, _as_of date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(btrim(coalesce(_status, '')))
    WHEN 'WON' THEN 'won'
    WHEN 'LOST' THEN 'lost'
    WHEN 'DECLINE' THEN 'lost'
    WHEN 'SUBMITTED' THEN 'open'
    WHEN 'WAITING FOR CLIENT' THEN 'open'
    WHEN 'FOR ACTION' THEN 'open'
    WHEN 'ON-HOLD' THEN 'on_hold'
    WHEN 'NOT SUBMITTED' THEN CASE WHEN _received IS NOT NULL AND _received < _as_of - 90 THEN 'lost' ELSE 'rfq_received' END
    ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public._data_sync_target_stage(text, date, date) FROM PUBLIC, anon, authenticated;

-- 4. Plan.
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
        'loss_reason', coalesce(cur.loss_reason, CASE upper(btrim(r.payload->>'status'))
          WHEN 'DECLINE' THEN 'Declined (master list)' WHEN 'NOT SUBMITTED' THEN 'Not submitted (master list)' ELSE 'Lost (master list)' END));
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

-- 5. Apply (the server). Every change keeps its before and after.
CREATE OR REPLACE FUNCTION public._data_sync_company(_run_id uuid, _name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c uuid; n text := btrim(_name);
BEGIN
  IF n IS NULL OR n = '' THEN RETURN NULL; END IF;
  SELECT id INTO c FROM public.companies WHERE lower(btrim(name)) = lower(n) ORDER BY created_at LIMIT 1;
  IF c IS NOT NULL THEN RETURN c; END IF;
  -- Created pending review (the column default), like any company nobody has checked yet.
  INSERT INTO public.companies (name) VALUES (n) RETURNING id INTO c;
  INSERT INTO public.data_sync_changes (run_id, entity, entity_id, kind, after) VALUES (_run_id, 'company', c, 'create', jsonb_build_object('name', n));
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public._data_sync_company(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.data_sync_apply(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE run public.data_sync_runs; r record; o public.opportunities; ch jsonb; comp uuid; newid uuid; n_upd int := 0; n_new int := 0;
        n_dup int := 0; n_note int := 0; st text; who record; extra jsonb;
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
         summary = summary || jsonb_build_object('applied', jsonb_build_object('updated', n_upd, 'created', n_new, 'duplicates_archived', n_dup, 'notes', n_note))
   WHERE id = _run_id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (run.actor_id, 'system', 'data_sync.applied', 'data_sync_run', _run_id,
          jsonb_build_object('updated', n_upd, 'created', n_new, 'duplicates_archived', n_dup, 'notes', n_note, 'source', run.source, 'as_of', run.as_of));
  RETURN jsonb_build_object('updated', n_upd, 'created', n_new, 'duplicates_archived', n_dup, 'notes', n_note);
END $$;
REVOKE ALL ON FUNCTION public.data_sync_apply(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_sync_apply(uuid) TO service_role;

-- 6. Undo: newest change first. Created deals are archived, not deleted; created companies stay (pending review).
-- won_at / lost_at once set are kept by stamp_outcome_dates; the stage is restored, which is what the dashboards read.
CREATE OR REPLACE FUNCTION public.data_sync_undo(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE run public.data_sync_runs; c record; n int := 0; b jsonb;
BEGIN
  SELECT * INTO run FROM public.data_sync_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND OR run.status <> 'applied' THEN RAISE EXCEPTION 'Only an applied run can be undone.' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('phc.data_sync', 'on', true);
  FOR c IN SELECT * FROM public.data_sync_changes WHERE run_id = _run_id AND entity = 'opportunity' ORDER BY id DESC LOOP
    b := c.before;
    IF c.kind = 'create' THEN
      UPDATE public.opportunities SET stage = 'archived', exclusion_reason = 'other',
             extra_data = coalesce(extra_data, '{}'::jsonb) || jsonb_build_object('data_sync_undone', _run_id)
       WHERE id = c.entity_id;
    ELSIF c.kind = 'archive_duplicate' THEN
      UPDATE public.opportunities SET stage = (b->>'stage')::public.opportunity_stage,
             exclusion_reason = (b->>'exclusion_reason')::public.exclusion_reason, extra_data = b->'extra_data'
       WHERE id = c.entity_id;
    ELSIF b ? 'sales_stage' THEN
      UPDATE public.opportunities SET sales_stage = (b->>'sales_stage')::public.sales_stage, loss_reason = b->>'loss_reason',
             quotation_value = (b->>'quotation_value')::numeric, last_activity_at = (b->>'last_activity_at')::timestamptz,
             owner_id = (b->>'owner_id')::uuid, company_id = (b->>'company_id')::uuid,
             expected_contract_date = (b->>'expected_contract_date')::date, extra_data = b->'extra_data'
       WHERE id = c.entity_id;
    ELSE
      UPDATE public.opportunities SET extra_data = b->'extra_data' WHERE id = c.entity_id;
    END IF;
    n := n + 1;
  END LOOP;
  PERFORM set_config('phc.data_sync', '', true);
  UPDATE public.data_sync_runs SET status = 'undone', undone_at = now() WHERE id = _run_id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (run.actor_id, 'system', 'data_sync.undone', 'data_sync_run', _run_id, jsonb_build_object('changes_reversed', n));
  RETURN jsonb_build_object('changes_reversed', n);
END $$;
REVOKE ALL ON FUNCTION public.data_sync_undo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_sync_undo(uuid) TO service_role;

-- 7. The review list: what a run could not decide, and deals still missing an owner or a value.
CREATE OR REPLACE VIEW public.data_sync_review WITH (security_invoker = true) AS
SELECT x.run_id, x.id AS row_id, x.sheet, x.row_no, x.payload->>'code' AS sales_code, x.payload->>'project' AS project,
       x.payload->>'client' AS client, x.payload->>'status' AS file_status, x.action, x.opportunity_id,
       coalesce(x.reason, CASE WHEN (x.detail->>'needs_owner')::boolean THEN 'No owner: the code prefix has no account'
                                WHEN (x.detail->>'needs_value')::boolean THEN 'No numeric amount in the file' END) AS reason,
       x.detail
  FROM public.data_sync_rows x
 WHERE x.action = 'review' OR (x.detail->>'needs_owner')::boolean OR (x.detail->>'needs_value')::boolean;
GRANT SELECT ON public.data_sync_review TO authenticated;
