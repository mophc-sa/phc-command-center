-- =========================================================
-- PHASE 12 — lead and opportunity discovery.
--
-- WHAT ALREADY EXISTED
-- --------------------
-- leads (source, source_url, lead_stage, duplicate_of, lead_score,
-- converted_opportunity_id, rejection_reason, archive fields), lead_scores,
-- source_registry, evidence_sources, inbox_items. Ingestion and scoring are
-- built. None of it is rebuilt.
--
-- FOUR THINGS WERE MISSING, AND THEY ARE THE CONTROLS
-- ---------------------------------------------------
-- 1. source_registry.approved_for_agent_use existed and enforced NOTHING. An
--    agent could ingest from any source at all — an unvetted site, a stale
--    scrape — and the row would look exactly like one from a sanctioned feed.
--    A flag nobody checks is documentation, not governance.
--
-- 2. duplicate_of existed with no detection behind it. Nothing normalised a
--    project name or a contractor guess, so the same tender arriving from two
--    feeds produced two leads, two owners and two people ringing the same
--    contractor.
--
--    DETECTION, NOT BLOCKING — the same call made for vendors in 7B, for the
--    same reason. Two different phases of one masterplan legitimately share a
--    project name. A hard block would leave discovery unable to record the
--    second one, and the workaround would be to misspell it on purpose.
--
-- 3. Promotion into the CRM had no gate. converted_opportunity_id was a plain
--    column: nothing required a human to have looked at the lead first, and
--    nothing stopped the same lead being converted twice into two opportunities.
--
-- 4. leads and lead_scores were both SELECT USING (is_active_user()) — the
--    seventh and eighth blanket reads found in this project. Narrowed to the
--    sales contributors, which is deliberately wider than one owner: the point
--    of a shared lead pool is that two people do not chase the same contractor.
--
-- ALSO CLOSED HERE: `recommendations`
-- -----------------------------------
-- The older sibling of ai_recommendations, flagged during Phase 11. It was
-- blanket-readable, client-insertable AND deletable. It holds no rows and is
-- superseded by ai_recommendations, so it is scoped, made undeletable, and
-- marked deprecated by comment rather than dropped — dropping a table is a
-- data decision even when the table is empty.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. An agent may only ingest from an approved source ============
CREATE OR REPLACE FUNCTION public.source_is_approved_for_agents(_source TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.source_registry s
     WHERE s.approved_for_agent_use
       AND (lower(btrim(s.vault_path)) = lower(btrim(_source))
            OR lower(btrim(s.source_type)) = lower(btrim(_source)))
  );
$$;

COMMENT ON FUNCTION public.source_is_approved_for_agents IS
  'Whether a named source is sanctioned for automated ingestion. Matches the registry by vault_path or source_type so a feed can be approved individually or by class.';

-- ============ 2. Duplicate DETECTION ============
CREATE OR REPLACE FUNCTION public.normalize_lead_key(_project_name TEXT, _location TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT nullif(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(coalesce(_project_name,'') || ' ' || coalesce(_location,'')),
        -- Arabic diacritics and tatweel carry no identity.
        '[ـً-ْ]', '', 'g'),
      -- Words that appear in half of all project names and distinguish nothing.
      '\m(project|projects|phase|package|pkg|contract|works|development|tender|the|of|for|at|in)\M|[[:punct:]]', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;

COMMENT ON FUNCTION public.normalize_lead_key IS
  'Collapses a project name and location to a comparison key for duplicate DETECTION only. Strips filler words, so two phases of one masterplan collide on purpose — a candidate to review, never a rejection.';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT
  GENERATED ALWAYS AS (public.normalize_lead_key(project_name, location)) STORED;

-- Non-unique. This index makes the lookup fast; it enforces nothing.
CREATE INDEX IF NOT EXISTS leads_dedupe_key_idx ON public.leads (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON COLUMN public.leads.dedupe_key IS
  'Generated comparison key. Exists so two spellings of one project can be FOUND, not so one can be refused. Never displayed.';

-- `leads.duplicate_of` references OPPORTUNITIES, not leads — despite the name.
-- So it records "this lead is already a live deal", and there was no way at all
-- to say "this lead duplicates that other lead", which is what the detection
-- above is for. Both concepts are real and they mean different things:
--
--   duplicate_of          -> the pipeline already has this. Do not convert.
--   duplicate_of_lead_id  -> two feeds found the same thing. Merge them.
--
-- Adding the missing one rather than re-pointing the existing FK: repointing
-- would silently change the meaning of any row already using it.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS duplicate_of_lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.leads.duplicate_of_lead_id IS
  'The other LEAD this one duplicates. Distinct from duplicate_of, which points at an opportunity and means the pipeline already has it.';
COMMENT ON COLUMN public.leads.duplicate_of IS
  'The OPPORTUNITY this lead turns out to already be. Not a lead-to-lead link — see duplicate_of_lead_id.';

CREATE INDEX IF NOT EXISTS leads_duplicate_of_lead_idx ON public.leads (duplicate_of_lead_id)
  WHERE duplicate_of_lead_id IS NOT NULL;

CREATE OR REPLACE VIEW public.lead_duplicate_candidates AS
  SELECT l.dedupe_key,
         count(*)                                  AS lead_count,
         array_agg(l.id ORDER BY l.created_at)     AS lead_ids,
         array_agg(l.project_name ORDER BY l.created_at) AS project_names,
         array_agg(DISTINCT l.source)              AS sources,
         bool_or(l.duplicate_of IS NOT NULL
                 OR l.duplicate_of_lead_id IS NOT NULL) AS already_linked
    FROM public.leads l
   WHERE l.dedupe_key IS NOT NULL
     AND l.archived_at IS NULL
     AND public.is_sales_contributor((SELECT auth.uid()))
   GROUP BY l.dedupe_key
  HAVING count(*) > 1;

COMMENT ON VIEW public.lead_duplicate_candidates IS
  'Leads whose project and location normalise identically — a prompt to review, never a constraint. Filler-word stripping means two phases of one masterplan legitimately appear here, so nothing acts on this automatically.';
GRANT SELECT ON public.lead_duplicate_candidates TO authenticated;

-- ============ 3. Promotion into the CRM is gated ============
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

COMMENT ON COLUMN public.leads.reviewed_by IS
  'The person who looked at this lead before it became an opportunity. Required to convert: discovery proposes, a human decides.';

-- One lead becomes at most one opportunity, and one opportunity comes from at
-- most one lead. Without this a re-run of the converter silently forks the
-- pipeline into duplicate deals.
CREATE UNIQUE INDEX IF NOT EXISTS leads_converted_once
  ON public.leads (converted_opportunity_id) WHERE converted_opportunity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.lead_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leads are archived or rejected, not deleted — a discarded lead is evidence the source was searched. | تُؤرشف العملاء المحتملون ولا يُحذفون.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- An automated ingest must cite a sanctioned source. A human entering a lead
  -- by hand is exercising judgement and is not bound by the registry; auth.uid()
  -- being NULL is how the orchestrator and cron reach this table.
  IF TG_OP = 'INSERT' AND _uid IS NULL THEN
    IF NOT public.source_is_approved_for_agents(NEW.source) THEN
      RAISE EXCEPTION 'Automated ingestion refused: % is not approved_for_agent_use in source_registry. | المصدر غير معتمد للاستخدام الآلي.',
        coalesce(NEW.source, '(no source)') USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(NEW.created_by, _uid);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- ---- conversion ----
  IF NEW.converted_opportunity_id IS NOT NULL
     AND OLD.converted_opportunity_id IS NULL THEN

    IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'A lead must be reviewed by a person before it becomes an opportunity. | يجب مراجعة العميل المحتمل قبل تحويله.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Converting a known duplicate is how the same tender enters the pipeline
    -- twice under two owners. Both kinds of duplicate bar it: one says the
    -- pipeline already has this, the other says another lead does.
    IF NEW.duplicate_of IS NOT NULL OR NEW.duplicate_of_lead_id IS NOT NULL THEN
      RAISE EXCEPTION 'This lead is marked a duplicate — convert the original instead. | هذا العميل مكرر.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Conversion is one-way. Re-pointing it at a different opportunity after the
  -- fact would rewrite where a deal came from.
  IF OLD.converted_opportunity_id IS NOT NULL
     AND NEW.converted_opportunity_id IS DISTINCT FROM OLD.converted_opportunity_id THEN
    RAISE EXCEPTION 'A converted lead cannot be re-pointed at another opportunity. | لا يُعاد توجيه عميل محوّل.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A lead cannot be its own duplicate; that makes the chain unwalkable.
  IF NEW.duplicate_of_lead_id = NEW.id THEN
    RAISE EXCEPTION 'A lead cannot be a duplicate of itself.' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.reviewed_by IS NOT NULL AND OLD.reviewed_by IS NULL THEN
    NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS leads_guard ON public.leads;
CREATE TRIGGER leads_guard BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_guard();
DROP TRIGGER IF EXISTS leads_no_delete ON public.leads;
CREATE TRIGGER leads_no_delete BEFORE DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_guard();

-- ============ 4. Close the blanket reads ============
-- Deliberately is_sales_contributor and not the owner alone: a shared lead
-- pool only prevents duplicate outreach if the team can see it. It excludes
-- viewer, system_admin, estimation and finance, none of whom prospect.
DROP POLICY IF EXISTS "Leads readable" ON public.leads;
DROP POLICY IF EXISTS "Leads readable by sales contributors" ON public.leads;
CREATE POLICY "Leads readable by sales contributors"
  ON public.leads FOR SELECT TO authenticated
  USING (public.is_sales_contributor((SELECT auth.uid())));

DROP POLICY IF EXISTS "lead_scores_readable" ON public.lead_scores;
DROP POLICY IF EXISTS "Lead scores readable" ON public.lead_scores;
DROP POLICY IF EXISTS "Lead scores readable by sales contributors" ON public.lead_scores;
CREATE POLICY "Lead scores readable by sales contributors"
  ON public.lead_scores FOR SELECT TO authenticated
  USING (public.is_sales_contributor((SELECT auth.uid())));

-- ============ 5. The `recommendations` sibling, flagged in Phase 11 ============
DROP POLICY IF EXISTS "Recommendations readable" ON public.recommendations;
DROP POLICY IF EXISTS "Recommendations readable by the record's people" ON public.recommendations;
CREATE POLICY "Recommendations readable by the record's people"
  ON public.recommendations FOR SELECT TO authenticated
  USING (
    (related_opportunity_id IS NOT NULL
     AND public.can_read_boq(related_opportunity_id, (SELECT auth.uid())))
    OR suggested_owner_id = (SELECT auth.uid())
    OR public.is_pipeline_operator((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Recommendations deletable by commercial manager" ON public.recommendations;
DROP TRIGGER IF EXISTS recommendations_no_delete ON public.recommendations;
CREATE TRIGGER recommendations_no_delete BEFORE DELETE ON public.recommendations
  FOR EACH ROW EXECUTE FUNCTION public.refuse_delete();

COMMENT ON TABLE public.recommendations IS
  'DEPRECATED since Phase 11 — superseded by ai_recommendations, which carries the immutability and decision trail. Kept because dropping a table is a data decision even when it is empty. Read scope and delete protection brought in line with ai_recommendations in Phase 12.';

-- ============ 6. What discovery actually looks at ============
CREATE OR REPLACE VIEW public.lead_review_queue AS
  SELECT l.id, l.project_name, l.location, l.source, l.source_url,
         l.main_contractor_guess, l.lead_stage, l.signage_potential,
         l.estimated_value, l.lead_score, l.owner_id,
         (l.duplicate_of IS NOT NULL
          OR l.duplicate_of_lead_id IS NOT NULL)          AS is_marked_duplicate,
         EXISTS (SELECT 1 FROM public.lead_duplicate_candidates d
                  WHERE d.dedupe_key = l.dedupe_key)      AS has_duplicate_candidates,
         l.reviewed_by IS NOT NULL                        AS reviewed,
         public.source_is_approved_for_agents(l.source)   AS source_approved,
         l.created_at,
         round(extract(epoch FROM now() - l.created_at) / 86400, 1) AS days_waiting
    FROM public.leads l
   WHERE l.converted_opportunity_id IS NULL
     AND l.archived_at IS NULL
     AND public.is_sales_contributor((SELECT auth.uid()));

COMMENT ON VIEW public.lead_review_queue IS
  'Unconverted, unarchived leads with the two things a reviewer needs before promoting one: whether it looks like a duplicate, and whether its source is sanctioned. source_approved is reported for human-entered leads too — not as a bar, but so the reviewer knows what they are looking at.';
GRANT SELECT ON public.lead_review_queue TO authenticated;
