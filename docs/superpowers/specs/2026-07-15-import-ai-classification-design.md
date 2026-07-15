# PR 2 — Import AI Classification & Routing (7 Agents)

**Date:** 2026-07-15  
**Branch:** `feature/import-ai-classification`  
**Depends on:** PR 1 (merged — `feat(data-import): Import Intelligence v2 foundation`, commit `47eb171`)

---

## 1. Goal

Wire seven new AI agents into the existing import pipeline so that every manual, error-prone step in the flow has an AI assist: auto-classifying what a file contains, suggesting column mappings, splitting multi-entity rows, resolving relationships, interpreting recurring-file changes, and providing a final advisory review before approval.

All agents use the existing `ai-orchestrator` Edge Function and its full safety stack (idempotency, guardrails, audit trail, Zod output validation, provider fallback).

---

## 2. Import Flow & Agent Trigger Points

```
upload → parse → [workbook_classifier] [sheet_classifier]
       → map   → [semantic_field_mapper]
       → validate → [entity_extractor] → [relationship_resolver]
       → duplicate_review → [change_interpreter]
       → pending_approval → [import_routing_reviewer]
       → approve → dry_run → commit
```

Each agent is triggered **on demand** by a button in the batch detail UI at its step. No server-side chaining. The user can skip any agent and proceed manually.

---

## 3. Agent Definitions

### 3.1 `workbook_classifier`

| Field | Value |
|---|---|
| Fires at | After parse, before mapping |
| Entity type | `import_batches` |
| Roles | All import-capable roles |
| Button label | "Classify with AI" |

**Context loaded:** batch metadata + `import_files.column_names` + first 5 preview rows from `import_rows`.

**Output schema:**
```ts
{
  detected_source_kind: SourceKind,          // "client_relations" | "project_reference" | etc.
  detected_entity_type: ImportTargetEntity,  // "companies" | "contacts" | "leads" | "opportunities" | "projects" | "boq"
  confidence: number,                        // 0–1
  rationale: string,                         // max 500 chars
  sheet_summary: { sheet_name: string, row_count: number, notes: string }[],  // max 20
  warnings: string[],                        // max 10, max 300 chars each
}
```

**UI behaviour:** If `confidence >= 0.8`, the entity-type selector on the mapping step is pre-filled with the suggestion (user can override). Below 0.8, the suggestion appears as a chip with a question mark — user must explicitly accept.

---

### 3.2 `sheet_classifier`

| Field | Value |
|---|---|
| Fires at | After parse — button enabled only when `import_files.sheet_count > 1` |
| Entity type | `import_batches` (batch has FK to file — avoids adding `import_files` to `ENTITY_TYPES`) |
| Roles | All import-capable roles |
| Button label | "Classify Sheets" |

**Note:** `import_files` needs a `sheet_count int4` column (added in the migration). The parse handler already reads `wb.SheetNames` for xlsx — it writes this count to `import_files` at parse time. The UI disables the button when `sheet_count <= 1` or file type is csv.

**Context loaded:** batch metadata + linked file metadata (sheet_names, sheet_count, column_names) loaded via `import_files` FK from the batch.

**Output schema:**
```ts
{
  sheets: {
    sheet_name: string,
    detected_entity_type: ImportTargetEntity,
    confidence: number,
    recommended_action: "import" | "skip" | "review",
    rationale: string,                    // max 300 chars
  }[],                                    // max 20
  recommended_primary_sheet: string,
  warnings: string[],                     // max 10
}
```

**UI behaviour:** Sheet selector panel shows an AI badge per sheet: entity type, confidence %, and recommended action (colour-coded). User picks which sheet(s) to import.

---

### 3.3 `semantic_field_mapper`

| Field | Value |
|---|---|
| Fires at | During mapping step |
| Entity type | `import_batches` |
| Roles | All import-capable roles |
| Button label | "Suggest Mappings" |

**Context loaded:** batch target entity + source column names + up to 3 sample values per column + existing `import_mappings` rows for this batch.

**Output schema:**
```ts
{
  proposals: {
    source_column: string,
    suggested_target: string,    // CRM field name or "__skip__" or "__extra_data__"
    confidence: number,
    rationale: string,           // max 300 chars
  }[],                           // max 100
  unmapped_columns: string[],    // columns the agent couldn't confidently map
  warnings: string[],            // max 10
}
```

**UI behaviour:** Each unmapped column row in the mapping table shows an "AI suggests: {field} ({pct}%)" chip. Clicking Accept calls the existing `saveMappings` action for that column. Dismiss hides the chip. AI suggestions never auto-apply.

---

### 3.4 `entity_extractor`

| Field | Value |
|---|---|
| Fires at | After validate |
| Entity type | `import_batches` |
| Roles | All import-capable roles |
| Button label | "Extract Entities" |

**Context loaded:** batch + up to 20 valid `import_rows` with their `mapped_data`.

**Output schema:**
```ts
{
  split_proposals: {
    source_row_id: string,         // UUID of the import_row
    entities: {
      entity_type: ImportTargetEntity,
      proposed_payload: Record<string, unknown>,
      role: string,                // e.g. "primary_contact", "linked_company"
    }[],                           // min 2 (only rows that need splitting)
  }[],                             // max 50
  multi_entity_count: number,      // total rows that contain >1 entity
  rationale: string,               // max 500 chars
}
```

**Staging mechanic:** On accept, the output is parsed and rows are inserted into `import_split_proposals`. User reviews each proposal and accepts/rejects individually. Accepted proposals are inserted into `import_rows` as new rows with `row_status = 'ai_split'` and flow through the rest of the pipeline normally.

---

### 3.5 `relationship_resolver`

| Field | Value |
|---|---|
| Fires at | After entity_extractor — button enabled only when `import_split_proposals` has ≥ 1 accepted row |
| Entity type | `import_batches` |
| Roles | All import-capable roles |
| Button label | "Resolve Relationships" |

**Context loaded:** accepted `import_split_proposals` rows + top 10 companies + top 10 contacts from live CRM (name only, for matching hints).

**Output schema:**
```ts
{
  links: {
    from_entity_ref: string,       // source_row_id or split_proposal_id
    to_entity_ref: string,
    relationship_type: string,     // e.g. "contact_of", "subsidiary_of", "linked_opportunity"
    confidence: number,
    rationale: string,             // max 300 chars
  }[],                             // max 100
  unresolved: {
    entity_ref: string,
    reason: string,
  }[],                             // max 50
}
```

**UI behaviour:** Relationship panel renders a flat list of proposed links. Accept/Dismiss per link. Accepted links are stored as `extra_data` hints on the corresponding `import_rows` for the commit step.

---

### 3.6 `change_interpreter`

| Field | Value |
|---|---|
| Fires at | Duplicate review step — button enabled only when `batch.source_profile_id` is not null |
| Entity type | `import_batches` |
| Roles | All import-capable roles |
| Button label | "Interpret Changes" |

**Context loaded:** current batch stats (total_rows, valid_rows, error_rows, duplicate_rows, created_at) + previous batch stats for the same `source_profile_id` + up to 20 sample `import_duplicate_candidates` with matched fields.

**Output schema:**
```ts
{
  change_summary: string,              // max 500 chars — human-readable delta narrative
  new_records_count: number,
  updated_records_count: number,
  removed_records_count: number,
  notable_changes: {
    description: string,               // max 300 chars
    severity: "info" | "warning" | "critical",
  }[],                                 // max 20
  confidence: number,
  recommended_action: "proceed" | "review" | "hold",
}
```

**UI behaviour:** Summary card rendered above the duplicate table with the narrative, delta counts, and notable changes. `recommended_action = "hold"` shows a prominent warning banner — does not block the user from proceeding.

---

### 3.7 `import_routing_reviewer`

| Field | Value |
|---|---|
| Fires at | pending_approval step — button enabled only when batch status is `pending_approval` |
| Entity type | `import_batches` |
| Roles | Approve-capable roles only (managing_director, general_manager, ceo, sales_manager) |
| Button label | "Run Final Review" |

**Context loaded:** full batch summary (status, row counts, entity type, source kind, readiness checklist) + summaries of any prior agent outputs for this batch (agent key + output_type + created_at — not the full output payload, to stay within context limits).

**Output schema:**
```ts
{
  overall_recommendation: "approve" | "review" | "hold",
  confidence: number,
  findings: {
    severity: "info" | "warning" | "critical",
    title: string,               // max 100 chars
    description: string,         // max 300 chars
  }[],                           // max 20
  requires_human_review: true,   // literal — always true, validated by Zod
}
```

**UI behaviour:** Findings list rendered in the approval panel with colour-coded severity badges. The Approve button remains enabled regardless of findings (advisory only). A "critical" finding shows a prominent warning chip on the Approve button itself but does not disable it.

---

## 4. New Database Table

### `import_split_proposals`

Staging table for `entity_extractor` output. Rows here represent proposed splits of multi-entity import rows, pending human review before becoming real `import_rows`.

```sql
create table import_split_proposals (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references import_batches(id) on delete cascade,
  source_row_id   uuid not null references import_rows(id) on delete cascade,
  entity_type     text not null,
  proposed_payload jsonb not null default '{}',
  role            text,
  ai_output_id    uuid references ai_agent_outputs(id) on delete set null,
  review_status   text not null default 'pending'
                  check (review_status in ('pending','accepted','rejected')),
  reviewed_by     uuid references auth.users(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- RLS: same read/write access as import_batches
-- Index: (batch_id, review_status)
```

---

## 5. Files Changed

| File | Change |
|---|---|
| `_shared/ai-schemas.ts` | Add 7 output schemas; wire into `AGENT_OUTPUT_SCHEMAS` / `AGENT_OUTPUT_TYPES` |
| `_shared/ai-prompts.ts` | Add 7 prompt builders |
| `_shared/ai-guardrails.ts` | Add 7 entries to `AGENT_ENTITY_ALLOWLIST` + `AGENT_ROLE_CHECK` |
| `_shared/ai-agent-registry.ts` | Add 7 registry entries with context loaders |
| `src/routes/_authenticated/data-import.$batchId.tsx` | Add AI trigger buttons + result panels at each step |
| `supabase/migrations/YYYYMMDD_import_split_proposals.sql` | New table + `sheet_count` column on `import_files` |
| `src/integrations/supabase/types.ts` | Add `ImportSplitProposal` type |

No changes to `import-pipeline/index.ts` or `ai-orchestrator/index.ts`.

---

## 6. Agent Dependency Enforcement (Frontend)

All enforced via button `disabled` state — no server-side chaining:

| Agent | Enabled when |
|---|---|
| `workbook_classifier` | batch status is `mapping` |
| `sheet_classifier` | batch status is `mapping` AND `import_files.sheet_count > 1` |
| `semantic_field_mapper` | batch status is `mapping` |
| `entity_extractor` | batch status is `duplicate_review` or `pending_approval` |
| `relationship_resolver` | `import_split_proposals` has ≥ 1 accepted row for this batch |
| `change_interpreter` | batch has a `source_profile_id` AND status is `duplicate_review` |
| `import_routing_reviewer` | batch status is `pending_approval` AND caller has approve role |

---

## 7. Error Handling

- **Agent failure:** Error toast at the trigger button. Step not blocked. User can retry or skip.
- **Split proposal staging failure:** UI shows "Retry staging" option that re-parses the stored `ai_agent_outputs` row and re-inserts proposals.
- **Partial mapper proposals:** Unmapped columns stay unmapped — no error. User handles manually.
- **Routing reviewer with no prior agent outputs:** Valid — reviewer notes the absence in its findings and recommends "review."

---

## 8. Testing

- **Zod schema tests** — valid + invalid cases for all 7 schemas, following `src/lib/ai-schemas.test.ts` pattern
- **TypeScript gate** — `tsc --noEmit` must pass; `AGENT_OUTPUT_SCHEMAS satisfies Record<AgentKey, z.ZodType>` enforces coverage at compile time
- **Migration** — idempotent, RLS enabled
- **Manual smoke** — trigger each button, verify output renders, verify accept/dismiss works

Playwright end-to-end tests are deferred to PR 3.

---

## 9. Out of Scope for PR 2

- Server-side agent chaining
- Auto-applying semantic mapper suggestions
- Blocking the Approve button on critical reviewer findings
- Playwright / integration tests
- ProTenders-specific routing (PR 4)
- Recurring file idempotency (PR 5)
