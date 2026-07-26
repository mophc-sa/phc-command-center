# Phase 1 — Quick, Low-Risk UX Fixes

**Date:** 2026-07-26
**Branch:** `fix/phase1-quick-ux-fixes` (to be created)
**Depends on:** none (additive only — no removal of existing pages/forms)
**Source:** Client-side stakeholder feedback, `AGENT COMMENTS - 23-07-2026.pdf` (annotated screenshots) + a live clarification round with the user (2026-07-26).

---

## 1. Goal

The user provided annotated screenshots and a written list of desired changes to the PHC Command Center sales CRM. The full request spans 7+ largely-independent subsystems (role dashboards, a 5-form-into-1 consolidation, page removals, a brand-new evidence-checklist feature, an open architecture question about variable per-tender BOQ monitoring). Per the brainstorming process, this was decomposed into phases; this spec covers only **Phase 1: quick, low-risk fixes** — the smallest, safest slice, chosen to ship first.

Two important discoveries from investigation, confirmed with the user before writing this spec:
- The PDF's "Evidence checklist" / "Technical Notes field" / target-amount dashboard do **not** match anything in the current codebase (`main`). The user confirmed these describe **genuinely new functionality to design later** (Phase 3/4), not a mismatch to fix now.
- Two separate, un-unified intake surfaces already exist in the codebase (`lead-tender-inbox.tsx` → `inbox_items`, and `discovery.tsx` → `leads`) beyond the 3 the user named (RFQ, Quotation, BOQ). The user confirmed both should be folded into the later "5-forms-into-1" consolidation (Phase 2) — **not** part of this Phase 1 spec.

## 2. Scope

**In scope (this spec):**
1. Add missing fields to the Intake form (`lead-tender-inbox.tsx`): Client Type, Project Type, Project Number, RFQ From, Date Received; convert Scope and Location from free text to fixed-vocabulary selects.
2. Convert Contacts' `confidence_score` (numeric %, display-only) into a new `confidence_level` enum (high/medium/low), backfilled from existing data.
3. Add a reusable "creatable select" capability to `ActionDialog`'s `select` field type, and wire it into the RFQ form's Project picker.
4. UX messaging: post-create confirmation of where a new RFQ landed; a "View Details" affordance on RFQ board cards.
5. Remove the sidebar's rendered "Recent" section (keep the underlying tracking hook — it's also consumed by the Cmd+K command palette and a `my-workspace` widget).

**Explicitly out of scope (later phases, not touched here):**
- Merging `inbox_items`/`leads`/`rfqs`/`quotations`/`boqs` into one write path, or any change to `rfq-jih.tsx`'s or `quotations.tsx`'s or `boq.tsx`'s existence (Phase 2).
- Role-based Sales vs. Management dashboards / per-user target amounts UI (Phase 3 — infra already exists: `sales_targets` table, `computeSalespersonMetrics`/`computeManagerMetrics` in `targets-metrics.ts`).
- The Evidence-checklist / Technical-Notes new feature (Phase 4).
- The open question on monitoring variable per-tender/per-contractor BOQ packages (Phase 5 — a design discussion, not a fix).
- Any change to the JIH conversion gate logic (`convert_rfq_to_jih` business rules) or any other Edge Function business logic.

## 3. Intake form field additions

**Current state** (`src/routes/_authenticated/lead-tender-inbox.tsx`, `newIntakeFields()`, lines 37-59): 19 fields including `scope` (`type: "textarea"`) and `location` (`type: "text"`) as free-form input, with no `clientType`, `projectType`, `projectNumber`, `rfqFrom`, or `dateReceived` fields. Table `public.inbox_items` (`supabase/migrations/20260709100000_lead_tender_inbox.sql`, lines 53-71) stores `scope TEXT` and `location TEXT`.

**New migration** (following the exact `contact_authority`/`contact_location` ENUM pattern already established in `20260707100010_crm_core.sql`, lines 32-39):

```sql
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
  ADD COLUMN date_received DATE NOT NULL DEFAULT CURRENT_DATE;

-- scope/location: add new typed columns rather than altering the existing
-- TEXT columns in place, so any historical free-text values are preserved
-- untouched (no lossy cast attempted on existing rows).
ALTER TABLE public.inbox_items
  ADD COLUMN scope_type public.inbox_scope,
  ADD COLUMN location_city public.inbox_location;
```

All 6 new columns are **nullable** (except `date_received`, which defaults to today) — additive only, no impact on existing rows or other readers of `inbox_items`. The legacy `scope`/`location` TEXT columns are left in place, unused by the form going forward (candidates for removal in a later cleanup once confirmed nothing else reads them — out of scope here).

**Form changes** (`newIntakeFields()`): add `clientType`, `projectType`, `projectNumber`, `rfqFrom`, `dateReceived` (type `"date"`, `defaultValue` = today's ISO date) as new fields; change `scope` → `scopeType` (`type: "select"`, options from `INBOX_SCOPES`) and `location` → `locationCity` (`type: "select"`, options from `INBOX_LOCATIONS`), following the exact `AUTHORITIES`/`LOCATIONS` constant-array + `xLabel()` translation-key helper pattern already used in `contacts.tsx` (lines 23-26, 58-59). New translation keys added to `src/lib/i18n.tsx` for every option label (bilingual EN/AR, matching every other label in this file).

`createInboxItem` (`src/lib/inbox-actions.ts`) gets the 6 new optional fields added to `InboxItemInput` and passed straight through to the insert — same shape as every other field in that function today.

## 4. Contacts — Confidence field

**Current state**: `contacts.confidence_score INT CHECK (BETWEEN 0 AND 100)` (`20260707100010_crm_core.sql:138`), a free-text form input (`contacts.tsx:243`) cast via `Number()`, displayed as `${c.confidence_score}%` (`contacts.tsx:202`). Confirmed via repo-wide grep: **no other code reads or sorts by this column** — it is purely stored and displayed.

**New migration**:
```sql
CREATE TYPE public.contact_confidence_level AS ENUM ('high', 'medium', 'low');

ALTER TABLE public.contacts ADD COLUMN confidence_level public.contact_confidence_level;

UPDATE public.contacts SET confidence_level = CASE
  WHEN confidence_score >= 70 THEN 'high'
  WHEN confidence_score >= 40 THEN 'medium'
  WHEN confidence_score IS NOT NULL THEN 'low'
  ELSE NULL
END::public.contact_confidence_level;
```
`confidence_score` is left in place (unused by the form afterward, not dropped — zero risk of data loss; a future cleanup can drop it once confirmed nothing depends on the number).

**Form/display changes**: `confidenceScore` (text) field replaced with `confidenceLevel` (select: High/Medium/Low, same pattern as `authority`/`location`). Table display (`contacts.tsx:202`) switches from `${c.confidence_score}%` to a `StatusPill` showing the level label (matching how `authority` is already rendered one column over, line 198). `createContact` (`crm-actions.ts`) gets `confidenceLevel?: ContactConfidenceLevel | null` replacing `confidenceScore`.

## 5. Creatable select — "add new project" from the RFQ form

**Current state**: `ActionDialog`'s `DialogField` union (`src/components/phc/ActionDialog.tsx:26-46`) has no create-inline affordance. The RFQ form's `projectId` field (`rfq-jih.tsx:273`) is a plain read-only `<select>` sourced from a `projects-min` query.

**Design**: extend the existing `"select"` variant (not a new field type, to avoid a parallel code path) with two optional properties:
```ts
| {
    key: string;
    type: "select";
    label: string;
    required?: boolean;
    defaultValue?: string;
    options: { value: string; label: string }[];
    onCreateNew?: () => Promise<{ value: string; label: string } | null>;
    createLabel?: string; // e.g. "+ Add new project" — defaults to a generic i18n string if omitted
  }
```
When `onCreateNew` is present, `ActionDialog` renders one extra `SelectItem` (value `"__create__"`, label = `createLabel`) at the top of the options list. Selecting it calls `onCreateNew()` instead of setting the field value directly; if it resolves to a record, that record is appended to the in-memory options list and auto-selected. If it resolves to `null` (user cancelled the nested create), the select reverts to its previous value. No change to any other field type or caller — every existing `"select"` usage is unaffected since both new properties are optional.

`rfq-jih.tsx` passes `onCreateNew: async () => { /* opens a lightweight nested ActionDialog with just `name` + `location`, calls the existing `createProject` from `crm-actions.ts`, returns { value: id, label: name } */ }`. This reuses the existing single-purpose New Project creation path — no new Edge Function or table write logic, just a second, nested dialog invocation from within the RFQ dialog.

## 6. UX messaging

- **Post-create confirmation**: after `createRfq()` succeeds (`rfq-jih.tsx`'s New RFQ `onSubmit`), the existing `toast.success(t("crm_saved"))` is replaced with a toast that also names the destination, e.g. `t("rfq_created_location_hint")` → *"RFQ created — find it under RFQ & JIH Board → RFQ Received."* Same pattern applied to `createInboxItem`'s success toast in `lead-tender-inbox.tsx` (hint: *"Saved to Intake — convert it to an RFQ, Tender, or Lead when ready."*).
- **"View Details" on RFQ cards**: the RFQ Received card list (`rfq-jih.tsx`, the card grid rendering `SAR {amount}` + `Log Activity`/`Email via Outlook`/`WhatsApp` actions) gets one more small icon-button that opens a `Sheet` slide-in panel (`src/components/ui/sheet.tsx` — the existing pattern for read-only detail views, already used by `NotificationCenter.tsx`) showing every field captured at creation (RFQ #, company, project, estimated value, response due date, document link).

## 7. Sidebar — remove "Recent"

**Current state**: `AppShell.tsx` — `useRecentRecords()` (line 213) is consumed by 3 call sites: the auto-track `useEffect` in `AppShell.tsx` itself (lines 216-234, populates the shared recent-records state on every `/opportunities|accounts|projects/:id` visit), the sidebar's rendered list (lines 370-393), and, separately, `CommandPalette.tsx` (Cmd+K "Recent" group) and `my-workspace.tsx` (a dashboard widget).

**Change**: remove only the sidebar rendering block (lines 370-393) and adjust the divider condition (line ~398, currently `pinned.length > 0 || recent.length > 0`) to `pinned.length > 0` alone. **Keep** the auto-track `useEffect` (lines 216-234) and the `useRecentRecords` hook itself untouched — removing those would silently break the Cmd+K palette's Recent group and the `my-workspace` widget, which is out of scope here and not something the user asked to change.

## 8. Testing

- Unit tests for the new option-label helpers (client type / project type / rfq-from / scope / location / confidence level → label mappings), mirroring the existing `authorityLabel`/`locationLabel` test coverage pattern if one exists for those, else a new lightweight test file.
- A pgTAP or contract test asserting the confidence backfill CASE logic buckets scores correctly at the 70/40 boundaries (0, 39, 40, 69, 70, 100, NULL).
- Manual QA per this repo's `/qa` convention for: Intake form submission with all new fields, RFQ creation with inline "add new project," Contacts confidence select, sidebar no longer showing Recent while Cmd+K Recent still works.
- `bun run verify` must pass before any PR.

## 9. Rollout

Standard flow for this repo: new migration + code in a branch, PR, review, merge to `main`. The migration is applied to production **only** after the usual approval-gated deploy (per `docs/deployment-governance.md`) — not automatically on merge.
