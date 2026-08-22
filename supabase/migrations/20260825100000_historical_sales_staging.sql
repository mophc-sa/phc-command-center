-- =========================================================
-- HISTORICAL SALES STAGING — 679 quotation records, landed safely.
--
-- WHAT THIS IS FOR
-- ----------------
-- The sales team needs their history searchable on Sunday. The history is a
-- spreadsheet: `PHC Quotation List - Cleaned - Sheet1.csv`, 681 rows = 2 header
-- bands + 679 records, 23 columns, 2022-2026.
--
-- It cannot go straight into `quotations` and `opportunities`. Measured against
-- production first:
--
--   * 317 distinct client companies, only 95 match an existing company (30%)
--   * 580 distinct project names against 36 projects
--   * owner initials OM/BA/FA/AH/AD/AN/AB/NI/DE/MB — only FA maps to a real
--     account; the other nine cover roughly 488 of the 653 coded rows
--   * 653 sales codes, 560 distinct, 40 codes duplicated across 133 rows, and
--     48 of those are bare prefixes like `BA` used as placeholders
--   * three status values (DECLINE, FOR ACTION, ON-HOLD) have no enum home
--
-- Forcing that into canonical tables would invent 222 companies, 544 projects
-- and a fake user per orphan prefix — and an ownerless opportunity is invisible
-- under RLS, so most of it would land unusable anyway. So this is a staging
-- layer: the team can search all 679 records from day one, and the promotion
-- into canonical entities happens later, once the mappings are approved.
--
-- THE SHAPE
-- ---------
--   historical_sales_batches   one row per file load, with a checksum
--   historical_sales_rows      the raw record, every original column, IMMUTABLE
--   historical_sales_mapped    what the deterministic rules derived, RE-RUNNABLE
--   *_owner_map / *_status_map the rules themselves, as data
--   *_company_candidates       unmatched names, for review, never auto-created
--
-- Raw and derived are separate tables on purpose. The raw row is written once
-- and a trigger refuses every later UPDATE and DELETE, so "preserve the source"
-- is enforced rather than promised. The derived row can be thrown away and
-- rebuilt as the rules improve, which is what makes the mapping reviewable
-- instead of a one-shot guess.
--
-- READ-ONLY, AND WHY
-- ------------------
-- No UPDATE or DELETE policy exists on any table here. Historical records are
-- a record of what happened; editing them in place would make the archive
-- disagree with the spreadsheet it came from, and the spreadsheet is the thing
-- people will check it against. Corrections happen by promoting a record into a
-- canonical entity and editing that.
--
-- SECURITY
-- --------
-- Amounts are commercial data, so the read set follows D24: the sales team,
-- estimation and finance. Not `viewer`, not `system_admin` alone.
-- `can_view_all_sales_data()` is not reused — it admits both.
--
-- Row-level ownership is deliberately NOT used here. Nine of ten owner
-- prefixes have no account, so an owner-scoped policy would hide almost the
-- whole archive from everyone. The archive is team-wide by nature; the
-- per-deal ownership rules apply to canonical entities, which is where they
-- belong.
--
-- NOTHING IS IMPORTED BY THIS MIGRATION. It creates the tables, the rules and
-- the views. Loading the file is a separate, approved step.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Who may read the archive ============
CREATE OR REPLACE FUNCTION public.can_read_historical_sales(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND public.is_active_user(_user_id)
     AND public.has_any_role(_user_id, ARRAY[
       'salesperson','sales_ops','bd_manager','sales_manager',
       'estimation_manager','finance_manager',
       'managing_director','general_manager','ceo'
     ]::public.app_role[]);
$$;

COMMENT ON FUNCTION public.can_read_historical_sales IS
  'Read gate for the historical sales archive: the sales team plus estimation and finance. Excludes viewer and system_admin — can_view_all_sales_data() admits both and is not reused (D24). Not owner-scoped: nine of ten legacy owner prefixes have no account, so owner scoping would hide the archive from everyone.';

-- ============ 2. Batches ============
CREATE TABLE IF NOT EXISTS public.historical_sales_batches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file    TEXT NOT NULL,
  -- sha256 of the file. Two loads of the same bytes are the same batch, and a
  -- silently edited spreadsheet is a different one.
  source_sha256  TEXT,
  source_rows    INTEGER,
  header_rows    INTEGER NOT NULL DEFAULT 2,
  notes          TEXT,
  loaded_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  loaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL DEFAULT 'loaded'
    CHECK (status IN ('loaded','mapped','reviewed','promoted','superseded')),
  CONSTRAINT historical_sales_batches_rows_sane CHECK (source_rows IS NULL OR source_rows >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS historical_sales_batches_sha
  ON public.historical_sales_batches (source_sha256) WHERE source_sha256 IS NOT NULL;

-- ============ 3. The raw record — every original column, immutable ============
CREATE TABLE IF NOT EXISTS public.historical_sales_rows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL REFERENCES public.historical_sales_batches(id) ON DELETE RESTRICT,
  row_number    INTEGER NOT NULL,

  -- All 23 columns exactly as they appeared, keys included — `DATE RECEIEVED`
  -- keeps its typo and `QUOTATION \nSTATUS` keeps its newline. Renaming them
  -- here would break the tie back to the spreadsheet, which is the only thing
  -- anyone can check this against.
  raw           JSONB NOT NULL,

  loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT historical_sales_rows_unique UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS historical_sales_rows_batch ON public.historical_sales_rows (batch_id);
-- Free-text search over the whole original record, which is what "find that
-- job from 2023" actually looks like.
CREATE INDEX IF NOT EXISTS historical_sales_rows_raw_gin ON public.historical_sales_rows USING gin (raw);

CREATE OR REPLACE FUNCTION public.historical_rows_are_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical sales rows are the source record and cannot be % — re-run the mapping, or promote the record and edit the canonical entity. | السجل التاريخي مصدر ولا يُعدَّل.', lower(TG_OP)
    USING ERRCODE = 'insufficient_privilege';
END; $$;

DROP TRIGGER IF EXISTS historical_sales_rows_immutable ON public.historical_sales_rows;
CREATE TRIGGER historical_sales_rows_immutable
  BEFORE UPDATE OR DELETE ON public.historical_sales_rows
  FOR EACH ROW EXECUTE FUNCTION public.historical_rows_are_immutable();

-- ============ 4. The rules, as data ============
-- Owner prefixes. Deliberately allows a NULL user_id with a label: an owner we
-- cannot identify is recorded as a legacy label, never as an invented account.
CREATE TABLE IF NOT EXISTS public.historical_sales_owner_map (
  prefix        TEXT PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  legacy_label  TEXT NOT NULL,
  note          TEXT,
  CONSTRAINT owner_map_prefix_shape CHECK (prefix ~ '^[A-Z]{2}$')
);

COMMENT ON TABLE public.historical_sales_owner_map IS
  'Sales-code prefix to owner. user_id NULL means the person has no account and the record carries legacy_label instead — no fake users are ever created to satisfy a foreign key.';

INSERT INTO public.historical_sales_owner_map (prefix, user_id, legacy_label, note) VALUES
  ('FA', NULL, 'FA — Faisal Abdulkadhar', 'Matches an active account; link the user_id once confirmed by the business.'),
  ('OM', NULL, 'OM — legacy owner',  '174 records. No matching account.'),
  ('BA', NULL, 'BA — legacy owner',  '96 records. No matching account.'),
  ('AH', NULL, 'AH — legacy owner',  '93 records. No matching account.'),
  ('AD', NULL, 'AD — legacy owner',  '73 records. No matching account.'),
  ('AN', NULL, 'AN — legacy owner',  '61 records. No matching account.'),
  ('AB', NULL, 'AB — legacy owner',  '40 records. No matching account.'),
  ('NI', NULL, 'NI — legacy owner',  '12 records. No matching account.'),
  ('DE', NULL, 'DE — legacy owner',  '2 records. No matching account.'),
  ('MB', NULL, 'MB — legacy owner',  '2 records. No matching account.')
ON CONFLICT (prefix) DO NOTHING;

-- Status. Every value observed in the file, mapped explicitly. Three have no
-- enum equivalent and are recorded as such rather than forced into a near-miss.
CREATE TABLE IF NOT EXISTS public.historical_sales_status_map (
  source_status   TEXT PRIMARY KEY,
  canonical_status TEXT,
  is_terminal     BOOLEAN NOT NULL DEFAULT FALSE,
  needs_decision  BOOLEAN NOT NULL DEFAULT FALSE,
  note            TEXT NOT NULL
);

INSERT INTO public.historical_sales_status_map (source_status, canonical_status, is_terminal, needs_decision, note) VALUES
  ('SUBMITTED',          'submitted',  FALSE, FALSE, '330 records. Direct match.'),
  ('LOST',               'lost',       TRUE,  FALSE, '159 records. Direct match.'),
  ('WON',                'won',        TRUE,  FALSE, '47 records. Direct match.'),
  ('WAITING FOR CLIENT', 'follow_up',  FALSE, FALSE, '23 records. Closest enum value.'),
  ('NOT SUBMITTED',      'draft',      FALSE, FALSE, '17 records. Never issued.'),
  ('DECLINE',            NULL,         TRUE,  TRUE,  '75 records. No enum value. Probably lost-by-client-decision, but declined-by-us is a different outcome and the file does not say which.'),
  ('FOR ACTION',         NULL,         FALSE, TRUE,  '14 records. No enum value. Reads as a to-do rather than a quotation state.'),
  ('ON-HOLD',            NULL,         FALSE, TRUE,  '1 record. No enum value; the pipeline has on_hold for opportunities, not quotations.'),
  ('NO RECORD',          NULL,         FALSE, TRUE,  '1 record. Explicit absence.')
ON CONFLICT (source_status) DO NOTHING;

-- ============ 5. Deterministic parsing ============
-- Dates. The file is mixed: 977 values prove month-first (a second component
-- above 12) and 4 prove day-first (`16/07/23`, `28/9/25`, `25/9/25`). 656 are
-- ambiguous. So month-first is the rule, day-first is applied only where the
-- value proves it, and anything else returns NULL rather than a guess.
CREATE OR REPLACE FUNCTION public.parse_historical_date(_v TEXT)
RETURNS DATE
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE a INT; b INT; y INT; m TEXT[];
BEGIN
  IF _v IS NULL THEN RETURN NULL; END IF;
  m := regexp_match(btrim(_v), '^(\d{1,2})/(\d{1,2})/(\d{2,4})$');
  IF m IS NULL THEN RETURN NULL; END IF;      -- 'No record', '28-May', 'AWARDED', '/'
  a := m[1]::INT; b := m[2]::INT; y := m[3]::INT;
  IF y < 100 THEN y := 2000 + y; END IF;
  IF a > 12 AND b <= 12 THEN
    RETURN make_date(y, b, a);                -- proves day-first
  ELSIF a <= 12 AND b <= 31 THEN
    RETURN make_date(y, a, b);                -- month-first, the dominant form
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;                                -- 2/30/2024 and friends
END; $$;

-- Amounts. 587 of 679 parse; the rest are text ('RATES ONLY', 'NO RECORD',
-- 'DECLINED', '-') or hold two figures in one cell. Text returns NULL — a
-- coerced zero would silently understate the pipeline by whatever it hides.
CREATE OR REPLACE FUNCTION public.parse_historical_amount(_v TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE c TEXT;
BEGIN
  IF _v IS NULL THEN RETURN NULL; END IF;
  c := btrim(replace(replace(_v, ',', ''), ' ', ''));
  IF c = '' OR c !~ '^\d+(\.\d+)?$' THEN RETURN NULL; END IF;
  RETURN c::NUMERIC;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

-- Sales codes. Splits `AH25081-RV.02` into base + revision, and recognises the
-- placeholder codes (`BA`, `FA`, `OM`…) that are a prefix and nothing else —
-- 48 rows share five such values, and treating them as duplicates of each
-- other would merge unrelated jobs.
CREATE OR REPLACE FUNCTION public.parse_historical_sales_code(_v TEXT)
RETURNS TABLE (base_code TEXT, revision_no INTEGER, variant TEXT, is_placeholder BOOLEAN, parsed BOOLEAN)
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE s TEXT; m TEXT[];
BEGIN
  s := upper(btrim(coalesce(_v,'')));
  IF s = '' THEN RETURN QUERY SELECT NULL::TEXT, NULL::INT, NULL::TEXT, FALSE, FALSE; RETURN; END IF;
  IF s ~ '^[A-Z]{2}$' THEN
    RETURN QUERY SELECT s, NULL::INT, NULL::TEXT, TRUE, FALSE; RETURN;   -- bare prefix placeholder
  END IF;
  m := regexp_match(s, '^([A-Z]{2}\d{5})[-\s]*RV\.?\s*0*(\d+)$');
  IF m IS NOT NULL THEN
    RETURN QUERY SELECT m[1], m[2]::INT, NULL::TEXT, FALSE, TRUE; RETURN;
  END IF;
  m := regexp_match(s, '^([A-Z]{2}\d{5})[-\s]*R(\d+)$');                 -- -R1, -R4
  IF m IS NOT NULL THEN
    RETURN QUERY SELECT m[1], m[2]::INT, NULL::TEXT, FALSE, TRUE; RETURN;
  END IF;
  m := regexp_match(s, '^([A-Z]{2}\d{5})[-\s]+(.+)$');                   -- -A, -B, -Mockup, NS
  IF m IS NOT NULL THEN
    RETURN QUERY SELECT m[1], NULL::INT, btrim(m[2]), FALSE, TRUE; RETURN;
  END IF;
  m := regexp_match(s, '^([A-Z]{2}\d{5})$');
  IF m IS NOT NULL THEN
    RETURN QUERY SELECT m[1], NULL::INT, NULL::TEXT, FALSE, TRUE; RETURN;
  END IF;
  RETURN QUERY SELECT NULL::TEXT, NULL::INT, NULL::TEXT, FALSE, FALSE;   -- 199 oddities
END; $$;

-- Routing. Case and spelling drift only: JIH-DIRECT, JIH DIRECT,
-- JIH (CONSULTANT), TENDER/BAFO, NO INFO.
CREATE OR REPLACE FUNCTION public.parse_historical_route(_v TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _v IS NULL OR btrim(_v) = '' THEN NULL
    WHEN upper(_v) LIKE 'JIH%'    THEN 'jih'
    WHEN upper(_v) LIKE 'TENDER%' THEN 'tender'
    ELSE NULL
  END;
$$;

-- The header keys come from a spreadsheet and carry its whitespace: the status
-- column is literally `QUOTATION \nSTATUS` — a space, then a newline — and
-- `DATE RECEIEVED` carries its own typo. Hardcoding those exactly is how a
-- mapping silently returns blank for all 679 rows, which is what the first dry
-- run did. So keys are matched by pattern, not by literal.
CREATE OR REPLACE FUNCTION public.historical_raw_get(_raw JSONB, _pattern TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT nullif(btrim(v), '')
    FROM jsonb_each_text(_raw) AS e(k, v)
   WHERE regexp_replace(upper(e.k), '\s+', ' ', 'g') ~ _pattern
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.historical_raw_get IS
  'Reads a value from a raw archive row by matching the column name against a pattern, with runs of whitespace collapsed. Spreadsheet headers carry embedded newlines and typos; matching them literally is fragile.';

-- ============ 6. The derived row — re-runnable, never authoritative ============
CREATE TABLE IF NOT EXISTS public.historical_sales_mapped (
  row_id            UUID PRIMARY KEY REFERENCES public.historical_sales_rows(id) ON DELETE CASCADE,
  batch_id          UUID NOT NULL REFERENCES public.historical_sales_batches(id) ON DELETE RESTRICT,

  sales_code_raw    TEXT,
  base_code         TEXT,
  revision_no       INTEGER,
  variant           TEXT,
  code_placeholder  BOOLEAN NOT NULL DEFAULT FALSE,
  code_unparsed     BOOLEAN NOT NULL DEFAULT FALSE,

  owner_prefix      TEXT,
  owner_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_label       TEXT,

  client_name_raw   TEXT,
  company_id        UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  company_matched   BOOLEAN NOT NULL DEFAULT FALSE,

  project_name_raw  TEXT,
  project_location  TEXT,

  route             TEXT,
  status_raw        TEXT,
  status_canonical  TEXT,
  status_needs_decision BOOLEAN NOT NULL DEFAULT FALSE,

  amount_raw        TEXT,
  -- EXCLUDING VAT, matching the Phase 7 decision. The file states no currency
  -- and never mentions VAT, so this is the figure as written, assumed SAR.
  amount_excl_vat   NUMERIC(16,2),
  amount_unparsed   BOOLEAN NOT NULL DEFAULT FALSE,
  currency          TEXT NOT NULL DEFAULT 'SAR',

  date_received     DATE,
  date_submitted    DATE,

  contact_name      TEXT,
  contact_email     TEXT,
  contact_mobile    TEXT,

  mapped_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hsm_base_code  ON public.historical_sales_mapped (base_code);
CREATE INDEX IF NOT EXISTS hsm_owner      ON public.historical_sales_mapped (owner_prefix);
CREATE INDEX IF NOT EXISTS hsm_status     ON public.historical_sales_mapped (status_canonical);
CREATE INDEX IF NOT EXISTS hsm_company    ON public.historical_sales_mapped (company_id);
CREATE INDEX IF NOT EXISTS hsm_submitted  ON public.historical_sales_mapped (date_submitted DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS hsm_amount     ON public.historical_sales_mapped (amount_excl_vat DESC NULLS LAST);

-- Unmatched names, surfaced for review. Never auto-created — 222 of 317 client
-- names have no company, and inventing them would double the CRM.
CREATE TABLE IF NOT EXISTS public.historical_sales_company_candidates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL REFERENCES public.historical_sales_batches(id) ON DELETE RESTRICT,
  raw_name      TEXT NOT NULL,
  occurrences   INTEGER NOT NULL DEFAULT 1,
  suggested_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  suggestion_basis TEXT,
  resolved      BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT hscc_unique UNIQUE (batch_id, raw_name)
);

COMMENT ON TABLE public.historical_sales_company_candidates IS
  'Client names from the archive with no exact company match. A suggestion is a hint for a human, never an automatic link — 222 of 317 names are unmatched and auto-creating them would double the CRM.';

-- ============ 7. Mapping, re-runnable ============
CREATE OR REPLACE FUNCTION public.remap_historical_sales(_batch_id UUID)
RETURNS TABLE (rows_mapped INT, codes_unparsed INT, amounts_unparsed INT, owners_unmatched INT, companies_unmatched INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  r RECORD; p RECORD;
  _n INT := 0; _cu INT := 0; _au INT := 0; _ou INT := 0; _mu INT := 0;
  _client TEXT; _cid UUID; _prefix TEXT; _om RECORD; _sm RECORD; _amt NUMERIC;
BEGIN
  -- Derived rows are disposable; that is the point of keeping them separate.
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
       WHERE lower(btrim(c.name)) = lower(_client) LIMIT 1;
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
      date_received, date_submitted, contact_name, contact_email, contact_mobile
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
      nullif(btrim(coalesce(public.historical_raw_get(r.raw, '^MOBILE$'),'')),'')
    );
    _n := _n + 1;
  END LOOP;

  UPDATE public.historical_sales_batches SET status = 'mapped' WHERE id = _batch_id AND status = 'loaded';
  RETURN QUERY SELECT _n, _cu, _au, _ou, _mu;
END; $fn$;

REVOKE ALL ON FUNCTION public.remap_historical_sales(UUID) FROM PUBLIC;

COMMENT ON FUNCTION public.remap_historical_sales IS
  'Rebuilds the derived rows for one batch from the immutable raw rows. Idempotent and safe to re-run as the rules improve — it never touches historical_sales_rows, and it never creates a company, a user or a canonical entity.';

-- ============ 8. RLS — read-only by construction ============
ALTER TABLE public.historical_sales_batches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_sales_rows                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_sales_mapped              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_sales_owner_map           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_sales_status_map          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_sales_company_candidates  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['historical_sales_batches','historical_sales_rows','historical_sales_mapped',
                           'historical_sales_owner_map','historical_sales_status_map',
                           'historical_sales_company_candidates']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_read_historical_sales((SELECT auth.uid())))',
      t||'_read', t);
    -- SELECT only. No INSERT/UPDATE/DELETE policy anywhere: loading and
    -- remapping run as the service role, and the archive is read-only to users.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ============ 9. What the sales team actually uses ============
CREATE OR REPLACE VIEW public.historical_sales_search AS
  SELECT
    m.row_id,
    m.batch_id,
    m.sales_code_raw          AS sales_code,
    m.base_code,
    m.revision_no,
    m.variant,
    m.owner_prefix,
    m.owner_user_id,
    m.owner_label             AS owner,
    m.client_name_raw         AS client,
    m.company_id,
    m.company_matched,
    m.project_name_raw        AS project,
    m.project_location        AS location,
    m.route,
    m.status_raw              AS status,
    m.status_canonical,
    m.amount_excl_vat         AS amount,
    m.currency,
    m.date_received,
    m.date_submitted,
    m.contact_name,
    public.historical_raw_get(r.raw, '^EMAIL SUBJECT$') AS email_subject,
    public.historical_raw_get(r.raw, '^UPDATE LOG$')    AS update_log,
    r.row_number,
    -- One column to type into. Covers the seven fields people search by.
    lower(concat_ws(' ',
      m.sales_code_raw, m.base_code, m.client_name_raw, m.project_name_raw,
      m.project_location, m.owner_label, m.status_raw, m.contact_name
    ))                        AS search_text
  FROM public.historical_sales_mapped m
  JOIN public.historical_sales_rows   r ON r.id = m.row_id
 WHERE public.can_read_historical_sales((SELECT auth.uid()));

COMMENT ON VIEW public.historical_sales_search IS
  'The searchable archive: sales code, client, project, owner, status, amount and dates, plus a single search_text column. Runs as owner and gates itself with can_read_historical_sales — viewer and system_admin alone get nothing.';
GRANT SELECT ON public.historical_sales_search TO authenticated;

-- A record of what the mapping could not decide. Deliberately a view over the
-- derived rows, so it is always current rather than a snapshot that rots.
CREATE OR REPLACE VIEW public.historical_sales_quality AS
  SELECT
    m.batch_id,
    count(*)                                                    AS total_rows,
    count(*) FILTER (WHERE m.code_unparsed)                     AS codes_unparsed,
    count(*) FILTER (WHERE m.code_placeholder)                  AS codes_placeholder,
    count(*) FILTER (WHERE m.revision_no IS NOT NULL)           AS revisions,
    count(*) FILTER (WHERE m.amount_unparsed)                   AS amounts_unparsed,
    count(*) FILTER (WHERE m.amount_excl_vat IS NULL)           AS amounts_absent,
    count(*) FILTER (WHERE NOT m.company_matched
                       AND m.client_name_raw IS NOT NULL)       AS companies_unmatched,
    count(*) FILTER (WHERE m.owner_user_id IS NULL)             AS owners_legacy_only,
    count(*) FILTER (WHERE m.status_needs_decision)             AS statuses_needing_decision,
    count(*) FILTER (WHERE m.date_submitted IS NULL)            AS submission_dates_missing,
    count(*) FILTER (WHERE m.route IS NULL)                     AS route_unknown,
    sum(m.amount_excl_vat)                                      AS total_amount_excl_vat
  FROM public.historical_sales_mapped m
 WHERE public.can_read_historical_sales((SELECT auth.uid()))
 GROUP BY m.batch_id;

COMMENT ON VIEW public.historical_sales_quality IS
  'Live data-quality counts per batch. A view rather than a stored report so it cannot disagree with the rows it describes after a remap.';
GRANT SELECT ON public.historical_sales_quality TO authenticated;
