# Project tracking (group 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each opportunity an update log, construction %, canonical stage, separate estimated / awarded values and a contact job title. Show progress on the manager's home page. Close the remaining numbering and permission gaps.

**Architecture:** One migration adds `opportunity_updates`, the two title columns, the probability-on-close trigger, the narrowed number permission and project-number inheritance. Pure helpers go in `src/lib` with bun tests. UI: new self-contained `ProjectUpdatesPanel` and `ProjectProgressPanel`, plus edits to existing screens.

**Tech Stack:** TanStack Router/Query, Supabase (Postgres + RLS + pgTAP), bun test, Tailwind, shadcn/ui.

## Global Constraints
- Bilingual: every new string has `en` and `ar`. Arabic text uses Western digits only (no Arabic-Indic digits in source).
- NULL completion is "unknown", never 0. Show "—".
- Migration `supabase/migrations/20261022100000_project_tracking.sql`. Production `db push` is approval-gated and is not run in this work.
- `docs/USER_GUIDE.md` is updated in the same PR: the affected sections, section 10 and the footer.
- Generated types are patched by hand (`src/integrations/supabase/types.ts`) for the new table and columns.
- Commit after every task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Migration + pgTAP
**Files:** Create `supabase/migrations/20261022100000_project_tracking.sql` and `supabase/tests/project_tracking.test.sql`. Modify `src/integrations/supabase/types.ts`.

**Produces:**
- Table `public.opportunity_updates(id uuid, opportunity_id uuid, kind text, note text, completion_pct smallint, created_by uuid, created_at timestamptz)`
- Columns `inbox_items.contact_title` and `stakeholders.title` (text)
- Functions `set_probability_on_close()`, `apply_opportunity_update()`
- Updated `can_edit_rfq_number` and `create_project_from_won_opportunity`

- [ ] Write the pgTAP test (users with the `4a…` prefix). It covers:
  - the owner posts an update with 60 → `completion_pct` becomes 60
  - `progress_update` without a % is refused (23514)
  - `other` without a note is refused (23514)
  - a salesperson who doesn't own the deal cannot insert (42501)
  - a viewer cannot insert (42501)
  - sales_stage → won gives probability 100; → lost gives 0
  - a bd_manager's number edit is discarded; a sales_manager's is kept
  - winning creates a project whose `project_number` = the RFQ number
- [ ] Write the migration so it passes.
  - CHECK `(kind <> 'other' OR nullif(btrim(note),'') IS NOT NULL)`
  - CHECK `(kind <> 'progress_update' OR completion_pct IS NOT NULL)`
  - Insert policy: `created_by = auth.uid() AND is_sales_contributor(auth.uid()) AND EXISTS (select 1 from opportunities o where o.id = opportunity_id)`. The subquery is subject to opportunities RLS, so only people who can see the deal can post.
  - Delete policy: `(created_by = auth.uid() AND created_at > now() - interval '24 hours') OR is_pipeline_operator(auth.uid())`.
  - The AFTER INSERT trigger is SECURITY DEFINER. It updates `completion_pct` (when not null) and `last_activity_at = now()`.
  - Probability trigger: BEFORE UPDATE OF stage, sales_stage. Won means (stage = 'won' or sales_stage = 'won'), changed from not-won; it sets 100, `_by = auth.uid()`, `_at = now()` and reason 'Closed won'. Lost works the same way with 0.
  - Backfill of won/lost rows whose probability differs, with one `audit_log` row each (`opportunity.probability_closed_backfill`).
  - `can_edit_rfq_number` → `ARRAY['sales_manager','system_admin']`.
  - Project trigger: before the INSERT, select the latest `rfqs.rfq_number` for NEW.id. Use it if it isn't already in `projects.project_number`.
- [ ] Run `bun run test:db:behaviour` or `supabase test db`. If the local stack fails on the pre-existing `20261003100000` (`gen_random_bytes`) problem, note it; CI runs `supabase/tests`.
- [ ] Patch the types and commit.

### Task 2: Pure helpers
**Files:** Create:
- `src/lib/project-updates.ts` + `.test.ts`
- `src/lib/project-label.ts` + `.test.ts`
- `src/lib/suggested-fields.ts` + `.test.ts`

Modify `src/lib/sales-kpis.ts` (add `awardedValue`) + its test.

**Produces:**
- `UPDATE_KINDS` (readonly tuple of the 10 kinds) and `UpdateKind`
- `UPDATE_KIND_LABEL: Record<UpdateKind, {en, ar}>`
- `validateUpdate({kind, note, pct}): {ok:true, pct:number|null} | {ok:false, reason:'note_required'|'pct_required'|'pct_invalid'}`
- `projectWithContractor(name: string|null, contractor: string|null): string`. Returns `"Name — Contractor"`, or just the name. A contractor equal to the name (case-insensitive) is dropped.
- `awardedValue(o: {stage?, sales_stage?, contract_value?, quotation_value?}): number|null`. Returns contract_value, else quotation_value when won, else null.
- `applySuggestions(values, suggested: Set<string>, touched: Set<string>, proposal: Record<string,string>): {values, suggested}`. It fills only keys that are empty and untouched.
- `pendingSuggestions(suggested, visibleKeys): string[]`
- [ ] Write the tests first, run them (`bun test src/lib/<file>.test.ts`) and see them fail. Then implement, see them pass, and commit.

### Task 3: Opportunity page — updates, stage, values, number link, edit rights
**Files:** Create `src/components/phc/ProjectUpdatesPanel.tsx` and `src/lib/project-update-actions.ts`. Modify:
- `src/routes/_authenticated/opportunities.$id.tsx`
- `src/lib/roles.ts` (+ test if one exists)

**Consumes:** Task 1 table and Task 2 helpers.

**Produces:**
- `listProjectUpdates(opportunityId)`, `postProjectUpdate({opportunityId, kind, note, pct})`, `deleteProjectUpdate(id)`
- `canEditOpportunityInputs(roles, {isOwner})`

Steps:
- [ ] Panel: "Post update" button (shown to anyone who can edit inputs) opens an ActionDialog with kind (select), new construction % (text, 0–100) and note.
  - List rows: kind pill · note · "% → 60%" · author · date.
  - The author or a pipeline operator gets a delete control for 24 h.
  - The current construction % is shown as a bar in the panel header.
- [ ] Mount the panel directly after the key-facts panel, under `show("alert")`.
- [ ] Header pill: `t(canonicalStageLabelKey(resolveCanonicalStage(o).stage))` replaces `humanize(o.stage)`.
- [ ] Header number: link to `/projects/$id` when `o.project` exists, with title "Project file (budget)"; otherwise plain text.
- [ ] Key facts:
  - Quotation shows `o.quotation_value`.
  - Estimated range stays.
  - Add Awarded (`awardedValue(o)`) and Construction % ("—" when null).
- [ ] `canEditClientDetails` → `canEditOpportunityInputs(roles, {isOwner: o.owner_id === user.id})`.
- [ ] Typecheck, lint and the related contract tests. Commit.

### Task 4: Home panel + lists
**Files:** Create `src/components/phc/ProjectProgressPanel.tsx`. Modify:
- `src/routes/_authenticated/command-center.tsx`
- `src/routes/_authenticated/opportunities.index.tsx`
- `src/routes/_authenticated/my-workspace.tsx`
- `src/lib/attention.ts`
- `src/components/phc/OpportunityCard.tsx` (only if needed)

Steps:
- [ ] Panel query: opportunities with `id, project_name, main_contractor, contractor_company, stage, sales_stage, completion_pct, last_activity_at, opportunity_updates(kind, note, created_at)`, excluding archived.
  - Filter in JS to canonical stages not in won/lost/on_hold.
  - Sort by latest update, then last_activity. Take the top 10.
  - Each row: link to the opportunity, contractor sub-line, stage pill, % bar or "—", latest update kind + relative date.
  - "See all" → /opportunities with view `table`.
- [ ] Mount it on command-center after the needs-attention section.
- [ ] Opportunities table:
  - The project cell shows a contractor sub-line, and the RFQ number becomes a link.
  - New columns Stage, Completion and Last update.
  - Add `main_contractor`, `contractor_company:companies!opportunities_main_contractor_id_fkey(name)` and `opportunity_updates(kind, created_at)` to the select.
  - Add sort keys `stage`, `completion` and `last_update`.
- [ ] my-workspace: a contractor sub-line under each project link in the three deal tables.
- [ ] attention.ts: `label: projectWithContractor(o.project_name, o.main_contractor)` (if the row type lacks the column, add it to the select).
- [ ] Typecheck, lint and tests. Commit.

### Task 5: Contact job title
**Files:** Modify:
- `src/components/phc/NewIntakeDialog.tsx`
- `src/lib/inbox-actions.ts`
- `src/lib/rfq-actions.ts`
- `src/lib/opportunity-collab-actions.ts`
- `src/routes/_authenticated/opportunities.$id.tsx`
- `src/components/phc/RelationshipPanel.tsx`
- `src/components/phc/IntakeReviewPanel.tsx`

Steps:
- [ ] Intake field `contactTitle` ("Job title" / "المسمى الوظيفي") after the contact name, in the first section.
- [ ] Wire `contactTitle` through `createInboxItemAndRoute` (`contact_title`), then `convertInboxToRfq`, then `createRfqWithOpportunity` (`contacts.title` and `stakeholders.title`).
- [ ] Client details panel shows and edits the job title (`upsertClientDetails` gets `contactTitle`). The RelationshipPanel row shows the title next to the name. The intake review shows it.
- [ ] Update the contract tests that pin these functions if they assert exact field lists. Commit.

### Task 6: Autofill in blue with confirm tick
**Files:** Modify `src/components/phc/ActionDialog.tsx` and `src/components/phc/NewIntakeDialog.tsx`.

**Consumes:** `applySuggestions` and `pendingSuggestions` (Task 2).

Steps:
- [ ] ActionDialog prop `suggest?: (values: Record<string,string>) => Record<string,string> | null`.
  - State: `suggested` (Set), plus a `touched` ref that `clearFieldError` marks.
  - An effect on `values` calls `suggest` and `applySuggestions`.
  - Suggested fields render with a `text-info` input and a ✓ button beside the label (aria-label "Confirm suggested value"). The ✓ removes the key from `suggested`; any edit does the same.
  - Submit shows the error `dialog_confirm_suggestions` while `pendingSuggestions` is non-empty for visible fields.
- [ ] NewIntakeDialog: the `known` query also loads the latest intake per company (company_name, contact_name, contact_title, phone, email, client_type, main_contractor, consultant, created_at desc).
  - `suggest(v)` uses `exactMatch` on `companyName` to return that company's values.
- [ ] Add the bilingual strings. Typecheck, lint and tests. Commit.

### Task 7: Docs, verification, PR
- [ ] `docs/USER_GUIDE.md`: the opportunity page (updates, values, stage), intake (job title, autofill), the home page panel, permissions (owner edits inputs, number = sales manager), section 10 and the footer.
- [ ] `docs/DECISIONS.md`: the decisions for completion %, the number link and the edit scope.
- [ ] `docs/CHANGELOG.md` and `docs/AI_HANDOFF.md`. Move the task in `tasks/` to completed.
- [ ] `bun run verify` (typecheck, lint, test, build).
- [ ] Push as mophc-sa and open the PR. The PR body lists the migration needing approval-gated `db push` before the UI release, and states that it was not tried in a browser.
