# Import AI Classification & Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 7 new AI agents into the existing import pipeline — workbook_classifier, sheet_classifier, semantic_field_mapper, entity_extractor, relationship_resolver, change_interpreter, import_routing_reviewer — each triggered on demand via a button at its relevant step in the batch detail UI.

**Architecture:** All agents plug into the existing `ai-orchestrator` Edge Function via the `AGENT_REGISTRY` / `AGENT_OUTPUT_SCHEMAS` / `AGENT_PROMPT_BUILDERS` pattern. One new DB table (`import_split_proposals`) stages entity_extractor proposals for human review. All dependency enforcement is frontend-only (disabled buttons).

**Tech Stack:** Deno + Supabase Edge Functions, Zod 4 (via import_map.json `npm:zod@4`), React 19 + TanStack Router, `supabase.functions.invoke`, `@tanstack/react-query`

## Global Constraints

- All 4 registry maps (`AGENT_OUTPUT_SCHEMAS`, `AGENT_OUTPUT_TYPES`, `AGENT_PROMPT_BUILDERS`, `AGENT_REGISTRY`) use `satisfies Record<AgentKey, z.ZodType>` / similar constraints — every new agent key MUST appear in all 4 maps or `tsc` fails.
- Output schemas use `.strict()` — no extra fields allowed through.
- `requires_human_review: z.literal(true)` on `import_routing_reviewer` output — never `z.boolean()`.
- No changes to `ai-orchestrator/index.ts` routing logic.
- `PROMPT_VERSION` must be bumped to `"sprint10.v2"` in `ai-prompts.ts` when adding new prompts.
- Migration naming convention: `20260715HHMMSS_name.sql` (today's date).
- `tsc --noEmit` must pass as the PR exit criterion.
- Run commands from `D:\1-PROJECTS\PHC\phc-command-center-claude`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260715120000_import_split_proposals.sql` | Create | New table + `sheet_count` on `import_files` |
| `supabase/functions/import-pipeline/index.ts` | Modify (1 line) | Write `sheet_count` to `import_files` after xlsx parse |
| `supabase/functions/_shared/ai-schemas.ts` | Modify | 7 output schemas + wire AGENT_OUTPUT_SCHEMAS / AGENT_OUTPUT_TYPES |
| `supabase/functions/_shared/ai-guardrails.ts` | Modify | 7 entries in AGENT_ENTITY_ALLOWLIST + AGENT_ROLE_CHECK |
| `supabase/functions/_shared/ai-prompts.ts` | Modify | 7 prompt builders + AGENT_PROMPT_BUILDERS entries + version bump |
| `supabase/functions/_shared/ai-agent-registry.ts` | Modify | 7 context loaders + AGENT_REGISTRY entries |
| `src/lib/import-actions.ts` | Modify | Client functions: `callImportAgent`, `getSplitProposals`, `reviewSplitProposal`, `acceptSplitProposal`, `getLatestAgentOutput` |
| `src/routes/_authenticated/data-import.$batchId.tsx` | Modify | AI panels at mapping / validate / duplicate_review / pending_approval steps |
| `src/integrations/supabase/types.ts` | Modify | `ImportSplitProposal` type |

---

## Task 1: DB Migration + Parse Handler

**Files:**
- Create: `supabase/migrations/20260715120000_import_split_proposals.sql`
- Modify: `supabase/functions/import-pipeline/index.ts` (line ~377 — add `sheet_count` write)

**Interfaces:**
- Produces: `import_split_proposals` table, `import_files.sheet_count` column

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260715120000_import_split_proposals.sql`:

```sql
-- import_split_proposals: staging table for entity_extractor AI output.
-- Each row is one proposed entity extracted from a multi-entity import row,
-- pending human review before being promoted to a real import_row.

create table if not exists import_split_proposals (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references import_batches(id) on delete cascade,
  source_row_id    uuid not null references import_rows(id) on delete cascade,
  entity_type      text not null,
  proposed_payload jsonb not null default '{}',
  role             text,
  ai_output_id     uuid references ai_agent_outputs(id) on delete set null,
  review_status    text not null default 'pending'
                   check (review_status in ('pending', 'accepted', 'rejected')),
  reviewed_by      uuid references auth.users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists idx_import_split_proposals_batch_status
  on import_split_proposals(batch_id, review_status);

-- sheet_count: number of sheets found in an xlsx workbook.
-- Written by the parse handler; used by the UI to enable sheet_classifier.
alter table import_files
  add column if not exists sheet_count int4 not null default 1;

-- RLS: mirror import_batches access — anyone who can read import_batches
-- can read their split proposals; bd_manager scoped to own batches.
alter table import_split_proposals enable row level security;

create policy "import_split_proposals_read" on import_split_proposals
  for select using (
    exists (
      select 1 from import_batches b
      where b.id = import_split_proposals.batch_id
        and (
          auth.uid() = b.created_by
          or exists (
            select 1 from user_roles ur
            where ur.user_id = auth.uid()
              and ur.role in (
                'system_admin','managing_director','general_manager',
                'ceo','sales_manager','bd_manager'
              )
          )
        )
    )
  );

create policy "import_split_proposals_write" on import_split_proposals
  for all using (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in (
          'system_admin','managing_director','general_manager',
          'ceo','sales_manager','bd_manager'
        )
    )
  );
```

- [ ] **Step 2: Patch parse handler to write sheet_count**

In `supabase/functions/import-pipeline/index.ts`, find the block that updates `import_files` after xlsx parse (~line 377):

```ts
  // Update file with column names and row count
  await svc.from("import_files").update({
    column_names: headers,
    row_count: rows.length,
  }).eq("id", fileId);
```

Replace with:

```ts
  // Update file with column names, row count, and sheet count (xlsx only).
  // sheet_count is used by the UI to enable the sheet_classifier AI button.
  const sheetCountPatch: Record<string, unknown> = {
    column_names: headers,
    row_count: rows.length,
  };
  if (file.file_type === "xlsx") {
    try {
      const { read } = await import("npm:xlsx@0.18.5");
      const ab2 = await (await svc.storage.from("imports").download(file.storage_path)).data?.arrayBuffer();
      if (ab2) {
        const wb2 = read(new Uint8Array(ab2), { type: "array" });
        sheetCountPatch.sheet_count = wb2.SheetNames.length;
      }
    } catch { /* non-fatal — defaults to 1 */ }
  }
  await svc.from("import_files").update(sheetCountPatch).eq("id", fileId);
```

> Note: This re-downloads the file to get SheetNames after the main parse. A simpler alternative: hoist `wb.SheetNames.length` from inside the xlsx parse block (lines ~330-368) into a variable and write it here. Do that instead — it's one variable, no second download:

Find the block `const wb = read(new Uint8Array(ab), { type: "array" });` (inside the xlsx branch) and add directly after it:

```ts
      const sheetCount = wb.SheetNames.length;
```

Then in the `import_files` update patch, add `sheet_count: sheetCount` (declare `let sheetCount = 1;` before the `if (file.file_type === "csv")` branch so it's in scope).

- [ ] **Step 3: Apply migration locally (if Supabase CLI is linked)**

```bash
npx supabase db push
```

If not linked, the migration will be applied in the deploy task. Skip and continue.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260715120000_import_split_proposals.sql \
        supabase/functions/import-pipeline/index.ts
git commit -m "feat(import): add import_split_proposals table + sheet_count on import_files"
```

---

## Task 2: Output Schemas (ai-schemas.ts)

**Files:**
- Modify: `supabase/functions/_shared/ai-schemas.ts`
- Modify (test): `src/lib/ai-schemas.test.ts` (follow existing pattern)

**Interfaces:**
- Produces: 7 Zod schema exports + `AGENT_OUTPUT_SCHEMAS` / `AGENT_OUTPUT_TYPES` updated
- Consumed by: Task 3 (guardrails), Task 4 (prompts), Task 5 (registry)

- [ ] **Step 1: Write failing schema tests**

Open `src/lib/ai-schemas.test.ts` and add at the end (follow existing `describe` blocks):

```ts
describe("workbook_classifier output", () => {
  it("accepts valid output", () => {
    expect(WorkbookClassifierOutputSchema.safeParse({
      detected_source_kind: "client_relations",
      detected_entity_type: "companies",
      confidence: 0.9,
      rationale: "Columns match company CRM fields.",
      sheet_summary: [{ sheet_name: "Sheet1", row_count: 100, notes: "main data" }],
      warnings: [],
    }).success).toBe(true);
  });
  it("rejects missing confidence", () => {
    expect(WorkbookClassifierOutputSchema.safeParse({
      detected_source_kind: "client_relations",
      detected_entity_type: "companies",
      rationale: "x",
      sheet_summary: [],
      warnings: [],
    }).success).toBe(false);
  });
});

describe("sheet_classifier output", () => {
  it("accepts valid output", () => {
    expect(SheetClassifierOutputSchema.safeParse({
      sheets: [{ sheet_name: "Data", detected_entity_type: "leads", confidence: 0.7, recommended_action: "import", rationale: "Lead columns found." }],
      recommended_primary_sheet: "Data",
      warnings: [],
    }).success).toBe(true);
  });
});

describe("semantic_field_mapper output", () => {
  it("accepts valid output", () => {
    expect(SemanticFieldMapperOutputSchema.safeParse({
      proposals: [{ source_column: "Company Name", suggested_target: "name", confidence: 0.95, rationale: "Direct match." }],
      unmapped_columns: ["Notes"],
      warnings: [],
    }).success).toBe(true);
  });
});

describe("entity_extractor output", () => {
  it("accepts valid output", () => {
    expect(EntityExtractorOutputSchema.safeParse({
      split_proposals: [{
        source_row_id: "00000000-0000-0000-0000-000000000001",
        entities: [
          { entity_type: "companies", proposed_payload: { name: "Acme" }, role: "linked_company" },
          { entity_type: "contacts", proposed_payload: { name: "John" }, role: "primary_contact" },
        ],
      }],
      multi_entity_count: 1,
      rationale: "Row contains both company and contact data.",
    }).success).toBe(true);
  });
  it("rejects entity array with fewer than 2 items", () => {
    expect(EntityExtractorOutputSchema.safeParse({
      split_proposals: [{
        source_row_id: "00000000-0000-0000-0000-000000000001",
        entities: [{ entity_type: "companies", proposed_payload: {}, role: "primary" }],
      }],
      multi_entity_count: 1,
      rationale: "x",
    }).success).toBe(false);
  });
});

describe("relationship_resolver output", () => {
  it("accepts valid output", () => {
    expect(RelationshipResolverOutputSchema.safeParse({
      links: [{ from_entity_ref: "row-1", to_entity_ref: "row-2", relationship_type: "contact_of", confidence: 0.8, rationale: "Same company name." }],
      unresolved: [],
    }).success).toBe(true);
  });
});

describe("change_interpreter output", () => {
  it("accepts valid output", () => {
    expect(ChangeInterpreterOutputSchema.safeParse({
      change_summary: "12 new records, 3 updates.",
      new_records_count: 12,
      updated_records_count: 3,
      removed_records_count: 0,
      notable_changes: [{ description: "New region added.", severity: "info" }],
      confidence: 0.85,
      recommended_action: "proceed",
    }).success).toBe(true);
  });
});

describe("import_routing_reviewer output", () => {
  it("accepts valid output", () => {
    expect(ImportRoutingReviewerOutputSchema.safeParse({
      overall_recommendation: "approve",
      confidence: 0.9,
      findings: [{ severity: "info", title: "All AI agents ran.", description: "No issues found." }],
      requires_human_review: true,
    }).success).toBe(true);
  });
  it("rejects requires_human_review: false", () => {
    expect(ImportRoutingReviewerOutputSchema.safeParse({
      overall_recommendation: "approve",
      confidence: 0.9,
      findings: [],
      requires_human_review: false,
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude"
bun test src/lib/ai-schemas.test.ts 2>&1 | tail -20
```

Expected: failures referencing undefined schema exports.

- [ ] **Step 3: Add 7 schemas to ai-schemas.ts**

In `supabase/functions/_shared/ai-schemas.ts`, add after the last existing schema (after `RiskFinanceOutputSchema`, before the `AGENT_OUTPUT_SCHEMAS` map):

```ts
// ---------------------------------------------------------------------------
// Import Intelligence v2 — 7 classification pipeline agents
// ---------------------------------------------------------------------------

const SOURCE_KINDS = [
  "client_relations", "project_reference", "sales_overview",
  "protenders_leads", "quotation_masterlist", "weekly_sales_update", "unknown",
] as const;

const SHEET_RECOMMENDED_ACTIONS = ["import", "skip", "review"] as const;
const CHANGE_RECOMMENDED_ACTIONS = ["proceed", "review", "hold"] as const;
const ROUTING_RECOMMENDATIONS = ["approve", "review", "hold"] as const;
const FINDING_SEVERITIES = ["info", "warning", "critical"] as const;
const CHANGE_SEVERITIES = ["info", "warning", "critical"] as const;

// Agent 8 — workbook_classifier
export const WorkbookClassifierOutputSchema = z
  .object({
    detected_source_kind: z.enum(SOURCE_KINDS),
    detected_entity_type: z.enum(IMPORT_TARGET_ENTITIES),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(500),
    sheet_summary: z
      .array(
        z.object({
          sheet_name: z.string().min(1).max(200),
          row_count: z.number().int().nonnegative(),
          notes: z.string().max(300),
        }).strict(),
      )
      .max(20),
    warnings: z.array(z.string().min(1).max(300)).max(10),
  })
  .strict();
export type WorkbookClassifierOutput = z.infer<typeof WorkbookClassifierOutputSchema>;

// Agent 9 — sheet_classifier
export const SheetClassifierOutputSchema = z
  .object({
    sheets: z
      .array(
        z.object({
          sheet_name: z.string().min(1).max(200),
          detected_entity_type: z.enum(IMPORT_TARGET_ENTITIES),
          confidence: z.number().min(0).max(1),
          recommended_action: z.enum(SHEET_RECOMMENDED_ACTIONS),
          rationale: z.string().min(1).max(300),
        }).strict(),
      )
      .max(20),
    recommended_primary_sheet: z.string().min(1).max(200),
    warnings: z.array(z.string().min(1).max(300)).max(10),
  })
  .strict();
export type SheetClassifierOutput = z.infer<typeof SheetClassifierOutputSchema>;

// Agent 10 — semantic_field_mapper
export const SemanticFieldMapperOutputSchema = z
  .object({
    proposals: z
      .array(
        z.object({
          source_column: z.string().min(1).max(200),
          suggested_target: z.string().min(1).max(200),
          confidence: z.number().min(0).max(1),
          rationale: z.string().min(1).max(300),
        }).strict(),
      )
      .max(100),
    unmapped_columns: z.array(z.string().min(1).max(200)).max(100),
    warnings: z.array(z.string().min(1).max(300)).max(10),
  })
  .strict();
export type SemanticFieldMapperOutput = z.infer<typeof SemanticFieldMapperOutputSchema>;

// Agent 11 — entity_extractor
export const EntityExtractorOutputSchema = z
  .object({
    split_proposals: z
      .array(
        z.object({
          source_row_id: z.string().uuid(),
          entities: z
            .array(
              z.object({
                entity_type: z.enum(IMPORT_TARGET_ENTITIES),
                proposed_payload: z.record(z.string(), z.unknown()),
                role: z.string().min(1).max(100),
              }).strict(),
            )
            .min(2)
            .max(10),
        }).strict(),
      )
      .max(50),
    multi_entity_count: z.number().int().nonnegative(),
    rationale: z.string().min(1).max(500),
  })
  .strict();
export type EntityExtractorOutput = z.infer<typeof EntityExtractorOutputSchema>;

// Agent 12 — relationship_resolver
export const RelationshipResolverOutputSchema = z
  .object({
    links: z
      .array(
        z.object({
          from_entity_ref: z.string().min(1).max(200),
          to_entity_ref: z.string().min(1).max(200),
          relationship_type: z.string().min(1).max(100),
          confidence: z.number().min(0).max(1),
          rationale: z.string().min(1).max(300),
        }).strict(),
      )
      .max(100),
    unresolved: z
      .array(
        z.object({
          entity_ref: z.string().min(1).max(200),
          reason: z.string().min(1).max(300),
        }).strict(),
      )
      .max(50),
  })
  .strict();
export type RelationshipResolverOutput = z.infer<typeof RelationshipResolverOutputSchema>;

// Agent 13 — change_interpreter
export const ChangeInterpreterOutputSchema = z
  .object({
    change_summary: z.string().min(1).max(500),
    new_records_count: z.number().int().nonnegative(),
    updated_records_count: z.number().int().nonnegative(),
    removed_records_count: z.number().int().nonnegative(),
    notable_changes: z
      .array(
        z.object({
          description: z.string().min(1).max(300),
          severity: z.enum(CHANGE_SEVERITIES),
        }).strict(),
      )
      .max(20),
    confidence: z.number().min(0).max(1),
    recommended_action: z.enum(CHANGE_RECOMMENDED_ACTIONS),
  })
  .strict();
export type ChangeInterpreterOutput = z.infer<typeof ChangeInterpreterOutputSchema>;

// Agent 14 — import_routing_reviewer
export const ImportRoutingReviewerOutputSchema = z
  .object({
    overall_recommendation: z.enum(ROUTING_RECOMMENDATIONS),
    confidence: z.number().min(0).max(1),
    findings: z
      .array(
        z.object({
          severity: z.enum(FINDING_SEVERITIES),
          title: z.string().min(1).max(100),
          description: z.string().min(1).max(300),
        }).strict(),
      )
      .max(20),
    requires_human_review: z.literal(true),
  })
  .strict();
export type ImportRoutingReviewerOutput = z.infer<typeof ImportRoutingReviewerOutputSchema>;
```

- [ ] **Step 4: Wire the 7 schemas into AGENT_OUTPUT_SCHEMAS and AGENT_OUTPUT_TYPES**

Replace the existing `AGENT_OUTPUT_SCHEMAS` block:

```ts
export const AGENT_OUTPUT_SCHEMAS = {
  opportunity_evaluation: OpportunityEvaluationOutputSchema,
  old_data_classifier: OldDataClassifierOutputSchema,
  smart_followup_draft: SmartFollowupDraftOutputSchema,
  data_cleanup: DataCleanupOutputSchema,
  contact_mapping: ContactMappingOutputSchema,
  project_radar: ProjectRadarOutputSchema,
  risk_finance: RiskFinanceOutputSchema,
  workbook_classifier: WorkbookClassifierOutputSchema,
  sheet_classifier: SheetClassifierOutputSchema,
  semantic_field_mapper: SemanticFieldMapperOutputSchema,
  entity_extractor: EntityExtractorOutputSchema,
  relationship_resolver: RelationshipResolverOutputSchema,
  change_interpreter: ChangeInterpreterOutputSchema,
  import_routing_reviewer: ImportRoutingReviewerOutputSchema,
} as const satisfies Record<AgentKey, z.ZodType>;
```

Replace the existing `AGENT_OUTPUT_TYPES` block:

```ts
export const AGENT_OUTPUT_TYPES = {
  opportunity_evaluation: "recommendation",
  old_data_classifier: "staged_classification",
  smart_followup_draft: "draft",
  data_cleanup: "staged_classification",
  contact_mapping: "staged_classification",
  project_radar: "recommendation",
  risk_finance: "recommendation",
  workbook_classifier: "staged_classification",
  sheet_classifier: "staged_classification",
  semantic_field_mapper: "staged_classification",
  entity_extractor: "staged_classification",
  relationship_resolver: "staged_classification",
  change_interpreter: "recommendation",
  import_routing_reviewer: "recommendation",
} as const satisfies Record<AgentKey, OutputType>;
```

- [ ] **Step 5: Run tests — should now pass**

```bash
bun test src/lib/ai-schemas.test.ts 2>&1 | tail -20
```

Expected: all schema tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ai-schemas.ts src/lib/ai-schemas.test.ts
git commit -m "feat(ai): add 7 import classification agent output schemas"
```

---

## Task 3: Guardrails + Prompts

**Files:**
- Modify: `supabase/functions/_shared/ai-guardrails.ts`
- Modify: `supabase/functions/_shared/ai-prompts.ts`

**Interfaces:**
- Consumes: `AgentKey` (from ai-schemas.ts Task 2), `canViewSalesAdmin`, `canApproveCommercialAction` (from roles.ts)
- Produces: `AGENT_ENTITY_ALLOWLIST`, `AGENT_ROLE_CHECK` entries; `AGENT_PROMPT_BUILDERS` entries

- [ ] **Step 1: Add 7 entries to AGENT_ENTITY_ALLOWLIST in ai-guardrails.ts**

Find `export const AGENT_ENTITY_ALLOWLIST: Record<AgentKey, readonly EntityType[]> = {` and add 7 entries inside the object (all use `import_batches`):

```ts
  workbook_classifier: ["import_batches"],
  sheet_classifier: ["import_batches"],
  semantic_field_mapper: ["import_batches"],
  entity_extractor: ["import_batches"],
  relationship_resolver: ["import_batches"],
  change_interpreter: ["import_batches"],
  import_routing_reviewer: ["import_batches"],
```

- [ ] **Step 2: Add 7 entries to AGENT_ROLE_CHECK in ai-guardrails.ts**

Find `export const AGENT_ROLE_CHECK: Record<AgentKey, (roles: AppRole[]) => boolean> = {` and add:

```ts
  // Import classification agents — same role gate as the real import pipeline.
  // import_routing_reviewer is approve-role-only (it's the final gate before approval).
  workbook_classifier: (roles) => canViewSalesAdmin(roles),
  sheet_classifier: (roles) => canViewSalesAdmin(roles),
  semantic_field_mapper: (roles) => canViewSalesAdmin(roles),
  entity_extractor: (roles) => canViewSalesAdmin(roles),
  relationship_resolver: (roles) => canViewSalesAdmin(roles),
  change_interpreter: (roles) => canViewSalesAdmin(roles),
  import_routing_reviewer: (roles) => canApproveCommercialAction(roles),
```

- [ ] **Step 3: Bump PROMPT_VERSION in ai-prompts.ts**

Change:
```ts
export const PROMPT_VERSION = "sprint10.v1";
```
To:
```ts
export const PROMPT_VERSION = "sprint10.v2";
```

- [ ] **Step 4: Add 7 prompt builders to ai-prompts.ts**

Add after the `buildRiskFinancePrompt` function, before the `AGENT_PROMPT_BUILDERS` map:

```ts
// ---------------------------------------------------------------------------
// Import Intelligence v2 — Agents 8-14
// ---------------------------------------------------------------------------

const WORKBOOK_CLASSIFIER_INSTRUCTIONS = `
AGENT: workbook_classifier (${PROMPT_VERSION})
Analyze the import batch metadata and sample rows in the CONTEXT block and
determine what kind of PHC data this file contains and which CRM entity type
it should be imported as. You do NOT commit anything — you only classify.

PHC source kinds:
- "client_relations": contacts and companies from PHC's client list
- "project_reference": completed projects used as references/case studies
- "sales_overview": pipeline summary with opportunities and stages
- "protenders_leads": tender leads sourced from ProTenders platform
- "quotation_masterlist": quotations and BOQ items
- "weekly_sales_update": weekly update sheets from sales reps
- "unknown": none of the above

Return a JSON object with exactly these fields:
- detected_source_kind: one of the PHC source kinds above
- detected_entity_type: "companies" | "contacts" | "leads" | "opportunities" | "projects" | "boq"
- confidence: number 0-1
- rationale: string explaining the classification (max 500 chars)
- sheet_summary: array of { sheet_name, row_count, notes } for each sheet detected
- warnings: string[] (anything ambiguous, inconsistent, or that needs human review)
`.trim();

export function buildWorkbookClassifierPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${WORKBOOK_CLASSIFIER_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("import_batch", context),
    version: PROMPT_VERSION,
    schemaName: "workbook_classifier_output",
  };
}

const SHEET_CLASSIFIER_INSTRUCTIONS = `
AGENT: sheet_classifier (${PROMPT_VERSION})
Analyze the multi-sheet xlsx workbook described in the CONTEXT block. For each
sheet, determine what CRM entity type its data represents and whether it should
be imported, skipped, or flagged for manual review. You do NOT import anything.

Return a JSON object with exactly these fields:
- sheets: array of { sheet_name, detected_entity_type, confidence, recommended_action, rationale }
  - recommended_action: "import" (clear data, import it), "skip" (empty or irrelevant),
    "review" (data present but ambiguous entity type or structure)
- recommended_primary_sheet: name of the single most important sheet to import first
- warnings: string[] (max 10, max 300 chars each)
`.trim();

export function buildSheetClassifierPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${SHEET_CLASSIFIER_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("workbook_sheets", context),
    version: PROMPT_VERSION,
    schemaName: "sheet_classifier_output",
  };
}

const SEMANTIC_FIELD_MAPPER_INSTRUCTIONS = `
AGENT: semantic_field_mapper (${PROMPT_VERSION})
Map the source columns from the import file to PHC CRM target fields.
You receive the batch's target entity type, the source column names, up to 3
sample values per column, and any existing mappings already set by the user.
Do NOT overwrite existing user mappings — only propose for unmapped columns.

Valid target values per entity (use exactly these strings):
- companies: name, company_type, cr_number, website_domain, regions, relationship_level, internal_notes, source
- contacts: name, title, phone, email, source
- leads: project_name, location, main_contractor_guess, source
- opportunities: project_name, client, main_contractor, location, sector, estimated_value_min, estimated_value_max, quotation_value, stage, next_action, next_action_due, notes, source
- projects: name, location, sector, project_stage, total_value, completion_pct, signage_package_status, notes, source
- Use "__skip__" for columns the user should ignore.
- Use "__extra_data__" for columns with value but no direct CRM field.

Return a JSON object with exactly these fields:
- proposals: array of { source_column, suggested_target, confidence, rationale }
  - only include columns that do NOT already have a user mapping
  - confidence: 0-1; omit proposals below 0.4 confidence
- unmapped_columns: string[] — source columns you could not map confidently
- warnings: string[] (max 10) — anything unusual about column names or values
`.trim();

export function buildSemanticFieldMapperPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${SEMANTIC_FIELD_MAPPER_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("import_columns", context),
    version: PROMPT_VERSION,
    schemaName: "semantic_field_mapper_output",
  };
}

const ENTITY_EXTRACTOR_INSTRUCTIONS = `
AGENT: entity_extractor (${PROMPT_VERSION})
Identify rows in the import batch where a single row contains data for MULTIPLE
distinct CRM entities (e.g. a row that has both a company name and a contact
name, or a project name and a linked company). For each such row, propose how
to split it into separate entity records.

You do NOT create any records — you only propose splits for a human to review.

Return a JSON object with exactly these fields:
- split_proposals: array of {
    source_row_id: UUID of the import_row (use the exact id from CONTEXT),
    entities: array (min 2) of {
      entity_type: one of the IMPORT_TARGET_ENTITIES,
      proposed_payload: object with the field values for that entity,
      role: a short descriptive label (e.g. "primary_contact", "linked_company")
    }
  }
  - Only include rows that genuinely need splitting (contain >1 entity)
  - Max 50 split proposals
- multi_entity_count: total number of rows in this batch that contain >1 entity
- rationale: string explaining your overall findings (max 500 chars)
`.trim();

export function buildEntityExtractorPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${ENTITY_EXTRACTOR_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("import_rows_sample", context),
    version: PROMPT_VERSION,
    schemaName: "entity_extractor_output",
  };
}

const RELATIONSHIP_RESOLVER_INSTRUCTIONS = `
AGENT: relationship_resolver (${PROMPT_VERSION})
Given a set of entities proposed from an import split (extracted from single
rows), determine how they relate to each other and to existing CRM records.
Propose links between entities so that when they are committed, their
relationships can be preserved.

Relationship types to consider:
- "contact_of": this contact belongs to this company
- "subsidiary_of": this company is a subsidiary of another
- "linked_opportunity": this contact or company is linked to an opportunity
- "duplicate_of": this proposed entity appears to already exist in the CRM

Return a JSON object with exactly these fields:
- links: array of {
    from_entity_ref: source_row_id or split_proposal_id (from CONTEXT),
    to_entity_ref: source_row_id, split_proposal_id, or existing CRM id (from CONTEXT hints),
    relationship_type: one of the types above,
    confidence: 0-1,
    rationale: string max 300 chars
  } (max 100)
- unresolved: array of { entity_ref, reason } for entities you could not link (max 50)
`.trim();

export function buildRelationshipResolverPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${RELATIONSHIP_RESOLVER_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("split_proposals", context),
    version: PROMPT_VERSION,
    schemaName: "relationship_resolver_output",
  };
}

const CHANGE_INTERPRETER_INSTRUCTIONS = `
AGENT: change_interpreter (${PROMPT_VERSION})
This is a recurring import — the same file is uploaded periodically. Compare
the current batch to the previous batch for the same source profile and produce
a human-readable summary of what changed. You do NOT commit anything.

Return a JSON object with exactly these fields:
- change_summary: string — concise narrative of what changed (max 500 chars)
- new_records_count: number — rows in current batch not in previous batch
- updated_records_count: number — rows that appear to update existing records
- removed_records_count: number — records present in previous batch but absent here
- notable_changes: array of { description, severity } (max 20)
  - severity: "info" (routine), "warning" (unexpected but not blocking),
    "critical" (data quality or scope issue that should be reviewed before proceeding)
- confidence: 0-1 — how confident you are in this comparison
- recommended_action: "proceed" | "review" | "hold"
  - "proceed": changes look routine, safe to continue
  - "review": unusual changes detected, human should look before proceeding
  - "hold": significant anomaly (massive drop in records, critical-severity changes) —
    recommend pausing until a human confirms the file is correct
`.trim();

export function buildChangeInterpreterPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${CHANGE_INTERPRETER_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("batch_comparison", context),
    version: PROMPT_VERSION,
    schemaName: "change_interpreter_output",
  };
}

const IMPORT_ROUTING_REVIEWER_INSTRUCTIONS = `
AGENT: import_routing_reviewer (${PROMPT_VERSION})
You are a final advisory reviewer for a data import batch that is about to be
approved for production commit. Review the batch summary and any AI analysis
already performed, then produce a structured findings report for the approving
manager. This is ADVISORY ONLY — your findings do not block approval; the
manager makes the final decision.

Severity guide:
- "info": routine observation, no action needed
- "warning": something to be aware of, but not blocking
- "critical": a potential data quality or process issue the manager should
  consciously acknowledge before approving (does not prevent approval)

Return a JSON object with exactly these fields:
- overall_recommendation: "approve" | "review" | "hold"
  - "approve": batch looks ready
  - "review": one or more warnings worth a second look
  - "hold": one or more critical findings that warrant pausing
- confidence: 0-1
- findings: array of { severity, title (max 100 chars), description (max 300 chars) } (max 20)
- requires_human_review: must always be exactly true
`.trim();

export function buildImportRoutingReviewerPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${IMPORT_ROUTING_REVIEWER_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("import_batch_review", context),
    version: PROMPT_VERSION,
    schemaName: "import_routing_reviewer_output",
  };
}
```

- [ ] **Step 5: Add 7 entries to AGENT_PROMPT_BUILDERS map**

Replace the existing `AGENT_PROMPT_BUILDERS` export:

```ts
export const AGENT_PROMPT_BUILDERS: Record<AgentKey, (context: string) => BuiltPrompt> = {
  opportunity_evaluation: buildOpportunityEvaluationPrompt,
  old_data_classifier: buildOldDataClassifierPrompt,
  smart_followup_draft: buildSmartFollowupDraftPrompt,
  data_cleanup: buildDataCleanupPrompt,
  contact_mapping: buildContactMappingPrompt,
  project_radar: buildProjectRadarPrompt,
  risk_finance: buildRiskFinancePrompt,
  workbook_classifier: buildWorkbookClassifierPrompt,
  sheet_classifier: buildSheetClassifierPrompt,
  semantic_field_mapper: buildSemanticFieldMapperPrompt,
  entity_extractor: buildEntityExtractorPrompt,
  relationship_resolver: buildRelationshipResolverPrompt,
  change_interpreter: buildChangeInterpreterPrompt,
  import_routing_reviewer: buildImportRoutingReviewerPrompt,
};
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ai-guardrails.ts \
        supabase/functions/_shared/ai-prompts.ts
git commit -m "feat(ai): add guardrails and prompts for 7 import classification agents"
```

---

## Task 4: Agent Registry

**Files:**
- Modify: `supabase/functions/_shared/ai-agent-registry.ts`

**Interfaces:**
- Consumes: all schemas from Task 2, all prompt builders from Task 3, guardrails from Task 3
- Produces: 7 entries in `AGENT_REGISTRY` — each with `loadContext`, `checkAccess`, `buildPrompt`, `outputSchema`, `outputType`, `maxContextRecords`

- [ ] **Step 1: Add 7 context loaders and registry entries**

In `ai-agent-registry.ts`, add before the `// Registry` section:

```ts
// ---------------------------------------------------------------------------
// Agents 8-14 — Import Intelligence v2 classification pipeline
// All agents operate on import_batches — no per-record owner concept;
// access is role-gated (matching the real import pipeline).
// ---------------------------------------------------------------------------

async function checkImportAccess(): Promise<AgentAccessResult> {
  return { ok: true };
}

// Agent 8 — workbook_classifier
async function loadWorkbookClassifierContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, source_type, target_entity, total_rows, created_at, ai_suggestions_enabled")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: file } = await svc
    .from("import_files")
    .select("id, file_type, column_names, row_count, sheet_count")
    .eq("batch_id", entityId)
    .limit(1)
    .maybeSingle();

  // Up to 5 preview rows — raw_data only, no mapped_data needed at this stage.
  const { data: previewRows } = await svc
    .from("import_rows")
    .select("row_number, raw_data")
    .eq("batch_id", entityId)
    .order("row_number")
    .limit(5);

  const contextText = JSON.stringify(
    {
      batch: {
        id: batch.id,
        status: batch.status,
        source_type: batch.source_type,
        target_entity: batch.target_entity,
        total_rows: batch.total_rows,
        created_at: batch.created_at,
      },
      file: file
        ? {
            file_type: file.file_type,
            column_names: (file.column_names ?? []).slice(0, 50),
            row_count: file.row_count,
            sheet_count: file.sheet_count ?? 1,
          }
        : null,
      preview_rows: (previewRows ?? []).map((r) => ({
        row_number: r.row_number,
        raw_data: r.raw_data,
      })),
    },
    null,
    2,
  );

  const recordCount = 1 + (file ? 1 : 0) + (previewRows?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["status", "source_type", "target_entity", "total_rows", "file_type", "column_names", "raw_data"],
    record_counts: { import_batches: 1, import_files: file ? 1 : 0, import_rows: previewRows?.length ?? 0 },
    source_entity_types: ["import_batches", "import_files", "import_rows"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 9 — sheet_classifier
async function loadSheetClassifierContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, target_entity")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: file } = await svc
    .from("import_files")
    .select("file_type, column_names, sheet_count, file_name")
    .eq("batch_id", entityId)
    .limit(1)
    .maybeSingle();

  if (!file || file.file_type !== "xlsx") {
    return { ok: false, code: "AI_INPUT_INVALID", message: "sheet_classifier requires an xlsx file." };
  }

  // NOTE: individual per-sheet metadata is not stored in the DB (only the
  // primary sheet's columns are). Context includes what we have — the file
  // name, total sheet count, and primary sheet columns. The agent infers
  // structure from these signals.
  const contextText = JSON.stringify(
    {
      batch: { id: batch.id, target_entity: batch.target_entity },
      workbook: {
        file_name: file.file_name,
        sheet_count: file.sheet_count ?? 1,
        primary_sheet_columns: (file.column_names ?? []).slice(0, 50),
      },
    },
    null,
    2,
  );

  const recordCount = 2;
  const manifest: ContextManifest = {
    fields_loaded: ["file_name", "sheet_count", "column_names", "target_entity"],
    record_counts: { import_batches: 1, import_files: 1 },
    source_entity_types: ["import_batches", "import_files"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 10 — semantic_field_mapper
const MAPPER_SAMPLE_VALUES = 3;
const MAPPER_MAPPINGS_LIMIT = 100;

async function loadSemanticFieldMapperContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, target_entity")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: file } = await svc
    .from("import_files")
    .select("column_names")
    .eq("batch_id", entityId)
    .limit(1)
    .maybeSingle();

  const columns: string[] = (file?.column_names ?? []).slice(0, 100);

  // Up to 3 sample rows for value examples.
  const { data: sampleRows } = await svc
    .from("import_rows")
    .select("raw_data")
    .eq("batch_id", entityId)
    .limit(MAPPER_SAMPLE_VALUES);

  // Build per-column sample values.
  const columnSamples: Record<string, unknown[]> = {};
  for (const col of columns) {
    columnSamples[col] = (sampleRows ?? [])
      .map((r) => (r.raw_data as Record<string, unknown>)?.[col] ?? null)
      .filter((v) => v != null && String(v).trim() !== "");
  }

  // Existing user mappings (don't suggest for these).
  const { data: existingMappings } = await svc
    .from("import_mappings")
    .select("source_column, target_column, is_key")
    .eq("batch_id", entityId)
    .limit(MAPPER_MAPPINGS_LIMIT);

  const mappedColumns = new Set((existingMappings ?? []).map((m) => m.source_column));
  const unmappedColumns = columns.filter((c) => !mappedColumns.has(c));

  const contextText = JSON.stringify(
    {
      batch: { id: batch.id, target_entity: batch.target_entity },
      unmapped_columns: unmappedColumns,
      column_samples: Object.fromEntries(
        unmappedColumns.map((col) => [col, columnSamples[col] ?? []]),
      ),
      existing_mappings: (existingMappings ?? []).map((m) => ({
        source: m.source_column,
        target: m.target_column,
        is_key: m.is_key,
      })),
    },
    null,
    2,
  );

  const recordCount = 1 + (sampleRows?.length ?? 0) + (existingMappings?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["target_entity", "column_names", "raw_data", "source_column", "target_column"],
    record_counts: {
      import_batches: 1,
      import_rows: sampleRows?.length ?? 0,
      import_mappings: existingMappings?.length ?? 0,
    },
    source_entity_types: ["import_batches", "import_files", "import_rows", "import_mappings"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 11 — entity_extractor
const EXTRACTOR_ROWS_LIMIT = 20;

async function loadEntityExtractorContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, target_entity, total_rows")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: rows } = await svc
    .from("import_rows")
    .select("id, row_number, mapped_data, status")
    .eq("batch_id", entityId)
    .eq("status", "valid")
    .order("row_number")
    .limit(EXTRACTOR_ROWS_LIMIT);

  const contextText = JSON.stringify(
    {
      batch: { id: batch.id, target_entity: batch.target_entity, total_rows: batch.total_rows },
      rows: (rows ?? []).map((r) => ({
        id: r.id,
        row_number: r.row_number,
        mapped_data: r.mapped_data,
      })),
    },
    null,
    2,
  );

  const rowCount = rows?.length ?? 0;
  const recordCount = 1 + rowCount;
  const manifest: ContextManifest = {
    fields_loaded: ["target_entity", "total_rows", "id", "row_number", "mapped_data"],
    record_counts: { import_batches: 1, import_rows: rowCount },
    source_entity_types: ["import_batches", "import_rows"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 12 — relationship_resolver
const RESOLVER_PROPOSALS_LIMIT = 20;
const RESOLVER_CRM_HINTS = 10;

async function loadRelationshipResolverContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, target_entity")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  // Accepted split proposals for this batch.
  const { data: proposals } = await svc
    .from("import_split_proposals")
    .select("id, source_row_id, entity_type, proposed_payload, role")
    .eq("batch_id", entityId)
    .eq("review_status", "accepted")
    .limit(RESOLVER_PROPOSALS_LIMIT);

  if (!proposals || proposals.length === 0) {
    return {
      ok: false,
      code: "AI_INPUT_INVALID",
      message: "No accepted split proposals found. Run entity_extractor and accept at least one proposal first.",
    };
  }

  // CRM name hints for matching (name-only — no PII beyond what's in the file already).
  const { data: crmCompanies } = await svc
    .from("companies")
    .select("id, name")
    .order("name")
    .limit(RESOLVER_CRM_HINTS);
  const { data: crmContacts } = await svc
    .from("contacts")
    .select("id, name")
    .order("name")
    .limit(RESOLVER_CRM_HINTS);

  const contextText = JSON.stringify(
    {
      batch: { id: batch.id, target_entity: batch.target_entity },
      accepted_proposals: proposals.map((p) => ({
        proposal_id: p.id,
        source_row_id: p.source_row_id,
        entity_type: p.entity_type,
        proposed_payload: p.proposed_payload,
        role: p.role,
      })),
      crm_hints: {
        companies: (crmCompanies ?? []).map((c) => ({ id: c.id, name: c.name })),
        contacts: (crmContacts ?? []).map((c) => ({ id: c.id, name: c.name })),
      },
    },
    null,
    2,
  );

  const recordCount = 1 + proposals.length + (crmCompanies?.length ?? 0) + (crmContacts?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["entity_type", "proposed_payload", "role", "name"],
    record_counts: {
      import_batches: 1,
      import_split_proposals: proposals.length,
      companies: crmCompanies?.length ?? 0,
      contacts: crmContacts?.length ?? 0,
    },
    source_entity_types: ["import_batches", "import_split_proposals", "companies", "contacts"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 13 — change_interpreter
const CHANGE_DUPES_LIMIT = 20;

async function loadChangeInterpreterContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, source_type, target_entity, total_rows, valid_rows, error_rows, duplicate_rows, source_profile_id, created_at")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  if (!batch.source_profile_id) {
    return {
      ok: false,
      code: "AI_INPUT_INVALID",
      message: "change_interpreter requires a recurring batch (source_profile_id must be set).",
    };
  }

  // Previous batch for the same source profile.
  const { data: prevBatch } = await svc
    .from("import_batches")
    .select("id, status, total_rows, valid_rows, error_rows, duplicate_rows, created_at, committed_at")
    .eq("source_profile_id", batch.source_profile_id)
    .neq("id", entityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Sample duplicate candidates to understand what changed.
  const { data: dupes } = await svc
    .from("import_duplicate_candidates")
    .select("match_type, match_scope, confidence, matched_fields, suggested_action")
    .eq("batch_id", entityId)
    .limit(CHANGE_DUPES_LIMIT);

  const contextText = JSON.stringify(
    {
      current_batch: {
        id: batch.id,
        status: batch.status,
        target_entity: batch.target_entity,
        total_rows: batch.total_rows,
        valid_rows: batch.valid_rows,
        error_rows: batch.error_rows,
        duplicate_rows: batch.duplicate_rows,
        created_at: batch.created_at,
      },
      previous_batch: prevBatch
        ? {
            id: redactId(prevBatch.id),
            total_rows: prevBatch.total_rows,
            valid_rows: prevBatch.valid_rows,
            error_rows: prevBatch.error_rows,
            duplicate_rows: prevBatch.duplicate_rows,
            created_at: prevBatch.created_at,
            committed_at: prevBatch.committed_at,
          }
        : null,
      duplicate_sample: (dupes ?? []).map((d) => ({
        match_type: d.match_type,
        match_scope: d.match_scope,
        confidence: d.confidence,
        matched_fields: d.matched_fields,
        suggested_action: d.suggested_action,
      })),
    },
    null,
    2,
  );

  const recordCount = 1 + (prevBatch ? 1 : 0) + (dupes?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["status", "total_rows", "valid_rows", "error_rows", "duplicate_rows", "match_type", "confidence"],
    record_counts: {
      import_batches: prevBatch ? 2 : 1,
      import_duplicate_candidates: dupes?.length ?? 0,
    },
    source_entity_types: ["import_batches", "import_duplicate_candidates"],
    redacted_identifiers: { batch_id: redactId(entityId), prev_batch_id: redactId(prevBatch?.id) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 14 — import_routing_reviewer
const REVIEWER_OUTPUTS_LIMIT = 10;

async function loadImportRoutingReviewerContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, source_type, target_entity, total_rows, valid_rows, error_rows, duplicate_rows, dry_run, readiness_checklist, ai_suggestions_enabled, created_at")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  // Summaries of prior agent outputs for this batch (not full payloads — just metadata).
  const { data: priorOutputs } = await svc
    .from("ai_agent_outputs")
    .select("agent_key, output_type, status, created_at")
    .eq("entity_id", entityId)
    .eq("entity_type", "import_batches")
    .order("created_at", { ascending: false })
    .limit(REVIEWER_OUTPUTS_LIMIT);

  const contextText = JSON.stringify(
    {
      batch: {
        id: batch.id,
        status: batch.status,
        source_type: batch.source_type,
        target_entity: batch.target_entity,
        total_rows: batch.total_rows,
        valid_rows: batch.valid_rows,
        error_rows: batch.error_rows,
        duplicate_rows: batch.duplicate_rows,
        dry_run: batch.dry_run,
        readiness_checklist: batch.readiness_checklist,
        ai_suggestions_enabled: batch.ai_suggestions_enabled,
        created_at: batch.created_at,
      },
      prior_ai_analysis: (priorOutputs ?? []).map((o) => ({
        agent: o.agent_key,
        output_type: o.output_type,
        status: o.status,
        ran_at: o.created_at,
      })),
    },
    null,
    2,
  );

  const recordCount = 1 + (priorOutputs?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["status", "target_entity", "total_rows", "valid_rows", "error_rows", "duplicate_rows", "readiness_checklist", "agent_key", "output_type"],
    record_counts: { import_batches: 1, ai_agent_outputs: priorOutputs?.length ?? 0 },
    source_entity_types: ["import_batches", "ai_agent_outputs"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}
```

- [ ] **Step 2: Add 7 entries to AGENT_REGISTRY**

Inside the `AGENT_REGISTRY` object after the `risk_finance` entry, add:

```ts
  workbook_classifier: {
    key: "workbook_classifier",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.workbook_classifier,
    hasRole: AGENT_ROLE_CHECK.workbook_classifier,
    checkAccess: checkImportAccess,
    loadContext: loadWorkbookClassifierContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.workbook_classifier,
    outputSchema: AGENT_OUTPUT_SCHEMAS.workbook_classifier,
    outputType: AGENT_OUTPUT_TYPES.workbook_classifier,
    maxContextRecords: 10,
    allowProviderFallback: true,
  },
  sheet_classifier: {
    key: "sheet_classifier",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.sheet_classifier,
    hasRole: AGENT_ROLE_CHECK.sheet_classifier,
    checkAccess: checkImportAccess,
    loadContext: loadSheetClassifierContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.sheet_classifier,
    outputSchema: AGENT_OUTPUT_SCHEMAS.sheet_classifier,
    outputType: AGENT_OUTPUT_TYPES.sheet_classifier,
    maxContextRecords: 5,
    allowProviderFallback: true,
  },
  semantic_field_mapper: {
    key: "semantic_field_mapper",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.semantic_field_mapper,
    hasRole: AGENT_ROLE_CHECK.semantic_field_mapper,
    checkAccess: checkImportAccess,
    loadContext: loadSemanticFieldMapperContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.semantic_field_mapper,
    outputSchema: AGENT_OUTPUT_SCHEMAS.semantic_field_mapper,
    outputType: AGENT_OUTPUT_TYPES.semantic_field_mapper,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  entity_extractor: {
    key: "entity_extractor",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.entity_extractor,
    hasRole: AGENT_ROLE_CHECK.entity_extractor,
    checkAccess: checkImportAccess,
    loadContext: loadEntityExtractorContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.entity_extractor,
    outputSchema: AGENT_OUTPUT_SCHEMAS.entity_extractor,
    outputType: AGENT_OUTPUT_TYPES.entity_extractor,
    maxContextRecords: 25,
    allowProviderFallback: true,
  },
  relationship_resolver: {
    key: "relationship_resolver",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.relationship_resolver,
    hasRole: AGENT_ROLE_CHECK.relationship_resolver,
    checkAccess: checkImportAccess,
    loadContext: loadRelationshipResolverContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.relationship_resolver,
    outputSchema: AGENT_OUTPUT_SCHEMAS.relationship_resolver,
    outputType: AGENT_OUTPUT_TYPES.relationship_resolver,
    maxContextRecords: 45,
    allowProviderFallback: true,
  },
  change_interpreter: {
    key: "change_interpreter",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.change_interpreter,
    hasRole: AGENT_ROLE_CHECK.change_interpreter,
    checkAccess: checkImportAccess,
    loadContext: loadChangeInterpreterContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.change_interpreter,
    outputSchema: AGENT_OUTPUT_SCHEMAS.change_interpreter,
    outputType: AGENT_OUTPUT_TYPES.change_interpreter,
    maxContextRecords: 25,
    allowProviderFallback: true,
  },
  import_routing_reviewer: {
    key: "import_routing_reviewer",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.import_routing_reviewer,
    hasRole: AGENT_ROLE_CHECK.import_routing_reviewer,
    checkAccess: checkImportAccess,
    loadContext: loadImportRoutingReviewerContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.import_routing_reviewer,
    outputSchema: AGENT_OUTPUT_SCHEMAS.import_routing_reviewer,
    outputType: AGENT_OUTPUT_TYPES.import_routing_reviewer,
    maxContextRecords: 15,
    allowProviderFallback: true,
  },
```

- [ ] **Step 3: Import the new schemas in ai-agent-registry.ts**

At the top of the file, the import from `./ai-schemas.ts` must include the new schema exports. Find:

```ts
import {
  AGENT_OUTPUT_SCHEMAS,
  AGENT_OUTPUT_TYPES,
  ...
} from "./ai-schemas.ts";
```

These maps already include all 14 entries (added in Task 2) — no new named imports needed since the registry uses `AGENT_OUTPUT_SCHEMAS[key]` lookups, not direct schema references.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/ai-agent-registry.ts
git commit -m "feat(ai): add 7 import classification agent registry entries and context loaders"
```

---

## Task 5: Import Actions (Client-Side)

**Files:**
- Modify: `src/lib/import-actions.ts`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Produces:
  - `callImportAgent(batchId, agent, input?) → Promise<AiAgentCallResult>`
  - `getLatestAgentOutput(batchId, agent) → Promise<AiAgentOutput | null>`
  - `getSplitProposals(batchId) → Promise<ImportSplitProposal[]>`
  - `reviewSplitProposal(proposalId, status: 'accepted'|'rejected') → Promise<void>`
  - `stageSplitProposals(batchId, outputId, proposals) → Promise<void>`
  - `acceptSplitProposalToRow(proposalId) → Promise<void>`

- [ ] **Step 1: Add ImportSplitProposal type to types.ts**

In `src/integrations/supabase/types.ts`, add with the other import-related types:

```ts
export type ImportSplitProposal = {
  id: string;
  batch_id: string;
  source_row_id: string;
  entity_type: string;
  proposed_payload: Record<string, unknown>;
  role: string | null;
  ai_output_id: string | null;
  review_status: "pending" | "accepted" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type AiAgentOutput = {
  id: string;
  agent_key: string;
  entity_type: string;
  entity_id: string;
  output_type: string;
  status: string;
  result: Record<string, unknown>;
  created_at: string;
};

export type AiAgentCallResult =
  | { ok: true; outputId: string; traceId: string; result: Record<string, unknown> }
  | { ok: false; code: string; message: string; traceId: string | null };
```

- [ ] **Step 2: Add 6 functions to import-actions.ts**

Add at the end of `src/lib/import-actions.ts`:

```ts
// =============================================================================
// AI agent helpers — Import Intelligence v2
// =============================================================================

import type { AiAgentCallResult, AiAgentOutput, ImportSplitProposal } from "@/integrations/supabase/types";

/**
 * Call the ai-orchestrator for an import-scoped agent.
 * All import classification agents use entityType="import_batches".
 */
export async function callImportAgent(
  batchId: string,
  agent: string,
  input: Record<string, unknown> = {},
): Promise<AiAgentCallResult> {
  const { data, error } = await supabase.functions.invoke("ai-orchestrator", {
    body: {
      agent,
      entityType: "import_batches",
      entityId: batchId,
      input,
    },
  });

  if (error) {
    return { ok: false, code: "AI_UNKNOWN_ERROR", message: error.message, traceId: null };
  }

  return data as AiAgentCallResult;
}

/**
 * Fetch the most recent ai_agent_outputs row for a given batch + agent.
 * Returns null if the agent has not run yet.
 */
export async function getLatestAgentOutput(
  batchId: string,
  agent: string,
): Promise<AiAgentOutput | null> {
  const { data } = await db
    .from("ai_agent_outputs")
    .select("id, agent_key, entity_type, entity_id, output_type, status, result, created_at")
    .eq("entity_id", batchId)
    .eq("entity_type", "import_batches")
    .eq("agent_key", agent)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

/**
 * List all split proposals for a batch.
 */
export async function getSplitProposals(batchId: string): Promise<ImportSplitProposal[]> {
  const { data } = await db
    .from("import_split_proposals")
    .select("*")
    .eq("batch_id", batchId)
    .order("created_at");

  return (data ?? []) as ImportSplitProposal[];
}

/**
 * Update the review_status of a split proposal (accept or reject).
 */
export async function reviewSplitProposal(
  proposalId: string,
  status: "accepted" | "rejected",
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  await db
    .from("import_split_proposals")
    .update({
      review_status: status,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", proposalId);
}

/**
 * Stage entity_extractor AI output: parse the result and insert rows into
 * import_split_proposals. Idempotent — existing proposals for the same
 * ai_output_id are not re-inserted.
 */
export async function stageSplitProposals(
  batchId: string,
  aiOutputId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  splitProposals: Array<{ source_row_id: string; entities: Array<{ entity_type: string; proposed_payload: Record<string, unknown>; role: string }> }>,
): Promise<void> {
  // Check for existing proposals from this output to keep idempotency.
  const { count } = await db
    .from("import_split_proposals")
    .select("*", { count: "exact", head: true })
    .eq("ai_output_id", aiOutputId);

  if ((count ?? 0) > 0) return; // already staged

  const rows = splitProposals.flatMap((sp) =>
    sp.entities.map((e) => ({
      batch_id: batchId,
      source_row_id: sp.source_row_id,
      entity_type: e.entity_type,
      proposed_payload: e.proposed_payload,
      role: e.role,
      ai_output_id: aiOutputId,
      review_status: "pending",
    })),
  );

  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += 100) {
    await db.from("import_split_proposals").insert(rows.slice(i, i + 100));
  }
}

/**
 * Promote an accepted split proposal into a real import_row so it flows
 * through the rest of the pipeline (validate → commit).
 */
export async function acceptSplitProposalToRow(
  proposal: ImportSplitProposal,
  batchId: string,
  nextRowNumber: number,
): Promise<void> {
  await db.from("import_rows").insert({
    batch_id: batchId,
    file_id: null, // AI-generated row, not from file
    row_number: nextRowNumber,
    raw_data: proposal.proposed_payload,
    mapped_data: proposal.proposed_payload,
    status: "valid",
    row_status: "ai_split",
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/import-actions.ts src/integrations/supabase/types.ts
git commit -m "feat(import): add client-side AI agent helpers and split proposal actions"
```

---

## Task 6: UI — Mapping Step AI Panel

**Files:**
- Modify: `src/routes/_authenticated/data-import.$batchId.tsx`

Adds AI panels for `workbook_classifier`, `sheet_classifier`, and `semantic_field_mapper` at the mapping step. All buttons are disabled when `busy` is set or the batch is not in `mapping` status.

**Interfaces:**
- Consumes: `callImportAgent`, `getLatestAgentOutput` from Task 5
- Produces: `MappingAiPanel` component (inlined in the route file)

- [ ] **Step 1: Add query + state for mapping AI**

In `BatchDetailPage`, after the existing `const [aiRunning, setAiRunning] = useState(false);` line, add:

```tsx
const [mappingAiOutput, setMappingAiOutput] = useState<Record<string, unknown> | null>(null);
const [mappingAiAgent, setMappingAiAgent] = useState<string>("");
const [sheetAiOutput, setSheetAiOutput] = useState<Record<string, unknown> | null>(null);
const [mapperProposals, setMapperProposals] = useState<Array<{
  source_column: string; suggested_target: string; confidence: number; rationale: string; dismissed: boolean;
}>>([]);
```

- [ ] **Step 2: Add the mapping-step AI panel**

Find the JSX section that renders the mapping step (look for `"Mapped"` / `map` step tab content or the mapping table). Add this panel above the column mapping table:

```tsx
{/* Mapping Step AI Panel — shown when batch is in mapping status */}
{batch?.status === "mapping" && (
  <div className="mb-4 rounded-lg border border-muted bg-muted/30 p-4 space-y-4">
    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Sparkles className="h-4 w-4" />
      AI Assist
    </div>

    {/* workbook_classifier */}
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={aiRunning}
        onClick={async () => {
          setAiRunning(true);
          setAiStep("workbook_classifier");
          try {
            const r = await callImportAgent(batchId, "workbook_classifier");
            if (r.ok) {
              setMappingAiAgent("workbook_classifier");
              setMappingAiOutput(r.result as Record<string, unknown>);
              toast.success("Workbook classified");
            } else {
              toast.error(r.message);
            }
          } finally {
            setAiRunning(false);
            setAiStep("");
          }
        }}
      >
        {aiRunning && aiStep === "workbook_classifier" ? (
          <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Classifying…</>
        ) : (
          <><Sparkles className="mr-2 h-3 w-3" />Classify with AI</>
        )}
      </Button>
      <span className="text-xs text-muted-foreground">Auto-detect what entity type this file contains</span>
    </div>

    {/* workbook_classifier result */}
    {mappingAiAgent === "workbook_classifier" && mappingAiOutput && (
      <div className="rounded border border-border bg-background p-3 text-sm space-y-1">
        <div className="font-medium">
          Detected: <span className="text-primary">{String(mappingAiOutput.detected_entity_type)}</span>
          {" "}({String(mappingAiOutput.detected_source_kind)})
          <span className="ml-2 text-muted-foreground">
            {Math.round(Number(mappingAiOutput.confidence) * 100)}% confidence
          </span>
        </div>
        <div className="text-muted-foreground text-xs">{String(mappingAiOutput.rationale)}</div>
        {(mappingAiOutput.warnings as string[])?.length > 0 && (
          <div className="mt-1 text-amber-400 text-xs">
            {(mappingAiOutput.warnings as string[]).join(" · ")}
          </div>
        )}
      </div>
    )}

    {/* sheet_classifier — only when file has multiple sheets */}
    {(files?.[0]?.sheet_count ?? 1) > 1 && (
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={aiRunning}
          onClick={async () => {
            setAiRunning(true);
            setAiStep("sheet_classifier");
            try {
              const r = await callImportAgent(batchId, "sheet_classifier");
              if (r.ok) {
                setSheetAiOutput(r.result as Record<string, unknown>);
                toast.success("Sheets classified");
              } else {
                toast.error(r.message);
              }
            } finally {
              setAiRunning(false);
              setAiStep("");
            }
          }}
        >
          {aiRunning && aiStep === "sheet_classifier" ? (
            <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Classifying Sheets…</>
          ) : (
            <><Sparkles className="mr-2 h-3 w-3" />Classify Sheets</>
          )}
        </Button>
        <span className="text-xs text-muted-foreground">Recommend which sheet(s) to import</span>
      </div>
    )}

    {/* sheet_classifier result */}
    {sheetAiOutput && (
      <div className="rounded border border-border bg-background p-3 text-sm space-y-1">
        <div className="font-medium mb-1">Sheet recommendations:</div>
        {(sheetAiOutput.sheets as Array<{ sheet_name: string; detected_entity_type: string; confidence: number; recommended_action: string; rationale: string }>).map((s) => (
          <div key={s.sheet_name} className="flex items-center gap-2 text-xs">
            <span className={cn(
              "px-1.5 py-0.5 rounded text-[10px] font-medium",
              s.recommended_action === "import" ? "bg-emerald-500/20 text-emerald-400" :
              s.recommended_action === "skip"   ? "bg-muted text-muted-foreground" :
                                                  "bg-amber-500/20 text-amber-400",
            )}>
              {s.recommended_action}
            </span>
            <span className="font-mono">{s.sheet_name}</span>
            <span className="text-muted-foreground">→ {s.detected_entity_type} ({Math.round(s.confidence * 100)}%)</span>
          </div>
        ))}
      </div>
    )}

    {/* semantic_field_mapper */}
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={aiRunning}
        onClick={async () => {
          setAiRunning(true);
          setAiStep("semantic_field_mapper");
          try {
            const r = await callImportAgent(batchId, "semantic_field_mapper");
            if (r.ok) {
              const result = r.result as { proposals: Array<{ source_column: string; suggested_target: string; confidence: number; rationale: string }> };
              setMapperProposals(
                (result.proposals ?? []).map((p) => ({ ...p, dismissed: false })),
              );
              toast.success(`${result.proposals?.length ?? 0} mapping suggestions ready`);
            } else {
              toast.error(r.message);
            }
          } finally {
            setAiRunning(false);
            setAiStep("");
          }
        }}
      >
        {aiRunning && aiStep === "semantic_field_mapper" ? (
          <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Suggesting…</>
        ) : (
          <><Sparkles className="mr-2 h-3 w-3" />Suggest Mappings</>
        )}
      </Button>
      <span className="text-xs text-muted-foreground">AI proposes target fields for unmapped columns</span>
    </div>
  </div>
)}
```

- [ ] **Step 3: Wire mapper proposals into the mapping table rows**

Inside the mapping table row render (where each source column is listed), add a proposal chip after the target-column selector. Find the source column loop and add:

```tsx
{/* AI mapping proposal chip */}
{(() => {
  const proposal = mapperProposals.find(
    (p) => p.source_column === mapping.source_column && !p.dismissed,
  );
  if (!proposal) return null;
  return (
    <div className="mt-1 flex items-center gap-1 text-xs">
      <Sparkles className="h-3 w-3 text-violet-400" />
      <span className="text-muted-foreground">
        AI suggests: <span className="text-violet-400 font-medium">{proposal.suggested_target}</span>
        {" "}({Math.round(proposal.confidence * 100)}%)
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 px-1 text-xs text-emerald-400"
        onClick={() => {
          // Apply suggestion via existing saveMappings action
          saveMappings(batchId, [{ source_column: proposal.source_column, target_column: proposal.suggested_target, is_key: false }])
            .then(() => qc.invalidateQueries({ queryKey: ["import-mappings", batchId] }));
          setMapperProposals((prev) =>
            prev.map((p) => p.source_column === proposal.source_column ? { ...p, dismissed: true } : p),
          );
        }}
      >
        Accept
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 px-1 text-xs text-muted-foreground"
        onClick={() =>
          setMapperProposals((prev) =>
            prev.map((p) => p.source_column === proposal.source_column ? { ...p, dismissed: true } : p),
          )
        }
      >
        Dismiss
      </Button>
    </div>
  );
})()}
```

- [ ] **Step 4: Add missing import for callImportAgent**

At the top of `data-import.$batchId.tsx`, add to the import-actions import list:

```tsx
import {
  // ... existing imports ...
  callImportAgent,
  type AiAgentCallResult,
} from "@/lib/import-actions";
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/data-import.\$batchId.tsx
git commit -m "feat(import-ui): add mapping step AI panel (workbook_classifier, sheet_classifier, semantic_field_mapper)"
```

---

## Task 7: UI — Extraction Panel (entity_extractor + relationship_resolver)

**Files:**
- Modify: `src/routes/_authenticated/data-import.$batchId.tsx`

Added at the validate/duplicate_review step.

**Interfaces:**
- Consumes: `callImportAgent`, `getSplitProposals`, `reviewSplitProposal`, `stageSplitProposals`, `acceptSplitProposalToRow` from Task 5
- Consumes: `ImportSplitProposal` type from Task 5

- [ ] **Step 1: Add state and query for split proposals**

In `BatchDetailPage`, add:

```tsx
const [extractorRunning, setExtractorRunning] = useState(false);
const [resolverRunning, setResolverRunning] = useState(false);
const [resolverOutput, setResolverOutput] = useState<Record<string, unknown> | null>(null);

const { data: splitProposals = [], refetch: refetchSplits } = useQuery<ImportSplitProposal[]>({
  queryKey: ["import-split-proposals", batchId],
  queryFn: () => getSplitProposals(batchId),
  enabled: canAccess && !!batchId,
});

const acceptedSplits = splitProposals.filter((p) => p.review_status === "accepted");
```

- [ ] **Step 2: Add import for new actions**

Add to the import-actions import:

```tsx
  getSplitProposals, reviewSplitProposal, stageSplitProposals, acceptSplitProposalToRow,
  type ImportSplitProposal,
```

- [ ] **Step 3: Add extraction panel JSX**

Find the duplicate_review or validate step section and add before the duplicate table:

```tsx
{/* Extraction Panel — shown when batch is post-validate */}
{(batch?.status === "duplicate_review" || batch?.status === "pending_approval") && (
  <div className="mb-4 rounded-lg border border-muted bg-muted/30 p-4 space-y-4">
    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Sparkles className="h-4 w-4" />
      Entity Extraction
    </div>

    {/* entity_extractor button */}
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={extractorRunning || resolverRunning}
        onClick={async () => {
          setExtractorRunning(true);
          try {
            const r = await callImportAgent(batchId, "entity_extractor");
            if (r.ok) {
              const result = r.result as { split_proposals: Array<{ source_row_id: string; entities: Array<{ entity_type: string; proposed_payload: Record<string, unknown>; role: string }> }>; multi_entity_count: number };
              await stageSplitProposals(batchId, r.outputId, result.split_proposals ?? []);
              await refetchSplits();
              toast.success(`${result.multi_entity_count ?? 0} multi-entity rows found`);
            } else {
              toast.error(r.message);
            }
          } finally {
            setExtractorRunning(false);
          }
        }}
      >
        {extractorRunning ? (
          <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Extracting…</>
        ) : (
          <><Sparkles className="mr-2 h-3 w-3" />Extract Entities</>
        )}
      </Button>
      <span className="text-xs text-muted-foreground">Find rows containing multiple entities (e.g. company + contact)</span>
    </div>

    {/* Split proposals list */}
    {splitProposals.length > 0 && (
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">{splitProposals.length} proposed splits</div>
        {splitProposals.map((proposal) => (
          <div key={proposal.id} className="rounded border border-border bg-background p-3 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium text-muted-foreground">
                {proposal.entity_type} — {proposal.role ?? ""}
              </span>
              <div className="flex gap-1">
                {proposal.review_status === "pending" && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-emerald-400"
                      onClick={async () => {
                        await reviewSplitProposal(proposal.id, "accepted");
                        await refetchSplits();
                      }}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-muted-foreground"
                      onClick={async () => {
                        await reviewSplitProposal(proposal.id, "rejected");
                        await refetchSplits();
                      }}
                    >
                      Reject
                    </Button>
                  </>
                )}
                {proposal.review_status !== "pending" && (
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-medium",
                    proposal.review_status === "accepted"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}>
                    {proposal.review_status}
                  </span>
                )}
              </div>
            </div>
            <div className="text-muted-foreground font-mono text-[10px] break-all">
              {JSON.stringify(proposal.proposed_payload).slice(0, 200)}
            </div>
          </div>
        ))}
      </div>
    )}

    {/* relationship_resolver — enabled only when accepted splits exist */}
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={resolverRunning || extractorRunning || acceptedSplits.length === 0}
        onClick={async () => {
          setResolverRunning(true);
          try {
            const r = await callImportAgent(batchId, "relationship_resolver");
            if (r.ok) {
              setResolverOutput(r.result as Record<string, unknown>);
              toast.success("Relationships resolved");
            } else {
              toast.error(r.message);
            }
          } finally {
            setResolverRunning(false);
          }
        }}
      >
        {resolverRunning ? (
          <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Resolving…</>
        ) : (
          <><Sparkles className="mr-2 h-3 w-3" />Resolve Relationships</>
        )}
      </Button>
      {acceptedSplits.length === 0 && (
        <span className="text-xs text-muted-foreground">Accept at least one split proposal first</span>
      )}
    </div>

    {/* relationship_resolver results */}
    {resolverOutput && (
      <div className="rounded border border-border bg-background p-3 text-sm space-y-1">
        <div className="font-medium mb-1">Proposed relationships ({(resolverOutput.links as unknown[])?.length ?? 0}):</div>
        {(resolverOutput.links as Array<{ from_entity_ref: string; to_entity_ref: string; relationship_type: string; confidence: number; rationale: string }>).slice(0, 10).map((link, i) => (
          <div key={i} className="text-xs text-muted-foreground">
            <span className="font-mono">{link.from_entity_ref.slice(0, 8)}…</span>
            {" "}→ <span className="text-primary">{link.relationship_type}</span> →{" "}
            <span className="font-mono">{link.to_entity_ref.slice(0, 8)}…</span>
            <span className="ml-2 opacity-60">({Math.round(link.confidence * 100)}%)</span>
          </div>
        ))}
        {(resolverOutput.unresolved as unknown[])?.length > 0 && (
          <div className="text-xs text-amber-400 mt-1">
            {(resolverOutput.unresolved as Array<{ entity_ref: string; reason: string }>).length} unresolved
          </div>
        )}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/data-import.\$batchId.tsx
git commit -m "feat(import-ui): add extraction panel (entity_extractor, relationship_resolver)"
```

---

## Task 8: UI — Duplicate Review + Approval AI Panels

**Files:**
- Modify: `src/routes/_authenticated/data-import.$batchId.tsx`

- [ ] **Step 1: Add state for change_interpreter and routing_reviewer**

In `BatchDetailPage`, add:

```tsx
const [changeOutput, setChangeOutput] = useState<Record<string, unknown> | null>(null);
const [changeRunning, setChangeRunning] = useState(false);
const [reviewerOutput, setReviewerOutput] = useState<Record<string, unknown> | null>(null);
const [reviewerRunning, setReviewerRunning] = useState(false);
```

- [ ] **Step 2: Add change_interpreter panel**

Find the duplicate review tab/section and add a card above the duplicate table:

```tsx
{/* change_interpreter — only for recurring batches with a source_profile_id */}
{batch?.status === "duplicate_review" && batch?.source_profile_id && (
  <div className="mb-4 rounded-lg border border-muted bg-muted/30 p-4 space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Sparkles className="h-4 w-4" />
        Recurring Import Changes
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={changeRunning}
        onClick={async () => {
          setChangeRunning(true);
          try {
            const r = await callImportAgent(batchId, "change_interpreter");
            if (r.ok) {
              setChangeOutput(r.result as Record<string, unknown>);
              toast.success("Change summary ready");
            } else {
              toast.error(r.message);
            }
          } finally {
            setChangeRunning(false);
          }
        }}
      >
        {changeRunning ? (
          <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Interpreting…</>
        ) : (
          <><Sparkles className="mr-2 h-3 w-3" />Interpret Changes</>
        )}
      </Button>
    </div>

    {changeOutput && (
      <div className="space-y-2 text-sm">
        {/* Hold warning */}
        {changeOutput.recommended_action === "hold" && (
          <div className="flex items-center gap-2 rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-red-400 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            AI recommends holding this import — review notable changes below before proceeding.
          </div>
        )}

        <div className="text-muted-foreground text-xs">{String(changeOutput.change_summary)}</div>

        <div className="flex gap-4 text-xs">
          <span className="text-emerald-400">+{Number(changeOutput.new_records_count)} new</span>
          <span className="text-blue-400">~{Number(changeOutput.updated_records_count)} updated</span>
          <span className="text-muted-foreground">-{Number(changeOutput.removed_records_count)} removed</span>
        </div>

        {(changeOutput.notable_changes as Array<{ description: string; severity: string }>).map((c, i) => (
          <div key={i} className={cn(
            "text-xs px-2 py-1 rounded",
            c.severity === "critical" ? "bg-red-500/10 text-red-400" :
            c.severity === "warning"  ? "bg-amber-500/10 text-amber-400" :
                                        "bg-muted/50 text-muted-foreground",
          )}>
            {c.description}
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Add import_routing_reviewer panel**

Find the approval section (where the Approve button is rendered) and add above the button:

```tsx
{/* import_routing_reviewer — shown in pending_approval for approve-capable users */}
{batch?.status === "pending_approval" && canApprove && (
  <div className="mb-4 rounded-lg border border-muted bg-muted/30 p-4 space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ShieldCheck className="h-4 w-4" />
        Final AI Review
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={reviewerRunning}
        onClick={async () => {
          setReviewerRunning(true);
          try {
            const r = await callImportAgent(batchId, "import_routing_reviewer");
            if (r.ok) {
              setReviewerOutput(r.result as Record<string, unknown>);
              toast.success("Review complete");
            } else {
              toast.error(r.message);
            }
          } finally {
            setReviewerRunning(false);
          }
        }}
      >
        {reviewerRunning ? (
          <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Reviewing…</>
        ) : (
          <><ShieldCheck className="mr-2 h-3 w-3" />Run Final Review</>
        )}
      </Button>
    </div>

    {reviewerOutput && (
      <div className="space-y-2">
        <div className={cn(
          "text-xs font-medium px-2 py-1 rounded inline-block",
          reviewerOutput.overall_recommendation === "approve" ? "bg-emerald-500/15 text-emerald-400" :
          reviewerOutput.overall_recommendation === "hold"    ? "bg-red-500/15 text-red-400" :
                                                                "bg-amber-500/15 text-amber-400",
        )}>
          AI: {String(reviewerOutput.overall_recommendation).toUpperCase()}
          {" "}({Math.round(Number(reviewerOutput.confidence) * 100)}% confidence)
        </div>

        <div className="space-y-1">
          {(reviewerOutput.findings as Array<{ severity: string; title: string; description: string }>).map((f, i) => (
            <div key={i} className={cn(
              "text-xs px-2 py-1.5 rounded flex gap-2",
              f.severity === "critical" ? "bg-red-500/10 text-red-400" :
              f.severity === "warning"  ? "bg-amber-500/10 text-amber-400" :
                                          "bg-muted/50 text-muted-foreground",
            )}>
              <span className="font-medium shrink-0">{f.title}:</span>
              <span>{f.description}</span>
            </div>
          ))}
        </div>

        {(reviewerOutput.findings as Array<{ severity: string }>).some((f) => f.severity === "critical") && (
          <div className="text-[10px] text-muted-foreground">
            Advisory only — you may still approve. Findings are for your awareness.
          </div>
        )}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/data-import.\$batchId.tsx
git commit -m "feat(import-ui): add duplicate review and approval AI panels (change_interpreter, import_routing_reviewer)"
```

---

## Task 9: TypeScript Check + Deploy

**Files:**
- No code changes — validation and deploy only

- [ ] **Step 1: Run TypeScript check**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude"
npx tsc --noEmit 2>&1 | head -50
```

Expected: no output (zero errors). The `satisfies Record<AgentKey, z.ZodType>` constraint in `AGENT_OUTPUT_SCHEMAS` will have caught any missing agents at this point.

Common errors and fixes:
- `Type '"import_split_proposals"' is not assignable to 'EntityType'` — the `import_split_proposals` table query uses a raw string; ensure `import_split_proposals` is not passed as an `EntityType` anywhere.
- `Property 'X' is missing in type ...` on `AGENT_OUTPUT_SCHEMAS` — a schema was not added to the map.
- `Cannot find name 'callImportAgent'` in the route file — check the import was added.

- [ ] **Step 2: Run schema tests one final time**

```bash
bun test src/lib/ai-schemas.test.ts 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 3: Deploy edge functions**

```bash
npx supabase functions deploy ai-orchestrator --no-verify-jwt=false
npx supabase functions deploy import-pipeline --no-verify-jwt=false
```

(If the CLI is not linked, push via `npx supabase db push` for migration + manual deploy from Supabase dashboard.)

- [ ] **Step 4: Apply migration to production**

```bash
npx supabase db push
```

- [ ] **Step 5: Final commit (if any fixup needed from tsc)**

```bash
git add -A
git commit -m "fix(import-ai): tsc fixups and deploy PR 2"
```

- [ ] **Step 6: Push branch and open PR**

```bash
git push origin feature/import-ai-classification
```

Then open a PR from `feature/import-ai-classification` → `main` titled:
`feat(import): PR 2 — AI Classification & Routing (7 agents)`

PR description should note:
- 7 new AI agents registered in ai-orchestrator
- 1 new DB table (import_split_proposals)
- On-demand trigger buttons at each import step
- All agents advisory — no auto-commits
- `tsc --noEmit` passes
