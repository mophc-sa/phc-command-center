# A project has an owner, and its owner may edit it — design

Date: 2026-10-21. Approved by the user in chat ("امض به والميزانية للمالك المسند فقط").

## Context

The user asked to let a salesperson edit the projects that are theirs. Measured in
production before designing anything:

- `projects` has **no owner column**. 40 projects exist; `created_by` is set on 2 of
  them (the other 38 came from imports).
- **No project is linked to any opportunity** (`opportunities.project_id` → 0 rows), so
  ownership cannot be derived from a deal today. The auto-create trigger
  (`20260803110000`) does set `NEW.project_id` on a won deal, but no won deal has run it
  yet, and it records no owner either.
- A salesperson can **already** edit `projects`, `project_jobs` and `project_job_stages`
  — `is_sales_contributor` includes `salesperson`, and the page shows them the edit
  controls. So nothing was blocking project data.
- The one thing blocked is the **budget**: `project_budget_items` is restricted to
  `can_edit_total_value(auth.uid())` = `finance_manager` + `bd_manager`. There are **0
  budget items** in production.

So the real request is two changes, not one: give a project an owner, and let that owner
edit the budget. Projects being editable by every salesperson is today's behaviour and
is left alone during the transition.

## Decisions

1. **Explicit owner, not derived.** `projects.owner_id` references `auth.users`. The
   alternative — deriving the owner from the linked opportunity — would grant nobody
   anything today, because no links exist: the feature would look enabled and do nothing.
2. **Three ways the owner is set**
   - a salesperson creating a project becomes its owner;
   - a project auto-created when a deal is won takes the **deal's owner**;
   - a pipeline operator (sales/BD manager, sales ops, MD/GM, CEO) assigns or reassigns
     it from the project page. Only operators may change an owner that is already set.
3. **Who may edit project data** (same rule in SQL and in the UI)
   - pipeline operators and `system_admin`: every project, unchanged;
   - a salesperson: a project they own, **or a project with no owner**;
   - any other salesperson: refused as soon as the project has an owner.
   The unowned allowance is the transition: it is exactly today's behaviour, so no one
   loses access on release, and every assignment narrows it. It covers `projects`,
   `project_jobs` and `project_job_stages`.
4. **The budget is narrower: the assigned owner only.** `project_budget_items` becomes
   editable by `can_edit_total_value` (finance/BD, as today) **or the project's owner**,
   and an unowned project's budget stays closed to salespeople. The user chose this over
   the wider option: 40 unowned projects would otherwise mean any salesperson could edit
   any project's cost figures, days after the deal money columns were deliberately
   hardened in the database (PR 352).
5. **The 40 existing projects keep no owner.** No guessing from imported data. They stay
   editable (rule 3) and their budgets stay closed (rule 4) until a manager assigns them.
6. **Deleting a user does not delete their projects**: `ON DELETE SET NULL`, which also
   returns the project to the unowned state rather than orphaning it invisibly.

## Schema

```sql
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_owner ON public.projects(owner_id);
```

A `can_edit_project(_project_id uuid, _user_id uuid)` SQL helper holds rule 3 so the
three policies cannot drift from each other, mirroring the existing
`can_read_opportunity_record` pattern. A second helper,
`can_edit_project_budget(_project_id, _user_id)`, holds rule 4.

## Policies

| Table | Rule |
|---|---|
| `projects` UPDATE | `can_edit_project(id, auth.uid())` |
| `project_jobs` ALL | `can_edit_project(project_id, auth.uid())` |
| `project_job_stages` ALL | `can_edit_project(project_id, auth.uid())` |
| `project_budget_items` ALL | `can_edit_project_budget(project_id, auth.uid())` |

INSERT on `projects` stays `is_sales_contributor` — anyone on the sales team may still
create a project; they simply own what they create.

Changing `owner_id` itself is guarded by a trigger, not only by the policy: an
authenticated caller who is not a pipeline operator may set an owner only on a project
that has none (claiming an unassigned project, as with deals), and never reassign one.
Every change writes `project.owner_assigned` to `audit_log` with the old and new owner.

## Browser

- `createProject` sets `owner_id` to the current user.
- The project page shows the owner, or an "Unassigned" pill, and gives pipeline
  operators an **Assign owner** action reusing `ActionDialog` and `listTeamMembers`
  (active, non-display accounts only — `isAssignableTeamMember`).
- The projects list shows an Owner column and an "Unassigned" filter so a manager can
  see what still needs assigning.
- `canEditProject` in `src/lib/roles.ts` takes the project's `owner_id` and the user id
  and returns rule 3; `canEditProjectBudget` returns rule 4. The page's edit controls and
  `ProjectKanban`'s `canEdit` read these, so the screen and the database agree.

## Testing

pgTAP `project_owner_access` covers the matrix with real signed-in roles:
owner edits; a second salesperson is refused once an owner exists; an unowned project is
editable by a salesperson; a pipeline operator edits either way; budget — owner yes,
non-owner no, unowned no, finance yes; a non-operator cannot reassign an owned project
but can claim an unowned one; deleting the owner leaves the project unowned.

A contract test pins that the TypeScript helpers and the SQL helpers express the same
rule (the drift test pattern already used for client-contact rules), and that the
project page gates its controls through the helpers rather than role checks.

## Release

Migration `20261024100000_project_owner.sql` (approval-gated `db push`), then the next
frontend release. No Edge Function change. Nothing to backfill.

## Out of scope

- Project dates in a person's Outlook calendar feed. The feed excludes projects because
  they had no owner; with this change that becomes possible, but it is a separate
  decision about whose calendar BOQ and signage dates belong in.
- Tightening project data editing to the owner alone. Decided deliberately: the
  transition keeps unowned projects open, and assignment is what narrows access.
