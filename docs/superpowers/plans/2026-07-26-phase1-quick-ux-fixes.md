# Phase 1 Quick UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five small, independent UX/data-model fixes to the PHC Command Center CRM: richer Intake form fields, a qualitative Contacts confidence level, an inline "add new project" affordance on the RFQ picker, clearer post-create messaging, and removal of the sidebar's "Recent" list.

**Architecture:** Two additive-only Postgres migrations (new nullable columns + new ENUM types, no drop/alter of existing columns), matching the `contact_authority`/`contact_location` ENUM pattern already established in `20260707100010_crm_core.sql`. Frontend changes extend the existing `DialogField`/`ActionDialog` form system and `strings` i18n dict — no new UI primitives introduced beyond what's already used elsewhere in the same files.

**Tech Stack:** TanStack Start + React + TypeScript, Supabase Postgres (migrations under `supabase/migrations/`), Bun test runner, existing `src/components/phc/ActionDialog.tsx` generic form system, `src/lib/i18n.tsx` bilingual EN/AR string dict.

## Global Constraints

- Every migration is additive only (new nullable columns / new types) — no `DROP`, no `ALTER ... TYPE` on existing columns, no data loss. (Spec §3, §4)
- ENUM types follow the exact naming/definition style of `contact_authority`/`contact_location` in `supabase/migrations/20260707100010_crm_core.sql:32-39`. (Spec §3, §4)
- `ActionDialog`'s `DialogField` union gets new **optional** properties only — every existing caller of the `"select"` field type must keep working unchanged. (Spec §5)
- The sidebar "Recent" removal must **not** touch `useRecentRecords()`'s auto-track `useEffect` in `AppShell.tsx:216-234` — `CommandPalette.tsx` and `my-workspace.tsx` still depend on that hook's tracked state. (Spec §7)
- No migration is deployed to production in this plan — create + verify locally only (`supabase start`, `supabase db push --local` or equivalent local apply), per `docs/deployment-governance.md`. Production deploy is a separate, explicitly-approved step after this PR merges.
- `bun run verify` (typecheck + lint + test + build) must pass before the final commit.
- New bilingual strings added to `src/lib/i18n.tsx` must have both `en` and `ar` values — never machine-translate placeholders (existing file header comment, line 7).

---

### Task 1: Migration — `inbox_items` intake fields

**Files:**
- Create: `supabase/migrations/20260726110000_inbox_items_intake_fields.sql`
- Test: `src/lib/inbox-intake-fields-migration.contract.test.ts`

**Interfaces:**
- Produces: Postgres types `public.inbox_client_type`, `public.inbox_project_type`, `public.inbox_rfq_from`, `public.inbox_scope`, `public.inbox_location`; new nullable columns on `public.inbox_items`: `client_type`, `project_type`, `project_number` (text), `rfq_from`, `scope_type`, `location_city`; new `date_received DATE NOT NULL DEFAULT CURRENT_DATE`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- =========================================================
-- PHC Sales OS — Phase 1: Intake form field additions.
--
-- Additive only: 5 new ENUM types, 7 new nullable columns (date_received
-- defaults to today so existing rows get a sane value) on public.inbox_items.
-- The legacy `scope`/`location` TEXT columns are left untouched — new
-- typed columns are added alongside them rather than altering in place,
-- so no historical free-text value is ever cast or lost.
-- =========================================================

CREATE TYPE public.inbox_client_type AS ENUM ('main_client', 'contractor_jih', 'contractor_tender', 'consultant');
CREATE TYPE public.inbox_project_type AS ENUM ('jih', 'tender');
CREATE TYPE public.inbox_rfq_from AS ENUM ('owner_developer', 'main_contractor', 'consultant');
CREATE TYPE public.inbox_scope AS ENUM (
  'supply_and_installation', 'supply_only_signage', 'supply_installation_others',
  'supply_only_others', 'mockup_sample_request', 'installation_only'
);
CREATE TYPE public.inbox_location AS ENUM (
  'riyadh', 'jeddah', 'makkah', 'madinah', 'dammam', 'al_khobar', 'dhahran',
  'jubail', 'taif', 'tabuk', 'abha', 'yanbu', 'jazan', 'buraydah', 'hail'
);

ALTER TABLE public.inbox_items
  ADD COLUMN client_type public.inbox_client_type,
  ADD COLUMN project_type public.inbox_project_type,
  ADD COLUMN project_number TEXT,
  ADD COLUMN rfq_from public.inbox_rfq_from,
  ADD COLUMN date_received DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN scope_type public.inbox_scope,
  ADD COLUMN location_city public.inbox_location;

COMMENT ON COLUMN public.inbox_items.scope_type IS
'Fixed-vocabulary scope classification for the Phase 1 Intake form. The pre-existing free-text `scope` column is kept for historical rows and is no longer written to by the form.';
COMMENT ON COLUMN public.inbox_items.location_city IS
'Fixed-vocabulary Saudi city for the Phase 1 Intake form. The pre-existing free-text `location` column is kept for historical rows and is no longer written to by the form.';
```

- [ ] **Step 2: Apply locally and confirm it applies cleanly**

Run (requires local Supabase running — `supabase start` if not already):
```bash
supabase db reset --local
```
Expected: migration chain applies with no errors, ending with this new migration in the applied list (`supabase migration list --local`).

- [ ] **Step 3: Write the contract test asserting the migration's exact shape**

```typescript
// Contract test for 20260726110000_inbox_items_intake_fields.sql — static
// SQL inspection (no live DB) for the exact columns/types the Intake form
// (Task 2) depends on. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(repoRoot, "supabase/migrations/20260726110000_inbox_items_intake_fields.sql");
const sql = readFileSync(migrationPath, "utf8");

test("defines all 5 new ENUM types with the expected values", () => {
  expect(sql).toMatch(/CREATE TYPE public\.inbox_client_type AS ENUM \('main_client', 'contractor_jih', 'contractor_tender', 'consultant'\)/);
  expect(sql).toMatch(/CREATE TYPE public\.inbox_project_type AS ENUM \('jih', 'tender'\)/);
  expect(sql).toMatch(/CREATE TYPE public\.inbox_rfq_from AS ENUM \('owner_developer', 'main_contractor', 'consultant'\)/);
  expect(sql).toMatch(/CREATE TYPE public\.inbox_scope AS ENUM/);
  expect(sql).toMatch(/CREATE TYPE public\.inbox_location AS ENUM/);
});

test("inbox_scope has exactly the 6 documented options, in order", () => {
  const match = sql.match(/CREATE TYPE public\.inbox_scope AS ENUM \(([\s\S]*?)\);/);
  expect(match).not.toBeNull();
  const values = match![1].split(",").map((v) => v.trim().replace(/'/g, ""));
  expect(values).toEqual([
    "supply_and_installation", "supply_only_signage", "supply_installation_others",
    "supply_only_others", "mockup_sample_request", "installation_only",
  ]);
});

test("inbox_location has exactly the 14 documented Saudi cities, in order", () => {
  const match = sql.match(/CREATE TYPE public\.inbox_location AS ENUM \(([\s\S]*?)\);/);
  expect(match).not.toBeNull();
  const values = match![1].split(",").map((v) => v.trim().replace(/'/g, ""));
  expect(values).toEqual([
    "riyadh", "jeddah", "makkah", "madinah", "dammam", "al_khobar", "dhahran",
    "jubail", "taif", "tabuk", "abha", "yanbu", "jazan", "buraydah", "hail",
  ]);
});

test("all 7 new columns are added to inbox_items, and date_received defaults to today", () => {
  expect(sql).toMatch(/ADD COLUMN client_type public\.inbox_client_type/);
  expect(sql).toMatch(/ADD COLUMN project_type public\.inbox_project_type/);
  expect(sql).toMatch(/ADD COLUMN project_number TEXT/);
  expect(sql).toMatch(/ADD COLUMN rfq_from public\.inbox_rfq_from/);
  expect(sql).toMatch(/ADD COLUMN date_received DATE NOT NULL DEFAULT CURRENT_DATE/);
  expect(sql).toMatch(/ADD COLUMN scope_type public\.inbox_scope/);
  expect(sql).toMatch(/ADD COLUMN location_city public\.inbox_location/);
});

test("does not touch the pre-existing free-text scope/location columns", () => {
  expect(sql).not.toMatch(/ALTER COLUMN scope/);
  expect(sql).not.toMatch(/ALTER COLUMN location\b/);
  expect(sql).not.toMatch(/DROP COLUMN/);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/inbox-intake-fields-migration.contract.test.ts`
Expected: `5 pass, 0 fail`

- [ ] **Step 5: Regenerate Supabase TypeScript types**

Run (requires local Supabase running from Step 2):
```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
```
Expected: `src/integrations/supabase/types.ts` diff shows the 5 new enum types and 7 new columns added to the `inbox_items` Row/Insert/Update shapes, nothing else changed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260726110000_inbox_items_intake_fields.sql src/lib/inbox-intake-fields-migration.contract.test.ts src/integrations/supabase/types.ts
git commit -m "feat(db): add intake form fields to inbox_items (client type, project type, project number, rfq from, date received, scope/location selects)"
```

---

### Task 2: Intake form — new fields on `lead-tender-inbox.tsx`

**Files:**
- Modify: `src/routes/_authenticated/lead-tender-inbox.tsx:37-59` (`newIntakeFields`)
- Modify: `src/lib/inbox-actions.ts:49-90` (`InboxItemInput`, `createInboxItem`)
- Modify: `src/lib/i18n.tsx` (add new keys)

**Interfaces:**
- Consumes: `public.inbox_client_type | inbox_project_type | inbox_rfq_from | inbox_scope | inbox_location` (Task 1).
- Produces: `InboxItemInput` gains `clientType?: InboxClientType`, `projectType?: InboxProjectType`, `projectNumber?: string`, `rfqFrom?: InboxRfqFrom`, `dateReceived?: string`, `scopeType?: InboxScope`, `locationCity?: InboxLocation` (all optional, alongside the existing fields — nothing removed).

- [ ] **Step 1: Add the new TS enum type aliases and constant arrays to `inbox-actions.ts`**

In `src/lib/inbox-actions.ts`, right after the existing `InboxStatus` type (line ~23):

```typescript
export type InboxClientType = Database["public"]["Enums"]["inbox_client_type"];
export type InboxProjectType = Database["public"]["Enums"]["inbox_project_type"];
export type InboxRfqFrom = Database["public"]["Enums"]["inbox_rfq_from"];
export type InboxScope = Database["public"]["Enums"]["inbox_scope"];
export type InboxLocation = Database["public"]["Enums"]["inbox_location"];

export const INBOX_CLIENT_TYPES: InboxClientType[] = ["main_client", "contractor_jih", "contractor_tender", "consultant"];
export const INBOX_PROJECT_TYPES: InboxProjectType[] = ["jih", "tender"];
export const INBOX_RFQ_FROM: InboxRfqFrom[] = ["owner_developer", "main_contractor", "consultant"];
export const INBOX_SCOPES: InboxScope[] = [
  "supply_and_installation", "supply_only_signage", "supply_installation_others",
  "supply_only_others", "mockup_sample_request", "installation_only",
];
export const INBOX_LOCATIONS: InboxLocation[] = [
  "riyadh", "jeddah", "makkah", "madinah", "dammam", "al_khobar", "dhahran",
  "jubail", "taif", "tabuk", "abha", "yanbu", "jazan", "buraydah", "hail",
];
```

- [ ] **Step 2: Extend `InboxItemInput` and `createInboxItem`'s insert in `inbox-actions.ts`**

`InboxItemInput` (line 49-67), add after `consultant?: string;`:
```typescript
  clientType?: InboxClientType;
  projectType?: InboxProjectType;
  projectNumber?: string;
  rfqFrom?: InboxRfqFrom;
  dateReceived?: string;
```
and after `location?: string;`:
```typescript
  scopeType?: InboxScope;
  locationCity?: InboxLocation;
```

`createInboxItem`'s insert object (line ~76-90), add after `consultant: input.consultant ?? null,`:
```typescript
      client_type: input.clientType ?? null,
      project_type: input.projectType ?? null,
      project_number: input.projectNumber ?? null,
      rfq_from: input.rfqFrom ?? null,
      date_received: input.dateReceived ?? null,
```
and after `location: input.location ?? null,`:
```typescript
      scope_type: input.scopeType ?? null,
      location_city: input.locationCity ?? null,
```

- [ ] **Step 3: Add the 12 new bilingual translation keys to `src/lib/i18n.tsx`**

Add near the existing `authority_*`/`location_*` block (after line 354):
```typescript
  // Intake — client type / project type / RFQ from
  ibx_client_type: { en: "Client Type", ar: "نوع العميل" },
  ibx_client_type_main_client: { en: "Main Client", ar: "العميل الرئيسي" },
  ibx_client_type_contractor_jih: { en: "Contractor (JIH)", ar: "مقاول (JIH)" },
  ibx_client_type_contractor_tender: { en: "Contractor (Tender)", ar: "مقاول (منافسة)" },
  ibx_client_type_consultant: { en: "Consultant", ar: "استشاري" },
  ibx_project_type: { en: "Project Type", ar: "نوع المشروع" },
  ibx_project_type_jih: { en: "JIH", ar: "JIH" },
  ibx_project_type_tender: { en: "Tender", ar: "منافسة" },
  ibx_project_number: { en: "Project Number", ar: "رقم المشروع" },
  ibx_rfq_from: { en: "RFQ From", ar: "طلب عرض السعر من" },
  ibx_rfq_from_owner_developer: { en: "Owner / Developer", ar: "المالك / المطوّر" },
  ibx_rfq_from_main_contractor: { en: "Main Contractor", ar: "المقاول الرئيسي" },
  ibx_rfq_from_consultant: { en: "Consultant", ar: "استشاري" },
  ibx_date_received: { en: "Date Received", ar: "تاريخ الاستلام" },
  // Intake — scope (fixed vocabulary, replaces free-text scope textarea)
  ibx_scope_type: { en: "Scope", ar: "نطاق العمل" },
  ibx_scope_supply_and_installation: { en: "Supply and Installation of Signage", ar: "توريد وتركيب اللوحات" },
  ibx_scope_supply_only_signage: { en: "Supply Only - Signage", ar: "توريد فقط - لوحات" },
  ibx_scope_supply_installation_others: { en: "Supply of Installation (Others)", ar: "توريد التركيب (أخرى)" },
  ibx_scope_supply_only_others: { en: "Supply Only (Others)", ar: "توريد فقط (أخرى)" },
  ibx_scope_mockup_sample_request: { en: "Mock-up Sample Request", ar: "طلب عينة نموذجية" },
  ibx_scope_installation_only: { en: "Installation Only", ar: "تركيب فقط" },
  // Intake — location (fixed vocabulary, replaces free-text location input)
  ibx_location_city: { en: "Project Location", ar: "موقع المشروع" },
  ibx_location_riyadh: { en: "Riyadh", ar: "الرياض" },
  ibx_location_jeddah: { en: "Jeddah", ar: "جدة" },
  ibx_location_makkah: { en: "Makkah", ar: "مكة المكرمة" },
  ibx_location_madinah: { en: "Madinah", ar: "المدينة المنورة" },
  ibx_location_dammam: { en: "Dammam", ar: "الدمام" },
  ibx_location_al_khobar: { en: "Al Khobar", ar: "الخبر" },
  ibx_location_dhahran: { en: "Dhahran", ar: "الظهران" },
  ibx_location_jubail: { en: "Jubail", ar: "الجبيل" },
  ibx_location_taif: { en: "Taif", ar: "الطائف" },
  ibx_location_tabuk: { en: "Tabuk", ar: "تبوك" },
  ibx_location_abha: { en: "Abha", ar: "أبها" },
  ibx_location_yanbu: { en: "Yanbu", ar: "ينبع" },
  ibx_location_jazan: { en: "Jazan", ar: "جازان" },
  ibx_location_buraydah: { en: "Buraydah", ar: "بريدة" },
  ibx_location_hail: { en: "Hail", ar: "حائل" },
```

- [ ] **Step 4: Update `newIntakeFields()` in `lead-tender-inbox.tsx`**

Replace the function (lines 37-59) with:
```typescript
function newIntakeFields(t: (k: string) => string, teamMembers: any[]): DialogField[] {
  return [
    { key: "sourceType", type: "select", label: t("ibx_source_type"), required: true, options: INBOX_SOURCE_TYPES.map((s) => ({ value: s, label: t(`src_${s}`) })) },
    { key: "sourceName", type: "text", label: t("ibx_source_name") },
    { key: "dateReceived", type: "date", label: t("ibx_date_received"), defaultValue: new Date().toISOString().slice(0, 10) },
    { key: "companyName", type: "text", label: t("ibx_company_name") },
    { key: "contactName", type: "text", label: t("ibx_contact_name") },
    { key: "phone", type: "text", label: t("label_phone") },
    { key: "email", type: "text", label: t("email") },
    { key: "clientType", type: "select", label: t("ibx_client_type"), options: [{ value: "", label: "—" }, ...INBOX_CLIENT_TYPES.map((c) => ({ value: c, label: t(`ibx_client_type_${c}`) }))] },
    { key: "projectType", type: "select", label: t("ibx_project_type"), options: [{ value: "", label: "—" }, ...INBOX_PROJECT_TYPES.map((p) => ({ value: p, label: t(`ibx_project_type_${p}`) }))] },
    { key: "projectName", type: "text", label: t("label_project") },
    { key: "projectNumber", type: "text", label: t("ibx_project_number") },
    { key: "rfqFrom", type: "select", label: t("ibx_rfq_from"), options: [{ value: "", label: "—" }, ...INBOX_RFQ_FROM.map((r) => ({ value: r, label: t(`ibx_rfq_from_${r}`) }))] },
    { key: "clientOwner", type: "text", label: t("ibx_client_owner") },
    { key: "mainContractor", type: "text", label: t("label_contractor") },
    { key: "consultant", type: "text", label: t("ibx_consultant") },
    { key: "scopeType", type: "select", label: t("ibx_scope_type"), options: [{ value: "", label: "—" }, ...INBOX_SCOPES.map((s) => ({ value: s, label: t(`ibx_scope_${s}`) }))] },
    { key: "locationCity", type: "select", label: t("ibx_location_city"), options: [{ value: "", label: "—" }, ...INBOX_LOCATIONS.map((l) => ({ value: l, label: t(`ibx_location_${l}`) }))] },
    { key: "estimatedValue", type: "text", label: t("ibx_estimated_value") },
    { key: "deadline", type: "date", label: t("ibx_deadline") },
    { key: "notes", type: "textarea", label: t("wf_notes") },
    { key: "evidenceUrl", type: "file", label: t("ibx_evidence_url"), folder: "inbox" },
    { key: "assignedOwnerId", type: "select", label: t("ibx_assigned_owner"), options: [{ value: "", label: "—" }, ...teamMembers.map((p: any) => ({ value: p.id, label: p.full_name || p.email }))] },
    { key: "nextAction", type: "text", label: t("label_next_action") },
    { key: "followUpDate", type: "date", label: t("ibx_follow_up_date") },
  ];
}
```

Add the new imports at the top of the file, in the existing `from "@/lib/inbox-actions"` import block:
```typescript
  INBOX_SOURCE_TYPES, INBOX_CLASSIFICATIONS,
  INBOX_CLIENT_TYPES, INBOX_PROJECT_TYPES, INBOX_RFQ_FROM, INBOX_SCOPES, INBOX_LOCATIONS,
```

- [ ] **Step 5: Update the `onSubmit` call site that builds the `createInboxItem` payload**

The New Intake `ActionDialog`'s `onSubmit` currently reads:
```typescript
        onSubmit={async (v) => {
          if (!v.sourceType) { toast.error(t("ibx_no_source")); return; }
          try {
            await createInboxItem({
              sourceType: v.sourceType as never,
              sourceName: v.sourceName || undefined,
              companyName: v.companyName || undefined,
              contactName: v.contactName || undefined,
              phone: v.phone || undefined,
              email: v.email || undefined,
              projectName: v.projectName || undefined,
              clientOwner: v.clientOwner || undefined,
              mainContractor: v.mainContractor || undefined,
              consultant: v.consultant || undefined,
              scope: v.scope || undefined,
              location: v.location || undefined,
              estimatedValue: v.estimatedValue ? Number(v.estimatedValue) : null,
              deadline: v.deadline || null,
              notes: v.notes || undefined,
              evidenceUrl: v.evidenceUrl || undefined,
              assignedOwnerId: v.assignedOwnerId || uid,
              nextAction: v.nextAction || undefined,
              followUpDate: v.followUpDate || null,
            });
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
```
Replace the `createInboxItem({...})` object literal with (7 new fields added, `scope`/`location` removed since the form no longer collects them):
```typescript
            await createInboxItem({
              sourceType: v.sourceType as never,
              sourceName: v.sourceName || undefined,
              dateReceived: v.dateReceived || undefined,
              companyName: v.companyName || undefined,
              contactName: v.contactName || undefined,
              phone: v.phone || undefined,
              email: v.email || undefined,
              clientType: v.clientType ? (v.clientType as never) : undefined,
              projectType: v.projectType ? (v.projectType as never) : undefined,
              projectName: v.projectName || undefined,
              projectNumber: v.projectNumber || undefined,
              rfqFrom: v.rfqFrom ? (v.rfqFrom as never) : undefined,
              clientOwner: v.clientOwner || undefined,
              mainContractor: v.mainContractor || undefined,
              consultant: v.consultant || undefined,
              scopeType: v.scopeType ? (v.scopeType as never) : undefined,
              locationCity: v.locationCity ? (v.locationCity as never) : undefined,
              estimatedValue: v.estimatedValue ? Number(v.estimatedValue) : null,
              deadline: v.deadline || null,
              notes: v.notes || undefined,
              evidenceUrl: v.evidenceUrl || undefined,
              assignedOwnerId: v.assignedOwnerId || uid,
              nextAction: v.nextAction || undefined,
              followUpDate: v.followUpDate || null,
            });
```
(`as never` matches the exact cast style already used one line above for `sourceType: v.sourceType as never` — every `ActionDialog` value is a `string`, and these casts narrow to the corresponding Postgres enum type.)

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Manual smoke test**

Run: `bun run dev`, open `/lead-tender-inbox`, click "New Intake", confirm all new fields render (Client Type, Project Type, Project Number, RFQ From, Date Received, Scope select, Location select), submit with a few filled in, confirm no console errors and the new row appears in the inbox table.

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/lead-tender-inbox.tsx src/lib/inbox-actions.ts src/lib/i18n.tsx
git commit -m "feat(intake): add client type, project type, RFQ from, date received fields; convert scope/location to selects"
```

---

### Task 3: Migration — Contacts confidence level

**Files:**
- Create: `supabase/migrations/20260726120000_contacts_confidence_level.sql`
- Test: `src/lib/contacts-confidence-migration.contract.test.ts`

**Interfaces:**
- Produces: Postgres type `public.contact_confidence_level` (`'high' | 'medium' | 'low'`); new nullable column `public.contacts.confidence_level`, backfilled from `confidence_score`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- =========================================================
-- PHC Sales OS — Phase 1: Contacts confidence_level.
--
-- confidence_score (INT 0-100, display-only — verified via repo-wide grep
-- that nothing sorts/filters/thresholds on it) becomes a qualitative
-- high/medium/low field going forward. Additive only: confidence_score is
-- kept, unused by the form after this, not dropped.
-- =========================================================

CREATE TYPE public.contact_confidence_level AS ENUM ('high', 'medium', 'low');

ALTER TABLE public.contacts ADD COLUMN confidence_level public.contact_confidence_level;

UPDATE public.contacts SET confidence_level = CASE
  WHEN confidence_score >= 70 THEN 'high'
  WHEN confidence_score >= 40 THEN 'medium'
  WHEN confidence_score IS NOT NULL THEN 'low'
  ELSE NULL
END::public.contact_confidence_level;

COMMENT ON COLUMN public.contacts.confidence_level IS
'Qualitative confidence (high/medium/low), replacing the numeric confidence_score in the Contacts form as of Phase 1. confidence_score is kept for historical reference but no longer written to by the form.';
```

- [ ] **Step 2: Apply locally**

Run: `supabase db reset --local`
Expected: applies cleanly, no errors.

- [ ] **Step 3: Write the contract test**

```typescript
// Contract test for 20260726120000_contacts_confidence_level.sql — static
// SQL inspection of the ENUM definition and the exact backfill boundaries
// Task 4's form depends on. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(repoRoot, "supabase/migrations/20260726120000_contacts_confidence_level.sql");
const sql = readFileSync(migrationPath, "utf8");

test("defines contact_confidence_level as high/medium/low", () => {
  expect(sql).toMatch(/CREATE TYPE public\.contact_confidence_level AS ENUM \('high', 'medium', 'low'\)/);
});

test("adds a nullable confidence_level column without dropping confidence_score", () => {
  expect(sql).toMatch(/ADD COLUMN confidence_level public\.contact_confidence_level/);
  expect(sql).not.toMatch(/DROP COLUMN confidence_score/);
});

test("backfill CASE uses 70/40 boundaries and preserves NULL for NULL scores", () => {
  expect(sql).toMatch(/WHEN confidence_score >= 70 THEN 'high'/);
  expect(sql).toMatch(/WHEN confidence_score >= 40 THEN 'medium'/);
  expect(sql).toMatch(/WHEN confidence_score IS NOT NULL THEN 'low'/);
  expect(sql).toMatch(/ELSE NULL/);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/contacts-confidence-migration.contract.test.ts`
Expected: `3 pass, 0 fail`

- [ ] **Step 5: Verify the backfill against real local data**

Run (with local Supabase running and reset from Step 2):
```bash
supabase db execute --local "SELECT confidence_score, confidence_level FROM public.contacts WHERE confidence_score IS NOT NULL ORDER BY confidence_score LIMIT 20;"
```
Expected: every row's `confidence_level` matches the 70/40 boundary rule (e.g. a row with `confidence_score = 70` shows `high`, `69` shows `medium`, `39` shows `low`).

- [ ] **Step 6: Regenerate Supabase TypeScript types**

Run:
```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
```
Expected: diff adds `contact_confidence_level` enum and `confidence_level` column to `contacts` Row/Insert/Update, nothing else changed.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260726120000_contacts_confidence_level.sql src/lib/contacts-confidence-migration.contract.test.ts src/integrations/supabase/types.ts
git commit -m "feat(db): add contacts.confidence_level (high/medium/low), backfilled from confidence_score"
```

---

### Task 4: Contacts form/display — confidence level select

**Files:**
- Modify: `src/lib/crm-actions.ts:100-131` (`createContact`)
- Modify: `src/routes/_authenticated/contacts.tsx:23-26, 58-59, 195-260`
- Modify: `src/lib/i18n.tsx` (add new keys)

**Interfaces:**
- Consumes: `public.contact_confidence_level` (Task 3).
- Produces: `createContact(input: { ...; confidenceLevel?: ContactConfidenceLevel | null; ... })` — `confidenceScore` param removed from the public call signature used by this form (the underlying column/param can stay for other future callers, but this form no longer sets it).

- [ ] **Step 1: Add the `ContactConfidenceLevel` type and update `createContact` in `crm-actions.ts`**

After line 9 (`export type ContactLocation = ...`):
```typescript
export type ContactConfidenceLevel = Database["public"]["Enums"]["contact_confidence_level"];
```

In `createContact`'s input type (line 100-111), replace:
```typescript
  confidenceScore?: number | null;
```
with:
```typescript
  confidenceLevel?: ContactConfidenceLevel | null;
```

In the insert object (line ~126), replace:
```typescript
      confidence_score: input.confidenceScore ?? null,
```
with:
```typescript
      confidence_level: input.confidenceLevel ?? null,
```

- [ ] **Step 2: Add `CONFIDENCE_LEVELS` constant and `confidenceLevelLabel`/`confidenceLevelTone` helpers in `contacts.tsx`**

After line 26 (`const LOCATIONS: ContactLocation[] = [...]`):
```typescript
const CONFIDENCE_LEVELS: ContactConfidenceLevel[] = ["high", "medium", "low"];
```

After line 59 (`const locationLabel = ...`):
```typescript
  const confidenceLevelLabel = (c: ContactConfidenceLevel) => t(`confidence_${c}` as never);
```

After the existing `authorityTone` function (around line 28-37), add:
```typescript
function confidenceTone(c: ContactConfidenceLevel | null): "positive" | "attention" | "muted" {
  if (c === "high") return "positive";
  if (c === "medium") return "attention";
  return "muted";
}
```

Update the import on line 14 to add `ContactConfidenceLevel`:
```typescript
import { createContact, type ContactAuthority, type ContactLocation, type ContactConfidenceLevel } from "@/lib/crm-actions";
```

- [ ] **Step 3: Add 4 bilingual translation keys to `src/lib/i18n.tsx`**

Near the existing `crm_confidence` key (line 273):
```typescript
  confidence_high: { en: "High", ar: "عالية" },
  confidence_medium: { en: "Medium", ar: "متوسطة" },
  confidence_low: { en: "Low", ar: "منخفضة" },
```

- [ ] **Step 4: Update the table cell display (line 202)**

Replace:
```typescript
                    {c.confidence_score != null ? `${c.confidence_score}%` : "—"}
```
with:
```typescript
                    {c.confidence_level ? <StatusPill tone={confidenceTone(c.confidence_level)}>{confidenceLevelLabel(c.confidence_level)}</StatusPill> : "—"}
```

- [ ] **Step 5: Update the New Contact form field (line 243) and `onSubmit` (line 256)**

Replace:
```typescript
          { key: "confidenceScore", type: "text", label: t("crm_confidence") },
```
with:
```typescript
          { key: "confidenceLevel", type: "select", label: t("crm_confidence"), options: [{ value: "", label: "—" }, ...CONFIDENCE_LEVELS.map((c) => ({ value: c, label: confidenceLevelLabel(c) }))] },
```

Replace:
```typescript
              confidenceScore: v.confidenceScore ? Number(v.confidenceScore) : null,
```
with:
```typescript
              confidenceLevel: v.confidenceLevel ? (v.confidenceLevel as ContactConfidenceLevel) : null,
```

- [ ] **Step 6: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 7: Manual smoke test**

Run: `bun run dev`, open `/contacts`, confirm the table's Confidence column shows a pill (High/Medium/Low) for existing backfilled contacts instead of a `%`. Click "New Contact," confirm Confidence is now a select with High/Medium/Low, submit, confirm the new contact displays the chosen pill.

- [ ] **Step 8: Commit**

```bash
git add src/lib/crm-actions.ts src/routes/_authenticated/contacts.tsx src/lib/i18n.tsx
git commit -m "feat(contacts): confidence field becomes a High/Medium/Low select"
```

---

### Task 5: `ActionDialog` — creatable select capability

**Files:**
- Modify: `src/components/phc/ActionDialog.tsx:26-46` (`DialogField` type), `:60-70` (state), `:170-201` (select rendering)
- Test: `src/components/phc/action-dialog-creatable-select.contract.test.ts`

**Interfaces:**
- Produces: `DialogField`'s `"select"` variant gains two optional properties: `onCreateNew?: () => Promise<{ value: string; label: string } | null>`, `createLabel?: string`. No other field type changes. Existing callers passing only `options` are unaffected.

**Note on test strategy:** this repo has zero `.test.tsx` files and does not have `@testing-library/react` installed — every existing test is a `bun:test` `.test.ts`/`.contract.test.ts` (static source/behavior assertion, no React rendering). Adding a rendering-test dependency is a bigger decision than this task warrants (this repo's `bunfig.toml` explicitly requires confirming with the user before adding any new package past its 24h supply-chain guard). Follow the established convention instead: a `.contract.test.ts` that statically asserts the source changes, matching how every other component/logic change in this codebase is tested.

- [ ] **Step 1: Write the failing test**

Create `src/components/phc/action-dialog-creatable-select.contract.test.ts`:

```typescript
// Contract test for ActionDialog's creatable-select capability — static
// source inspection (this repo has no React-rendering test harness; every
// existing test asserts source/behavior statically). Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "ActionDialog.tsx"), "utf8");

test("DialogField's select variant declares optional onCreateNew and createLabel", () => {
  const selectVariantMatch = source.match(/\|\s*\{\s*key: string;\s*type: "select";[\s\S]*?\}\s*\|/);
  expect(selectVariantMatch).not.toBeNull();
  expect(selectVariantMatch![0]).toMatch(/onCreateNew\?: \(\) => Promise<\{ value: string; label: string \} \| null>/);
  expect(selectVariantMatch![0]).toMatch(/createLabel\?: string/);
});

test("select rendering handles the __create__ sentinel before the generic value-set branch", () => {
  const createBranchIdx = source.indexOf('if (v === "__create__")');
  const genericSetIdx = source.indexOf('setValues((prev) => ({ ...prev, [f.key]: v === "__none__" ? "" : v }));');
  expect(createBranchIdx).toBeGreaterThan(-1);
  expect(genericSetIdx).toBeGreaterThan(-1);
  expect(createBranchIdx).toBeLessThan(genericSetIdx);
});

test("the create-new SelectItem only renders when f.onCreateNew is present", () => {
  expect(source).toMatch(/\{f\.onCreateNew \? \(\s*<SelectItem value="__create__">/);
});

test("newly-created options are merged into the rendered option list via extraOptions state", () => {
  expect(source).toMatch(/const \[extraOptions, setExtraOptions\] = useState<Record<string, \{ value: string; label: string \}\[\]>>/);
  expect(source).toMatch(/\[\.\.\.f\.options, \.\.\.\(extraOptions\[f\.key\] \?\? \[\]\)\]\.map/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/phc/action-dialog-creatable-select.contract.test.ts`
Expected: FAIL — none of these patterns exist in `ActionDialog.tsx` yet.

- [ ] **Step 3: Extend `DialogField`'s `"select"` variant**

In `ActionDialog.tsx`, replace the `"select"` branch of the `DialogField` union (lines 33-40):
```typescript
  | {
      key: string;
      type: "select";
      label: string;
      required?: boolean;
      defaultValue?: string;
      options: { value: string; label: string }[];
      onCreateNew?: () => Promise<{ value: string; label: string } | null>;
      createLabel?: string;
    }
```

- [ ] **Step 4: Add per-field "extra options" state and the create-handling logic**

After the existing `const [uploading, setUploading] = useState(false);` (line ~65), add:
```typescript
  const [extraOptions, setExtraOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [creating, setCreating] = useState<string | null>(null);
```

- [ ] **Step 5: Update the `"select"` rendering block**

Replace the `f.type === "select"` branch (lines ~170-201) with:
```typescript
              ) : f.type === "select" ? (
                <Select
                  value={values[f.key] ? values[f.key] : "__none__"}
                  onValueChange={async (v) => {
                    if (v === "__create__") {
                      if (!f.onCreateNew) return;
                      setCreating(f.key);
                      try {
                        const created = await f.onCreateNew();
                        if (created) {
                          setExtraOptions((prev) => ({ ...prev, [f.key]: [...(prev[f.key] ?? []), created] }));
                          setValues((prev) => ({ ...prev, [f.key]: created.value }));
                          clearFieldError(f.key);
                        }
                      } finally {
                        setCreating(null);
                      }
                      return;
                    }
                    setValues((prev) => ({ ...prev, [f.key]: v === "__none__" ? "" : v }));
                    clearFieldError(f.key);
                  }}
                >
                  <SelectTrigger
                    id={f.key}
                    aria-required={f.required ?? undefined}
                    aria-invalid={errors[f.key] ? true : undefined}
                    aria-describedby={errors[f.key] ? `${f.key}-err` : undefined}
                    disabled={creating === f.key}
                  >
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.onCreateNew ? (
                      <SelectItem value="__create__">{f.createLabel ?? t("dialog_create_new")}</SelectItem>
                    ) : null}
                    {[...f.options, ...(extraOptions[f.key] ?? [])].map((o) => (
                      <SelectItem key={o.value === "" ? "__none__" : o.value} value={o.value === "" ? "__none__" : o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
```

- [ ] **Step 6: Add the `dialog_create_new` fallback translation key to `src/lib/i18n.tsx`**

```typescript
  dialog_create_new: { en: "+ Add new", ar: "+ إضافة جديد" },
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test src/components/phc/action-dialog-creatable-select.contract.test.ts`
Expected: `4 pass, 0 fail`

- [ ] **Step 8: Run the full test suite to confirm no regression in existing `ActionDialog` consumers**

Run: `bun test src`
Expected: all previously-passing tests still pass (no test exercises the removed/changed branch signature since the change is additive-only on the type).

- [ ] **Step 9: Manual smoke test of the actual interaction**

The contract test only asserts source shape, not runtime behavior — verify the real interaction now (Task 6 wires this into the RFQ form, so this can also be deferred to Task 6's manual test if easier to exercise there): with `bun run dev` running, find any existing `"select"` field in the app, temporarily confirm nothing regressed by exercising a normal (non-creatable) select still opens/selects correctly.

- [ ] **Step 10: Commit**

```bash
git add src/components/phc/ActionDialog.tsx src/components/phc/action-dialog-creatable-select.contract.test.ts src/lib/i18n.tsx
git commit -m "feat(ui): add creatable-select capability to ActionDialog's select field"
```

---

### Task 6: RFQ project picker — inline "add new project"

**Files:**
- Modify: `src/routes/_authenticated/rfq-jih.tsx:264-293` (New RFQ dialog), add local state near other `useState` calls (~line 84)

**Interfaces:**
- Consumes: `ActionDialog`'s `onCreateNew`/`createLabel` (Task 5), `createProject` from `src/lib/crm-actions.ts:155-182` (already exists, unchanged).

- [ ] **Step 1: Add state for the nested "create project" dialog**

Near `const [historyRfq, setHistoryRfq] = useState...` (line 84):
```typescript
  const [creatingProjectFor, setCreatingProjectFor] = useState<((result: { value: string; label: string } | null) => void) | null>(null);
```

- [ ] **Step 2: Wire `onCreateNew` on the `projectId` field in the New RFQ dialog**

Replace:
```typescript
          { key: "projectId", type: "select", label: t("nav_projects"), options: [{ value: "__none__", label: "—" }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))] },
```
with:
```typescript
          {
            key: "projectId", type: "select", label: t("nav_projects"),
            options: [{ value: "__none__", label: "—" }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))],
            createLabel: t("wf_add_new_project"),
            onCreateNew: () => new Promise((resolve) => setCreatingProjectFor(() => resolve)),
          },
```

- [ ] **Step 3: Add the nested create-project `ActionDialog`**

Immediately after the New RFQ `ActionDialog` closing tag (after line 293):
```typescript
      {/* Inline "add new project" from the RFQ project picker */}
      <ActionDialog
        open={!!creatingProjectFor}
        onOpenChange={(o) => { if (!o) { creatingProjectFor?.(null); setCreatingProjectFor(null); } }}
        title={t("wf_add_new_project")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "name", type: "text", label: t("label_project"), required: true },
          { key: "location", type: "select", label: t("ibx_location_city"), options: [{ value: "", label: "—" }, ...INBOX_LOCATIONS.map((l) => ({ value: l, label: t(`ibx_location_${l}`) }))] },
        ]}
        onSubmit={async (v) => {
          const project = await createProject({ name: v.name, location: v.location || undefined });
          creatingProjectFor?.({ value: project.id, label: project.name });
          setCreatingProjectFor(null);
          refresh();
        }}
      />
```

- [ ] **Step 4: Add the required imports**

`rfq-jih.tsx` has no existing import from either module — add two new import lines, near the existing `from "@/lib/rfq-actions"` import (line 14):
```typescript
import { createProject } from "@/lib/crm-actions";
import { INBOX_LOCATIONS } from "@/lib/inbox-actions";
```

- [ ] **Step 5: Add the `wf_add_new_project` translation key to `src/lib/i18n.tsx`**

```typescript
  wf_add_new_project: { en: "+ Add new project", ar: "+ إضافة مشروع جديد" },
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Manual smoke test**

Run: `bun run dev`, open `/rfq-jih`, click "New RFQ," open the Project dropdown, click "+ Add new project," fill in a name, submit, confirm the nested dialog closes and the new project is auto-selected in the RFQ form's Project field, then complete and submit the RFQ successfully.

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/rfq-jih.tsx src/lib/i18n.tsx
git commit -m "feat(rfq): inline 'add new project' when the wanted project isn't in the picker"
```

---

### Task 7: Post-create UX messaging (destination hints)

**Files:**
- Modify: `src/routes/_authenticated/rfq-jih.tsx` (New RFQ `onSubmit`, around line 275-287)
- Modify: `src/routes/_authenticated/lead-tender-inbox.tsx` (New Intake `onSubmit`)
- Modify: `src/lib/i18n.tsx`

**Interfaces:** none (pure UI copy change, no new functions/types).

- [ ] **Step 1: Add two translation keys**

```typescript
  rfq_created_location_hint: { en: "RFQ created — find it under RFQ & JIH Board → RFQ Received.", ar: "تم إنشاء طلب عرض السعر — تجده ضمن RFQ & JIH Board ← RFQ المستلمة." },
  intake_created_location_hint: { en: "Saved to Intake — convert it to an RFQ, Tender, or Lead when ready.", ar: "تم الحفظ في Intake — حوّله إلى RFQ أو منافسة أو Lead عند الجاهزية." },
```

- [ ] **Step 2: Update the New RFQ success toast in `rfq-jih.tsx`**

Replace:
```typescript
            toast.success(t("crm_saved"));
```
(inside the New RFQ dialog's `onSubmit`, not the JIH-conversion one further down) with:
```typescript
            toast.success(t("rfq_created_location_hint"));
```

- [ ] **Step 3: Update the New Intake success toast in `lead-tender-inbox.tsx`**

In the same New Intake `onSubmit` block touched in Task 2 Step 5, replace:
```typescript
            toast.success(t("crm_saved"));
            refresh();
```
(immediately after the `createInboxItem(...)` call) with:
```typescript
            toast.success(t("intake_created_location_hint"));
            refresh();
```

- [ ] **Step 4: Manual smoke test**

Run: `bun run dev`, create a New RFQ and confirm the toast names the destination; create a New Intake item and confirm its toast does too.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/rfq-jih.tsx src/routes/_authenticated/lead-tender-inbox.tsx src/lib/i18n.tsx
git commit -m "feat(ux): post-create toasts name the record's destination"
```

---

### Task 8: "View Details" panel on RFQ cards

**Files:**
- Modify: `src/routes/_authenticated/rfq-jih.tsx` (state near line 84, card markup lines 158-193, new `Dialog` near the existing `historyRfq` `Dialog` at line 370)

**Interfaces:** none new — reuses the existing `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` already imported in this file (lines 20-24), matching the `historyRfq` panel's exact pattern (not `Sheet` — kept consistent with the sibling "History" panel already in this same file).

- [ ] **Step 1: Add state for the details panel**

Near `const [historyRfq, setHistoryRfq] = useState...` (line 84):
```typescript
  const [detailsRfq, setDetailsRfq] = useState<any | null>(null);
```

- [ ] **Step 2: Add a "View Details" icon button to the RFQ card, next to the existing History button**

In the card markup (around line 173-180, right before the existing History `<button>`):
```typescript
                      <button
                        type="button"
                        onClick={() => setDetailsRfq(r)}
                        title={t("wf_view_details")}
                        className="grid h-6 w-6 place-items-center rounded-md border border-border/70 text-muted-foreground hover:text-foreground"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
```

Add `Eye` to the existing `lucide-react` import (line 5):
```typescript
import { Plus, ArrowRight, History, Eye } from "lucide-react";
```

- [ ] **Step 3: Add the details `Dialog`, right after the existing `historyRfq` `Dialog` (after line ~378)**

The `rfqs` query (`src/routes/_authenticated/rfq-jih.tsx:94`) is `select("*")` with no join, so `detailsRfq` only has raw `company_id`/`project_id` FKs — resolve display names from the already-fetched `companies`/`projects` lists (lines 103-108, the same arrays that populate the New RFQ dialog's dropdowns) rather than adding a new join:
```typescript
      <Dialog open={!!detailsRfq} onOpenChange={(o) => !o && setDetailsRfq(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailsRfq?.rfq_number ?? "RFQ"}</DialogTitle>
          </DialogHeader>
          {detailsRfq ? (
            <div className="grid gap-2 text-sm">
              <div><span className="text-muted-foreground">{t("crm_company")}: </span>{companies.find((c: any) => c.id === detailsRfq.company_id)?.name ?? "—"}</div>
              <div><span className="text-muted-foreground">{t("nav_projects")}: </span>{projects.find((p: any) => p.id === detailsRfq.project_id)?.name ?? "—"}</div>
              <div><span className="text-muted-foreground">{t("crm_total_value")}: </span>{formatCurrency(detailsRfq.estimated_value, lang, "SAR")}</div>
              <div><span className="text-muted-foreground">{t("wf_expected_contract")}: </span>{detailsRfq.response_due_date ?? "—"}</div>
              {detailsRfq.document_url ? (
                <a href={detailsRfq.document_url} target="_blank" rel="noreferrer" className="text-primary underline">
                  {t("wf_evidence")}
                </a>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Add the `wf_view_details` translation key**

```typescript
  wf_view_details: { en: "View Details", ar: "عرض التفاصيل" },
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Manual smoke test**

Run: `bun run dev`, open `/rfq-jih`, click the new "eye" icon on an RFQ card, confirm a dialog opens showing RFQ #, company, project, value, due date, and document link (if present).

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/rfq-jih.tsx src/lib/i18n.tsx
git commit -m "feat(rfq): add View Details panel to RFQ board cards"
```

---

### Task 9: Sidebar — remove the "Recent" section

**Files:**
- Modify: `src/components/phc/AppShell.tsx:370-393` (remove), `:~398` (divider condition)

**Interfaces:** none — `useRecentRecords()` (line 213) and the auto-track `useEffect` (lines 216-234) are **not** touched; only the rendered list block is removed, since `CommandPalette.tsx` and `my-workspace.tsx` still consume the hook's state.

- [ ] **Step 1: Remove the rendered "Recent records" block**

Delete lines 370-393 (the `{/* Recent records */} {recent.length > 0 && (...)}` block) entirely.

- [ ] **Step 2: Update the divider condition**

Find (immediately after the deleted block, originally around line 395-398):
```typescript
        {/* Divider if recent/pinned present */}
        {(pinned.length > 0 || recent.length > 0) && (
          <div className="mx-3 mb-4 h-px bg-border/50" />
        )}
```
Replace with:
```typescript
        {/* Divider if pinned present */}
        {pinned.length > 0 && (
          <div className="mx-3 mb-4 h-px bg-border/50" />
        )}
```

- [ ] **Step 3: Confirm `recent` is still referenced (avoid an unused-variable lint error)**

`const { recent, trackRecent } = useRecentRecords();` (line 213) — `trackRecent` is still used by the auto-track effect (line ~233). `recent` itself is no longer read anywhere in `AppShell.tsx` after Step 1-2. Change line 213 to:
```typescript
  const { trackRecent } = useRecentRecords();
```

- [ ] **Step 4: Lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: no errors, no unused-variable warnings.

- [ ] **Step 5: Manual smoke test**

Run: `bun run dev`, visit a few opportunity/account/project detail pages to populate recent-tracking, confirm the sidebar no longer shows a "Recent" section, confirm Cmd+K still shows a "Recent" group in the command palette (unaffected), confirm "Pinned" section (if any pins exist) still renders correctly with its own divider.

- [ ] **Step 6: Commit**

```bash
git add src/components/phc/AppShell.tsx
git commit -m "feat(nav): remove sidebar Recent section (Cmd+K Recent and Pinned unaffected)"
```

---

### Task 10: Final verification and PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full verify gate**

Run: `bun run verify`
Expected: typecheck, lint, full test suite, and build all pass with 0 errors.

- [ ] **Step 2: Run the DB test suite against a fresh local instance**

Run:
```bash
supabase start
bun run test:db
supabase stop --no-backup
```
Expected: all pgTAP tests pass (including `rls_role_matrix.test.sql` and `security_baseline.test.sql`, confirming the two new migrations don't break any existing RLS/security assertion).

- [ ] **Step 3: Update `docs/CHANGELOG.md`, `docs/AI_HANDOFF.md`, `tasks/backlog.md`**

Add a `### Added`/`### Changed` entry to `docs/CHANGELOG.md` under a new `## 2026-07-26 — Phase 1 quick UX fixes` heading listing the 5 shipped items; update `docs/AI_HANDOFF.md`'s Current Goal/Completed sections noting Phase 1 shipped and Phase 2 (dashboards / form consolidation / page removal) is next in the user-approved sequence; mark this item in `tasks/backlog.md` if it was tracked there.

- [ ] **Step 4: Push and open a PR**

```bash
git push -u origin fix/phase1-quick-ux-fixes
gh pr create --title "feat: Phase 1 quick UX fixes (intake fields, confidence select, creatable project picker, UX messaging, sidebar cleanup)" --body "Implements docs/superpowers/specs/2026-07-26-phase1-quick-fixes-design.md. Two additive migrations (not deployed to production — pending the usual approval gate). bun run verify passes clean."
```

- [ ] **Step 5: Confirm CI is green on the PR, then stop — merge is a separate, explicit decision**

Run: `gh pr checks <PR number>` until all required checks pass. Do not merge automatically; that decision belongs to whoever requested this plan.
