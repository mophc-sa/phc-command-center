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

`is_platform_admin()` (`system_admin, managing_director, general_manager, ceo, sales_manager`) is already a strict superset of `is_commercial_manager()` (`managing_director, general_manager, ceo, sales_manager`) — same helper already used for `audit_log` visibility. Simplify by **replacing** `is_commercial_manager(auth.uid())` with `is_platform_admin(auth.uid())` in that clause, rather than adding a redundant third branch.

### 3.2 Write path: `sales-os-api` action handler, not a raw RPC

Corrected from the original draft of this spec: the codebase's established pattern for privileged frontend-triggered mutations is a `sales-os-api` Edge Function action handler (same gateway `decide_approval` / `accept_recommendation` use in `supabase/functions/sales-os-api/handlers/`), not a bare `SECURITY DEFINER` RPC called directly via `supabase.rpc()`. Following that pattern:

- New handler module file `supabase/functions/sales-os-api/handlers/ai-outputs.ts`, action name `review_ai_agent_output`, payload `{ outputId: string, decision: 'accepted' | 'rejected' }`.
- Role check in TypeScript: caller must satisfy a new `canReviewAiOutput` capability helper (`system_admin` OR commercial managers — added to both `src/lib/roles.ts` and its Edge Function mirror `supabase/functions/_shared/roles.ts`, same role set as the existing `canManageTeam`/`canViewSalesAdmin` helpers, added as a new named helper rather than reusing those for semantic clarity, matching that file's own precedent of multiple identically-defined helpers for distinct call sites).
- Handler does `svc.from('ai_agent_outputs').update({ status: decision, reviewed_by: caller.userId, reviewed_at: now, review_decision: decision }).eq('id', outputId).eq('status', 'pending_review').select().single()` (service-role client, bypasses RLS — the `status = 'pending_review'` guard is the double-submit/race protection: a second call finds 0 rows and the handler returns a clear "already reviewed" error instead of silently overwriting).
- On success, call the shared `audit()` helper (`action = 'ai_output.reviewed'`, `entity_type = 'ai_agent_output'`, `entity_id = outputId`, `after` includes `agent_key` and `decision`) — not a hand-written `INSERT INTO audit_log`.
- Register the new handler module in `supabase/functions/sales-os-api/index.ts`.
- Frontend calls it via the existing `callBackend('review_ai_agent_output', { outputId, decision })` helper (`src/lib/backend.ts`) from a new `src/lib/ai-review-actions.ts`, not `supabase.rpc()`.

`review_decision` duplicates `status` at write time by design: `status` can later grow more values (e.g. `superseded`, already in the CHECK constraint) while `review_decision` stays a clean record of the literal human call.

No free-text note field in this iteration — there's no notes/comment column on `ai_agent_outputs`, and adding one is a schema change beyond this spec's scope (YAGNI: not explicitly requested, and the audit trail is already meaningful without it — who decided, when, and what).

No new agent-facing Edge Function — this is a state transition, not a provider call, and it reuses the existing `sales-os-api` gateway. Keeps `ai-orchestrator` as the only thing that talks to a provider, per `CLAUDE.md`.

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

- pgTAP: extend `supabase/tests/rls_role_matrix.test.sql` — `system_admin` (already seeded in that file's fixtures) can now `SELECT` an `ai_agent_outputs` row it didn't request; `salesperson`/`viewer` still cannot.
- Unit test: `canReviewAiOutput` in `src/lib/roles.capabilities.test.ts`, mirroring the existing `canManageTeam`/`canViewSalesAdmin` test cases in that file.
- No new component-test or e2e coverage: this repo has no React component-testing setup at all (no `@testing-library/react`, no `.test.tsx` files, no jsdom config anywhere), and the closest analog page (`approvals.tsx`, same accept/reject-by-role shape) has no Playwright coverage either. Introducing a new test framework for one feature would be scope creep beyond this spec. Verification for the handler and UI wiring is manual (documented steps in the implementation plan), consistent with how `approvals.tsx` itself is verified today.
