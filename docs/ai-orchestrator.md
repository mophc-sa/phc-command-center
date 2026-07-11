# Safe AI Orchestrator (Sprint 10)

Backend-only AI gateway for the PHC Sales OS. A single Edge Function
(`ai-orchestrator`) fronts every AI agent in the system — there is one
function per sprint, not one per agent. It never exposes provider API keys to
the frontend, never takes an irreversible action, and every output it
produces is staged for human review, never auto-applied.

## Architecture

```
frontend (src/lib/ai-orchestrator-actions.ts)
        |  strict request: { agent, entityType, entityId, input, provider, clientRequestId }
        v
supabase/functions/ai-orchestrator/index.ts        <- the only public entry point
        |
        |-- authenticate (resolveCaller, _shared/supabase.ts)
        |-- validate request (ai-schemas.ts, zod, .strict())
        |-- resolve agent (ai-agent-registry.ts -> AGENT_REGISTRY[agent])
        |-- idempotency check (ai_agent_outputs, clientRequestId)
        |-- role + ownership check (ai-guardrails.ts, reuses roles.ts helpers)
        |-- insert "started" trace event (ai_agent_trace_events)
        |-- load minimal context (agent's own loadContext)
        |-- enforce context size (ai-guardrails.ts)
        |-- build prompt (ai-prompts.ts, versioned, system/context separated)
        |-- resolve provider config (ai-providers.ts, env-driven)
        |-- call provider with timeout (ai-providers.ts)
        |-- validate structured output (agent's zod output schema)
        |-- scan for guardrail violations (ai-guardrails.ts)
        |-- insert ai_agent_outputs (status = pending_review)
        |-- insert "succeeded" trace event
        v
{ ok: true, traceId, outputId, agent, status: "pending_review", result }
```

### Shared modules

| File | Responsibility | Portable to `bun test`? |
|---|---|---|
| `supabase/functions/_shared/ai-schemas.ts` | zod request/output/error-code schemas | yes (bare `"zod"` specifier, see below) |
| `supabase/functions/_shared/ai-guardrails.ts` | allowlists, role/ownership checks, size limits, prompt-injection delimiting, prohibited-action scanner | yes |
| `supabase/functions/_shared/ai-prompts.ts` | versioned prompt templates, one per agent | yes |
| `supabase/functions/_shared/ai-providers.ts` | provider-neutral `generateStructured()`, OpenAI/Anthropic adapters, env resolution | yes (env + fetch are dependency-injected) |
| `supabase/functions/_shared/ai-agent-registry.ts` | `AGENT_REGISTRY` — context loaders + wiring | no (needs a live `SupabaseClient`, like `_shared/supabase.ts`) |
| `supabase/functions/ai-orchestrator/index.ts` | HTTP entry point, orchestration flow | no (Deno-only: `Deno.serve`, `Deno.env`) |
| `src/lib/ai-orchestrator-actions.ts` | thin typed frontend wrapper | n/a (frontend) |

Four of the five shared modules have zero Deno-specific APIs and are unit
tested directly from `bun test ./src` (`src/lib/ai-*.test.ts`), matching this
repo's existing `_shared/conversion.ts` convention. `ai-providers.ts` reads
environment variables and calls `fetch()`, but both are dependency-injected
(`EnvReader`, `FetchLike`) rather than called directly, so its core logic is
still fully testable with fakes — no live provider call is ever made from a
test.

**A note on `npm:` specifiers**: `ai-schemas.ts` needs `zod` (already a
`package.json` dependency). Deno's `npm:zod@4` specifier is not resolvable by
bun, so this repo adds `supabase/functions/import_map.json` mapping the bare
specifier `"zod"` to `npm:zod@4`. `ai-schemas.ts` imports the bare `"zod"`
specifier — Deno resolves it via the import map at deploy time, bun resolves
it via `node_modules` at test time. Same technique could be used for future
shared Deno modules that need an npm package.

## Provider configuration

Server-side only — the frontend request schema has no field that can select
a model, endpoint, or system prompt.

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | Default provider: `openai` or `anthropic`. Defaults to `openai` if unset. |
| `OPENAI_API_KEY` | Required to use the OpenAI provider. Never logged, never returned. |
| `OPENAI_MODEL` | Required to use the OpenAI provider — **no hardcoded fallback model**. |
| `ANTHROPIC_API_KEY` | Required to use the Anthropic provider. Never logged, never returned. |
| `ANTHROPIC_MODEL` | Required to use the Anthropic provider — **no hardcoded fallback model**. |
| `AI_REQUEST_TIMEOUT_MS` | Per-call timeout, defaults to 20000 if unset/invalid. |
| `AI_MAX_INPUT_CHARS` | Not read at runtime yet — `DEFAULT_MAX_INPUT_CHARS` (4000) is used directly in `ai-guardrails.ts`. Wiring an env override is a one-line follow-up if a specific limit is needed before launch. |

An unset `<PROVIDER>_MODEL` is treated identically to a missing API key —
both mean "not configured." This repository has no existing documented
default-model convention, so none is invented here; picking an unreviewed
model silently would be worse than a clear `AI_NOT_CONFIGURED` response.

`provider` in the request body is only honored for callers whose role is
`system_admin` (checked server-side via `isSystemAdmin(caller.roles)`); for
every other caller it is silently ignored, not merely rejected — the request
still succeeds using the server-configured default provider.

No secret is ever set, read into a log line, or returned in a response body
in this sprint. Configuring real secrets is a separate, explicitly-gated
deployment step (see "Deployment procedure" below), not part of this PR.

## Agent registry

`AGENT_REGISTRY` (`ai-agent-registry.ts`) is the single source of truth —
`ai-orchestrator/index.ts` never branches on an agent's name itself, only
`AGENT_REGISTRY[agent].xyz`.

### Agent policy matrix

| Agent | Allowed `entityType` | Role check | Ownership rule | Output type |
|---|---|---|---|---|
| `opportunity_evaluation` | `opportunities` | `canCreateSalesRecords` (pipeline operators + salesperson; excludes `viewer`, `system_admin`) | Owner (`opportunities.owner_id`) or commercial manager (`canApproveCommercialAction`) | `recommendation` |
| `old_data_classifier` | `import_rows` (a single staged row) | `canViewSalesAdmin` (`system_admin` + executive + `sales_manager`) — matches the **real** `IMPORT_ROLES` in `import-pipeline/index.ts`, deliberately **not** `sales_ops` (see below) | Role-only — import access in the existing system is role-gated, not per-batch-owner-gated | `staged_classification` |
| `smart_followup_draft` | `opportunities`, `rfqs`, `tenders`, `quotations`, `companies`, `contacts` | `canCreateSalesRecords` | Owner of the linked record, or commercial manager. Companies use `account_owner_id` (not `owner_id`) — a distinct column name worth calling out, since it's easy to assume it matches the others. | `draft` |

**Why `old_data_classifier` doesn't grant `sales_ops` access, despite the
sprint brief's example list including it**: discovery read the real
`import-pipeline/index.ts` role sets before implementing this — `IMPORT_ROLES
= [system_admin, managing_director, general_manager, ceo, sales_manager]`.
`sales_ops` is not part of the existing import system's role set at all.
Aligning to the illustrative suggestion instead of the real system would have
given the classifier agent access the actual import pipeline doesn't grant
its human counterpart — a real access inconsistency. `canViewSalesAdmin`
(already defined in `roles.ts`) happens to be exactly `system_admin` + the
existing `IMPORT_ROLES`' commercial members, so it was reused rather than
hardcoded again.

### Entity/context loaders

Each agent's `loadContext` fetches only the fields listed below — never a
full customer history, never unrelated records.

**`opportunity_evaluation`**: the target opportunity's reference, stage,
tier, value, next step/due date, last activity, sector, win confidence; the
5 most recent `follow_ups` rows (due date/status/channel/last contact only);
up to 3 linked RFQs and 3 linked tenders (status/reference only).

**`old_data_classifier`**: the single `import_rows` row (`raw_data`,
`mapped_data`, `status`); its parent `import_batches`' status/source
type/target entity/total rows; the batch's detected column headers
(`import_files.column_names`); up to 20 already-chosen `import_mappings` for
the batch (substituting for a "field dictionary" table, which does not exist
in this schema — confirmed during discovery); up to 5 `import_duplicate_
candidates` for the row (table/id/match type/confidence — already-safe
references, not full records).

**`smart_followup_draft`**: the requested channel and language from the
caller's `input`; a compact summary of the linked record (reference, status,
next action / due date — shape varies by entity type, see
`FOLLOWUP_ENTITY_TABLES` in `ai-agent-registry.ts`).

Every loader also returns a `manifest` (field names loaded, record counts,
source entity types, **redacted** identifiers) — this is what gets persisted
to `ai_agent_trace_events.context_manifest`. The manifest redacts IDs; the
actual prompt content sent to the provider does not (a classifier agent
needs a real UUID to reference a real duplicate candidate) — the manifest is
an audit-safe *summary*, not a copy of what was sent to the provider.

## Structured-output schemas

All three are zod schemas in `ai-schemas.ts`, `.strict()` (unknown fields
rejected), validated at runtime after the provider responds — never trusted
from TypeScript typing alone.

- `OpportunityEvaluationOutputSchema`: `overall_score` (0-100), `qualification`
  (low/medium/high), `recommended_priority` (low/medium/high/critical),
  `win_likelihood` (0-100), `rationale`, `strengths[]`, `risks[]`,
  `missing_information[]`, `recommended_next_actions[]`,
  `suggested_follow_up_date` (YYYY-MM-DD or null), `confidence` (0-1),
  `disclaimer`.
- `OldDataClassifierOutputSchema`: `proposed_entity_type` (matches the real
  `import_batches_target_entity_check` allowlist), `confidence`,
  `proposed_field_mapping`, `normalized_values`, `missing_required_fields[]`,
  `warnings[]`, `duplicate_likelihood`, `duplicate_candidates[]` (entity_type
  + real UUID + confidence only), `recommended_action`
  (stage/needs_review/reject), `rationale`.
- `SmartFollowupDraftOutputSchema`: `channel` (email/whatsapp/internal_note),
  `language` (en/ar), `subject`, `message`, `purpose`, `call_to_action`,
  `suggested_send_time`, `assumptions[]`, `missing_information[]`,
  `confidence`, `requires_human_review` — a fixed `z.literal(true)`; a
  provider response with `false` here fails validation outright.

## Trace / output persistence design

`ai_agent_trace_events` is **append-only**: each call inserts one row per
state change under a shared `trace_id`, rather than updating one row in
place (`id` is the row's own primary key; `trace_id` is the grouping key). A
crash between "started" and the final event still leaves a truthful
"started" row rather than an ambiguous gap — this is the documented
partial-failure handling asked for in place of a full DB transaction (Edge
Functions cannot open a cross-statement transaction against PostgREST the
way a single SQL migration can).

Write order is strict and one-directional: role/access check -> `started`
event -> context load -> provider call -> output validation -> guardrail
scan -> **insert `ai_agent_outputs`** -> **insert `succeeded` event**. If
anything fails before the output insert, no output row is ever written — only
a `failed`/`rejected`/`skipped` trace event. There is no code path that
writes a `succeeded` event without a corresponding output row, or an output
row without an eventual trace event.

`ai_agent_outputs.status` is only ever inserted as `'pending_review'` in this
sprint — there is no accept/reject/apply code path anywhere in this sprint.
`reviewed_by`/`reviewed_at`/`review_decision` exist in the schema for a
future review-workflow sprint to use.

### Relationship to the existing Phase-5 AI foundation

This repo already has `ai_agent_runs` / `ai_recommendations` /
`ai_evidence_items` / `ai_agent_feedback` (added in
`20260708130050_ai_foundation.sql`). That is a **batch-scan** model: one
`ai_agent_runs` row covers a whole sweep across many records
(`records_scanned`, `recommendations_created`), and `ai_recommendations` is a
single flat shape (title/recommendation/rationale/confidence/severity) with
its own status vocabulary tied to the existing `accept_recommendation` flow.
Neither has a column that can hold an agent-specific structured JSON payload
(e.g. `old_data_classifier`'s `proposed_field_mapping` object, or
`smart_followup_draft`'s channel/message/subject fields), and the status
vocabularies don't match what this sprint requires. `ai_agent_trace_events`
and `ai_agent_outputs` are therefore new, complementary tables for a
different (per-request, schema-validated, structured) model — not a
replacement for the Phase-5 tables, which keep working exactly as before.

## Role and entity policies (RLS)

Both tables enable RLS. Neither grants `INSERT`/`UPDATE`/`DELETE` to
`authenticated` — every write in this sprint comes from the Edge Function's
service-role client, after the function has already done its own role +
ownership check in code (same pattern as `sales-os-api`).

- **`ai_agent_trace_events`** — `SELECT`: `requested_by = auth.uid()` OR
  `is_platform_admin(auth.uid())` (the existing `system_admin` + executive +
  `sales_manager` "administer / audit visibility" predicate — reused rather
  than a new hardcoded role list, and it naturally covers both "commercial
  managers" and "system-level roles" from the sprint brief in one check).
- **`ai_agent_outputs`** — `SELECT`: `(requested_by = auth.uid() AND
  (entity_id IS NULL OR ai_output_entity_still_owned(...)))` OR
  `is_commercial_manager(auth.uid())`. The `ai_output_entity_still_owned()`
  helper approximates "still has access to the linked entity" as continued
  ownership for every entity type that has an owner column
  (opportunities/rfqs/tenders/quotations/companies/contacts — companies uses
  `account_owner_id`); the import staging tables have no owner column at all
  and fall through to `true`, since role membership — already enforced at
  creation time — is the only access gate that exists for those. **This is a
  disclosed simplification**, not a literal per-permission-system replay.
- No `DELETE` policy on either table; `REVOKE DELETE ... FROM authenticated`
  is explicit in the migration even though no `DELETE` grant was ever issued.

## Error codes

| Code | Meaning |
|---|---|
| `AI_UNAUTHENTICATED` | No/invalid JWT |
| `AI_NOT_CONFIGURED` | Provider unsupported, or API key/model env var missing — graceful fallback, HTTP 200 |
| `AI_AGENT_NOT_ALLOWED` | Unknown agent, or caller's role cannot run it |
| `AI_ENTITY_NOT_ALLOWED` | `entityType` not in this agent's allowlist |
| `AI_RECORD_ACCESS_DENIED` | Caller doesn't own the record and isn't a commercial manager |
| `AI_INPUT_INVALID` | Malformed JSON, schema mismatch, oversized input, or record not found |
| `AI_CONTEXT_TOO_LARGE` | Loaded context exceeded the agent's max record count |
| `AI_PROVIDER_TIMEOUT` | Provider call exceeded `AI_REQUEST_TIMEOUT_MS` |
| `AI_PROVIDER_ERROR` | Provider returned a non-2xx response or the network call failed |
| `AI_RESPONSE_PARSE_FAILED` | Provider response body was not valid JSON |
| `AI_OUTPUT_VALIDATION_FAILED` | Parsed JSON didn't match the agent's zod output schema |
| `AI_GUARDRAIL_REJECTED` | Output was schema-valid but tripped the prohibited-action/execution-claim/URL scanner, or exceeded the output size limit |
| `AI_OUTPUT_PERSIST_FAILED` | The DB insert for `ai_agent_outputs` itself failed |
| `AI_UNKNOWN_ERROR` | Last-resort catch-all — never a raw stack trace |

`AI_UNAUTHENTICATED` and `AI_UNKNOWN_ERROR` are additions beyond the sprint
brief's listed set — both are needed for the flow to have no unhandled
branch (an auth failure and a truly unexpected exception both need a stable
code) and are included for completeness.

## Graceful fallback behavior

If the resolved provider has no API key or no model configured:
`{ ok: false, code: "AI_NOT_CONFIGURED", message: "AI service is not
configured.", traceId }`, **HTTP 200**, plus a trace event with
`status = "skipped"`, `error_code = "AI_NOT_CONFIGURED"`. No output row is
ever created. The specific missing variable name is never named to the
caller — only recorded implicitly (the trace event exists; the env
inspection to know *which* var is missing is a server-side/dashboard
concern, not a response-body concern).

If the provider times out or errors: a `failed` trace event is written, no
partial output row, and a stable error code (`AI_PROVIDER_TIMEOUT` /
`AI_PROVIDER_ERROR`) is returned. There is no retry loop — a single provider
call already carries its own bounded timeout, and retrying a timed-out or
erroring synchronous request risks doubling latency/cost for no clear
benefit over letting the human retry deliberately from the UI.

## Prohibited actions

`ai-guardrails.ts`'s `PROHIBITED_ACTIONS` constant: `send_email`,
`send_whatsapp`, `send_message`, `delete_record`, `hard_delete`,
`change_owner`, `change_stage`, `mark_won`, `mark_lost`, `approve_contract`,
`approve_quotation`, `approve_tender`, `commit_import`, `execute_import`,
`merge_records`, `modify_roles`, `run_automations`.

`scanForGuardrailViolations()` recursively scans the **parsed, schema-valid**
structured output for any of these tokens embedded in free text, for
first-person execution-claim phrasing ("I sent...", "I approved...", etc.),
and for any embedded URL (none of the three agents in this sprint have a
legitimate reason to return one). Any hit rejects the entire output —
`AI_GUARDRAIL_REJECTED`, no partial/sanitized save. This runs in addition to,
not instead of, the tight zod schemas — defense in depth against a provider
smuggling a prohibited term inside an otherwise well-formed field.

## Idempotency

An optional `clientRequestId` in the request scopes a unique index:
`(requested_by, agent_key, client_request_id)` — partial (`WHERE
client_request_id IS NOT NULL`) so requests that never supply one don't
collide with each other. If a matching `ai_agent_outputs` row already exists
for this exact key, the orchestrator returns it immediately: no new trace
event, no provider call, no duplicate row. This check runs before role/access
re-validation, immediately after the agent is resolved from the registry.

## Manual review lifecycle

Every output is created `pending_review` and stays there — this sprint
implements no accept/reject/apply action of any kind, on the frontend or the
backend. `reviewed_by`, `reviewed_at`, and `review_decision` exist on
`ai_agent_outputs` for a future sprint to populate through a new, explicitly
gated action (almost certainly routed through `sales-os-api` or a dedicated
review endpoint, following the same "authorize in code, write with
service-role" pattern used throughout this backend) — not through a direct
client-side `UPDATE`, since `authenticated` has no write grant on this table.

## Future UI integration

No new screen was built in this sprint — `src/lib/ai-orchestrator-actions.ts`
is a thin, typed wrapper (`runAiAgent({ agent, entityType, entityId, input,
clientRequestId })`) that any future page can call to display a staged
result. It deliberately has no field for a system prompt, model, or SQL, and
performs no sensitive action or auto-apply. A natural next step (a later
sprint) would surface `runAiAgent("opportunity_evaluation", ...)` as a button
on the opportunity detail page and render the returned `result` read-only
next to a manual "mark reviewed" action once that review endpoint exists.

## Deployment procedure

1. Code review + CI (`typecheck-build`, `playwright-smoke`) on the Draft PR.
2. Migration preflight against PHC AGENT (`lrfdtoexyeghrzynapyn`), read-only:
   confirm `20260711180000_ai_orchestrator.sql` is the only pending
   migration, confirm the two new tables don't already exist, confirm
   `is_platform_admin`/`is_commercial_manager` exist with the expected
   signatures.
3. Explicit approval, then `supabase db push --linked` for that one
   migration only.
4. Explicit approval, then `supabase functions deploy ai-orchestrator
   --project-ref lrfdtoexyeghrzynapyn` — this function only, never a
   blanket "deploy all functions."
5. Set secrets via `supabase secrets set` (not committed anywhere, not
   printed to any log): `AI_PROVIDER`, and the key/model pair for whichever
   provider is chosen. Until this step runs, the function is deployed but
   returns `AI_NOT_CONFIGURED` for every request — safe by default.
6. Controlled UAT: call each of the three agents against a real record with
   a test provider key, confirm `pending_review` rows appear with the
   correct `structured_output` shape, confirm a deliberately-missing-role
   caller gets `AI_RECORD_ACCESS_DENIED`/`AI_AGENT_NOT_ALLOWED`, confirm the
   idempotency key prevents a double-submit from creating two rows.
7. Merge only after UAT passes.

## Rollback procedure

- **Function**: redeploy the previous `ai-orchestrator` version (or remove
  the function) via `supabase functions deploy` — this never touches any
  other function (`sales-os-api`, `import-pipeline` are independently
  versioned and unaffected).
- **Secrets**: `supabase secrets unset OPENAI_API_KEY ANTHROPIC_API_KEY
  AI_PROVIDER ...` immediately reverts the function to the graceful
  `AI_NOT_CONFIGURED` fallback without needing a redeploy — the fastest
  possible "turn it off" lever if something looks wrong in production.
- **Migration**: both new tables are strictly additive (no existing table
  altered, no existing column touched, no existing RLS policy modified) — a
  rollback migration would simply `DROP TABLE IF EXISTS public.
  ai_agent_outputs, public.ai_agent_trace_events CASCADE;` and `DROP
  FUNCTION IF EXISTS public.ai_output_entity_still_owned;`. Given the tables
  are additive and no other table references them via foreign key, this is
  safe to do at any time without touching CRM data.
