BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email) VALUES
 ('a0000000-0000-4000-8000-000000000001','audit-pending@phc-sa.com'),
 ('a0000000-0000-4000-8000-000000000002','audit-manager@phc-sa.com'),
 ('a0000000-0000-4000-8000-000000000003','audit-bd@phc-sa.com');
UPDATE public.profiles SET status='active' WHERE id IN ('a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('a0000000-0000-4000-8000-000000000002','sales_manager'),('a0000000-0000-4000-8000-000000000003','bd_manager');
INSERT INTO public.opportunities(id,project_name,owner_id) VALUES
 ('a0000000-0000-4000-8000-000000000004','Audit opportunity','a0000000-0000-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$UPDATE public.profiles SET status='active' WHERE id=auth.uid()$$,'42501',NULL,'F01 pending user cannot self activate');
SELECT is((SELECT count(*)::int FROM public.profiles WHERE id=auth.uid()),1,'Inactive user can read own status');
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
SELECT is((SELECT count(*)::int FROM public.opportunities),0,'F03 AAL1 manager cannot read business data');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id=auth.uid()),1,'AAL1 manager can read roles for MFA enrollment');
SELECT ok(NOT public.is_platform_admin(auth.uid()),'F03 AAL1 has no admin authority');
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT ok(public.is_platform_admin(auth.uid()),'AAL2 active manager retains authority');
SELECT ok(EXISTS(SELECT 1 FROM public.opportunities WHERE id='a0000000-0000-4000-8000-000000000004'),'AAL2 manager reads business data');
RESET ROLE;
UPDATE public.profiles SET status='suspended' WHERE id='a0000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.has_role(auth.uid(),'sales_manager'),'F02 suspended role confers no authority');
SELECT throws_ok($$INSERT INTO public.user_roles(user_id,role) VALUES(auth.uid(),'system_admin')$$,'42501',NULL,'F02 suspended manager cannot escalate');
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
SELECT throws_ok($$INSERT INTO public.approvals(approval_type,requested_by,status) VALUES('delete_record',auth.uid(),'approved')$$,'P0001',NULL,'F05 BD cannot insert preapproved request');
SELECT lives_ok($$INSERT INTO public.approvals(approval_type,requested_by,status) VALUES('delete_record',auth.uid(),'pending')$$,'BD may submit pending request');
SELECT throws_ok($$INSERT INTO public.bafo_requests(opportunity_id,requested_by,justification,status,commercial_review_status,cost_approval_status,finance_review_status,final_approval_status)
 VALUES('a0000000-0000-4000-8000-000000000004',auth.uid(),'audit','approved','approved','approved','approved','approved')$$,'P0001',NULL,'F04 BAFO cannot start approved');
INSERT INTO public.bafo_requests(id,opportunity_id,requested_by,justification,proposed_value) VALUES
 ('a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000004',auth.uid(),'audit',1000);
SELECT lives_ok($$UPDATE public.bafo_requests SET commercial_review_status='approved' WHERE id='a0000000-0000-4000-8000-000000000005'$$,'BAFO authorized first decision works');
SELECT throws_ok($$UPDATE public.bafo_requests SET proposed_value=1 WHERE id='a0000000-0000-4000-8000-000000000005'$$,'P0001',NULL,'F04 reviewed BAFO value cannot change');
SELECT throws_ok($$UPDATE public.bafo_requests SET commercial_review_by=auth.uid(),commercial_review_at=now()+interval '1 day' WHERE id='a0000000-0000-4000-8000-000000000005'$$,'P0001',NULL,'BAFO decision receipt cannot be forged');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET status='active' WHERE id='a0000000-0000-4000-8000-000000000002';
INSERT INTO public.leads(id,project_name,lead_stage,created_by) VALUES('a0000000-0000-4000-8000-000000000006','Audit conversion','scored','a0000000-0000-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.convert_lead_atomic('a0000000-0000-4000-8000-000000000006')$$,'23514',NULL,'Unreviewed conversion fails atomically');
SELECT is((SELECT count(*)::int FROM public.opportunities WHERE project_name='Audit conversion'),0,'Failed conversion leaves no orphan opportunity');
UPDATE public.leads SET reviewed_by=auth.uid(),reviewed_at=now() WHERE id='a0000000-0000-4000-8000-000000000006';
SELECT lives_ok($$SELECT public.convert_lead_atomic('a0000000-0000-4000-8000-000000000006')$$,'F08 lead conversion succeeds');
SELECT lives_ok($$SELECT public.convert_lead_atomic('a0000000-0000-4000-8000-000000000006')$$,'F08 retry returns existing opportunity');
SELECT is((SELECT count(*)::int FROM public.opportunities WHERE project_name='Audit conversion'),1,'F08 exactly one opportunity after retry');
SELECT ok(NOT has_function_privilege('authenticated','public.commit_import_batch_atomic(uuid,uuid,jsonb)','EXECUTE'),'Import commit RPC is service-only');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.import_batches(id,created_by,status,readiness_checklist) VALUES
 ('a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000002','dry_run',
 '{"file_source_confirmed":true,"owner_confirmed":true,"backup_completed":true,"no_unnecessary_sensitive_data":true}');
INSERT INTO public.import_files(id,batch_id,file_name,file_type,file_size_bytes,storage_path) VALUES
 ('a0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000007','audit.csv','csv',100,'audit.csv');
INSERT INTO public.import_rows(id,batch_id,file_id,row_number,raw_data) VALUES
 ('a0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000008',1,'{}');
INSERT INTO public.import_record_candidates(id,batch_id,source_row_id,entity_type,review_status,proposed_payload) VALUES
 ('a0000000-0000-4000-8000-000000000010','a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000009','companies','approved','{"name":"Audit atomic company"}');
CREATE TEMP TABLE audit_items AS SELECT jsonb_agg(jsonb_build_object('id',id,'entity_type',entity_type,'action',proposed_action,
 'existing_record_id',existing_record_id,'source_payload',proposed_payload,'payload',proposed_payload)) AS items FROM public.import_record_candidates WHERE batch_id='a0000000-0000-4000-8000-000000000007';
SELECT throws_ok($$SELECT public.commit_import_batch_atomic('a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000002','[]')$$,'P0001',NULL,'F10 truncated candidate set rejected');
-- Inject a provenance failure: the preceding CRM INSERT must roll back too.
CREATE FUNCTION pg_temp.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected receipt failure'; END $$;
CREATE TRIGGER audit_test_failure BEFORE INSERT ON public.import_record_links FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_receipt();
SELECT is(public.commit_import_batch_atomic('a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000002',(SELECT items FROM audit_items))->>'failed','1','F09 provenance failure is reported');
SELECT is((SELECT count(*)::int FROM public.companies WHERE name='Audit atomic company'),0,'F09 failed receipt leaves no orphan CRM row');
DROP TRIGGER audit_test_failure ON public.import_record_links;
-- Separate test attempt, as a reviewer explicitly stages another commit.
UPDATE public.import_batches SET status='dry_run',commit_summary=NULL WHERE id='a0000000-0000-4000-8000-000000000007';
SELECT is(public.commit_import_batch_atomic('a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000002',(SELECT items FROM audit_items))->>'committed','1','F09 target and receipt commit together');
SELECT is(public.commit_import_batch_atomic('a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000002',(SELECT items FROM audit_items))->>'committed','1','F09 retry returns durable summary');
SELECT is((SELECT count(*)::int FROM public.companies WHERE name='Audit atomic company'),1,'F09 exactly one CRM row after retry');
SELECT is(public.rollback_import_batch_atomic('a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000002')->>'rolled_back','1','Rollback reverses created row');
SELECT is((SELECT count(*)::int FROM public.companies WHERE name='Audit atomic company'),0,'Rollback removes only the imported row');

SELECT throws_ok($$SELECT public.execute_approved_record_delete('a0000000-0000-4000-8000-000000000099','a0000000-0000-4000-8000-000000000003')$$,'P0002','Approval not found','F13 BD passes executor role gate but still needs an approval');
SELECT ok(NOT has_column_privilege('authenticated','public.approvals','execution_status','UPDATE'),'Clients cannot forge approval execution receipts');
INSERT INTO public.companies(id,name) VALUES('a0000000-0000-4000-8000-000000000101','Before import');
INSERT INTO public.import_batches(id,created_by,status,readiness_checklist)
 SELECT 'a0000000-0000-4000-8000-000000000102',created_by,'dry_run',readiness_checklist FROM public.import_batches WHERE id='a0000000-0000-4000-8000-000000000007';
INSERT INTO public.import_files(id,batch_id,file_name,file_type,file_size_bytes,storage_path) VALUES
 ('a0000000-0000-4000-8000-000000000103','a0000000-0000-4000-8000-000000000102','update.csv','csv',100,'update.csv');
INSERT INTO public.import_rows(id,batch_id,file_id,row_number,raw_data) VALUES
 ('a0000000-0000-4000-8000-000000000104','a0000000-0000-4000-8000-000000000102','a0000000-0000-4000-8000-000000000103',1,'{}');
INSERT INTO public.import_record_candidates(id,batch_id,source_row_id,entity_type,review_status,proposed_action,existing_record_id,existing_table,proposed_payload) VALUES
 ('a0000000-0000-4000-8000-000000000105','a0000000-0000-4000-8000-000000000102','a0000000-0000-4000-8000-000000000104','companies','approved','update','a0000000-0000-4000-8000-000000000101','companies','{"name":"After import"}');
CREATE TEMP TABLE audit_update_items AS SELECT jsonb_agg(jsonb_build_object('id',id,'entity_type',entity_type,'action',proposed_action,
 'existing_record_id',existing_record_id,'source_payload',proposed_payload,'payload',proposed_payload)) AS items FROM public.import_record_candidates WHERE batch_id='a0000000-0000-4000-8000-000000000102';
CREATE TRIGGER audit_test_final_failure BEFORE UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_receipt();
SELECT throws_ok($$SELECT public.commit_import_batch_atomic('a0000000-0000-4000-8000-000000000102','a0000000-0000-4000-8000-000000000002',(SELECT items FROM audit_update_items))$$,'P0001','Injected receipt failure','F09 finalization failure aborts entire transaction');
SELECT is((SELECT name FROM public.companies WHERE id='a0000000-0000-4000-8000-000000000101'),'Before import','Failed finalization leaves target unchanged');
SELECT is((SELECT count(*)::int FROM public.import_record_links WHERE batch_id='a0000000-0000-4000-8000-000000000102'),0,'Failed finalization leaves no receipt');
DROP TRIGGER audit_test_final_failure ON public.import_batches;
SELECT is(public.commit_import_batch_atomic('a0000000-0000-4000-8000-000000000102','a0000000-0000-4000-8000-000000000002',(SELECT items FROM audit_update_items))->>'committed','1','Reviewed update commits');
UPDATE public.companies SET name='Later user edit' WHERE id='a0000000-0000-4000-8000-000000000101';
SELECT is(public.rollback_import_batch_atomic('a0000000-0000-4000-8000-000000000102','a0000000-0000-4000-8000-000000000002')->>'manual_review_required','1','Rollback detects post-import change');
SELECT is((SELECT name FROM public.companies WHERE id='a0000000-0000-4000-8000-000000000101'),'Later user edit','Rollback preserves later work');
SELECT is((SELECT status FROM public.import_batches WHERE id='a0000000-0000-4000-8000-000000000102'),'committed','Partial rollback remains retryable');
-- Restore the exact post-import state for this isolated transaction's next case.
UPDATE public.companies SET name='After import' WHERE id='a0000000-0000-4000-8000-000000000101';
SELECT is(public.rollback_import_batch_atomic('a0000000-0000-4000-8000-000000000102','a0000000-0000-4000-8000-000000000002')->>'rolled_back','1','Rollback restores an unchanged imported update');
SELECT is((SELECT name FROM public.companies WHERE id='a0000000-0000-4000-8000-000000000101'),'Before import','Before-image restored');

SELECT * FROM finish();
ROLLBACK;
