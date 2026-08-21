-- =============================================================================
-- Phase 5 — outcome dates are stamped once and never guessed (behavioural).
--
-- The failure being prevented: `updated_at` moves on any edit, so a deal won in
-- March and re-saved in August reads as an August win. These checks prove the
-- new column is written at the transition, survives later edits, and is left
-- NULL when there is no evidence rather than back-filled from a guess.
--
-- Run with:  bun run test:db:behaviour
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  u UUID; o_id UUID; o_hist UUID; o_none UUID;
  w1 TIMESTAMPTZ; w2 TIMESTAMPTZ; l1 TIMESTAMPTZ;
  n INT;
BEGIN
  INSERT INTO auth.users (email) VALUES ('wondate@phc-sa.com');
  SELECT id INTO u FROM auth.users WHERE email='wondate@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id=u;

  -- Stage moves run as the service role in production (sales-os-api).
  PERFORM set_config('test.uid', '', false);

  -- ===== 1. A new opportunity has no outcome date =====
  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('WD open', u) RETURNING id INTO o_id;
  SELECT won_at INTO w1 FROM public.opportunities WHERE id=o_id;
  RAISE NOTICE '%  1. an open opportunity has no won_at (got %)',
    CASE WHEN w1 IS NULL THEN 'PASS' ELSE 'FAIL' END, COALESCE(w1::text,'NULL');

  -- ===== 2. The transition to won stamps it =====
  UPDATE public.opportunities SET sales_stage='won', stage='won' WHERE id=o_id;
  SELECT won_at INTO w1 FROM public.opportunities WHERE id=o_id;
  RAISE NOTICE '%  2. reaching won stamps won_at (got %)',
    CASE WHEN w1 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, COALESCE(w1::text,'NULL');

  -- ===== 3. An ordinary later edit does not move it =====
  PERFORM pg_sleep(0.05);
  UPDATE public.opportunities SET project_name='WD renamed', next_action='call the client' WHERE id=o_id;
  SELECT won_at INTO w2 FROM public.opportunities WHERE id=o_id;
  RAISE NOTICE '%  3. a later edit does not move won_at (% = %)',
    CASE WHEN w2 = w1 THEN 'PASS' ELSE 'FAIL' END, w1, w2;

  -- ===== 4. Nor does re-writing the same stage =====
  UPDATE public.opportunities SET sales_stage='won' WHERE id=o_id;
  SELECT won_at INTO w2 FROM public.opportunities WHERE id=o_id;
  RAISE NOTICE '%  4. re-saving the won stage does not re-stamp (% = %)',
    CASE WHEN w2 = w1 THEN 'PASS' ELSE 'FAIL' END, w1, w2;

  -- ===== 5. A direct attempt to overwrite it is ignored =====
  UPDATE public.opportunities SET won_at = '2001-01-01T00:00:00Z' WHERE id=o_id;
  SELECT won_at INTO w2 FROM public.opportunities WHERE id=o_id;
  RAISE NOTICE '%  5. won_at cannot be silently rewritten by an update (still %)',
    CASE WHEN w2 = w1 THEN 'PASS' ELSE 'FAIL' END, w2;

  -- ===== 6. lost_at behaves the same way =====
  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('WD lost', u) RETURNING id INTO o_none;
  UPDATE public.opportunities SET sales_stage='lost', stage='lost', loss_reason='price' WHERE id=o_none;
  SELECT lost_at INTO l1 FROM public.opportunities WHERE id=o_none;
  RAISE NOTICE '%  6. reaching lost stamps lost_at (got %)',
    CASE WHEN l1 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, COALESCE(l1::text,'NULL');

  SELECT won_at INTO w2 FROM public.opportunities WHERE id=o_none;
  RAISE NOTICE '%  7. a lost deal gets no won_at (got %)',
    CASE WHEN w2 IS NULL THEN 'PASS' ELSE 'FAIL' END, COALESCE(w2::text,'NULL');

  -- ===== 8. No guessed backfill =====
  -- A row that was already won before this migration, with no transition
  -- history, must keep NULL. updated_at is deliberately not consulted.
  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, stage)
  VALUES ('WD historical', u, 'won', 'won') RETURNING id INTO o_hist;
  UPDATE public.opportunities SET won_at = NULL WHERE id = o_hist;   -- simulate a pre-tracking row
  UPDATE public.opportunities SET next_action = 'anything' WHERE id = o_hist;
  SELECT won_at INTO w2 FROM public.opportunities WHERE id=o_hist;
  RAISE NOTICE '%  8. a historical won row stays undated rather than guessing from updated_at (got %)',
    CASE WHEN w2 IS NULL THEN 'PASS' ELSE 'FAIL' END, COALESCE(w2::text,'NULL');

  -- ===== 9. Backfill only from real transition history =====
  INSERT INTO public.stage_transition_history (record_type, record_id, from_stage, to_stage, actor_id, created_at)
  VALUES ('opportunity', o_hist, 'contract_signed', 'won', u, '2026-03-15T10:00:00Z');

  WITH first_won AS (
    SELECT record_id, MIN(created_at) AS at FROM public.stage_transition_history
     WHERE record_type='opportunity' AND to_stage='won' GROUP BY record_id
  )
  UPDATE public.opportunities o SET won_at = f.at
    FROM first_won f WHERE o.id = f.record_id AND o.won_at IS NULL;

  SELECT won_at INTO w2 FROM public.opportunities WHERE id=o_hist;
  RAISE NOTICE '%  9. history-based backfill uses the real transition date (got %)',
    CASE WHEN w2 = '2026-03-15T10:00:00Z'::timestamptz THEN 'PASS' ELSE 'FAIL' END, COALESCE(w2::text,'NULL');

  -- ===== 10. Indexes exist for the period queries =====
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname='public' AND indexname IN ('idx_opportunities_won_at','idx_opportunities_lost_at');
  RAISE NOTICE '% 10. read-path indexes exist (got % of 2)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- outcome date stamping: done ---';
END $$;
