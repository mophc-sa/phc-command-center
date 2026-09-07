\set ON_ERROR_STOP on
BEGIN;
RESET ROLE;
SELECT set_config('test.uid','',true);
CREATE TEMP TABLE lr_ids(k text primary key,id uuid);
DO $$ DECLARE sm uuid; owner_ uuid; viewer_ uuid; co uuid; bat uuid; r uuid; old_id uuid; i int; BEGIN
  INSERT INTO auth.users(email) VALUES('lr_sm@phc-sa.com') RETURNING id INTO sm;
  INSERT INTO auth.users(email) VALUES('lr_owner@phc-sa.com') RETURNING id INTO owner_;
  INSERT INTO auth.users(email) VALUES('lr_viewer@phc-sa.com') RETURNING id INTO viewer_;
  UPDATE public.profiles SET status='active' WHERE id IN(sm,owner_,viewer_);
  INSERT INTO public.user_roles(user_id,role) VALUES(sm,'sales_manager'),(owner_,'salesperson'),(viewer_,'viewer');
  INSERT INTO public.companies(name) VALUES('LR Client') RETURNING id INTO co;
  INSERT INTO public.historical_sales_owner_map(prefix,user_id,legacy_label) VALUES('LR',owner_,'LR owner');
  INSERT INTO public.historical_sales_batches(source_file,source_sha256,loaded_by) VALUES('lr.csv',repeat('r',64),sm) RETURNING id INTO bat;
  INSERT INTO lr_ids VALUES('sm',sm),('owner',owner_),('viewer',viewer_),('company',co),('batch',bat);
  FOR i IN 1..2 LOOP
    INSERT INTO public.historical_sales_rows(batch_id,row_number,raw) VALUES(bat,i,jsonb_build_object(
      'SALES CODE','LR2600'||i,'CLIENT COMPANY','LR Client','PROJECT NAME','LR Tower '||i,
      'AMOUNT','250000','QUOTATION '||chr(10)||'STATUS','SUBMITTED','SUBMISSION DATE','2/15/2026','JIH / TENDER','JIH')) RETURNING id INTO r;
    INSERT INTO lr_ids VALUES('row'||i,r);
    INSERT INTO public.opportunities(project_name,client,owner_id,quotation_value,currency,stage,sales_stage,extra_data)
      VALUES('LR Tower '||i,'LR Client',owner_,250000,'SAR','qualification','rfq_received',jsonb_build_object(
        'source','PHC Quotation List 2022-2026','sales_code','LR2600'||i,'update_log','Preserve this follow-up')) RETURNING id INTO old_id;
    INSERT INTO lr_ids VALUES('legacy'||i,old_id);
  END LOOP;
  INSERT INTO public.opportunities(project_name,client,owner_id,quotation_value,currency,stage,sales_stage,extra_data)
    SELECT project_name,client,owner_id,quotation_value,currency,stage,sales_stage,extra_data
    FROM public.opportunities WHERE id=(SELECT id FROM lr_ids WHERE k='legacy1') RETURNING id INTO old_id;
  INSERT INTO lr_ids VALUES('second_copy',old_id);
  -- A matching code, project and value with another contractor is a different pursuit.
  INSERT INTO public.opportunities(project_name,client,owner_id,quotation_value,stage,sales_stage,extra_data)
    VALUES('LR Tower 1','LR Different Client',owner_,250000,'qualification','rfq_received',jsonb_build_object(
      'source','PHC Quotation List 2022-2026','sales_code','LR26001')) RETURNING id INTO old_id;
  INSERT INTO lr_ids VALUES('other_client',old_id);
  INSERT INTO public.opportunity_flags(linked_record_type,linked_record_id,flag_kind,condition_key,status)
    VALUES('opportunity',(SELECT id FROM lr_ids WHERE k='legacy1'),'action_required','missing_next_action','open');
  PERFORM public.remap_historical_sales(bat);
END $$;
GRANT SELECT,INSERT ON lr_ids TO rls_tester;
SET ROLE rls_tester;
DO $$ DECLARE sm uuid; owner_ uuid; co uuid; row1 uuid; req uuid; opp uuid; old_id uuid; raw_before jsonb; result jsonb; expected jsonb; n int; denied boolean; BEGIN
  SELECT id INTO sm FROM lr_ids WHERE k='sm'; SELECT id INTO owner_ FROM lr_ids WHERE k='owner';
  SELECT id INTO co FROM lr_ids WHERE k='company'; SELECT id INTO row1 FROM lr_ids WHERE k='row1';
  SELECT id INTO old_id FROM lr_ids WHERE k='legacy1';
  PERFORM set_config('test.uid',sm::text,true);
  SELECT raw INTO raw_before FROM public.historical_sales_rows WHERE id=row1;
  INSERT INTO public.historical_promotion_requests(row_id,company_id,owner_user_id,project_name,status_canonical,amount_excl_vat)
    VALUES(row1,co,owner_,'LR Tower 1','submitted',250000) RETURNING id INTO req;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req;
  UPDATE public.historical_promotion_requests SET status='approved' WHERE id=req;
  opp:=public.promote_historical_row(req);
  INSERT INTO lr_ids VALUES('canonical1',opp),('request1',req);
  IF (SELECT stage FROM public.opportunities WHERE id=old_id)<>'archived' THEN RAISE EXCEPTION 'future promotion did not archive exact duplicate'; END IF;
  RAISE NOTICE 'PASS 1. future promotion reconciles the exact legacy copy atomically';
  IF (SELECT count(*) FROM public.historical_legacy_reconciliations WHERE row_id=row1)<>2
    OR (SELECT stage FROM public.opportunities WHERE id=(SELECT id FROM lr_ids WHERE k='second_copy'))<>'archived' THEN
    RAISE EXCEPTION 'multiple exact copies were not reconciled atomically'; END IF;
  RAISE NOTICE 'PASS 19. both exact legacy copies are archived in one promotion transaction';
  IF (SELECT stage FROM public.opportunities WHERE id=(SELECT id FROM lr_ids WHERE k='other_client'))='archived' THEN RAISE EXCEPTION 'different contractor was merged'; END IF;
  RAISE NOTICE 'PASS 2. a different contractor is not merged on a shared code';
  IF (SELECT extra_data->'legacy_import_sources'->old_id::text->>'update_log' FROM public.opportunities WHERE id=opp)<>'Preserve this follow-up' THEN RAISE EXCEPTION 'legacy notes lost'; END IF;
  RAISE NOTICE 'PASS 3. canonical opportunity preserves the legacy follow-up notes';
  IF NOT EXISTS(SELECT 1 FROM public.historical_legacy_reconciliations WHERE legacy_id=old_id AND reconciled_by=sm AND before_legacy->>'stage'='qualification') THEN RAISE EXCEPTION 'receipt missing'; END IF;
  RAISE NOTICE 'PASS 4. full before-image and actual actor are retained';
  IF EXISTS(SELECT 1 FROM public.opportunity_flags WHERE linked_record_id=old_id AND status='open') THEN RAISE EXCEPTION 'duplicate still creates work'; END IF;
  RAISE NOTICE 'PASS 5. automatic duplicate flags are dismissed without deleting them';
  IF (SELECT raw FROM public.historical_sales_rows WHERE id=row1) IS DISTINCT FROM raw_before THEN RAISE EXCEPTION 'source mutated'; END IF;
  RAISE NOTICE 'PASS 6. original archive source is unchanged';
  IF (SELECT existing_opportunity_ids FROM public.historical_sales_search WHERE row_id=row1) IS DISTINCT FROM ARRAY[opp] THEN RAISE EXCEPTION 'live links duplicated'; END IF;
  RAISE NOTICE 'PASS 7. archive resolves to one live CRM opportunity after reconciliation';
  result:=public.reconcile_historical_legacy(row1,'{}');
  IF result->>'idempotent'<>'true' THEN RAISE EXCEPTION 'repeat not idempotent'; END IF;
  RAISE NOTICE 'PASS 8. repeating reconciliation does not archive or copy data again';
  denied:=false; BEGIN UPDATE public.historical_legacy_reconciliations SET before_legacy='{}' WHERE legacy_id=old_id; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'caller could rewrite receipt'; END IF;
  RAISE NOTICE 'PASS 9. authenticated callers cannot rewrite reconciliation receipts';
  PERFORM set_config('test.aal','aal1',true); denied:=false;
  BEGIN PERFORM public.historical_legacy_reconciliation_preview(); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'AAL1 accepted'; END IF;
  RAISE NOTICE 'PASS 10. MFA is enforced at the database entry point';
  PERFORM set_config('test.aal','aal2',true); PERFORM set_config('test.uid',(SELECT id::text FROM lr_ids WHERE k='viewer'),true); denied:=false;
  BEGIN PERFORM public.reconcile_historical_legacy(row1,'{}'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'viewer accepted'; END IF;
  RAISE NOTICE 'PASS 11. viewer cannot reconcile records';
END $$;
RESET ROLE;
SELECT set_config('test.uid','',true);
-- Independent recorded work must roll back the whole new promotion.
UPDATE public.opportunities SET next_action='Call the client' WHERE id=(SELECT id FROM lr_ids WHERE k='legacy2');
SET ROLE rls_tester;
DO $$ DECLARE sm uuid; req uuid; before_count int; blocked boolean:=false; BEGIN
  SELECT id INTO sm FROM lr_ids WHERE k='sm'; PERFORM set_config('test.uid',sm::text,true);
  INSERT INTO public.historical_promotion_requests(row_id,company_id,owner_user_id,project_name,status_canonical,amount_excl_vat)
    VALUES((SELECT id FROM lr_ids WHERE k='row2'),(SELECT id FROM lr_ids WHERE k='company'),(SELECT id FROM lr_ids WHERE k='owner'),'LR Tower 2','submitted',250000) RETURNING id INTO req;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req;
  UPDATE public.historical_promotion_requests SET status='approved' WHERE id=req;
  SELECT count(*) INTO before_count FROM public.opportunities;
  BEGIN PERFORM public.promote_historical_row(req); EXCEPTION WHEN check_violation THEN blocked:=true; END;
  IF NOT blocked OR (SELECT count(*) FROM public.opportunities)<>before_count THEN RAISE EXCEPTION 'unsafe promotion left a new duplicate'; END IF;
  RAISE NOTICE 'PASS 12. independent work blocks and rolls back the entire promotion';
  IF (SELECT stage FROM public.opportunities WHERE id=(SELECT id FROM lr_ids WHERE k='legacy2'))='archived' THEN RAISE EXCEPTION 'independent work archived'; END IF;
  RAISE NOTICE 'PASS 13. existing independent work remains active and unchanged';
  IF public.historical_identity_text('Tower_x000D_')<>public.historical_identity_text('Tower'||chr(13))
    OR public.historical_identity_text('Tower '||chr(150)||' Riyadh')<>public.historical_identity_text('Tower – Riyadh') THEN RAISE EXCEPTION 'encoding normalization failed'; END IF;
  RAISE NOTICE 'PASS 14. known Excel encoding artifacts normalize without fuzzy matching';
END $$;
RESET ROLE;
SELECT set_config('test.uid','',true);
INSERT INTO public.opportunities(project_name,client,owner_id,quotation_value,stage,sales_stage,extra_data)
 SELECT 'LR Tower 1','LR Client',id,250000,'qualification','rfq_received',jsonb_build_object(
 'source','PHC Quotation List 2022-2026','sales_code','LR26001','update_log','Late imported copy')
 FROM lr_ids WHERE k='owner';
INSERT INTO lr_ids SELECT 'late_legacy',id FROM public.opportunities WHERE extra_data->>'update_log'='Late imported copy';
SET ROLE rls_tester;
DO $$ DECLARE row1 uuid; old_id uuid; expected jsonb; result jsonb; blocked boolean:=false; BEGIN
  PERFORM set_config('test.uid',(SELECT id::text FROM lr_ids WHERE k='sm'),true);
  SELECT id INTO row1 FROM lr_ids WHERE k='row1'; SELECT id INTO old_id FROM lr_ids WHERE k='late_legacy';
  SELECT jsonb_object_agg(legacy_id::text,fingerprint) INTO expected FROM public.historical_legacy_reconciliation_preview() p WHERE p.row_id=row1;
  UPDATE public.opportunities SET extra_data=extra_data||'{"update_log":"Changed after preview"}'::jsonb WHERE id=old_id;
  BEGIN PERFORM public.reconcile_historical_legacy(row1,expected); EXCEPTION WHEN serialization_failure THEN blocked:=true; END;
  IF NOT blocked OR (SELECT stage FROM public.opportunities WHERE id=old_id)='archived' THEN RAISE EXCEPTION 'stale preview accepted'; END IF;
  RAISE NOTICE 'PASS 15. a changed before-image requires a fresh review without archiving';
  SELECT jsonb_object_agg(legacy_id::text,fingerprint) INTO expected FROM public.historical_legacy_reconciliation_preview() p WHERE p.row_id=row1;
  result:=public.reconcile_historical_legacy(row1,expected);
  IF jsonb_array_length(result->'archivedIds')<>1 THEN RAISE EXCEPTION 'reviewed historical cleanup failed'; END IF;
  RAISE NOTICE 'PASS 16. existing promotions can reconcile a reviewed legacy copy';
  IF (SELECT extra_data->'legacy_import_sources'->old_id::text->>'update_log' FROM public.opportunities WHERE id=(SELECT id FROM lr_ids WHERE k='canonical1'))<>'Changed after preview' THEN RAISE EXCEPTION 'latest notes lost'; END IF;
  RAISE NOTICE 'PASS 17. refreshed preview preserves the latest legacy notes';
END $$;
RESET ROLE;
SELECT set_config('test.uid','',true);
DO $$ DECLARE denied boolean:=false; BEGIN
  BEGIN PERFORM public.historical_legacy_reconciliation_preview(); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'identity-free caller accepted'; END IF;
  RAISE NOTICE 'PASS 18. an identity-free privileged session cannot impersonate leadership';
END $$;
RESET ROLE;
SELECT set_config('test.uid','',true);
CREATE TABLE public.lr_reference_fixture(id uuid primary key, opportunity_id uuid REFERENCES public.opportunities(id));
INSERT INTO public.lr_reference_fixture SELECT gen_random_uuid(),id FROM lr_ids WHERE k='legacy2';
DO $$ BEGIN
  IF NOT ('referenced_by_lr_reference_fixture'=ANY(public.historical_legacy_blockers((SELECT id FROM lr_ids WHERE k='legacy2')))) THEN
    RAISE EXCEPTION 'new business FK was ignored'; END IF;
  RAISE NOTICE 'PASS 20. new business references are detected without a hardcoded table list';
END $$;
ROLLBACK;
