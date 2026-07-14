# AI Agents Activation — Design Spec
**Date:** 2026-07-14  
**Status:** Approved  
**Scope:** Activate 6 stub agents in PHC Command Center

---

## 1. Goal

Replace 6 placeholder AI agents (currently returning `{ configured: false }`) with real implementations. The result is a fully AI-driven import pipeline and two standalone analysis tools.

---

## 2. Architecture Overview

### Two implementation tracks

**Track A — ai-orchestrator (new agents using LLM reasoning)**
- `data_cleanup` — entity: `import_batches`
- `contact_mapping` — entity: `import_batches`
- `project_radar` — entity: `pipeline` (new sentinel)
- `risk_finance` — entity: `opportunities`

**Track B — sales-os-api (file parsers, no LLM)**
- `protenders_ingest` — Excel/CSV parser for ProTenders files
- `boq_extraction` — Excel parser for BOQ files

---

## 3. Full Import Pipeline Flow

```
Upload → Parse → AI Pipeline (auto) → Review All Rows → Commit
```

The AI pipeline runs automatically after parse completes. Steps:
1. **data_cleanup** — cleans and standardizes all rows
2. **contact_mapping** — classifies rows + links contacts to companies
3. **suggestImportMappings** (existing) — maps columns to CRM fields
4. **validateBatch** (existing) — validates all rows
5. **detectDuplicates** (existing) — flags duplicate rows

User sees a review table with all rows. Each row has a badge:
- ✅ Ready — AI processed, no issues
- ⚠️ Review — AI flagged ambiguity or low confidence
- ❌ Error — validation failed or required field missing

User can edit any row before committing. Commit sends everything in one batch.

---

## 4. Agent Specs

### 4.1 data_cleanup
**Agent key:** `data_cleanup`  
**Entity:** `import_batches`  
**Role gate:** `canManageSalesPipeline()`  
**Context loaded:** batch metadata + first 20 rows as sample

**AI task:**
- Standardize company names (trim, consistent casing)
- Standardize phone numbers to Saudi format (+966XXXXXXXXX)
- Standardize dates to ISO 8601
- Normalize CR numbers (10-digit format)
- Detect duplicate rows within the batch (same name/phone/email)
- Detect potential duplicates against existing DB records

**Output schema:**
```ts
{
  corrections: Array<{
    row_id: string;
    field: string;
    original: string;
    corrected: string;
    reason: string;
  }>;
  duplicates: Array<{
    row_ids: string[];
    reason: string;
    duplicate_type: "within_batch" | "existing_record";
    existing_id?: string;
  }>;
  quality_score: number;        // 0-100
  quality_summary: string;      // short human-readable summary
}
```

---

### 4.2 contact_mapping
**Agent key:** `contact_mapping`  
**Entity:** `import_batches`  
**Role gate:** `canManageSalesPipeline()`  
**Context loaded:** batch metadata + all rows (up to 20)

**AI task:**
- Classify each row: `company` | `contact` | `lead` | `ambiguous`
- Link contacts to their companies (within batch or existing DB)
- Flag rows that contain both company and contact data (suggest split)
- Assign appropriate target_entity per row

**Output schema:**
```ts
{
  classifications: Array<{
    row_id: string;
    entity_type: "companies" | "contacts" | "leads" | "ambiguous";
    confidence: number;       // 0-1
    reason: string;
  }>;
  contact_company_links: Array<{
    contact_row_id: string;
    company_row_id?: string;       // within batch
    existing_company_id?: string;  // in DB
    company_name: string;
    confidence: number;
    match_basis: string;
  }>;
  suggested_splits: Array<{
    row_id: string;
    reason: string;
  }>;
}
```

---

### 4.3 project_radar
**Agent key:** `project_radar`  
**Entity:** `pipeline` (new sentinel in AGENT_ENTITY_TYPES)  
**Role gate:** `canManageSalesPipeline()`  
**Context loaded:** last 50 opportunities (stage, last_activity, value, owner) + last 20 leads

**AI task:**
- Identify stale opportunities (no activity > 30 days)
- Flag high-value opportunities missing BOQ
- Identify companies with no linked active opportunities
- Detect patterns in opportunity stage distribution
- Surface opportunities approaching close dates with no quotation

**Output schema:**
```ts
{
  radar_alerts: Array<{
    alert_type: "stale_opportunity" | "missing_boq" | "inactive_account" |
                "stage_bottleneck" | "approaching_deadline" | "pattern";
    entity_type: "opportunities" | "companies" | "leads";
    entity_id: string;
    entity_name: string;
    severity: "low" | "medium" | "high";
    description: string;
    recommended_action: string;
  }>;
  pipeline_health_score: number;   // 0-100
  summary: string;
}
```

---

### 4.4 risk_finance
**Agent key:** `risk_finance`  
**Entity:** `opportunities`  
**Role gate:** `canManageSalesPipeline()`  
**Context loaded:** opportunity + linked company (payment history notes) + linked quotations + BOQ total value

**AI task:**
- Assess financial risk based on: opportunity value, client type, pipeline stage, missing data
- Evaluate client relationship level and history
- Check for missing critical commercial info (no quotation, no BOQ, no contract stage)
- Provide risk score and actionable recommendations

**Output schema:**
```ts
{
  risk_score: number;           // 0-100 (higher = riskier)
  risk_level: "low" | "medium" | "high" | "critical";
  risk_factors: Array<{
    factor: string;
    impact: "low" | "medium" | "high";
    description: string;
  }>;
  mitigations: Array<{
    action: string;
    priority: "low" | "medium" | "high";
  }>;
  confidence: number;           // 0-1
  disclaimer: string;           // always present
}
```

---

### 4.5 protenders_ingest
**Handler:** `sales-os-api → run_protenders_ingest`  
**No LLM** — pure file parsing  
**Role gate:** `canManageSalesPipeline()`

**Input:** Excel/CSV file uploaded to Supabase Storage (imports bucket)  
**Expected columns:** `project_name`, `main_contractor`, `package`, `stage`, `source_date`, `value`, `location`

**Processing:**
1. Download file from storage
2. Parse rows using a structured column map
3. Insert into `protenders_imports` (one record per upload)
4. Insert into `protenders_projects` (one per row)
5. Auto-create `leads` for rows where stage indicates active opportunity
6. Return: `{ import_id, ingested, leads_created }`

**UI:** New "ProTenders" tab inside Data Import page. Upload → preview table → confirm import.

---

### 4.6 boq_extraction
**Handler:** `sales-os-api → run_boq_extraction`  
**No LLM** — pure file parsing  
**Role gate:** `canManageSalesPipeline()`

**Input:** Excel file uploaded from within an Opportunity detail page  
**Expected columns:** `item_code`, `description`, `unit`, `quantity`, `unit_price`

**Processing:**
1. Download file from storage
2. Parse rows
3. Upsert into `boqs` table (one BOQ per opportunity) + `boq_items` (one per row)
4. Return: `{ boq_id, items_count, total_value }`

**UI:** "Upload BOQ" button in BOQ tab of Opportunity detail. Upload → preview line items table → confirm.

---

## 5. Frontend Changes

### Data Import page (`data-import.tsx`)
- Remove manual Mapping and Validate tabs from default flow
- After parse: auto-trigger AI pipeline (progress indicator)
- New "AI Review" tab: table of all rows with badge per row + edit capability
- Keep manual mapping as "Advanced" option for power users

### Data Import page — new tabs
- **ProTenders** tab: file upload + column preview + import button
- **BOQ** — remains in Opportunity detail (not in Data Import)

### Opportunity detail (`accounts.$id.tsx` or opportunities route)
- BOQ tab: "Upload BOQ Excel" button → modal → line items preview → confirm

### AI Agents page (`ai-agents.tsx`)
- **Project Radar** section: "Scan Pipeline" button → radar alerts list with entity links
- **Risk Finance**: shown per-opportunity (not on /ai-agents page directly)

### Opportunities list / opportunity detail
- "Assess Risk" button → calls risk_finance agent → shows risk panel (same pattern as ai-orchestrator outputs)

---

## 6. Backend Changes

### ai-orchestrator (`supabase/functions/_shared/`)

**ai-schemas.ts**
- Add to `AGENT_KEYS`: `data_cleanup`, `contact_mapping`, `project_radar`, `risk_finance`
- Add `pipeline` to `ENTITY_TYPES` (sentinel for batch-level agents)
- Add output schemas for all 4 new agents

**ai-agent-registry.ts**
- Register 4 new agents with: role check, context loader, prompt builder, output schema

**ai-prompts.ts**
- Add system + agent-specific prompts for 4 new agents

**ai-guardrails.ts**
- Add entity allowlists for new agents:
  - `data_cleanup`: `["import_batches"]`
  - `contact_mapping`: `["import_batches"]`
  - `project_radar`: `["pipeline"]`
  - `risk_finance`: `["opportunities"]`

### sales-os-api (`supabase/functions/sales-os-api/index.ts`)
- Replace stub `run_protenders_ingest` with full file-parsing implementation
- Replace stub `run_boq_extraction` with full file-parsing implementation

### Frontend lib
- `import-actions.ts`: add `runDataCleanup(batchId)`, `runContactMapping(batchId)` helpers
- `ai-orchestrator-actions.ts`: already supports new agents via generic `runAiAgent()`

---

## 7. Data Model

No new migrations required. All outputs go into existing tables:
- AI agent outputs → `ai_agent_outputs` (existing)
- ProTenders data → `protenders_imports` + `protenders_projects` (existing)
- BOQ data → `boqs` + `boq_items` (existing)
- Leads from ProTenders → `leads` (existing)

---

## 8. Error Handling

All 4 ai-orchestrator agents inherit the existing 18-code error vocabulary.

File parsers (protenders_ingest, boq_extraction):
- Missing required columns → return `{ ok: false, missing_columns: [] }`
- Parse error → return `{ ok: false, error: "parse_failed", detail }`
- File not found in storage → return `{ ok: false, error: "file_not_found" }`

UI: toast errors for parse failures, inline row errors for AI review table.

---

## 9. Success Criteria

- [ ] Uploading a mixed company+contact file → AI classifies and routes all rows correctly
- [ ] data_cleanup catches phone number and name inconsistencies
- [ ] contact_mapping links contacts to their companies without manual intervention
- [ ] User can review all rows before commit, edit any row, and commit cleanly
- [ ] ProTenders Excel upload → leads created automatically
- [ ] BOQ Excel upload → boq_items created and linked to opportunity
- [ ] project_radar surfaces stale opportunities and flags missing BOQs
- [ ] risk_finance returns structured risk score for any opportunity
- [ ] All 6 agents no longer return `{ configured: false }`
- [ ] Build passes with no TypeScript errors
