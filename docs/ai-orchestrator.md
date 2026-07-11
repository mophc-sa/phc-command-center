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
        |-- role + ownership check (ai-guardrails.ts, reuses roles.ts helpers)
        |-- atomic request claim, only if clientRequestId supplied
        |     (claim_ai_agent_request() RPC + ai_agent_requests; see
        |      "Concurrent request claiming" below — a duplicate-succeeded
        |      claim returns the existing output immediately; a duplicate
        |      still-processing claim returns AI_REQUEST_IN_PROGRESS; only
        |      the claimant proceeds)
        |-- insert "started" trace event (ai_agent_trace_events) — write is
        |     checked; abort with AI_TRACE_PERSIST_FAILED if it fails, before
        |     any context load or provider call
        |-- load minimal context (agent's own loadContext)
        |-- enforce context size — record count AND character length (ai-guardrails.ts)
        |-- build prompt (ai-prompts.ts, versioned, system/context separated)
        |-- resolve provider config (ai-providers.ts, env-driven, bounded timeout)
        |-- call provider with timeout (ai-providers.ts)
        |-- validate structured output (agent's zod output schema)
        |-- scan for guardrail violations (ai-guardrails.ts)
        |-- insert ai_agent_outputs (status = pending_review) — preserved even
        |     if the next two writes fail
        |-- mark claim succeeded + insert "succeeded" trace event — both
        |     checked; either failing returns AI_TRACE_PERSIST_FAILED
        |     (carrying outputId), never a silent ok:true
        v
{ ok: true, traceId, outputId, agent, status: "pending_review", result }
```

### Shared modules

| File | Responsibility | Portable to `bun test`? |
|---|---|---|
| `supabase/functions/_shared/ai-schemas.ts` | zod request/output/error-code schemas | yes (bare `"zod"` specifier, see below) |
| `supabase/functions/_shared/ai-guardrails.ts` | allowlists, role/ownership checks, size limits, prompt-injection delimiting, prohibited-action scanner | yes |
| `supabase/functions/_shared/ai-prompts.ts` | versioned prompt templates, one per agent | yes |
| `supabase/functions/_shared/ai-providers.ts` | provider-neutral `generateStructured()`, OpenAI/Anthropic adapters, env resolution, bounded timeout | yes (env + fetch are dependency-injected) |
| `supabase/functions/_shared/ai-idempotency.ts` | interprets the claim RPC's result into a typed outcome (claimed / duplicate-processing / duplicate-succeeded / error) | yes |
| `supabase/functions/_shared/ai-agent-registry.ts` | `AGENT_REGISTRY` — context loaders + wiring | no (needs a live `SupabaseClient`, like `_shared/supabase.ts`) |
| `supabase/functions/ai-orchestrator/index.ts` | HTTP entry point, orchestration flow | no (Deno-only: `Deno.serve`, `Deno.env`) |
| `src/lib/ai-orchestrator-actions.ts` | thin typed frontend wrapper | n/a (frontend) |

Five of the six shared modules have zero Deno-specific APIs and are unit
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
| `AI_REQUEST_TIMEOUT_MS` | Per-call timeout in ms. Bounded to `[1000, 60000]` (`MIN_TIMEOUT_MS`/`MAX_TIMEOUT_MS` in `ai-providers.ts`); unset, non-numeric, or out-of-bounds values fall back to the 20000ms default. Never unlimited. |
| `AI_MAX_INPUT_CHARS` | Bounded client-input size limit, read via `resolveMaxInputChars()` in `ai-guardrails.ts`. Bounded to `[500, 20000]` (`MIN_INPUT_CHARS_BOUND`/`MAX_INPUT_CHARS_BOUND`); unset, non-numeric, or out-of-bounds values fall back to the 4000-char default (`DEFAULT_MAX_INPUT_CHARS`). |

Both bounded variables follow the same rule: an operator can tune the value,
but never outside a sane range, and an invalid value never disables the
limit — it falls back to a safe default instead of failing open.

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
`mapped_data`, `status` — `raw_data`/`mapped_data` each individually
truncated to 3000 characters with a `…[truncated, N chars total]` marker if
larger, so one oversized staged cell can't blow past the context budget);
its parent `import_batches`' status/source type/target entity/total rows;
the batch's detected column headers (`import_files.column_names`, capped to
the first 50); up to 15 already-chosen `import_mappings` for the batch
(substituting for a "field dictionary" table, which does not exist in this
schema — confirmed during discovery); up to 4 `import_duplicate_candidates`
for the row (table/id/match type/confidence — already-safe references, not
full records). The 15/4 query limits are deliberately chosen so
`1 (the row) + 15 + 4 = 20` can never exceed `MAX_CONTEXT_RECORDS` (20) —
previously this loader could load up to 26 records on a wide/well-mapped
batch, self-rejecting with `AI_CONTEXT_TOO_LARGE` on entirely ordinary data
(Required Fix 4). The fully-built context text is also checked against a
hard character cap (`MAX_CONTEXT_CHARS`, 12000) independent of record count,
for every agent, not just this one.

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

Write order is strict and one-directional: role/access check -> claim (if
`clientRequestId` supplied) -> `started` event -> context load -> provider
call -> output validation -> guardrail scan -> **insert `ai_agent_outputs`**
-> mark claim succeeded + **insert `succeeded` event**. If anything fails
before the output insert, no output row is ever written — only a
`failed`/`rejected`/`skipped` trace event (and the claim, if one was made, is
released back to `'failed'` so a legitimate retry isn't blocked for the
staleness window).

**Every trace write is checked, not fired-and-forgotten** (`insertTraceEvent`
returns `{ok:true} | {ok:false}`, and every call site inspects it):
- If the `started` event fails to write, the request **aborts before any
  context load or provider call** and returns `AI_TRACE_PERSIST_FAILED` —
  there is no path that can produce a successful output with zero
  corresponding trace rows.
- If the output insert succeeds but the `succeeded` event (or the claim's
  succeeded-status update) then fails, the response is **not** a silent
  `ok:true`. It's `{ok:false, code:"AI_TRACE_PERSIST_FAILED", traceId,
  outputId}` — the output row itself is never deleted or rolled back; it's
  preserved for reconciliation (see "Reconciliation" below), and the
  response carries `outputId` specifically so a human/ops can locate it.

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

All three tables enable RLS. None grants `INSERT`/`UPDATE`/`DELETE` to
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
- **`ai_agent_requests`** — no policy at all for `authenticated` (RLS
  enabled, zero grants, zero SELECT policy). This table is purely internal
  concurrency-control plumbing (Required Fix 2); its outcome is always
  surfaced back to the caller through the `ai-orchestrator` response itself
  (an existing output, or `AI_REQUEST_IN_PROGRESS`), so there is no reason
  for a client to read it directly.
- No `DELETE` policy on any of the three tables; `REVOKE DELETE ... FROM
  authenticated` is explicit in the migration for the two audit-facing
  tables even though no `DELETE` grant was ever issued.

**`requested_by` and user deletion (Required Fix 5)**: all three tables use
`requested_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL` — never
`ON DELETE CASCADE` — matching this codebase's own `audit_log.actor_id`
convention. Deleting a user account nulls `requested_by` on their historical
rows instead of deleting the rows. This is safe by construction, not by
special-casing: `requested_by = auth.uid()` is simply never `true` when
`requested_by` is `NULL` (SQL's `NULL = x` semantics), so a nulled row
silently drops out of the "own rows" branch of both SELECT policies above —
nothing is broadened, something is narrowed. Only `is_platform_admin`/
`is_commercial_manager` can still see it, exactly as intended for a
preserved-but-de-attributed audit record.

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
| `AI_GUARDRAIL_REJECTED` | Output was schema-valid but tripped the prohibited-action/execution-claim/unsafe-URL scanner, or exceeded the output size limit |
| `AI_OUTPUT_PERSIST_FAILED` | The DB insert for `ai_agent_outputs` itself failed |
| `AI_REQUEST_IN_PROGRESS` | A concurrent request with the same idempotency key (`requested_by`+`agent_key`+`entity_type`+`entity_id`+`clientRequestId`) is already being processed — HTTP 409, the caller should not retry immediately |
| `AI_IDEMPOTENCY_CONFLICT` | The same idempotency key was reused with a genuinely different request payload (different `input` and/or effective `provider` override) than the one that originally claimed it — HTTP 409, before any provider call; see "Payload-conflict fingerprint" under Idempotency |
| `AI_TRACE_PERSIST_FAILED` | The output was validated and persisted, but the terminal trace event and/or the request-claim's succeeded status could not be recorded — the output is preserved; see "Reconciliation" |
| `AI_UNKNOWN_ERROR` | Last-resort catch-all — never a raw stack trace |

`AI_UNAUTHENTICATED`, `AI_REQUEST_IN_PROGRESS`, `AI_TRACE_PERSIST_FAILED`, and
`AI_UNKNOWN_ERROR` are additions beyond the sprint brief's originally-listed
set — each is needed for the flow to have no unhandled or silently-incorrect
branch, and each is included for completeness.

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
structured output for any of these tokens embedded in free text, and for
first-person execution-claim phrasing ("I sent...", "I approved...", etc.).
Any hit rejects the entire output — `AI_GUARDRAIL_REJECTED`, no
partial/sanitized save. This runs in addition to, not instead of, the tight
zod schemas — defense in depth against a provider smuggling a prohibited
term inside an otherwise well-formed field.

**URL handling (Required Fix 6)**: a plain `https://` citation is *not*
rejected on its own — `old_data_classifier` in particular routinely has a
legitimate reason to reference a source/evidence URL, and treating every URL
as a violation produced real false positives on valid output. Two narrower
things are still hard-blocked, in any field:
1. **Non-http(s) URL protocols** (`javascript:`, `data:`, `file:`,
   `vbscript:`, `about:`, `blob:`) — no legitimate use in any of the three
   agents' output, and classic XSS/local-file-access vectors if this text
   were ever rendered as HTML by a careless reviewer UI.
2. **An http(s) URL framed as something to act on**, not cite — text
   matching `ACTION_URL_CONTEXT` in `ai-guardrails.ts` (e.g. "call this
   webhook", "post this to", "trigger this endpoint") appearing alongside a
   URL. None of the three agents' schemas have an actual tool/action field a
   provider could use to trigger a real call, so this is defense in depth
   against misleading a human reviewer into manually visiting/triggering
   something — not a technical remote-execution vector.

## Idempotency

An optional `clientRequestId` in the request scopes uniqueness to
`(requested_by, agent_key, entity_type, entity_id, client_request_id)` —
**entity-scoped** (Required Fix 1). Reusing the same `clientRequestId`
against a *different* entity can never match an existing row from a
different entity — the two are simply different keys. The same exact
request (identical entity too) reliably returns the same existing output.
`ai_agent_outputs`' idempotency index is partial (`WHERE client_request_id
IS NOT NULL`) so requests that never supply one don't collide with each
other; requests with no `clientRequestId` at all are never deduplicated
(idempotency remains opt-in, matching the original design).

### Payload-conflict fingerprint (post-launch hardening)

The 5-field scope above identifies *which* logical request a caller means,
but on its own it cannot tell whether two calls under the same key actually
carried the *same* content. A follow-up read-only inspection confirmed this
as a real gap: reusing a `clientRequestId` against the same entity with
genuinely different `input` (or a different admin `provider` override) used
to be silently treated as a replay of the *first* call — the caller got the
first request's result back, and the second, different request left no
trace at all.

This is closed with a **SHA-256 request fingerprint**
(`supabase/functions/_shared/ai-fingerprint.ts`,
`computeRequestFingerprint()`), computed over the canonical, caller-controlled
semantic content of the request — `input`, plus the *effective* provider
override (`null` unless the caller is both admin-authorized to override the
provider and actually supplied one; a non-admin's ignored `provider` value
never affects the fingerprint, since it never affects execution either).
Canonicalization recursively sorts object keys, preserves array order and
`null`-vs-absent distinctness, and omits `undefined` — so two calls that are
semantically identical always fingerprint identically regardless of key
order or incidental formatting. **Raw input is never stored anywhere** —
only the 64-character lowercase hex digest is persisted, in a new nullable
`ai_agent_requests.request_fingerprint text` column, and only the digest is
ever compared — never the canonical JSON string, which this module does not
even expose as a public function.

`claim_ai_agent_request()` now accepts a trailing `_input_fingerprint text
DEFAULT NULL` argument and, once it finds an existing row for the 5-field
key, compares it against that row's stored fingerprint **before** deciding
whether to reclaim or report the row:

- **Same scope + matching (or previously-unset) fingerprint**: unchanged
  behavior — the existing succeeded/processing/failed/stale-processing
  outcomes all apply exactly as documented above and in "Concurrent request
  claiming" below. A failed or stale-processing row can only be *reclaimed*
  when the supplied fingerprint matches (or either side has no fingerprint
  to compare, see the legacy note below) — it is never silently reclaimed
  out from under a genuinely different retry payload.
- **Same scope + a different, non-null fingerprint**: a deterministic
  **`AI_IDEMPOTENCY_CONFLICT`** (HTTP 409) is returned instead — before any
  provider call, before any context is loaded, before any
  `ai_agent_outputs` row is created — regardless of whether the existing row
  is currently processing, stale-processing, failed, or succeeded. The
  existing row's status, trace_id, and fingerprint are never touched. The
  idempotency key's semantic meaning can never change after its initial
  claim. The error response is generic and non-leaking: *"The idempotency
  key was already used with a different request payload."* — never the old
  input, the new input, the canonical JSON, the fingerprint itself, or any
  provider/internal SQL detail. A single `ai_agent_trace_events` row with
  `status: "rejected"` and `error_code: "AI_IDEMPOTENCY_CONFLICT"` is
  appended for auditability (metadata carries only `reason:
  "idempotency_payload_conflict"` plus the existing safe fields — never the
  fingerprint or raw input); no new schema/enum change was needed for this,
  since `"rejected"` was already a valid trace status.
- **Legacy rows with `request_fingerprint IS NULL`**: rows claimed *before*
  this fix shipped were never asked for a fingerprint and have none stored.
  These are **not backfilled** — the original caller input was never stored
  anywhere, so there is nothing authentic to backfill. `claim_ai_agent_request()`
  treats a `NULL` on either side of the comparison as "unverifiable," not as
  "matching" — it falls through to the pre-fix reclaim/duplicate logic
  unchanged, exactly as it always has. This is a **documented,
  intentional, backward-compatible gap for pre-fix rows only** — it is not
  claimed to be payload-verified. Once such a row is naturally reclaimed by
  a genuinely new attempt (post-fix), it receives a real fingerprint and is
  fully protected going forward.

**Migration-before-deployment sequencing**: `_input_fingerprint` has
`DEFAULT NULL` specifically so the *currently deployed* Edge Function
(which does not know this parameter exists) keeps calling
`claim_ai_agent_request()` successfully in the window between the migration
being applied and `ai-orchestrator` being redeployed — Postgres always
resolves the named-argument call the same way it did before, and every
comparison in the RPC treats a missing fingerprint as "unverifiable"
rather than failing. Adding the parameter also required explicitly
`DROP FUNCTION IF EXISTS ...(uuid, text, text, uuid, text, uuid, integer);`
before recreating it with the new signature — `CREATE OR REPLACE` alone
does not replace a function whose parameter list changed; it would instead
create a second, overloaded function and make PostgREST's named-argument
RPC calls genuinely ambiguous during that same transition window.

**Rollback**: the added column is additive and nullable
(`DROP COLUMN request_fingerprint` fully reverses it with no data loss to
anything else); the RPC can be reverted with the same
`DROP FUNCTION ... ; CREATE OR REPLACE FUNCTION ...` pattern back to the
7-argument signature. On the function side, redeploying the previous
`ai-orchestrator` version immediately stops supplying/expecting a
fingerprint at all — since the parameter always had a default, an
un-migrated database and a rolled-back function remain mutually compatible
in either direction.

## Concurrent request claiming

The `ai_agent_outputs` unique index above is a **final data-integrity
backstop**, not the primary defense against two simultaneous requests both
calling the provider (Required Fix 2) — by the time two concurrent requests
would collide there, both have already paid for a provider call. The actual
defense is `public.ai_agent_requests` plus the `claim_ai_agent_request()`
RPC (both in the migration), called once the caller is confirmed authorized
and before any provider call:

- **Brand-new key** → RPC inserts a `processing` claim row and returns
  `claimed=true`. The caller proceeds normally.
- **A fresh, still-processing duplicate** (the archetypal double-click race)
  → the RPC's `INSERT` hits the unique constraint, its reclaim `UPDATE`'s
  `WHERE` clause doesn't match (not `failed`, not stale), so it returns
  `claimed=false, status='processing'`. The orchestrator returns
  `AI_REQUEST_IN_PROGRESS` (HTTP 409) **without calling the provider**.
- **A completed duplicate** → `claimed=false, status='succeeded'`, carrying
  the winning request's `output_id`. The orchestrator fetches and returns
  that existing output directly — no new provider call, no new trace event.
- **A previously failed or abandoned (stale) claim** → the RPC's reclaim
  `UPDATE` matches (`status='failed'`, or `status='processing'` with
  `updated_at` older than the staleness threshold — default 120s, well above
  `AI_REQUEST_TIMEOUT_MS`'s own 20s default so a genuinely in-flight request
  is never stolen from itself) and returns `claimed=true`. The caller
  proceeds normally — this is the stale/crashed-request recovery path: an
  Edge Function instance that crashed mid-flight leaves its claim in
  `processing` forever otherwise, so the staleness window is what makes a
  retry eventually succeed instead of being permanently blocked.

**Atomicity**: the RPC's fast path is a single `INSERT`; a concurrent second
caller's `INSERT` blocks on Postgres's own unique-index locking until the
first commits, then raises `unique_violation` and falls into the reclaim
`UPDATE` — whose `WHERE` clause no longer matches (the first caller's row is
now `processing` with a fresh `updated_at`). At most one caller can ever have
`claimed=true` for a given key at a given time; this is enforced by Postgres
itself, not by application-level coordination.

`ai-idempotency.ts`'s `interpretClaimRpcResult()` is the pure mapping from
the RPC's raw row to the four outcomes above — split out specifically so
this logic has real unit tests (`ai-idempotency.test.ts`) independent of the
Deno-only orchestrator file that calls it.

**A request with no `clientRequestId` is never claimed at all** — the whole
mechanism above is skipped, and the request always calls the provider
directly (matching the original opt-in idempotency design).

## Reconciliation

`AI_TRACE_PERSIST_FAILED` (returned after the output is already saved but
the terminal trace/claim write failed) always carries the `outputId` needed
to find the affected row. To find every output whose terminal trace event
never made it — e.g. to sweep for these after an incident:

```sql
SELECT o.id, o.trace_id, o.agent_key, o.created_at
FROM public.ai_agent_outputs o
LEFT JOIN public.ai_agent_trace_events t
  ON t.trace_id = o.trace_id AND t.status = 'succeeded'
WHERE t.id IS NULL
ORDER BY o.created_at DESC;
```

Every row this returns is a real, valid, already-reviewable output — nothing
about the trace-write failure invalidates the AI result itself. The query is
find-only; no automated cleanup/deletion is implemented for this in this
sprint, matching "no hard-delete workflow for AI traces or outputs."

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

`serviceClient()` (in `_shared/supabase.ts`, shared by all three Edge
Functions including this one) resolves its privileged Supabase API key
through `_shared/service-key-resolver.ts` — preferring the new-format
`SUPABASE_SECRET_KEYS["default"]` (`sb_secret_...`) and falling back to the
legacy `SUPABASE_SERVICE_ROLE_KEY` only when the new variable isn't set at
all. See `docs/deployment-governance.md`'s "Privileged Server Keys" section
for the full precedence rules, the Cloudflare SSR admin client's separate
migration path, and the rule against ever printing a raw key value.

1. Code review + CI (`typecheck-build`, `playwright-smoke`) on the Draft PR.
2. Migration preflight against PHC AGENT (`lrfdtoexyeghrzynapyn`), read-only:
   confirm `20260711180000_ai_orchestrator.sql` is the only pending
   migration, confirm none of the three new tables (`ai_agent_trace_events`,
   `ai_agent_outputs`, `ai_agent_requests`) already exist, confirm
   `is_platform_admin`/`is_commercial_manager` exist with the expected
   signatures.
3. Explicit approval, then `supabase db push --linked` for that one
   migration only.
4. Explicit approval, then deploy **with the import map explicitly
   specified** — required for the bare `"zod"` specifier in `ai-schemas.ts`
   to resolve (see "A note on `npm:` specifiers" above):
   ```
   supabase functions deploy ai-orchestrator \
     --project-ref lrfdtoexyeghrzynapyn \
     --import-map supabase/functions/import_map.json
   ```
   This function only, never a blanket "deploy all functions."
5. Set secrets via `supabase secrets set` (not committed anywhere, not
   printed to any log): `AI_PROVIDER`, and the key/model pair for whichever
   provider is chosen. Until this step runs, the function is deployed but
   returns `AI_NOT_CONFIGURED` for every request — safe by default.
6. Controlled UAT: call each of the three agents against a real record with
   a test provider key, confirm `pending_review` rows appear with the
   correct `structured_output` shape, confirm a deliberately-missing-role
   caller gets `AI_RECORD_ACCESS_DENIED`/`AI_AGENT_NOT_ALLOWED`, confirm the
   idempotency key prevents a double-submit from creating two rows, confirm
   a genuinely concurrent double-submit (two requests fired near-
   simultaneously with the same `clientRequestId`) produces exactly one
   provider call and one output — the second response should be either the
   first's result or `AI_REQUEST_IN_PROGRESS`, never a second independent
   result.
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
- **Migration**: all three new tables are strictly additive (no existing
  table altered, no existing column touched, no existing RLS policy
  modified) — a rollback migration would simply
  `DROP TABLE IF EXISTS public.ai_agent_requests, public.ai_agent_outputs,
  public.ai_agent_trace_events CASCADE;` (drop the claim table first, since
  it has an FK to `ai_agent_outputs`) and
  `DROP FUNCTION IF EXISTS public.ai_output_entity_still_owned;` /
  `DROP FUNCTION IF EXISTS public.claim_ai_agent_request;`. Given the tables
  are additive and no *existing* table references them via foreign key, this
  is safe to do at any time without touching CRM data.
