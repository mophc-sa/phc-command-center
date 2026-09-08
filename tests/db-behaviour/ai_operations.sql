\set ON_ERROR_STOP on
-- Actual SQL/RLS behavior, with isolated users and no production data.
DO $$
DECLARE u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); manager_u uuid:=gen_random_uuid(); viewer_u uuid:=gen_random_uuid();
 o uuid; d uuid; s jsonb; r jsonb; v timestamptz; BEGIN
 INSERT INTO auth.users(id,email) VALUES(u,'aiops_owner@phc-sa.com'),(other_u,'aiops_other@phc-sa.com'),(manager_u,'aiops_manager@phc-sa.com'),(viewer_u,'aiops_viewer@phc-sa.com');
 UPDATE public.profiles SET status='active' WHERE id IN(u,other_u,manager_u,viewer_u);
 INSERT INTO public.user_roles(user_id,role) VALUES(u,'salesperson'),(other_u,'salesperson'),(manager_u,'sales_manager'),(viewer_u,'viewer');
 INSERT INTO public.opportunities(project_name,owner_id,sales_stage) VALUES('AI operations fixture',u,'jih') RETURNING id,updated_at INTO o,v;
 INSERT INTO public.documents(storage_bucket,storage_path,original_filename,mime_type,size_bytes,uploaded_by)
 VALUES('attachments','aiops/'||o||'/approved.txt','approved.txt','text/plain',100,manager_u) RETURNING id INTO d;
 INSERT INTO public.document_links(document_id,entity_type,entity_id,linked_by) VALUES(d,'opportunity',o,manager_u);
 s:=public.prepare_ai_knowledge(manager_u,'document',d,'Private company document','PHC private project evidence', (SELECT updated_at FROM public.documents WHERE id=d));
 r:=public.create_ai_recommendation(jsonb_build_object('agent_key','test','title','Follow up','recommendation','Call the project manager','entity_type','opportunity','entity_id',o),
   jsonb_build_array(jsonb_build_object('label','Follow-up','source_ref','opportunity:'||o,'value','No next action')));
 CREATE TEMP TABLE aiops_fixture AS SELECT u owner_u,other_u,manager_u,viewer_u,o opportunity_id,v source_version,d document_id,(s->>'id')::uuid source_id,s->>'content_hash' hash,(r->>'id')::uuid rec_id;
 GRANT SELECT ON aiops_fixture TO rls_tester;
END $$;

SET ROLE rls_tester;
DO $$ DECLARE f record; n integer; a jsonb; b jsonb; BEGIN
 SELECT * INTO f FROM aiops_fixture;
 PERFORM set_config('test.uid',f.other_u::text,true);
 BEGIN PERFORM public.decide_ai_recommendation(f.rec_id,'create_task',NULL);RAISE NOTICE 'FAIL unrelated user created a recommendation task';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS unrelated user cannot act on advice'; END;
 SELECT count(*) INTO n FROM public.ai_evidence_items WHERE recommendation_id=f.rec_id;
 RAISE NOTICE '% evidence inherits recommendation access',CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END;
 SELECT count(*) INTO n FROM public.ai_knowledge_sources WHERE id=f.source_id;
 RAISE NOTICE '% unrelated user cannot read extracted document text',CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END;
 PERFORM set_config('test.uid',f.viewer_u::text,true);
 BEGIN PERFORM public.approve_ai_daily_task('opportunity',f.opportunity_id,f.source_version,'Review missing next action',NULL);RAISE NOTICE 'FAIL viewer created task';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS viewer cannot approve tasks'; END;
 PERFORM set_config('test.uid',f.owner_u::text,true);
 a:=public.decide_ai_recommendation(f.rec_id,'create_task',NULL);
 b:=public.decide_ai_recommendation(f.rec_id,'create_task',NULL);
 SELECT count(*) INTO n FROM public.tasks WHERE id=(a->>'task_id')::uuid AND owner_id=f.owner_u AND related_opportunity_id=f.opportunity_id;
 RAISE NOTICE '% recommendation creates exactly one real linked task',CASE WHEN n=1 AND a->>'task_id'=b->>'task_id' AND b->>'replayed'='true' THEN 'PASS' ELSE 'FAIL' END;
 a:=public.approve_ai_daily_task('opportunity',f.opportunity_id,f.source_version,'Review missing next action','2026-09-09');
 b:=public.approve_ai_daily_task('opportunity',f.opportunity_id,f.source_version,'Repeated click','2026-09-09');
 RAISE NOTICE '% daily task approval is idempotent',CASE WHEN a->'task'->>'id'=b->'task'->>'id' AND b->>'replayed'='true' THEN 'PASS' ELSE 'FAIL' END;
 BEGIN PERFORM public.approve_ai_daily_task('opportunity',f.opportunity_id,f.source_version-interval '1 day','Outdated suggestion',NULL);RAISE NOTICE 'FAIL stale daily suggestion accepted';
 EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'PASS stale daily suggestion requires renewed review';END;
 SELECT count(*) INTO n FROM public.knowledge_chunks WHERE knowledge_source_id=f.source_id;
 RAISE NOTICE '% unapproved knowledge is absent from retrieval',CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END;
 BEGIN PERFORM public.review_ai_knowledge(f.source_id,f.hash,'approve');RAISE NOTICE 'FAIL salesperson approved company knowledge';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS knowledge approval requires pipeline authority';END;
 PERFORM set_config('test.uid',f.manager_u::text,true);
 BEGIN PERFORM public.review_ai_knowledge(f.source_id,'changed-hash','approve');RAISE NOTICE 'FAIL mismatched source hash approved';
 EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'PASS approval binds to the exact reviewed content';END;
 PERFORM public.review_ai_knowledge(f.source_id,f.hash,'approve');
END $$;
RESET ROLE;
DO $$ DECLARE f record; vec jsonb; n integer; BEGIN
 SELECT * INTO f FROM aiops_fixture;
 SELECT jsonb_agg(0.1) INTO vec FROM generate_series(1,384);
 n:=public.publish_ai_knowledge(f.source_id,f.hash,jsonb_build_array(jsonb_build_object('content','PHC private project evidence','embedding',vec)));
 RAISE NOTICE '% approved knowledge publishes atomically',CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END;
 BEGIN PERFORM public.publish_ai_knowledge(f.source_id,f.hash,jsonb_build_array(jsonb_build_object('content','Forged text','embedding',vec)));
  RAISE NOTICE 'FAIL index accepted unsupported chunk';EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'PASS index rejects chunks outside the approved source';END;
 SELECT count(*) INTO n FROM public.knowledge_chunks WHERE knowledge_source_id=f.source_id;
 RAISE NOTICE '% failed replacement preserves the previous index',CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END;
END $$;
SET ROLE rls_tester;
DO $$ DECLARE f record; n integer; vec extensions.vector; BEGIN
 SELECT * INTO f FROM aiops_fixture;
 SELECT ('['||string_agg('0.1',',')||']')::extensions.vector INTO vec FROM generate_series(1,384);
 PERFORM set_config('test.uid',f.owner_u::text,true);
 SELECT count(*) INTO n FROM public.match_knowledge(vec,20,'document') WHERE source_id=f.document_id;
 RAISE NOTICE '% owner can retrieve an approved linked document',CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END;
 PERFORM set_config('test.uid',f.other_u::text,true);
 SELECT count(*) INTO n FROM public.match_knowledge(vec,20,'document') WHERE source_id=f.document_id;
 RAISE NOTICE '% semantic RPC does not bypass document permissions',CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END;
 PERFORM set_config('test.uid',f.manager_u::text,true);
 PERFORM public.review_ai_knowledge(f.source_id,f.hash,'revoke');
 PERFORM set_config('test.uid',f.owner_u::text,true);
 SELECT count(*) INTO n FROM public.match_knowledge(vec,20,'document') WHERE source_id=f.document_id;
 RAISE NOTICE '% revoked knowledge disappears immediately',CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END;
END $$;
RESET ROLE;
DO $$ DECLARE f record; n integer; before_count integer; BEGIN
 SELECT * INTO f FROM aiops_fixture;
 SELECT count(*) INTO before_count FROM public.ai_recommendations;
 BEGIN PERFORM public.create_ai_recommendation('{"agent_key":"test","title":"Should roll back","recommendation":"Not saved"}','[{"value":"missing label"}]');
  RAISE NOTICE 'FAIL recommendation without evidence saved';EXCEPTION WHEN not_null_violation THEN RAISE NOTICE 'PASS invalid evidence rolls back recommendation';END;
 SELECT count(*) INTO n FROM public.ai_recommendations;
 RAISE NOTICE '% no orphan recommendation after an evidence failure',CASE WHEN n=before_count THEN 'PASS' ELSE 'FAIL' END;
 UPDATE public.ai_usage_limits SET daily_per_user=1 WHERE kind='evaluation';
 RAISE NOTICE '% first usage reservation allowed',CASE WHEN public.reserve_ai_usage(f.owner_u,'evaluation') THEN 'PASS' ELSE 'FAIL' END;
 RAISE NOTICE '% over-limit usage is rejected before provider work',CASE WHEN NOT public.reserve_ai_usage(f.owner_u,'evaluation') THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- The legacy acceptance route also locks once and cannot create duplicate approvals.
DO $$ DECLARE f record; r uuid; BEGIN
 SELECT * INTO f FROM aiops_fixture;
 INSERT INTO public.recommendations(agent_module,recommendation,suggested_owner_id,related_opportunity_id,required_approval_type)
 VALUES('test','Review terms',f.owner_u,f.opportunity_id,'discount') RETURNING id INTO r;
 CREATE TEMP TABLE aiops_legacy AS SELECT r id;
 GRANT SELECT ON aiops_legacy TO rls_tester;
END $$;
SET ROLE rls_tester;
DO $$ DECLARE f record; r uuid; a jsonb; b jsonb; BEGIN
 SELECT * INTO f FROM aiops_fixture; SELECT id INTO r FROM aiops_legacy;
 PERFORM set_config('test.uid',f.other_u::text,true);
 BEGIN PERFORM public.accept_legacy_ai_recommendation(r); RAISE NOTICE 'FAIL foreign legacy advice accepted';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS foreign legacy advice is denied'; END;
 PERFORM set_config('test.uid',f.owner_u::text,true);
 a:=public.accept_legacy_ai_recommendation(r); b:=public.accept_legacy_ai_recommendation(r);
 RAISE NOTICE '% legacy acceptance creates one pending approval',CASE WHEN a->'approval'->>'id'=b->'approval'->>'id' AND a->'approval'->>'status'='pending' AND b->>'replayed'='true' THEN 'PASS' ELSE 'FAIL' END;
END $$;
RESET ROLE;
