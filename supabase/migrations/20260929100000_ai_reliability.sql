-- AI advice and its human decision form one durable, permission-checked record.
ALTER TABLE public.ai_recommendations ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE public.ai_recommendations ADD COLUMN task_id uuid REFERENCES public.tasks(id);
ALTER TABLE public.ai_recommendations ADD COLUMN approval_id uuid REFERENCES public.approvals(id);

CREATE OR REPLACE FUNCTION public.create_ai_recommendation(_rec jsonb, _evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_recommendations; BEGIN
  IF jsonb_typeof(_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(_evidence) < 1 OR jsonb_array_length(_evidence) > 50 THEN
    RAISE EXCEPTION 'A recommendation requires bounded evidence'; END IF;
  INSERT INTO public.ai_recommendations(agent_key,run_id,title,recommendation,rationale,confidence,severity,
    entity_type,entity_id,suggested_action,required_approval_type,missing_data,status)
  VALUES(_rec->>'agent_key',(_rec->>'run_id')::uuid,_rec->>'title',_rec->>'recommendation',_rec->>'rationale',
    (_rec->>'confidence')::numeric,_rec->>'severity',_rec->>'entity_type',(_rec->>'entity_id')::uuid,
    _rec->>'suggested_action',_rec->>'required_approval_type',
    ARRAY(SELECT jsonb_array_elements_text(coalesce(_rec->'missing_data','[]'))),'open') RETURNING * INTO r;
  INSERT INTO public.ai_evidence_items(recommendation_id,label,field,value,source_type,source_ref,source_url,weight)
    SELECT r.id,e->>'label',e->>'field',e->>'value',e->>'source_type',e->>'source_ref',e->>'source_url',(e->>'weight')::numeric
      FROM jsonb_array_elements(_evidence) e;
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.create_ai_recommendation(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_ai_recommendation(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.decide_ai_recommendation(_id uuid, _action text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_recommendations; u uuid := auth.uid(); next_status text;
  task_uuid uuid; approval_uuid uuid;
BEGIN
  IF NOT public.has_app_access(u) OR NOT public.is_sales_contributor(u) THEN
    RAISE EXCEPTION 'Sales authority required' USING ERRCODE='42501'; END IF;
  IF _action IS NULL OR _action NOT IN ('accept','dismiss','request_review','create_task','create_approval') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO r FROM public.ai_recommendations WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_read_ai_recommendation(r.entity_type,r.entity_id,u) THEN
    RAISE EXCEPTION 'Recommendation unavailable' USING ERRCODE='42501'; END IF;
  IF r.status <> 'open' THEN
    IF EXISTS(SELECT 1 FROM public.ai_agent_feedback WHERE recommendation_id=_id AND user_id=u AND action=_action) THEN
      RETURN jsonb_build_object('ok',true,'status',r.status,'task_id',r.task_id,'approval_id',r.approval_id,'replayed',true);
    END IF;
    RAISE EXCEPTION 'Recommendation already decided' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ai_evidence_items WHERE recommendation_id=_id) THEN RAISE EXCEPTION 'Evidence required'; END IF;
  IF _action='dismiss' AND btrim(coalesce(_note,''))='' THEN RAISE EXCEPTION 'Dismissal reason required' USING ERRCODE='23514'; END IF;
  IF length(coalesce(_note,''))>2000 THEN RAISE EXCEPTION 'Decision note too long'; END IF;
  next_status := CASE _action WHEN 'dismiss' THEN 'dismissed' WHEN 'request_review' THEN 'open'
    WHEN 'create_approval' THEN 'open' WHEN 'create_task' THEN 'actioned' ELSE 'accepted' END;
  task_uuid := r.task_id; approval_uuid := r.approval_id;
  IF _action='create_task' THEN
    IF r.required_approval_type IS NOT NULL THEN RAISE EXCEPTION 'Commercial approval required; create an approval request'; END IF;
    IF r.entity_type='opportunity' AND NOT public.can_read_boq(r.entity_id,u) THEN RAISE EXCEPTION 'Opportunity unavailable'; END IF;
    INSERT INTO public.tasks(title,related_opportunity_id,owner_id,created_by,source)
      VALUES(left(r.recommendation,500),CASE WHEN r.entity_type='opportunity' THEN r.entity_id END,u,u,'ai_recommendation:'||r.id) RETURNING id INTO task_uuid;
  END IF;
  IF _action IN ('create_approval','request_review') OR (_action='accept' AND r.required_approval_type IS NOT NULL) THEN
    IF r.entity_type <> 'opportunity' OR r.entity_id IS NULL THEN RAISE EXCEPTION 'An opportunity is required for a commercial approval request'; END IF;
    IF approval_uuid IS NULL THEN
      INSERT INTO public.approvals(related_opportunity_id,approval_type,requested_by,status,recommendation,decision_notes,linked_record_type,linked_record_id)
        VALUES(r.entity_id,coalesce(r.required_approval_type,'ai_recommendation'),u,'pending','management_review',r.title,'ai_recommendation',r.id)
        RETURNING id INTO approval_uuid;
    END IF;
  END IF;
  UPDATE public.ai_recommendations SET status=next_status,task_id=task_uuid,approval_id=approval_uuid,
    decision_note=_note,decided_by=CASE WHEN next_status <> 'open' THEN u END,
    decided_at=CASE WHEN next_status <> 'open' THEN now() END WHERE id=r.id;
  INSERT INTO public.ai_agent_feedback(recommendation_id,user_id,action,note) VALUES(r.id,u,_action,_note);
  INSERT INTO public.audit_log(actor_id,actor_type,action,entity_type,entity_id,after_value)
    VALUES(u,'user','ai_recommendation.'||_action,'ai_recommendation',r.id,
      jsonb_build_object('status',next_status,'task_id',task_uuid,'approval_id',approval_uuid));
  RETURN jsonb_build_object('ok',true,'status',next_status,'task_id',task_uuid,'approval_id',approval_uuid);
END $$;
REVOKE ALL ON FUNCTION public.decide_ai_recommendation(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_ai_recommendation(uuid,text,text) TO authenticated;
-- Decisions cannot be forged by directly updating status or provenance.
REVOKE UPDATE ON public.ai_recommendations FROM authenticated;

CREATE OR REPLACE FUNCTION public.can_read_ai_recommendation(
  _entity_type TEXT, _entity_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF _user_id IS NULL OR NOT public.is_active_user(_user_id) THEN
    RETURN FALSE;
  END IF;

  -- Advice with no subject is infrastructure noise, not deal information; it
  -- reaches the pipeline and nobody else.
  IF _entity_id IS NULL OR _entity_type IS NULL THEN
    RETURN public.is_pipeline_operator(_user_id);
  END IF;

  CASE lower(_entity_type)
    WHEN 'opportunity' THEN
      RETURN public.can_read_boq(_entity_id, _user_id);

    WHEN 'quotation' THEN
      RETURN public.can_read_quotation(_entity_id, _user_id);

    WHEN 'rfq' THEN
      RETURN EXISTS (SELECT 1 FROM public.rfqs r
                      WHERE r.id = _entity_id
                        AND (r.sales_owner_id = _user_id OR r.assigned_to = _user_id))
             OR public.is_pipeline_operator(_user_id);

    WHEN 'tender' THEN
      RETURN EXISTS (SELECT 1 FROM public.tenders t
                      WHERE t.id = _entity_id AND t.tender_owner_id = _user_id)
             OR public.is_pipeline_operator(_user_id);

    -- Company- and contact-level advice is account intelligence: the pipeline
    -- sees it, an unrelated salesperson does not.
    WHEN 'lead' THEN
      RETURN EXISTS(SELECT 1 FROM public.leads WHERE id=_entity_id AND owner_id=_user_id) OR public.is_pipeline_operator(_user_id);

    WHEN 'company', 'contact' THEN
      RETURN public.is_pipeline_operator(_user_id);

    ELSE
      RETURN FALSE;
  END CASE;
END; $$;


-- Evidence and feedback must not reveal a recommendation hidden from its caller.
CREATE POLICY ai_evidence_source_boundary ON public.ai_evidence_items AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.has_app_access(auth.uid()) AND EXISTS(SELECT 1 FROM public.ai_recommendations r WHERE r.id=recommendation_id AND public.can_read_ai_recommendation(r.entity_type,r.entity_id,auth.uid())));
CREATE POLICY ai_feedback_source_boundary ON public.ai_agent_feedback AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.has_app_access(auth.uid()) AND EXISTS(SELECT 1 FROM public.ai_recommendations r WHERE r.id=recommendation_id AND public.can_read_ai_recommendation(r.entity_type,r.entity_id,auth.uid())));
REVOKE INSERT,UPDATE,DELETE ON public.ai_evidence_items,public.ai_agent_feedback FROM authenticated;

-- Keep the older recommendation UI on the same atomic decision boundary.
ALTER TABLE public.recommendations ADD COLUMN approval_id uuid REFERENCES public.approvals(id);
CREATE FUNCTION public.accept_legacy_ai_recommendation(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.recommendations; a public.approvals; u uuid:=auth.uid(); BEGIN
  IF NOT public.has_app_access(u) OR NOT public.is_sales_contributor(u) THEN
    RAISE EXCEPTION 'Sales authority required' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.recommendations WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR NOT (coalesce(r.suggested_owner_id=u,false) OR public.is_pipeline_operator(u))
    OR (r.related_opportunity_id IS NOT NULL AND NOT public.can_read_boq(r.related_opportunity_id,u)) THEN
    RAISE EXCEPTION 'Recommendation unavailable' USING ERRCODE='42501'; END IF;
  IF r.status='accepted' THEN
    SELECT * INTO a FROM public.approvals WHERE id=r.approval_id;
    RETURN jsonb_build_object('ok',true,'approval',to_jsonb(a),'replayed',true);
  END IF;
  IF r.status<>'pending' THEN RAISE EXCEPTION 'Recommendation already decided'; END IF;
  IF r.required_approval_type IS NOT NULL THEN
    IF r.related_opportunity_id IS NULL THEN RAISE EXCEPTION 'Approval requires an opportunity'; END IF;
    INSERT INTO public.approvals(related_opportunity_id,approval_type,requested_by,status,recommendation,linked_record_type,linked_record_id)
      VALUES(r.related_opportunity_id,r.required_approval_type,u,'pending','proceed','recommendation',r.id) RETURNING * INTO a;
  END IF;
  UPDATE public.recommendations SET status='accepted',approval_id=a.id WHERE id=r.id;
  INSERT INTO public.audit_log(actor_id,actor_type,action,entity_type,entity_id,after_value)
    VALUES(u,'user','recommendation.accepted','recommendation',r.id,jsonb_build_object('approval_id',a.id));
  RETURN jsonb_build_object('ok',true,'approval',to_jsonb(a));
END $$;
REVOKE ALL ON FUNCTION public.accept_legacy_ai_recommendation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_legacy_ai_recommendation(uuid) TO authenticated;
-- The existing direct dismissal UI remains available; acceptance and changing
-- ownership, approval requirements or provenance require a server decision.
REVOKE UPDATE ON public.recommendations FROM authenticated;
GRANT UPDATE(status) ON public.recommendations TO authenticated;
CREATE POLICY legacy_recommendation_dismiss_only ON public.recommendations AS RESTRICTIVE
  FOR UPDATE TO authenticated USING(public.has_app_access(auth.uid()) AND status='pending')
  WITH CHECK(status='dismissed');
