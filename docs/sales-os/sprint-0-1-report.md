# Sales Agent / Sales OS pilot — implementation plan + Sprint 0/1 report

Branch: `feature/sales-os-workspace-sprint0-1` (off `main`, which was first
brought current with the pending Supabase-migration work from the prior
session — see `docs/migration/`).

Target backend: PHC AGENT (`lrfdtoexyeghrzynapyn`), already schema-complete
and verified. Frontend: this repo, React + TanStack Start + Supabase, bun.

---

## Implementation plan

### Existing relevant routes (`src/routes/_authenticated/`, 31 files)

The Sales OS surface **already exists** — this is a mature, working app, not
a blank slate. Relevant to this pilot:

| Route | Status |
|---|---|
| `my-workspace.tsx` | **Primary Sprint 1 target.** Already a working "my day" surface: owner-scoped opportunities/follow-ups/tasks/activities/approvals, AI recommendations (accept/dismiss), activity logging. Extended in this branch, not replaced. |
| `opportunities.index.tsx` / `.$id.tsx` | Global opportunities list + detail (stage/owner/approval actions, follow-ups) |
| `rfq-jih.tsx` | RFQ/JIH kanban across `sales_stage` |
| `tenders.tsx` | Tender monitor board (`tender_stage`, award, convert to JIH) |
| `tender-conversion.tsx` | Manager review queue for tender→JIH approvals |
| `follow-ups.tsx`, `approvals.tsx`, `action-center.tsx`, `award-queue.tsx` | Global queues (not owner-scoped) for the same entities |
| `targets.tsx` | Team-wide targets vs actuals (all reps) |
| `data-import.tsx` | Data Import Center — see Data import status below |
| `command-center.tsx`, `reports.tsx`, `agent-activity.tsx` | Executive/ops dashboards, out of scope for this pilot |

### Database tables already available (no new tables needed for Sprint 0/1)

Confirmed live on PHC AGENT: `opportunities` (with `sales_stage`,
`win_confidence`, `tier`, `action_required` — business rules 1/3/4/5 already
modeled correctly as *overlays*, not stage values), `rfqs`
(`sales_owner_id`), `tenders` (`tender_owner_id`,
`tender_priority_classification` reusing `priority_tier` A/B/C — confirms
rule 3, tender A/B/C are records with a classification, not stages),
`tender_contractors`, `opportunity_flags` (`flag_kind`: `action_required` |
`risk` — confirms rule 5), `approvals`, `follow_ups`, `tasks`, `activities`,
`sales_targets`, `companies`, `contacts`, `projects`, `recommendations`,
`user_roles`. RLS + role-capability functions (`is_commercial_manager`,
`is_platform_admin`, `is_pipeline_operator`, `has_role`/`has_any_role`) are
already in place and already exclude `system_admin` from commercial
approval powers — **business rule 7 and the permissions requirement in this
task are already satisfied at the DB layer**, confirmed by direct query in
the prior session.

### Gaps identified for Sprint 1

- `my-workspace.tsx` had no RFQ/tender visibility, no Tier-A breakdown, no
  distinct overdue-vs-today follow-up counts, no target-dimension snapshot.
  All owner-scoped columns needed (`rfqs.sales_owner_id`,
  `tenders.tender_owner_id`) already exist — pure frontend work, zero schema
  changes required for Sprint 1.

### Migration needs

**None for Sprint 0/1.** The schema already supports every widget requested.

### Risks

1. **Local build/dev server is currently broken on this Windows machine** —
   pre-existing, confirmed unrelated to this branch (reproduces identically
   on a clean `git stash`). Root cause: `@lovable.dev/mcp-js`'s Vite plugin
   (`resolveAllRoutes`/`assertContains` in
   `node_modules/@lovable.dev/mcp-js/dist/stacks/tanstack/vite.js`) compares
   a forward-slash-normalized `projectRoot` against a backslash-produced
   `resolve()` path — a Windows-only path-separator bug, not a Linux/CI
   issue (`path.sep` is `/` there, so the two strings would already match).
   Blocks **both** `bun run build` and `bun run dev` — the app cannot be
   built or visually smoke-tested on this machine right now. Did not
   attempt a fix (would mean modifying/removing Lovable's own MCP tooling
   plugin, an architecture-level call outside this task's scope). **I was
   not able to visually verify the new workspace widgets in a running
   browser as a result — typecheck and unit tests pass, but this is not a
   substitute for seeing it render.**
2. **`.env` is still tracked in git** (flagged in the prior session,
   unresolved) — contains the *old* Lovable backend's publishable/anon key
   and project ref (`xpoduufwoklvsbuhywsv`), not the service-role key. Low
   severity (anon keys are meant to be public-ish) but still shouldn't be
   committed, and it actively confuses `supabase` CLI commands by
   overriding the linked project ref (worked around repeatedly in the prior
   session). Not touched in this branch — flagging again since Sprint 0
   explicitly asked to check for exposed secrets.
3. Manual-only e2e verification: `bunx playwright test` requires
   `TEST_APP_URL` + per-role seeded credentials (GitHub Actions secrets per
   `docs/security/phase-b-checklist.md`) that don't exist in this local
   environment — all 58 e2e specs skip gracefully by design, not a failure.
4. Stray `exports-inspected/lovable-export-2026-07-09/` directory (from the
   prior session's read-only export inspection, git-ignored) still contains
   a duplicate `src/lib/business-summary.test.ts` that `bun test src`
   picks up by substring match and fails on (missing-file assertion,
   because it resolves paths relative to the real repo root). Not a real
   test failure — resolved by scoping the test command to `./src`
   explicitly (see Sprint 0 results). Recommend deleting that folder once
   its findings are no longer needed for reference.

### Branch

`feature/sales-os-workspace-sprint0-1` — created off `main` after committing
the prior session's pending Supabase migration work (main was dirty with
already-applied-but-uncommitted changes; committed first so this feature
branch starts clean).

---

## Sprint 0 — results

- **`bunx tsc --noEmit`** → clean, exit 0, zero errors.
- **`bun run build`** → **fails**, pre-existing (see Risk 1). Confirmed via
  `git stash` that this reproduces identically with none of this branch's
  changes applied.
- **`bun run dev`** → same failure, same root cause (Risk 1) — confirms the
  bug is in Vite config resolution itself, not build-specific.
- **`bun test ./src`** → **65 pass, 0 fail**, 10 files (all pre-existing
  unit tests, untouched by this branch).
- **`bunx playwright test`** → 58 skipped (no `TEST_APP_URL`/credentials in
  this environment — by design, not a failure).
- **Data import status**: confirmed still staged/dry-run only.
  `data-import.tsx` has an explicit, deliberately-disabled "Controlled CRM
  commit" section (button `disabled`, tooltip "not enabled yet"); the only
  wired commit path is `dryRunCommit` → `import-pipeline` edge function's
  `dry_run_commit` handler, which writes reports but never touches
  `companies`/`contacts`/`opportunities`/etc. **Compliant with this task's
  requirement as-is — no change made.**
- **Secrets check**: no hardcoded key values found in `src/` or
  `supabase/functions/` (only prefix-check logic referencing the
  `sb_secret_`/`sb_publishable_` string shapes, not real keys). The tracked
  `.env` file (Risk 2) is the one open item, carried over unresolved from
  the prior session.
- **Routes and role checks**: documented above (existing routes table) and
  in `src/lib/roles.ts` — `AppRole` = `system_admin | managing_director |
  general_manager | ceo | bd_manager | sales_manager | sales_ops |
  salesperson | viewer`; capability helpers `canApproveCommercialAction`,
  `canAssignOwner`, `canChangeCommercialStage`, `canRunSensitiveSalesAction`
  all explicitly **exclude** `system_admin` (business rule 7 / this task's
  permissions requirement, already correct); `canViewSalesAdmin` /
  `canManageTeam` include `system_admin` for admin-only surfaces. Mirrored
  server-side in `supabase/functions/_shared/roles.ts` and kept in sync by
  `src/lib/roles.contract.test.ts` (part of the 65 passing tests).

## Sprint 1 — My Sales Workspace, what changed

Extended `src/routes/_authenticated/my-workspace.tsx` (not a new route —
the file already existed and covered several of the requested widgets; see
Gaps above). Added, in order of appearance on the page:

1. **New KPI row** (`ws_today_followups`, `ws_overdue_followups`,
   `ws_tier_a_opportunities`, `ws_my_rfqs`, `ws_my_tenders`,
   `ws_missing_data`) — 6 tiles reusing the existing `KpiCard` component,
   sitting below the pre-existing 4-tile row (pipeline/overdue/approvals/
   accounts), which is untouched.
2. **Target Snapshot panel** (new `ChartFrame` + new `TargetMetric` helper
   component) — shows all 5 `sales_targets` dimensions (sales, pipeline,
   quotations, activities, reactivation) for the current month. Actuals are
   shown only where already cheaply computable (pipeline value, activity
   count); the other three honestly show "actuals not tracked yet" rather
   than a fabricated number — explicitly a placeholder, per this task's
   spec.
3. **My RFQs** and **My tenders** — two new tabs (existing
   `Tabs`/`TabsTrigger`/`List` pattern, unchanged component), each backed
   by a new owner-scoped query (`rfqs.sales_owner_id = uid`,
   `tenders.tender_owner_id = uid`, excluding closed/converted stages).
4. **AI suggested actions** — already fully implemented (the pre-existing
   `recommendations` section with accept/dismiss); left as-is, exceeds the
   "placeholder" bar in the spec.
5. **Today follow-ups / Overdue follow-ups / My opportunities / Pending
   approvals / Missing data tasks** — all pre-existing or now directly
   backed by a KPI tile and/or existing tab (missing data derived by
   filtering the existing `opportunity_flags` query on
   `flag_kind === "action_required"`, per business rule 5).

### New i18n keys

Added 12 keys to `src/lib/i18n.tsx` (`ws_today_followups`,
`ws_tier_a_opportunities`, `ws_my_rfqs`, `ws_my_tenders`,
`ws_missing_data`, `ws_target_snapshot`, `ws_target_reactivation`,
`ws_actual_not_tracked`, `ws_rfqs_open`, `ws_tenders_active`, plus reused
5 pre-existing but previously-unused `ws_*` keys that were already sitting
in the dictionary — `ws_my_targets`, `ws_target_sales`,
`ws_target_quotations`, `ws_target_activities`, `ws_overdue_followups`).
Both `en`/`ar` provided for every new key, matching the file's existing
convention (`t()` is strictly typed against the `strings` dictionary, so
this was required for `tsc --noEmit` to pass, not optional).

### `any` usage

The two new query result handlers (`myRfqs.map((r: any) => ...)`,
`myTenders.map((tn: any) => ...)`) use `any`, matching **every other** row
handler already in this same file (`(o: any)`, `(f: any)`, `(a: any)`,
etc.) — the file's established convention for ad-hoc `.select("col, col")`
Supabase query results, not something introduced by this branch. The one
fully-new component, `TargetMetric`, has complete explicit types with zero
`any`.

### No sensitive-action changes

Nothing in Sprint 1 touches write paths — this is a read-only dashboard
extension. All existing mutation logic (`decideApproval`, `updateOpportunityStage`,
`assignOwner`, import commit gating, etc.) is untouched, so business rules 6
and 7 (AI cannot execute sensitive actions; delete requires
archive/approval) remain exactly as they were — nothing in this pilot phase
weakens them.

### Files changed

- `src/routes/_authenticated/my-workspace.tsx` — extended (queries, KPI
  row, target snapshot, RFQ/tender tabs)
- `src/lib/i18n.tsx` — 12 new keys added
- `docs/sales-os/sprint-0-1-report.md` — this file (new)

### Migrations added

**None.**
