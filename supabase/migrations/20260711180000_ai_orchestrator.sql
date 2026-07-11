-- =========================================================
-- PHC Sales OS — Sprint 10: Safe AI Orchestrator.
--
-- Adds the two tables the new ai-orchestrator Edge Function writes to. Both
-- are additive and non-destructive; nothing here touches any existing table.
--
-- Relationship to the existing Phase-5 AI foundation
-- (20260708130050_ai_foundation.sql, ai_agent_runs / ai_recommendations /
-- ai_evidence_items / ai_agent_feedback): that is a BATCH-SCAN model — one
-- ai_agent_runs row covers a whole sweep across many records (records_
-- scanned, recommendations_created), and ai_recommendations is a single flat
-- shape (title/recommendation/rationale/confidence/severity) with its own
-- status vocabulary tied to the existing accept_recommendation review flow.
-- It has no column that can hold an agent-specific structured JSON payload
-- (e.g. old_data_classifier's proposed_field_mapping object or
-- smart_followup_draft's channel/message/subject fields), and its status
-- values (pending/accepted/dismissed/review_requested/actioned) do not match
-- this sprint's required vocabulary. It is therefore not an equivalent
-- staged-output table for this sprint's per-request, schema-validated,
-- structured-output model — these are new, complementary tables, not a
-- replacement. See docs/ai-orchestrator.md for the full comparison.
-- =========================================================

-- ---- ai_agent_trace_events ---------------------------------------------------
-- Append-only event log: the orchestrator inserts one row per state change
-- under a shared trace_id (started, then succeeded/failed/rejected/skipped)
-- rather than updating a single row in place, so a crash mid-request still
-- leaves a truthful "started" record instead of an ambiguous gap.
CREATE TABLE public.ai_agent_trace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  provider text NULL,
  model text NULL,
  entity_type text NULL,
  entity_id uuid NULL,
  status text NOT NULL,
  error_code text NULL,
  error_message text NULL,
  duration_ms integer NULL,
  input_character_count integer NULL,
  output_character_count integer NULL,
  input_token_count integer NULL,
  output_token_count integer NULL,
  context_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_agent_trace_events
  ADD CONSTRAINT ai_agent_trace_events_status_check
  CHECK (status IN ('started','succeeded','failed','rejected','skipped'));

COMMENT ON TABLE public.ai_agent_trace_events IS
  'Per-call trace log for the ai-orchestrator Edge Function. Never stores API keys, authorization headers, full prompts, raw provider responses, or full customer records — context_manifest/metadata carry only safe summary metadata (field names, record counts, redacted identifiers).';

CREATE INDEX idx_ai_trace_events_trace_id ON public.ai_agent_trace_events (trace_id);
CREATE INDEX idx_ai_trace_events_requested_by ON public.ai_agent_trace_events (requested_by);
CREATE INDEX idx_ai_trace_events_agent_key ON public.ai_agent_trace_events (agent_key);
CREATE INDEX idx_ai_trace_events_entity ON public.ai_agent_trace_events (entity_type, entity_id);
CREATE INDEX idx_ai_trace_events_status ON public.ai_agent_trace_events (status);
CREATE INDEX idx_ai_trace_events_created_at ON public.ai_agent_trace_events (created_at);

-- ---- ai_agent_outputs ---------------------------------------------------------
-- Staged AI output awaiting human review. This sprint only ever inserts rows
-- with status = 'pending_review' — there is no code path anywhere in this
-- sprint that sets accepted/rejected/superseded; those exist for a future
-- review-workflow sprint to use.
CREATE TABLE public.ai_agent_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id uuid NOT NULL,
  agent_key text NOT NULL,
  output_type text NOT NULL,
  entity_type text NULL,
  entity_id uuid NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending_review',
  structured_output jsonb NOT NULL,
  summary text NULL,
  reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  review_decision text NULL,
  -- Idempotency key (Sprint 10 "duplicate prevention"): scoped per caller per
  -- agent. Not part of the sprint's literal "recommended fields" list, but
  -- required by its own "Idempotency and duplicate prevention" section.
  client_request_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_agent_outputs
  ADD CONSTRAINT ai_agent_outputs_output_type_check
  CHECK (output_type IN ('recommendation','draft','staged_classification'));
ALTER TABLE public.ai_agent_outputs
  ADD CONSTRAINT ai_agent_outputs_status_check
  CHECK (status IN ('pending_review','accepted','rejected','superseded'));

COMMENT ON TABLE public.ai_agent_outputs IS
  'Staged AI recommendations/drafts/classifications awaiting human review. Never auto-applied. This sprint only inserts pending_review rows; accept/reject/apply workflows are out of scope here.';

CREATE INDEX idx_ai_outputs_trace_id ON public.ai_agent_outputs (trace_id);
CREATE INDEX idx_ai_outputs_requested_by ON public.ai_agent_outputs (requested_by);
CREATE INDEX idx_ai_outputs_agent_key ON public.ai_agent_outputs (agent_key);
CREATE INDEX idx_ai_outputs_entity ON public.ai_agent_outputs (entity_type, entity_id);
CREATE INDEX idx_ai_outputs_status ON public.ai_agent_outputs (status);
CREATE INDEX idx_ai_outputs_created_at ON public.ai_agent_outputs (created_at);

-- Idempotency: at most one output per (requester, agent, clientRequestId).
-- Partial so requests that never supplied a clientRequestId (NULL) never
-- collide with each other.
CREATE UNIQUE INDEX ai_agent_outputs_idempotency_key
  ON public.ai_agent_outputs (requested_by, agent_key, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TRIGGER trg_ai_agent_outputs_updated_at BEFORE UPDATE ON public.ai_agent_outputs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- Ownership helper for the output-read policy -------------------------------
-- "Requester can read outputs they created when they still have access to
-- the linked entity" — approximated as continued ownership of the linked
-- record for every entity type that has an owner concept in this schema
-- (opportunities/rfqs/tenders/quotations/companies/contacts — note
-- companies uses `account_owner_id`, not `owner_id`). Entity types with no
-- owner column at all (import_batches, import_rows) fall through to `true`:
-- import access is role-gated only in this schema, so "still have access" is
-- satisfied by role membership alone (already enforced when the output was
-- created) rather than a per-record ownership check.
CREATE OR REPLACE FUNCTION public.ai_output_entity_still_owned(_entity_type text, _entity_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE _entity_type
    WHEN 'opportunities' THEN EXISTS (SELECT 1 FROM public.opportunities WHERE id = _entity_id AND owner_id = _user_id)
    WHEN 'rfqs' THEN EXISTS (SELECT 1 FROM public.rfqs WHERE id = _entity_id AND sales_owner_id = _user_id)
    WHEN 'tenders' THEN EXISTS (SELECT 1 FROM public.tenders WHERE id = _entity_id AND tender_owner_id = _user_id)
    WHEN 'quotations' THEN EXISTS (SELECT 1 FROM public.quotations WHERE id = _entity_id AND owner_id = _user_id)
    WHEN 'companies' THEN EXISTS (SELECT 1 FROM public.companies WHERE id = _entity_id AND account_owner_id = _user_id)
    WHEN 'contacts' THEN EXISTS (SELECT 1 FROM public.contacts WHERE id = _entity_id AND owner_id = _user_id)
    ELSE true
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_output_entity_still_owned(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_output_entity_still_owned(text, uuid, uuid) TO authenticated;

-- ---- Grants + RLS ---------------------------------------------------------------
-- Neither table grants INSERT/UPDATE/DELETE to `authenticated` — every write
-- in this sprint comes from the Edge Function's service-role client, after
-- the function has already done its own role + ownership check in code
-- (same pattern as sales-os-api). Only SELECT is granted to authenticated,
-- gated by the policies below.
ALTER TABLE public.ai_agent_trace_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_outputs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.ai_agent_trace_events TO authenticated;
GRANT ALL ON public.ai_agent_trace_events TO service_role;
GRANT SELECT ON public.ai_agent_outputs TO authenticated;
GRANT ALL ON public.ai_agent_outputs TO service_role;

-- No DELETE workflow for AI traces or outputs in this sprint.
REVOKE DELETE ON public.ai_agent_trace_events FROM authenticated;
REVOKE DELETE ON public.ai_agent_outputs FROM authenticated;

-- Trace read: requester sees their own trace events; is_platform_admin
-- (system_admin + executive + sales_manager — the existing "administer /
-- audit visibility" predicate from 20260708130010_commercial_authority_
-- helpers.sql) sees all, matching "commercial managers may read commercially
-- relevant traces" and "system-level roles ... if this matches the existing
-- authority model" in one reused helper rather than two hardcoded role lists.
CREATE POLICY "Trace events readable by requester or platform admin" ON public.ai_agent_trace_events
  FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public.is_platform_admin(auth.uid()));

-- Output read: requester sees their own output while they still have access
-- to the linked entity; commercial managers see all outputs (team
-- visibility, consistent with every other "manager sees team" policy in this
-- schema, e.g. sales_targets).
CREATE POLICY "Outputs readable by requester with entity access or commercial manager" ON public.ai_agent_outputs
  FOR SELECT TO authenticated
  USING (
    (requested_by = auth.uid() AND (entity_id IS NULL OR public.ai_output_entity_still_owned(entity_type, entity_id, auth.uid())))
    OR public.is_commercial_manager(auth.uid())
  );
