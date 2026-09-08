CREATE UNIQUE INDEX ai_daily_one_open_task ON public.tasks(owner_id,source)
 WHERE source LIKE 'ai_daily:%' AND status='open';
CREATE FUNCTION public.approve_ai_daily_task(_source_type text,_source_id uuid,_source_updated_at timestamptz,_title text,_due date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u uuid:=auth.uid(); linked uuid; version timestamptz; source_key text; t public.tasks; BEGIN
 IF NOT public.has_app_access(u) OR NOT public.is_sales_contributor(u) THEN RAISE EXCEPTION 'Task creation authority required' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(_title,''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Task title must be 1–500 characters'; END IF;
 CASE _source_type
 WHEN 'opportunity' THEN
   SELECT id,updated_at INTO linked,version FROM public.opportunities WHERE id=_source_id
     AND stage<>'archived' AND (owner_id=u OR public.is_pipeline_operator(u)) FOR UPDATE;
 WHEN 'follow_up' THEN
   SELECT opportunity_id,updated_at INTO linked,version FROM public.follow_ups WHERE id=_source_id
     AND status NOT IN ('completed','cancelled') AND owner_id=u FOR UPDATE;
 WHEN 'rfq' THEN
   SELECT opportunity_id,updated_at INTO linked,version FROM public.rfqs WHERE id=_source_id
     AND archived_at IS NULL AND status IN ('open','on_hold') AND (sales_owner_id=u OR assigned_to=u OR public.is_pipeline_operator(u)) FOR UPDATE;
 WHEN 'boq' THEN
   SELECT related_opportunity_id,updated_at INTO linked,version FROM public.boqs WHERE id=_source_id
     AND public.can_read_boq(related_opportunity_id,u) FOR UPDATE;
 ELSE RAISE EXCEPTION 'Unsupported task source'; END CASE;
 IF version IS NULL OR (linked IS NOT NULL AND NOT public.can_read_boq(linked,u)) THEN RAISE EXCEPTION 'Task source unavailable' USING ERRCODE='42501'; END IF;
 IF version IS DISTINCT FROM _source_updated_at THEN RAISE EXCEPTION 'Source changed; refresh and review the task'; END IF;
 source_key:='ai_daily:'||_source_type||':'||_source_id;
 SELECT * INTO t FROM public.tasks WHERE owner_id=u AND source=source_key AND status='open';
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'task',to_jsonb(t),'replayed',true); END IF;
 INSERT INTO public.tasks(title,related_opportunity_id,owner_id,created_by,due_date,source)
   VALUES(btrim(_title),linked,u,u,_due,source_key) RETURNING * INTO t;
 INSERT INTO public.audit_log(actor_id,actor_type,action,entity_type,entity_id,after_value)
   VALUES(u,'user','ai_daily.task_approved','task',t.id,jsonb_build_object('source',source_key,'source_updated_at',version));
 RETURN jsonb_build_object('ok',true,'task',to_jsonb(t),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.approve_ai_daily_task(text,uuid,timestamptz,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_ai_daily_task(text,uuid,timestamptz,text,date) TO authenticated;

CREATE TABLE public.ai_usage_limits(kind text PRIMARY KEY,daily_per_user integer NOT NULL CHECK(daily_per_user BETWEEN 1 AND 10000),
 daily_global integer NOT NULL CHECK(daily_global BETWEEN 1 AND 100000));
INSERT INTO public.ai_usage_limits VALUES('interactive',100,1000),('import',2000,10000),('evaluation',100,300),('knowledge',1000,5000);
CREATE TABLE public.ai_usage_daily(user_id uuid NOT NULL REFERENCES auth.users(id),day date NOT NULL,kind text NOT NULL REFERENCES public.ai_usage_limits(kind),
 calls integer NOT NULL DEFAULT 0,PRIMARY KEY(user_id,day,kind));
ALTER TABLE public.ai_usage_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ai_usage_limits,public.ai_usage_daily TO authenticated;
GRANT ALL ON public.ai_usage_limits,public.ai_usage_daily TO service_role;
CREATE POLICY ai_limits_reader ON public.ai_usage_limits FOR SELECT TO authenticated USING(public.has_app_access(auth.uid()));
CREATE POLICY ai_usage_reader ON public.ai_usage_daily FOR SELECT TO authenticated
 USING(public.has_app_access(auth.uid()) AND (user_id=auth.uid() OR public.is_pipeline_operator(auth.uid())));
CREATE FUNCTION public.reserve_ai_usage(_user uuid,_kind text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE lim public.ai_usage_limits; used integer; day_utc date:=(now() AT TIME ZONE 'UTC')::date; BEGIN
 IF NOT public.is_active_user(_user) THEN RETURN false; END IF;
 SELECT * INTO lim FROM public.ai_usage_limits WHERE kind=_kind;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai_usage:'||_kind||':'||day_utc,0));
 SELECT coalesce(sum(calls),0) INTO used FROM public.ai_usage_daily WHERE day=day_utc AND kind=_kind;
 IF used>=lim.daily_global THEN RETURN false; END IF;
 INSERT INTO public.ai_usage_daily(user_id,day,kind,calls) VALUES(_user,day_utc,_kind,1)
 ON CONFLICT(user_id,day,kind) DO UPDATE SET calls=ai_usage_daily.calls+1 WHERE ai_usage_daily.calls<lim.daily_per_user;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.reserve_ai_usage(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(uuid,text) TO service_role;

CREATE TABLE public.ai_quality_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),requested_by uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL,case_key text NOT NULL,language text NOT NULL CHECK(language IN ('ar','en')),
 provider text NOT NULL,model text NOT NULL,prompt_version text NOT NULL,
 status text NOT NULL CHECK(status IN ('running','succeeded','failed')),
 input_snapshot jsonb NOT NULL,expected jsonb NOT NULL,output jsonb,checks jsonb,error_code text,
 duration_ms integer,input_tokens integer,output_tokens integer,estimated_cost_usd numeric,cost_basis text,
 usefulness integer CHECK(usefulness BETWEEN 1 AND 5),review_note text,reviewed_by uuid REFERENCES auth.users(id),reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(requested_by,request_id,case_key,language,provider,model)
);
ALTER TABLE public.ai_quality_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ai_quality_runs TO authenticated;
GRANT ALL ON public.ai_quality_runs TO service_role;
CREATE POLICY ai_quality_reader ON public.ai_quality_runs FOR SELECT TO authenticated
 USING(public.has_app_access(auth.uid()) AND public.is_pipeline_operator(auth.uid()));
CREATE FUNCTION public.review_ai_quality(_id uuid,_usefulness integer,_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_app_access(auth.uid()) OR NOT public.is_pipeline_operator(auth.uid()) THEN RAISE EXCEPTION 'Quality review authority required' USING ERRCODE='42501'; END IF;
 IF _usefulness IS NULL OR _usefulness NOT BETWEEN 1 AND 5 OR length(btrim(coalesce(_note,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Review score and explanation required'; END IF;
 UPDATE public.ai_quality_runs SET usefulness=_usefulness,review_note=_note,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=_id AND status='succeeded';
 IF NOT FOUND THEN RAISE EXCEPTION 'Completed evaluation unavailable'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.review_ai_quality(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_ai_quality(uuid,integer,text) TO authenticated;
