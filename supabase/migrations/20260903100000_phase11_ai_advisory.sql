-- =========================================================
-- PHASE 11 — AI sales assistant, advisory only.
--
-- WHAT ALREADY EXISTED
-- --------------------
-- A lot: ai_recommendations, recommendations, agent_runs, ai_agent_requests,
-- ai_agent_outputs, ai_agent_runs, ai_agent_trace_events, ai_agent_feedback,
-- ai_evidence_items. Generation, tracing and evidence are built. None of that
-- is rebuilt here.
--
-- WHAT WAS WRONG WITH IT
-- ----------------------
-- 1. ai_recommendations carried exactly ONE policy:
--
--      ai_recommendations_readable  SELECT  USING (is_active_user(auth.uid()))
--
--    Every active user — viewer and system_admin included — could read every
--    AI recommendation on every deal in the company, with its rationale and
--    its missing_data list. This is the sixth table in this project found with
--    the same blanket read, and the most revealing of them: a recommendation
--    names the deal, the risk and what the model thinks we should do about it.
--
-- 2. There was no INSERT, UPDATE or DELETE policy at all. The absence of
--    INSERT is correct and is kept — generation belongs to the orchestrator
--    running as the service role, which is the single door AI output comes
--    through. But the absence of UPDATE meant `status` existed and NOBODY
--    COULD CHANGE IT. Advice could be produced and never accepted, dismissed
--    or answered. The queue was write-once and read-only forever.
--
-- ADVISORY MEANS THE ADVICE CANNOT BE EDITED EITHER
-- -------------------------------------------------
-- "AI advisory only" is usually read as "the AI must not write to the deal".
-- That is half of it. The other half is that a person must not be able to
-- rewrite what the AI said. If the recommendation text is editable, then after
-- the fact nobody can tell whether the model warned about a risk or somebody
-- typed the warning in once it materialised. So the AI-authored fields are
-- immutable from creation, and a human may only add a decision beside them.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- -------------------------------
-- It writes to no canonical table and installs no trigger that would. Accepting
-- a recommendation records a decision; it does not apply anything. Applying is
-- a human action through the normal, already-audited write path, so the deal's
-- history shows a person changed it and this table shows what they were
-- looking at when they did.
--
-- opportunities.score / agent_recommendation / agent_reasoning are written
-- directly by the existing scoring path. That predates this phase, is NOT
-- changed here, and is reported as a finding rather than altered — narrowing
-- it is a behaviour change to a shipped feature.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. A decision can be recorded beside the advice ============
ALTER TABLE public.ai_recommendations
  ADD COLUMN IF NOT EXISTS decided_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_note TEXT;

-- The table holds no rows yet, so a vocabulary can be pinned now for free.
ALTER TABLE public.ai_recommendations DROP CONSTRAINT IF EXISTS ai_recommendations_status_known;
ALTER TABLE public.ai_recommendations ADD CONSTRAINT ai_recommendations_status_known
  CHECK (status IN ('open','accepted','dismissed','superseded','actioned'));

ALTER TABLE public.ai_recommendations DROP CONSTRAINT IF EXISTS ai_recommendations_decided_is_stamped;
ALTER TABLE public.ai_recommendations ADD CONSTRAINT ai_recommendations_decided_is_stamped
  CHECK (status = 'open' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL));

-- Dismissing advice without saying why destroys the only signal that tells you
-- whether the model is useful.
ALTER TABLE public.ai_recommendations DROP CONSTRAINT IF EXISTS ai_recommendations_dismissal_explained;
ALTER TABLE public.ai_recommendations ADD CONSTRAINT ai_recommendations_dismissal_explained
  CHECK (status <> 'dismissed' OR btrim(coalesce(decision_note,'')) <> '');

COMMENT ON COLUMN public.ai_recommendations.decision_note IS
  'Why a person accepted or dismissed this. Required on dismissal: without it there is no way to tell a model that is wrong from a model nobody reads.';

-- ============ 2. Who may see one recommendation ============
-- Branches on the entity it is about, the same shape as
-- document_entity_grants(). entity_type is free text here, so anything
-- unrecognised returns FALSE — a new agent pointing at a new entity kind
-- grants nothing until someone adds the branch deliberately.
CREATE OR REPLACE FUNCTION public.can_read_ai_recommendation(
  _entity_type TEXT, _entity_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF _user_id IS NULL OR NOT public.is_active_user(_user_id) THEN
    RETURN FALSE;
  END IF;

  -- Advice with no subject is infrastructure noise, not deal information; it
  -- reaches the pipeline and nobody else.
  IF _entity_id IS NULL OR _entity_type IS NULL THEN
    RETURN public.is_pipeline_operator(_user_id);
  END IF;

  CASE lower(_entity_type)
    WHEN 'opportunity' THEN
      RETURN public.can_read_boq(_entity_id, _user_id);

    WHEN 'quotation' THEN
      RETURN public.can_read_quotation(_entity_id, _user_id);

    WHEN 'rfq' THEN
      RETURN EXISTS (SELECT 1 FROM public.rfqs r
                      WHERE r.id = _entity_id
                        AND (r.sales_owner_id = _user_id OR r.assigned_to = _user_id))
             OR public.is_pipeline_operator(_user_id);

    WHEN 'tender' THEN
      RETURN EXISTS (SELECT 1 FROM public.tenders t
                      WHERE t.id = _entity_id AND t.tender_owner_id = _user_id)
             OR public.is_pipeline_operator(_user_id);

    -- Company- and contact-level advice is account intelligence: the pipeline
    -- sees it, an unrelated salesperson does not.
    WHEN 'company', 'contact' THEN
      RETURN public.is_pipeline_operator(_user_id);

    ELSE
      RETURN FALSE;
  END CASE;
END; $$;

COMMENT ON FUNCTION public.can_read_ai_recommendation IS
  'Whether a user may read one AI recommendation, branching on the entity it concerns. Unrecognised entity types return FALSE so a new agent grants nothing until a branch is added on purpose.';

DROP POLICY IF EXISTS "ai_recommendations_readable" ON public.ai_recommendations;
DROP POLICY IF EXISTS "AI recommendations readable by the record's people" ON public.ai_recommendations;
CREATE POLICY "AI recommendations readable by the record's people"
  ON public.ai_recommendations FOR SELECT TO authenticated
  USING (public.can_read_ai_recommendation(entity_type, entity_id, (SELECT auth.uid())));

-- ============ 3. A human may decide, and may not rewrite ============
DROP POLICY IF EXISTS "AI recommendations decidable by the record's people" ON public.ai_recommendations;
CREATE POLICY "AI recommendations decidable by the record's people"
  ON public.ai_recommendations FOR UPDATE TO authenticated
  USING (public.can_read_ai_recommendation(entity_type, entity_id, (SELECT auth.uid())))
  WITH CHECK (public.can_read_ai_recommendation(entity_type, entity_id, (SELECT auth.uid())));

-- Deliberately NO INSERT policy for `authenticated`. Recommendations are
-- produced by the ai-orchestrator running as the service role — one door in.
-- A client that could insert here could forge advice and then "accept" it.

CREATE OR REPLACE FUNCTION public.ai_recommendation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI recommendations are dismissed, not deleted — what the model said is a record. | لا تُحذف توصيات الذكاء الاصطناعي.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- What the model said is fixed at generation. If this were editable, nobody
  -- could later tell a warning the model gave from one a person backfilled
  -- after the risk materialised.
  IF NEW.recommendation   IS DISTINCT FROM OLD.recommendation
     OR NEW.rationale     IS DISTINCT FROM OLD.rationale
     OR NEW.title         IS DISTINCT FROM OLD.title
     OR NEW.confidence    IS DISTINCT FROM OLD.confidence
     OR NEW.severity      IS DISTINCT FROM OLD.severity
     OR NEW.suggested_action IS DISTINCT FROM OLD.suggested_action
     OR NEW.agent_key     IS DISTINCT FROM OLD.agent_key
     OR NEW.run_id        IS DISTINCT FROM OLD.run_id
     OR NEW.generated_by  IS DISTINCT FROM OLD.generated_by
     OR NEW.entity_type   IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id     IS DISTINCT FROM OLD.entity_id THEN
    RAISE EXCEPTION 'The advice itself is immutable — record a decision instead. | نص التوصية غير قابل للتعديل.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status <> 'open' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'This recommendation has already been decided. | تم البت في هذه التوصية.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> 'open' AND OLD.status = 'open' THEN
    NEW.decided_by := coalesce(NEW.decided_by, _uid);
    NEW.decided_at := coalesce(NEW.decided_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS ai_recommendations_guard ON public.ai_recommendations;
CREATE TRIGGER ai_recommendations_guard
  BEFORE INSERT OR UPDATE ON public.ai_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.ai_recommendation_guard();

DROP TRIGGER IF EXISTS ai_recommendations_no_delete ON public.ai_recommendations;
CREATE TRIGGER ai_recommendations_no_delete
  BEFORE DELETE ON public.ai_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.ai_recommendation_guard();

REVOKE ALL ON public.ai_recommendations FROM anon;
GRANT SELECT, UPDATE ON public.ai_recommendations TO authenticated;

-- ============ 4. The advisory queue ============
CREATE OR REPLACE VIEW public.ai_advice_queue AS
  SELECT r.id, r.agent_key, r.entity_type, r.entity_id,
         r.title, r.recommendation, r.rationale, r.suggested_action,
         r.confidence, r.severity, r.missing_data,
         r.status, r.decided_by, r.decided_at, r.decision_note,
         r.created_at,
         round(extract(epoch FROM now() - r.created_at) / 86400, 1) AS days_open
    FROM public.ai_recommendations r
   WHERE r.status = 'open'
     AND public.can_read_ai_recommendation(r.entity_type, r.entity_id, (SELECT auth.uid()));

COMMENT ON VIEW public.ai_advice_queue IS
  'Undecided AI advice the reader is entitled to see. days_open exists so advice nobody answers is visible as a queue problem rather than quietly ageing.';
GRANT SELECT ON public.ai_advice_queue TO authenticated;

-- ============ 5. Nothing here applies anything ============
-- Recorded as a comment because it is the constraint most likely to be
-- violated by a future "helpful" trigger: accepting advice must never write to
-- opportunities, quotations, boq_revisions or internal_prices. A person
-- applies it through the normal write path so the deal's own history shows who
-- changed it, and this table shows what they were reading when they did.
COMMENT ON TABLE public.ai_recommendations IS
  'AI advice, advisory only. Generated by the orchestrator as the service role (there is deliberately no INSERT policy for authenticated). The advice text is immutable; humans add a decision beside it. Accepting a recommendation records a decision and applies NOTHING — no trigger here writes to any canonical table.';
