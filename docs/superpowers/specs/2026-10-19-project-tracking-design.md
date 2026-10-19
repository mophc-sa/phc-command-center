# Project tracking (manager feedback group 4) — design

Date: 2026-10-19 · Due: 2026-10-27 · Branch: `feat/project-tracking-group4`
Source: the PHC manager's feedback list of 2026-10-19, group 4. Approved by Mo on 2026-10-19.
In this codebase "project" means the **opportunity** (`/opportunities/$id`). The `projects` table
(`/projects/$id`) is Production's record. A trigger creates it when an opportunity is won (`20260803110000`).

## Decisions

| # | Item | Decision |
|---|------|----------|
| 1 ★ | Actual completion % + current stage on the home page | Completion % means **construction progress**, stored in the existing `opportunities.completion_pct`. Current stage means the **canonical sales stage** (`resolveCanonicalStage`), used everywhere. The opportunity page header stops showing the legacy `stage`. A new panel on `/command-center` lists active projects, each with its stage, a construction % bar and the latest update. |
| 2 ★ | Update log inside each project | New table `opportunity_updates`. Each update has a preset kind, an optional note and an optional new construction %. When an update carries a %, it also sets `opportunities.completion_pct`. The opportunity page gets a "Project updates" panel, newest first. |
| 3 | Estimated vs awarded value | The key-facts panel shows three separate figures. **Estimated** is the min–max range. **Quotation** is `quotation_value` itself, no longer the blended `opportunityValue()`. **Awarded** is `contract_value`, or the quotation once won, and shows "—" before award. Money fields stay with Finance / BD manager (client request of 2026-08-03). |
| 4 | Win probability 0–100, won = 100 | A trigger handles closing. When stage or sales_stage becomes won, it sets `human_win_probability = 100` with the reason "Closed won". When it becomes lost, it sets 0 with the reason "Closed lost". Existing won/lost rows are backfilled, and each backfilled change is audited. |
| 5 | Project name with contractor in lists | Shared helper `projectWithContractor()`. Used in the opportunities table, my-workspace rows, NeedsAttentionPanel and the new home panel. |
| 6 | Contact person's job title | Adds `inbox_items.contact_title` and `stakeholders.title`. The intake form asks for "Job title". Conversion writes it to `contacts.title` and `stakeholders.title`. Client details shows and edits it. |
| 7 | Autofill shown in blue with a confirm tick | `ActionDialog` gets a generic `suggest` hook. On the intake form, typing a known company fills the empty contact name, title, phone, email, client type, main contractor and consultant from that company's latest intake. Suggested fields show in blue with a ✓. Editing a field or pressing ✓ confirms it. Submit stays blocked while unconfirmed blue fields remain. |
| 8 | Auto project number from the rep's code | Already exists (`<CODE>-<YY>-<NNNN>`, `generate_rfq_number` / `sales_code_for`). Extension: the Production project created on win takes the opportunity's RFQ number instead of a separate `PRJ-YYYY-NNNN`. That gives one number from intake through RFQ and opportunity to project. PRJ numbering stays as the fallback. |
| 9 | Number is a live link to finance & administration | There is no finance module. Budget lives on the Production project (`project_budget_items`). In lists, the number is a link to the opportunity. In the opportunity header, it opens the Production project file (budget) once one exists. The project page already links back to its opportunities. |
| 10 | Everyone edits inputs; only the sales manager edits the number | Opportunities are private to their owner (sales data isolation, `20260727170000`). Only the owner and the managers can read a deal, and RLS already lets the same people update it. So "everyone" means everyone who can see the project. The gap is in the UI: Client details, Relationships and the key-facts Edit button were limited to pipeline operators. They now open for the owner as well (`canEditOpportunityInputs`). Money fields keep their own gate (#3). RLS on opportunities is unchanged. `can_edit_rfq_number` narrows to **sales_manager + system_admin**: bd_manager is dropped, and system admin is kept only for repairs. |

## Data — migration `20261022100000_project_tracking.sql`
- `opportunity_updates`. Columns: id, opportunity_id (→ opportunities, ON DELETE CASCADE), kind (text, CHECK against the list below), note text, completion_pct (smallint, 0–100, NULL allowed), created_by (DEFAULT auth.uid()), created_at. Index on (opportunity_id, created_at desc).
  - RLS: anyone authenticated can read. Sales contributors who can see the opportunity can insert, with created_by = auth.uid(). The author can delete within 24 h; pipeline operators can always delete. No updates.
  - Insert trigger: copies `completion_pct` to the opportunity when it is set, and bumps `last_activity_at`.
  - Kinds: `offer_sent, revised_offer_sent, po_received, contract_signed, awaiting_payment, payment_received, awaiting_client, site_visit, progress_update, other`. `other` needs a note; `progress_update` needs a %.
- New columns `inbox_items.contact_title` and `stakeholders.title` (both text).
- Trigger `set_probability_on_close` plus the won/lost backfill (#4).
- `can_edit_rfq_number` → sales_manager, system_admin.
- `create_project_from_won_opportunity` sets `project_number` from the opportunity's latest RFQ number, when that number is unused by any project.

## UI
- `ProjectUpdatesPanel` on the opportunity page:
  - "Post update" dialog with kind, note and %.
  - List rows show kind pill, note, % change, author and date.
- `ProjectProgressPanel` on command-center:
  - Shows the top 10 active opportunities (excludes won, lost, on hold and archived), ordered by latest update, then last activity.
  - Each row: project — contractor, stage pill, % bar ("—" when unknown, never 0) and latest update.
  - "See all" opens the opportunities list. The opportunities table gains Stage, Completion and Last update columns.
- Group 3 owns the rest of the home page. This panel is self-contained and mounted in one place.

## Testing
- Vitest for the pure helpers: `projectWithContractor`, update-kind validation, `awardedValue` and the suggestion state.
- pgTAP in `supabase/tests` covering:
  - the update trigger
  - probability on close
  - the narrowed number permission
  - project-number inheritance
- Typecheck, lint and the existing contract tests. Not tried in a browser without a signed-in canary; the PR says so.

## Out of scope
- A finance/admin module (invoices, POs, payments).
- Numbers for opportunities that have no RFQ.
- Automatic completion % from site data.
- A database guard on money columns. Today only the UI enforces the Finance/BD rule. This is a known gap that predates this work; it is a follow-up.
