-- =========================================================
-- PHC Sales OS — Sprint 10: AI Orchestrator idempotency payload-conflict fix.
--
-- Confirmed gap (read-only inspection, prior turn): the existing idempotency
-- scope on ai_agent_requests / ai_agent_outputs is
-- (requested_by, agent_key, entity_type, entity_id, client_request_id) only.
-- The caller-controlled request payload (`input`, and any admin `provider`
-- override) is never stored or compared. A caller reusing the same
-- clientRequestId against the same entity with DIFFERENT input silently
-- receives the FIRST request's result (or AI_REQUEST_IN_PROGRESS) instead of
-- a rejection — the second, different request is absorbed without a trace.
-- This migration closes that gap additively: it does not change the
-- existing 5-field uniqueness scope, does not touch ai_agent_outputs, and
-- does not alter any existing RLS policy or grant.
--
-- No CHECK-constraint or enum change is required anywhere in this migration:
--   - ai_agent_trace_events.status already includes 'rejected', which is
--     reused for the new conflict trace event (see ai-orchestrator/index.ts).
--   - ai_agent_trace_events.error_code and ai_agent_requests.error_code are
--     both plain `text` with no CHECK — the new AI_IDEMPOTENCY_CONFLICT code
--     is a TypeScript-side addition only (ai-schemas.ts).
--   - ai_agent_requests.status keeps its existing
--     CHECK (status IN ('processing','succeeded','failed')) unchanged — a
--     conflicting NEW request never gets a row of its own and never mutates
--     the EXISTING row's status, so no new status value is ever persisted.
--     ('conflict' appears only as a transient RETURNS TABLE output value
--     from claim_ai_agent_request() below, never written to the status
--     column itself.)
-- =========================================================

-- ---- 1. New column: request_fingerprint ------------------------------------
-- Nullable for backward compatibility with every row claimed before this
-- migration — those rows have no recorded fingerprint and are NOT backfilled
-- (the original caller input was never stored anywhere, so there is nothing
-- authentic to backfill; see ai-orchestrator/index.ts and
-- docs/ai-orchestrator.md for how a NULL value is handled explicitly as
-- "unverified legacy row", never treated as a confirmed match).
ALTER TABLE public.ai_agent_requests
  ADD COLUMN request_fingerprint text NULL;

COMMENT ON COLUMN public.ai_agent_requests.request_fingerprint IS
  'SHA-256 digest (lowercase hex, 64 chars) of the canonical, caller-controlled semantic request content (request.input plus the effective admin provider override, if any) — see supabase/functions/_shared/ai-fingerprint.ts. Never the raw input, never a canonical JSON string, never a secret/JWT/timestamp/trace ID. NULL on rows claimed before this column existed; claim_ai_agent_request() treats a NULL stored value as "unverifiable" rather than "matching".';

-- No index added on this column: it is only ever compared against a single
-- already-located row inside claim_ai_agent_request() (found via the
-- existing ai_agent_requests_claim_key unique index), never queried
-- independently. It is deliberately NOT added to any unique index — doing so
-- would reopen the entity/key-scoping complexity Required Fix 1 closed.

-- ---- 2. claim_ai_agent_request(): fingerprint-aware claim/conflict logic ----
-- New trailing parameter with DEFAULT NULL so the CURRENTLY DEPLOYED
-- ai-orchestrator function (which does not know about this parameter at
-- all) keeps calling this RPC successfully in the window between this
-- migration applying and the function being redeployed — it will simply
-- always pass the default NULL, which this function treats identically to
-- "legacy row, nothing to compare" (see the D. branch below), i.e. exactly
-- today's pre-fix behavior. Only once ai-orchestrator is redeployed does a
-- real fingerprint ever get supplied or stored.
--
-- IMPORTANT: adding a parameter changes this function's signature/identity
-- in Postgres — CREATE OR REPLACE alone would NOT replace the existing
-- 7-argument function, it would create a second, overloaded one alongside
-- it. Supabase's PostgREST RPC layer calls functions with NAMED arguments
-- (matching supabase-js's `.rpc(name, params)`), and the currently-deployed
-- Edge Function's 7-named-argument call would become genuinely ambiguous
-- between the old 7-arg function and the new 8-arg-with-a-default function —
-- exactly the compatibility break this migration must not cause. The old
-- signature is dropped first so only one version of this function ever
-- exists at a time, matching how every other function in this schema is
-- versioned.
DROP FUNCTION IF EXISTS public.claim_ai_agent_request(uuid, text, text, uuid, text, uuid, integer);

CREATE OR REPLACE FUNCTION public.claim_ai_agent_request(
  _requested_by uuid,
  _agent_key text,
  _entity_type text,
  _entity_id uuid,
  _client_request_id text,
  _trace_id uuid,
  _stale_after_seconds integer DEFAULT 120,
  _input_fingerprint text DEFAULT NULL
)
RETURNS TABLE(claim_id uuid, claimed boolean, request_status text, request_output_id uuid, request_trace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_updated_rows integer;
  v_existing_fingerprint text;
BEGIN
  -- A. No existing row for this exact 5-field key: claim it fresh, storing
  -- whatever fingerprint (possibly NULL, during the pre-redeploy window)
  -- this caller supplied.
  BEGIN
    INSERT INTO public.ai_agent_requests
      (requested_by, agent_key, entity_type, entity_id, client_request_id, status, trace_id, request_fingerprint)
    VALUES
      (_requested_by, _agent_key, _entity_type, _entity_id, _client_request_id, 'processing', _trace_id, _input_fingerprint)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT v_id, true, 'processing'::text, NULL::uuid, _trace_id;
    RETURN;
  EXCEPTION WHEN unique_violation THEN
    NULL; -- a row for this key already exists — fall through to inspect it
  END;

  -- A row for this key already exists. Read its stored fingerprint BEFORE
  -- deciding whether to reclaim/return its current outcome, so a genuine
  -- payload conflict can be rejected before ever touching that row's status.
  SELECT r.request_fingerprint INTO v_existing_fingerprint
  FROM public.ai_agent_requests r
  WHERE r.requested_by IS NOT DISTINCT FROM _requested_by
    AND r.agent_key = _agent_key
    AND r.entity_type = _entity_type
    AND r.entity_id = _entity_id
    AND r.client_request_id = _client_request_id;

  -- C. Existing row with a DIFFERENT non-null fingerprint: deterministic
  -- conflict, regardless of whether the existing row is processing, stale
  -- processing, failed, or succeeded — never reclaim, never change status,
  -- never touch request_fingerprint. The idempotency key's semantic meaning
  -- must never change after its initial claim.
  IF v_existing_fingerprint IS NOT NULL
     AND _input_fingerprint IS NOT NULL
     AND v_existing_fingerprint <> _input_fingerprint THEN
    RETURN QUERY
      SELECT r.id, false, 'conflict'::text, r.output_id, r.trace_id
      FROM public.ai_agent_requests r
      WHERE r.requested_by IS NOT DISTINCT FROM _requested_by
        AND r.agent_key = _agent_key
        AND r.entity_type = _entity_type
        AND r.entity_id = _entity_id
        AND r.client_request_id = _client_request_id;
    RETURN;
  END IF;

  -- B. Matching fingerprint, or D. one/both sides NULL (a legacy pre-fix row,
  -- or a pre-redeploy caller not yet supplying one): fall through to the
  -- ORIGINAL reclaim logic, unchanged — a failed or stale-processing row may
  -- still be reclaimed; a fresh processing/succeeded row is reported as
  -- before. This is the documented, intentional backward-compatible
  -- behavior for anything this migration cannot verify.
  UPDATE public.ai_agent_requests r
  SET status = 'processing', trace_id = _trace_id, request_fingerprint = _input_fingerprint, updated_at = now()
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

-- Grants unchanged from the original migration — service_role only, no
-- direct access for anon/authenticated. CREATE OR REPLACE preserves any
-- existing grants on the function, but they are re-asserted explicitly here
-- for clarity and to guard against any future ambiguity about who may call
-- this signature.
REVOKE EXECUTE ON FUNCTION public.claim_ai_agent_request(uuid, text, text, uuid, text, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_agent_request(uuid, text, text, uuid, text, uuid, integer, text) TO service_role;
