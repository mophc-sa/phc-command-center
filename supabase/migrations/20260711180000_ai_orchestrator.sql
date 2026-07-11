-- =========================================================
-- PHC Sales OS — Sprint 10: Safe AI Orchestrator.
--
-- Adds the three tables the new ai-orchestrator Edge Function writes to.
-- All are additive and non-destructive; nothing here touches any existing
-- table. Revised after a full security/architecture review (PR #22) found
-- a cross-entity idempotency-replay bug and an unguarded concurrent-request
-- race — see "Required Fix 1/2" comments below for the exact changes.
--
-- Relationship to the existing Phase-5 AI foundation
-- (20260708130050_ai_foundation.sql, ai_agent_runs / ai_recommendations /
-- ai_evidence_items / ai_agent_feedback): that is a BATCH-SCAN model — one
-- ai_agent_runs row covers a whole sweep across many records (records_
-- scanned, recommendations_created), and ai_recommendations is a single flat
-- shape (title/recommendation/rationale/confidence/severity) with its own
-- status vocabulary tied to the existing accept_recommendation review flow
-- (which itself operates on a THIRD, legacy `recommendations` table — see
-- sales-os-api's accept_recommendation handler). Neither has a column that
-- can hold an agent-specific structured JSON payload (e.g.
-- old_data_classifier's proposed_field_mapping object or
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
  -- Required Fix 5: SET NULL (not CASCADE) — matches this codebase's own
  -- audit_log.actor_id convention. Deleting a user must never erase AI trace
  -- history; the row survives with requested_by = NULL. RLS below handles
  -- NULL safely: `NULL = auth.uid()` is never true for anyone (including a
  -- re-created account with the same email), so a nulled row is simply no
  -- longer visible via the "own rows" branch — only is_platform_admin can
  -- still see it. Nothing broadens access; something narrows it.
  requested_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
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
  'Per-call trace log for the ai-orchestrator Edge Function. Never stores API keys, authorization headers, full prompts, raw provider responses, or full customer records — context_manifest/metadata carry only safe summary metadata (field names, record counts, redacted identifiers). requested_by is nullified (never cascaded) on user deletion to preserve history.';

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
  -- Required Fix 5: SET NULL, not CASCADE — see ai_agent_trace_events above.
  requested_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_review',
  structured_output jsonb NOT NULL,
  summary text NULL,
  reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  review_decision text NULL,
  -- Idempotency key (Sprint 10 "duplicate prevention"): scoped per caller per
  -- agent per entity. Not part of the sprint's literal "recommended fields"
  -- list, but required by its own "Idempotency and duplicate prevention"
  -- section.
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
  'Staged AI recommendations/drafts/classifications awaiting human review. Never auto-applied. This sprint only inserts pending_review rows; accept/reject/apply workflows are out of scope here. requested_by is nullified (never cascaded) on user deletion to preserve history.';

CREATE INDEX idx_ai_outputs_trace_id ON public.ai_agent_outputs (trace_id);
CREATE INDEX idx_ai_outputs_requested_by ON public.ai_agent_outputs (requested_by);
CREATE INDEX idx_ai_outputs_agent_key ON public.ai_agent_outputs (agent_key);
CREATE INDEX idx_ai_outputs_entity ON public.ai_agent_outputs (entity_type, entity_id);
CREATE INDEX idx_ai_outputs_status ON public.ai_agent_outputs (status);
CREATE INDEX idx_ai_outputs_created_at ON public.ai_agent_outputs (created_at);

-- Required Fix 1: idempotency scope now includes entity_type + entity_id, so
-- the same clientRequestId reused against a DIFFERENT entity can never match
-- an existing row from a different entity (previously scoped only to
-- requested_by + agent_key + client_request_id, which allowed exactly that
-- cross-entity replay). Partial so requests that never supplied a
-- clientRequestId (NULL) never collide with each other.
CREATE UNIQUE INDEX ai_agent_outputs_idempotency_key
  ON public.ai_agent_outputs (requested_by, agent_key, entity_type, entity_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TRIGGER trg_ai_agent_outputs_updated_at BEFORE UPDATE ON public.ai_agent_outputs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- ai_agent_requests ---------------------------------------------------------
-- Required Fix 2: atomic concurrent-request claiming. This table (plus the
-- claim_ai_agent_request RPC below) is the ONLY thing that prevents two
-- simultaneous requests carrying the same idempotency key from both calling
-- the provider — the ai_agent_outputs unique index above is a final,
-- data-integrity backstop, not the primary defense (by the time two
-- concurrent requests would collide there, both have already paid for a
-- provider call). Only ever touched by the service-role client, exactly
-- like the other two AI tables.
CREATE TABLE public.ai_agent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  client_request_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  trace_id uuid NULL,
  output_id uuid NULL REFERENCES public.ai_agent_outputs(id) ON DELETE SET NULL,
  error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_agent_requests
  ADD CONSTRAINT ai_agent_requests_status_check
  CHECK (status IN ('processing','succeeded','failed'));

COMMENT ON TABLE public.ai_agent_requests IS
  'Atomic concurrency-claim ledger for ai-orchestrator requests that supply a clientRequestId. A row in status=processing older than the RPC''s stale-claim threshold is considered abandoned (e.g. the Edge Function instance crashed) and may be reclaimed by a subsequent request with the same key — see claim_ai_agent_request(). Not an audit log; ai_agent_trace_events/ai_agent_outputs are the durable record.';

CREATE UNIQUE INDEX ai_agent_requests_claim_key
  ON public.ai_agent_requests (requested_by, agent_key, entity_type, entity_id, client_request_id);
CREATE INDEX idx_ai_requests_status ON public.ai_agent_requests (status);
CREATE INDEX idx_ai_requests_updated_at ON public.ai_agent_requests (updated_at);

CREATE TRIGGER trg_ai_agent_requests_updated_at BEFORE UPDATE ON public.ai_agent_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Atomic claim: attempts to INSERT a brand-new claim; on conflict (a row for
-- this exact key already exists), attempts to reclaim it ONLY if it is
-- 'failed' (safe to retry) or a stale 'processing' claim (abandoned —
-- default staleness threshold 120s, comfortably above
-- AI_REQUEST_TIMEOUT_MS's own default of 20s so a genuinely in-flight
-- request is never stolen from under itself). Returns claimed=true when the
-- caller may proceed to call the provider; claimed=false with the row's
-- current status/output_id/trace_id otherwise, so the caller can return the
-- existing output (status='succeeded') or a controlled "already in
-- progress" response (status='processing', not stale).
--
-- Concurrency correctness: the fast-path INSERT and the fallback UPDATE...
-- WHERE are each a single atomic statement. Two simultaneous callers racing
-- the INSERT will have Postgres's unique index serialize them — the second
-- blocks until the first commits, then raises unique_violation and falls
-- into the UPDATE, whose WHERE clause no longer matches (the first caller's
-- row is now 'processing' with a fresh updated_at) — so at most one caller
-- can ever have claimed=true for a given key at a given time.
CREATE OR REPLACE FUNCTION public.claim_ai_agent_request(
  _requested_by uuid,
  _agent_key text,
  _entity_type text,
  _entity_id uuid,
  _client_request_id text,
  _trace_id uuid,
  _stale_after_seconds integer DEFAULT 120
)
RETURNS TABLE(claim_id uuid, claimed boolean, request_status text, request_output_id uuid, request_trace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_updated_rows integer;
BEGIN
  BEGIN
    INSERT INTO public.ai_agent_requests
      (requested_by, agent_key, entity_type, entity_id, client_request_id, status, trace_id)
    VALUES
      (_requested_by, _agent_key, _entity_type, _entity_id, _client_request_id, 'processing', _trace_id)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT v_id, true, 'processing'::text, NULL::uuid, _trace_id;
    RETURN;
  EXCEPTION WHEN unique_violation THEN
    NULL; -- fall through to the reclaim attempt below
  END;

  UPDATE public.ai_agent_requests r
  SET status = 'processing', trace_id = _trace_id, updated_at = now()
  WHERE r.requested_by IS NOT DISTINCT FROM _requested_by
    AND r.agent_key = _agent_key
    AND r.entity_type = _entity_type
    AND r.entity_id = _entity_id
    AND r.client_request_id = _client_request_id
    AND (r.status = 'failed' OR (r.status = 'processing' AND r.updated_at < now() - make_interval(secs => _stale_after_seconds)))
  RETURNING r.id INTO v_id;
  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 1 THEN
    RETURN QUERY SELECT v_id, true, 'processing'::text, NULL::uuid, _trace_id;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT r.id, false, r.status, r.output_id, r.trace_id
    FROM public.ai_agent_requests r
    WHERE r.requested_by IS NOT DISTINCT FROM _requested_by
      AND r.agent_key = _agent_key
      AND r.entity_type = _entity_type
      AND r.entity_id = _entity_id
      AND r.client_request_id = _client_request_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_ai_agent_request(uuid, text, text, uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_agent_request(uuid, text, text, uuid, text, uuid, integer) TO service_role;

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
-- (same pattern as sales-os-api). Only SELECT is granted to authenticated on
-- the two audit-facing tables, gated by the policies below.
-- public.ai_agent_requests grants NO authenticated access at all (not even
-- SELECT) — it is purely internal concurrency-control plumbing, not
-- something a user needs to read; its outcome is always surfaced back to
-- them through the ai-orchestrator response itself.
ALTER TABLE public.ai_agent_trace_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.ai_agent_trace_events TO authenticated;
GRANT ALL ON public.ai_agent_trace_events TO service_role;
GRANT SELECT ON public.ai_agent_outputs TO authenticated;
GRANT ALL ON public.ai_agent_outputs TO service_role;
GRANT ALL ON public.ai_agent_requests TO service_role;

-- No DELETE workflow for AI traces or outputs in this sprint.
REVOKE DELETE ON public.ai_agent_trace_events FROM authenticated;
REVOKE DELETE ON public.ai_agent_outputs FROM authenticated;

-- Trace read: requester sees their own trace events; is_platform_admin
-- (system_admin + executive + sales_manager — the existing "administer /
-- audit visibility" predicate from 20260708130010_commercial_authority_
-- helpers.sql) sees all, matching "commercial managers may read commercially
-- relevant traces" and "system-level roles ... if this matches the existing
-- authority model" in one reused helper rather than two hardcoded role
-- lists. requested_by = auth.uid() is naturally false (never true) once a
-- row has been nullified by user deletion — no special-casing needed.
CREATE POLICY "Trace events readable by requester or platform admin" ON public.ai_agent_trace_events
  FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public.is_platform_admin(auth.uid()));

-- Output read: requester sees their own output while they still have access
-- to the linked entity; commercial managers see all outputs (team
-- visibility, consistent with every other "manager sees team" policy in this
-- schema, e.g. sales_targets). Same NULL-safety note as above applies to a
-- nullified requested_by — it simply drops out of the "own rows" branch.
CREATE POLICY "Outputs readable by requester with entity access or commercial manager" ON public.ai_agent_outputs
  FOR SELECT TO authenticated
  USING (
    (requested_by = auth.uid() AND (entity_id IS NULL OR public.ai_output_entity_still_owned(entity_type, entity_id, auth.uid())))
    OR public.is_commercial_manager(auth.uid())
  );

-- No policy at all on ai_agent_requests for `authenticated` (RLS enabled,
-- zero grants, zero policies = fully inaccessible to that role by default —
-- only service_role, which bypasses RLS, can ever touch it).
