-- =============================================================================
-- Phase 7C — quotation revisions, VAT, the submission gate, approval payloads.
--
-- The controls worth proving here are the ones that stop a number changing
-- between the approval and the client:
--
--   * the snapshot freezes when the revision leaves draft
--   * a submitted revision cannot be edited at all
--   * the subtotal must equal the GM-approved price exactly
--   * only the GM (or a delegate) may approve
--   * an approval payload cannot carry money, because `approvals` is readable
--     by every active user
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  est UUID; gm UUID; sm UUID; fin UUID; vw UUID; s1 UUID; s2 UUID;
  o1 UUID; b1 UUID; r1 UUID; e1 UUID; p1 UUID; q1 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('c7_est@phc-sa.com'),('c7_gm@phc-sa.com'),('c7_sm@phc-sa.com'),('c7_fin@phc-sa.com'),
    ('c7_vw@phc-sa.com'),('c7_s1@phc-sa.com'),('c7_s2@phc-sa.com');
  SELECT id INTO est FROM auth.users WHERE email='c7_est@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='c7_gm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='c7_sm@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='c7_fin@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='c7_vw@phc-sa.com';
  SELECT id INTO s1  FROM auth.users WHERE email='c7_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='c7_s2@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (est,gm,sm,fin,vw,s1,s2);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (est,'estimation_manager'),(gm,'general_manager'),(sm,'sales_manager'),
    (fin,'finance_manager'),(vw,'viewer'),(s1,'salesperson'),(s2,'salesperson');

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('C7 deal', s1) RETURNING id INTO o1;
  INSERT INTO public.boqs (related_opportunity_id,title,status,source_confidence,currency,created_by)
    VALUES (o1,'C7 BOQ','estimated_scope','medium','SAR',est) RETURNING id INTO b1;
  INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by)
    VALUES (b1,1,'draft','manual',est) RETURNING id INTO r1;
  INSERT INTO public.estimations (boq_revision_id,cost_total,installation_cost,created_by)
    VALUES (r1,100000,20000,est) RETURNING id INTO e1;

  -- Walk 7A's chain to a GM-approved price of 150000.00. Each step is taken by
  -- the role 7A requires for it: commercial review needs a pipeline operator,
  -- finance review needs finance, and only the GM may approve.
  INSERT INTO public.internal_prices (estimation_id, proposed_price, status, proposed_by)
    VALUES (e1, 150000.00, 'draft', est) RETURNING id INTO p1;
  UPDATE public.internal_prices SET status='cost_complete'            WHERE id=p1;
  UPDATE public.internal_prices SET status='internal_price_proposed'  WHERE id=p1;
  PERFORM set_config('test.uid', sm::text, TRUE);
  UPDATE public.internal_prices SET status='commercial_review'        WHERE id=p1;
  PERFORM set_config('test.uid', fin::text, TRUE);
  UPDATE public.internal_prices SET status='finance_review'           WHERE id=p1;
  UPDATE public.internal_prices SET status='gm_pending'               WHERE id=p1;
  PERFORM set_config('test.uid', gm::text, TRUE);
  UPDATE public.internal_prices SET status='gm_approved'              WHERE id=p1;
  PERFORM set_config('test.uid', '', TRUE);

  -- Freeze the BOQ revision — 7C refuses to approve a quote priced off a
  -- revision that can still move.
  UPDATE public.boq_revisions SET frozen_at=now(), frozen_by=est WHERE id=r1;

  INSERT INTO public.quotations (quote_number, related_opportunity_id, boq_id, owner_id, value, currency, created_by)
    VALUES ('C7-Q-001', o1, b1, s1, 150000.00, 'SAR', s1) RETURNING id INTO q1;
END $$;

CREATE TEMP TABLE c7 AS SELECT
  (SELECT id FROM public.quotations WHERE quote_number='C7-Q-001') AS q1,
  (SELECT br.id FROM public.boq_revisions br JOIN public.boqs b ON b.id=br.boq_id WHERE b.title='C7 BOQ') AS r1,
  (SELECT ip.id FROM public.internal_prices ip JOIN public.estimations e ON e.id=ip.estimation_id
     JOIN public.boq_revisions br ON br.id=e.boq_revision_id JOIN public.boqs b ON b.id=br.boq_id
    WHERE b.title='C7 BOQ') AS p1;
GRANT SELECT ON c7 TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; q1 UUID; r1 UUID; p1 UUID; rev UUID; rev2 UUID;
  est UUID; gm UUID; sm UUID; vw UUID; s1 UUID; s2 UUID;
  v NUMERIC; st public.quotation_revision_status;
BEGIN
  SELECT t.q1, t.r1, t.p1 INTO q1, r1, p1 FROM c7 t;
  SELECT id INTO est FROM auth.users WHERE email='c7_est@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='c7_gm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='c7_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='c7_vw@phc-sa.com';
  SELECT id INTO s1  FROM auth.users WHERE email='c7_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='c7_s2@phc-sa.com';

  -- ===== VAT is computed, never typed =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  INSERT INTO public.quotation_revisions
    (quotation_id, revision_number, boq_revision_id, internal_price_id, subtotal_excl_vat, created_by)
    VALUES (q1, 1, r1, p1, 150000.00, s1) RETURNING id INTO rev;

  SELECT vat_amount INTO v FROM public.quotation_revisions WHERE id=rev;
  RAISE NOTICE '% 1. VAT is computed at 15%% (expect 22500.00, got %)',
    CASE WHEN v = 22500.00 THEN 'PASS' ELSE 'FAIL' END, v;
  SELECT total_incl_vat INTO v FROM public.quotation_revisions WHERE id=rev;
  RAISE NOTICE '% 2. the total includes VAT (expect 172500.00, got %)',
    CASE WHEN v = 172500.00 THEN 'PASS' ELSE 'FAIL' END, v;

  BEGIN UPDATE public.quotation_revisions SET vat_amount = 1 WHERE id=rev;
    RAISE NOTICE 'FAIL 3. a generated VAT column was overwritten';
  EXCEPTION WHEN others THEN RAISE NOTICE 'PASS 3. vat_amount cannot be written by hand'; END;

  -- A zero rate is how exempt is expressed; there is no vat_treatment column.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='quotation_revisions' AND column_name='vat_treatment';
  RAISE NOTICE '% 4. no vat_treatment column, per the approved VAT decision (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN INSERT INTO public.quotation_revisions
      (quotation_id, revision_number, boq_revision_id, internal_price_id, subtotal_excl_vat, vat_rate, created_by)
      VALUES (q1, 99, r1, p1, 1000, 15, s1);
    RAISE NOTICE 'FAIL 5. a VAT rate of 15 (percent) was accepted as a fraction';
  EXCEPTION
    -- NUMERIC(5,4) tops out at 9.9999, so 15 overflows before the CHECK is
    -- reached. Either refusal is the right outcome; both are accepted here so
    -- the test pins the behaviour rather than which of the two guards fired.
    WHEN numeric_value_out_of_range THEN RAISE NOTICE 'PASS 5. vat_rate must be a fraction, not a percentage (refused by precision)';
    WHEN check_violation            THEN RAISE NOTICE 'PASS 5. vat_rate must be a fraction, not a percentage (refused by CHECK)';
  END;

  -- ===== a revision starts in draft =====
  BEGIN INSERT INTO public.quotation_revisions
      (quotation_id, revision_number, boq_revision_id, internal_price_id, subtotal_excl_vat, status, created_by)
      VALUES (q1, 98, r1, p1, 150000.00, 'approved', s1);
    RAISE NOTICE 'FAIL 6. a revision was inserted straight into approved';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 6. a revision can only be born in draft'; END;

  -- ===== the price must match the GM-approved figure exactly =====
  UPDATE public.quotation_revisions SET subtotal_excl_vat = 150000.01 WHERE id=rev;
  BEGIN UPDATE public.quotation_revisions SET status='pending_approval' WHERE id=rev;
    RAISE NOTICE 'FAIL 7. a subtotal one halala off the approved price was accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 7. the subtotal must equal the GM-approved price to the halala'; END;
  UPDATE public.quotation_revisions SET subtotal_excl_vat = 150000.00 WHERE id=rev;

  -- ===== the snapshot freezes on leaving draft =====
  UPDATE public.quotation_revisions SET status='pending_approval' WHERE id=rev;
  RAISE NOTICE 'PASS 8. a matching draft may be sent for approval';

  BEGIN UPDATE public.quotation_revisions SET subtotal_excl_vat=140000 WHERE id=rev;
    RAISE NOTICE 'FAIL 9. the subtotal changed after leaving draft';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 9. the subtotal is frozen once the revision leaves draft'; END;
  BEGIN UPDATE public.quotation_revisions SET vat_rate=0 WHERE id=rev;
    RAISE NOTICE 'FAIL 10. the VAT rate changed after leaving draft';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 10. …and so is the VAT rate'; END;
  BEGIN UPDATE public.quotation_revisions SET internal_price_id=NULL WHERE id=rev;
    RAISE NOTICE 'FAIL 11. the price link was cut after leaving draft';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 11. …and so is the link to the approved price'; END;

  -- ===== only the GM approves =====
  PERFORM set_config('test.uid', sm::text, TRUE);
  BEGIN UPDATE public.quotation_revisions SET status='approved' WHERE id=rev;
    RAISE NOTICE 'FAIL 12. sales_manager approved a quotation revision';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 12. sales_manager cannot approve a quotation revision'; END;

  PERFORM set_config('test.uid', est::text, TRUE);
  BEGIN UPDATE public.quotation_revisions SET status='approved' WHERE id=rev;
    RAISE NOTICE 'FAIL 13. estimation_manager approved a quotation revision';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 13. estimation_manager cannot either'; END;

  PERFORM set_config('test.uid', gm::text, TRUE);
  UPDATE public.quotation_revisions SET status='approved' WHERE id=rev;
  SELECT count(*) INTO n FROM public.quotation_revisions
   WHERE id=rev AND status='approved' AND approved_by=gm AND approved_at IS NOT NULL;
  RAISE NOTICE '% 14. the GM approves and is stamped from the session (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== no reopening an approved revision =====
  BEGIN UPDATE public.quotation_revisions SET status='draft' WHERE id=rev;
    RAISE NOTICE 'FAIL 15. an approved revision was reopened for editing';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 15. an approved revision cannot be reopened as a draft'; END;

  -- ===== submission, then total immutability =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  UPDATE public.quotation_revisions SET status='submitted' WHERE id=rev;
  SELECT count(*) INTO n FROM public.quotation_revisions
   WHERE id=rev AND submitted_by=s1 AND submitted_at IS NOT NULL AND issued_at IS NOT NULL;
  RAISE NOTICE '% 16. submission stamps who and when (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN UPDATE public.quotation_revisions SET payment_terms='30 days' WHERE id=rev;
    RAISE NOTICE 'FAIL 17. a submitted revision was edited';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 17. a submitted revision cannot be edited'; END;
  BEGIN UPDATE public.quotation_revisions SET valid_until='2030-01-01' WHERE id=rev;
    RAISE NOTICE 'FAIL 18. a submitted revision had its validity extended';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 18. …including its validity date'; END;
  BEGIN UPDATE public.quotation_revisions SET submitted_at=now() - interval '10 days' WHERE id=rev;
    RAISE NOTICE 'FAIL 19. the submission timestamp was backdated';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 19. …and the submission date cannot be backdated'; END;

  -- ===== nothing is deleted, ever =====
  -- Two separate layers, and the difference matters. For a client there is no
  -- DELETE policy, so the statement matches no rows and returns quietly —
  -- there is no exception to catch, and asserting one here would have been a
  -- test that could only ever fail. What proves the rule is that the row is
  -- still there afterwards. The trigger is what stops the service role, and
  -- that is checked below as the table owner, where RLS does not apply.
  DELETE FROM public.quotation_revisions WHERE id=rev;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 20. a client DELETE removes nothing (expect 0 rows, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.quotation_revisions WHERE id=rev;
  RAISE NOTICE '% 20b. …and the revision is still there (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== superseding keeps history =====
  UPDATE public.quotation_revisions SET is_current=FALSE WHERE id=rev;
  INSERT INTO public.quotation_revisions
    (quotation_id, revision_number, supersedes_id, boq_revision_id, internal_price_id, subtotal_excl_vat, created_by)
    VALUES (q1, 2, rev, r1, p1, 150000.00, s1) RETURNING id INTO rev2;
  UPDATE public.quotation_revisions SET status='superseded' WHERE id=rev;
  SELECT count(*) INTO n FROM public.quotation_revisions WHERE quotation_id=q1;
  RAISE NOTICE '% 21. superseding keeps both revisions (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.quotation_revisions WHERE quotation_id=q1 AND is_current;
  RAISE NOTICE '% 22. exactly one current revision per quotation (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT subtotal_excl_vat INTO v FROM public.quotation_revisions WHERE id=rev;
  RAISE NOTICE '% 23. the superseded revision keeps the figure it was sent with (expect 150000.00, got %)',
    CASE WHEN v=150000.00 THEN 'PASS' ELSE 'FAIL' END, v;

  BEGIN INSERT INTO public.quotation_revisions
      (quotation_id, revision_number, boq_revision_id, internal_price_id, subtotal_excl_vat, created_by)
      VALUES (q1, 2, r1, p1, 150000.00, s1);
    RAISE NOTICE 'FAIL 24. two revisions share a revision number';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 24. a revision number is unique per quotation'; END;

  -- ===== who can see a revision =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.quotation_revisions WHERE quotation_id=q1;
  RAISE NOTICE '% 25. the deal owner reads the revisions (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.quotation_revisions WHERE quotation_id=q1;
  RAISE NOTICE '% 26. an unrelated salesperson reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.quotation_revisions WHERE quotation_id=q1;
  RAISE NOTICE '% 27. viewer reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.quotation_revisions WHERE quotation_id=q1;
  RAISE NOTICE '% 28. anon reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the current-revision view carries no cost or margin =====
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='quotation_current_revision'
     AND column_name IN ('margin_value','margin_percentage','cost_total','unit_cost','proposed_price');
  RAISE NOTICE '% 29. the pipeline view exposes no cost or margin (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== approval payloads carry no money =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  BEGIN
    INSERT INTO public.approvals (approval_type, requested_by, linked_record_type, linked_record_id,
                                  requested_action, requested_payload)
      VALUES ('quotation_submission', s1, 'quotation_revision', rev2, 'submit',
              '{"proposed_price": 150000, "client": "Binladen"}'::jsonb);
    RAISE NOTICE 'FAIL 30. an approval payload carried a price';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 30. a price in an approval payload is refused'; END;

  BEGIN
    INSERT INTO public.approvals (approval_type, requested_by, linked_record_type, linked_record_id,
                                  requested_action, requested_payload)
      VALUES ('quotation_submission', s1, 'quotation_revision', rev2, 'submit',
              '{"terms": {"commercial": {"total_incl_vat": 172500}}}'::jsonb);
    RAISE NOTICE 'FAIL 31. a nested price slipped through';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 31. a price nested three levels deep is still refused'; END;

  BEGIN
    INSERT INTO public.approvals (approval_type, requested_by, linked_record_type, linked_record_id,
                                  requested_action, requested_payload)
      VALUES ('quotation_submission', s1, 'quotation_revision', rev2, 'submit',
              '{"revision_number": 2, "client_reference": "RFQ-88"}'::jsonb);
    RAISE NOTICE 'PASS 32. a pointer-only payload is accepted';
  EXCEPTION WHEN others THEN RAISE NOTICE 'FAIL 32. a clean payload was refused: %', SQLERRM; END;

  BEGIN
    INSERT INTO public.approvals (approval_type, requested_by, linked_record_type, linked_record_id,
                                  requested_action, requested_payload)
      VALUES ('quotation_submission', s1, 'quotation_revision', NULL, 'submit', '{}'::jsonb);
    RAISE NOTICE 'FAIL 33. a quotation approval named no revision';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 33. a quotation approval must name its revision'; END;

  -- Other approval types are untouched — the ban is scoped, not global.
  BEGIN
    INSERT INTO public.approvals (approval_type, requested_by, linked_record_type, linked_record_id,
                                  requested_action, requested_payload)
      VALUES ('discount_request', s1, 'opportunity', NULL, 'discount', '{"amount": 500}'::jsonb);
    RAISE NOTICE 'PASS 34. non-quotation approvals may still carry amounts';
  EXCEPTION WHEN others THEN RAISE NOTICE 'FAIL 34. an unrelated approval flow was broken: %', SQLERRM; END;

  RAISE NOTICE '--- phase 7C quotation revisions: done ---';
END $$;

RESET ROLE;

-- ===== the gates that need a fresh, unfrozen fixture =====
DO $$
DECLARE
  est UUID; gm UUID; s3 UUID; o2 UUID; b2 UUID; r2 UUID; e2 UUID; p2 UUID; q2 UUID; rev UUID; n INT;
BEGIN
  INSERT INTO auth.users (email) VALUES ('c7_s3@phc-sa.com');
  SELECT id INTO s3 FROM auth.users WHERE email='c7_s3@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='c7_est@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='c7_gm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id=s3;
  INSERT INTO public.user_roles (user_id, role) VALUES (s3,'salesperson');

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('C7 deal B', s3) RETURNING id INTO o2;
  INSERT INTO public.boqs (related_opportunity_id,title,status,source_confidence,currency,created_by)
    VALUES (o2,'C7 BOQ B','estimated_scope','medium','SAR',est) RETURNING id INTO b2;
  INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by)
    VALUES (b2,1,'draft','manual',est) RETURNING id INTO r2;
  INSERT INTO public.estimations (boq_revision_id,cost_total,installation_cost,created_by)
    VALUES (r2,10,5,est) RETURNING id INTO e2;
  INSERT INTO public.internal_prices (estimation_id, proposed_price, status, proposed_by)
    VALUES (e2, 900.00, 'draft', est) RETURNING id INTO p2;
  INSERT INTO public.quotations (quote_number, related_opportunity_id, boq_id, owner_id, value, currency, created_by)
    VALUES ('C7-Q-002', o2, b2, s3, 900.00, 'SAR', s3) RETURNING id INTO q2;

  PERFORM set_config('test.uid', gm::text, TRUE);
  INSERT INTO public.quotation_revisions
    (quotation_id, revision_number, boq_revision_id, internal_price_id, subtotal_excl_vat, created_by)
    VALUES (q2, 1, r2, p2, 900.00, s3) RETURNING id INTO rev;

  -- The BOQ revision is NOT frozen and the price is NOT gm_approved.
  BEGIN UPDATE public.quotation_revisions SET status='pending_approval' WHERE id=rev;
    RAISE NOTICE 'FAIL 35. a quote was approved against a price the GM never approved';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 35. an un-approved internal price blocks the quotation';
    WHEN check_violation      THEN RAISE NOTICE 'PASS 35. an unfrozen BOQ revision blocks the quotation first';
  END;

  -- Freeze the BOQ but leave the price un-approved: the price gate must still bite.
  UPDATE public.boq_revisions SET frozen_at=now(), frozen_by=est WHERE id=r2;
  BEGIN UPDATE public.quotation_revisions SET status='pending_approval' WHERE id=rev;
    RAISE NOTICE 'FAIL 36. a draft internal price was accepted as approved';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 36. the internal price must be gm_approved'; END;

  -- A revision with no BOQ or price at all cannot leave draft.
  UPDATE public.quotation_revisions SET status='draft' WHERE id=rev;
  UPDATE public.quotation_revisions SET boq_revision_id=NULL, internal_price_id=NULL WHERE id=rev;
  BEGIN UPDATE public.quotation_revisions SET status='pending_approval' WHERE id=rev;
    RAISE NOTICE 'FAIL 37. a revision with no BOQ or price left draft';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 37. a revision needs both a BOQ revision and a price to leave draft'; END;

  -- ===== document reach =====
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
   WHERE t.typname='document_entity_type' AND e.enumlabel IN ('quotation_revision','boq_revision');
  RAISE NOTICE '% 38. both revision entity types exist in the document registry (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '  %', CASE WHEN public.document_entity_grants('quotation_revision', rev, s3)
    THEN 'PASS 39. the deal owner reaches documents on their quotation revision'
    ELSE 'FAIL 39. the deal owner cannot reach their own revision documents' END;
  RAISE NOTICE '  %', CASE WHEN public.document_entity_grants('boq_revision', r2, s3)
    THEN 'PASS 40. the 7A boq_revision gap is closed'
    ELSE 'FAIL 40. boq_revision documents still reach nobody' END;
  RAISE NOTICE '  %', CASE WHEN NOT public.document_entity_grants('quotation_revision', rev,
      (SELECT id FROM auth.users WHERE email='c7_vw@phc-sa.com'))
    THEN 'PASS 41. viewer reaches no revision documents'
    ELSE 'FAIL 41. viewer reached a quotation revision document' END;
  RAISE NOTICE '  %', CASE WHEN NOT public.document_entity_grants('quotation_revision', gen_random_uuid(), s3)
    THEN 'PASS 42. a forged link pointing at nothing grants nothing'
    ELSE 'FAIL 42. a forged revision link granted access' END;

  -- The service role bypasses RLS but not triggers. This runs as the table
  -- owner, which is the only way to prove the trigger rather than the policy.
  BEGIN DELETE FROM public.quotation_revisions WHERE id=rev;
    RAISE NOTICE 'FAIL 43. a quotation revision was deleted as owner';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 43. quotation revisions refuse DELETE even as owner'; END;

  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname='quotation_revisions' AND p.polcmd='d';
  RAISE NOTICE '% 44. there is no DELETE policy at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 7C gates: done ---';
END $$;
