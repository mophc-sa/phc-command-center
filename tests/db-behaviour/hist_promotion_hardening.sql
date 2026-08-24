-- =============================================================================
-- Historical promotion hardening.
--
-- Phase 7D proved the QUEUE was safe: mappings mandatory, leadership only, one
-- at a time, archive untouched. None of that says the resulting record is
-- usable, and the four things this suite covers are exactly the ways it was
-- not:
--
--   * it landed with sales_stage NULL and vanished from every dashboard
--   * it carried no value, so the pipeline read zero
--   * nothing could undo it
--   * the archive could not say which of its rows had become live deals
--
-- Plus the gate that stops a historical quotation being mistaken for one that
-- went through Phase 7C governance, which it emphatically did not.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE sm UUID; s1 UUID; s2 UUID; vw UUID; adm UUID; co UUID; co2 UUID; bat UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('hh_sm@phc-sa.com'),('hh_s1@phc-sa.com'),('hh_s2@phc-sa.com'),('hh_vw@phc-sa.com'),('hh_adm@phc-sa.com');
  SELECT id INTO sm FROM auth.users WHERE email='hh_sm@phc-sa.com';
  SELECT id INTO s1 FROM auth.users WHERE email='hh_s1@phc-sa.com';
  SELECT id INTO s2 FROM auth.users WHERE email='hh_s2@phc-sa.com';
  SELECT id INTO vw FROM auth.users WHERE email='hh_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='hh_adm@phc-sa.com';
  UPDATE public.profiles SET status='active'  WHERE id IN (sm,s1,vw,adm);
  -- s2 is deliberately left inactive: an inactive owner must be refused just
  -- as hard as no owner, or the deal is promoted to somebody who cannot see it.
  UPDATE public.profiles SET status='suspended' WHERE id = s2;
  INSERT INTO public.user_roles (user_id, role) VALUES
    (sm,'sales_manager'),(s1,'salesperson'),(s2,'salesperson'),(vw,'viewer'),(adm,'system_admin');

  INSERT INTO public.companies (name) VALUES ('HH Contracting') RETURNING id INTO co;
  INSERT INTO public.companies (name) VALUES ('HH Rival Contracting') RETURNING id INTO co2;

  -- A legacy prefix that maps to a real account, which is the whole point of
  -- the owner map: no user is ever invented to satisfy the foreign key.
  INSERT INTO public.historical_sales_owner_map (prefix, user_id, legacy_label)
    VALUES ('ZZ', s1, 'ZZ — HH test owner')
    ON CONFLICT (prefix) DO UPDATE SET user_id = EXCLUDED.user_id;

  INSERT INTO public.historical_sales_batches (source_file, source_sha256, loaded_by)
    VALUES ('hh.csv', repeat('h',64), sm) RETURNING id INTO bat;

  -- Raw rows use the real spreadsheet column names, embedded newline and typo
  -- included, so the parsing path under test is the production one.
  INSERT INTO public.historical_sales_rows (batch_id, row_number, raw) VALUES
    -- 1: clean, promotable
    (bat, 1, jsonb_build_object('SALES CODE','ZZ26001','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Tower Signage','AMOUNT','250000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','2/15/2026','JIH / TENDER','JIH','FOLLOW-UP','ACTIVE')),
    -- 2: placeholder code — a bare owner prefix, not a quotation number
    (bat, 2, jsonb_build_object('SALES CODE','ZZ','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Placeholder','AMOUNT','100000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','3/01/2026','JIH / TENDER','JIH')),
    -- 3 and 4: one base code, two rows — the collision that needs a human
    (bat, 3, jsonb_build_object('SALES CODE','ZZ26003','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Twin A','AMOUNT','300000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','3/10/2026','JIH / TENDER','TENDER')),
    (bat, 4, jsonb_build_object('SALES CODE','ZZ26003','CLIENT COMPANY','HH Rival Contracting',
        'PROJECT NAME','HH Twin A','AMOUNT','300000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','3/10/2026','JIH / TENDER','TENDER')),
    -- 5: WON — closed, and not promotable by this batch
    (bat, 5, jsonb_build_object('SALES CODE','ZZ26005','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Closed','AMOUNT','400000','QUOTATION '||chr(10)||'STATUS','WON',
        'SUBMISSION DATE','1/10/2026','JIH / TENDER','JIH')),
    -- 6: submitted status but no submission date — no evidence a quote exists
    (bat, 6, jsonb_build_object('SALES CODE','ZZ26006','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Undated','AMOUNT','500000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'JIH / TENDER','JIH')),
    -- 7: tender-origin, for flow_type
    (bat, 7, jsonb_build_object('SALES CODE','ZZ26007','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Tender Job','AMOUNT','600000','QUOTATION '||chr(10)||'STATUS','WAITING FOR CLIENT',
        'SUBMISSION DATE','4/02/2026','JIH / TENDER','TENDER','FOLLOW-UP','DEAD')),
    -- 8 and 9: the same row entered twice — identical in every field
    (bat, 8, jsonb_build_object('SALES CODE','ZZ26008','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Repeated','AMOUNT','700000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','5/01/2026','JIH / TENDER','JIH')),
    (bat, 9, jsonb_build_object('SALES CODE','ZZ26008','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Repeated','AMOUNT','700000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','5/01/2026','JIH / TENDER','JIH')),
    -- 10 and 11: same client, same project, different amount, no revision
    -- marker to explain the difference. Genuinely undecidable.
    (bat, 10, jsonb_build_object('SALES CODE','ZZ26010','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Ambiguous','AMOUNT','800000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','5/02/2026','JIH / TENDER','JIH')),
    (bat, 11, jsonb_build_object('SALES CODE','ZZ26010','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Ambiguous','AMOUNT','850000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','5/03/2026','JIH / TENDER','JIH')),
    -- 12 and 13: a genuine revision, proven by the code itself
    (bat, 12, jsonb_build_object('SALES CODE','ZZ26012','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Revised','AMOUNT','900000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','5/04/2026','JIH / TENDER','JIH')),
    (bat, 13, jsonb_build_object('SALES CODE','ZZ26012-RV.02','CLIENT COMPANY','HH Contracting',
        'PROJECT NAME','HH Revised','AMOUNT','910000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','5/05/2026','JIH / TENDER','JIH'));

  PERFORM public.remap_historical_sales(bat);
END $$;

CREATE TEMP TABLE hh AS SELECT
  (SELECT id FROM public.companies WHERE name='HH Contracting') AS co,
  (SELECT id FROM public.historical_sales_batches WHERE source_file='hh.csv') AS bat,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=1) AS row1,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=2) AS row2,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=3) AS row3,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=5) AS row5,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=6) AS row6,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=7) AS row7,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=4) AS row4,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=8) AS row8,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=9) AS row9,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=11) AS row11,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='hh.csv' AND r.row_number=13) AS row13;
GRANT SELECT ON hh TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  sm UUID; s1 UUID; s2 UUID; vw UUID; adm UUID; co UUID; bat UUID;
  row1 UUID; row2 UUID; row3 UUID; row4 UUID; row5 UUID; row6 UUID; row7 UUID;
  row8 UUID; row9 UUID; row11 UUID; row13 UUID;
  req UUID; req2 UUID; req3 UUID; opp UUID; opp2 UUID; quo UUID;
  n INT; v NUMERIC; t TEXT; b BOOLEAN; raw_before JSONB;
  base_opps INT; base_val NUMERIC;
BEGIN
  SELECT h.co,h.bat,h.row1,h.row2,h.row3,h.row4,h.row5,h.row6,h.row7,h.row8,h.row9,h.row11,h.row13
    INTO co,bat,row1,row2,row3,row4,row5,row6,row7,row8,row9,row11,row13 FROM hh h;
  SELECT id INTO sm FROM auth.users WHERE email='hh_sm@phc-sa.com';
  SELECT id INTO s1 FROM auth.users WHERE email='hh_s1@phc-sa.com';
  SELECT id INTO s2 FROM auth.users WHERE email='hh_s2@phc-sa.com';
  SELECT id INTO vw FROM auth.users WHERE email='hh_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='hh_adm@phc-sa.com';

  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO base_opps FROM public.opportunities;

  -- ===== the owner map resolves through the existing architecture =====
  SELECT user_id INTO t FROM public.historical_sales_owner_map WHERE prefix='ZZ';
  IF t = s1::text THEN RAISE NOTICE 'PASS 1. a mapped legacy prefix resolves to a real account';
  ELSE RAISE NOTICE 'FAIL 1. owner map did not resolve (got %)', t; END IF;

  SELECT owner_user_id INTO t FROM public.historical_sales_mapped WHERE row_id=row1;
  IF t = s1::text THEN RAISE NOTICE 'PASS 2. the remap carries the mapped owner onto the archive row';
  ELSE RAISE NOTICE 'FAIL 2. remap did not carry the owner'; END IF;

  -- ===== FOLLOW-UP is projected, raw, and drives nothing =====
  SELECT follow_up_raw INTO t FROM public.historical_sales_mapped WHERE row_id=row1;
  IF t = 'ACTIVE' THEN RAISE NOTICE 'PASS 3. the FOLLOW-UP cell is projected verbatim';
  ELSE RAISE NOTICE 'FAIL 3. FOLLOW-UP not projected (got %)', coalesce(t,'NULL'); END IF;

  SELECT status_raw INTO t FROM public.historical_sales_mapped WHERE row_id=row7;
  IF t = 'WAITING FOR CLIENT' THEN
    RAISE NOTICE 'PASS 4. a DEAD follow-up does not overwrite the quotation status';
  ELSE RAISE NOTICE 'FAIL 4. FOLLOW-UP changed the status to %', t; END IF;

  SELECT count(*) INTO n FROM public.historical_sales_followup_conflicts WHERE row_id=row7;
  IF n = 1 THEN RAISE NOTICE 'PASS 5. an open record marked DEAD is surfaced as review evidence';
  ELSE RAISE NOTICE 'FAIL 5. conflict view missed the contradiction (n=%)', n; END IF;

  -- ===== a clean promotion =====
  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row1, co, s1, 'HH Tower Signage', 'submitted', 250000.00) RETURNING id INTO req;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req;

  raw_before := (SELECT raw FROM public.historical_sales_rows WHERE id=row1);
  SELECT public.promote_historical_row(req) INTO opp;

  -- ===== 1. never a NULL stage =====
  SELECT sales_stage::text INTO t FROM public.opportunities WHERE id=opp;
  IF t = 'jih' THEN RAISE NOTICE 'PASS 6. a promoted deal lands at its mapped stage, never NULL';
  ELSE RAISE NOTICE 'FAIL 6. promoted sales_stage is % (NULL would be invisible to every dashboard)', coalesce(t,'NULL'); END IF;

  SELECT commercial_handoff_status INTO t FROM public.opportunities WHERE id=opp;
  IF t = 'submitted' THEN RAISE NOTICE 'PASS 7. SUBMITTED becomes handoff=submitted, not a new sales stage';
  ELSE RAISE NOTICE 'FAIL 7. handoff status is %', coalesce(t,'NULL'); END IF;

  -- ===== 2. D6: created at rfq_received, then transitioned =====
  SELECT count(*) INTO n FROM public.stage_transition_history
   WHERE record_type='opportunity' AND record_id=opp AND from_stage IS NULL AND to_stage='rfq_received';
  IF n = 1 THEN RAISE NOTICE 'PASS 8. D6 holds — the deal is created at rfq_received';
  ELSE RAISE NOTICE 'FAIL 8. no rfq_received creation row (n=%)', n; END IF;

  SELECT count(*) INTO n FROM public.stage_transition_history
   WHERE record_type='opportunity' AND record_id=opp AND from_stage='rfq_received' AND to_stage='jih';
  IF n = 1 THEN RAISE NOTICE 'PASS 9. the move to jih is an explicit, audited transition';
  ELSE RAISE NOTICE 'FAIL 9. no rfq_received -> jih transition row (n=%)', n; END IF;

  SELECT count(*) INTO n FROM public.audit_log
   WHERE entity_id=opp AND action IN ('historical_promotion.created','sales_stage.changed');
  IF n >= 2 THEN RAISE NOTICE 'PASS 10. both hops are in the audit log';
  ELSE RAISE NOTICE 'FAIL 10. audit log has % entries for the promotion', n; END IF;

  -- ===== 3. value lands where the resolver reads it =====
  SELECT quotation_value INTO v FROM public.opportunities WHERE id=opp;
  IF v = 250000.00 THEN RAISE NOTICE 'PASS 11. the archive amount lands in quotation_value';
  ELSE RAISE NOTICE 'FAIL 11. quotation_value is %', coalesce(v::text,'NULL'); END IF;

  SELECT estimated_value_max INTO v FROM public.opportunities WHERE id=opp;
  IF v IS NULL THEN RAISE NOTICE 'PASS 12. the figure is NOT duplicated into estimated_value_max';
  ELSE RAISE NOTICE 'FAIL 12. the value was copied into a second column (%)', v; END IF;

  SELECT public.opportunity_value(contract_value, quotation_value, estimated_value_max)
    INTO v FROM public.opportunities WHERE id=opp;
  IF v = 250000.00 THEN RAISE NOTICE 'PASS 13. the shared resolver returns the quoted figure';
  ELSE RAISE NOTICE 'FAIL 13. resolver returned %', coalesce(v::text,'NULL'); END IF;

  -- ===== 4. tender origin is recorded, no tender entity is invented =====
  SELECT count(*) INTO n FROM public.tenders;
  IF n = 0 THEN RAISE NOTICE 'PASS 14. promotion creates no tender rows';
  ELSE RAISE NOTICE 'FAIL 14. % tender rows were created', n; END IF;

  -- ===== 5. provenance =====
  SELECT extra_data->>'historical_row_id' INTO t FROM public.opportunities WHERE id=opp;
  IF t = row1::text THEN RAISE NOTICE 'PASS 15. the opportunity carries its archive row id';
  ELSE RAISE NOTICE 'FAIL 15. provenance row id is %', coalesce(t,'NULL'); END IF;

  SELECT extra_data->>'source_sales_code' INTO t FROM public.opportunities WHERE id=opp;
  IF t = 'ZZ26001' THEN RAISE NOTICE 'PASS 16. provenance carries the source sales code';
  ELSE RAISE NOTICE 'FAIL 16. source sales code is %', coalesce(t,'NULL'); END IF;

  SELECT extra_data->>'source_route' INTO t FROM public.opportunities WHERE id=opp;
  IF t = 'JIH' THEN RAISE NOTICE 'PASS 17. provenance carries the source route';
  ELSE RAISE NOTICE 'FAIL 17. source route is %', coalesce(t,'NULL'); END IF;

  -- ===== 6. the historical quotation =====
  SELECT promoted_quotation_id INTO quo FROM public.historical_promotion_requests WHERE id=req;
  IF quo IS NOT NULL THEN RAISE NOTICE 'PASS 18. a historical quotation is created and linked';
  ELSE RAISE NOTICE 'FAIL 18. no quotation was created'; END IF;

  SELECT is_historical INTO b FROM public.quotations WHERE id=quo;
  IF b THEN RAISE NOTICE 'PASS 19. it is flagged historical';
  ELSE RAISE NOTICE 'FAIL 19. the quotation is not flagged historical'; END IF;

  SELECT count(*) INTO n FROM public.quotation_revisions WHERE quotation_id=quo;
  IF n = 0 THEN RAISE NOTICE 'PASS 20. no Phase 7C revision is fabricated for it';
  ELSE RAISE NOTICE 'FAIL 20. % revisions were invented', n; END IF;

  BEGIN
    UPDATE public.quotations SET value = 999999 WHERE id=quo;
    RAISE NOTICE 'FAIL 21. a historical quotation was edited';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 21. a historical quotation records what was sent and cannot be edited';
  END;

  BEGIN
    UPDATE public.quotations SET is_historical = FALSE, historical_row_id = NULL WHERE id=quo;
    RAISE NOTICE 'FAIL 22. a historical quotation shed its flag and could pass as a modern one';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 22. the historical origin of a quotation cannot be changed';
  END;

  -- The reverse direction matters just as much: a modern draft must not be
  -- able to acquire archive provenance it never had.
  BEGIN
    UPDATE public.quotations SET is_historical = TRUE, historical_row_id = row5
     WHERE id <> quo AND is_historical = FALSE;
    IF FOUND THEN RAISE NOTICE 'FAIL 23. a modern quotation acquired historical provenance';
    ELSE RAISE NOTICE 'PASS 23. no modern quotation exists to mislabel (vacuous but honest)'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 23. a modern quotation cannot acquire historical provenance';
  END;

  -- ===== 7. the archive is untouched =====
  IF (SELECT raw FROM public.historical_sales_rows WHERE id=row1) = raw_before THEN
    RAISE NOTICE 'PASS 24. promotion writes nothing to the archive row';
  ELSE RAISE NOTICE 'FAIL 24. the archive row changed'; END IF;

  BEGIN
    UPDATE public.historical_sales_rows SET row_number = 99 WHERE id=row1;
    RAISE NOTICE 'FAIL 25. an archive row was updated';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 25. the archive is still immutable after promotion';
  END;

  -- ===== 8. the promoted indicator =====
  SELECT promotion_status INTO t FROM public.historical_sales_promotion_status WHERE row_id=row1;
  IF t = 'promoted' THEN RAISE NOTICE 'PASS 26. the archive reports the row as promoted';
  ELSE RAISE NOTICE 'FAIL 26. promotion_status is %', coalesce(t,'NULL'); END IF;

  SELECT promoted_opportunity_id INTO t FROM public.historical_sales_promotion_status WHERE row_id=row1;
  IF t = opp::text THEN RAISE NOTICE 'PASS 27. it names the opportunity it became';
  ELSE RAISE NOTICE 'FAIL 27. opportunity reference is %', coalesce(t,'NULL'); END IF;

  SELECT promotion_status INTO t FROM public.historical_sales_promotion_status WHERE row_id=row5;
  IF t = 'not_promoted' THEN RAISE NOTICE 'PASS 28. an unpromoted row says so rather than reading blank';
  ELSE RAISE NOTICE 'FAIL 28. unpromoted row reports %', coalesce(t,'NULL'); END IF;

  SELECT promotion_status INTO t FROM public.historical_sales_search WHERE row_id=row1;
  IF t = 'promoted' THEN RAISE NOTICE 'PASS 29. the search view carries the same answer';
  ELSE RAISE NOTICE 'FAIL 29. search view promotion_status is %', coalesce(t,'NULL'); END IF;

  -- ===== 9. idempotency and no second promotion =====
  IF public.promote_historical_row(req) = opp THEN
    RAISE NOTICE 'PASS 30. a retried promotion returns the same opportunity';
  ELSE RAISE NOTICE 'FAIL 30. a retry created a different opportunity'; END IF;

  SELECT count(*) INTO n FROM public.opportunities WHERE extra_data->>'historical_row_id' = row1::text;
  IF n = 1 THEN RAISE NOTICE 'PASS 31. exactly one opportunity exists for the archive row';
  ELSE RAISE NOTICE 'FAIL 31. % opportunities exist for one archive row', n; END IF;

  BEGIN
    INSERT INTO public.historical_promotion_requests (row_id) VALUES (row1);
    RAISE NOTICE 'FAIL 32. a second open request was opened against a promoted row';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS 32. a promoted archive row cannot get a second open request';
  END;

  -- ===== 10. the refusals =====
  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row2, co, s1, 'HH Placeholder', 'submitted', 100000.00) RETURNING id INTO req2;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  BEGIN
    PERFORM public.promote_historical_row(req2);
    RAISE NOTICE 'FAIL 33. a placeholder sales code was promoted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 33. a bare owner prefix is refused as a quotation number';
  END;

  -- ===== collisions are classified from evidence, not referred by default =====
  -- Rows 3 and 4 share base code ZZ26003 on one project but went to two
  -- different contractors. That is decidable, so it must NOT cost a decision.
  IF public.historical_collision_class(row3) = 'DISTINCT_BUSINESS_PURSUIT' THEN
    RAISE NOTICE 'PASS 34. a shared code with a different contractor is classified as a distinct pursuit';
  ELSE RAISE NOTICE 'FAIL 34. row3 classified as %', public.historical_collision_class(row3); END IF;

  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row3, co, s1, 'HH Twin A', 'submitted', 300000.00) RETURNING id INTO req3;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req3;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req3;
  PERFORM public.promote_historical_row(req3);
  RAISE NOTICE 'PASS 35. it promotes with no human review at all';

  -- ===== quotation identity: not a revision chain =====
  -- Rows 3 and 4 carry the SAME raw code. Rendering them as versions 1 and 2
  -- of ZZ26003 would state that we revised our price, when we quoted two
  -- different contractors. They get distinct numbers and both stay at v1.
  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row4, co, s1, 'HH Twin A', 'submitted', 300000.00) RETURNING id INTO req2;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  PERFORM public.promote_historical_row(req2);

  SELECT count(*) INTO n FROM public.quotations
   WHERE legacy_sales_code = 'ZZ26003' AND version = 1;
  IF n = 2 THEN RAISE NOTICE 'PASS 35a. both contractor pursuits are version 1 — no false revision chain';
  ELSE RAISE NOTICE 'FAIL 35a. % of the two are at version 1', n; END IF;

  SELECT count(DISTINCT quote_number) INTO n FROM public.quotations WHERE legacy_sales_code = 'ZZ26003';
  IF n = 2 THEN RAISE NOTICE 'PASS 35b. each pursuit has its own canonical quote number';
  ELSE RAISE NOTICE 'FAIL 35b. % distinct quote numbers for two pursuits', n; END IF;

  SELECT count(*) INTO n FROM public.quotations
   WHERE legacy_sales_code = 'ZZ26003' AND quote_number IN ('ZZ26003/3','ZZ26003/4');
  IF n = 2 THEN RAISE NOTICE 'PASS 35c. the number is derived from the archive row, so promotion order cannot change it';
  ELSE RAISE NOTICE 'FAIL 35c. quote numbers are not archive-derived'; END IF;

  SELECT count(*) INTO n FROM public.quotations WHERE legacy_sales_code = 'ZZ26003';
  IF n = 2 THEN RAISE NOTICE 'PASS 35d. the untouched legacy code is retained on both';
  ELSE RAISE NOTICE 'FAIL 35d. legacy_sales_code retained on % rows', n; END IF;

  -- A code the archive uses once keeps its own name.
  SELECT quote_number INTO t FROM public.quotations WHERE historical_row_id = row1;
  IF t = 'ZZ26001' THEN RAISE NOTICE 'PASS 35e. an unshared code is used as the quote number unchanged';
  ELSE RAISE NOTICE 'FAIL 35e. unshared code became %', coalesce(t,'NULL'); END IF;

  -- ===== the exact duplicate, rejected without being asked about =====
  IF public.historical_collision_class(row8) = 'EXACT_DUPLICATE_PRIMARY' THEN
    RAISE NOTICE 'PASS 35f. the first of a repeated row is the record';
  ELSE RAISE NOTICE 'FAIL 35f. row8 classified as %', public.historical_collision_class(row8); END IF;

  IF public.historical_collision_class(row9) = 'EXACT_DUPLICATE_REJECTED' THEN
    RAISE NOTICE 'PASS 35g. the repeat is identified as a repeat';
  ELSE RAISE NOTICE 'FAIL 35g. row9 classified as %', public.historical_collision_class(row9); END IF;

  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row9, co, s1, 'HH Repeated', 'submitted', 700000.00) RETURNING id INTO req2;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  BEGIN
    PERFORM public.promote_historical_row(req2);
    RAISE NOTICE 'FAIL 35h. an exact duplicate was promoted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 35h. an exact duplicate is refused automatically, not referred to a person';
  END;

  -- ...and the original still promotes.
  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row8, co, s1, 'HH Repeated', 'submitted', 700000.00) RETURNING id INTO req2;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  PERFORM public.promote_historical_row(req2);
  RAISE NOTICE 'PASS 35i. the original of the pair promotes normally';

  -- ===== the genuinely ambiguous one IS referred =====
  IF public.historical_collision_class(row11) = 'HUMAN_REVIEW_REQUIRED' THEN
    RAISE NOTICE 'PASS 35j. same client, same project, different amount, no revision marker — referred to a person';
  ELSE RAISE NOTICE 'FAIL 35j. row11 classified as %', public.historical_collision_class(row11); END IF;

  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row11, co, s1, 'HH Ambiguous', 'submitted', 850000.00) RETURNING id INTO req2;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  BEGIN
    PERFORM public.promote_historical_row(req2);
    RAISE NOTICE 'FAIL 35k. an ambiguous collision was promoted unreviewed';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 35k. an ambiguous collision still needs a human';
  END;
  UPDATE public.historical_promotion_requests SET duplicate_reviewed = TRUE WHERE id=req2;
  PERFORM public.promote_historical_row(req2);
  RAISE NOTICE 'PASS 35l. and promotes once a human has confirmed it';

  -- ===== a real revision is never inferred, only read from the code =====
  IF public.historical_collision_class(row13) = 'TRUE_REVISION' THEN
    RAISE NOTICE 'PASS 35m. a -RV.02 suffix is what makes something a revision';
  ELSE RAISE NOTICE 'FAIL 35m. row13 classified as %', public.historical_collision_class(row13); END IF;

  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row13, co, s1, 'HH Revised', 'submitted', 910000.00) RETURNING id INTO req2;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  BEGIN
    PERFORM public.promote_historical_row(req2);
    RAISE NOTICE 'FAIL 35n. a revision was imported as a standalone quotation without confirmation';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 35n. a true revision is not imported as a standalone quotation by default';
  END;

  -- WON is closed; this batch promotes active work only.
  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row5, co, s1, 'HH Closed', 'won', 400000.00) RETURNING id INTO req2;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  BEGIN
    PERFORM public.promote_historical_row(req2);
    RAISE NOTICE 'FAIL 36. a WON record entered the active pipeline';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 36. a closed record is refused by this activation batch';
  END;

  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row6, co, s1, 'HH Undated', 'submitted', 500000.00) RETURNING id INTO req2;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  BEGIN
    PERFORM public.promote_historical_row(req2);
    RAISE NOTICE 'FAIL 37. a record with no submission date produced a quotation';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 37. no submission date means no evidence of a quotation, and it is refused';
  END;

  -- An inactive owner is as bad as none: the deal would be invisible to them.
  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row7, co, s2, 'HH Tender Job', 'follow_up', 600000.00) RETURNING id INTO req2;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  BEGIN
    PERFORM public.promote_historical_row(req2);
    RAISE NOTICE 'FAIL 38. a deal was promoted to a suspended account';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 38. an inactive owner is refused — the deal would be invisible under RLS';
  END;

  UPDATE public.historical_promotion_requests SET owner_user_id = s1 WHERE id=req2;
  PERFORM public.promote_historical_row(req2);
  SELECT flow_type::text INTO t FROM public.opportunities
   WHERE id = (SELECT promoted_opportunity_id FROM public.historical_promotion_requests WHERE id=req2);
  IF t = 'tender_converted' THEN RAISE NOTICE 'PASS 39. a tender-origin record carries flow_type=tender_converted';
  ELSE RAISE NOTICE 'FAIL 39. flow_type is %', coalesce(t,'NULL'); END IF;

  SELECT commercial_handoff_status INTO t FROM public.opportunities
   WHERE id = (SELECT promoted_opportunity_id FROM public.historical_promotion_requests WHERE id=req2);
  IF t = 'waiting_client' THEN RAISE NOTICE 'PASS 40. WAITING FOR CLIENT becomes handoff=waiting_client at the same jih stage';
  ELSE RAISE NOTICE 'FAIL 40. handoff is %', coalesce(t,'NULL'); END IF;

  -- ===== 11. the dashboards see it, and the archive does not double-count =====
  -- Scoped to this suite's owner throughout. Every suite runs into one shared
  -- database and phase7d promotes an archive row of its own, so an unscoped
  -- count of source='historical_promotion' picks up its deal too — which is
  -- what happened first time round.
  SELECT count(*) INTO n FROM public.analytics_scope_opportunities
   WHERE extra_data->>'source' = 'historical_promotion' AND owner_id = s1;
  IF n = 6 THEN RAISE NOTICE 'PASS 41. all six promoted deals are in analytics scope';
  ELSE RAISE NOTICE 'FAIL 41. analytics scope holds % promoted deals, expected 6', n; END IF;

  -- The same arithmetic pipeline_by_stage does, restricted to this owner.
  SELECT coalesce(sum(public.opportunity_value(contract_value, quotation_value, estimated_value_max)),0)
    INTO v FROM public.analytics_scope_opportunities
   WHERE owner_id = s1 AND sales_stage NOT IN ('won','lost');
  IF v = 3000000.00 THEN RAISE NOTICE 'PASS 42. pipeline value is the sum of the quoted figures (250+300+300+700+850+600k)';
  ELSE RAISE NOTICE 'FAIL 42. pipeline value is %, expected 3000000', v; END IF;

  -- And the promoted deals really are in pipeline_by_stage, not merely in scope.
  SELECT coalesce(sum(deals),0) INTO n FROM public.pipeline_by_stage WHERE sales_stage = 'jih';
  IF n >= 6 THEN RAISE NOTICE 'PASS 42b. the promoted deals appear under the jih stage';
  ELSE RAISE NOTICE 'FAIL 42b. pipeline_by_stage shows % jih deals', n; END IF;

  SELECT count(*) INTO n FROM public.opportunities;
  IF n = base_opps + 6 THEN RAISE NOTICE 'PASS 43. exactly six opportunities were created — the archive itself adds none';
  ELSE RAISE NOTICE 'FAIL 43. opportunity count moved by %, expected 6', n - base_opps; END IF;

  SELECT count(*) INTO n FROM public.historical_sales_rows WHERE batch_id=bat;
  IF n = 13 THEN RAISE NOTICE 'PASS 44. all thirteen archive rows survive promotion untouched';
  ELSE RAISE NOTICE 'FAIL 44. archive row count is %', n; END IF;

  -- won + lost + open must reconcile against total. This is precisely what a
  -- NULL sales_stage broke: conversion_summary counted the row in total_deals
  -- while every stage FILTER missed it.
  -- Scoped to this suite's owner. The behavioural harness runs every suite
  -- into one database and other fixtures leave opportunities with a NULL
  -- sales_stage behind, so an unscoped check here measures their rows and not
  -- the promotion under test — it failed for that reason first time round.
  SELECT count(*) INTO n FROM public.conversion_summary
   WHERE owner_id = s1 AND total_deals <> won + lost + open_deals;
  IF n = 0 THEN RAISE NOTICE 'PASS 45. conversion_summary reconciles for the promoted owner: total = won + lost + open';
  ELSE RAISE NOTICE 'FAIL 45. the promoted owner row does not reconcile'; END IF;

  -- And the reason it reconciles: no promoted deal carries a NULL stage.
  SELECT count(*) INTO n FROM public.opportunities
   WHERE extra_data->>'source' = 'historical_promotion' AND sales_stage IS NULL;
  IF n = 0 THEN RAISE NOTICE 'PASS 45b. no promoted deal has a NULL sales_stage';
  ELSE RAISE NOTICE 'FAIL 45b. % promoted deals landed with a NULL stage', n; END IF;

  -- ===== 12. void =====
  SELECT public.void_historical_promotion(req, 'Promoted against the wrong company.') INTO opp2;
  IF opp2 = opp THEN RAISE NOTICE 'PASS 46. voiding returns the opportunity it archived';
  ELSE RAISE NOTICE 'FAIL 46. void returned a different id'; END IF;

  SELECT stage::text INTO t FROM public.opportunities WHERE id=opp;
  IF t = 'archived' THEN RAISE NOTICE 'PASS 47. the opportunity is archived, not deleted';
  ELSE RAISE NOTICE 'FAIL 47. stage after void is %', coalesce(t,'NULL'); END IF;

  SELECT count(*) INTO n FROM public.opportunities WHERE id=opp;
  IF n = 1 THEN RAISE NOTICE 'PASS 48. the business record still exists';
  ELSE RAISE NOTICE 'FAIL 48. the opportunity was destroyed'; END IF;

  SELECT count(*) INTO n FROM public.analytics_scope_opportunities WHERE id=opp;
  IF n = 0 THEN RAISE NOTICE 'PASS 49. a voided deal leaves the analytics scope';
  ELSE RAISE NOTICE 'FAIL 49. a voided deal is still counted'; END IF;

  SELECT coalesce(sum(public.opportunity_value(contract_value, quotation_value, estimated_value_max)),0)
    INTO v FROM public.analytics_scope_opportunities
   WHERE owner_id = s1 AND sales_stage NOT IN ('won','lost');
  IF v = 2750000.00 THEN RAISE NOTICE 'PASS 50. pipeline value drops by exactly the voided deal (3000k - 250k)';
  ELSE RAISE NOTICE 'FAIL 50. pipeline value after void is %, expected 2750000', v; END IF;

  SELECT count(*) INTO n FROM public.pipeline_by_stage p
   WHERE EXISTS (SELECT 1 FROM public.analytics_scope_opportunities o
                  WHERE o.id = opp AND o.sales_stage = p.sales_stage);
  IF n = 0 THEN RAISE NOTICE 'PASS 50b. the voided deal is gone from pipeline_by_stage, not merely revalued';
  ELSE RAISE NOTICE 'FAIL 50b. the voided deal is still in pipeline_by_stage'; END IF;

  SELECT status::text INTO t FROM public.quotations WHERE id=quo;
  IF t = 'expired' THEN RAISE NOTICE 'PASS 51. the historical quotation stops counting as live';
  ELSE RAISE NOTICE 'FAIL 51. quotation status after void is %', t; END IF;

  SELECT promotion_status INTO t FROM public.historical_sales_promotion_status WHERE row_id=row1;
  IF t = 'voided' THEN RAISE NOTICE 'PASS 52. the archive reports the void';
  ELSE RAISE NOTICE 'FAIL 52. promotion_status after void is %', coalesce(t,'NULL'); END IF;

  SELECT void_reason INTO t FROM public.historical_sales_promotion_status WHERE row_id=row1;
  IF t = 'Promoted against the wrong company.' THEN
    RAISE NOTICE 'PASS 53. the reason is retained and readable from the archive';
  ELSE RAISE NOTICE 'FAIL 53. void reason is %', coalesce(t,'NULL'); END IF;

  SELECT promoted_opportunity_id INTO t FROM public.historical_promotion_requests WHERE id=req;
  IF t = opp::text THEN RAISE NOTICE 'PASS 54. provenance survives the void';
  ELSE RAISE NOTICE 'FAIL 54. the link to the opportunity was lost'; END IF;

  SELECT count(*) INTO n FROM public.audit_log WHERE entity_id=opp AND action='historical_promotion.voided';
  IF n = 1 THEN RAISE NOTICE 'PASS 55. the void is in the audit log';
  ELSE RAISE NOTICE 'FAIL 55. void audit entries: %', n; END IF;

  IF (SELECT raw FROM public.historical_sales_rows WHERE id=row1) = raw_before THEN
    RAISE NOTICE 'PASS 56. voiding writes nothing to the archive either';
  ELSE RAISE NOTICE 'FAIL 56. the archive row changed during void'; END IF;

  IF public.void_historical_promotion(req, 'again') = opp THEN
    RAISE NOTICE 'PASS 57. voiding twice is idempotent';
  ELSE RAISE NOTICE 'FAIL 57. a second void misbehaved'; END IF;

  -- ===== 13. a corrected promotion afterwards =====
  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row1, co, s1, 'HH Tower Signage (corrected)', 'submitted', 250000.00) RETURNING id INTO req2;
  RAISE NOTICE 'PASS 58. a voided row can be promoted again';
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req2;
  UPDATE public.historical_promotion_requests SET status='approved'       WHERE id=req2;
  SELECT public.promote_historical_row(req2) INTO opp2;

  IF opp2 <> opp THEN RAISE NOTICE 'PASS 59. the corrected promotion is a new record, not a mutation of the old one';
  ELSE RAISE NOTICE 'FAIL 59. the corrected promotion reused the archived opportunity'; END IF;

  -- The corrected quotation takes the canonical number back at version 1. A
  -- correction is not a price revision, so bumping version would have been the
  -- wrong record of what happened — the void releases the number instead.
  SELECT quote_number, version INTO t, n FROM public.quotations
   WHERE id = (SELECT promoted_quotation_id FROM public.historical_promotion_requests WHERE id=req2);
  IF t = 'ZZ26001' AND n = 1 THEN
    RAISE NOTICE 'PASS 59b. the corrected quotation reclaims the canonical number at version 1';
  ELSE RAISE NOTICE 'FAIL 59b. corrected quotation is % v%', coalesce(t,'NULL'), n; END IF;

  SELECT quote_number INTO t FROM public.quotations WHERE id = quo;
  IF t LIKE 'ZZ26001#VOID-%' THEN
    RAISE NOTICE 'PASS 59c. the voided quotation is kept, marked, and out of the way';
  ELSE RAISE NOTICE 'FAIL 59c. voided quote_number is %', coalesce(t,'NULL'); END IF;

  SELECT legacy_sales_code INTO t FROM public.quotations WHERE id = quo;
  IF t = 'ZZ26001' THEN RAISE NOTICE 'PASS 59d. the voided row keeps its untouched legacy code — provenance survives';
  ELSE RAISE NOTICE 'FAIL 59d. legacy code on the voided row is %', coalesce(t,'NULL'); END IF;

  SELECT count(*) INTO n FROM public.analytics_scope_opportunities
   WHERE extra_data->>'historical_row_id' = row1::text;
  IF n = 1 THEN RAISE NOTICE 'PASS 60. only the corrected deal counts — the voided one is not double-counted';
  ELSE RAISE NOTICE 'FAIL 60. % live deals for one archive row', n; END IF;

  -- ===== 14. nobody may hand-write the stamps or the void =====
  BEGIN
    UPDATE public.historical_promotion_requests SET promoted_opportunity_id = opp WHERE id=req3;
    RAISE NOTICE 'FAIL 61. the promotion stamp was set by hand';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 61. promoted_opportunity_id can only be set by the function';
  END;

  BEGIN
    UPDATE public.historical_promotion_requests
       SET status='voided', voided_by=sm, voided_at=now(), void_reason='by hand' WHERE id=req3;
    RAISE NOTICE 'FAIL 62. a promotion was voided without archiving the opportunity';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 62. voiding goes through the function that also archives the deal';
  END;

  -- ===== 15. authority =====
  PERFORM set_config('test.uid', vw::text, TRUE);
  BEGIN
    PERFORM public.void_historical_promotion(req3, 'viewer attempt');
    RAISE NOTICE 'FAIL 63. a viewer voided a promotion';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 63. only sales leadership may void a promotion';
  END;

  PERFORM set_config('test.uid', s1::text, TRUE);
  BEGIN
    PERFORM public.promote_historical_row(req3);
    RAISE NOTICE 'FAIL 64. a salesperson promoted a record';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 64. a salesperson cannot promote';
  END;

  -- system_admin is an operator, not a commercial decision-maker, and the
  -- database says so — which is what stops the new API route becoming a way
  -- round it for whoever holds the admin role.
  PERFORM set_config('test.uid', adm::text, TRUE);
  BEGIN
    PERFORM public.promote_historical_row(req3);
    RAISE NOTICE 'FAIL 65. system_admin promoted a record';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 65. system_admin alone carries no promotion authority';
  END;
  BEGIN
    PERFORM public.void_historical_promotion(req3, 'admin attempt');
    RAISE NOTICE 'FAIL 66. system_admin voided a promotion';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 66. …nor authority to void one';
  END;

  -- No session at all.
  PERFORM set_config('test.uid', '', TRUE);
  BEGIN
    PERFORM public.promote_historical_row(req3);
    RAISE NOTICE 'FAIL 67. an unauthenticated caller promoted a record';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 67. an unauthenticated caller is refused';
  END;
END $$;

RESET ROLE;
