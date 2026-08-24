-- =========================================================
-- Historical owner map — the confirmed decisions, then the remap.
--
-- WHY A MIGRATION FOR SOMETHING THAT IS NOT A SCHEMA CHANGE
-- ---------------------------------------------------------
-- remap_historical_sales() is a runtime call. Running it once from a psql
-- prompt would be cleaner, but the Supabase CLI has no way to execute a
-- statement against a linked project — dump, push, pull, diff, reset and lint,
-- and nothing else — and the function is REVOKEd from PUBLIC so no client can
-- reach it either. A migration is the only mechanism that carries it to
-- production. The same is true of the owner-map decisions below.
--
-- SCOPE — STAGING METADATA ONLY
-- -----------------------------
-- This touches historical_sales_owner_map and historical_sales_mapped and
-- nothing else. It creates no user, company, project, contact, opportunity or
-- quotation, promotes no record, and never writes to historical_sales_rows —
-- that table refuses UPDATE and DELETE by trigger regardless.
--
-- ORDER MATTERS
-- -------------
-- The owner decisions come FIRST and the remap last. remap_historical_sales()
-- reads the owner map to stamp owner_user_id onto each derived row, so running
-- it before the NI decision would leave those rows ownerless and require a
-- second pass. An earlier draft of this migration had them the other way round.
--
-- THE DECISIONS, AND WHY EACH IS WHAT IT IS
-- -----------------------------------------
--   NI -> Faisal Abdulkadhar. Confirmed. Every handover marker on an NI code
--     points at FA and none at anyone else: NI25001-FA, NI25002-REV.01- FA,
--     and NI25066- AH-FA — which is also the single NI record in 2026.
--
--   AH -> Ahmed Kahllas, General Manager. The identity is confirmed and is
--     recorded here as history. user_id stays NULL because no production
--     account exists for him, and the map is explicitly built to hold a person
--     who has no account rather than invent one. AH is emphatically NOT mapped
--     to Ahmed Zayed, whose profiles.sales_code = 'AH' was auto-seeded from
--     the first two letters of "Ahmed" by 20260806140000's backfill and
--     collides with this prefix by accident. profiles is not touched here.
--
--   MB -> Mohammed Bassem, Managing Director. Same treatment, same reason.
--     Both MB records are from 2023, so this changes no 2026 number.
--
--   DE is deleted. It was never a person. Rows 7 and 8 of the source
--     spreadsheet carry the literal word DECLINED in the SALES CODE cell, and
--     the original analysis read its first two letters as an owner prefix. No
--     archive row parses to prefix DE — the delete is guarded on exactly that,
--     so if this assumption is ever wrong the migration fails instead of
--     discarding a real mapping.
--
--   AD, AN, BA and the undocumented BH stay unresolved. Their handover markers
--     point overwhelmingly at each other and at BH — 13 to AD, 13 to BH, 7 to
--     BA — rather than at either candidate operational owner, so there is no
--     evidence to act on. None of them has a single 2026 record, so nothing
--     waits on this.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. NI -> Faisal ============
DO $$
BEGIN
  IF NOT public.link_historical_owner(
       'NI', 'fisal@phc-sa.com', 'NI — Faisal Abdulkadhar (reassigned)',
       'Reassigned 2026-08-24, confirmed by Mo. The legacy owner NI has no account; the workload moved to Faisal. Deterministic: every handover marker on an NI code names FA (NI25001-FA, NI25002-REV.01- FA, NI25066- AH-FA) and none names anyone else. The original NI prefix is preserved on every archive row and in promotion provenance.')
  THEN
    RAISE NOTICE 'NI not linked — no account for fisal@phc-sa.com in this environment. Expected on a clean replay; VERIFY AFTER APPLYING TO PRODUCTION.';
  END IF;
END $$;

-- ============ 2. Confirmed historical identities, still without accounts ============
-- legacy_label carries the person, note carries the reason the user_id is NULL.
-- An archive row owned by one of these keeps its prefix and its label, and is
-- simply not promotable until somebody real can own the deal — which is the
-- behaviour the promotion gate already enforces.
UPDATE public.historical_sales_owner_map
   SET legacy_label = 'AH — Ahmed Kahllas (General Manager)',
       user_id      = NULL,
       note         = 'Historical identity CONFIRMED 2026-08-24: Ahmed Kahllas, General Manager. user_id intentionally NULL — no production account exists for him, and no user is created to satisfy a foreign key. NOT Ahmed Zayed: that account holds profiles.sales_code = AH only because 20260806140000''s backfill took the first two letters of "Ahmed", and he is finance_manager / estimation_manager, not the sales owner of these 93 records. 5 of them are active in 2026 and stay P1 until a real account exists.'
 WHERE prefix = 'AH';

UPDATE public.historical_sales_owner_map
   SET legacy_label = 'MB — Mohammed Bassem (Managing Director)',
       user_id      = NULL,
       note         = 'Historical identity CONFIRMED 2026-08-24: Mohammed Bassem, Managing Director. user_id intentionally NULL — no production account exists. Both MB records (MB23060, MB23061) are from 2023, so this affects no 2026 activation figure.'
 WHERE prefix = 'MB';

-- ============ 3. DE was never a person ============
DO $$
DECLARE _rows INT; _deleted INT;
BEGIN
  SELECT count(*) INTO _rows FROM public.historical_sales_mapped WHERE owner_prefix = 'DE';
  IF _rows > 0 THEN
    RAISE EXCEPTION 'Refusing to delete the DE owner mapping: % archive rows actually carry that prefix, so it is a real owner after all. | لا يمكن حذف تعيين DE.', _rows
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.historical_sales_owner_map WHERE prefix = 'DE';
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RAISE NOTICE 'DE owner mapping removed (% row) — it was parsed from the literal value DECLINED, not from a sales code.', _deleted;
END $$;

-- ============ 4. The approved remap ============
-- Idempotent by construction: the derived rows are deleted and recomputed from
-- the immutable raw rows. Three rules have improved since it last ran on
-- 2026-08-22 — FA, OM, AB and now NI resolve to real accounts; the company
-- lookup collapses runs of whitespace, and 61 companies have been created
-- since; and FOLLOW-UP is projected for the first time.
--
-- On a clean replay there are no batches and this loop does nothing.
DO $$
DECLARE b RECORD; r RECORD;
BEGIN
  FOR b IN SELECT id, source_file FROM public.historical_sales_batches ORDER BY loaded_at LOOP
    SELECT * INTO r FROM public.remap_historical_sales(b.id);
    RAISE NOTICE 'remapped %: % rows · % codes unparsed · % amounts unparsed · % owners unmatched · % companies unmatched',
      b.source_file, r.rows_mapped, r.codes_unparsed, r.amounts_unparsed, r.owners_unmatched, r.companies_unmatched;
  END LOOP;
END $$;
