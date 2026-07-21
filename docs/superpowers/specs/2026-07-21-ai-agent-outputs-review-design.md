# AI Agent Outputs Review UI

**Date:** 2026-07-21
**Branch:** `feat/ai-outputs-review` (to be created)
**Depends on:** none (additive — extends existing `ai_agent_outputs` table and `agent-activity.tsx` page)

---

## 1. Goal

`public.ai_agent_outputs` is written by the `ai-orchestrator` Edge Function on every agent call, but nothing reads it back for a human decision. The four non-import agents (`opportunity_evaluation`, `smart_followup_draft`, `project_radar`, `risk_finance`) currently show their result inline, ephemerally, only in the page that triggered them — the durable row in `ai_agent_outputs` sits at `status = 'pending_review'` forever, unreviewed and unrevisitable once the triggering session ends.

This spec adds a persistent accept/reject review action for those four agents' outputs, surfaced in the existing (currently read-only) "AI Outputs" tab on `agent-activity.tsx`.

---

## 2. Scope

**In scope:**
- Accept/reject action for `pending_review` outputs from the 4 target agents: `opportunity_evaluation`, `smart_followup_draft`, `project_radar`, `risk_finance`.
- RLS read access to `ai_agent_outputs` for `system_admin` (currently only `is_commercial_manager` roles and the original requester can see rows).
- A `SECURITY DEFINER` RPC to record the decision (`status`, `reviewed_by`, `reviewed_at`, `review_decision`) plus an audit log entry.

**Explicitly out of scope (separate follow-ups):**
- The 10 import-pipeline agents (`entity_extractor`, `relationship_resolver`, `workbook_classifier`, `sheet_classifier`, `semantic_field_mapper`, `change_interpreter`, `import_routing_reviewer`, `contact_mapping`, `old_data_classifier`, `data_cleanup`) — already served by the dedicated `data-import.$batchId.tsx` review/commit flow against separate tables (`import_record_candidates`, `import_split_proposals`). No change to that flow.
- The legacy `ai_recommendations` table / `sales-os-api`'s `intelligence.ts` — a separate, older recommendation system not wired through `ai-orchestrator`. Flagged as a likely duplication to resolve later, not here.
- Any side effect on accept beyond recording the decision (e.g., accepting `smart_followup_draft` does **not** open a send dialog; accepting `risk_finance` does **not** write back to the opportunity). Pure audit-trail for this iteration.
- Doc sync for `docs/ai-orchestrator.md` and the benchmark/feedback loop — separate items in the AI-gaps roadmap.

---

## 3. Data & Security Layer

### 3.1 RLS: extend read access

Current `SELECT` policy on `ai_agent_outputs` (`20260711190000_ai_orchestrator_privilege_hardening.sql`):

```sql
USING (
  (requested_by = auth.uid() AND (entity_id IS NULL OR public.ai_output_entity_still_owned(entity_type, entity_id, auth.uid())))
  OR public.is_commercial_manager(auth.uid())
)
```

Add `is_platform_admin(auth.uid())` (the same helper already used for `audit_log` visibility) as a third `OR` branch, so `system_admin` can see rows it didn't personally trigger.

### 3.2 New RPC: `review_ai_agent_output`

```sql
CREATE OR REPLACE FUNCTION public.review_ai_agent_output(
  _output_id uuid,
  _decision text      -- 'accepted' | 'rejected'
)
RETURNS public.ai_agent_outputs
SECURITY DEFINER
```

Behavior:
- Reject with a clear error if caller is not `is_commercial_manager(auth.uid())` or `is_platform_admin(auth.uid())`.
- Reject if `_decision NOT IN ('accepted','rejected')`.
- `UPDATE ai_agent_outputs SET status = _decision, reviewed_by = auth.uid(), reviewed_at = now(), review_decision = _decision WHERE id = _output_id AND status = 'pending_review'` — the `status = 'pending_review'` guard makes this safe against double-submit/race (second call finds 0 rows, returns a clear "already reviewed" error rather than silently overwriting). `review_decision` duplicates `status` at write time by design: `status` can later grow more values (e.g. `superseded`, already in the CHECK constraint) while `review_decision` stays a clean record of the literal human call.
- On success, insert an `audit_log` row (`action = 'ai_output.reviewed'`, `entity_type = 'ai_agent_output'`, `entity_id = _output_id`, `after_value` includes `agent_key` and `decision`).
- Returns the updated row so the frontend can update its cache without a refetch.

No free-text note field in this iteration — there's no notes/comment column on `ai_agent_outputs`, and adding one is a schema change beyond this spec's scope (YAGNI: not explicitly requested, and the audit trail is already meaningful without it — who decided, when, and what).

No new Edge Function — this is a state transition, not a provider call, so a plain `SECURITY DEFINER` RPC (same pattern as the existing `claim_ai_agent_request()`) is the right altitude. Keeps `ai-orchestrator` as the only thing that talks to a provider, per `CLAUDE.md`.

---

## 4. UI Changes

**File:** `src/routes/_authenticated/agent-activity.tsx` (existing "AI Outputs" tab, currently read-only cards).

- For each `ai_agent_outputs` card where `status === 'pending_review'` **and** `agent_key` is one of the 4 target agents: render `[✓ Accept] [✗ Reject]` buttons directly on the card (no dialog needed — there's no note to capture, so a confirming click is the whole interaction; `Reject` still gets a lightweight confirm to avoid accidental misclicks, via the existing `ActionDialog` component in confirm-only mode, same one `approvals.tsx` uses).
- Cards for the other 10 (import) agents, and cards already `accepted`/`rejected`/`superseded`, render exactly as they do today (read-only, `StatusPill` reflecting the final state) — no behavior change.
- On confirm: call the new `reviewAgentOutput(outputId, decision)` action (new file `src/lib/ai-review-actions.ts`, wrapping `supabase.rpc('review_ai_agent_output', ...)`), show a toast, and update the TanStack Query cache for the outputs list with the RPC's returned row (no full refetch needed).

---

## 5. Error Handling

- RPC permission error (wrong role) → toast: "You don't have permission to review AI outputs."
- RPC "already reviewed" (lost the race) → toast: "This was already reviewed by someone else." + refetch the list so the UI reflects the real current state.
- Network/unexpected error → generic toast + no optimistic update (wait for the real response before changing UI state).

---

## 6. Testing

- pgTAP: extend `supabase/tests/rls_role_matrix.test.sql` (or a new focused file) — `system_admin` can now `SELECT` an output it didn't request; `salesperson`/`viewer` still cannot; `review_ai_agent_output()` succeeds for `sales_manager`/`system_admin`, fails for `salesperson`, fails on a non-`pending_review` row.
- Component test: Accept/Reject buttons render only for the 4 target agents at `pending_review`; absent for import-agent cards and for already-decided cards.
