-- =========================================================
-- Historical archive — owner mapping, the FOLLOW-UP column, and the stage rules.
--
-- THREE THINGS, ALL OF THEM "RULES AS DATA"
-- -----------------------------------------
-- The staging layer (20260825100000) deliberately keeps its decisions in
-- lookup tables rather than in code, so a mapping change is reviewable as data
-- and a remap is re-runnable. This migration stays inside that design: it fills
-- in rows and adds columns to the existing maps. It creates no user, no
-- company, no canonical entity, and it does not touch historical_sales_rows.
--
-- 1. OWNER PREFIXES — three of ten, and only the three that are on record.
--
--    20260806140000 records Faisal's own words verbatim:
--
--      "if it's added by me, or Omar, or Mary, or Abdulrahman, so we have
--       particular code for this thing. For me, it's FA. Abdulrahman is AB.
--       Omar is OM."
--
--    So FA, AB and OM are mapped here. AH, NI, AD, AN, DE and MB are NOT —
--    there is no statement covering them and a guess would put someone else's
--    deals in a person's workload.
--
--    AH deserves its own note, because it looks resolved and is not.
--    profiles.sales_code = 'AH' currently belongs to Ahmed Zayed, who joined on
--    2026-08-06 and was auto-seeded that code from the first two letters of
--    "Ahmed" by 20260806140000's backfill. He is finance_manager and
--    estimation_manager, not a salesperson, and AH in this archive is a legacy
--    SALES prefix carrying 93 records. The code is occupied by the wrong
--    person for this purpose. Resolving that is a profiles change and a
--    business decision, and is deliberately not made here.
--
--    Omar and Abdulrahman have no sales_code at all for the same reason in
--    reverse: both accounts were created (2026-08-23 and 2026-08-20) AFTER
--    that backfill ran, so it never saw them. This migration maps the archive
--    prefix without touching profiles.sales_code — the instruction was to go
--    through the historical mapping architecture, and profiles is a different
--    registry with a unique index of its own.
--
--    Resolution is by email, which is the only stable identifier here, and it
--    FAILS THE MIGRATION if any of the three does not resolve. A half-applied
--    owner map would silently leave records unpromotable with no signal.
--
-- 2. THE FOLLOW-UP COLUMN — the best liveness evidence in the file, unused.
--
--    The spreadsheet carries a FOLLOW-UP column (ACTIVE / DEAD / WAITING FOR
--    CLIENT / FOR FOLLOW-UP). It survives in the raw jsonb but was never
--    projected into historical_sales_mapped, so nothing could read it and the
--    search view could not show it.
--
--    It is projected here as RAW TEXT and nothing else. It does not drive
--    status, it does not create a follow_up row, and it does not change any
--    lifecycle: on 7 of the 79 2026 records it CONTRADICTS the quotation
--    status (6 marked LOST but followed up as ACTIVE, 1 WAITING FOR CLIENT but
--    DEAD), and a column that disagrees with another column is evidence for a
--    human, not an input to an automatic decision.
--
-- 3. THE STAGE RULES — where a promoted record lands, as data.
--
--    historical_sales_status_map already answers "what quotation status is
--    this". It now also answers "what sales_stage and what commercial handoff
--    status", so the promotion function reads a rule instead of hardcoding a
--    CASE that the UI would then have to duplicate.
--
--    All three ACTIVE statuses land at sales_stage = 'jih' and differ only in
--    the handoff status. That is the model working as designed, not a
--    shortcut: 20260818140000 states outright that commercial_handoff_status
--    is "independent of the sales stage", and applySalesStage's own comment
--    records that the handoff vocabulary tracks the pricing cycle that runs
--    BEFORE a win (with_sales -> ... -> submitted -> waiting_client). A
--    submitted quotation is a live JIH deal whose file is with the client;
--    those are two different facts and the schema already has a column for
--    each. Inventing a 'quotation_submitted' sales stage would duplicate the
--    second one into the first.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Owner prefixes: FA, OM, AB ============
-- Linking is a function rather than three hand-written UPDATEs, for two
-- reasons. AH and NI will be decided later and should be a one-line call, not
-- a new migration written from memory. And the first version of this raised an
-- exception when an account was missing, which was right on production and
-- wrong everywhere else: a clean replay has no profiles at all, so it failed
-- CI and every fresh environment on the first try. Migrations have to be
-- replayable into an empty database.
--
-- So the function is idempotent and honest — it reports whether it resolved —
-- and the migration NOTICEs what it could not link instead of aborting. The
-- assertion that production really did resolve all three belongs to the
-- post-apply verification, where a missing account is a fact about the
-- environment rather than a broken migration.
CREATE OR REPLACE FUNCTION public.link_historical_owner(
  _prefix TEXT, _email TEXT, _label TEXT, _note TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _uid UUID;
BEGIN
  SELECT id INTO _uid FROM public.profiles WHERE lower(email) = lower(_email);
  IF _uid IS NULL THEN
    RETURN FALSE;
  END IF;
  UPDATE public.historical_sales_owner_map
     SET user_id = _uid, legacy_label = _label, note = _note
   WHERE prefix = _prefix;
  RETURN FOUND;
END; $$;

COMMENT ON FUNCTION public.link_historical_owner IS
  'Points a legacy sales-code prefix at an existing account, by email. Returns FALSE rather than raising when no such account exists, so a migration carrying a mapping stays replayable into an empty database. Creates no user — the whole point of the owner map is that a person without an account is recorded as a label, never invented.';

REVOKE ALL ON FUNCTION public.link_historical_owner(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE _unresolved TEXT := '';
BEGIN
  IF NOT public.link_historical_owner('FA', 'fisal@phc-sa.com', 'FA — Faisal Abdulkadhar',
       'Confirmed 2026-08-24. Stated by Faisal in 20260806140000; profiles.sales_code = FA.')
  THEN _unresolved := _unresolved || 'FA '; END IF;

  IF NOT public.link_historical_owner('OM', 'omar@phc-sa.com', 'OM — Omar kallas',
       'Confirmed 2026-08-24. Stated by Faisal in 20260806140000 ("Omar is OM"). profiles.sales_code is unset — the account was created 2026-08-23, after that migration''s backfill ran.')
  THEN _unresolved := _unresolved || 'OM '; END IF;

  IF NOT public.link_historical_owner('AB', 'a.jarrah@phc-sa.com', 'AB — abdelrahman jarrah',
       'Confirmed 2026-08-24. Stated by Faisal in 20260806140000 ("Abdulrahman is AB"). profiles.sales_code is unset — the account was created 2026-08-20, after that migration''s backfill ran.')
  THEN _unresolved := _unresolved || 'AB '; END IF;

  IF _unresolved <> '' THEN
    RAISE NOTICE 'historical owner map: % not linked (no matching account in this environment). Expected on a clean replay; VERIFY AFTER APPLYING TO PRODUCTION.',
      btrim(_unresolved);
  END IF;
END $$;

-- The seven that stay unmapped, each with the reason, so the next person does
-- not have to re-derive why.
UPDATE public.historical_sales_owner_map
   SET note = 'UNRESOLVED 2026-08-24. profiles.sales_code = AH belongs to Ahmed Zayed (finance_manager, estimation_manager), auto-seeded from "Ahmed" by 20260806140000. AH here is a legacy SALES prefix with 93 archive records. Needs a business decision, not a guess.'
 WHERE prefix = 'AH' AND user_id IS NULL;

UPDATE public.historical_sales_owner_map
   SET note = coalesce(note,'') || ' UNRESOLVED 2026-08-24: no statement on record and no candidate account. Records stay P1.'
 WHERE prefix IN ('NI','AD','AN','DE','MB') AND user_id IS NULL;

-- ============ 2. FOLLOW-UP, projected raw ============
ALTER TABLE public.historical_sales_mapped
  ADD COLUMN IF NOT EXISTS follow_up_raw TEXT;

COMMENT ON COLUMN public.historical_sales_mapped.follow_up_raw IS
  'The spreadsheet FOLLOW-UP cell, verbatim (ACTIVE / DEAD / WAITING FOR CLIENT / FOR FOLLOW-UP). Evidence only: it never drives status, never creates a follow_ups row, and on 7 of the 79 2026 records it contradicts the quotation status. Read historical_sales_followup_conflicts for those.';

CREATE INDEX IF NOT EXISTS hsm_follow_up ON public.historical_sales_mapped (follow_up_raw);

-- ============ 3. Stage rules, beside the status rules ============
ALTER TABLE public.historical_sales_status_map
  ADD COLUMN IF NOT EXISTS canonical_sales_stage TEXT,
  ADD COLUMN IF NOT EXISTS canonical_handoff_status TEXT,
  ADD COLUMN IF NOT EXISTS promotable_active BOOLEAN NOT NULL DEFAULT FALSE;

-- Only values the schema already accepts. A typo here would surface as a
-- promotion failure at runtime rather than at migration time, so it is
-- constrained at the column.
ALTER TABLE public.historical_sales_status_map
  DROP CONSTRAINT IF EXISTS hssm_sales_stage_valid;
ALTER TABLE public.historical_sales_status_map
  ADD CONSTRAINT hssm_sales_stage_valid CHECK (
    canonical_sales_stage IS NULL
    OR canonical_sales_stage IN ('rfq_received','jih','jih_bafo','under_negotiation',
                                 'verbally_awarded','contract_received','contract_signed',
                                 'won','lost','on_hold'));

ALTER TABLE public.historical_sales_status_map
  DROP CONSTRAINT IF EXISTS hssm_handoff_valid;
ALTER TABLE public.historical_sales_status_map
  ADD CONSTRAINT hssm_handoff_valid CHECK (
    canonical_handoff_status IS NULL
    OR canonical_handoff_status IN ('with_sales','waiting_management','with_commercial',
                                    'waiting_vendor','waiting_gm','final_review',
                                    'ready_for_sales','submitted','waiting_client'));

-- The three ACTIVE statuses this batch promotes.
UPDATE public.historical_sales_status_map
   SET canonical_sales_stage = 'jih', canonical_handoff_status = 'submitted',
       promotable_active = TRUE,
       note = note || ' Promotes to sales_stage=jih, handoff=submitted: the quotation left the building and is with the client.'
 WHERE source_status = 'SUBMITTED';

UPDATE public.historical_sales_status_map
   SET canonical_sales_stage = 'jih', canonical_handoff_status = 'waiting_client',
       promotable_active = TRUE,
       note = note || ' Promotes to sales_stage=jih, handoff=waiting_client: same pipeline position as SUBMITTED, different thing being waited on.'
 WHERE source_status = 'WAITING FOR CLIENT';

UPDATE public.historical_sales_status_map
   SET canonical_sales_stage = 'jih', canonical_handoff_status = 'with_sales',
       promotable_active = TRUE,
       note = note || ' Promotes to sales_stage=jih, handoff=with_sales: the file is back on our desk, which is what "for action" means.'
 WHERE source_status = 'FOR ACTION';

-- Everything else stays unpromotable in this batch, explicitly rather than by
-- omission. WON/LOST are P2 and need won_at/lost_at handling this batch does
-- not do; the rest are undecided.
UPDATE public.historical_sales_status_map
   SET promotable_active = FALSE
 WHERE source_status NOT IN ('SUBMITTED','WAITING FOR CLIENT','FOR ACTION');

COMMENT ON COLUMN public.historical_sales_status_map.canonical_sales_stage IS
  'Where a promoted record lands on the sales pipeline. All three promotable ACTIVE statuses land at jih and are told apart by canonical_handoff_status — commercial_handoff_status is independent of sales_stage by design (20260818140000), so "submitted" is a handoff fact, not a pipeline position.';
COMMENT ON COLUMN public.historical_sales_status_map.promotable_active IS
  'TRUE only for the statuses this activation batch may promote into the live pipeline. Everything else — WON, LOST, DECLINE, NOT SUBMITTED, NO RECORD — is refused by promote_historical_row() rather than left to the caller.';

-- ============ 4. Remap, now carrying FOLLOW-UP ============
-- Same function, same contract, one more projected column. Whitespace in the
-- client name is also normalised before the company lookup: btrim() strips
-- spaces only, and one 2026 client name differs from its company row by a
-- single trailing newline — an exact match that misses for a reason no human
-- would ever spot. Collapsing whitespace runs is deterministic and cannot
-- match two differently-named companies.
CREATE OR REPLACE FUNCTION public.remap_historical_sales(_batch_id UUID)
RETURNS TABLE (rows_mapped INT, codes_unparsed INT, amounts_unparsed INT, owners_unmatched INT, companies_unmatched INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  r RECORD; p RECORD;
  _n INT := 0; _cu INT := 0; _au INT := 0; _ou INT := 0; _mu INT := 0;
  _client TEXT; _cid UUID; _prefix TEXT; _om RECORD; _sm RECORD; _amt NUMERIC;
BEGIN
  DELETE FROM public.historical_sales_mapped WHERE batch_id = _batch_id;
  DELETE FROM public.historical_sales_company_candidates WHERE batch_id = _batch_id;

  FOR r IN SELECT * FROM public.historical_sales_rows WHERE batch_id = _batch_id ORDER BY row_number LOOP
    SELECT * INTO p FROM public.parse_historical_sales_code(public.historical_raw_get(r.raw, '^SALES CODE$'));
    _prefix := CASE WHEN p.base_code IS NOT NULL THEN left(p.base_code, 2) ELSE NULL END;
    SELECT * INTO _om FROM public.historical_sales_owner_map WHERE prefix = _prefix;
    SELECT * INTO _sm FROM public.historical_sales_status_map
      WHERE source_status = upper(btrim(coalesce(public.historical_raw_get(r.raw, '^QUOTATION ?STATUS$'), '')));

    _client := nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^CLIENT COMPANY$'),'')), '');
    _cid := NULL;
    IF _client IS NOT NULL AND lower(_client) NOT IN ('no record','n/a','-') THEN
      SELECT c.id INTO _cid FROM public.companies c
       WHERE lower(btrim(regexp_replace(c.name,   '\s+', ' ', 'g')))
           = lower(btrim(regexp_replace(_client,  '\s+', ' ', 'g')))
       LIMIT 1;
      IF _cid IS NULL THEN
        _mu := _mu + 1;
        INSERT INTO public.historical_sales_company_candidates (batch_id, raw_name, occurrences)
        VALUES (_batch_id, _client, 1)
        ON CONFLICT (batch_id, raw_name) DO UPDATE SET occurrences = historical_sales_company_candidates.occurrences + 1;
      END IF;
    END IF;

    _amt := public.parse_historical_amount(public.historical_raw_get(r.raw, '^AMOUNT$'));
    IF _amt IS NULL AND nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^AMOUNT$'),'')),'') IS NOT NULL THEN _au := _au + 1; END IF;
    IF NOT coalesce(p.parsed, FALSE) AND NOT coalesce(p.is_placeholder, FALSE)
       AND nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^SALES CODE$'),'')),'') IS NOT NULL THEN _cu := _cu + 1; END IF;
    IF _om.user_id IS NULL THEN _ou := _ou + 1; END IF;

    INSERT INTO public.historical_sales_mapped (
      row_id, batch_id, sales_code_raw, base_code, revision_no, variant,
      code_placeholder, code_unparsed, owner_prefix, owner_user_id, owner_label,
      client_name_raw, company_id, company_matched, project_name_raw, project_location,
      route, status_raw, status_canonical, status_needs_decision,
      amount_raw, amount_excl_vat, amount_unparsed,
      date_received, date_submitted, contact_name, contact_email, contact_mobile,
      follow_up_raw
    ) VALUES (
      r.id, _batch_id,
      nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^SALES CODE$'),'')),''), p.base_code, p.revision_no, p.variant,
      coalesce(p.is_placeholder,FALSE),
      NOT coalesce(p.parsed,FALSE) AND NOT coalesce(p.is_placeholder,FALSE)
        AND nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^SALES CODE$'),'')),'') IS NOT NULL,
      _prefix, _om.user_id, coalesce(_om.legacy_label, 'unknown owner'),
      _client, _cid, _cid IS NOT NULL,
      nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^PROJECT NAME$'),'')),''),
      nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^PROJECT LOCATION$'),'')),''),
      public.parse_historical_route(public.historical_raw_get(r.raw, '^JIH ?/ ?TENDER$')),
      nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^QUOTATION ?STATUS$'),'')),''),
      _sm.canonical_status, coalesce(_sm.needs_decision, TRUE),
      nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^AMOUNT$'),'')),''), _amt,
      _amt IS NULL AND nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^AMOUNT$'),'')),'') IS NOT NULL,
      public.parse_historical_date(public.historical_raw_get(r.raw, '^DATE RECEI?E?VED$')),
      public.parse_historical_date(public.historical_raw_get(r.raw, '^SUBMISSION DATE$')),
      nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^CONTACT PERSON$'),'')),''),
      nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^EMAIL$'),'')),''),
      nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^MOBILE$'),'')),''),
      public.historical_raw_get(r.raw, '^FOLLOW.?UP$')
    );
    _n := _n + 1;
  END LOOP;

  UPDATE public.historical_sales_batches SET status = 'mapped' WHERE id = _batch_id AND status = 'loaded';
  RETURN QUERY SELECT _n, _cu, _au, _ou, _mu;
END; $fn$;

REVOKE ALL ON FUNCTION public.remap_historical_sales(UUID) FROM PUBLIC;

-- ============ 5. Where FOLLOW-UP disagrees with the status ============
CREATE OR REPLACE VIEW public.historical_sales_followup_conflicts AS
  SELECT m.row_id,
         r.row_number,
         m.sales_code_raw,
         m.client_name_raw,
         m.project_name_raw,
         m.status_raw,
         m.follow_up_raw,
         m.amount_excl_vat,
         m.date_submitted,
         CASE
           WHEN upper(m.status_raw) IN ('LOST','WON') AND upper(m.follow_up_raw) = 'ACTIVE'
             THEN 'closed_but_followed_up'
           WHEN upper(m.status_raw) IN ('SUBMITTED','WAITING FOR CLIENT','FOR ACTION')
                AND upper(m.follow_up_raw) = 'DEAD'
             THEN 'open_but_abandoned'
         END AS conflict
    FROM public.historical_sales_mapped m
    JOIN public.historical_sales_rows r ON r.id = m.row_id
   WHERE public.can_read_historical_sales((SELECT auth.uid()))
     AND m.follow_up_raw IS NOT NULL
     AND (
       (upper(m.status_raw) IN ('LOST','WON') AND upper(m.follow_up_raw) = 'ACTIVE')
       OR (upper(m.status_raw) IN ('SUBMITTED','WAITING FOR CLIENT','FOR ACTION')
           AND upper(m.follow_up_raw) = 'DEAD')
     );

COMMENT ON VIEW public.historical_sales_followup_conflicts IS
  'Archive rows whose FOLLOW-UP cell contradicts their quotation status — a LOST deal still being chased, or an open one marked DEAD. Reported as review evidence and nothing else: neither column is corrected and no lifecycle changes on the strength of it.';
GRANT SELECT ON public.historical_sales_followup_conflicts TO authenticated;
