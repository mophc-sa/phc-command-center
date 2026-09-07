\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid; b uuid; f uuid; r uuid; payload jsonb; rejected boolean:=false;
BEGIN
  INSERT INTO auth.users(email) VALUES('duplicate-refresh-behaviour@phc-sa.com') RETURNING id INTO u;
  INSERT INTO public.import_batches(created_by,status,target_entity) VALUES(u,'duplicate_review','companies') RETURNING id INTO b;
  INSERT INTO public.import_files(batch_id,file_name,file_type,file_size_bytes,storage_path)
    VALUES(b,'fixture.csv','csv',20,'local-fixture') RETURNING id INTO f;
  INSERT INTO public.import_rows(batch_id,file_id,row_number,raw_data,status)
    VALUES(b,f,1,'{}','valid') RETURNING id INTO r;
  payload:=jsonb_build_array(jsonb_build_object('row_id',r,'existing_record_id',u,'existing_table','companies',
    'match_type','name','confidence',95,'match_scope','existing_crm','reason_code','name_match',
    'matched_fields',jsonb_build_array('name'),'suggested_action','link_to_existing'));
  PERFORM public.refresh_import_duplicate_review(b,payload);
  UPDATE public.import_duplicate_candidates SET resolution='skip',resolved_by=u,resolved_at=now() WHERE batch_id=b;
  PERFORM public.refresh_import_duplicate_review(b,payload);
  IF (SELECT count(*) FROM public.import_duplicate_candidates WHERE batch_id=b) <> 1 THEN RAISE EXCEPTION 'Rerun appended duplicates'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.import_duplicate_candidates WHERE batch_id=b AND resolution='skip' AND resolved_by=u) THEN RAISE EXCEPTION 'Decision was lost'; END IF;
  BEGIN
    PERFORM public.refresh_import_duplicate_review(b,jsonb_set(payload,'{0,row_id}',to_jsonb(gen_random_uuid())));
  EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected OR (SELECT count(*) FROM public.import_duplicate_candidates WHERE batch_id=b) <> 1 THEN RAISE EXCEPTION 'Invalid refresh changed staging'; END IF;
  PERFORM public.refresh_import_duplicate_review(b,'[]');
  IF EXISTS(SELECT 1 FROM public.import_duplicate_candidates WHERE batch_id=b) THEN RAISE EXCEPTION 'Stale match retained'; END IF;
  IF (SELECT status FROM public.import_rows WHERE id=r) <> 'valid' THEN RAISE EXCEPTION 'Stale duplicate row status'; END IF;
  IF (SELECT duplicate_rows FROM public.import_batches WHERE id=b) <> 0 THEN RAISE EXCEPTION 'Stale duplicate count'; END IF;
  IF has_function_privilege('authenticated','public.refresh_import_duplicate_review(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'RPC exposed to authenticated'; END IF;
  UPDATE public.import_batches SET status='committed' WHERE id=b;
  rejected:=false;
  BEGIN
    PERFORM public.refresh_import_duplicate_review(b,payload);
  EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Finalized batch was editable'; END IF;
  RAISE NOTICE 'PASS duplicate refresh replaces matches, preserves decisions, rejects foreign rows and finalized batches';
END $$;
ROLLBACK;
