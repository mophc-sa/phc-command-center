-- F08: one transaction and one locked source record, including the audit trail.
CREATE OR REPLACE FUNCTION public.convert_lead_atomic(_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.leads; o public.opportunities; u uuid := auth.uid(); BEGIN
  IF NOT public.has_app_access(u) OR NOT public.is_pipeline_operator(u) THEN
    RAISE EXCEPTION 'Sales pipeline authority required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found'; END IF;
  IF l.converted_opportunity_id IS NOT NULL THEN
    SELECT * INTO STRICT o FROM public.opportunities WHERE id = l.converted_opportunity_id;
    RETURN to_jsonb(o);
  END IF;
  IF l.lead_stage NOT IN ('scored','human_review') THEN RAISE EXCEPTION 'Lead must be scored or in human review'; END IF;
  INSERT INTO public.opportunities(project_name, main_contractor, location, estimated_value_max,
    stage, sales_stage, pipeline_step, owner_id, created_by)
  VALUES(l.project_name,l.main_contractor_guess,l.location,l.estimated_value,
    'qualification','rfq_received','qualified_lead',coalesce(l.owner_id,u),u) RETURNING * INTO o;
  UPDATE public.leads SET lead_stage = 'converted', converted_opportunity_id = o.id WHERE id = l.id;
  INSERT INTO public.audit_log(actor_id,actor_type,action,entity_type,entity_id,after_value)
    VALUES(u,'user','lead.converted','lead',l.id,jsonb_build_object('opportunity_id',o.id));
  RETURN to_jsonb(o);
END $$;
REVOKE ALL ON FUNCTION public.convert_lead_atomic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_lead_atomic(uuid) TO authenticated;

-- F09: candidate receipt and CRM write commit together. The service-only RPC
-- verifies the approved snapshot again under a batch lock. Failed candidates
-- roll back locally; successful candidates and the final summary are durable.
ALTER TABLE public.import_batches ADD COLUMN commit_summary jsonb;
ALTER TABLE public.import_record_links ADD COLUMN candidate_id uuid REFERENCES public.import_record_candidates(id);
ALTER TABLE public.import_record_links ADD COLUMN before_value jsonb;
ALTER TABLE public.import_record_links ADD COLUMN after_value jsonb;
ALTER TABLE public.import_record_links ADD COLUMN reversed_at timestamptz;
CREATE UNIQUE INDEX import_one_receipt_per_candidate ON public.import_record_links(candidate_id) WHERE candidate_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.commit_import_batch_atomic(_batch_id uuid, _actor_id uuid, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.import_batches; c public.import_record_candidates; item jsonb; p jsonb;
  t text; cols text; vals text; setters text; before_row jsonb; after_row jsonb; target uuid;
  committed integer := 0; failed integer := 0; expected integer; result jsonb;
BEGIN
  IF NOT public.is_platform_admin(_actor_id) THEN RAISE EXCEPTION 'Import commit authority required'; END IF;
  SELECT * INTO b FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF b.status = 'committed' AND b.commit_summary IS NOT NULL THEN RETURN b.commit_summary; END IF;
  IF b.status <> 'dry_run' THEN RAISE EXCEPTION 'Batch must be in dry_run'; END IF;
  IF NOT b.readiness_checklist @> '{"file_source_confirmed":true,"owner_confirmed":true,"backup_completed":true,"no_unnecessary_sensitive_data":true}' THEN
    RAISE EXCEPTION 'Readiness checklist incomplete';
  END IF;
  -- Lock the reviewed set, and require complete, unique input (no 1000-row truncation).
  PERFORM id FROM public.import_record_candidates WHERE batch_id = _batch_id FOR UPDATE;
  SELECT count(*) INTO expected FROM public.import_record_candidates WHERE batch_id = _batch_id AND review_status = 'approved';
  IF expected = 0 OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) <> expected
    OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(_items) x) <> expected THEN
    RAISE EXCEPTION 'Incomplete or duplicate approved candidate set';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO c FROM public.import_record_candidates WHERE id = (item->>'id')::uuid AND batch_id = _batch_id;
    IF NOT FOUND OR c.review_status <> 'approved' OR c.proposed_payload IS DISTINCT FROM item->'source_payload'
      OR c.proposed_action IS DISTINCT FROM item->>'action' OR c.existing_record_id IS DISTINCT FROM (item->>'existing_record_id')::uuid
      OR c.entity_type IS DISTINCT FROM item->>'entity_type' THEN
      RAISE EXCEPTION 'Reviewed candidate changed; reload and review before commit';
    END IF;
    BEGIN
      t := CASE c.entity_type WHEN 'boq' THEN 'boqs' WHEN 'sales_actuals' THEN 'sales_actuals_monthly' ELSE c.entity_type END;
      IF NOT t = ANY(ARRAY['companies','contacts','leads','opportunities','projects','quotations','follow_ups',
        'account_interactions','quotation_updates','sales_actuals_monthly','boqs','rfqs','tenders']) THEN RAISE EXCEPTION 'Unsupported entity'; END IF;
      IF c.source_row_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.import_rows WHERE id = c.source_row_id AND batch_id = _batch_id) THEN
        RAISE EXCEPTION 'Candidate source row does not belong to batch'; END IF;
      IF c.proposed_action NOT IN ('create','update') THEN RAISE EXCEPTION 'Candidate must be create or update'; END IF;
      IF c.proposed_action = 'update' AND (c.existing_record_id IS NULL OR (c.existing_table IS NOT NULL AND c.existing_table <> t)) THEN
        RAISE EXCEPTION 'Update target does not match candidate entity'; END IF;
      p := item->'payload';
      IF jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'Invalid normalized payload'; END IF;
      p := p - ARRAY['id','created_at','updated_at','created_by'];
      IF c.proposed_action = 'create' THEN
        IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='created_by') THEN
          p := p || jsonb_build_object('created_by',_actor_id); END IF;
        IF t = 'leads' THEN p := p || jsonb_build_object('lead_stage','detected','source',coalesce(nullif(p->>'source',''),'import')); END IF;
      END IF;
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT EXISTS(
        SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name=k AND is_generated='NEVER')) THEN
        RAISE EXCEPTION 'Unknown or generated target column'; END IF;
      SELECT string_agg(format('%I',k),','), string_agg(format('r.%I',k),','),
        string_agg(format('%I = r.%I',k,k),',') INTO cols,vals,setters FROM jsonb_object_keys(p) k;
      before_row := NULL;
      IF c.proposed_action = 'create' THEN
        IF cols IS NULL THEN
          EXECUTE format('INSERT INTO public.%I DEFAULT VALUES RETURNING id',t) INTO target;
        ELSE
          EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) r RETURNING id',t,cols,vals,t) INTO target USING p;
        END IF;
      ELSE
        target := c.existing_record_id;
        EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 FOR UPDATE',t) INTO before_row USING target;
        IF before_row IS NULL THEN RAISE EXCEPTION 'Update target not found'; END IF;
        IF cols IS NOT NULL THEN
          EXECUTE format('UPDATE public.%I AS target SET %s FROM jsonb_populate_record(NULL::public.%I,$1) r WHERE target.id=$2',t,setters,t) USING p,target;
        END IF;
      END IF;
      EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1',t) INTO after_row USING target;
      INSERT INTO public.import_record_links(batch_id,row_id,candidate_id,target_table,target_id,action,before_value,after_value)
        VALUES(_batch_id,c.source_row_id,c.id,t,target,CASE c.proposed_action WHEN 'create' THEN 'created' ELSE 'updated' END,before_row,after_row);
      INSERT INTO public.audit_log(actor_id,actor_type,action,entity_type,entity_id,after_value)
        VALUES(_actor_id,'user','import.candidate_committed',t,target,jsonb_build_object('batch_id',_batch_id,'candidate_id',c.id));
      committed := committed + 1;
    EXCEPTION WHEN OTHERS THEN
      failed := failed + 1;
      INSERT INTO public.import_errors(batch_id,row_id,row_number,column_name,error_type,message,severity)
        VALUES(_batch_id,c.source_row_id,0,'*','custom',SQLERRM,'error');
    END;
  END LOOP;
  result := jsonb_build_object('committed',committed,'failed',failed,'total',expected);
  UPDATE public.import_batches SET status='committed',committed_at=now(),commit_summary=result WHERE id=_batch_id;
  INSERT INTO public.audit_log(actor_id,actor_type,action,entity_type,entity_id,after_value)
    VALUES(_actor_id,'user','import_commit_candidates','import_batches',_batch_id,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.commit_import_batch_atomic(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_import_batch_atomic(uuid,uuid,jsonb) TO service_role;

-- A completed receipt cannot be discarded by regenerating candidates or tampering
-- with staging tables through PostgREST. Service-only rollback owns provenance.
REVOKE INSERT, UPDATE, DELETE ON public.import_record_links FROM authenticated;
CREATE OR REPLACE FUNCTION public.guard_committed_import_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.import_record_links WHERE candidate_id=OLD.id) THEN
    RAISE EXCEPTION 'Committed candidate is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_committed_candidate BEFORE UPDATE OR DELETE ON public.import_record_candidates
FOR EACH ROW EXECUTE FUNCTION public.guard_committed_import_candidate();

CREATE OR REPLACE FUNCTION public.rollback_import_batch_atomic(_batch_id uuid, _actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.import_batches; l public.import_record_links; current_row jsonb; setters text;
  rolled integer := 0; manual integer := 0; referenced integer := 0; total integer := 0;
  fk record; used boolean; result jsonb;
BEGIN
  IF NOT public.is_platform_admin(_actor_id) THEN RAISE EXCEPTION 'Import rollback authority required'; END IF;
  SELECT * INTO b FROM public.import_batches WHERE id=_batch_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('committed','rolled_back') THEN RAISE EXCEPTION 'Only finalized batches can be rolled back'; END IF;
  FOR l IN SELECT * FROM public.import_record_links WHERE batch_id=_batch_id ORDER BY created_at DESC,id FOR UPDATE LOOP
    total := total + 1;
    IF l.reversed_at IS NOT NULL THEN rolled := rolled + 1; CONTINUE; END IF;
    IF l.after_value IS NULL OR NOT l.target_table = ANY(ARRAY['companies','contacts','leads','opportunities','projects','quotations','follow_ups',
      'account_interactions','quotation_updates','sales_actuals_monthly','boqs','rfqs','tenders']) THEN manual := manual+1; CONTINUE; END IF;
    BEGIN
      EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 FOR UPDATE',l.target_table) INTO current_row USING l.target_id;
      IF current_row IS DISTINCT FROM l.after_value THEN
        -- Never overwrite post-import edits or silently declare a missing row restored.
        manual := manual + 1; CONTINUE;
      END IF;
      IF l.action='created' THEN
        -- Refuse even cascading references: rollback must not delete later work.
        used := false;
        FOR fk IN SELECT n.nspname, c.relname, a.attname FROM pg_constraint f
          JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=f.conkey[1]
          WHERE f.contype='f' AND f.confrelid=format('public.%I',l.target_table)::regclass LOOP
          EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',fk.nspname,fk.relname,fk.attname) INTO used USING l.target_id;
          EXIT WHEN used;
        END LOOP;
        IF used THEN referenced := referenced+1; CONTINUE; END IF;
        EXECUTE format('DELETE FROM public.%I WHERE id=$1',l.target_table) USING l.target_id;
      ELSIF l.action='updated' AND l.before_value IS NOT NULL THEN
        SELECT string_agg(format('%I=r.%I',column_name,column_name),',') INTO setters
        FROM information_schema.columns WHERE table_schema='public' AND table_name=l.target_table
          AND column_name NOT IN ('id','created_at','updated_at') AND is_generated='NEVER';
        EXECUTE format('UPDATE public.%I AS target SET %s FROM jsonb_populate_record(NULL::public.%I,$1) r WHERE target.id=$2',l.target_table,setters,l.target_table)
          USING l.before_value,l.target_id;
      ELSE manual := manual+1; CONTINUE;
      END IF;
      UPDATE public.import_record_links SET reversed_at=now() WHERE id=l.id;
      rolled := rolled+1;
    EXCEPTION WHEN OTHERS THEN
      manual := manual+1;
    END;
  END LOOP;
  -- A partial rollback stays committed so unresolved rows can be retried.
  IF manual=0 AND referenced=0 THEN
    UPDATE public.import_batches SET status='rolled_back',rolled_back_at=now(),rolled_back_by=_actor_id WHERE id=_batch_id;
  END IF;
  result := jsonb_build_object('rolled_back',rolled,'still_referenced',referenced,'manual_review_required',manual,'total',total);
  INSERT INTO public.audit_log(actor_id,actor_type,action,entity_type,entity_id,after_value)
    VALUES(_actor_id,'user','import_rollback','import_batches',_batch_id,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.rollback_import_batch_atomic(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_import_batch_atomic(uuid,uuid) TO service_role;
