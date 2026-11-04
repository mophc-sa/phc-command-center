# Pricing loop — PR 2: Screens up to Propose — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Zayed (estimation + finance) and Kalas (GM) the screens that take a pricing file from *received* to a proposed selling price: the pricing queue, the pricing file (Package, Supplier, Cost review, Selling price tabs) and the pricing settings, on top of SQL that links a BOQ revision, imports BOQ lines, computes the selling grid and builds the Phase 8 estimation and internal price from it.

**Architecture:** Six migrations (`20261104100000`–`20261104150000`, plus `20261104160000` for the optional Task 14) add SECURITY DEFINER RPCs, two cost-gated tables and two cost-gated views on top of PR 1 and the Phase 7A–8 engine. Totals and margin are computed in SQL; the browser reads views and calls RPCs (`supabase.rpc`, untyped `from()` reads). The screens are TanStack file routes under `src/routes/_authenticated/pricing.*`, react-query for data, bilingual text per component, and a pure TypeScript mirror of the grid arithmetic held to the SQL by a contract test.

**Tech Stack:** Postgres 15 (Supabase), pgTAP (`supabase/tests`), TypeScript, React 19, TanStack Router/Start, @tanstack/react-query, bun test, SheetJS `xlsx` 0.20.3 (the version `supabase/functions/_shared/spreadsheet.ts` already pins).

**Spec:** `docs/superpowers/specs/2026-11-03-pricing-loop-design.md` (§1 flow, §2 visibility, §3 selling price, §4 screens, §6 delivery; Mo's revision: Kalas sets and proposes the selling price, Zayed reviews it). Meeting record: `docs/finance/2026-11-03-ahmed-zayed-meeting.md`. PR 1 plan: `docs/superpowers/plans/2026-11-03-pricing-loop-foundation.md`.

**Base:** branch `feat/pricing-loop-screens` in worktree `/Users/mo/dev/phc-pricing-ui`, stacked on `feat/pricing-loop-foundation` (PR #365, not merged). PR 1's migrations are frozen: never edit `supabase/migrations/20261103*.sql`. New behaviour goes in new migrations that `CREATE OR REPLACE` what they change.

## Open questions for Mo

Each has a default. The tasks are written with the default, so nothing waits on the answer.

1. **Move "entry on behalf" from PR 3 to PR 2?** Without it no supplier price can enter the system, because 7B refuses quotes on a frozen BOQ. **Default: yes, as optional Task 14.**
2. **Default margin for a line with none set:** **25% on price** (`logistics_rates.default_margin_pct`). Pricers can change it; Kalas overrides it per file and per line.
3. **Installation fallback for a line with no type or no rate:** **10% of the line's materials** (`logistics_rates.install_fallback_pct`).
4. **"Effective date" for logistics rates and extras:** **"in force since" the last change**, with history in `audit_log`. Only installation rates take future start dates.
5. **Inland delivery and clearing fee:** **once per file**. Containers are a count × the container rate.
6. **An RFQ moved to another deal** (PR 1 deferred): **re-point the old file to the deal's latest other live RFQ, or clear the link. Never auto-close.**
7. **The placeholder RFQ from the classification edit** (PR 1 deferred): **keep it opening a file**; a pricer closes it with a reason.
8. **The margin floor value:** **none seeded**. The GM sets it on `/pricing/settings` (Task 3 RPC, Task 12 card).

## Global Constraints

- PR 1 constraints still apply (`.superpowers/sdd/global-constraints-pr1.md`):
  - Every new table has `ENABLE ROW LEVEL SECURITY`.
  - Writes go through RPCs. Workflow tables get no direct INSERT/UPDATE grants.
  - Cost is read only when `public.can_read_commercial_cost(auth.uid())` is true: estimation_manager, finance_manager, sales_manager, MD, GM, CEO.
  - "Pricer" = `public.is_pricer(uuid)`. "GM" = `public.can_approve_final_price(uuid)`.
  - Error messages are bilingual, `'English. | العربية.'`, with codes `42501` (not allowed), `23514` (bad input) and `P0001` (rule).
  - Every RPC: `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated;`. Internal helpers (`_pricing_*`) are revoked from `authenticated` too.
  - Every state change writes `audit_log` (`actor_type 'user'`).
- **Migration numbers:** `20261104100000` … `20261104150000`, and `20261104160000` for Task 14. Before Task 1, run `git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3`. If any number there is ≥ `20261104100000`, renumber every migration in this plan upward, keeping their order.
- **Never edit PR 1's migrations** (`supabase/migrations/20261103*.sql`). Task 4 changes one assertion in PR 1's `supabase/tests/pricing_calc.test.sql`, because the behaviour it pinned is the PR 1 bug that PR 2 fixes. That is the only edit to PR 1 files.
- **Kalas sets the price; Zayed reviews it.** In the selling build:
  - Selling inputs (a line's margin %, a line's typed selling price, the file's default margin) are the GM's only.
  - Cost inputs (screen price or normal, install-type override, logistics, overhead, cinema flag, extras) belong to a pricer or the GM.
  - Only the GM builds and proposes. `internal_prices.figure_set_by` is therefore Kalas, and Zayed can approve in PR 4.
- **The client never supplies a margin or a total.** The grid, the totals and the cost basis are computed in SQL. The UI only displays them. Propose passes back the total the GM saw only so the server can refuse a stale one.
- **Margin is on price** (Phase 8): `margin % = (selling − cost) / selling × 100`. A line priced by margin sells at `cost / (1 − m/100)`.
- **`pricing_file_events` has column grants** (`cost_note` is not granted), and so do `boq_lines`, `supplier_quote_lines` and `internal_prices`. Always list columns. A `select=*` on them returns 42501.
- **Bilingual UI, RTL-safe:**
  - Each component keeps its strings in a local `const TEXT = { … } satisfies Record<string, Bi>` (`Bi = { en: string; ar: string }` from `src/lib/pricing-text.ts`) and shows them with `pick(TEXT.key, lang)`.
  - Sidebar keys go in `src/lib/i18n.tsx`.
  - Use logical CSS (`ms-`/`me-`/`ps-`/`pe-`/`text-start`/`text-end`), never `ml-`/`mr-`/`text-left`/`text-right`.
  - Numbers go through `formatNumber` / `formatCurrency` from `@/lib/i18n`.
  - No Arabic-Indic digits in any source file (`src/lib/arabic-digits.test.ts`).
- **Database errors** reach the user through `dbMessage(e, lang)` from `src/lib/pricing-text.ts`, which shows the reader's half of the bilingual message. `ActionDialog` `onSubmit` handlers rethrow `new Error(dbMessage(e, lang))`, so the dialog stays open on failure.
- **UI gating mirrors SQL; SQL decides.** The screens ask `pricing_my_rights()` (Task 1) and use the helpers in `src/lib/pricing-access.ts` (Task 7). Cost stays enforced by RLS and the views. A hidden button is a courtesy, not the control.
- **DB tests:** run `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`. It rebuilds the local DB from this worktree's migrations and runs every pgTAP file; check that your file passes and that the others still do. **Never run `supabase db reset`**: the Supabase guard refuses it. If the script is missing or the local stack cannot start, push the branch and rely on CI ("Supabase migrations and database tests"). Say so in the task report.
- **pgTAP sessions:** always set `"aal":"aal2"` in `request.jwt.claims`. MFA roles (GM, finance, sales manager) need it, and other roles ignore it.
  - Test user UUID prefixes: Task 1 `6a…`, Task 2 `6b…`, Task 3 `6c…`, Task 4 `6d…`, Task 5 `6e…`, Task 6 `6f…`, Task 14 `7a…`.
  - Prefixes already used: `00 20 24 26–29 2a–2e 3d–3f 4a 4b 4d 5a–5f 7c a2 d1 f0–f2`.
  - Emails are `<short>-<role>+test@phc-sa.com`.
- **No component tests:** the repo has no component-test pattern (no `*.test.tsx`). Logic is tested in `src/lib`, and screens are checked by `bun run verify` and a manual walk-through.
- **Frontend checks:** a task that adds a route runs `bun run build` once first, which regenerates `src/routeTree.gen.ts` (commit it). Then it runs `bun run verify` (typecheck, lint, test, build). Bun tests: `bun test <file>`.
- **New dependency (Task 9 only):** `bun add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. This is SheetJS's official distribution and the same version the import pipeline pins. The npm-registry `xlsx@0.18.5` has known high-severity advisories, so do not use it. Load it with a dynamic `import("xlsx")` so it stays out of the main bundle.
- **Public repository** (AGENTS.md): no production amounts, real client names or customer document text in code, tests, commits or PR text.
- **Release:** PR 2 has UI. It ships through:
  1. `supabase db push`, which applies PR 1 and PR 2's migrations (and Task 14's if kept);
  2. the Cloudflare canary;
  3. Production Readiness;
  4. production.

  Mo approves and runs every step. There is no Edge Function deploy. Nothing in this plan pushes, deploys or runs `db push`.

**Not in PR 2 (each with its reason; Task 13 records them in AI_HANDOFF):**
- **Approval and Quotations tabs, Zayed's "Review selling price" card, the opportunity page's pricing state, the rep answering missing items from their own screen, returning *selected* lines from price review, and the client-revision round (`quoted → boq_frozen`).** These are spec PR 4. Until then a pricer records the rep's answer on the Package tab. PR 1's RPC allows that.
- **Notifications** (spec §2 list): they belong with the screens that receive them (PR 3 supplier, PR 4 rep and review). PR 2 sends none.
- **The supplier role, portal and invite email, and attaching the supplier's original file to an on-behalf quote:** PR 3.
- **AI package and quote reviews:** PR 5.
- **PR 1 tables lack the restrictive `audit_session_boundary` policy** that later tables carry (found while planning). Their policies already go through `has_app_access` (`is_pricer`, `can_read_commercial_cost`, `can_read_boq`), so it is defence in depth, not a hole. The new PR 2 tables get it. Adding it to PR 1's tables is recorded in AI_HANDOFF as a follow-up.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261104100000_pricing_file_links.sql` | `pricing_my_rights`, `open_pricing_file` RFQ check, RFQ move re-point, `pricing_file_attach_revision`, `_pricing_file_link_price` (contract checks), cost basis frozen under review, `pricing_queue` view |
| `supabase/migrations/20261104110000_pricing_boq_import.sql` | `_pricing_num_ok`, `pricing_boq_import`, `pricing_boq_line_delete`, `pricing_file_freeze_boq` |
| `supabase/migrations/20261104120000_pricing_settings_inputs.sql` | `logistics_rates` gains the fallback % and default margin + "in force since"; catalog gains `suggest_if_cinema` + "in force since"; `pricing_set_installation_rate`; `pricing_set_margin_floor`; `pricing_file_inputs` + `pricing_file_set_inputs` |
| `supabase/migrations/20261104130000_pricing_extras_rounds.sql` | Extras per BOQ revision (round), suggest locks the file and knows cinema, propose's open-extras check locks the file, `pricing_add_extra` |
| `supabase/migrations/20261104140000_pricing_selling_grid.sql` | `pricing_file_lines` + `pricing_file_set_line`, views `pricing_selling_grid` and `pricing_selling_totals` |
| `supabase/migrations/20261104150000_pricing_build_price.sql` | `pricing_file_build_price`, `pricing_file_propose` |
| `supabase/migrations/20261104160000_pricing_supplier_entry.sql` | (Task 14, optional) 7B guards allow on-behalf entry while the file is at the supplier; `pricing_enter_supplier_quote` |
| `supabase/tests/pricing_file_links.test.sql` … `pricing_build_price.test.sql`, `pricing_supplier_entry.test.sql` | pgTAP per migration |
| `supabase/tests/pricing_calc.test.sql` | One assertion updated (Task 4) |
| `src/lib/pricing-text.ts` (+ `.test.ts`) | `Bi`, `pick`, `dbMessage` |
| `src/lib/pricing-access.ts` (+ `.test.ts`) | Rights type, tab visibility, queue filters, who owes the next step, edit gates |
| `src/lib/pricing-grid.ts` (+ `.test.ts`, `.contract.test.ts`) | Pure mirror of the grid, logistics, totals and margin |
| `src/lib/pricing-actions.ts` (+ `pricing-actions.contract.test.ts`) | RPC wrappers and typed reads, extended |
| `src/lib/boq-import.ts` (+ `.test.ts`) | Spreadsheet reading and column mapping for BOQ import |
| `src/components/phc/AppShell.tsx`, `src/components/phc/CommandPalette.tsx`, `src/lib/i18n.tsx` | Sidebar group "التسعير والمالية / Pricing & Finance" |
| `src/lib/phase-1-sales-ia.contract.test.ts`, `src/lib/phase2-page-consolidation.contract.test.ts` | Updated: `/quotations` is now in the Pricing & Finance group |
| `src/routes/_authenticated/pricing.index.tsx` | `/pricing` queue |
| `src/routes/_authenticated/pricing.$id.tsx` | `/pricing/$id` shell: header, moves, close, tabs, history |
| `src/routes/_authenticated/pricing.settings.tsx` | `/pricing/settings` |
| `src/components/phc/pricing/types.ts`, `usePricingRights.ts` | Tab props and the rights hook |
| `src/components/phc/pricing/PackageTab.tsx`, `BoqImportDialog.tsx`, `BoqLineForm.tsx` | Package tab |
| `src/components/phc/pricing/SupplierTab.tsx`, `CostReviewTab.tsx` | Supplier and Cost review tabs |
| `src/components/phc/pricing/SellingPriceTab.tsx`, `CostInputsPanel.tsx`, `ExtrasPanel.tsx` | Selling price tab |
| `src/components/phc/pricing/SettingsCards.tsx` | Settings cards |
| `src/components/phc/pricing/SupplierEntryForm.tsx` | (Task 14) entry on behalf |
| `docs/USER_GUIDE.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/AI_HANDOFF.md`, `tasks/current.md` | Docs, in this PR (Task 13) |

**Task order:** SQL tasks 1–6 (each with pgTAP), then the TypeScript layer (7), then UI (8–12), then docs and verification (13). Task 14 is optional and last. Thirteen core tasks, one more than the target of 8–12. The selling-price SQL is split into the grid (5) and the build (6) so a reviewer can approve the arithmetic separately from the write path.

---

### Task 1: File links, rights, queue, PR 1 leftovers (SQL)

**Files:**
- Create: `supabase/migrations/20261104100000_pricing_file_links.sql`
- Test: `supabase/tests/pricing_file_links.test.sql`

**Interfaces:**
- Consumes (PR 1, exact):
  - `public.is_pricer(uuid)`, `public.can_approve_final_price(uuid)`, `public.can_read_commercial_cost(uuid)`, `public.can_read_boq(uuid opportunity, uuid user)`
  - `public._pricing_file_open(uuid, uuid, uuid) → public.pricing_files`
  - table `public.pricing_files(id, opportunity_id, rfq_id, state, boq_revision_id, estimation_id, internal_price_id, due_at, needs_info_items, needs_info_due, closed_reason, opened_by, created_at, updated_at, state_changed_at, state_changed_by)`
  - trigger `rfqs_open_pricing_file` (AFTER INSERT OR UPDATE OF opportunity_id ON rfqs → `public.pricing_file_on_rfq()`).
- Produces:
  - `public.pricing_my_rights() → jsonb` `{"is_pricer": bool, "is_gm": bool, "can_read_cost": bool}`
  - `public.open_pricing_file(_opportunity_id uuid, _rfq_id uuid DEFAULT NULL) → jsonb` (same signature; now 23514 when the RFQ is another deal's)
  - `public.pricing_file_attach_revision(_file_id uuid, _revision_id uuid) → jsonb` (the file row)
  - `public._pricing_file_link_price(_file_id uuid, _estimation_id uuid, _price_id uuid) → public.pricing_files`. Internal, not granted. Task 6 calls it.
  - trigger `estimations_frozen_under_review` (BEFORE UPDATE ON estimations)
  - view `public.pricing_queue(file_id, state, state_changed_at, created_at, due_at, needs_info_items, needs_info_due, opportunity_id, project_name, project_code, owner_id, contract_value, quotation_value, estimated_value_max, boq_revision_id, estimation_id, internal_price_id, closed_reason)`. Every file, closed ones too. The queue screen filters `state <> 'closed'`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_file_links.test.sql`:

```sql
-- PR 2, part 1: what a pricing file points at (AI_HANDOFF "PR 2 contract"),
-- the caller's rights, the queue, RFQ moves, and the cost basis under review.
-- Test user UUIDs use the 6a… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','fl-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,6) n;
update public.profiles set status = 'active' where id::text like '6a000000-%';
insert into public.user_roles (user_id, role) values
  ('6a000000-0000-0000-0000-000000000001','salesperson'),
  ('6a000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6a000000-0000-0000-0000-000000000002','finance_manager'),
  ('6a000000-0000-0000-0000-000000000003','general_manager'),
  ('6a000000-0000-0000-0000-000000000004','bd_manager'),
  ('6a000000-0000-0000-0000-000000000005','sales_manager'),
  ('6a000000-0000-0000-0000-000000000006','salesperson');

-- Deals 1..4, all owned by the rep. 1 = A (file in package review), 2 = B, 3 = C, 4 = D.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'fl-deal-' || n,
       '6a000000-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,4) n;
insert into public.boqs (id, related_opportunity_id, title) values
  ('6a400001-0000-0000-0000-000000000001','6a200001-0000-0000-0000-000000000001','fl-boq-a'),
  ('6a400002-0000-0000-0000-000000000001','6a200002-0000-0000-0000-000000000001','fl-boq-b');
-- A: revision 2 is current and replaced revision 1. B: revision 1.
insert into public.boq_revisions (id, boq_id, revision_number) values
  ('6a500002-0000-0000-0000-000000000001','6a400001-0000-0000-0000-000000000001',2),
  ('6a500003-0000-0000-0000-000000000001','6a400002-0000-0000-0000-000000000001',1);
insert into public.boq_revisions (id, boq_id, revision_number, is_current, superseded_by, superseded_at) values
  ('6a500001-0000-0000-0000-000000000001','6a400001-0000-0000-0000-000000000001',1,false,'6a500002-0000-0000-0000-000000000001',now());
insert into public.pricing_files (id, opportunity_id, state) values
  ('6a600001-0000-0000-0000-000000000001','6a200001-0000-0000-0000-000000000001','package_review');
-- An RFQ on B (opens B's file by itself).
insert into public.rfqs (id, opportunity_id, sales_owner_id, status)
values ('6a300009-0000-0000-0000-000000000001','6a200002-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','open');
-- Estimations and prices for the link checks: eA on A's revision 2, eB on B's revision.
insert into public.estimations (id, boq_revision_id, cost_total) values
  ('6a700001-0000-0000-0000-000000000001','6a500002-0000-0000-0000-000000000001', 90000),
  ('6a700002-0000-0000-0000-000000000001','6a500003-0000-0000-0000-000000000001', 90000);
insert into public.internal_prices (id, estimation_id, proposed_price, status) values
  ('6a800001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001',100000,'internal_price_proposed'),
  ('6a800002-0000-0000-0000-000000000001','6a700002-0000-0000-0000-000000000001',100000,'internal_price_proposed'),
  ('6a800003-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001',100000,'gm_pending');

-- ===== Rights =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights(), '{"is_pricer":true,"is_gm":false,"can_read_cost":true}'::jsonb,
  'Zayed is a pricer and a cost reader, not the GM');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights(), '{"is_pricer":false,"is_gm":true,"can_read_cost":true}'::jsonb,
  'Kalas is the GM and a cost reader');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights(), '{"is_pricer":false,"is_gm":false,"can_read_cost":false}'::jsonb,
  'A rep has none of the three');

-- ===== open_pricing_file checks the RFQ is the deal's =====
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.open_pricing_file('6a200001-0000-0000-0000-000000000001','6a300009-0000-0000-0000-000000000001')$$,
  '23514', null, 'An RFQ of another deal is refused');

-- ===== Attach a BOQ revision =====
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500002-0000-0000-0000-000000000001')$$,
  '42501', null, 'A rep cannot attach a revision');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500003-0000-0000-0000-000000000001')$$,
  '23514', null, 'A revision of another deal is refused');
select throws_ok($$select public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A replaced revision is refused');
select is((public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500002-0000-0000-0000-000000000001'))->>'boq_revision_id',
  '6a500002-0000-0000-0000-000000000001', 'The deal''s current revision is attached');
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800001-0000-0000-0000-000000000001')$$,
  '42501', null, 'The link helper is not callable by users');

-- ===== Link checks (internal helper, run as the owner like its caller) =====
reset role;
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700002-0000-0000-0000-000000000001','6a800002-0000-0000-0000-000000000001')$$,
  '23514', null, 'An estimation of another revision is refused');
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800002-0000-0000-0000-000000000001')$$,
  '23514', null, 'A price of another estimation is refused');
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800003-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A price already under review is refused');
select lives_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800001-0000-0000-0000-000000000001')$$,
  'A proposed price of the file''s estimation is linked');
select ok(exists (select 1 from public.pricing_files where id = '6a600001-0000-0000-0000-000000000001'
                   and estimation_id = '6a700001-0000-0000-0000-000000000001'
                   and internal_price_id = '6a800001-0000-0000-0000-000000000001'),
  'The file now points at the estimation and the price');

-- ===== The cost basis is frozen while the price is under review =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.estimations set cost_total = 91000 where id = '6a700001-0000-0000-0000-000000000001'$$,
  'Before review, estimation may still change the cost');
reset role;
update public.pricing_files set state = 'selling_build' where id = '6a600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
update public.internal_prices set status = 'gm_pending' where id = '6a800001-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.estimations set cost_total = 50000 where id = '6a700001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Under review, the cost behind the price cannot change');
select lives_ok($$update public.estimations set notes = 'checked' where id = '6a700001-0000-0000-0000-000000000001'$$,
  'A note on the estimation is not cost and still saves');

-- ===== An RFQ moved to another deal =====
reset role;
insert into public.rfqs (id, opportunity_id, sales_owner_id, status) values
  ('6a300001-0000-0000-0000-000000000001','6a200003-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','open');
insert into public.rfqs (id, opportunity_id, sales_owner_id, status) values
  ('6a300002-0000-0000-0000-000000000001','6a200003-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','open');
update public.rfqs set opportunity_id = '6a200004-0000-0000-0000-000000000001' where id = '6a300001-0000-0000-0000-000000000001';
select is((select rfq_id::text from public.pricing_files where opportunity_id = '6a200003-0000-0000-0000-000000000001' and state <> 'closed'),
  '6a300002-0000-0000-0000-000000000001', 'The old deal''s file points at its remaining RFQ');
select is((select rfq_id::text from public.pricing_files where opportunity_id = '6a200004-0000-0000-0000-000000000001' and state <> 'closed'),
  '6a300001-0000-0000-0000-000000000001', 'The new deal opens its own file with the moved RFQ');
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.rfq_repointed'
                   and entity_id = '6a200003-0000-0000-0000-000000000001'),
  'The re-point is audited');

-- ===== The queue =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue), 0, 'A rep reads no queue');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue), 0, 'The BD manager reads no queue');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue where opportunity_id::text like '6a20000%'), 4,
  'The sales manager (management, cost reader) reads the queue');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue where opportunity_id::text like '6a20000%'), 4,
  'Zayed reads the queue: files A, B, C and D');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.revision_attached'
                   and entity_id = '6a200001-0000-0000-0000-000000000001'),
  'Attaching a revision is audited');
select * from finish();
rollback;
```

Count check: 3 rights + 1 open + 5 attach (including the denied helper) + 5 link + 3 freeze + 3 RFQ + 4 queue + 1 audit = 25.

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_file_links.test.sql` FAILS with `function public.pricing_my_rights() does not exist`. The other files pass.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261104100000_pricing_file_links.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 2, part 1: what a pricing file points at (spec 2026-11-03
-- §1, §5; AI_HANDOFF "PR 2 contract").
--
-- PR 1 left pricing_files.boq_revision_id / estimation_id / internal_price_id
-- unset outside fixtures, so no file could reach boq_frozen. This adds the one
-- way each link is made, each with the contract's checks:
--   * a revision attached in package review belongs to the file's deal;
--   * the estimation belongs to that revision, the price to that estimation,
--     and the price is at most internal_price_proposed when it is linked.
-- It also closes four PR 1 leftovers: open_pricing_file checks the RFQ is the
-- deal's; an RFQ moved to another deal no longer leaves the old file pointing
-- at it; the cost basis behind a price under review (or approved) is frozen;
-- and the screens get one call that says what the caller may do, plus a queue.
-- =============================================================================

-- 1. What the caller may do. The screens mirror it; SQL still decides.
CREATE OR REPLACE FUNCTION public.pricing_my_rights()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'is_pricer',     coalesce(public.is_pricer(auth.uid()), false),
    'is_gm',         coalesce(public.can_approve_final_price(auth.uid()), false),
    'can_read_cost', coalesce(public.can_read_commercial_cost(auth.uid()), false));
$$;
REVOKE ALL ON FUNCTION public.pricing_my_rights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_my_rights() TO authenticated;

-- 2. PR 1 deferred: the RFQ, when given, must be the deal's.
CREATE OR REPLACE FUNCTION public.open_pricing_file(_opportunity_id uuid, _rfq_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may open a pricing file. | فتح ملف التسعير يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opportunities WHERE id = _opportunity_id) THEN
    RAISE EXCEPTION 'Unknown deal. | الفرصة غير موجودة.' USING ERRCODE = '23514';
  END IF;
  IF _rfq_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.rfqs r WHERE r.id = _rfq_id AND r.opportunity_id = _opportunity_id) THEN
    RAISE EXCEPTION 'That RFQ belongs to another deal. | طلب التسعير هذا يخص فرصة أخرى.' USING ERRCODE = '23514';
  END IF;
  f := public._pricing_file_open(_opportunity_id, _rfq_id, u);
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.open_pricing_file(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_pricing_file(uuid, uuid) TO authenticated;

-- 3. PR 1 deferred: an RFQ moved from deal A to deal B. A's open file is
-- re-pointed to A's latest other live RFQ (or its link cleared); it is never
-- closed here, because whether A still needs a price is a pricer's call.
-- The trigger rfqs_open_pricing_file (20261103100000) stays as it is.
CREATE OR REPLACE FUNCTION public.pricing_file_on_rfq()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE other uuid; moved integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.opportunity_id IS NOT NULL THEN
    SELECT r.id INTO other FROM public.rfqs r
     WHERE r.opportunity_id = OLD.opportunity_id AND r.id <> NEW.id AND r.archived_at IS NULL
     ORDER BY r.created_at DESC, r.id DESC LIMIT 1;
    UPDATE public.pricing_files SET rfq_id = other, updated_at = now()
     WHERE opportunity_id = OLD.opportunity_id AND state <> 'closed' AND rfq_id = NEW.id;
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF moved > 0 THEN
      INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
              'pricing_file.rfq_repointed', 'opportunity', OLD.opportunity_id,
              jsonb_build_object('moved_rfq_id', NEW.id, 'rfq_id', other,
                                 'to_opportunity_id', NEW.opportunity_id));
    END IF;
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    PERFORM public._pricing_file_open(NEW.opportunity_id, NEW.id, NULL);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_on_rfq() FROM PUBLIC, anon, authenticated;

-- 4. Attach a BOQ revision during package review (an AI-extracted or hand-made
-- revision of this deal). BOQ import (next migration) attaches its own.
CREATE OR REPLACE FUNCTION public.pricing_file_attach_revision(_file_id uuid, _revision_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; r public.boq_revisions;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may attach a BOQ revision. | ربط إصدار الكميات يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state <> 'package_review' THEN
    RAISE EXCEPTION 'A BOQ revision is attached during package review. | يُربط إصدار الكميات أثناء دراسة الباكيج.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT r2.* INTO r FROM public.boq_revisions r2 JOIN public.boqs b ON b.id = r2.boq_id
   WHERE r2.id = _revision_id AND b.related_opportunity_id = f.opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That BOQ revision is not this deal''s. | إصدار الكميات هذا لا يخص هذه الفرصة.' USING ERRCODE = '23514';
  END IF;
  IF r.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'That BOQ revision was replaced by a newer one. | استُبدل إصدار الكميات هذا بإصدار أحدث.'
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.pricing_files SET boq_revision_id = r.id, updated_at = now()
   WHERE id = f.id RETURNING * INTO f;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.revision_attached', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'revision_id', r.id));
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_attach_revision(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_attach_revision(uuid, uuid) TO authenticated;

-- 5. Link the estimation and price the selling build creates. Internal: only
-- pricing_file_build_price (20261104150000) calls it. Every check of the PR 2
-- contract lives here, so no caller can link around them.
CREATE OR REPLACE FUNCTION public._pricing_file_link_price(_file_id uuid, _estimation_id uuid, _price_id uuid)
RETURNS public.pricing_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files; e public.estimations;
        p_est uuid; p_status public.internal_price_status;
BEGIN
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.boq_revision_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.boq_revisions r JOIN public.boqs b ON b.id = r.boq_id
        WHERE r.id = f.boq_revision_id AND b.related_opportunity_id = f.opportunity_id) THEN
    RAISE EXCEPTION 'The file''s BOQ revision is not its deal''s. | إصدار الكميات في الملف لا يخص فرصته.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO e FROM public.estimations WHERE id = _estimation_id;
  IF NOT FOUND OR e.boq_revision_id IS DISTINCT FROM f.boq_revision_id THEN
    RAISE EXCEPTION 'The estimation is not for this file''s BOQ revision. | التقدير لا يخص إصدار الكميات في هذا الملف.' USING ERRCODE = '23514';
  END IF;
  SELECT p.estimation_id, p.status INTO p_est, p_status FROM public.internal_prices p WHERE p.id = _price_id;
  IF NOT FOUND OR p_est IS DISTINCT FROM e.id THEN
    RAISE EXCEPTION 'The price is not for this estimation. | السعر لا يخص هذا التقدير.' USING ERRCODE = '23514';
  END IF;
  IF p_status NOT IN ('draft','cost_complete','internal_price_proposed') THEN
    RAISE EXCEPTION 'Only a draft or proposed price is linked to a file, never one under review or decided. | لا يُربط بالملف إلا سعر مسودة أو مقترح.'
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.pricing_files SET estimation_id = e.id, internal_price_id = _price_id, updated_at = now()
   WHERE id = f.id RETURNING * INTO f;
  RETURN f;
END $$;
REVOKE ALL ON FUNCTION public._pricing_file_link_price(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 6. PR 1 deferred: the cost basis is frozen while the file's price is under
-- review, and after it is approved, so what Zayed reviews and what is
-- approved are the cost Kalas priced from. Notes still save. Outside pricing
-- files nothing changes.
CREATE OR REPLACE FUNCTION public.estimation_frozen_under_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.cost_total, NEW.wastage_pct, NEW.installation_cost, NEW.overhead_pct, NEW.boq_revision_id)
       IS DISTINCT FROM (OLD.cost_total, OLD.wastage_pct, OLD.installation_cost, OLD.overhead_pct, OLD.boq_revision_id)
     AND EXISTS (SELECT 1 FROM public.internal_prices p
                   JOIN public.pricing_files pf ON pf.internal_price_id = p.id
                  WHERE p.estimation_id = NEW.id AND p.status IN ('gm_pending','gm_approved')) THEN
    RAISE EXCEPTION 'The cost behind a price under review or approved cannot change; return the price first. | لا تتغير التكلفة خلف سعر قيد المراجعة أو معتمد؛ أرجع السعر أولاً.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.estimation_frozen_under_review() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS estimations_frozen_under_review ON public.estimations;
CREATE TRIGGER estimations_frozen_under_review BEFORE UPDATE ON public.estimations
  FOR EACH ROW EXECUTE FUNCTION public.estimation_frozen_under_review();

-- 7. The pricing queue: every file with its deal's name, code, owner and
-- value fields (the screen computes the value with opportunityValue()). No
-- cost. Pricers and the GM read all; other cost readers read what they can
-- read of the deal. Reps and the BD manager read nothing here.
CREATE OR REPLACE VIEW public.pricing_queue AS
  SELECT f.id AS file_id, f.state, f.state_changed_at, f.created_at, f.due_at,
         f.needs_info_items, f.needs_info_due,
         f.opportunity_id, o.project_name, o.project_code, o.owner_id,
         o.contract_value, o.quotation_value, o.estimated_value_max,
         f.boq_revision_id, f.estimation_id, f.internal_price_id, f.closed_reason
    FROM public.pricing_files f
    JOIN public.opportunities o ON o.id = f.opportunity_id
   WHERE public.is_pricer((SELECT auth.uid()))
      OR public.can_approve_final_price((SELECT auth.uid()))
      OR (public.can_read_commercial_cost((SELECT auth.uid()))
          AND public.can_read_boq(f.opportunity_id, (SELECT auth.uid())));
REVOKE ALL ON public.pricing_queue FROM anon, authenticated;
GRANT SELECT ON public.pricing_queue TO authenticated;
COMMENT ON VIEW public.pricing_queue IS
  'Pricing files with their deal for the /pricing queue and the file header. No cost. Pricers and the GM read all; other cost readers what they can read of the deal.';
```

- [ ] **Step 4: Run the DB suite and confirm it passes**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_file_links.test.sql .. ok`, and every other file still ok (PR 1's `pricing_files.test.sql` included: `open_pricing_file` without an RFQ behaves as before).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104100000_pricing_file_links.sql supabase/tests/pricing_file_links.test.sql
git commit -m "feat(pricing): link a BOQ revision, estimation and price to a file; rights, queue, frozen cost basis" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: BOQ import, manual lines, freeze (SQL)

**Files:**
- Create: `supabase/migrations/20261104110000_pricing_boq_import.sql`
- Test: `supabase/tests/pricing_boq_import.test.sql`

**Interfaces:**
- Consumes:
  - PR 1: `public.pricing_file_move(_file_id uuid, _to public.pricing_file_state, _note text DEFAULT NULL) → jsonb`, `public.pricing_suggest_extras(_file_id uuid) → integer`, `public.is_pricer(uuid)`.
  - Phase 7A: `boq_revisions` (freeze = set `frozen_at`, `frozen_by`, `status`; one current revision per BOQ; supersede via `superseded_by`/`superseded_at`) and `boq_lines` (insert/delete refused once the revision is frozen).
  - Task 1: nothing.
- Produces:
  - `public.pricing_boq_import(_file_id uuid, _lines jsonb, _replace boolean DEFAULT false) → jsonb` `{"revision_id": uuid, "revision_number": int, "inserted": int}`.
    - `_lines` is a JSON array of objects with keys `sign_type` (required), `quantity` (required, > 0), and optional `description, dimensions, material, mounting, illumination, finish, location, unit, install_type ('double_tape'|'wall_screw'|'pylon'|'ceiling'|'floor'), width_mm, height_mm, weight_kg, mount_height_m` (numbers) and `has_screen, needs_floor_cut` (booleans). JSON `null` means absent.
    - It writes into the file's own unfrozen revision, or creates the next draft revision of the deal's BOQ, which becomes current and supersedes the previous current one. It creates the BOQ if the deal has none. Manual entry is the same call with one line.
  - `public.pricing_boq_line_delete(_file_id uuid, _line_id uuid) → void`
  - `public.pricing_file_freeze_boq(_file_id uuid, _status text DEFAULT 'verified', _note text DEFAULT NULL) → jsonb` (the file row).
    - `_status` is `'verified'` or `'partially_verified'`.
    - It freezes the file's revision through the existing 7A path (unless already frozen), moves the file `package_review → boq_frozen` through `pricing_file_move` with `_note`, then runs `pricing_suggest_extras`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_boq_import.test.sql`:

```sql
-- PR 2, part 2: BOQ lines entered in the pricing file (import or by hand), and the freeze.
-- Test user UUIDs use the 6b… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6b000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','bi-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,2) n;
update public.profiles set status = 'active' where id::text like '6b000000-%';
insert into public.user_roles (user_id, role) values
  ('6b000000-0000-0000-0000-000000000001','salesperson'),
  ('6b000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6b000000-0000-0000-0000-000000000002','finance_manager');

-- X: no BOQ yet. Y: a frozen revision already attached. Z: a frozen revision attached, new lines coming.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'bi-deal-' || n,
       '6b000000-0000-0000-0000-000000000001','6b000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,3) n;
insert into public.boqs (id, related_opportunity_id, title) values
  ('6b400002-0000-0000-0000-000000000001','6b200002-0000-0000-0000-000000000001','bi-boq-y'),
  ('6b400003-0000-0000-0000-000000000001','6b200003-0000-0000-0000-000000000001','bi-boq-z');
insert into public.boq_revisions (id, boq_id, revision_number) values
  ('6b500002-0000-0000-0000-000000000001','6b400002-0000-0000-0000-000000000001',1),
  ('6b500003-0000-0000-0000-000000000001','6b400003-0000-0000-0000-000000000001',1);
insert into public.boq_lines (revision_id, sign_type, quantity) values
  ('6b500002-0000-0000-0000-000000000001','Wall W1',1),
  ('6b500003-0000-0000-0000-000000000001','Wall W1',1);
update public.boq_revisions set frozen_at = '2026-11-01 10:00+03', frozen_by = '6b000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('6b500002-0000-0000-0000-000000000001','6b500003-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('6b600001-0000-0000-0000-000000000001','6b200001-0000-0000-0000-000000000001','package_review', null),
  ('6b600002-0000-0000-0000-000000000001','6b200002-0000-0000-0000-000000000001','package_review','6b500002-0000-0000-0000-000000000001'),
  ('6b600003-0000-0000-0000-000000000001','6b200003-0000-0000-0000-000000000001','package_review','6b500003-0000-0000-0000-000000000001');
insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_for)
values ('bi_concrete_base','Concrete base','قاعدة خرسانية','item',1200, array['pylon']::public.install_type[]);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"P1","quantity":1}]')$$,
  '42501', null, 'A rep cannot enter BOQ lines');

select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[]')$$,
  '23514', null, 'An empty list is refused');
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"P1","quantity":1,"install_type":"roof"}]')$$,
  '23514', 'Line 1 is not valid: unknown install type. | السطر 1 غير صالح: نوع تركيب غير معروف.', 'An unknown install type names the line');
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"P1","quantity":1},{"sign_type":"P2","quantity":0}]')$$,
  '23514', null, 'A quantity of zero is refused');
select is((public.pricing_boq_import('6b600001-0000-0000-0000-000000000001',
  '[{"sign_type":"Pylon P1","quantity":2,"install_type":"pylon","width_mm":1200,"height_mm":3000,"has_screen":true,"material":"Aluminium"},
    {"sign_type":"Wall W2","quantity":4,"unit":"no.","description":null}]'))->>'inserted',
  '2', 'Two lines are imported');
select isnt((select boq_revision_id from public.pricing_files where id = '6b600001-0000-0000-0000-000000000001'), null,
  'The file now has a revision');
select is((select count(*)::int from public.boqs where related_opportunity_id = '6b200001-0000-0000-0000-000000000001'), 1,
  'The deal got its BOQ');
select is((select r.revision_number || '/' || r.status::text || '/' || (r.frozen_at is null)::text
             from public.boq_revisions r join public.pricing_files f on f.boq_revision_id = r.id
            where f.id = '6b600001-0000-0000-0000-000000000001'),
  '1/draft/true', 'It is draft revision 1');
select is((select l.install_type::text || '/' || l.width_mm::text || '/' || l.has_screen::text
             from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
            where f.id = '6b600001-0000-0000-0000-000000000001' and l.sign_type = 'Pylon P1'),
  'pylon/1200.0/true', 'Structured attributes are stored');
select is((public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"Totem T1","quantity":1}]'))->>'inserted',
  '1', 'A line added by hand is appended');
select is((select l.line_number from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
            where f.id = '6b600001-0000-0000-0000-000000000001' and l.sign_type = 'Totem T1'), 3,
  'It takes the next line number');
select is((public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"Only","quantity":1}]', true))->>'inserted',
  '1', 'Replace keeps only the new lines');
select is((select count(*)::int from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
            where f.id = '6b600001-0000-0000-0000-000000000001'), 1, '... one line left');

select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_boq_line_delete('6b600001-0000-0000-0000-000000000001',
    (select l.id from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
      where f.id = '6b600001-0000-0000-0000-000000000001' limit 1))$$,
  '42501', null, 'A rep cannot delete a line');
select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_boq_line_delete('6b600001-0000-0000-0000-000000000001',
    (select l.id from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
      where f.id = '6b600001-0000-0000-0000-000000000001' limit 1))$$,
  'Zayed deletes a line from the draft');
select throws_ok($$select public.pricing_file_freeze_boq('6b600001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A revision with no lines cannot freeze');
select lives_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001',
  '[{"sign_type":"Pylon P1","quantity":2,"install_type":"pylon"},{"sign_type":"Wall W2","quantity":4}]')$$,
  'Lines are entered again');

select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_freeze_boq('6b600001-0000-0000-0000-000000000001')$$,
  '42501', null, 'A rep cannot freeze the BOQ');
select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_freeze_boq('6b600001-0000-0000-0000-000000000001','superseded')$$,
  '23514', null, 'Freezing takes verified or partially verified only');
select is((public.pricing_file_freeze_boq('6b600001-0000-0000-0000-000000000001','verified','Checked against drawings and location plan'))->>'state',
  'boq_frozen', 'The BOQ freezes and the file moves on');
select is((select r.status::text || '/' || r.frozen_by::text from public.boq_revisions r join public.pricing_files f on f.boq_revision_id = r.id
            where f.id = '6b600001-0000-0000-0000-000000000001'),
  'verified/6b000000-0000-0000-0000-000000000002', 'The freeze is stamped from the session');
select is((select note from public.pricing_file_events where file_id = '6b600001-0000-0000-0000-000000000001' and to_state = 'boq_frozen'),
  'Checked against drawings and location plan', 'The checklist note is on the move');
select is((select count(*)::int from public.pricing_file_extras where file_id = '6b600001-0000-0000-0000-000000000001'), 1,
  'Freezing runs the extras suggestions (the pylon suggests a base)');
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"Late","quantity":1}]')$$,
  'P0001', null, 'Lines cannot be entered after the freeze');

-- Y: the attached revision is already frozen; the freeze only moves the file.
select is((public.pricing_file_freeze_boq('6b600002-0000-0000-0000-000000000001'))->>'state', 'boq_frozen',
  'An already-frozen revision moves the file without a second freeze');

-- Z: lines entered on a file whose revision is frozen open the next revision.
select is((public.pricing_boq_import('6b600003-0000-0000-0000-000000000001','[{"sign_type":"Wall W1","quantity":2}]'))->>'revision_number',
  '2', 'New lines on a frozen revision open revision 2, which replaces revision 1');
reset role;
select * from finish();
rollback;
```

Count check: 1 + 3 + 9 (import, revision, BOQ, draft, attributes, append, line number, replace, one left) + 2 (delete) + 2 (freeze with no lines, re-enter) + 7 (rep freeze, bad status, freeze, stamp, note, extras, late import) + 1 (Y) + 1 (Z) = 26.

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_boq_import.test.sql` FAILS with `function public.pricing_boq_import(unknown, unknown) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261104110000_pricing_boq_import.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 2, part 2: BOQ lines entered in the pricing file.
--
-- Zayed checks the BOQ against the drawings and the location plan, then
-- freezes it (spec §1 package_review → boq_frozen). The Excel file is parsed
-- and mapped in the browser (src/lib/boq-import.ts); the lines arrive here as
-- JSON, are validated, and go into a DRAFT revision of the deal's BOQ, with the
-- structured attributes PR 1 added (install type, size, weight, mount height,
-- screen, floor cut). A line typed by hand is the same call with one line.
-- The freeze is the existing Phase 7A one-way door (frozen_at), stamped from
-- the session, and the move is pricing_file_move's, so its checks still run.
-- =============================================================================

-- A number as text: digits with an optional decimal part. NULL is fine.
CREATE OR REPLACE FUNCTION public._pricing_num_ok(_v text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _v IS NULL OR _v ~ '^[0-9]+(\.[0-9]+)?$';
$$;
REVOKE ALL ON FUNCTION public._pricing_num_ok(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_boq_import(_file_id uuid, _lines jsonb, _replace boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; rev public.boq_revisions;
        b_id uuid; prev uuid; next_no integer; first_no integer; n integer;
        bad_ord bigint; bad_why text[];
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may enter BOQ lines. | إدخال بنود الكميات يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Add at least one line. | أضف بنداً واحداً على الأقل.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(_lines) > 2000 THEN
    RAISE EXCEPTION 'At most 2000 lines at a time. | 2000 بند كحد أقصى في المرة.' USING ERRCODE = '23514';
  END IF;

  -- The first line that is not valid, with the reason in both languages.
  SELECT e.ord, x.why INTO bad_ord, bad_why
    FROM jsonb_array_elements(_lines) WITH ORDINALITY AS e(v, ord)
    CROSS JOIN LATERAL (SELECT CASE
      WHEN jsonb_typeof(e.v) <> 'object' THEN ARRAY['not a line','ليس بنداً']
      WHEN btrim(coalesce(e.v->>'sign_type','')) = '' THEN ARRAY['sign type is empty','نوع اللوحة فارغ']
      WHEN e.v->>'quantity' IS NULL THEN ARRAY['quantity is missing','الكمية غير موجودة']
      WHEN NOT public._pricing_num_ok(e.v->>'quantity') THEN ARRAY['quantity is not a number','الكمية ليست رقماً']
      WHEN (e.v->>'quantity')::numeric <= 0 THEN ARRAY['quantity must be above zero','الكمية يجب أن تكون أكبر من صفر']
      WHEN nullif(e.v->>'install_type','') IS NOT NULL
           AND NOT ((e.v->>'install_type') = ANY (enum_range(NULL::public.install_type)::text[]))
        THEN ARRAY['unknown install type','نوع تركيب غير معروف']
      WHEN NOT public._pricing_num_ok(nullif(e.v->>'width_mm',''))
        OR NOT public._pricing_num_ok(nullif(e.v->>'height_mm',''))
        THEN ARRAY['width and height are millimetres','العرض والارتفاع بالمليمتر']
      WHEN (nullif(e.v->>'width_mm',''))::numeric = 0 OR (nullif(e.v->>'height_mm',''))::numeric = 0
        THEN ARRAY['width and height must be above zero','العرض والارتفاع يجب أن يكونا أكبر من صفر']
      WHEN NOT public._pricing_num_ok(nullif(e.v->>'weight_kg',''))
        OR NOT public._pricing_num_ok(nullif(e.v->>'mount_height_m',''))
        THEN ARRAY['weight and mount height are numbers','الوزن وارتفاع التركيب أرقام']
      WHEN (e.v ? 'has_screen' AND jsonb_typeof(e.v->'has_screen') NOT IN ('boolean','null'))
        OR (e.v ? 'needs_floor_cut' AND jsonb_typeof(e.v->'needs_floor_cut') NOT IN ('boolean','null'))
        THEN ARRAY['screen and floor cut are yes or no','الشاشة وقص الأرضية نعم أو لا']
    END AS why) x
   WHERE x.why IS NOT NULL
   ORDER BY e.ord LIMIT 1;
  IF bad_ord IS NOT NULL THEN
    RAISE EXCEPTION 'Line % is not valid: %. | السطر % غير صالح: %.', bad_ord, bad_why[1], bad_ord, bad_why[2]
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state <> 'package_review' THEN
    RAISE EXCEPTION 'BOQ lines are entered during package review. | تُدخل بنود الكميات أثناء دراسة الباكيج.'
      USING ERRCODE = 'P0001';
  END IF;

  IF f.boq_revision_id IS NOT NULL THEN
    SELECT * INTO rev FROM public.boq_revisions WHERE id = f.boq_revision_id FOR UPDATE;
  END IF;
  IF rev.id IS NULL OR rev.frozen_at IS NOT NULL THEN
    -- A new draft revision of the deal's BOQ, which becomes its current one.
    SELECT b.id INTO b_id FROM public.boqs b
     WHERE b.related_opportunity_id = f.opportunity_id ORDER BY b.created_at, b.id LIMIT 1;
    IF b_id IS NULL THEN
      INSERT INTO public.boqs (related_opportunity_id, title, source, created_by)
      VALUES (f.opportunity_id, 'Pricing BOQ', 'pricing_file', u) RETURNING id INTO b_id;
    END IF;
    SELECT r.id INTO prev FROM public.boq_revisions r WHERE r.boq_id = b_id AND r.is_current FOR UPDATE;
    SELECT coalesce(max(r.revision_number), 0) + 1 INTO next_no FROM public.boq_revisions r WHERE r.boq_id = b_id;
    IF prev IS NOT NULL THEN
      UPDATE public.boq_revisions SET is_current = false WHERE id = prev;
    END IF;
    INSERT INTO public.boq_revisions (boq_id, revision_number, status, source_type, notes, created_by, is_current)
    VALUES (b_id, next_no, 'draft', 'manual', 'Entered in the pricing file', u, true)
    RETURNING * INTO rev;
    IF prev IS NOT NULL THEN
      UPDATE public.boq_revisions SET superseded_by = rev.id, superseded_at = now() WHERE id = prev;
    END IF;
    UPDATE public.pricing_files SET boq_revision_id = rev.id, updated_at = now() WHERE id = f.id;
  END IF;

  IF _replace THEN
    DELETE FROM public.boq_lines WHERE revision_id = rev.id;
  END IF;
  SELECT coalesce(max(l.line_number), 0) INTO first_no FROM public.boq_lines l WHERE l.revision_id = rev.id;

  INSERT INTO public.boq_lines (revision_id, line_number, sort_order, sign_type, description, dimensions,
                                material, mounting, illumination, finish, location, quantity, unit,
                                install_type, width_mm, height_mm, weight_kg, mount_height_m,
                                has_screen, needs_floor_cut, item_source)
  SELECT rev.id, first_no + e.ord, first_no + e.ord,
         btrim(e.v->>'sign_type'),
         nullif(btrim(e.v->>'description'), ''), nullif(btrim(e.v->>'dimensions'), ''),
         nullif(btrim(e.v->>'material'), ''), nullif(btrim(e.v->>'mounting'), ''),
         nullif(btrim(e.v->>'illumination'), ''), nullif(btrim(e.v->>'finish'), ''),
         nullif(btrim(e.v->>'location'), ''),
         (e.v->>'quantity')::numeric, nullif(btrim(e.v->>'unit'), ''),
         (nullif(e.v->>'install_type', ''))::public.install_type,
         (nullif(e.v->>'width_mm', ''))::numeric, (nullif(e.v->>'height_mm', ''))::numeric,
         (nullif(e.v->>'weight_kg', ''))::numeric, (nullif(e.v->>'mount_height_m', ''))::numeric,
         coalesce((e.v->>'has_screen')::boolean, false), coalesce((e.v->>'needs_floor_cut')::boolean, false),
         'pricing_file'
    FROM jsonb_array_elements(_lines) WITH ORDINALITY AS e(v, ord);
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.boq_lines_entered', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'revision_id', rev.id, 'inserted', n, 'replaced', _replace));
  RETURN jsonb_build_object('revision_id', rev.id, 'revision_number', rev.revision_number, 'inserted', n);
END $$;
REVOKE ALL ON FUNCTION public.pricing_boq_import(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_boq_import(uuid, jsonb, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_boq_line_delete(_file_id uuid, _line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may remove BOQ lines. | حذف بنود الكميات يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND OR f.state <> 'package_review' THEN
    RAISE EXCEPTION 'BOQ lines are changed during package review. | تُعدَّل بنود الكميات أثناء دراسة الباكيج.'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.boq_lines l WHERE l.id = _line_id AND l.revision_id = f.boq_revision_id) THEN
    RAISE EXCEPTION 'That line is not in this file''s BOQ. | هذا البند ليس في كميات هذا الملف.' USING ERRCODE = '23514';
  END IF;
  -- boq_lines_guard refuses this once the revision is frozen.
  DELETE FROM public.boq_lines WHERE id = _line_id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.boq_line_removed', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'line_id', _line_id));
END $$;
REVOKE ALL ON FUNCTION public.pricing_boq_line_delete(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_boq_line_delete(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_freeze_boq(_file_id uuid, _status text DEFAULT 'verified', _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; rev public.boq_revisions;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may freeze the BOQ. | تجميد الكميات يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  IF _status IS NULL OR _status NOT IN ('verified','partially_verified') THEN
    RAISE EXCEPTION 'A frozen BOQ is verified or partially verified. | الكميات المجمّدة إما متحققة أو متحققة جزئياً.'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state <> 'package_review' THEN
    RAISE EXCEPTION 'The BOQ is frozen at the end of package review. | تُجمَّد الكميات في نهاية دراسة الباكيج.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO rev FROM public.boq_revisions WHERE id = f.boq_revision_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.boq_lines l WHERE l.revision_id = rev.id) THEN
    RAISE EXCEPTION 'Enter or attach BOQ lines before freezing. | أدخل بنود الكميات أو اربطها قبل التجميد.'
      USING ERRCODE = 'P0001';
  END IF;
  IF rev.frozen_at IS NULL THEN
    -- The Phase 7A freeze; propagate_freeze_to_supplier_quotes runs after it.
    UPDATE public.boq_revisions
       SET frozen_at = now(), frozen_by = u, status = _status::public.boq_revision_status
     WHERE id = rev.id;
  END IF;
  PERFORM public.pricing_file_move(f.id, 'boq_frozen', _note);
  PERFORM public.pricing_suggest_extras(f.id);
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_freeze_boq(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_freeze_boq(uuid, text, text) TO authenticated;
```

- [ ] **Step 4: Run the DB suite and confirm it passes**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_boq_import.test.sql .. ok`, and every other file still ok.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104110000_pricing_boq_import.sql supabase/tests/pricing_boq_import.test.sql
git commit -m "feat(pricing): enter BOQ lines in the pricing file and freeze them" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Settings stores and the file's pricing inputs (SQL)

**Files:**
- Create: `supabase/migrations/20261104120000_pricing_settings_inputs.sql`
- Test: `supabase/tests/pricing_settings_inputs.test.sql`

**Interfaces:**
- Consumes:
  - PR 1: tables `logistics_rates(key, value, currency, note, updated_by, updated_at)` (key CHECK is named `logistics_rates_key_check`), `pricing_extras_catalog(id, code, name_en, name_ar, unit, default_rate, suggest_for, suggest_min_height_m, active, created_at)`, `installation_rates(...)`.
  - PR 1 trigger function `logistics_rates_stamp()`; `public.pricing_suggest_extras(uuid)`.
  - Phase 8: table `margin_policies(id, min_margin_pct, effective_from, effective_to, rationale, created_by, created_at)` and `public.current_margin_floor()`.
- Produces:
  - `logistics_rates` keys `install_fallback_pct` (seed 10) and `default_margin_pct` (seed 25), and column `effective_from date` ("in force since", re-stamped when `value` changes).
  - `pricing_extras_catalog.suggest_if_cinema boolean` and `pricing_extras_catalog.effective_from date` (re-stamped when `default_rate` changes).
  - `public.pricing_set_installation_rate(_type public.install_type, _from date, _base_rate numeric, _per_kg_over numeric DEFAULT 0, _weight_threshold_kg numeric DEFAULT NULL, _per_m_over numeric DEFAULT 0, _height_threshold_m numeric DEFAULT NULL, _floor_cut_add numeric DEFAULT 0, _scaffold_add numeric DEFAULT 0, _crane_add numeric DEFAULT 0) → jsonb` (the rate row).
  - `public.pricing_set_margin_floor(_min_margin_pct numeric, _rationale text) → jsonb` (the policy row).
  - Table `public.pricing_file_inputs(file_id PK, is_cinema, containers, delivery ('none'|'jeddah'|'riyadh'), clearing, overhead_pct, default_margin_pct, updated_by, updated_at)`. Cost-gated read; no direct writes.
  - `public.pricing_file_set_inputs(_file_id uuid, _inputs jsonb) → jsonb` (the inputs row).
    - Keys: `is_cinema, containers, delivery, clearing, overhead_pct` for a pricer or the GM while the file is in `boq_frozen`, `at_supplier`, `supplier_priced` or `selling_build`.
    - Key `default_margin_pct` for the GM only, in `selling_build`.
    - A change of `is_cinema` re-runs `pricing_suggest_extras`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_settings_inputs.test.sql`:

```sql
-- PR 2, part 3: settings stores (fallback %, default margin, in-force dates,
-- installation rate changes, margin floor) and the file's pricing inputs.
-- Test user UUIDs use the 6c… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6c000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','si-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,5) n;
update public.profiles set status = 'active' where id::text like '6c000000-%';
insert into public.user_roles (user_id, role) values
  ('6c000000-0000-0000-0000-000000000001','salesperson'),
  ('6c000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6c000000-0000-0000-0000-000000000002','finance_manager'),
  ('6c000000-0000-0000-0000-000000000003','general_manager'),
  ('6c000000-0000-0000-0000-000000000004','bd_manager'),
  ('6c000000-0000-0000-0000-000000000005','sales_manager');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6c20000' || n || '-0000-0000-0000-000000000001')::uuid, 'si-deal-' || n,
       '6c000000-0000-0000-0000-000000000001','6c000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.pricing_files (id, opportunity_id, state) values
  ('6c600001-0000-0000-0000-000000000001','6c200001-0000-0000-0000-000000000001','boq_frozen'),
  ('6c600002-0000-0000-0000-000000000001','6c200002-0000-0000-0000-000000000001','received');
-- An older floor, so the GM's first change closes it.
insert into public.margin_policies (min_margin_pct, effective_from, rationale)
values (5, now() - interval '30 days', 'si-old');

-- ===== Logistics rates and the two new defaults =====
select is((select value from public.logistics_rates where key = 'install_fallback_pct'), 10::numeric, 'The fallback % is seeded at 10');
select is((select value from public.logistics_rates where key = 'default_margin_pct'), 25::numeric, 'The default margin is seeded at 25');
-- The stamp trigger keeps effective_from unless the value changes, so the fixture switches it off to back-date.
alter table public.logistics_rates disable trigger logistics_rates_stamp;
update public.logistics_rates set effective_from = current_date - 10 where key in ('install_fallback_pct','default_margin_pct');
alter table public.logistics_rates enable trigger logistics_rates_stamp;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
update public.logistics_rates set value = 12 where key = 'install_fallback_pct';
select is((select effective_from from public.logistics_rates where key = 'install_fallback_pct'), current_date,
  'A new value is in force from today');
update public.logistics_rates set note = 'confirmed with Kalas' where key = 'default_margin_pct';
select is((select effective_from from public.logistics_rates where key = 'default_margin_pct'), current_date - 10,
  'A note alone does not change the in-force date');
select throws_ok($$update public.logistics_rates set value = 150 where key = 'default_margin_pct'$$,
  '23514', null, 'A margin of 100% or more is refused');

-- ===== Catalog =====
select lives_ok($$insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_if_cinema)
                  values ('si_acoustic','Acoustic insulation','عزل صوتي','m2',150,true)$$,
  'A pricer adds a cinema-only extra');
select is((select effective_from from public.pricing_extras_catalog where code = 'si_acoustic'), current_date,
  'It is in force from today');
reset role;
alter table public.pricing_extras_catalog disable trigger pricing_extras_catalog_stamp;
update public.pricing_extras_catalog set effective_from = current_date - 5 where code = 'si_acoustic';
alter table public.pricing_extras_catalog enable trigger pricing_extras_catalog_stamp;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
update public.pricing_extras_catalog set default_rate = 175 where code = 'si_acoustic';
select is((select effective_from from public.pricing_extras_catalog where code = 'si_acoustic'), current_date,
  'A new default rate is in force from today');

-- ===== Installation rates change on a date =====
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_set_installation_rate('pylon', current_date, 900)$$,
  '42501', null, 'A rep cannot set rates');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_set_installation_rate('pylon', current_date - 1, 900)$$,
  '23514', null, 'A new rate cannot start in the past');
select throws_ok($$select public.pricing_set_installation_rate('pylon', current_date, -1)$$,
  '23514', null, 'A negative rate is refused');
select lives_ok($$select public.pricing_set_installation_rate('pylon', current_date, 900)$$, 'The first pylon rate starts today');
select lives_ok($$select public.pricing_set_installation_rate('pylon', current_date + 10, 950)$$, 'A new pylon rate starts in ten days');
select is((select effective_to from public.installation_rates where install_type = 'pylon' and effective_from = current_date),
  current_date + 10, 'The current rate ends when the new one starts');
select lives_ok($$select public.pricing_set_installation_rate('pylon', current_date + 10, 975)$$, 'Same start date: a correction');
select is((select count(*)::int || '/' || max(base_rate)::text from public.installation_rates where install_type = 'pylon'),
  '2/975.00', 'The correction replaced the figure, not added a row');
select throws_ok($$select public.pricing_set_installation_rate('pylon', current_date + 5, 960)$$,
  'P0001', null, 'A rate cannot start before a later one already set');

-- ===== Margin floor (the GM's) =====
select throws_ok($$select public.pricing_set_margin_floor(12, 'Board decision')$$, '42501', null, 'A pricer cannot set the floor');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_set_margin_floor(12, ' ')$$, '23514', null, 'The floor needs a reason');
select is((public.pricing_set_margin_floor(12, 'Board decision'))->>'min_margin_pct', '12.00', 'Kalas sets the floor to 12%');
select is(public.current_margin_floor(), 12.00::numeric, 'It is the floor in force');
select is((public.pricing_set_margin_floor(15, 'Board decision, corrected'))->>'min_margin_pct', '15.00', 'A second change the same moment corrects it');
select is((select count(*)::int from public.margin_policies where effective_to is null), 1, 'One floor is open; the old one was closed');

-- ===== The file's inputs =====
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"containers":1}')$$,
  '42501', null, 'A rep cannot set pricing inputs');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"containers":2,"delivery":"riyadh","clearing":true}'))->>'delivery',
  'riyadh', 'Zayed sets the logistics inputs once the BOQ is frozen');
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"default_margin_pct":20}')$$,
  '42501', null, 'Zayed cannot set the margin');
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"containers":"two"}')$$,
  '23514', null, 'A wrong type is refused');
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"discount":5}')$$,
  '23514', null, 'An unknown input is refused');
select throws_ok($$select public.pricing_file_set_inputs('6c600002-0000-0000-0000-000000000001','{"containers":1}')$$,
  'P0001', null, 'Inputs wait until the BOQ is frozen');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"default_margin_pct":20}')$$,
  'P0001', null, 'The margin is set in the selling build');
reset role;
update public.pricing_files set state = 'selling_build' where id = '6c600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"default_margin_pct":22}'))->>'default_margin_pct',
  '22.00', 'Kalas sets the file''s default margin');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_file_inputs), 0, 'A rep reads no inputs (they carry the margin)');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_file_inputs where file_id = '6c600001-0000-0000-0000-000000000001'), 1,
  'The sales manager reads them');
reset role;
select * from finish();
rollback;
```

Count check: 5 logistics + 3 catalog + 9 rates + 6 floor + 10 inputs (rep, Zayed sets, Zayed margin, wrong type, unknown, before freeze, GM too early, GM sets, rep reads none, sales manager reads) = 33.

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_settings_inputs.test.sql` FAILS. The first assertion finds no `install_fallback_pct` row.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261104120000_pricing_settings_inputs.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 2, part 3: what /pricing/settings edits, and the inputs a
-- pricing file carries into the selling price (spec §3, §4.3).
--
-- * Two pricing defaults live beside the logistics rates (one key/value table,
--   one settings card, one audit trigger): the installation fallback % (PR 1
--   had nowhere to keep it: logistics_rates.key has a closed CHECK) and the
--   default margin on price. Each value says since when it is in force; its
--   history is the audit_log rows pricing_settings_audit already writes.
-- * The extras catalog gains "suggest for a cinema project" (spec §3) and the
--   same in-force date for its default rate.
-- * Installation rates already have date ranges (PR 1). Changing one is a
--   close-and-open, done in one call so two people cannot leave a gap.
-- * The margin floor (Phase 8 margin_policies) is the GM's; one call closes
--   the floor in force and opens the new one.
-- * pricing_file_inputs: per file, cost inputs (logistics, overhead, cinema)
--   for a pricer or the GM, and the default margin for the GM alone.
-- =============================================================================

-- 1. Two pricing defaults beside the logistics rates.
ALTER TABLE public.logistics_rates DROP CONSTRAINT IF EXISTS logistics_rates_key_check;
ALTER TABLE public.logistics_rates ADD CONSTRAINT logistics_rates_key_check CHECK (key IN (
  'container_rate','customs_pct','clearing_fee','delivery_jeddah','delivery_riyadh',
  'install_fallback_pct','default_margin_pct'));
ALTER TABLE public.logistics_rates DROP CONSTRAINT IF EXISTS logistics_rates_pct_below_100;
ALTER TABLE public.logistics_rates ADD CONSTRAINT logistics_rates_pct_below_100
  CHECK (key NOT IN ('customs_pct','install_fallback_pct','default_margin_pct') OR value < 100);
ALTER TABLE public.logistics_rates ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT current_date;
INSERT INTO public.logistics_rates (key, value, currency, note) VALUES
  ('install_fallback_pct', 10, '%', 'Installation as a % of materials when a line has no type or no rate in force. Plan default, confirm with Zayed'),
  ('default_margin_pct',   25, '%', 'Starting margin on price for a line with none set. Plan default, confirm with Kalas')
ON CONFLICT (key) DO NOTHING;
COMMENT ON TABLE public.logistics_rates IS
  'Logistics defaults (container, customs %, clearing, inland delivery) and two pricing defaults (install_fallback_pct, default_margin_pct). Cost: cost holders read, pricers edit. effective_from = in force since; history in audit_log.';

-- Same as PR 1, plus the in-force date when the value changes.
CREATE OR REPLACE FUNCTION public.logistics_rates_stamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := pg_catalog.now();
  NEW.effective_from := CASE WHEN NEW.value IS DISTINCT FROM OLD.value THEN current_date ELSE OLD.effective_from END;
  RETURN NEW;
END $$;

-- 2. Catalog: the cinema suggestion and the in-force date of the default rate.
ALTER TABLE public.pricing_extras_catalog
  ADD COLUMN IF NOT EXISTS suggest_if_cinema boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT current_date;
CREATE OR REPLACE FUNCTION public.pricing_extras_catalog_stamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.effective_from := current_date;
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.effective_from := CASE WHEN NEW.default_rate IS DISTINCT FROM OLD.default_rate
                               THEN current_date ELSE OLD.effective_from END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_extras_catalog_stamp() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pricing_extras_catalog_stamp ON public.pricing_extras_catalog;
CREATE TRIGGER pricing_extras_catalog_stamp BEFORE INSERT OR UPDATE ON public.pricing_extras_catalog
  FOR EACH ROW EXECUTE FUNCTION public.pricing_extras_catalog_stamp();

-- 3. Change an installation rate from a date, in one call.
CREATE OR REPLACE FUNCTION public.pricing_set_installation_rate(
  _type public.install_type, _from date, _base_rate numeric,
  _per_kg_over numeric DEFAULT 0, _weight_threshold_kg numeric DEFAULT NULL,
  _per_m_over numeric DEFAULT 0, _height_threshold_m numeric DEFAULT NULL,
  _floor_cut_add numeric DEFAULT 0, _scaffold_add numeric DEFAULT 0, _crane_add numeric DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); r public.installation_rates;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance set installation rates. | أسعار التركيب يضعها التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  IF _type IS NULL OR _from IS NULL OR _from < current_date THEN
    RAISE EXCEPTION 'A rate starts today or later. | يبدأ السعر اليوم أو بعده.' USING ERRCODE = '23514';
  END IF;
  IF _base_rate IS NULL OR _base_rate < 0
     OR least(coalesce(_per_kg_over,0), coalesce(_per_m_over,0), coalesce(_floor_cut_add,0),
              coalesce(_scaffold_add,0), coalesce(_crane_add,0)) < 0
     OR coalesce(_weight_threshold_kg,0) < 0 OR coalesce(_height_threshold_m,0) < 0 THEN
    RAISE EXCEPTION 'Rates and thresholds cannot be negative. | الأسعار والحدود لا تكون سالبة.' USING ERRCODE = '23514';
  END IF;
  -- One type's rates are a chain of dates; serialize changes to that type.
  PERFORM pg_advisory_xact_lock(hashtext('installation_rates:' || _type::text));
  IF EXISTS (SELECT 1 FROM public.installation_rates WHERE install_type = _type AND effective_from > _from) THEN
    RAISE EXCEPTION 'A later rate for this type is already set; change that one. | يوجد سعر لاحق لهذا النوع؛ عدّله هو.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO r FROM public.installation_rates WHERE install_type = _type AND effective_from = _from;
  IF FOUND THEN
    UPDATE public.installation_rates
       SET base_rate = _base_rate, per_kg_over = coalesce(_per_kg_over,0), weight_threshold_kg = _weight_threshold_kg,
           per_m_over = coalesce(_per_m_over,0), height_threshold_m = _height_threshold_m,
           floor_cut_add = coalesce(_floor_cut_add,0), scaffold_add = coalesce(_scaffold_add,0),
           crane_add = coalesce(_crane_add,0)
     WHERE id = r.id RETURNING * INTO r;
  ELSE
    UPDATE public.installation_rates SET effective_to = _from
     WHERE install_type = _type AND effective_from < _from AND (effective_to IS NULL OR effective_to > _from);
    INSERT INTO public.installation_rates (install_type, base_rate, per_kg_over, weight_threshold_kg, per_m_over,
                                           height_threshold_m, floor_cut_add, scaffold_add, crane_add, effective_from)
    VALUES (_type, _base_rate, coalesce(_per_kg_over,0), _weight_threshold_kg, coalesce(_per_m_over,0),
            _height_threshold_m, coalesce(_floor_cut_add,0), coalesce(_scaffold_add,0), coalesce(_crane_add,0), _from)
    RETURNING * INTO r;
  END IF;
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.pricing_set_installation_rate(public.install_type, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_set_installation_rate(public.install_type, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated;

-- 4. The margin floor is the GM's. Within one moment a second change
-- corrects the first (a policy cannot start and end at the same instant).
CREATE OR REPLACE FUNCTION public.pricing_set_margin_floor(_min_margin_pct numeric, _rationale text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); m public.margin_policies;
BEGIN
  IF NOT public.can_approve_final_price(u) THEN
    RAISE EXCEPTION 'Only the GM sets the margin floor. | الحد الأدنى للهامش يضعه المدير العام.' USING ERRCODE = '42501';
  END IF;
  IF _min_margin_pct IS NULL OR _min_margin_pct < -100 OR _min_margin_pct > 100
     OR length(btrim(coalesce(_rationale,''))) = 0 THEN
    RAISE EXCEPTION 'Give a floor between -100 and 100 and say why. | حدد حداً بين -100 و100 واذكر السبب.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('margin_policies'));
  IF EXISTS (SELECT 1 FROM public.margin_policies WHERE effective_from > now()) THEN
    RAISE EXCEPTION 'A future floor is already set. | يوجد حد مستقبلي محدد.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO m FROM public.margin_policies WHERE effective_from = now();
  IF FOUND THEN
    UPDATE public.margin_policies SET min_margin_pct = _min_margin_pct, rationale = btrim(_rationale)
     WHERE id = m.id RETURNING * INTO m;
  ELSE
    UPDATE public.margin_policies SET effective_to = now()
     WHERE effective_from < now() AND (effective_to IS NULL OR effective_to > now());
    INSERT INTO public.margin_policies (min_margin_pct, effective_from, rationale, created_by)
    VALUES (_min_margin_pct, now(), btrim(_rationale), u) RETURNING * INTO m;
  END IF;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'margin_policy.set', 'margin_policy', m.id,
          jsonb_build_object('min_margin_pct', m.min_margin_pct, 'rationale', m.rationale));
  RETURN to_jsonb(m);
END $$;
REVOKE ALL ON FUNCTION public.pricing_set_margin_floor(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_set_margin_floor(numeric, text) TO authenticated;

-- 5. The inputs a file carries into the selling price.
CREATE TABLE IF NOT EXISTS public.pricing_file_inputs (
  file_id            uuid PRIMARY KEY REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  is_cinema          boolean NOT NULL DEFAULT false,
  containers         numeric(8,2) NOT NULL DEFAULT 0 CHECK (containers >= 0),
  delivery           text NOT NULL DEFAULT 'none' CHECK (delivery IN ('none','jeddah','riyadh')),
  clearing           boolean NOT NULL DEFAULT false,
  overhead_pct       numeric(5,2) NOT NULL DEFAULT 0 CHECK (overhead_pct >= 0 AND overhead_pct < 100),
  default_margin_pct numeric(5,2) CHECK (default_margin_pct IS NULL OR (default_margin_pct > -100 AND default_margin_pct < 100)),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pricing_file_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_file_inputs FROM anon, authenticated;
GRANT SELECT ON public.pricing_file_inputs TO authenticated;
GRANT ALL ON public.pricing_file_inputs TO service_role;
DROP POLICY IF EXISTS "Cost holders read file inputs" ON public.pricing_file_inputs;
CREATE POLICY "Cost holders read file inputs" ON public.pricing_file_inputs FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid()))
         AND EXISTS (SELECT 1 FROM public.pricing_files f WHERE f.id = file_id
                      AND (public.is_pricer((SELECT auth.uid())) OR public.can_read_boq(f.opportunity_id, (SELECT auth.uid())))));
DROP POLICY IF EXISTS audit_session_boundary ON public.pricing_file_inputs;
CREATE POLICY audit_session_boundary ON public.pricing_file_inputs AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

CREATE OR REPLACE FUNCTION public.pricing_file_set_inputs(_file_id uuid, _inputs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; i public.pricing_file_inputs;
        k text; was_cinema boolean;
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_approve_final_price(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  IF _inputs IS NULL OR jsonb_typeof(_inputs) <> 'object' THEN
    RAISE EXCEPTION 'Pricing inputs are an object. | مُدخلات التسعير كائن.' USING ERRCODE = '23514';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_inputs) LOOP
    IF k NOT IN ('is_cinema','containers','delivery','clearing','overhead_pct','default_margin_pct') THEN
      RAISE EXCEPTION 'Unknown pricing input %. | مُدخل تسعير غير معروف: %.', k, k USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF _inputs ? 'default_margin_pct' AND NOT public.can_approve_final_price(u) THEN
    RAISE EXCEPTION 'The GM sets the margin. | الهامش يضعه المدير العام.' USING ERRCODE = '42501';
  END IF;
  IF (_inputs ? 'is_cinema' AND jsonb_typeof(_inputs->'is_cinema') <> 'boolean')
     OR (_inputs ? 'clearing' AND jsonb_typeof(_inputs->'clearing') <> 'boolean')
     OR (_inputs ? 'containers' AND jsonb_typeof(_inputs->'containers') <> 'number')
     OR (_inputs ? 'overhead_pct' AND jsonb_typeof(_inputs->'overhead_pct') <> 'number')
     OR (_inputs ? 'default_margin_pct' AND jsonb_typeof(_inputs->'default_margin_pct') NOT IN ('number','null'))
     OR (_inputs ? 'delivery' AND coalesce(_inputs->>'delivery','') NOT IN ('none','jeddah','riyadh')) THEN
    RAISE EXCEPTION 'A pricing input has the wrong type. | نوع أحد مُدخلات التسعير غير صحيح.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state::text NOT IN ('boq_frozen','at_supplier','supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Pricing inputs are set after the BOQ is frozen and before the price goes to review. | تُضبط مُدخلات التسعير بعد تجميد الكميات وقبل إرسال السعر للمراجعة.'
      USING ERRCODE = 'P0001';
  END IF;
  IF _inputs ? 'default_margin_pct' AND f.state <> 'selling_build' THEN
    RAISE EXCEPTION 'The margin is set in the selling build. | يُضبط الهامش في مرحلة بناء سعر البيع.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.pricing_file_inputs (file_id, updated_by) VALUES (f.id, u) ON CONFLICT (file_id) DO NOTHING;
  SELECT x.is_cinema INTO was_cinema FROM public.pricing_file_inputs x WHERE x.file_id = f.id FOR UPDATE;
  UPDATE public.pricing_file_inputs SET
    is_cinema          = CASE WHEN _inputs ? 'is_cinema' THEN (_inputs->>'is_cinema')::boolean ELSE is_cinema END,
    containers         = CASE WHEN _inputs ? 'containers' THEN (_inputs->>'containers')::numeric ELSE containers END,
    delivery           = CASE WHEN _inputs ? 'delivery' THEN _inputs->>'delivery' ELSE delivery END,
    clearing           = CASE WHEN _inputs ? 'clearing' THEN (_inputs->>'clearing')::boolean ELSE clearing END,
    overhead_pct       = CASE WHEN _inputs ? 'overhead_pct' THEN (_inputs->>'overhead_pct')::numeric ELSE overhead_pct END,
    default_margin_pct = CASE WHEN _inputs ? 'default_margin_pct' THEN (_inputs->>'default_margin_pct')::numeric ELSE default_margin_pct END,
    updated_by = u, updated_at = now()
   WHERE file_id = f.id RETURNING * INTO i;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.inputs_set', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(_inputs) x)));
  IF i.is_cinema IS DISTINCT FROM was_cinema THEN
    PERFORM public.pricing_suggest_extras(f.id);
  END IF;
  RETURN to_jsonb(i);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_set_inputs(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_set_inputs(uuid, jsonb) TO authenticated;
```

- [ ] **Step 4: Run the DB suite and confirm it passes**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_settings_inputs.test.sql .. ok`. PR 1's `pricing_rates.test.sql` still passes, because its logistics seeds are unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104120000_pricing_settings_inputs.sql supabase/tests/pricing_settings_inputs.test.sql
git commit -m "feat(pricing): settings stores (fallback %, default margin, floor, rate changes) and file inputs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Extras per round, the suggest/propose race, cinema, adding from the catalog (SQL)

**Files:**
- Create: `supabase/migrations/20261104130000_pricing_extras_rounds.sql`
- Test: `supabase/tests/pricing_extras_rounds.test.sql`
- Modify: `supabase/tests/pricing_calc.test.sql`. One assertion; see Step 4.

**Interfaces:**
- Consumes:
  - PR 1 `pricing_file_extras(id, file_id, catalog_id, quantity, rate, status, dismiss_reason, source_line_id, decided_by, decided_at, created_at)`, its unique index `pricing_file_extras_one_per_item (file_id, catalog_id)`, and `public.pricing_decide_extra(uuid, boolean, numeric, numeric, text)` (unchanged).
  - PR 1 `public._pricing_price_has_open_extras(uuid) → boolean`, called by `internal_price_transition_guard` (unchanged).
  - Task 3: `pricing_file_inputs.is_cinema`, `pricing_extras_catalog.suggest_if_cinema`, `public.pricing_file_set_inputs(uuid, jsonb)`.
- Produces:
  - `pricing_file_extras.boq_revision_id uuid NOT NULL` (the round), filled from the file's revision on insert when not given. The unique index becomes `(file_id, boq_revision_id, catalog_id)`.
  - `public.pricing_suggest_extras(_file_id uuid) → integer` (same signature).
    - It locks the file.
    - It suggests per round: old rounds' decisions do not suppress a new round's suggestion.
    - It drops undecided suggestions of older rounds.
    - It suggests `suggest_if_cinema` items when the file's `is_cinema` is set, and drops those undecided suggestions when it is unset.
  - `public._pricing_price_has_open_extras(_internal_price_id uuid) → boolean`: VOLATILE, locks the file row (after the price row, the PR 1 lock order), and counts the current round only.
  - `public.pricing_file_open_suggestions(_file_id uuid) → integer`: current round only.
  - `public.pricing_add_extra(_file_id uuid, _catalog_id uuid, _quantity numeric, _rate numeric DEFAULT NULL) → jsonb` (the extra row, `status = 'accepted'`).
    - Pricer or GM, while the file is `supplier_priced` or `selling_build`.
    - Adding an item already suggested in this round accepts it.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_extras_rounds.test.sql`:

```sql
-- PR 2, part 4: extras belong to a BOQ revision (a round); the suggest/propose
-- race is closed by the file lock; cinema projects suggest acoustic; extras
-- can be added from the catalog. Test user UUIDs use the 6d… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6d000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','er-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,3) n;
update public.profiles set status = 'active' where id::text like '6d000000-%';
insert into public.user_roles (user_id, role) values
  ('6d000000-0000-0000-0000-000000000001','salesperson'),
  ('6d000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6d000000-0000-0000-0000-000000000002','finance_manager'),
  ('6d000000-0000-0000-0000-000000000003','general_manager');
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate, suggest_for, suggest_min_height_m, suggest_if_cinema) values
  ('6d900001-0000-0000-0000-000000000001','er_concrete','Concrete base','قاعدة خرسانية','item',1200, array['pylon']::public.install_type[], null, false),
  ('6d900002-0000-0000-0000-000000000001','er_scaffold','Scaffold','سقالة','lump',800, '{}', 6, false),
  ('6d900003-0000-0000-0000-000000000001','er_acoustic','Acoustic insulation','عزل صوتي','m2',150, '{}', null, true),
  ('6d900004-0000-0000-0000-000000000001','er_crane','Crane','رافعة','lump',2000, '{}', null, false);
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('6d200001-0000-0000-0000-000000000001','er-deal','6d000000-0000-0000-0000-000000000001','6d000000-0000-0000-0000-000000000001','rfq_received');
insert into public.boqs (id, related_opportunity_id, title) values ('6d400001-0000-0000-0000-000000000001','6d200001-0000-0000-0000-000000000001','er-boq');
insert into public.boq_revisions (id, boq_id, revision_number) values ('6d500001-0000-0000-0000-000000000001','6d400001-0000-0000-0000-000000000001',1);
insert into public.boq_lines (revision_id, sign_type, quantity, install_type, mount_height_m) values
  ('6d500001-0000-0000-0000-000000000001','Pylon P1',1,'pylon',null),
  ('6d500001-0000-0000-0000-000000000001','Ceiling C1',2,'ceiling',7);
update public.boq_revisions set frozen_at = now(), frozen_by = '6d000000-0000-0000-0000-000000000002', status = 'verified'
 where id = '6d500001-0000-0000-0000-000000000001';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id)
values ('6d600001-0000-0000-0000-000000000001','6d200001-0000-0000-0000-000000000001','selling_build','6d500001-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_suggest_extras('6d600001-0000-0000-0000-000000000001'), 2, 'Round 1: a base for the pylon, a scaffold for the 7 m ceiling');
select is((select count(*)::int from public.pricing_file_extras where boq_revision_id = '6d500001-0000-0000-0000-000000000001'), 2,
  'Both belong to revision 1');
select lives_ok($$select public.pricing_decide_extra(x.id, x.catalog_id = '6d900001-0000-0000-0000-000000000001', null, null, 'Not needed this time')
                    from public.pricing_file_extras x where x.file_id = '6d600001-0000-0000-0000-000000000001'$$,
  'Round 1 decided: base accepted, scaffold dismissed');

-- A client revision: revision 2 with the same kinds of signs.
reset role;
update public.boq_revisions set is_current = false where id = '6d500001-0000-0000-0000-000000000001';
insert into public.boq_revisions (id, boq_id, revision_number) values ('6d500002-0000-0000-0000-000000000001','6d400001-0000-0000-0000-000000000001',2);
insert into public.boq_lines (revision_id, sign_type, quantity, install_type, mount_height_m) values
  ('6d500002-0000-0000-0000-000000000001','Pylon P1',2,'pylon',null),
  ('6d500002-0000-0000-0000-000000000001','Ceiling C1',2,'ceiling',7);
update public.boq_revisions set frozen_at = now(), frozen_by = '6d000000-0000-0000-0000-000000000002', status = 'verified'
 where id = '6d500002-0000-0000-0000-000000000001';
update public.pricing_files set boq_revision_id = '6d500002-0000-0000-0000-000000000001' where id = '6d600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_suggest_extras('6d600001-0000-0000-0000-000000000001'), 2,
  'Round 2 suggests both again: round 1''s decisions do not suppress them');
select is(public.pricing_file_open_suggestions('6d600001-0000-0000-0000-000000000001'), 2, 'Two open, all in round 2');
select is((select count(*)::int from public.pricing_file_extras where boq_revision_id = '6d500001-0000-0000-0000-000000000001'), 2,
  'Round 1''s decisions are kept as history');

-- The propose check counts the current round only, and locks the file.
reset role;
insert into public.estimations (id, boq_revision_id, cost_total) values ('6d700001-0000-0000-0000-000000000001','6d500002-0000-0000-0000-000000000001',1000);
insert into public.internal_prices (id, estimation_id, proposed_price, status)
values ('6d800001-0000-0000-0000-000000000001','6d700001-0000-0000-0000-000000000001',2000,'internal_price_proposed');
update public.pricing_files set estimation_id = '6d700001-0000-0000-0000-000000000001', internal_price_id = '6d800001-0000-0000-0000-000000000001'
 where id = '6d600001-0000-0000-0000-000000000001';
select ok(public._pricing_price_has_open_extras('6d800001-0000-0000-0000-000000000001'), 'Open suggestions in round 2 block Propose');
update public.pricing_file_extras set status = 'accepted', decided_at = now()
 where boq_revision_id = '6d500002-0000-0000-0000-000000000001';
insert into public.pricing_file_extras (file_id, boq_revision_id, catalog_id, rate)
values ('6d600001-0000-0000-0000-000000000001','6d500001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',2000);
select ok(not public._pricing_price_has_open_extras('6d800001-0000-0000-0000-000000000001'),
  'An undecided suggestion of an older round does not block Propose');
insert into public.pricing_file_extras (file_id, catalog_id, rate, status, decided_at)
values ('6d600001-0000-0000-0000-000000000001','6d900003-0000-0000-0000-000000000001',150,'accepted',now());
select is((select boq_revision_id::text from public.pricing_file_extras
            where file_id = '6d600001-0000-0000-0000-000000000001' and catalog_id = '6d900003-0000-0000-0000-000000000001'),
  '6d500002-0000-0000-0000-000000000001', 'An extra inserted without a round takes the file''s current revision');
delete from public.pricing_file_extras where catalog_id = '6d900003-0000-0000-0000-000000000001';
select is((select provolatile::text from pg_proc where oid = 'public._pricing_price_has_open_extras(uuid)'::regprocedure), 'v',
  'The open-extras check is volatile, so it can take the file lock and see a suggestion committed meanwhile');
select ok(pg_get_functiondef('public._pricing_price_has_open_extras(uuid)'::regprocedure) ~ 'FOR UPDATE',
  'The open-extras check locks the file');
select ok(pg_get_functiondef('public.pricing_suggest_extras(uuid)'::regprocedure) ~ 'FOR UPDATE',
  'Suggesting locks the file');

-- Cinema.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_set_inputs('6d600001-0000-0000-0000-000000000001','{"is_cinema":true}')$$,
  'Zayed marks the project a cinema');
select ok(exists (select 1 from public.pricing_file_extras where catalog_id = '6d900003-0000-0000-0000-000000000001'
                   and status = 'suggested' and source_line_id is null),
  'A cinema suggests acoustic insulation');
select lives_ok($$select public.pricing_file_set_inputs('6d600001-0000-0000-0000-000000000001','{"is_cinema":false}')$$,
  'Zayed unmarks it');
select is((select count(*)::int from public.pricing_file_extras where catalog_id = '6d900003-0000-0000-0000-000000000001'), 0,
  'The undecided acoustic suggestion goes with it');

-- Adding from the catalog.
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',1)$$,
  '42501', null, 'A rep cannot add extras');
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',0)$$,
  '23514', null, 'A quantity of zero is refused');
select is((public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',1))->>'rate',
  '2000.00', 'Kalas adds a crane at the catalog rate');
select is((public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',2,2500))->>'quantity',
  '2.000', 'Adding it again updates the quantity and rate');
reset role;
update public.pricing_files set state = 'boq_frozen' where id = '6d600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',1)$$,
  'P0001', null, 'Extras are added once the supplier has priced');
reset role;
select * from finish();
rollback;
```

Count check: 3 (round 1) + 3 (round 2) + 6 (open check, old round, trigger fill, volatile, two locks) + 4 (cinema) + 5 (add) = 21.

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_extras_rounds.test.sql` FAILS with `column "boq_revision_id" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261104130000_pricing_extras_rounds.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 2, part 4: extras that must not be missed, per round.
--
-- PR 1 deferred items, both closed here:
-- * Suggest-vs-propose race. pricing_suggest_extras could add a suggestion
--   while Kalas's propose was checking for open ones. Both now take the file
--   row lock: suggest directly, the propose check after the price row (the
--   lock order of 20261103140000). The check is VOLATILE so, once it has the
--   lock, its next statement sees a suggestion committed while it waited.
-- * Rounds. A client revision is a new frozen BOQ revision on the same file;
--   its decided extras used to suppress the new round's suggestions for the
--   same item ("one per catalog item per file"). An extra now belongs to the
--   revision it was made for, so each round is suggested and decided afresh,
--   and old rounds stay as history.
-- Also: a cinema project suggests the catalog items marked suggest_if_cinema
-- (spec §3), and Kalas or Zayed can add any catalog item by hand.
-- =============================================================================

ALTER TABLE public.pricing_file_extras
  ADD COLUMN IF NOT EXISTS boq_revision_id uuid REFERENCES public.boq_revisions(id) ON DELETE RESTRICT;
UPDATE public.pricing_file_extras x
   SET boq_revision_id = coalesce(
         (SELECT l.revision_id FROM public.boq_lines l WHERE l.id = x.source_line_id),
         (SELECT f.boq_revision_id FROM public.pricing_files f WHERE f.id = x.file_id))
 WHERE x.boq_revision_id IS NULL;

-- An extra inserted without a round belongs to the file's current revision.
CREATE OR REPLACE FUNCTION public.pricing_file_extras_round()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.boq_revision_id IS NULL THEN
    SELECT f.boq_revision_id INTO NEW.boq_revision_id FROM public.pricing_files f WHERE f.id = NEW.file_id;
  END IF;
  IF NEW.boq_revision_id IS NULL THEN
    RAISE EXCEPTION 'An extra belongs to a BOQ revision; attach one to the file first. | البند الإضافي يتبع إصدار كميات؛ اربط إصداراً بالملف أولاً.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_extras_round() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pricing_file_extras_round ON public.pricing_file_extras;
CREATE TRIGGER pricing_file_extras_round BEFORE INSERT ON public.pricing_file_extras
  FOR EACH ROW EXECUTE FUNCTION public.pricing_file_extras_round();
ALTER TABLE public.pricing_file_extras ALTER COLUMN boq_revision_id SET NOT NULL;

DROP INDEX IF EXISTS public.pricing_file_extras_one_per_item;
CREATE UNIQUE INDEX IF NOT EXISTS pricing_file_extras_one_per_item_per_round
  ON public.pricing_file_extras (file_id, boq_revision_id, catalog_id);

CREATE OR REPLACE FUNCTION public.pricing_suggest_extras(_file_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; n integer; cinema boolean;
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_approve_final_price(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  -- 2026-11-04: the file lock, so a suggestion and Kalas's propose cannot interleave.
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state::text NOT IN ('boq_frozen','at_supplier','supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Extras can only be suggested after the BOQ is frozen and before the price goes to review. | لا يمكن اقتراح البنود الإضافية إلا بعد تجميد الكميات وقبل إرسال السعر للمراجعة.' USING ERRCODE = 'P0001';
  END IF;
  IF f.boq_revision_id IS NULL THEN
    RAISE EXCEPTION 'The file has no BOQ revision yet. | لا يوجد إصدار كميات في الملف بعد.' USING ERRCODE = '23514';
  END IF;
  cinema := coalesce((SELECT i.is_cinema FROM public.pricing_file_inputs i WHERE i.file_id = f.id), false);

  -- Undecided suggestions from an older round no longer block Propose.
  DELETE FROM public.pricing_file_extras x
   WHERE x.file_id = f.id AND x.status = 'suggested' AND x.boq_revision_id <> f.boq_revision_id;
  -- An undecided cinema suggestion goes when the project is no longer a cinema.
  IF NOT cinema THEN
    DELETE FROM public.pricing_file_extras x
     WHERE x.file_id = f.id AND x.status = 'suggested' AND x.source_line_id IS NULL
       AND x.catalog_id IN (SELECT c.id FROM public.pricing_extras_catalog c WHERE c.suggest_if_cinema);
  END IF;

  WITH line_hits AS (
    SELECT DISTINCT ON (c.id) c.id AS catalog_id, c.default_rate, l.id AS line_id
      FROM public.boq_lines l
      JOIN public.pricing_extras_catalog c ON c.active
       AND ((l.install_type IS NOT NULL AND l.install_type = ANY (c.suggest_for))
            OR (c.suggest_min_height_m IS NOT NULL AND coalesce(l.mount_height_m,0) >= c.suggest_min_height_m))
     WHERE l.revision_id = f.boq_revision_id
     ORDER BY c.id, l.line_number NULLS LAST
  ), cinema_hits AS (
    SELECT c.id AS catalog_id, c.default_rate, NULL::uuid AS line_id
      FROM public.pricing_extras_catalog c
     WHERE cinema AND c.active AND c.suggest_if_cinema
  ), hits AS (
    SELECT DISTINCT ON (h.catalog_id) h.catalog_id, h.default_rate, h.line_id
      FROM (SELECT * FROM line_hits UNION ALL SELECT * FROM cinema_hits) h
     ORDER BY h.catalog_id, h.line_id NULLS LAST
  ), ins AS (
    INSERT INTO public.pricing_file_extras (file_id, boq_revision_id, catalog_id, rate, source_line_id)
    SELECT f.id, f.boq_revision_id, h.catalog_id, h.default_rate, h.line_id FROM hits h
    ON CONFLICT (file_id, boq_revision_id, catalog_id) DO NOTHING
    RETURNING 1)
  SELECT count(*)::int INTO n FROM ins;
  IF n > 0 THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
    VALUES (u, 'user', 'pricing_file.extras_suggested', 'opportunity', f.opportunity_id,
            jsonb_build_object('file_id', f.id, 'revision_id', f.boq_revision_id, 'count', n));
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pricing_suggest_extras(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_suggest_extras(uuid) TO authenticated;

-- Called by internal_price_transition_guard while the price row is locked.
CREATE OR REPLACE FUNCTION public._pricing_price_has_open_extras(_internal_price_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files;
BEGIN
  SELECT * INTO f FROM public.pricing_files WHERE internal_price_id = _internal_price_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.pricing_file_extras x
                  WHERE x.file_id = f.id AND x.boq_revision_id = f.boq_revision_id
                    AND x.status = 'suggested');
END $$;
REVOKE ALL ON FUNCTION public._pricing_price_has_open_extras(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_open_suggestions(_file_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_read_commercial_cost(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*)::int FROM public.pricing_file_extras x
            JOIN public.pricing_files f ON f.id = x.file_id
           WHERE x.file_id = _file_id AND x.boq_revision_id = f.boq_revision_id AND x.status = 'suggested');
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_open_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_open_suggestions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_add_extra(_file_id uuid, _catalog_id uuid, _quantity numeric, _rate numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; c public.pricing_extras_catalog; e public.pricing_file_extras;
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_approve_final_price(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 OR (_rate IS NOT NULL AND _rate < 0) THEN
    RAISE EXCEPTION 'Give a quantity above zero and a rate that is not negative. | حدد كمية أكبر من صفر وسعراً غير سالب.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state::text NOT IN ('supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Extras are added after the supplier has priced and before the price goes to review. | تُضاف البنود الإضافية بعد تسعير المورد وقبل إرسال السعر للمراجعة.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM public.pricing_extras_catalog WHERE id = _catalog_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inactive catalog item. | بند الكتالوج غير موجود أو غير مفعّل.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.pricing_file_extras (file_id, boq_revision_id, catalog_id, quantity, rate, status, decided_by, decided_at)
  VALUES (f.id, f.boq_revision_id, c.id, _quantity, coalesce(_rate, c.default_rate), 'accepted', u, now())
  ON CONFLICT (file_id, boq_revision_id, catalog_id) DO UPDATE
     SET status = 'accepted', quantity = EXCLUDED.quantity, rate = EXCLUDED.rate,
         dismiss_reason = NULL, decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at
  RETURNING * INTO e;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.extra_added', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'extra_id', e.id, 'catalog_id', c.id,
                             'quantity', e.quantity, 'rate', e.rate));
  RETURN to_jsonb(e);
END $$;
REVOKE ALL ON FUNCTION public.pricing_add_extra(uuid, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_add_extra(uuid, uuid, numeric, numeric) TO authenticated;
```

- [ ] **Step 4: Update the one PR 1 assertion that pinned the old behaviour**

In `supabase/tests/pricing_calc.test.sql`, the file moves to a new revision with a single 7 m ceiling line. PR 1 expected the earlier round's decided scaffold to suppress a new suggestion; that was the deferred bug. Replace this line:

```sql
select is(public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001'), 0, 'Re-suggesting on the new revision adds nothing new');
```

with:

```sql
-- 2026-11-04 (PR 2): a new revision is a new round, so the 7 m ceiling suggests the scaffold again.
select is(public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001'), 1, 'A new revision is a new round: the scaffold is suggested again');
```

The plan count does not change. The next assertions still hold: the pylon's undecided round 1 suggestion is gone, the decided round 1 scaffold stays, and the GM's suggest adds nothing.

- [ ] **Step 5: Run the DB suite and confirm it passes**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_extras_rounds.test.sql .. ok`. `pricing_calc.test.sql .. ok` and `pricing_gm_sets_zayed_reviews.test.sql .. ok`: their fixture extras get the file's revision from the new trigger.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261104130000_pricing_extras_rounds.sql supabase/tests/pricing_extras_rounds.test.sql supabase/tests/pricing_calc.test.sql
git commit -m "feat(pricing): extras per round, file lock against the propose race, cinema suggestion, add from catalog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Per-line choices and the selling grid (SQL)

**Files:**
- Create: `supabase/migrations/20261104140000_pricing_selling_grid.sql`
- Test: `supabase/tests/pricing_selling_grid.test.sql`

**Interfaces:**
- Consumes:
  - PR 1: `public.pricing_installation_cost(_type install_type, _weight_kg numeric, _mount_height_m numeric, _floor_cut boolean, _on date DEFAULT current_date) → numeric` (NULL = no rate), `boq_lines` attributes, `supplier_quote_lines.unit_cost_with_screen`, `supplier_quote_lines.alternate_spec`.
  - Task 3: `logistics_rates` keys `container_rate, customs_pct, clearing_fee, delivery_jeddah, delivery_riyadh, install_fallback_pct, default_margin_pct`; `pricing_file_inputs`.
  - Task 4: `pricing_file_extras.boq_revision_id`.
  - Phase 8: `public.current_margin_floor() → numeric`.
- Produces:
  - Table `public.pricing_file_lines(file_id, boq_line_id, use_screen_price boolean NULL, install_type install_type NULL, margin_pct numeric(5,2) NULL, selling_price numeric(16,2) NULL, built_cost numeric(16,2), built_selling_price numeric(16,2), built_at timestamptz, updated_by, updated_at)`, PK `(file_id, boq_line_id)`, at most one of `margin_pct`/`selling_price`. `use_screen_price` NULL means "follow the line's `has_screen`". `built_*` are written by Task 6.
  - `public.pricing_file_set_line(_file_id uuid, _boq_line_id uuid, _choice jsonb) → jsonb` (the row).
    - Keys `use_screen_price` (bool|null) and `install_type` (text|null) are for a pricer or the GM in `supplier_priced`/`selling_build`.
    - Keys `margin_pct` (number|null) and `selling_price` (number|null) are for the GM in `selling_build`.
    - Setting one of `margin_pct`/`selling_price` to a number clears the other.
  - View `public.pricing_selling_grid`, one row per line of the file's revision. Columns: `file_id, boq_line_id, line_number, sign_type, description, quantity, unit, has_screen, supplier_quote_line_id, unit_cost, unit_cost_with_screen, alternate_spec, quotes_count, use_screen_price, install_type, install_basis ('rate'|'fallback'), materials, installation, extras_alloc, logistics_alloc, line_cost, line_margin_pct, typed_selling_price, default_margin_pct, overhead_pct, selling_price, margin_pct, extras_total, logistics_total, built_cost, built_selling_price, unpriced, screen_price_missing`.
  - View `public.pricing_selling_totals`, one row per file. Columns: `file_id, line_count, unpriced_lines, multi_quote_lines, screen_price_missing_lines, materials_total, installation_total, extras_total, logistics_total, overhead_pct, total_cost, total_selling, margin_value, margin_pct, floor_pct, below_floor`.
  - Both views: cost readers who can read the file only. Everyone else gets no rows.

**The arithmetic (Task 7 mirrors it; its contract test pins these lines):**
- materials = unit × quantity, where unit = the with-screen price if `use_screen_price` (default: the line's `has_screen`) and one exists, else the normal price. The supplier line is from the latest current, non-cancelled quote on the revision.
- installation = `pricing_installation_cost(type) × quantity`, where type = the line override or the line's own. If there is no rate: `materials × install_fallback_pct / 100` (`install_basis = 'fallback'`).
- extras_total = Σ accepted extras of the current round (quantity × rate). logistics_total = containers × container_rate + goods × customs_pct / 100 + (clearing ? clearing_fee : 0) + (delivery jeddah/riyadh fee). Goods = Σ materials.
- share = (materials + installation) / Σ(materials + installation), or 1 / line count when the total is 0. extras_alloc = share × extras_total. logistics_alloc = share × logistics_total.
- line_cost = (materials + installation + extras_alloc + logistics_alloc) × (1 + overhead_pct / 100).
- selling = the typed selling price, else `round(line_cost / (1 − margin / 100), 2)` with margin = the line's margin, else the file's default, else `default_margin_pct`.
- total_cost = `round(subtotal + subtotal × overhead_pct / 100, 2)` with subtotal = materials_total + extras_total + logistics_total + installation_total. This is the same expression as Phase 8 `estimation_cost_basis` when Task 6 writes `cost_total = materials + extras + logistics`, `installation_cost = installation`, `wastage_pct = 0`. margin_pct = `round((selling − cost) / selling × 100, 2)`, the same as `internal_price_compute_margin`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_selling_grid.test.sql`:

```sql
-- PR 2, part 5: per-line choices and the cost-gated selling grid.
-- Worked example: 2 lines, 1 container to Riyadh with clearing, one accepted extra.
--   L1 pylon x2 at 5000, pylon rate 1000      -> materials 10000, installation 2000
--   L2 ceiling x4 with screen at 1500 (1000)  -> materials 6000, installation 10% = 600
--   extras 3000; logistics 12000 + 5% x 16000 + 500 + 5000 = 18300; overhead 0
--   L1 cost 25741.94 -> at 25%: 34322.58; L2 cost 14158.06 -> 18877.42
--   total cost 39900.00, total selling 53200.00, margin 25.00
-- Test user UUIDs use the 6e… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6e000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','sg-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,5) n;
update public.profiles set status = 'active' where id::text like '6e000000-%';
insert into public.user_roles (user_id, role) values
  ('6e000000-0000-0000-0000-000000000001','salesperson'),
  ('6e000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6e000000-0000-0000-0000-000000000002','finance_manager'),
  ('6e000000-0000-0000-0000-000000000003','general_manager'),
  ('6e000000-0000-0000-0000-000000000004','bd_manager'),
  ('6e000000-0000-0000-0000-000000000005','sales_manager');

update public.logistics_rates set value = 12000 where key = 'container_rate';
update public.logistics_rates set value = 5     where key = 'customs_pct';
update public.logistics_rates set value = 500   where key = 'clearing_fee';
update public.logistics_rates set value = 2000  where key = 'delivery_jeddah';
update public.logistics_rates set value = 5000  where key = 'delivery_riyadh';
update public.logistics_rates set value = 10    where key = 'install_fallback_pct';
update public.logistics_rates set value = 25    where key = 'default_margin_pct';
insert into public.installation_rates (install_type, base_rate, effective_from) values ('pylon', 1000, current_date - 1);
insert into public.vendors (id, name) values ('6e100000-0000-0000-0000-000000000001','sg-vendor');

insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'sg-deal-' || n,
       '6e000000-0000-0000-0000-000000000001','6e000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title) values
  ('6e400001-0000-0000-0000-000000000001','6e200001-0000-0000-0000-000000000001','sg-boq-1'),
  ('6e400002-0000-0000-0000-000000000001','6e200002-0000-0000-0000-000000000001','sg-boq-2');
insert into public.boq_revisions (id, boq_id, revision_number) values
  ('6e500001-0000-0000-0000-000000000001','6e400001-0000-0000-0000-000000000001',1),
  ('6e500002-0000-0000-0000-000000000001','6e400002-0000-0000-0000-000000000001',1);
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, install_type, has_screen, mount_height_m) values
  ('6e510001-0000-0000-0000-000000000001','6e500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'pylon',false,null),
  ('6e510002-0000-0000-0000-000000000001','6e500001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'ceiling',true,3),
  ('6e510003-0000-0000-0000-000000000001','6e500002-0000-0000-0000-000000000001',1,'Wall W1',1,null,false,null);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status)
values ('6e520001-0000-0000-0000-000000000001','6e500001-0000-0000-0000-000000000001','6e100000-0000-0000-0000-000000000001','SAR','responses_received');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen) values
  ('6e520001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001',5000,2,10000,null),
  ('6e520001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001',1000,4,4000,1500);
update public.boq_revisions set frozen_at = now(), frozen_by = '6e000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('6e500001-0000-0000-0000-000000000001','6e500002-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('6e600001-0000-0000-0000-000000000001','6e200001-0000-0000-0000-000000000001','supplier_priced','6e500001-0000-0000-0000-000000000001'),
  ('6e600002-0000-0000-0000-000000000001','6e200002-0000-0000-0000-000000000001','supplier_priced','6e500002-0000-0000-0000-000000000001');
insert into public.pricing_file_inputs (file_id, containers, delivery, clearing, overhead_pct)
values ('6e600001-0000-0000-0000-000000000001', 1, 'riyadh', true, 0);
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate)
values ('6e900001-0000-0000-0000-000000000001','sg_crane','Crane','رافعة','lump',3000);
insert into public.pricing_file_extras (file_id, catalog_id, quantity, rate, status, decided_at)
values ('6e600001-0000-0000-0000-000000000001','6e900001-0000-0000-0000-000000000001',1,3000,'accepted',now());

-- ===== Cost isolation =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_selling_grid), 0, 'The deal''s own rep reads no grid');
select is((select count(*)::int from public.pricing_selling_totals), 0, 'The rep reads no totals');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_selling_grid), 0, 'The BD manager reads no grid');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_selling_grid where file_id = '6e600001-0000-0000-0000-000000000001'), 2,
  'The sales manager reads the grid');

-- ===== The worked example, as Zayed =====
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select materials from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 10000.00::numeric, 'L1 materials');
select is((select installation from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 2000.00::numeric, 'L1 installation from the pylon rate');
select is((select install_basis from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 'rate', 'L1 basis is the rate card');
select is((select materials from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 6000.00::numeric, 'L2 takes the screen price, as its drawing has a screen');
select is((select installation from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 600.00::numeric, 'L2 installation falls back to 10% (no ceiling rate)');
select is((select install_basis from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 'fallback', 'L2 basis is the fallback');
select is((select extras_alloc from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 1935.48::numeric, 'L1 carries its share of the extras');
select is((select logistics_alloc from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 11806.45::numeric, 'L1 carries its share of logistics');
select is((select line_cost from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 25741.94::numeric, 'L1 cost');
select is((select selling_price from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 34322.58::numeric, 'L1 sells at the default 25% margin on price');
select is((select selling_price from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 18877.42::numeric, 'L2 selling');
select is((select total_cost from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 39900.00::numeric, 'Total cost');
select is((select total_selling from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 53200.00::numeric, 'Total selling');
select is((select margin_pct from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 25.00::numeric, 'Margin on price');
select is((select logistics_total from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 18300.00::numeric, 'Logistics total');
select is((select unpriced_lines from public.pricing_selling_totals where file_id = '6e600002-0000-0000-0000-000000000001'), 1, 'A line with no supplier price is counted unpriced');

-- ===== Line choices =====
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"use_screen_price":true}')$$,
  '42501', null, 'A rep cannot set line choices');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  '42501', null, 'Zayed cannot set a margin: the GM sets the selling price');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"use_screen_price":false}')$$,
  'Zayed picks the normal price for L2');
select is((select materials from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 4000.00::numeric, 'L2 now uses the normal price');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"use_screen_price":null}')$$,
  'Zayed goes back to the default');
select is((select materials from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 6000.00::numeric, 'L2 follows its drawing again');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"install_type":"pylon"}')$$,
  'Zayed overrides L2''s install type');
select is((select installation from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 4000.00::numeric, 'The override uses the pylon rate');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"install_type":null}')$$,
  'Zayed clears the override');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  'P0001', null, 'Margins are set in the selling build');
reset role;
update public.pricing_files set state = 'selling_build' where id = '6e600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  'Kalas sets 30% on L1');
select is((select selling_price from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 36774.19::numeric, 'L1 at 30%');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"selling_price":20000}')$$,
  'Kalas types a selling price for L2');
select is((select total_selling from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 56774.19::numeric, 'Totals follow');
select is((select margin_pct from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 29.72::numeric, 'The margin is computed, never typed');
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"margin_pct":30,"selling_price":1}')$$,
  '23514', null, 'A margin and a selling price on one line are refused');
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510003-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  '23514', null, 'A line of another BOQ is refused');
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"install_type":"roof"}')$$,
  '23514', null, 'An unknown install type is refused');
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"discount":5}')$$,
  '23514', null, 'An unknown key is refused');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_file_lines), 0, 'The rep reads no line choices');
select is((select count(*)::int from public.pricing_file_inputs), 0, 'The rep reads no inputs');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_file_lines), 0, 'The BD manager reads no line choices');
select is((select count(*)::int from public.pricing_file_inputs), 0, 'The BD manager reads no inputs');
select is((select count(*)::int from public.pricing_selling_totals), 0, 'The BD manager reads no totals');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select ok((select count(*)::int from public.pricing_file_lines where file_id = '6e600001-0000-0000-0000-000000000001') > 0,
  'The sales manager (management) reads the line choices');

-- ===== The floor =====
reset role;
insert into public.margin_policies (min_margin_pct, effective_from, rationale) values (30, now() - interval '1 day', 'sg-floor');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select floor_pct from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 30.00::numeric, 'The floor in force');
select ok((select below_floor from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), '29.72% is below a 30% floor');
reset role;
select * from finish();
rollback;
```

Count check: 4 isolation + 16 example + 10 line choices (2 refusals, 3 set/check pairs, clear, Kalas too early) + 9 Kalas (30%, check, typed, totals, margin, 4 refusals) + 6 reads (rep 2, BD manager 3, sales manager 1) + 2 floor = 47.

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_selling_grid.test.sql` FAILS with `relation "public.pricing_selling_grid" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261104140000_pricing_selling_grid.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 2, part 5: the selling grid (spec §3).
--
-- One row per BOQ line: materials from the supplier (normal or with-screen),
-- installation from the rate card (or the % fallback), the project's extras
-- and logistics spread over the lines by value, overhead, then the selling
-- price from a margin ON PRICE (Phase 8's convention) or a typed price. A
-- totals row per file computes cost exactly as Phase 8's estimation_cost_basis
-- will from the estimation pricing_file_build_price writes (next migration),
-- so the margin Kalas sees is the margin the price will carry.
--
-- Who sets what (Mo, 2026-11-03: Kalas sets the price, Zayed reviews it):
--   cost choices (screen or normal price, install-type override): a pricer or the GM;
--   selling choices (margin %, typed selling price): the GM alone.
-- Both views run as the owner and gate on cost access in their WHERE, like
-- boq_line_costs and supplier_quote_costs. Reps and the BD manager get no rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pricing_file_lines (
  file_id             uuid NOT NULL REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  boq_line_id         uuid NOT NULL REFERENCES public.boq_lines(id) ON DELETE RESTRICT,
  use_screen_price    boolean,
  install_type        public.install_type,
  margin_pct          numeric(5,2) CHECK (margin_pct IS NULL OR (margin_pct > -100 AND margin_pct < 100)),
  selling_price       numeric(16,2) CHECK (selling_price IS NULL OR selling_price >= 0),
  built_cost          numeric(16,2),
  built_selling_price numeric(16,2),
  built_at            timestamptz,
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, boq_line_id),
  CONSTRAINT pricing_file_lines_one_selling_rule CHECK (margin_pct IS NULL OR selling_price IS NULL)
);
COMMENT ON COLUMN public.pricing_file_lines.use_screen_price IS
  'NULL follows boq_lines.has_screen. Zayed picks the normal or with-screen supplier price when both exist (spec §3).';
COMMENT ON COLUMN public.pricing_file_lines.built_selling_price IS
  'The line''s selling price when the GM last built the price (pricing_file_build_price): the per-line figures behind the internal price, for the quotation (PR 4).';
ALTER TABLE public.pricing_file_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_file_lines FROM anon, authenticated;
GRANT SELECT ON public.pricing_file_lines TO authenticated;
GRANT ALL ON public.pricing_file_lines TO service_role;
DROP POLICY IF EXISTS "Cost holders read file lines" ON public.pricing_file_lines;
CREATE POLICY "Cost holders read file lines" ON public.pricing_file_lines FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid()))
         AND EXISTS (SELECT 1 FROM public.pricing_files f WHERE f.id = file_id
                      AND (public.is_pricer((SELECT auth.uid())) OR public.can_read_boq(f.opportunity_id, (SELECT auth.uid())))));
DROP POLICY IF EXISTS audit_session_boundary ON public.pricing_file_lines;
CREATE POLICY audit_session_boundary ON public.pricing_file_lines AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

CREATE OR REPLACE FUNCTION public.pricing_file_set_line(_file_id uuid, _boq_line_id uuid, _choice jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; l public.pricing_file_lines; k text;
        selling_keys boolean;
BEGIN
  IF NOT (public.is_pricer(u) OR public.can_approve_final_price(u)) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  IF _choice IS NULL OR jsonb_typeof(_choice) <> 'object' THEN
    RAISE EXCEPTION 'A line choice is an object. | اختيار البند كائن.' USING ERRCODE = '23514';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_choice) LOOP
    IF k NOT IN ('use_screen_price','install_type','margin_pct','selling_price') THEN
      RAISE EXCEPTION 'Unknown line choice %. | اختيار غير معروف: %.', k, k USING ERRCODE = '23514';
    END IF;
  END LOOP;
  selling_keys := _choice ? 'margin_pct' OR _choice ? 'selling_price';
  IF selling_keys AND NOT public.can_approve_final_price(u) THEN
    RAISE EXCEPTION 'The GM sets margins and selling prices. | الهوامش وأسعار البيع يضعها المدير العام.' USING ERRCODE = '42501';
  END IF;
  IF (_choice ? 'use_screen_price' AND jsonb_typeof(_choice->'use_screen_price') NOT IN ('boolean','null'))
     OR (_choice ? 'margin_pct' AND jsonb_typeof(_choice->'margin_pct') NOT IN ('number','null'))
     OR (_choice ? 'selling_price' AND jsonb_typeof(_choice->'selling_price') NOT IN ('number','null'))
     OR (_choice ? 'install_type' AND jsonb_typeof(_choice->'install_type') NOT IN ('string','null'))
     OR (nullif(_choice->>'install_type','') IS NOT NULL
         AND NOT ((_choice->>'install_type') = ANY (enum_range(NULL::public.install_type)::text[]))) THEN
    RAISE EXCEPTION 'A line choice has the wrong type. | نوع أحد اختيارات البند غير صحيح.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state::text NOT IN ('supplier_priced','selling_build') THEN
    RAISE EXCEPTION 'Line choices are made after the supplier has priced and before review. | تُضبط اختيارات البنود بعد تسعير المورد وقبل المراجعة.' USING ERRCODE = 'P0001';
  END IF;
  IF selling_keys AND f.state <> 'selling_build' THEN
    RAISE EXCEPTION 'Margins are set in the selling build. | تُضبط الهوامش في مرحلة بناء سعر البيع.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.boq_lines bl WHERE bl.id = _boq_line_id AND bl.revision_id = f.boq_revision_id) THEN
    RAISE EXCEPTION 'That line is not in this file''s BOQ. | هذا البند ليس في كميات هذا الملف.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.pricing_file_lines (file_id, boq_line_id, updated_by) VALUES (f.id, _boq_line_id, u)
  ON CONFLICT (file_id, boq_line_id) DO NOTHING;
  UPDATE public.pricing_file_lines SET
    use_screen_price = CASE WHEN _choice ? 'use_screen_price' THEN (_choice->>'use_screen_price')::boolean ELSE use_screen_price END,
    install_type     = CASE WHEN _choice ? 'install_type' THEN (nullif(_choice->>'install_type',''))::public.install_type ELSE install_type END,
    margin_pct       = CASE WHEN _choice ? 'margin_pct' THEN (_choice->>'margin_pct')::numeric
                            WHEN _choice ? 'selling_price' AND _choice->>'selling_price' IS NOT NULL THEN NULL
                            ELSE margin_pct END,
    selling_price    = CASE WHEN _choice ? 'selling_price' THEN (_choice->>'selling_price')::numeric
                            WHEN _choice ? 'margin_pct' AND _choice->>'margin_pct' IS NOT NULL THEN NULL
                            ELSE selling_price END,
    updated_by = u, updated_at = now()
   WHERE file_id = f.id AND boq_line_id = _boq_line_id
  RETURNING * INTO l;
  RETURN to_jsonb(l);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_set_line(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_set_line(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE VIEW public.pricing_selling_grid AS
WITH base AS (
  SELECT f.id AS file_id, f.boq_revision_id,
         bl.id AS boq_line_id, bl.line_number, bl.sign_type, bl.description, bl.quantity, bl.unit, bl.has_screen,
         sq.id AS supplier_quote_line_id, sq.unit_cost, sq.unit_cost_with_screen, sq.alternate_spec,
         coalesce(sq.quotes_count, 0)::int AS quotes_count,
         coalesce(pl.use_screen_price, bl.has_screen) AS use_screen_price,
         coalesce(pl.install_type, bl.install_type) AS install_type,
         pl.margin_pct AS line_margin_pct,
         pl.selling_price AS typed_selling_price,
         pl.built_cost, pl.built_selling_price,
         coalesce(i.overhead_pct, 0) AS overhead_pct,
         coalesce(i.default_margin_pct, s.default_margin_pct, 0) AS default_margin_pct,
         coalesce(s.fallback_pct, 0) AS fallback_pct,
         CASE WHEN sq.id IS NULL THEN NULL
              WHEN coalesce(pl.use_screen_price, bl.has_screen) AND sq.unit_cost_with_screen IS NOT NULL
                THEN sq.unit_cost_with_screen
              ELSE sq.unit_cost END AS unit_material,
         public.pricing_installation_cost(coalesce(pl.install_type, bl.install_type), bl.weight_kg,
                                          bl.mount_height_m, bl.needs_floor_cut) AS unit_install
    FROM public.pricing_files f
    JOIN public.boq_lines bl ON bl.revision_id = f.boq_revision_id
    LEFT JOIN public.pricing_file_lines pl ON pl.file_id = f.id AND pl.boq_line_id = bl.id
    LEFT JOIN public.pricing_file_inputs i ON i.file_id = f.id
    CROSS JOIN LATERAL (
      SELECT (SELECT r.value FROM public.logistics_rates r WHERE r.key = 'install_fallback_pct') AS fallback_pct,
             (SELECT r.value FROM public.logistics_rates r WHERE r.key = 'default_margin_pct') AS default_margin_pct) s
    LEFT JOIN LATERAL (
      SELECT l.id, l.unit_cost, l.unit_cost_with_screen, l.alternate_spec, count(*) OVER () AS quotes_count
        FROM public.supplier_quote_lines l
        JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
       WHERE l.boq_line_id = bl.id AND q.boq_revision_id = f.boq_revision_id
         AND q.is_current AND q.status NOT IN ('cancelled','superseded')
       ORDER BY q.created_at DESC, l.created_at DESC
       LIMIT 1) sq ON TRUE
   WHERE public.can_read_commercial_cost((SELECT auth.uid()))
     AND (public.is_pricer((SELECT auth.uid())) OR public.can_read_boq(f.opportunity_id, (SELECT auth.uid())))
), priced AS (
  SELECT b.*,
         round(b.unit_material * b.quantity, 2) AS materials,
         round(CASE WHEN b.unit_install IS NOT NULL THEN b.unit_install * b.quantity
                    ELSE coalesce(b.unit_material, 0) * b.quantity * b.fallback_pct / 100 END, 2) AS installation,
         CASE WHEN b.unit_install IS NOT NULL THEN 'rate' ELSE 'fallback' END AS install_basis
    FROM base b
), spread AS (
  SELECT p.*,
         sum(coalesce(p.materials, 0) + p.installation) OVER w AS value_total,
         sum(coalesce(p.materials, 0)) OVER w AS goods_total,
         count(*) OVER w AS line_count
    FROM priced p
  WINDOW w AS (PARTITION BY p.file_id)
), costed AS (
  SELECT s.*, ex.extras_total, lg.logistics_total,
         CASE WHEN s.value_total > 0 THEN (coalesce(s.materials, 0) + s.installation) / s.value_total
              ELSE 1.0 / s.line_count END AS share
    FROM spread s
    CROSS JOIN LATERAL (
      SELECT round(coalesce(sum(x.quantity * x.rate), 0), 2) AS extras_total
        FROM public.pricing_file_extras x
       WHERE x.file_id = s.file_id AND x.boq_revision_id = s.boq_revision_id AND x.status = 'accepted') ex
    CROSS JOIN LATERAL (
      SELECT round(coalesce(fi.containers, 0) * coalesce(r.container_rate, 0)
                   + s.goods_total * coalesce(r.customs_pct, 0) / 100
                   + CASE WHEN coalesce(fi.clearing, false) THEN coalesce(r.clearing_fee, 0) ELSE 0 END
                   + CASE coalesce(fi.delivery, 'none')
                       WHEN 'jeddah' THEN coalesce(r.delivery_jeddah, 0)
                       WHEN 'riyadh' THEN coalesce(r.delivery_riyadh, 0)
                       ELSE 0 END, 2) AS logistics_total
        FROM (SELECT max(lr.value) FILTER (WHERE lr.key = 'container_rate')  AS container_rate,
                     max(lr.value) FILTER (WHERE lr.key = 'customs_pct')     AS customs_pct,
                     max(lr.value) FILTER (WHERE lr.key = 'clearing_fee')    AS clearing_fee,
                     max(lr.value) FILTER (WHERE lr.key = 'delivery_jeddah') AS delivery_jeddah,
                     max(lr.value) FILTER (WHERE lr.key = 'delivery_riyadh') AS delivery_riyadh
                FROM public.logistics_rates lr) r
        LEFT JOIN public.pricing_file_inputs fi ON fi.file_id = s.file_id) lg
)
SELECT c.file_id, c.boq_line_id, c.line_number, c.sign_type, c.description, c.quantity, c.unit, c.has_screen,
       c.supplier_quote_line_id, c.unit_cost, c.unit_cost_with_screen, c.alternate_spec, c.quotes_count,
       c.use_screen_price, c.install_type, c.install_basis,
       c.materials, c.installation,
       round(c.share * c.extras_total, 2) AS extras_alloc,
       round(c.share * c.logistics_total, 2) AS logistics_alloc,
       round(lc.line_cost, 2) AS line_cost,
       c.line_margin_pct, c.typed_selling_price, c.default_margin_pct, c.overhead_pct,
       sp.selling_price,
       CASE WHEN sp.selling_price > 0 THEN round((sp.selling_price - lc.line_cost) / sp.selling_price * 100, 2) END AS margin_pct,
       c.extras_total, c.logistics_total,
       c.built_cost, c.built_selling_price,
       (c.unit_material IS NULL) AS unpriced,
       (c.use_screen_price AND c.unit_cost_with_screen IS NULL AND c.supplier_quote_line_id IS NOT NULL) AS screen_price_missing
  FROM costed c
  CROSS JOIN LATERAL (
    SELECT (coalesce(c.materials, 0) + c.installation + c.share * c.extras_total + c.share * c.logistics_total)
           * (1 + c.overhead_pct / 100) AS line_cost) lc
  CROSS JOIN LATERAL (
    SELECT CASE WHEN c.typed_selling_price IS NOT NULL THEN c.typed_selling_price
                WHEN c.unit_material IS NULL THEN NULL
                ELSE round(lc.line_cost / (1 - coalesce(c.line_margin_pct, c.default_margin_pct) / 100), 2)
           END AS selling_price) sp;
REVOKE ALL ON public.pricing_selling_grid FROM anon, authenticated;
GRANT SELECT ON public.pricing_selling_grid TO authenticated;
COMMENT ON VIEW public.pricing_selling_grid IS
  'Selling price per BOQ line of a pricing file. Cost: cost readers who can read the file only. Margin on price. EXCLUDING VAT.';

CREATE OR REPLACE VIEW public.pricing_selling_totals AS
SELECT a.file_id, a.line_count, a.unpriced_lines, a.multi_quote_lines, a.screen_price_missing_lines,
       a.materials_total, a.installation_total, a.extras_total, a.logistics_total, a.overhead_pct,
       c.total_cost, a.total_selling,
       a.total_selling - c.total_cost AS margin_value,
       m.margin_pct,
       public.current_margin_floor() AS floor_pct,
       coalesce(m.margin_pct < public.current_margin_floor(), false) AS below_floor
  FROM (
    SELECT g.file_id,
           count(*)::int AS line_count,
           (count(*) FILTER (WHERE g.unpriced))::int AS unpriced_lines,
           (count(*) FILTER (WHERE g.quotes_count > 1))::int AS multi_quote_lines,
           (count(*) FILTER (WHERE g.screen_price_missing))::int AS screen_price_missing_lines,
           sum(coalesce(g.materials, 0)) AS materials_total,
           sum(g.installation) AS installation_total,
           max(g.extras_total) AS extras_total,
           max(g.logistics_total) AS logistics_total,
           max(g.overhead_pct) AS overhead_pct,
           sum(g.selling_price) AS total_selling
      FROM public.pricing_selling_grid g
     GROUP BY g.file_id) a
  CROSS JOIN LATERAL (
    SELECT a.materials_total + a.extras_total + a.logistics_total + a.installation_total AS subtotal) s
  CROSS JOIN LATERAL (
    SELECT round(s.subtotal + s.subtotal * a.overhead_pct / 100, 2) AS total_cost) c
  CROSS JOIN LATERAL (
    SELECT CASE WHEN a.total_selling > 0
                THEN round((a.total_selling - c.total_cost) / a.total_selling * 100, 2) END AS margin_pct) m;
REVOKE ALL ON public.pricing_selling_totals FROM anon, authenticated;
GRANT SELECT ON public.pricing_selling_totals TO authenticated;
COMMENT ON VIEW public.pricing_selling_totals IS
  'Totals of pricing_selling_grid per file. total_cost uses estimation_cost_basis''s expression on the estimation pricing_file_build_price writes. Cost-gated through the grid.';
```

- [ ] **Step 4: Run the DB suite and confirm it passes**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_selling_grid.test.sql .. ok` (47 tests).

If a money figure is off by 0.01, do not adjust the expected value until you have recomputed it by hand from the header comment. The rounding points are fixed by the contract test in Task 7: materials and installation are rounded per line, and allocations and line cost are rounded for display only.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104140000_pricing_selling_grid.sql supabase/tests/pricing_selling_grid.test.sql
git commit -m "feat(pricing): per-line choices and the cost-gated selling grid with totals" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Build the price and propose it (SQL)

**Files:**
- Create: `supabase/migrations/20261104150000_pricing_build_price.sql`
- Test: `supabase/tests/pricing_build_price.test.sql`

**Interfaces:**
- Consumes:
  - Task 1: `public._pricing_file_link_price(_file_id uuid, _estimation_id uuid, _price_id uuid) → public.pricing_files`; trigger `estimations_frozen_under_review`.
  - Task 5: views `public.pricing_selling_totals` (`line_count, unpriced_lines, multi_quote_lines, materials_total, installation_total, extras_total, logistics_total, overhead_pct, total_cost, total_selling, margin_pct, floor_pct, below_floor`) and `public.pricing_selling_grid` (`boq_line_id, line_cost, selling_price`); table `pricing_file_lines.built_*`.
  - PR 1/Phase 8 triggers on `internal_prices`: `internal_price_compute_margin` (margin from `estimation_cost_basis`), `internal_price_transition_guard` (in-file propose = GM, from `selling_build`, no open extras), `internal_price_floor_guard` (below floor needs `below_floor_justification`), and `pricing_file_follow_price` (file follows to `price_review`).
- Produces:
  - `public.pricing_file_build_price(_file_id uuid) → jsonb` `{"internal_price_id", "estimation_id", "total_cost", "total_selling", "margin_pct", "floor_pct", "below_floor"}`. Callers: the GM (who must also read cost), in `selling_build`.
    - It refuses unpriced lines, more than one supplier on a line, supplier lines already marked selected on the revision, and a total of zero.
    - It writes or updates the estimation: `cost_total = materials + extras + logistics`, `installation_cost`, `wastage_pct = 0`, `overhead_pct`.
    - It inserts or updates the file's internal price at `internal_price_proposed`, and never any other status.
    - It links both through `_pricing_file_link_price` and snapshots each line's cost and selling price in `pricing_file_lines.built_*`.
  - `public.pricing_file_propose(_file_id uuid, _expected_total numeric, _expected_total_cost numeric, _justification text DEFAULT NULL) → jsonb` (the file row, now `price_review`).
    - It rebuilds, and refuses (P0001) if the total is not `_expected_total` or the total cost is not `_expected_total_cost`.
    - It then moves the price `internal_price_proposed → gm_pending` through the existing path, carrying `_justification` into `below_floor_justification`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_build_price.test.sql`:

```sql
-- PR 2, part 6: Kalas builds the price from the grid and proposes it; Phase 8's
-- margin and floor rules apply unchanged; Zayed can return and approve it.
-- Same worked example as pricing_selling_grid: cost 39900.00, selling 53200.00 at 25%.
-- Test user UUIDs use the 6f… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6f000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','bp-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,3) n;
update public.profiles set status = 'active' where id::text like '6f000000-%';
insert into public.user_roles (user_id, role) values
  ('6f000000-0000-0000-0000-000000000001','salesperson'),
  ('6f000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6f000000-0000-0000-0000-000000000002','finance_manager'),
  ('6f000000-0000-0000-0000-000000000003','general_manager');

update public.logistics_rates set value = 12000 where key = 'container_rate';
update public.logistics_rates set value = 5     where key = 'customs_pct';
update public.logistics_rates set value = 500   where key = 'clearing_fee';
update public.logistics_rates set value = 5000  where key = 'delivery_riyadh';
update public.logistics_rates set value = 10    where key = 'install_fallback_pct';
update public.logistics_rates set value = 25    where key = 'default_margin_pct';
insert into public.installation_rates (install_type, base_rate, effective_from) values ('pylon', 1000, current_date - 1);
insert into public.vendors (id, name) values ('6f100000-0000-0000-0000-000000000001','bp-vendor');

-- Deal 1: the worked example. Deal 2: a supplier line already selected. Deal 3: an unpriced line.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6f20000' || n || '-0000-0000-0000-000000000001')::uuid, 'bp-deal-' || n,
       '6f000000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,3) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('6f40000' || n || '-0000-0000-0000-000000000001')::uuid, ('6f20000' || n || '-0000-0000-0000-000000000001')::uuid, 'bp-boq-' || n
  from generate_series(1,3) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('6f50000' || n || '-0000-0000-0000-000000000001')::uuid, ('6f40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,3) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, install_type, has_screen) values
  ('6f510001-0000-0000-0000-000000000001','6f500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'pylon',false),
  ('6f510002-0000-0000-0000-000000000001','6f500001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'ceiling',true),
  ('6f510003-0000-0000-0000-000000000001','6f500002-0000-0000-0000-000000000001',1,'Wall W1',1,null,false),
  ('6f510004-0000-0000-0000-000000000001','6f500003-0000-0000-0000-000000000001',1,'Wall W2',1,null,false);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status) values
  ('6f520001-0000-0000-0000-000000000001','6f500001-0000-0000-0000-000000000001','6f100000-0000-0000-0000-000000000001','SAR','responses_received'),
  ('6f520002-0000-0000-0000-000000000001','6f500002-0000-0000-0000-000000000001','6f100000-0000-0000-0000-000000000001','SAR','responses_received');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen, is_selected, selected_by, selected_at) values
  ('6f520001-0000-0000-0000-000000000001','6f510001-0000-0000-0000-000000000001',5000,2,10000,null,false,null,null),
  ('6f520001-0000-0000-0000-000000000001','6f510002-0000-0000-0000-000000000001',1000,4,4000,1500,false,null,null),
  ('6f520002-0000-0000-0000-000000000001','6f510003-0000-0000-0000-000000000001',700,1,700,null,true,'6f000000-0000-0000-0000-000000000002',now());
update public.boq_revisions set frozen_at = now(), frozen_by = '6f000000-0000-0000-0000-000000000002', status = 'verified'
 where id::text like '6f50000%';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id)
select ('6f60000' || n || '-0000-0000-0000-000000000001')::uuid, ('6f20000' || n || '-0000-0000-0000-000000000001')::uuid,
       (case n when 1 then 'supplier_priced' else 'selling_build' end)::public.pricing_file_state,
       ('6f50000' || n || '-0000-0000-0000-000000000001')::uuid
  from generate_series(1,3) n;
insert into public.pricing_file_inputs (file_id, containers, delivery, clearing, overhead_pct)
values ('6f600001-0000-0000-0000-000000000001', 1, 'riyadh', true, 0);
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate) values
  ('6f900001-0000-0000-0000-000000000001','bp_crane','Crane','رافعة','lump',3000),
  ('6f900002-0000-0000-0000-000000000001','bp_scaffold','Scaffold','سقالة','lump',800);
insert into public.pricing_file_extras (file_id, catalog_id, quantity, rate, status, decided_at)
values ('6f600001-0000-0000-0000-000000000001','6f900001-0000-0000-0000-000000000001',1,3000,'accepted',now());

-- ===== Who builds, and when =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001')$$,
  '42501', null, 'Zayed cannot build the selling price: the GM sets it');
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'The price is built in the selling build');
reset role;
update public.pricing_files set state = 'selling_build' where id = '6f600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);

-- ===== Build =====
select is((public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001'))->>'total_selling', '53200.00',
  'Kalas builds the price from the grid');
select ok(exists (select 1 from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001'
                   and estimation_id is not null and internal_price_id is not null), 'The file links its estimation and price');
select is((select p.status::text || '/' || p.proposed_price::text from public.internal_prices p
             join public.pricing_files f on f.internal_price_id = p.id where f.id = '6f600001-0000-0000-0000-000000000001'),
  'internal_price_proposed/53200.00', 'The price is a proposal at the grid''s total');
select is((select e.cost_total::text || '/' || e.installation_cost::text || '/' || e.wastage_pct::text from public.estimations e
             join public.pricing_files f on f.estimation_id = e.id where f.id = '6f600001-0000-0000-0000-000000000001'),
  '37300.00/2600.00/0.00', 'The estimation holds materials + extras + logistics, installation, no wastage');
select is((select public.estimation_cost_basis(f.estimation_id) from public.pricing_files f where f.id = '6f600001-0000-0000-0000-000000000001'),
  39900.00::numeric, 'Phase 8''s cost basis equals the grid''s total cost');
select is((select s.margin_percentage from public.internal_price_summary s join public.pricing_files f on f.internal_price_id = s.id
            where f.id = '6f600001-0000-0000-0000-000000000001'), 25.00::numeric,
  'The margin Phase 8 computes is the margin the grid shows');
select is((select p.figure_set_by::text from public.internal_prices p join public.pricing_files f on f.internal_price_id = p.id
            where f.id = '6f600001-0000-0000-0000-000000000001'),
  '6f000000-0000-0000-0000-000000000003', 'Kalas set the figure');
select is((select built_selling_price from public.pricing_file_lines where boq_line_id = '6f510001-0000-0000-0000-000000000001'),
  34322.58::numeric, 'Each line''s selling price is kept with the build');

-- ===== Rebuild after a change =====
select lives_ok($$select public.pricing_file_set_line('6f600001-0000-0000-0000-000000000001','6f510001-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  'Kalas raises L1 to 30%');
select is((public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001'))->>'total_selling', '55651.61',
  'Rebuilding updates the same price');
select is((select count(*)::int from public.estimations where boq_revision_id = '6f500001-0000-0000-0000-000000000001'), 1,
  'The estimation is reused, not duplicated');

-- ===== Propose =====
select throws_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 53200)$$,
  'P0001', null, 'A stale total is refused');
select is((select p.status::text from public.internal_prices p join public.pricing_files f on f.internal_price_id = p.id
            where f.id = '6f600001-0000-0000-0000-000000000001'), 'internal_price_proposed', '... and nothing moved');
reset role;
insert into public.pricing_file_extras (file_id, catalog_id, rate)
values ('6f600001-0000-0000-0000-000000000001','6f900002-0000-0000-0000-000000000001',800);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 55651.61)$$,
  'P0001', null, 'An undecided suggestion blocks Propose');
reset role;
update public.pricing_file_extras set status = 'dismissed', dismiss_reason = 'Not needed', decided_at = now()
 where catalog_id = '6f900002-0000-0000-0000-000000000001';
insert into public.margin_policies (min_margin_pct, effective_from, rationale) values (40, now() - interval '1 day', 'bp-floor');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 55651.61)$$,
  '23514', null, 'Below the floor, Propose needs a justification (Phase 8 guard)');
select lives_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 55651.61, 'Strategic first job with this client')$$,
  'Kalas proposes with a justification');
select is((select state::text from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001'), 'price_review',
  'The file goes to Zayed''s price review');
select is((select p.status::text || '/' || p.proposed_by::text from public.internal_prices p
             join public.pricing_files f on f.internal_price_id = p.id where f.id = '6f600001-0000-0000-0000-000000000001'),
  'gm_pending/6f000000-0000-0000-0000-000000000003', 'Kalas is the proposer');
select throws_ok($$select public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'Nothing is rebuilt under review');
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.estimations set cost_total = 1 where id = (select estimation_id from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'The cost basis is frozen under review');

-- ===== Zayed returns it; Kalas rebuilds and proposes again; Zayed approves =====
select lives_ok($$update public.internal_prices set status = 'returned', return_reason = 'Check the logistics'
                   where id = (select internal_price_id from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001')$$,
  'Zayed returns the price');
select is((select state::text from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001'), 'selling_build',
  'The file is back with Kalas');
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
-- Build in its own statement: a query that calls it cannot see what it wrote.
select lives_ok($$select public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001')$$,
  'Kalas rebuilds the returned price');
select is((select p.status::text from public.internal_prices p join public.pricing_files f on f.internal_price_id = p.id
            where f.id = '6f600001-0000-0000-0000-000000000001'),
  'internal_price_proposed', 'Rebuilding a returned price makes it a proposal again');
select lives_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 55651.61, 'Strategic first job with this client')$$,
  'Kalas proposes again');
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_approved'
                   where id = (select internal_price_id from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001')$$,
  'Zayed approves the price Kalas set (he set no figure)');
select is((select state::text from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001'), 'approved',
  'The file is approved');

-- ===== Refusals on the other two deals =====
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_build_price('6f600002-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A supplier line already marked selected would make Phase 8 ignore the grid, so it is refused');
select throws_ok($$select public.pricing_file_build_price('6f600003-0000-0000-0000-000000000001')$$,
  'P0001', null, 'An unpriced line is refused');
reset role;
select * from finish();
rollback;
```

Count check: 2 + 8 (build) + 3 (rebuild) + 9 (propose: stale, unchanged, open, floor, propose, state, proposer, no rebuild, frozen basis) + 7 (return, back, rebuild, status, propose, approve, approved) + 2 = 31.

A mutating RPC called inside a `select … where` cannot be checked in the same statement: the outer query's snapshot predates the RPC's writes. Call it in its own statement (`lives_ok` or `is(rpc(...)->>…)`), then check the tables in the next one.

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_build_price.test.sql` FAILS with `function public.pricing_file_build_price(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261104150000_pricing_build_price.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 2, part 6: Kalas builds the selling price and proposes it.
--
-- Build writes the grid into the Phase 7A/8 engine so its rules apply
-- unchanged: an estimation (cost_total = materials + extras + logistics,
-- installation_cost, wastage 0, overhead) and an internal price at the grid's
-- total. Phase 8's compute_margin then derives the margin from
-- estimation_cost_basis, which on these figures is exactly the grid's
-- total_cost (pricing_selling_totals uses the same expression). The client
-- never supplies a margin.
--
-- AI_HANDOFF PR 2 contract: this function runs as the owner, so
-- internal_price_insert_guard (authenticated callers only) does not reach it.
-- It inserts a price at internal_price_proposed and nothing else, and links
-- through _pricing_file_link_price, which re-checks every rule. figure_set_by
-- is stamped from auth.uid() by the insert/transition guards.
--
-- Propose = build again, check the total is the one Kalas saw, then the
-- existing in-file move internal_price_proposed → gm_pending (the guard checks
-- the GM, the selling build and open extras; the floor guard asks for a
-- justification below the floor; the file follows to price_review).
--
-- Supplier selection (supplier_quote_lines.is_selected) is not used in pricing
-- files: estimation_cost_basis would take the selected lines' cost and ignore
-- the grid, so a revision with a selected line is refused.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pricing_file_build_price(_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; p public.internal_prices; e public.estimations;
        t record; price_id uuid; reuse_est boolean;
BEGIN
  IF NOT public.can_approve_final_price(u) THEN
    RAISE EXCEPTION 'The GM builds the selling price. | سعر البيع يبنيه المدير العام.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_read_commercial_cost(u) THEN
    RAISE EXCEPTION 'Building the price needs cost access. | بناء السعر يحتاج صلاحية رؤية التكلفة.' USING ERRCODE = '42501';
  END IF;
  -- Lock order: the file's price, then the file (20261103140000).
  SELECT pf.internal_price_id INTO price_id FROM public.pricing_files pf WHERE pf.id = _file_id;
  IF price_id IS NOT NULL THEN
    SELECT * INTO p FROM public.internal_prices WHERE id = price_id FOR UPDATE;
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.internal_price_id IS DISTINCT FROM price_id THEN
    RAISE EXCEPTION 'The pricing file changed while the price was being built; try again. | تغيّر ملف التسعير أثناء بناء السعر؛ أعد المحاولة.' USING ERRCODE = 'P0001';
  END IF;
  IF f.state <> 'selling_build' THEN
    RAISE EXCEPTION 'The price is built in the selling build. | يُبنى السعر في مرحلة بناء سعر البيع.' USING ERRCODE = 'P0001';
  END IF;
  IF f.boq_revision_id IS NULL OR NOT public.boq_revision_is_frozen(f.boq_revision_id) THEN
    RAISE EXCEPTION 'The file''s BOQ is not frozen. | كميات الملف غير مجمّدة.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_quote_lines l JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
              WHERE q.boq_revision_id = f.boq_revision_id AND l.is_selected) THEN
    RAISE EXCEPTION 'A supplier line on this BOQ revision is marked selected, so the margin would ignore the grid; open a new BOQ revision. | أحد بنود المورد في هذا الإصدار مُعلَّم كمختار فيتجاهل الهامش الجدول؛ افتح إصدار كميات جديداً.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO t FROM public.pricing_selling_totals WHERE file_id = f.id;
  -- Two IFs, not one OR: an unassigned record must not be read.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The file has no lines to price. | لا توجد بنود للتسعير في الملف.' USING ERRCODE = 'P0001';
  END IF;
  IF t.line_count = 0 THEN
    RAISE EXCEPTION 'The file has no lines to price. | لا توجد بنود للتسعير في الملف.' USING ERRCODE = 'P0001';
  END IF;
  IF t.unpriced_lines > 0 THEN
    RAISE EXCEPTION '% line(s) have no supplier price yet. | % بند بلا سعر مورد بعد.', t.unpriced_lines, t.unpriced_lines USING ERRCODE = 'P0001';
  END IF;
  IF t.multi_quote_lines > 0 THEN
    RAISE EXCEPTION 'A line has prices from more than one supplier; one supplier per file in this release. | أحد البنود له أسعار من أكثر من مورد؛ مورد واحد لكل ملف في هذا الإصدار.' USING ERRCODE = 'P0001';
  END IF;
  IF t.total_selling IS NULL OR t.total_selling <= 0 THEN
    RAISE EXCEPTION 'The selling total is zero. | إجمالي البيع صفر.' USING ERRCODE = 'P0001';
  END IF;

  -- The estimation: reuse the file's while it is for this revision and no
  -- price on it is under review or approved (those are frozen, Task 1).
  IF f.estimation_id IS NOT NULL THEN
    SELECT * INTO e FROM public.estimations WHERE id = f.estimation_id FOR UPDATE;
  END IF;
  reuse_est := e.id IS NOT NULL AND e.boq_revision_id = f.boq_revision_id
               AND NOT EXISTS (SELECT 1 FROM public.internal_prices ip
                                WHERE ip.estimation_id = e.id AND ip.status IN ('gm_pending','gm_approved'));
  IF reuse_est THEN
    UPDATE public.estimations
       SET cost_total = t.materials_total + t.extras_total + t.logistics_total,
           installation_cost = t.installation_total, wastage_pct = 0, overhead_pct = t.overhead_pct,
           notes = 'Built from pricing file ' || f.id::text
     WHERE id = e.id RETURNING * INTO e;
  ELSE
    INSERT INTO public.estimations (boq_revision_id, cost_total, installation_cost, wastage_pct, overhead_pct, notes, created_by)
    VALUES (f.boq_revision_id, t.materials_total + t.extras_total + t.logistics_total,
            t.installation_total, 0, t.overhead_pct, 'Built from pricing file ' || f.id::text, u)
    RETURNING * INTO e;
  END IF;

  -- The price: the file's own while it is a proposal or returned, else a new
  -- proposal. Never inserted past internal_price_proposed.
  IF p.id IS NOT NULL AND p.status IN ('internal_price_proposed','returned') THEN
    UPDATE public.internal_prices
       SET proposed_price = t.total_selling, estimation_id = e.id, status = 'internal_price_proposed'
     WHERE id = p.id RETURNING * INTO p;
  ELSE
    INSERT INTO public.internal_prices (estimation_id, proposed_price, status, proposed_by, proposed_at)
    VALUES (e.id, t.total_selling, 'internal_price_proposed', u, now())
    RETURNING * INTO p;
  END IF;
  PERFORM public._pricing_file_link_price(f.id, e.id, p.id);

  -- The per-line figures behind this price, for the quotation (PR 4).
  INSERT INTO public.pricing_file_lines (file_id, boq_line_id, built_cost, built_selling_price, built_at, updated_by)
  SELECT g.file_id, g.boq_line_id, g.line_cost, g.selling_price, now(), u
    FROM public.pricing_selling_grid g WHERE g.file_id = f.id
  ON CONFLICT (file_id, boq_line_id) DO UPDATE
     SET built_cost = EXCLUDED.built_cost, built_selling_price = EXCLUDED.built_selling_price,
         built_at = EXCLUDED.built_at;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.price_built', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'internal_price_id', p.id, 'estimation_id', e.id,
                             'proposed_price', p.proposed_price));
  RETURN jsonb_build_object('internal_price_id', p.id, 'estimation_id', e.id,
                            'total_cost', t.total_cost, 'total_selling', t.total_selling,
                            'margin_pct', p.margin_percentage, 'floor_pct', t.floor_pct,
                            'below_floor', t.below_floor);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_build_price(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_build_price(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_propose(_file_id uuid, _expected_total numeric, _justification text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b jsonb; f public.pricing_files;
BEGIN
  b := public.pricing_file_build_price(_file_id);
  IF (b->>'total_selling')::numeric IS DISTINCT FROM _expected_total THEN
    RAISE EXCEPTION 'The price changed since you built it (now %); check it and propose again. | تغيّر السعر منذ بنائه (الآن %)؛ راجعه واقترحه مجدداً.',
      b->>'total_selling', b->>'total_selling' USING ERRCODE = 'P0001';
  END IF;
  -- The existing in-file propose path: the guard, the floor guard and the
  -- file-follow trigger all run on this UPDATE.
  UPDATE public.internal_prices
     SET status = 'gm_pending',
         below_floor_justification = coalesce(nullif(btrim(coalesce(_justification, '')), ''), below_floor_justification)
   WHERE id = (b->>'internal_price_id')::uuid;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_propose(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_propose(uuid, numeric, text) TO authenticated;
```

- [ ] **Step 4: Run the DB suite and confirm it passes**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_build_price.test.sql .. ok`, and every other file still ok. Before committing, run the whole suite once more and note the totals (files/tests) for the Task 13 handoff.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104150000_pricing_build_price.sql supabase/tests/pricing_build_price.test.sql
git commit -m "feat(pricing): the GM builds the price from the grid and proposes it through the Phase 8 path" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: TypeScript layer: text, access, grid mirror, actions

**Files:**
- Create: `src/lib/pricing-text.ts`, `src/lib/pricing-text.test.ts`
- Create: `src/lib/pricing-access.ts`, `src/lib/pricing-access.test.ts`
- Create: `src/lib/pricing-grid.ts`, `src/lib/pricing-grid.test.ts`, `src/lib/pricing-grid.contract.test.ts`
- Modify: `src/lib/pricing-actions.ts` (whole file below; the PR 1 exports are kept unchanged)
- Create: `src/lib/pricing-actions.contract.test.ts`

**Interfaces:**
- Consumes:
  - SQL from Tasks 1–6 (exact names in their Produces blocks).
  - `src/lib/pricing.ts` (PR 1): `PricingState`, `PRICING_STATE_LABEL`, `InstallType`, `canPricerMove`, `canGmMove`.
  - `src/lib/roles.ts`: `AppRole`. `src/lib/i18n.tsx`: `Lang`.
- Produces (UI tasks 8–12 and 14 import exactly these):
  - `pricing-text.ts`: `type Bi = { en: string; ar: string }`; `pick(b: Bi, lang: Lang): string`; `dbMessage(e: unknown, lang: Lang): string`; `asError(e: unknown, lang: Lang): Error`.
  - `pricing-access.ts`:
    - `type PricingRights = { is_pricer: boolean; is_gm: boolean; can_read_cost: boolean }`; `NO_RIGHTS`; `COST_READER_ROLES`; `canSeePricingNav(roles: readonly AppRole[]): boolean`; `canOpenPricing(r): boolean`.
    - `type PricingTab = "package" | "supplier" | "cost" | "selling"`; `PRICING_TABS`; `PRICING_TAB_LABEL: Record<PricingTab, Bi>`; `parsePricingTab(v: unknown): PricingTab | undefined`; `visibleTabs(r): PricingTab[]`; `defaultTab(state, r): PricingTab`.
    - `type NextOwner = "pricer" | "sales" | "supplier" | "gm" | "bd" | "none"`; `nextOwner(state): NextOwner`; `NEXT_OWNER_LABEL: Record<NextOwner, Bi>`.
    - `type QueueFilter = "all" | "pricer" | "gm"`; `PRICER_QUEUE_STATES`; `GM_QUEUE_STATES`; `inQueue(state, filter): boolean`; `defaultQueueFilter(r): QueueFilter`; `daysWaiting(since: string, now?: Date): number`.
    - `canEditPackage(state, r)`, `canEditFileInputs(state, r)`, `canEditLineCost(state, r)`, `canEditSelling(state, r)`, `canBuildPrice(state, r)`: all `boolean`.
  - `pricing-grid.ts`: `round2`, `type LogisticsRates`, `type LogisticsInputs`, `logisticsTotal(i, r, goods): number`, `shares(values: number[]): number[]`, `sellingFromMargin(cost, marginPct): number`, `marginPct(selling, cost): number | null`, `fileTotalCost({...}): number`, `type GridLineInput`, `type FileInput`, `type PricedLine`, `type FileTotals`, `priceFile(lines, file): { lines: PricedLine[]; totals: FileTotals }`.
  - `pricing-actions.ts`: everything PR 1 exported (`openPricingFile`, `movePricingFile`, `askNeedsInfo`, `answerNeedsInfo`, `suggestExtras`, `decideExtra`), plus the reads, writes and types listed in the file below. The UI uses these names.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pricing-text.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { asError, dbMessage, pick } from "@/lib/pricing-text";

describe("pick", () => {
  it("returns the reader's language", () => {
    expect(pick({ en: "Freeze", ar: "تجميد" }, "en")).toBe("Freeze");
    expect(pick({ en: "Freeze", ar: "تجميد" }, "ar")).toBe("تجميد");
  });
});

describe("dbMessage shows the reader's half of a bilingual database error", () => {
  const e = { message: "Only the GM sets the margin. | الهامش يضعه المدير العام.", code: "42501" };
  it("English half", () => expect(dbMessage(e, "en")).toBe("Only the GM sets the margin."));
  it("Arabic half", () => expect(dbMessage(e, "ar")).toBe("الهامش يضعه المدير العام."));
  it("a one-language message is shown as it is", () => {
    expect(dbMessage(new Error("Network down"), "ar")).toBe("Network down");
  });
  it("anything else becomes text", () => expect(dbMessage("boom", "en")).toBe("boom"));
  it("asError wraps it for ActionDialog", () => {
    expect(asError(e, "en")).toBeInstanceOf(Error);
    expect(asError(e, "en").message).toBe("Only the GM sets the margin.");
  });
});
```

Create `src/lib/pricing-access.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  canBuildPrice, canEditFileInputs, canEditLineCost, canEditPackage, canEditSelling, canOpenPricing,
  canSeePricingNav, COST_READER_ROLES, daysWaiting, defaultQueueFilter, defaultTab, GM_QUEUE_STATES,
  inQueue, nextOwner, NO_RIGHTS, parsePricingTab, PRICER_QUEUE_STATES, visibleTabs,
  type PricingRights,
} from "@/lib/pricing-access";
import { PRICING_STATES } from "@/lib/pricing";

const zayed: PricingRights = { is_pricer: true, is_gm: false, can_read_cost: true };
const kalas: PricingRights = { is_pricer: false, is_gm: true, can_read_cost: true };
const omar: PricingRights = { is_pricer: false, is_gm: false, can_read_cost: true };

describe("who opens pricing", () => {
  it("pricers, the GM and cost readers; not a rep", () => {
    expect(canOpenPricing(zayed)).toBe(true);
    expect(canOpenPricing(kalas)).toBe(true);
    expect(canOpenPricing(omar)).toBe(true);
    expect(canOpenPricing(NO_RIGHTS)).toBe(false);
  });
  it("the sidebar shows Pricing to the cost-reading roles only", () => {
    expect(canSeePricingNav(["salesperson"])).toBe(false);
    expect(canSeePricingNav(["bd_manager"])).toBe(false);
    expect(canSeePricingNav(["sales_manager"])).toBe(true);
    expect(canSeePricingNav(["estimation_manager"])).toBe(true);
  });
  it("COST_READER_ROLES equals can_read_commercial_cost's role list in SQL", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261103150000_sales_manager_reads_cost.sql", import.meta.url), "utf8")
      .replace(/--[^\n]*/g, "");
    const list = sql.match(/ARRAY\[([\s\S]*?)\]::public\.app_role\[\]/)?.[1] ?? "";
    const roles = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(roles.length).toBeGreaterThan(3);
    expect([...COST_READER_ROLES].sort()).toEqual(roles);
  });
});

describe("tabs", () => {
  it("cost readers see four tabs; nobody else sees the cost tabs", () => {
    expect(visibleTabs(zayed)).toEqual(["package", "supplier", "cost", "selling"]);
    expect(visibleTabs(NO_RIGHTS)).toEqual(["package", "supplier"]);
  });
  it("opens on the tab the state is about", () => {
    expect(defaultTab("package_review", zayed)).toBe("package");
    expect(defaultTab("at_supplier", zayed)).toBe("supplier");
    expect(defaultTab("supplier_priced", kalas)).toBe("cost");
    expect(defaultTab("selling_build", kalas)).toBe("selling");
    expect(defaultTab("selling_build", NO_RIGHTS)).toBe("package");
  });
  it("parses the search param", () => {
    expect(parsePricingTab("cost")).toBe("cost");
    expect(parsePricingTab("approval")).toBeUndefined();
  });
});

describe("the queue", () => {
  it("every state has someone who owes the next step", () => {
    for (const s of PRICING_STATES) expect(typeof nextOwner(s)).toBe("string");
    expect(nextOwner("needs_info")).toBe("sales");
    expect(nextOwner("at_supplier")).toBe("supplier");
    expect(nextOwner("supplier_priced")).toBe("gm");
    expect(nextOwner("price_review")).toBe("pricer");
  });
  it("Zayed's filter and Kalas's filter do not overlap", () => {
    expect(PRICER_QUEUE_STATES.filter((s) => GM_QUEUE_STATES.includes(s))).toEqual([]);
    expect(inQueue("supplier_priced", "gm")).toBe(true);
    expect(inQueue("supplier_priced", "pricer")).toBe(false);
    expect(inQueue("closed", "all")).toBe(false);
  });
  it("each opens on their own filter", () => {
    expect(defaultQueueFilter(zayed)).toBe("pricer");
    expect(defaultQueueFilter(kalas)).toBe("gm");
    expect(defaultQueueFilter(omar)).toBe("all");
  });
  it("counts whole days waiting, never negative", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(daysWaiting("2026-11-01T11:00:00Z", now)).toBe(3);
    expect(daysWaiting("2026-11-05T11:00:00Z", now)).toBe(0);
  });
});

describe("edit gates mirror SQL", () => {
  it("package: a pricer in package review", () => {
    expect(canEditPackage("package_review", zayed)).toBe(true);
    expect(canEditPackage("package_review", kalas)).toBe(false);
    expect(canEditPackage("boq_frozen", zayed)).toBe(false);
  });
  it("file inputs: pricer or GM from the freeze to the selling build", () => {
    expect(canEditFileInputs("boq_frozen", zayed)).toBe(true);
    expect(canEditFileInputs("selling_build", kalas)).toBe(true);
    expect(canEditFileInputs("price_review", zayed)).toBe(false);
  });
  it("line cost choices: pricer or GM once the supplier has priced", () => {
    expect(canEditLineCost("supplier_priced", zayed)).toBe(true);
    expect(canEditLineCost("at_supplier", zayed)).toBe(false);
  });
  it("selling: the GM in the selling build only", () => {
    expect(canEditSelling("selling_build", kalas)).toBe(true);
    expect(canEditSelling("selling_build", zayed)).toBe(false);
    expect(canEditSelling("supplier_priced", kalas)).toBe(false);
  });
  it("build: the GM who reads cost, in the selling build", () => {
    expect(canBuildPrice("selling_build", kalas)).toBe(true);
    expect(canBuildPrice("selling_build", { ...kalas, can_read_cost: false })).toBe(false);
  });
});
```

Create `src/lib/pricing-grid.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { fileTotalCost, logisticsTotal, marginPct, priceFile, round2, sellingFromMargin, shares, type FileInput } from "@/lib/pricing-grid";

// The worked example of supabase/tests/pricing_selling_grid.test.sql.
const file: FileInput = {
  fallbackPct: 10,
  defaultMarginPct: 25,
  overheadPct: 0,
  extrasTotal: 3000,
  logistics: { containers: 1, delivery: "riyadh", clearing: true },
  rates: { container_rate: 12000, customs_pct: 5, clearing_fee: 500, delivery_jeddah: 2000, delivery_riyadh: 5000 },
};
const L1 = { quantity: 2, unitMaterial: 5000, unitInstall: 1000, marginPct: null, typedSelling: null };
const L2 = { quantity: 4, unitMaterial: 1500, unitInstall: null, marginPct: null, typedSelling: null };

describe("the grid mirror gives the SQL test's figures", () => {
  const out = priceFile([L1, L2], file);
  it("materials and installation (rate, then fallback)", () => {
    expect(out.lines[0]).toMatchObject({ materials: 10000, installation: 2000, installBasis: "rate" });
    expect(out.lines[1]).toMatchObject({ materials: 6000, installation: 600, installBasis: "fallback" });
  });
  it("extras and logistics spread by value", () => {
    expect(out.lines[0].extrasAlloc).toBe(1935.48);
    expect(out.lines[0].logisticsAlloc).toBe(11806.45);
    expect(out.totals.logisticsTotal).toBe(18300);
  });
  it("line cost and selling at the default margin", () => {
    expect(out.lines[0].lineCost).toBe(25741.94);
    expect(out.lines[0].selling).toBe(34322.58);
    expect(out.lines[1].selling).toBe(18877.42);
  });
  it("file totals", () => {
    expect(out.totals.totalCost).toBe(39900);
    expect(out.totals.totalSelling).toBe(53200);
    expect(out.totals.marginPct).toBe(25);
  });
  it("a line margin and a typed price", () => {
    const t = priceFile([{ ...L1, marginPct: 30 }, { ...L2, typedSelling: 20000 }], file).totals;
    expect(t.totalSelling).toBe(56774.19);
    expect(t.marginPct).toBe(29.72);
  });
  it("an unpriced line has no selling price and is counted", () => {
    const t = priceFile([L1, { ...L2, unitMaterial: null }], file).totals;
    expect(t.unpricedLines).toBe(1);
  });
});

describe("the pieces", () => {
  it("round2 rounds half away from zero, like SQL numeric", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
  });
  it("shares fall back to equal parts when nothing has value", () => {
    expect(shares([0, 0])).toEqual([0.5, 0.5]);
    expect(shares([])).toEqual([]);
  });
  it("margin is on price", () => {
    expect(sellingFromMargin(75, 25)).toBe(100);
    expect(marginPct(100, 75)).toBe(25);
    expect(marginPct(0, 75)).toBeNull();
    expect(() => sellingFromMargin(75, 100)).toThrow();
  });
  it("logistics: containers, customs on goods, clearing, delivery", () => {
    expect(logisticsTotal({ containers: 2, delivery: "jeddah", clearing: false }, file.rates, 10000)).toBe(24000 + 500 + 2000);
  });
  it("total cost applies overhead after installation, as estimation_cost_basis does", () => {
    expect(fileTotalCost({ materials: 1000, extras: 0, logistics: 0, installation: 100, overheadPct: 10 })).toBe(1210);
  });
});
```

Create `src/lib/pricing-grid.contract.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

// pricing-grid.ts mirrors the SQL; the SQL is the authority. These pin the
// expressions the mirror copies, so a change on either side fails here first.
const read = (file: string) =>
  readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8").replace(/--[^\n]*/g, "");
const GRID = read("20261104140000_pricing_selling_grid.sql");
const BUILD = read("20261104150000_pricing_build_price.sql");
const PHASE8 = read("20260830100000_phase8_margin_integrity.sql");

describe("the selling grid's arithmetic", () => {
  it("installation falls back to a % of materials from install_fallback_pct", () => {
    expect(GRID).toContain("r.key = 'install_fallback_pct'");
    expect(GRID).toMatch(/coalesce\(b\.unit_material, 0\) \* b\.quantity \* b\.fallback_pct \/ 100/);
  });
  it("extras and logistics are spread by line value, equally when there is none", () => {
    expect(GRID).toMatch(/\(coalesce\(s\.materials, 0\) \+ s\.installation\) \/ s\.value_total/);
    expect(GRID).toMatch(/ELSE 1\.0 \/ s\.line_count END AS share/);
  });
  it("logistics: containers, customs on goods, clearing, delivery", () => {
    expect(GRID).toMatch(/coalesce\(fi\.containers, 0\) \* coalesce\(r\.container_rate, 0\)/);
    expect(GRID).toMatch(/s\.goods_total \* coalesce\(r\.customs_pct, 0\) \/ 100/);
    expect(GRID).toMatch(/WHEN coalesce\(fi\.clearing, false\) THEN coalesce\(r\.clearing_fee, 0\)/);
  });
  it("line cost adds the allocations, then overhead", () => {
    expect(GRID).toMatch(
      /\(coalesce\(c\.materials, 0\) \+ c\.installation \+ c\.share \* c\.extras_total \+ c\.share \* c\.logistics_total\)\s*\* \(1 \+ c\.overhead_pct \/ 100\)/,
    );
  });
  it("selling is margin on price, from the line's margin, else the default", () => {
    expect(GRID).toMatch(/round\(lc\.line_cost \/ \(1 - coalesce\(c\.line_margin_pct, c\.default_margin_pct\) \/ 100\), 2\)/);
  });
});

describe("the totals equal what Phase 8 computes from the estimation build writes", () => {
  it("total cost is estimation_cost_basis's expression", () => {
    expect(GRID).toMatch(/a\.materials_total \+ a\.extras_total \+ a\.logistics_total \+ a\.installation_total AS subtotal/);
    expect(GRID).toMatch(/round\(s\.subtotal \+ s\.subtotal \* a\.overhead_pct \/ 100, 2\) AS total_cost/);
    expect(PHASE8).toMatch(
      /_subtotal := _material\s+\+ \(_material \* coalesce\(_e\.wastage_pct, 0\) \/ 100\)\s+\+ coalesce\(_e\.installation_cost, 0\);/,
    );
    expect(PHASE8).toMatch(/RETURN round\(_subtotal \+ \(_subtotal \* coalesce\(_e\.overhead_pct, 0\) \/ 100\), 2\);/);
  });
  it("build writes cost_total = materials + extras + logistics, installation, no wastage", () => {
    expect(BUILD).toMatch(
      /cost_total = t\.materials_total \+ t\.extras_total \+ t\.logistics_total,\s+installation_cost = t\.installation_total, wastage_pct = 0, overhead_pct = t\.overhead_pct/,
    );
    expect(BUILD).toMatch(
      /VALUES \(f\.boq_revision_id, t\.materials_total \+ t\.extras_total \+ t\.logistics_total,\s+t\.installation_total, 0, t\.overhead_pct,/,
    );
  });
  it("margin is on price, the same formula as compute_margin", () => {
    expect(GRID).toMatch(/round\(\(a\.total_selling - c\.total_cost\) \/ a\.total_selling \* 100, 2\)/);
    expect(PHASE8).toMatch(/round\(\(NEW\.proposed_price - _cost\) \/ NEW\.proposed_price \* 100, 2\)/);
  });
  it("build inserts a proposal and no other status (PR 2 contract)", () => {
    const inserts = [...BUILD.matchAll(/INSERT INTO public\.internal_prices[\s\S]*?;/g)].map((m) => m[0]);
    expect(inserts.length).toBe(1);
    expect(inserts[0]).toMatch(/VALUES \(e\.id, t\.total_selling, 'internal_price_proposed', u, now\(\)\)/);
    expect(BUILD).toContain("PERFORM public._pricing_file_link_price(f.id, e.id, p.id);");
  });
});
```

Create `src/lib/pricing-actions.contract.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

// Every RPC the screens call exists in a migration, and no read selects "*"
// from a table with column grants (pricing_file_events, boq_lines, ...).
const dir = new URL("../../supabase/migrations/", import.meta.url);
const SQL = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
const SRC = readFileSync(new URL("./pricing-actions.ts", import.meta.url), "utf8");

describe("pricing-actions", () => {
  const rpcs = [...SRC.matchAll(/call(?:<[^>]*>)?\(\s*"(\w+)"/g)].map((m) => m[1]);
  it("finds the RPC calls", () => expect(rpcs.length).toBeGreaterThan(15));
  it.each([...new Set(rpcs)])("%s is defined in a migration", (fn) => {
    expect(SQL).toMatch(new RegExp(`FUNCTION public\\.${fn}\\(`));
  });
  it("never selects *", () => {
    expect(SRC).not.toMatch(/\.select\(\s*["']\*["']/);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test src/lib/pricing-text.test.ts src/lib/pricing-access.test.ts src/lib/pricing-grid.test.ts src/lib/pricing-grid.contract.test.ts src/lib/pricing-actions.contract.test.ts`
Expected: FAIL. The first three with `Cannot find module '@/lib/pricing-text'` (and `pricing-access`, `pricing-grid`). The grid contract test passes already, since it reads only SQL. The actions contract test fails on `finds the RPC calls` (PR 1's file has 6).

- [ ] **Step 3: Write `src/lib/pricing-text.ts`**

```ts
// Bilingual text for the pricing screens. Each component keeps its own
// `const TEXT = { ... } satisfies Record<string, Bi>` and shows it with pick().
import type { Lang } from "@/lib/i18n";

export type Bi = { en: string; ar: string };

export const pick = (b: Bi, lang: Lang): string => b[lang];

function rawMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** The database raises 'English. | العربية.'; show the reader's half. */
export function dbMessage(e: unknown, lang: Lang): string {
  const raw = rawMessage(e);
  const i = raw.indexOf(" | ");
  if (i < 0) return raw;
  return lang === "ar" ? raw.slice(i + 3).trim() : raw.slice(0, i).trim();
}

/** For ActionDialog onSubmit: rethrow so the dialog stays open and shows the message. */
export const asError = (e: unknown, lang: Lang): Error => new Error(dbMessage(e, lang));
```

- [ ] **Step 4: Write `src/lib/pricing-access.ts`**

```ts
// Who may do what on the pricing screens: a mirror of the SQL rules
// (pricing_my_rights, the RPCs' state checks). SQL decides; this only chooses
// which buttons and tabs to show. pricing-access.test.ts pins it.
import type { AppRole } from "@/lib/roles";
import type { PricingState } from "@/lib/pricing";
import type { Bi } from "@/lib/pricing-text";

export type PricingRights = { is_pricer: boolean; is_gm: boolean; can_read_cost: boolean };
export const NO_RIGHTS: PricingRights = { is_pricer: false, is_gm: false, can_read_cost: false };

/** can_read_commercial_cost's roles (20261103150000). The sidebar shows Pricing to them. */
export const COST_READER_ROLES: readonly AppRole[] = [
  "estimation_manager",
  "finance_manager",
  "sales_manager",
  "managing_director",
  "general_manager",
  "ceo",
];
export const canSeePricingNav = (roles: readonly AppRole[]): boolean =>
  roles.some((r) => COST_READER_ROLES.includes(r));

/** A GM delegate is known only to SQL, so pages ask pricing_my_rights(). */
export const canOpenPricing = (r: PricingRights): boolean => r.is_pricer || r.is_gm || r.can_read_cost;

export type PricingTab = "package" | "supplier" | "cost" | "selling";
export const PRICING_TABS: readonly PricingTab[] = ["package", "supplier", "cost", "selling"];
export const PRICING_TAB_LABEL: Record<PricingTab, Bi> = {
  package: { en: "Package", ar: "الباكيج" },
  supplier: { en: "Supplier", ar: "المورد" },
  cost: { en: "Cost review", ar: "مراجعة التكلفة" },
  selling: { en: "Selling price", ar: "سعر البيع" },
};
export const parsePricingTab = (v: unknown): PricingTab | undefined =>
  typeof v === "string" && (PRICING_TABS as readonly string[]).includes(v) ? (v as PricingTab) : undefined;

/** Cost and Selling show cost; RLS returns nothing to anyone else anyway. */
export const visibleTabs = (r: PricingRights): PricingTab[] =>
  r.can_read_cost ? [...PRICING_TABS] : ["package", "supplier"];

export function defaultTab(state: PricingState, r: PricingRights): PricingTab {
  const want: PricingTab =
    state === "supplier_priced"
      ? "cost"
      : state === "selling_build" || state === "price_review" || state === "approved" || state === "quoted"
        ? "selling"
        : state === "boq_frozen" || state === "at_supplier"
          ? "supplier"
          : "package";
  return visibleTabs(r).includes(want) ? want : "package";
}

export type NextOwner = "pricer" | "sales" | "supplier" | "gm" | "bd" | "none";
export function nextOwner(state: PricingState): NextOwner {
  switch (state) {
    case "received":
    case "package_review":
    case "boq_frozen":
    case "price_review":
      return "pricer";
    case "needs_info":
    case "quoted":
      return "sales";
    case "at_supplier":
      return "supplier";
    case "supplier_priced":
    case "selling_build":
      return "gm";
    case "approved":
      return "bd";
    case "closed":
      return "none";
  }
}
export const NEXT_OWNER_LABEL: Record<NextOwner, Bi> = {
  pricer: { en: "Estimation & finance", ar: "التقدير والمالية" },
  sales: { en: "Sales", ar: "المبيعات" },
  supplier: { en: "Supplier", ar: "المورد" },
  gm: { en: "GM (selling price)", ar: "المدير العام (سعر البيع)" },
  bd: { en: "BD (quotation)", ar: "تطوير الأعمال (عرض السعر)" },
  none: { en: "Nobody", ar: "لا أحد" },
};

export type QueueFilter = "all" | "pricer" | "gm";
/** Zayed's stages, including the ones waiting on sales or the supplier for his files. */
export const PRICER_QUEUE_STATES: readonly PricingState[] = [
  "received", "package_review", "needs_info", "boq_frozen", "at_supplier", "price_review",
];
/** Kalas's "set selling price" queue (spec §4.5). */
export const GM_QUEUE_STATES: readonly PricingState[] = ["supplier_priced", "selling_build"];
export function inQueue(state: PricingState, filter: QueueFilter): boolean {
  if (state === "closed") return false;
  if (filter === "pricer") return PRICER_QUEUE_STATES.includes(state);
  if (filter === "gm") return GM_QUEUE_STATES.includes(state);
  return true;
}
export const defaultQueueFilter = (r: PricingRights): QueueFilter =>
  r.is_gm && !r.is_pricer ? "gm" : r.is_pricer && !r.is_gm ? "pricer" : "all";

export function daysWaiting(since: string, now: Date = new Date()): number {
  const ms = now.getTime() - Date.parse(since);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

/** pricing_boq_import / _line_delete / _attach_revision / _freeze_boq / needs info. */
export const canEditPackage = (s: PricingState, r: PricingRights): boolean => r.is_pricer && s === "package_review";
/** pricing_file_set_inputs (cost keys). */
export const canEditFileInputs = (s: PricingState, r: PricingRights): boolean =>
  (r.is_pricer || r.is_gm) && ["boq_frozen", "at_supplier", "supplier_priced", "selling_build"].includes(s);
/** pricing_file_set_line (cost keys), pricing_decide_extra, pricing_add_extra. */
export const canEditLineCost = (s: PricingState, r: PricingRights): boolean =>
  (r.is_pricer || r.is_gm) && (s === "supplier_priced" || s === "selling_build");
/** pricing_file_set_line (margin_pct, selling_price) and the file's default margin. */
export const canEditSelling = (s: PricingState, r: PricingRights): boolean => r.is_gm && s === "selling_build";
/** pricing_file_build_price / pricing_file_propose. */
export const canBuildPrice = (s: PricingState, r: PricingRights): boolean =>
  r.is_gm && r.can_read_cost && s === "selling_build";
```

- [ ] **Step 5: Write `src/lib/pricing-grid.ts`**

```ts
// =============================================================================
// Pure mirror of public.pricing_selling_grid / pricing_selling_totals
// (20261104140000). The database computes every figure the screens show; this
// exists so the arithmetic is unit-tested in TypeScript and held to the SQL by
// pricing-grid.contract.test.ts. Margin is on price (Phase 8).
// =============================================================================

/** Half away from zero to 2 decimals, like SQL round(numeric, 2). */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
}

export type LogisticsRates = {
  container_rate: number;
  customs_pct: number;
  clearing_fee: number;
  delivery_jeddah: number;
  delivery_riyadh: number;
};
export type LogisticsInputs = { containers: number; delivery: "none" | "jeddah" | "riyadh"; clearing: boolean };

export function logisticsTotal(i: LogisticsInputs, r: LogisticsRates, goodsValue: number): number {
  const delivery = i.delivery === "jeddah" ? r.delivery_jeddah : i.delivery === "riyadh" ? r.delivery_riyadh : 0;
  return round2(i.containers * r.container_rate + (goodsValue * r.customs_pct) / 100 + (i.clearing ? r.clearing_fee : 0) + delivery);
}

export function shares(values: number[]): number[] {
  if (values.length === 0) return [];
  const total = values.reduce((a, b) => a + b, 0);
  return total > 0 ? values.map((v) => v / total) : values.map(() => 1 / values.length);
}

export function sellingFromMargin(cost: number, marginPctOnPrice: number): number {
  if (!(marginPctOnPrice > -100 && marginPctOnPrice < 100)) throw new RangeError("margin must be above -100 and below 100");
  return round2(cost / (1 - marginPctOnPrice / 100));
}

export function marginPct(selling: number, cost: number): number | null {
  return selling > 0 ? round2(((selling - cost) / selling) * 100) : null;
}

/** estimation_cost_basis on the estimation pricing_file_build_price writes (wastage 0). */
export function fileTotalCost(t: { materials: number; extras: number; logistics: number; installation: number; overheadPct: number }): number {
  const subtotal = t.materials + t.extras + t.logistics + t.installation;
  return round2(subtotal + (subtotal * t.overheadPct) / 100);
}

export type GridLineInput = {
  quantity: number;
  /** The chosen supplier unit price (normal or with screen); null = no supplier price. */
  unitMaterial: number | null;
  /** pricing_installation_cost for the line's type; null = no rate in force. */
  unitInstall: number | null;
  marginPct: number | null;
  typedSelling: number | null;
};
export type FileInput = {
  fallbackPct: number;
  defaultMarginPct: number;
  overheadPct: number;
  /** Accepted extras of the current round, already rounded. */
  extrasTotal: number;
  logistics: LogisticsInputs;
  rates: LogisticsRates;
};
export type PricedLine = {
  materials: number | null;
  installation: number;
  installBasis: "rate" | "fallback";
  extrasAlloc: number;
  logisticsAlloc: number;
  lineCost: number;
  selling: number | null;
  marginPct: number | null;
};
export type FileTotals = {
  materialsTotal: number;
  installationTotal: number;
  extrasTotal: number;
  logisticsTotal: number;
  totalCost: number;
  totalSelling: number | null;
  marginPct: number | null;
  unpricedLines: number;
};

export function priceFile(lines: GridLineInput[], file: FileInput): { lines: PricedLine[]; totals: FileTotals } {
  const base = lines.map((l) => {
    const materials = l.unitMaterial == null ? null : round2(l.unitMaterial * l.quantity);
    const installation =
      l.unitInstall != null
        ? round2(l.unitInstall * l.quantity)
        : round2(((l.unitMaterial ?? 0) * l.quantity * file.fallbackPct) / 100);
    return { materials, installation, installBasis: (l.unitInstall != null ? "rate" : "fallback") as PricedLine["installBasis"] };
  });
  const goods = base.reduce((a, b) => a + (b.materials ?? 0), 0);
  const logistics = logisticsTotal(file.logistics, file.rates, goods);
  const sh = shares(base.map((b) => (b.materials ?? 0) + b.installation));
  const priced: PricedLine[] = base.map((b, i) => {
    const l = lines[i];
    const raw = ((b.materials ?? 0) + b.installation + sh[i] * file.extrasTotal + sh[i] * logistics) * (1 + file.overheadPct / 100);
    const selling =
      l.typedSelling != null ? l.typedSelling : l.unitMaterial == null ? null : sellingFromMargin(raw, l.marginPct ?? file.defaultMarginPct);
    return {
      ...b,
      extrasAlloc: round2(sh[i] * file.extrasTotal),
      logisticsAlloc: round2(sh[i] * logistics),
      lineCost: round2(raw),
      selling,
      marginPct: selling != null && selling > 0 ? round2(((selling - raw) / selling) * 100) : null,
    };
  });
  const materialsTotal = round2(priced.reduce((a, p) => a + (p.materials ?? 0), 0));
  const installationTotal = round2(priced.reduce((a, p) => a + p.installation, 0));
  const totalCost = fileTotalCost({ materials: materialsTotal, extras: file.extrasTotal, logistics, installation: installationTotal, overheadPct: file.overheadPct });
  const sold = priced.filter((p) => p.selling != null);
  const totalSelling = sold.length ? round2(sold.reduce((a, p) => a + (p.selling ?? 0), 0)) : null;
  return {
    lines: priced,
    totals: {
      materialsTotal,
      installationTotal,
      extrasTotal: file.extrasTotal,
      logisticsTotal: logistics,
      totalCost,
      totalSelling,
      marginPct: totalSelling != null ? marginPct(totalSelling, totalCost) : null,
      unpricedLines: lines.filter((l) => l.unitMaterial == null).length,
    },
  };
}
```

- [ ] **Step 6: Replace `src/lib/pricing-actions.ts`**

```ts
// RPC wrappers and reads for the pricing loop. Authorization is in SQL; these
// only call it and throw what the database says (the bilingual message is on
// error.message; show it with dbMessage()). Reads go through an untyped view of
// the client because these tables and views are newer than the generated
// Database types (same pattern as ai-actions.ts). Never select "*": several
// sources have column grants and answer 42501 to a star.
import { supabase } from "@/integrations/supabase/client";
import type { InstallType, PricingState } from "@/lib/pricing";
import { NO_RIGHTS, type PricingRights } from "@/lib/pricing-access";

const db = supabase as unknown as { from: (t: string) => any };

async function call<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

async function one<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? null) as T | null;
}

// ---- PR 1 (unchanged) --------------------------------------------------------

/** Opens the deal's pricing file, or returns the one that is already open. */
export const openPricingFile = (opportunityId: string, rfqId?: string | null) =>
  call<{ id: string }>("open_pricing_file", { _opportunity_id: opportunityId, _rfq_id: rfqId ?? null });

/** Moves the file; the database checks the move against pricing_file_transitions. Closing and sending lines back need a note. */
export const movePricingFile = (fileId: string, to: PricingState, note?: string) =>
  call("pricing_file_move", { _file_id: fileId, _to: to, _note: note ?? null });

/** Package review -> needs_info. `due` is a date, YYYY-MM-DD, from today on. */
export const askNeedsInfo = (fileId: string, items: string[], due: string) =>
  call("pricing_file_set_needs_info", { _file_id: fileId, _items: items, _due: due });

export const answerNeedsInfo = (fileId: string, note: string) =>
  call("pricing_file_answer_needs_info", { _file_id: fileId, _note: note });

/** Returns how many new suggestions were added. */
export const suggestExtras = (fileId: string) => call<number>("pricing_suggest_extras", { _file_id: fileId });

/** Accept (optionally with a different quantity or rate) or dismiss with a reason. */
export const decideExtra = (
  extraId: string,
  accept: boolean,
  opts: { quantity?: number; rate?: number; reason?: string } = {},
) =>
  call("pricing_decide_extra", {
    _extra_id: extraId,
    _accept: accept,
    _quantity: opts.quantity ?? null,
    _rate: opts.rate ?? null,
    _reason: opts.reason ?? null,
  });

// ---- Rights, queue, file -------------------------------------------------------

// A named type, not call<Partial<...>>: the contract test reads call<T>("name") with one level of <>.
type RightsRow = Partial<PricingRights>;
export async function getPricingRights(): Promise<PricingRights> {
  return { ...NO_RIGHTS, ...(await call<RightsRow>("pricing_my_rights", {})) };
}

export type QueueRow = {
  file_id: string;
  state: PricingState;
  state_changed_at: string;
  created_at: string;
  due_at: string | null;
  needs_info_items: string[];
  needs_info_due: string | null;
  opportunity_id: string;
  project_name: string | null;
  project_code: string | null;
  owner_id: string | null;
  contract_value: number | null;
  quotation_value: number | null;
  estimated_value_max: number | null;
  boq_revision_id: string | null;
  estimation_id: string | null;
  internal_price_id: string | null;
  closed_reason: string | null;
};
const QUEUE_COLUMNS =
  "file_id, state, state_changed_at, created_at, due_at, needs_info_items, needs_info_due, opportunity_id, project_name, project_code, owner_id, contract_value, quotation_value, estimated_value_max, boq_revision_id, estimation_id, internal_price_id, closed_reason";

export const listPricingQueue = () =>
  rows<QueueRow>(db.from("pricing_queue").select(QUEUE_COLUMNS).neq("state", "closed").order("state_changed_at", { ascending: true }).limit(500));

export const getPricingFile = (fileId: string) =>
  one<QueueRow>(db.from("pricing_queue").select(QUEUE_COLUMNS).eq("file_id", fileId).maybeSingle());

export type FileEvent = {
  id: string;
  file_id: string;
  from_state: PricingState | null;
  to_state: PricingState;
  actor_id: string | null;
  note: string | null;
  created_at: string;
};
// cost_note is not granted: listing the columns is what keeps this read legal.
export const listFileEvents = (fileId: string) =>
  rows<FileEvent>(db.from("pricing_file_events").select("id, file_id, from_state, to_state, actor_id, note, created_at").eq("file_id", fileId).order("created_at", { ascending: false }));

export type CostNote = { id: string; to_state: PricingState; cost_note: string; created_at: string };
export const listCostNotes = (fileId: string) =>
  rows<CostNote>(db.from("pricing_file_cost_notes").select("id, to_state, cost_note, created_at").eq("file_id", fileId).order("created_at", { ascending: false }));

// ---- Package: revisions and lines ----------------------------------------------

export type BoqRevisionRow = {
  id: string;
  revision_number: number;
  status: string;
  frozen_at: string | null;
  is_current: boolean;
  superseded_by: string | null;
  source_type: string;
  created_at: string;
};
export const listDealRevisions = (opportunityId: string) =>
  rows<BoqRevisionRow>(
    db
      .from("boq_revisions")
      .select("id, revision_number, status, frozen_at, is_current, superseded_by, source_type, created_at, boqs!inner(related_opportunity_id)")
      .eq("boqs.related_opportunity_id", opportunityId)
      .order("revision_number", { ascending: false }),
  );

export type BoqLineRow = {
  id: string;
  revision_id: string;
  line_number: number | null;
  sign_type: string;
  description: string | null;
  dimensions: string | null;
  material: string | null;
  location: string | null;
  quantity: number;
  unit: string | null;
  install_type: InstallType | null;
  width_mm: number | null;
  height_mm: number | null;
  weight_kg: number | null;
  mount_height_m: number | null;
  has_screen: boolean;
  needs_floor_cut: boolean;
};
// unit_price / line_total are cost and not granted; never add them here.
const LINE_COLUMNS =
  "id, revision_id, line_number, sign_type, description, dimensions, material, location, quantity, unit, install_type, width_mm, height_mm, weight_kg, mount_height_m, has_screen, needs_floor_cut";
export const listBoqLines = (revisionId: string) =>
  rows<BoqLineRow>(db.from("boq_lines").select(LINE_COLUMNS).eq("revision_id", revisionId).order("line_number", { ascending: true, nullsFirst: false }));

/** One line as pricing_boq_import takes it. */
export type BoqImportLine = {
  sign_type: string;
  quantity: number;
  description?: string | null;
  unit?: string | null;
  dimensions?: string | null;
  material?: string | null;
  mounting?: string | null;
  illumination?: string | null;
  finish?: string | null;
  location?: string | null;
  install_type?: InstallType | null;
  width_mm?: number | null;
  height_mm?: number | null;
  weight_kg?: number | null;
  mount_height_m?: number | null;
  has_screen?: boolean;
  needs_floor_cut?: boolean;
};
export const attachRevision = (fileId: string, revisionId: string) =>
  call("pricing_file_attach_revision", { _file_id: fileId, _revision_id: revisionId });
export const importBoqLines = (fileId: string, lines: BoqImportLine[], replace = false) =>
  call<{ revision_id: string; revision_number: number; inserted: number }>("pricing_boq_import", {
    _file_id: fileId,
    _lines: lines,
    _replace: replace,
  });
export const deleteBoqLine = (fileId: string, lineId: string) =>
  call<null>("pricing_boq_line_delete", { _file_id: fileId, _line_id: lineId });
export const freezeBoq = (fileId: string, status: "verified" | "partially_verified", note: string) =>
  call("pricing_file_freeze_boq", { _file_id: fileId, _status: status, _note: note });

// ---- Supplier and cost --------------------------------------------------------

export type SupplierCostRow = {
  id: string;
  boq_line_id: string;
  vendor_id: string;
  vendor_name: string;
  status: string;
  is_current: boolean;
  unit_cost: number | null;
  unit_cost_with_screen: number | null;
  alternate_spec: string | null;
  lead_time_days: number | null;
};
export const listSupplierCosts = (revisionId: string) =>
  rows<SupplierCostRow>(
    db
      .from("supplier_quote_costs")
      .select("id, boq_line_id, vendor_id, vendor_name, status, is_current, unit_cost, unit_cost_with_screen, alternate_spec, lead_time_days")
      .eq("boq_revision_id", revisionId)
      .eq("is_current", true),
  );

// ---- Selling price ----------------------------------------------------------

export type FileInputs = {
  file_id: string;
  is_cinema: boolean;
  containers: number;
  delivery: "none" | "jeddah" | "riyadh";
  clearing: boolean;
  overhead_pct: number;
  default_margin_pct: number | null;
};
export const getFileInputs = (fileId: string) =>
  one<FileInputs>(db.from("pricing_file_inputs").select("file_id, is_cinema, containers, delivery, clearing, overhead_pct, default_margin_pct").eq("file_id", fileId).maybeSingle());
export const setFileInputs = (fileId: string, inputs: Partial<Omit<FileInputs, "file_id">>) =>
  call<FileInputs>("pricing_file_set_inputs", { _file_id: fileId, _inputs: inputs });

export type GridRow = {
  file_id: string;
  boq_line_id: string;
  line_number: number | null;
  sign_type: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  has_screen: boolean;
  supplier_quote_line_id: string | null;
  unit_cost: number | null;
  unit_cost_with_screen: number | null;
  alternate_spec: string | null;
  quotes_count: number;
  use_screen_price: boolean;
  install_type: InstallType | null;
  install_basis: "rate" | "fallback";
  materials: number | null;
  installation: number;
  extras_alloc: number;
  logistics_alloc: number;
  line_cost: number;
  line_margin_pct: number | null;
  typed_selling_price: number | null;
  default_margin_pct: number;
  overhead_pct: number;
  selling_price: number | null;
  margin_pct: number | null;
  extras_total: number;
  logistics_total: number;
  built_cost: number | null;
  built_selling_price: number | null;
  unpriced: boolean;
  screen_price_missing: boolean;
};
const GRID_COLUMNS =
  "file_id, boq_line_id, line_number, sign_type, description, quantity, unit, has_screen, supplier_quote_line_id, unit_cost, unit_cost_with_screen, alternate_spec, quotes_count, use_screen_price, install_type, install_basis, materials, installation, extras_alloc, logistics_alloc, line_cost, line_margin_pct, typed_selling_price, default_margin_pct, overhead_pct, selling_price, margin_pct, extras_total, logistics_total, built_cost, built_selling_price, unpriced, screen_price_missing";
export const listSellingGrid = (fileId: string) =>
  rows<GridRow>(db.from("pricing_selling_grid").select(GRID_COLUMNS).eq("file_id", fileId).order("line_number", { ascending: true, nullsFirst: false }));

export type TotalsRow = {
  file_id: string;
  line_count: number;
  unpriced_lines: number;
  multi_quote_lines: number;
  screen_price_missing_lines: number;
  materials_total: number;
  installation_total: number;
  extras_total: number;
  logistics_total: number;
  overhead_pct: number;
  total_cost: number;
  total_selling: number | null;
  margin_value: number | null;
  margin_pct: number | null;
  floor_pct: number | null;
  below_floor: boolean;
};
export const getSellingTotals = (fileId: string) =>
  one<TotalsRow>(
    db
      .from("pricing_selling_totals")
      .select("file_id, line_count, unpriced_lines, multi_quote_lines, screen_price_missing_lines, materials_total, installation_total, extras_total, logistics_total, overhead_pct, total_cost, total_selling, margin_value, margin_pct, floor_pct, below_floor")
      .eq("file_id", fileId)
      .maybeSingle(),
  );

/** Cost keys (pricer or GM) and selling keys (GM). null clears a choice. */
export type LineChoice = {
  use_screen_price?: boolean | null;
  install_type?: InstallType | null;
  margin_pct?: number | null;
  selling_price?: number | null;
};
export const setLineChoice = (fileId: string, boqLineId: string, choice: LineChoice) =>
  call("pricing_file_set_line", { _file_id: fileId, _boq_line_id: boqLineId, _choice: choice });

export type CatalogRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  unit: "lump" | "item" | "m2";
  default_rate: number;
  suggest_for: InstallType[];
  suggest_min_height_m: number | null;
  suggest_if_cinema: boolean;
  active: boolean;
  effective_from: string;
};
const CATALOG_COLUMNS = "id, code, name_en, name_ar, unit, default_rate, suggest_for, suggest_min_height_m, suggest_if_cinema, active, effective_from";
export const listCatalog = () => rows<CatalogRow>(db.from("pricing_extras_catalog").select(CATALOG_COLUMNS).order("name_en"));

export type FileExtraRow = {
  id: string;
  catalog_id: string;
  quantity: number;
  rate: number;
  status: "suggested" | "accepted" | "dismissed";
  dismiss_reason: string | null;
  source_line_id: string | null;
  boq_revision_id: string;
  catalog: { code: string; name_en: string; name_ar: string; unit: CatalogRow["unit"] } | null;
};
export const listFileExtras = (fileId: string, revisionId: string) =>
  rows<FileExtraRow>(
    db
      .from("pricing_file_extras")
      .select("id, catalog_id, quantity, rate, status, dismiss_reason, source_line_id, boq_revision_id, catalog:pricing_extras_catalog(code, name_en, name_ar, unit)")
      .eq("file_id", fileId)
      .eq("boq_revision_id", revisionId)
      .order("created_at"),
  );
export const addExtra = (fileId: string, catalogId: string, quantity: number, rate?: number | null) =>
  call("pricing_add_extra", { _file_id: fileId, _catalog_id: catalogId, _quantity: quantity, _rate: rate ?? null });

export type BuildResult = {
  internal_price_id: string;
  estimation_id: string;
  total_cost: number;
  total_selling: number;
  margin_pct: number | null;
  floor_pct: number | null;
  below_floor: boolean;
};
export const buildPrice = (fileId: string) => call<BuildResult>("pricing_file_build_price", { _file_id: fileId });
/** expectedTotal is the total the GM was shown; the server refuses a stale one. */
export const proposePrice = (fileId: string, expectedTotal: number, expectedTotalCost: number, justification?: string) =>
  call("pricing_file_propose", { _file_id: fileId, _expected_total: expectedTotal, _expected_total_cost: expectedTotalCost, _justification: justification ?? null });

export type PriceSummary = {
  id: string;
  status: string;
  proposed_price: number | null;
  margin_value: number | null;
  margin_percentage: number | null;
  proposed_by: string | null;
  proposed_at: string | null;
  return_reason: string | null;
};
export const getPriceSummary = (priceId: string) =>
  one<PriceSummary>(db.from("internal_price_summary").select("id, status, proposed_price, margin_value, margin_percentage, proposed_by, proposed_at, return_reason").eq("id", priceId).maybeSingle());

// ---- Settings -----------------------------------------------------------------

export type InstallationRateRow = {
  id: string;
  install_type: InstallType;
  base_rate: number;
  per_kg_over: number;
  weight_threshold_kg: number | null;
  per_m_over: number;
  height_threshold_m: number | null;
  floor_cut_add: number;
  scaffold_add: number;
  crane_add: number;
  effective_from: string;
  effective_to: string | null;
};
export const listInstallationRates = () =>
  rows<InstallationRateRow>(
    db
      .from("installation_rates")
      .select("id, install_type, base_rate, per_kg_over, weight_threshold_kg, per_m_over, height_threshold_m, floor_cut_add, scaffold_add, crane_add, effective_from, effective_to")
      .order("install_type")
      .order("effective_from", { ascending: false }),
  );
export type RateInput = Omit<InstallationRateRow, "id" | "effective_to">;
export const setInstallationRate = (r: RateInput) =>
  call("pricing_set_installation_rate", {
    _type: r.install_type,
    _from: r.effective_from,
    _base_rate: r.base_rate,
    _per_kg_over: r.per_kg_over,
    _weight_threshold_kg: r.weight_threshold_kg,
    _per_m_over: r.per_m_over,
    _height_threshold_m: r.height_threshold_m,
    _floor_cut_add: r.floor_cut_add,
    _scaffold_add: r.scaffold_add,
    _crane_add: r.crane_add,
  });

export type LogisticsRateKey =
  | "container_rate" | "customs_pct" | "clearing_fee" | "delivery_jeddah" | "delivery_riyadh"
  | "install_fallback_pct" | "default_margin_pct";
export type LogisticsRateRow = { key: LogisticsRateKey; value: number; currency: string; note: string | null; effective_from: string; updated_at: string };
export const listLogisticsRates = () =>
  rows<LogisticsRateRow>(db.from("logistics_rates").select("key, value, currency, note, effective_from, updated_at").order("key"));
export async function updateLogisticsRate(key: LogisticsRateKey, value: number, note: string | null): Promise<void> {
  const { error } = await db.from("logistics_rates").update({ value, note }).eq("key", key);
  if (error) throw error;
}

export type CatalogInput = Omit<CatalogRow, "id" | "effective_from">;
export async function saveCatalogItem(id: string | null, item: CatalogInput): Promise<void> {
  const { error } = id
    ? await db.from("pricing_extras_catalog").update(item).eq("id", id)
    : await db.from("pricing_extras_catalog").insert(item);
  if (error) throw error;
}

export type MarginFloorRow = { id: string; min_margin_pct: number; effective_from: string; rationale: string | null };
export async function getMarginFloor(): Promise<MarginFloorRow | null> {
  const list = await rows<MarginFloorRow>(
    db.from("margin_policies").select("id, min_margin_pct, effective_from, effective_to, rationale").is("effective_to", null).order("effective_from", { ascending: false }).limit(1),
  );
  return list[0] ?? null;
}
export const setMarginFloor = (pct: number, rationale: string) =>
  call("pricing_set_margin_floor", { _min_margin_pct: pct, _rationale: rationale });
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `bun test src/lib/pricing-text.test.ts src/lib/pricing-access.test.ts src/lib/pricing-grid.test.ts src/lib/pricing-grid.contract.test.ts src/lib/pricing-actions.contract.test.ts src/lib/pricing.test.ts src/lib/pricing.contract.test.ts`
Expected: all PASS. Then run `bun run typecheck && bun run lint`. Expected: no errors. `src/lib/pricing.ts` is unchanged, so PR 1's tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pricing-text.ts src/lib/pricing-text.test.ts src/lib/pricing-access.ts src/lib/pricing-access.test.ts src/lib/pricing-grid.ts src/lib/pricing-grid.test.ts src/lib/pricing-grid.contract.test.ts src/lib/pricing-actions.ts src/lib/pricing-actions.contract.test.ts
git commit -m "feat(pricing): TypeScript layer for the screens (access mirror, grid mirror, reads and RPC wrappers)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sidebar group, pricing queue, pricing file shell (UI)

**Files:**
- Modify: `src/components/phc/AppShell.tsx` (imports; `NavLink` type; new group after `navgroup_production`; item filter; most-specific active link)
- Modify: `src/lib/i18n.tsx` (three nav keys)
- Modify: `src/components/phc/CommandPalette.tsx` (two pages)
- Modify: `src/lib/phase-1-sales-ia.contract.test.ts`, `src/lib/phase2-page-consolidation.contract.test.ts`
- Create: `src/components/phc/pricing/types.ts`, `src/components/phc/pricing/usePricingRights.ts`
- Create: `src/components/phc/pricing/PackageTab.tsx`, `SupplierTab.tsx`, `CostReviewTab.tsx`, `SellingPriceTab.tsx`. Stubs here; Tasks 9–11 replace them whole.
- Create: `src/routes/_authenticated/pricing.index.tsx`, `src/routes/_authenticated/pricing.$id.tsx`
- Create: `src/routes/_authenticated/pricing.settings.tsx`. A stub here, so the sidebar's typed `to: "/pricing/settings"` compiles; Task 12 replaces it whole.
- Modify (generated): `src/routeTree.gen.ts`

**Interfaces:**
- Consumes (Task 7):
  - From `@/lib/pricing-actions`: `getPricingRights`, `listPricingQueue`, `getPricingFile`, `listFileEvents`, `listCostNotes`, `openPricingFile`, `movePricingFile`, `QueueRow`.
  - From `@/lib/pricing-access`: `canSeePricingNav`, `canOpenPricing`, `visibleTabs`, `defaultTab`, `parsePricingTab`, `PRICING_TAB_LABEL`, `nextOwner`, `NEXT_OWNER_LABEL`, `inQueue`, `defaultQueueFilter`, `daysWaiting`, `NO_RIGHTS`, `PricingTab`, `QueueFilter`, `PricingRights`.
  - From `@/lib/pricing-text`: `pick`, `dbMessage`, `asError`, `Bi`.
  - PR 1 `@/lib/pricing`: `PRICING_STATE_LABEL`, `canPricerMove`.
  - `@/lib/opportunity-value`: `opportunityValue`. `@/lib/meetings-actions`: `searchOpportunities(q)`.
- Produces:
  - `type PricingTabProps = { file: QueueRow; rights: PricingRights; onChanged: () => void }` in `src/components/phc/pricing/types.ts`.
  - `usePricingRights()`, a react-query result of `PricingRights`, query key `["pricing-rights"]`.
  - Tab components `PackageTab`, `SupplierTab`, `CostReviewTab`, `SellingPriceTab`, each `(props: PricingTabProps) => JSX.Element`, exported by name from `src/components/phc/pricing/<Name>.tsx`.
  - Routes `/pricing` and `/pricing/$id?tab=package|supplier|cost|selling`.
  - Query keys under `"pricing-…"`. The shell's `onChanged` invalidates every query whose first key starts with `"pricing-"`.

- [ ] **Step 1: Update the two sidebar contract tests (they fail first)**

In `src/lib/phase-1-sales-ia.contract.test.ts`, change the `REMOVED` list and add a test after the `test.each(REMOVED)` blocks:

```ts
describe("surfaces removed from primary business navigation", () => {
  const REMOVED = ["/follow-ups", "/targets", "/award-queue", "/tender-conversion"];
```

```ts
  test("/quotations is back, in Pricing & Finance (the section it was waiting for)", () => {
    const group = APP_SHELL.slice(
      APP_SHELL.indexOf('key: "navgroup_pricing_finance"'),
      APP_SHELL.indexOf('key: "navgroup_reports"'),
    );
    expect(group).toContain('to: "/pricing"');
    expect(group).toContain('to: "/quotations"');
    expect(group).toContain('to: "/pricing/settings"');
    expect(PALETTE).toContain('to: "/quotations"');
    expect(PALETTE).toContain('to: "/pricing"');
  });
```

In `src/lib/phase2-page-consolidation.contract.test.ts`, replace:

```ts
// Phase 1 (PRD 2026-08-12): /quotations left the Sales sidebar — it belongs to
// Commercial & Finance, which does not exist yet. This test used to require
// `to: "/quotations"` in AppShell, which would have blocked that move. What
// actually matters is that the route keeps working and stays reachable, so
// that is what is asserted now.
test("/quotations is out of the sidebar but still routable and still reachable", () => {
  expect(read("src/components/phc/AppShell.tsx")).not.toMatch(/to: "\/quotations"/);
```

with:

```ts
// Phase 1 (PRD 2026-08-12): /quotations left the Sales sidebar because it
// belongs to Commercial & Finance. Pricing loop PR 2 (2026-11-04) builds that
// section, "Pricing & Finance", and /quotations is in the sidebar there.
test("/quotations is in the Pricing & Finance group, still routable and still reachable", () => {
  const shell = read("src/components/phc/AppShell.tsx");
  const group = shell.slice(shell.indexOf('key: "navgroup_pricing_finance"'), shell.indexOf('key: "navgroup_reports"'));
  expect(group).toMatch(/to: "\/quotations"/);
```

(The rest of that test body stays as it is.)

Run: `bun test src/lib/phase-1-sales-ia.contract.test.ts src/lib/phase2-page-consolidation.contract.test.ts`
Expected: FAIL. There is no `navgroup_pricing_finance` yet.

- [ ] **Step 2: Add the nav keys to `src/lib/i18n.tsx`**

After the line `  navgroup_admin: { en: "Admin", ar: "الإدارة" },` add:

```ts
  navgroup_pricing_finance: { en: "Pricing & Finance", ar: "التسعير والمالية" },
  nav_pricing_queue: { en: "Pricing queue", ar: "قائمة التسعير" },
  nav_pricing_settings: { en: "Pricing settings", ar: "إعدادات التسعير" },
```

- [ ] **Step 3: Add the group to `src/components/phc/AppShell.tsx`**

1. In the `lucide-react` import list add `Calculator,`, `FileText,` and `SlidersHorizontal,`. Below the existing `import { requiresMfa } from "@/lib/roles";` add:

```ts
import { canSeePricingNav } from "@/lib/pricing-access";
```

2. In `type NavLink`, after `requireAdmin?: boolean;` add:

```ts
  /** Shown only when this returns true for the user's roles (SQL still decides access). */
  showIf?: (roles: readonly AppRole[]) => boolean;
```

3. In `NAV_GROUPS`, insert this group between the `navgroup_production` group and the `navgroup_reports` group:

```ts
  {
    // Commercial & Finance, part 1 (spec 2026-11-03-pricing-loop-design §4):
    // the pricing loop. /quotations, which left Sales in Phase 1 to wait for
    // this section, is back here. Queue and settings show to cost readers; a
    // GM delegate without a cost role reaches /pricing by link.
    key: "navgroup_pricing_finance",
    fallback: "Pricing & Finance",
    items: [
      { kind: "link", to: "/pricing", key: "nav_pricing_queue", icon: Calculator, showIf: canSeePricingNav },
      { kind: "link", to: "/quotations", key: "nav_quotations", icon: FileText },
      { kind: "link", to: "/pricing/settings", key: "nav_pricing_settings", icon: SlidersHorizontal, showIf: canSeePricingNav },
    ],
  },
```

4. Right after the closing `];` of `NAV_GROUPS` add:

```ts
// Every sidebar path, so a link is not lit when a longer one under it is
// (/pricing must not light up on /pricing/settings).
const NAV_LINK_PATHS: string[] = NAV_GROUPS.flatMap((g) =>
  g.items.flatMap((i) => (i.kind === "link" ? [String(i.to)] : [])),
);
```

5. In `renderNavItem`, replace the line `const active = isActive(n.to ?? "") && filterMatches;` with:

```ts
    const deeper = NAV_LINK_PATHS.some(
      (p) => p !== String(n.to) && p.startsWith(String(n.to) + "/") && isActive(p),
    );
    const active = isActive(n.to ?? "") && filterMatches && !deeper;
```

6. In the sidebar's `NAV_GROUPS.map`, replace the `visibleItems` filter:

```ts
          const visibleItems = g.items.filter(
            (n) =>
              (!(n.kind === "link" && n.requireAdmin) || canAdmin) &&
              !(n.kind === "link" && n.showIf && !n.showIf(roles as AppRole[])),
          );
```

- [ ] **Step 4: Add the pages to `src/components/phc/CommandPalette.tsx`**

Add `Calculator,` and `SlidersHorizontal,` to its `lucide-react` import, and after the `/quotations` entry in `PAGES` add:

```ts
  { to: "/pricing",           labelEn: "Pricing queue",       labelAr: "قائمة التسعير",                 group: "Execution", icon: Calculator },
  { to: "/pricing/settings",  labelEn: "Pricing settings",    labelAr: "إعدادات التسعير",               group: "Execution", icon: SlidersHorizontal },
```

- [ ] **Step 5: Create the shared tab types, the rights hook and the four stubs**

`src/components/phc/pricing/types.ts`:

```ts
import type { QueueRow } from "@/lib/pricing-actions";
import type { PricingRights } from "@/lib/pricing-access";

/** Every pricing-file tab gets the file (from pricing_queue), the caller's rights, and a refresh. */
export type PricingTabProps = { file: QueueRow; rights: PricingRights; onChanged: () => void };
```

`src/components/phc/pricing/usePricingRights.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getPricingRights } from "@/lib/pricing-actions";

/** What pricing_my_rights() says the caller may do. A GM delegate is known only to SQL. */
export const usePricingRights = () =>
  useQuery({ queryKey: ["pricing-rights"], queryFn: getPricingRights, staleTime: 60_000 });
```

Four stubs. Tasks 9, 10 and 11 replace each file whole.

`src/components/phc/pricing/PackageTab.tsx`:

```tsx
import type { PricingTabProps } from "@/components/phc/pricing/types";

// Placeholder until the tab's own task replaces this file.
export function PackageTab({ file }: PricingTabProps) {
  return <p className="text-sm text-muted-foreground">{file.state}</p>;
}
```

`src/components/phc/pricing/SupplierTab.tsx`:

```tsx
import type { PricingTabProps } from "@/components/phc/pricing/types";

// Placeholder until the tab's own task replaces this file.
export function SupplierTab({ file }: PricingTabProps) {
  return <p className="text-sm text-muted-foreground">{file.state}</p>;
}
```

`src/components/phc/pricing/CostReviewTab.tsx`:

```tsx
import type { PricingTabProps } from "@/components/phc/pricing/types";

// Placeholder until the tab's own task replaces this file.
export function CostReviewTab({ file }: PricingTabProps) {
  return <p className="text-sm text-muted-foreground">{file.state}</p>;
}
```

`src/components/phc/pricing/SellingPriceTab.tsx`:

```tsx
import type { PricingTabProps } from "@/components/phc/pricing/types";

// Placeholder until the tab's own task replaces this file.
export function SellingPriceTab({ file }: PricingTabProps) {
  return <p className="text-sm text-muted-foreground">{file.state}</p>;
}
```

- [ ] **Step 6: Create `src/routes/_authenticated/pricing.index.tsx`**

```tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Calculator, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { PRICING_STATE_LABEL } from "@/lib/pricing";
import { listPricingQueue, openPricingFile } from "@/lib/pricing-actions";
import {
  canOpenPricing, daysWaiting, defaultQueueFilter, inQueue, nextOwner, NEXT_OWNER_LABEL, NO_RIGHTS,
  type QueueFilter,
} from "@/lib/pricing-access";
import { opportunityValue } from "@/lib/opportunity-value";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { searchOpportunities } from "@/lib/meetings-actions";
import { usePricingRights } from "@/components/phc/pricing/usePricingRights";

export const Route = createFileRoute("/_authenticated/pricing/")({
  head: () => ({ meta: [{ title: "Pricing — PHC" }, { name: "robots", content: "noindex" }] }),
  component: PricingQueuePage,
});

const TEXT = {
  eyebrow: { en: "Pricing & Finance", ar: "التسعير والمالية" },
  title: { en: "Pricing queue", ar: "قائمة التسعير" },
  desc: { en: "Open pricing files: where each price is, who owes the next step, and for how long.", ar: "ملفات التسعير المفتوحة: أين وصل كل سعر، ومن عليه الخطوة التالية، ومنذ متى." },
  all: { en: "All open", ar: "كل المفتوح" },
  pricer: { en: "Estimation & finance", ar: "التقدير والمالية" },
  gm: { en: "Set selling price (GM)", ar: "وضع سعر البيع (المدير العام)" },
  project: { en: "Project", ar: "المشروع" },
  state: { en: "State", ar: "الحالة" },
  next: { en: "Next step", ar: "الخطوة التالية" },
  waiting: { en: "Waiting", ar: "الانتظار" },
  value: { en: "Deal value", ar: "قيمة الفرصة" },
  days: { en: "days", ar: "يوم" },
  overdue: { en: "Missing items overdue", ar: "النواقص متأخرة" },
  empty: { en: "Nothing waiting here", ar: "لا شيء بالانتظار هنا" },
  emptyHint: { en: "A pricing file opens by itself when an RFQ is saved on a deal.", ar: "يُفتح ملف التسعير تلقائياً عند حفظ طلب تسعير على فرصة." },
  noAccess: { en: "Pricing is for estimation, finance and management", ar: "التسعير للتقدير والمالية والإدارة" },
  noAccessHint: { en: "Ask your manager if you need to see a price.", ar: "اسأل مديرك إن احتجت رؤية سعر." },
  openTitle: { en: "Open a pricing file for a deal", ar: "افتح ملف تسعير لفرصة" },
  openHint: { en: "For deals whose RFQ came in before pricing files existed.", ar: "للفرص التي وصل طلبها قبل ملفات التسعير." },
  search: { en: "Search deals by name…", ar: "ابحث عن فرصة بالاسم…" },
  open: { en: "Open file", ar: "افتح الملف" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

function PricingQueuePage() {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const rights = usePricingRights();
  const r = rights.data ?? NO_RIGHTS;
  const allowed = canOpenPricing(r);
  const queue = useQuery({ queryKey: ["pricing-queue"], queryFn: listPricingQueue, enabled: allowed });
  const [chosen, setChosen] = useState<QueueFilter | null>(null);
  const filter = chosen ?? defaultQueueFilter(r);
  const [term, setTerm] = useState("");
  const deals = useQuery({
    queryKey: ["pricing-deal-search", term],
    queryFn: () => searchOpportunities(term),
    enabled: r.is_pricer && term.trim().length >= 2,
  });
  const today = new Date().toISOString().slice(0, 10);

  const shown = useMemo(
    () =>
      (queue.data ?? [])
        .filter((row) => inQueue(row.state, filter))
        .map((row) => ({ row, days: daysWaiting(row.state_changed_at) }))
        .sort((a, b) => b.days - a.days),
    [queue.data, filter],
  );

  async function openFor(opportunityId: string) {
    try {
      const f = await openPricingFile(opportunityId);
      await navigate({ to: "/pricing/$id", params: { id: f.id }, search: {} });
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  if (rights.isLoading) return <SkeletonTable />;
  if (!allowed) {
    return <EmptyState icon={Calculator} title={pick(TEXT.noAccess, lang)} description={pick(TEXT.noAccessHint, lang)} />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow={pick(TEXT.eyebrow, lang)} title={pick(TEXT.title, lang)} description={pick(TEXT.desc, lang)} />
      <div className="flex flex-wrap gap-2" role="group" aria-label={pick(TEXT.title, lang)}>
        {(["pricer", "gm", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} aria-pressed={filter === f} onClick={() => setChosen(f)}>
            {pick(TEXT[f], lang)}
          </Button>
        ))}
      </div>

      {queue.isLoading ? (
        <SkeletonTable />
      ) : queue.isError ? (
        <QueryFailure retry={() => queue.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Calculator} title={pick(TEXT.empty, lang)} description={pick(TEXT.emptyHint, lang)} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.project, lang)}</TableHead>
              <TableHead>{pick(TEXT.state, lang)}</TableHead>
              <TableHead>{pick(TEXT.next, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.waiting, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.value, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(({ row, days }) => {
              const overdue = row.state === "needs_info" && row.needs_info_due != null && row.needs_info_due < today;
              return (
                <TableRow key={row.file_id}>
                  <TableCell>
                    <Link to="/pricing/$id" params={{ id: row.file_id }} search={{}} className="font-medium text-foreground hover:underline">
                      {row.project_name ?? "—"}
                    </Link>
                    {row.project_code ? <div className="text-xs text-muted-foreground">{row.project_code}</div> : null}
                  </TableCell>
                  <TableCell>
                    <StatusPill tone={overdue ? "danger" : "neutral"}>{pick(PRICING_STATE_LABEL[row.state], lang)}</StatusPill>
                    {overdue ? <div className="mt-1 text-xs text-destructive">{pick(TEXT.overdue, lang)}</div> : null}
                  </TableCell>
                  <TableCell>{pick(NEXT_OWNER_LABEL[nextOwner(row.state)], lang)}</TableCell>
                  <TableCell className="text-end tabular-nums">{days} {pick(TEXT.days, lang)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(opportunityValue(row), lang)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {r.is_pricer ? (
        <Panel title={pick(TEXT.openTitle, lang)} subtitle={pick(TEXT.openHint, lang)}>
          <div className="space-y-3">
            <input className={FIELD} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={pick(TEXT.search, lang)} aria-label={pick(TEXT.search, lang)} />
            {(deals.data ?? []).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{d.project_name ?? "—"}</span>
                <Button size="sm" variant="outline" onClick={() => void openFor(d.id)}>
                  <FolderPlus className="me-1 h-4 w-4" aria-hidden="true" />
                  {pick(TEXT.open, lang)}
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Create `src/routes/_authenticated/pricing.$id.tsx`**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, localeFor, formatCurrency } from "@/lib/i18n";
import { canPricerMove, PRICING_STATE_LABEL } from "@/lib/pricing";
import { getPricingFile, listCostNotes, listFileEvents, movePricingFile } from "@/lib/pricing-actions";
import {
  canOpenPricing, daysWaiting, defaultTab, nextOwner, NEXT_OWNER_LABEL, NO_RIGHTS, parsePricingTab,
  PRICING_TAB_LABEL, visibleTabs, type PricingTab,
} from "@/lib/pricing-access";
import { opportunityValue } from "@/lib/opportunity-value";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { usePricingRights } from "@/components/phc/pricing/usePricingRights";
import { PackageTab } from "@/components/phc/pricing/PackageTab";
import { SupplierTab } from "@/components/phc/pricing/SupplierTab";
import { CostReviewTab } from "@/components/phc/pricing/CostReviewTab";
import { SellingPriceTab } from "@/components/phc/pricing/SellingPriceTab";

export const Route = createFileRoute("/_authenticated/pricing/$id")({
  validateSearch: (s: Record<string, unknown>): { tab?: PricingTab } => ({ tab: parsePricingTab(s.tab) }),
  head: () => ({ meta: [{ title: "Pricing file — PHC" }, { name: "robots", content: "noindex" }] }),
  component: PricingFilePage,
});

const TEXT = {
  eyebrow: { en: "Pricing file", ar: "ملف التسعير" },
  next: { en: "Next step", ar: "الخطوة التالية" },
  waiting: { en: "waiting", ar: "بالانتظار" },
  days: { en: "days", ar: "يوم" },
  value: { en: "Deal value", ar: "قيمة الفرصة" },
  deal: { en: "Open the deal", ar: "افتح الفرصة" },
  start: { en: "Start package review", ar: "ابدأ دراسة الباكيج" },
  started: { en: "Package review started", ar: "بدأت دراسة الباكيج" },
  close: { en: "Close file", ar: "أغلق الملف" },
  closeTitle: { en: "Close this pricing file", ar: "إغلاق ملف التسعير" },
  closeDesc: { en: "The reason is visible to the sales rep on the deal. Do not write cost or margin reasons here.", ar: "السبب ظاهر لمندوب المبيعات في الفرصة. لا تكتب هنا أسباباً تخص التكلفة أو الهامش." },
  reason: { en: "Reason", ar: "السبب" },
  closed: { en: "Closed", ar: "مغلق" },
  history: { en: "History", ar: "السجل" },
  costNote: { en: "Cost note", ar: "ملاحظة تكلفة" },
  noHistory: { en: "No moves yet.", ar: "لا حركات بعد." },
  notFound: { en: "Pricing file not found", ar: "ملف التسعير غير موجود" },
  noAccess: { en: "Pricing is for estimation, finance and management", ar: "التسعير للتقدير والمالية والإدارة" },
} satisfies Record<string, Bi>;

function PricingFilePage() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const rights = usePricingRights();
  const r = rights.data ?? NO_RIGHTS;
  const allowed = canOpenPricing(r);
  const file = useQuery({ queryKey: ["pricing-file", id], queryFn: () => getPricingFile(id), enabled: allowed });
  const events = useQuery({ queryKey: ["pricing-events", id], queryFn: () => listFileEvents(id), enabled: allowed });
  const notes = useQuery({ queryKey: ["pricing-cost-notes", id], queryFn: () => listCostNotes(id), enabled: allowed && r.can_read_cost });
  const [closeOpen, setCloseOpen] = useState(false);

  const onChanged = () => {
    void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("pricing-") });
  };

  if (rights.isLoading || (allowed && file.isLoading)) return <SkeletonTable />;
  if (!allowed) return <EmptyState icon={Calculator} title={pick(TEXT.noAccess, lang)} />;
  if (file.isError) return <QueryFailure retry={() => file.refetch()} />;
  if (!file.data) return <EmptyState icon={Calculator} title={pick(TEXT.notFound, lang)} />;

  const f = file.data;
  const tabs = visibleTabs(r);
  const current: PricingTab = tab && tabs.includes(tab) ? tab : defaultTab(f.state, r);
  const props = { file: f, rights: r, onChanged };

  async function start() {
    try {
      await movePricingFile(f.file_id, "package_review");
      toast.success(pick(TEXT.started, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow={f.project_code ? `${pick(TEXT.eyebrow, lang)} · ${f.project_code}` : pick(TEXT.eyebrow, lang)}
        title={f.project_name ?? "—"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={f.state === "closed" ? "muted" : "neutral"}>{pick(PRICING_STATE_LABEL[f.state], lang)}</StatusPill>
            <span>
              {pick(TEXT.next, lang)}: {pick(NEXT_OWNER_LABEL[nextOwner(f.state)], lang)} · {daysWaiting(f.state_changed_at)} {pick(TEXT.days, lang)} {pick(TEXT.waiting, lang)}
            </span>
            <span>
              {pick(TEXT.value, lang)}: {formatCurrency(opportunityValue(f), lang)}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/opportunities/$id" params={{ id: f.opportunity_id }}>{pick(TEXT.deal, lang)}</Link>
            </Button>
            {r.is_pricer && f.state === "received" ? (
              <Button size="sm" onClick={() => void start()}>{pick(TEXT.start, lang)}</Button>
            ) : null}
            {r.is_pricer && canPricerMove(f.state, "closed") ? (
              <Button size="sm" variant="outline" onClick={() => setCloseOpen(true)}>{pick(TEXT.close, lang)}</Button>
            ) : null}
          </div>
        }
      />

      {f.state === "closed" && f.closed_reason ? (
        <p className="text-sm text-muted-foreground">
          {pick(TEXT.closed, lang)}: {f.closed_reason}
        </p>
      ) : null}

      <Tabs value={current} onValueChange={(v) => void navigate({ search: { tab: v as PricingTab } })}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t}>{pick(PRICING_TAB_LABEL[t], lang)}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="package"><PackageTab {...props} /></TabsContent>
        <TabsContent value="supplier"><SupplierTab {...props} /></TabsContent>
        {tabs.includes("cost") ? <TabsContent value="cost"><CostReviewTab {...props} /></TabsContent> : null}
        {tabs.includes("selling") ? <TabsContent value="selling"><SellingPriceTab {...props} /></TabsContent> : null}
      </Tabs>

      <Panel title={pick(TEXT.history, lang)}>
        {(events.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{pick(TEXT.noHistory, lang)}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(events.data ?? []).map((e) => (
              <li key={e.id}>
                <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString(localeFor(lang))}</span>{" "}
                {e.from_state ? `${pick(PRICING_STATE_LABEL[e.from_state], lang)} → ` : ""}
                {pick(PRICING_STATE_LABEL[e.to_state], lang)}
                {e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}
              </li>
            ))}
            {(notes.data ?? []).map((n) => (
              <li key={`c-${n.id}`}>
                <span className="text-muted-foreground">{new Date(n.created_at).toLocaleString(localeFor(lang))}</span>{" "}
                {pick(TEXT.costNote, lang)} ({pick(PRICING_STATE_LABEL[n.to_state], lang)}): {n.cost_note}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ActionDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title={pick(TEXT.closeTitle, lang)}
        description={pick(TEXT.closeDesc, lang)}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.close, lang)}
        destructive
        recordId={f.file_id}
        onSubmit={async (v) => {
          try {
            await movePricingFile(f.file_id, "closed", v.reason);
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 8: Create the settings route stub, regenerate the route tree, verify**

Create `src/routes/_authenticated/pricing.settings.tsx` (Task 12 replaces it whole):

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/pricing/settings")({
  head: () => ({ meta: [{ title: "Pricing settings — PHC" }, { name: "robots", content: "noindex" }] }),
  component: () => null,
});
```

Run: `bun run build`. This regenerates `src/routeTree.gen.ts` with `/pricing/`, `/pricing/$id` and `/pricing/settings`. Then run `bun run verify`.
Expected:
- the typecheck passes;
- lint has 0 errors;
- all tests pass, including the two updated contract tests and `ui-baseline` (no raw `<table>`, no bare `toLocaleString(lang)`);
- the build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/components/phc/AppShell.tsx src/lib/i18n.tsx src/components/phc/CommandPalette.tsx src/lib/phase-1-sales-ia.contract.test.ts src/lib/phase2-page-consolidation.contract.test.ts src/components/phc/pricing src/routes/_authenticated/pricing.index.tsx 'src/routes/_authenticated/pricing.$id.tsx' src/routes/_authenticated/pricing.settings.tsx src/routeTree.gen.ts
git commit -m "feat(pricing): Pricing & Finance sidebar group, pricing queue and pricing file shell" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Package tab: checklist, files, BOQ import with column mapping, manual lines, missing items, freeze (UI)

**Files:**
- Modify: `package.json`, `bun.lock` (add `xlsx` from the SheetJS CDN tarball)
- Create: `src/lib/boq-import.ts`, `src/lib/boq-import.test.ts`
- Create: `src/components/phc/pricing/BoqImportDialog.tsx`, `src/components/phc/pricing/BoqLineForm.tsx`
- Replace: `src/components/phc/pricing/PackageTab.tsx`

**Interfaces:**
- Consumes:
  - Task 7: `listDealRevisions`, `listBoqLines`, `attachRevision`, `importBoqLines`, `deleteBoqLine`, `freezeBoq`, `askNeedsInfo`, `answerNeedsInfo` and the types `BoqImportLine`, `BoqRevisionRow`, `BoqLineRow` (`@/lib/pricing-actions`); `canEditPackage` (`@/lib/pricing-access`); `pick`, `dbMessage`, `asError`, `Bi` (`@/lib/pricing-text`).
  - Task 8: `PricingTabProps`.
  - Existing: `DocumentsPanel({ entity: { type: "opportunity", id }, title })`, `ActionDialog`, `Panel`, `Table*`, `Dialog*` (`@/components/ui/dialog`).
- Produces:
  - `src/lib/boq-import.ts`: `INSTALL_TYPES`, `INSTALL_TYPE_LABEL: Record<InstallType, Bi>`, `BOQ_FIELDS`, `type BoqField`, `type ColumnMapping = Partial<Record<BoqField, number>>`, `BOQ_FIELD_LABEL: Record<BoqField, Bi>`, `guessMapping(header: readonly unknown[]): ColumnMapping`, `findHeaderRow(rows: readonly (readonly unknown[])[]): number`, `parseNumber(v: unknown): number | null`, `parseBool(v: unknown): boolean | null`, `parseInstallType(v: unknown): InstallType | null`, `parseDimensions(v: unknown): { width_mm: number; height_mm: number } | null`, `type RowError = { row: number; message: Bi }`, `mapRows(rows, headerRow, mapping): { lines: BoqImportLine[]; errors: RowError[]; skipped: number }`, `readWorkbook(file: File): Promise<{ name: string; rows: unknown[][] }[]>`.
  - `BoqImportDialog({ open, onOpenChange, fileId, onDone })` and `BoqLineForm({ fileId, onDone })`.
  - `PackageTab(props: PricingTabProps)`.

- [ ] **Step 1: Add the spreadsheet library**

Run: `bun add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
Expected: `package.json` gains `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`. It is the same SheetJS release `supabase/functions/_shared/spreadsheet.ts` pins; do not install the npm-registry `xlsx`. Then run `bun audit --audit-level=high` and expect no new finding.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/boq-import.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { findHeaderRow, guessMapping, mapRows, parseBool, parseDimensions, parseInstallType, parseNumber } from "@/lib/boq-import";

describe("column mapping", () => {
  it("maps English headers, preferring the longest match", () => {
    const m = guessMapping(["No.", "Sign Type", "Description", "Qty", "Size", "Install Type", "Mounting Height", "Screen"]);
    expect(m).toMatchObject({ sign_type: 1, description: 2, quantity: 3, dimensions: 4, install_type: 5, mount_height_m: 6, has_screen: 7 });
    expect(m.height_mm).toBeUndefined();
  });
  it("maps Arabic headers", () => {
    expect(guessMapping(["نوع اللوحة", "الكمية", "المقاس", "الموقع"])).toMatchObject({ sign_type: 0, quantity: 1, dimensions: 2, location: 3 });
  });
  it("gives each column to one field only", () => {
    const m = guessMapping(["Type", "Install Type"]);
    expect(m.install_type).toBe(1);
    expect(m.sign_type).toBe(0);
  });
  it("finds the header row under a title block", () => {
    expect(findHeaderRow([["Project X BOQ"], [], ["Sign Type", "Qty", "Material"], ["P1", 2, "Alu"]])).toBe(2);
  });
});

describe("cell parsing", () => {
  it("numbers: thousands separators, units after the number, Arabic-Indic digits", () => {
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("12 pcs")).toBe(12);
    expect(parseNumber(String.fromCharCode(0x0661, 0x0662))).toBe(12);
    expect(parseNumber("about 5")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(7)).toBe(7);
  });
  it("yes and no in both languages", () => {
    expect(parseBool("Yes")).toBe(true);
    expect(parseBool("نعم")).toBe(true);
    expect(parseBool("no")).toBe(false);
    expect(parseBool("maybe")).toBeNull();
  });
  it("install types from common words", () => {
    expect(parseInstallType("Double tape")).toBe("double_tape");
    expect(parseInstallType("wall mounted, screwed")).toBe("wall_screw");
    expect(parseInstallType("Floor standing pylon")).toBe("pylon");
    expect(parseInstallType("سقف")).toBe("ceiling");
    expect(parseInstallType("roof")).toBeNull();
  });
  it("sizes in mm, cm or m", () => {
    expect(parseDimensions("1200 x 600 mm")).toEqual({ width_mm: 1200, height_mm: 600 });
    expect(parseDimensions("120x60cm")).toEqual({ width_mm: 1200, height_mm: 600 });
    expect(parseDimensions("1.2 × 0.6 m")).toEqual({ width_mm: 1200, height_mm: 600 });
    expect(parseDimensions("see drawing")).toBeNull();
  });
});

describe("rows to lines", () => {
  const rows = [
    ["Sign Type", "Qty", "Size", "Install", "Screen"],
    ["Pylon P1", 2, "1200x3000", "pylon", "yes"],
    ["", "", "", "", ""],
    ["Wall W1", "0", "", "", ""],
    ["Ceiling C1", 4, "", "roof", ""],
    ["Total", 6, "", "", ""],
  ];
  const out = mapRows(rows, 0, guessMapping(rows[0]));
  it("keeps good rows with their attributes", () => {
    expect(out.lines).toEqual([
      expect.objectContaining({ sign_type: "Pylon P1", quantity: 2, install_type: "pylon", width_mm: 1200, height_mm: 3000, has_screen: true }),
    ]);
  });
  it("reports bad rows by spreadsheet row number", () => {
    expect(out.errors.map((e) => e.row)).toEqual([4, 5]);
  });
  it("skips blank and total rows", () => {
    expect(out.skipped).toBe(2);
  });
});
```

Run: `bun test src/lib/boq-import.test.ts`
Expected: FAIL with `Cannot find module '@/lib/boq-import'`.

- [ ] **Step 3: Write `src/lib/boq-import.ts`**

```ts
// =============================================================================
// BOQ import for the pricing file: read a spreadsheet in the browser, find the
// header row, map columns to BOQ fields, and turn rows into the lines
// pricing_boq_import accepts. The database validates again; this gives Zayed
// the errors by spreadsheet row before he sends anything.
// No Arabic-Indic digit appears in this file (arabic-digits.test.ts): they are
// converted by code point.
// =============================================================================
import type { InstallType } from "@/lib/pricing";
import type { BoqImportLine } from "@/lib/pricing-actions";
import type { Bi } from "@/lib/pricing-text";

export const BOQ_FIELDS = [
  "sign_type", "description", "quantity", "unit", "dimensions", "material", "mounting", "illumination",
  "finish", "location", "install_type", "width_mm", "height_mm", "weight_kg", "mount_height_m",
  "has_screen", "needs_floor_cut",
] as const;
export type BoqField = (typeof BOQ_FIELDS)[number];
export type ColumnMapping = Partial<Record<BoqField, number>>;

export const BOQ_FIELD_LABEL: Record<BoqField, Bi> = {
  sign_type: { en: "Sign type", ar: "نوع اللوحة" },
  description: { en: "Description", ar: "الوصف" },
  quantity: { en: "Quantity", ar: "الكمية" },
  unit: { en: "Unit", ar: "الوحدة" },
  dimensions: { en: "Size", ar: "المقاس" },
  material: { en: "Material", ar: "الخامة" },
  mounting: { en: "Mounting", ar: "التثبيت" },
  illumination: { en: "Illumination", ar: "الإضاءة" },
  finish: { en: "Finish", ar: "التشطيب" },
  location: { en: "Location", ar: "الموقع" },
  install_type: { en: "Install type", ar: "نوع التركيب" },
  width_mm: { en: "Width (mm)", ar: "العرض (مم)" },
  height_mm: { en: "Height (mm)", ar: "الارتفاع (مم)" },
  weight_kg: { en: "Weight (kg)", ar: "الوزن (كغ)" },
  mount_height_m: { en: "Mount height (m)", ar: "ارتفاع التركيب (م)" },
  has_screen: { en: "Screen", ar: "شاشة" },
  needs_floor_cut: { en: "Floor cut", ar: "قص أرضية" },
};

/** Install types in rate-card order, with their labels (also used by Cost review and Settings). */
export const INSTALL_TYPES: readonly InstallType[] = ["double_tape", "wall_screw", "pylon", "ceiling", "floor"];
export const INSTALL_TYPE_LABEL: Record<InstallType, Bi> = {
  double_tape: { en: "Double tape", ar: "دبل تيب" },
  wall_screw: { en: "Screwed to wall", ar: "جدار بالبراغي" },
  pylon: { en: "Pylon", ar: "بايلون" },
  ceiling: { en: "Ceiling", ar: "سقف" },
  floor: { en: "Floor", ar: "أرض" },
};

const HINTS: Record<BoqField, string[]> = {
  sign_type: ["sign type", "sign", "type", "item", "code", "نوع اللوحة", "اللوحة", "البند", "النوع"],
  description: ["description", "desc", "details", "الوصف", "التفاصيل"],
  quantity: ["qty", "quantity", "count", "الكمية", "العدد"],
  unit: ["unit", "uom", "الوحدة"],
  dimensions: ["size", "dimension", "dimensions", "المقاس", "الأبعاد"],
  material: ["material", "المادة", "الخامة"],
  mounting: ["mounting", "fixing", "التثبيت"],
  illumination: ["illumination", "lighting", "light", "الإضاءة"],
  finish: ["finish", "colour", "color", "التشطيب", "اللون"],
  location: ["location", "area", "zone", "الموقع", "المكان"],
  install_type: ["install type", "installation type", "install", "installation", "نوع التركيب", "التركيب"],
  width_mm: ["width", "العرض"],
  height_mm: ["height", "الارتفاع"],
  weight_kg: ["weight", "الوزن"],
  mount_height_m: ["mount height", "mounting height", "installation height", "ارتفاع التركيب"],
  has_screen: ["screen", "display", "شاشة"],
  needs_floor_cut: ["floor cut", "cutting", "قص"],
};

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function score(cell: string, field: BoqField): number {
  let best = 0;
  for (const h of HINTS[field]) {
    if (cell === h) best = Math.max(best, 100 + h.length);
    else if (h.length >= 4 && cell.includes(h)) best = Math.max(best, h.length);
  }
  return best;
}

/** Each column goes to the field it matches best; each field takes one column. */
export function guessMapping(header: readonly unknown[]): ColumnMapping {
  const pairs: { field: BoqField; col: number; s: number }[] = [];
  header.map(norm).forEach((cell, col) => {
    if (!cell) return;
    for (const field of BOQ_FIELDS) {
      const s = score(cell, field);
      if (s > 0) pairs.push({ field, col, s });
    }
  });
  pairs.sort((a, b) => b.s - a.s || a.col - b.col);
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();
  for (const p of pairs) {
    if (mapping[p.field] !== undefined || taken.has(p.col)) continue;
    mapping[p.field] = p.col;
    taken.add(p.col);
  }
  return mapping;
}

/** The row among the first twenty that maps the most fields, sign type and quantity counting double. */
export function findHeaderRow(rows: readonly (readonly unknown[])[]): number {
  let best = 0;
  let bestScore = 0;
  rows.slice(0, 20).forEach((row, i) => {
    const m = guessMapping(row ?? []);
    const s = Object.keys(m).length + (m.sign_type !== undefined ? 1 : 0) + (m.quantity !== undefined ? 1 : 0);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  });
  return best;
}

/** Western digits from Arabic-Indic (U+0660–0669) and extended (U+06F0–06F9); drops thousands separators. */
function westernDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
    else if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0);
    else if (c === 0x066b) out += ".";
    else if (c === 0x066c || ch === ",") continue;
    else out += ch;
  }
  return out;
}

export function parseNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = westernDigits(String(v)).trim().match(/^-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = norm(v);
  if (["yes", "y", "true", "1", "x", "نعم"].includes(s)) return true;
  if (["no", "n", "false", "0", "لا"].includes(s)) return false;
  return null;
}

const INSTALL_WORDS: [InstallType, string[]][] = [
  ["double_tape", ["double tape", "double-tape", "tape", "vhb", "دبل تيب", "لاصق"]],
  ["wall_screw", ["wall", "screw", "bolted", "براغي", "جدار", "حائط"]],
  ["pylon", ["pylon", "totem", "بايلون", "طوطم"]],
  ["ceiling", ["ceiling", "suspended", "hanging", "سقف", "معلق", "تعليق"]],
  ["floor", ["floor", "ground", "أرض"]],
];
export function parseInstallType(v: unknown): InstallType | null {
  const s = norm(v).replace(/_/g, " ");
  if (!s) return null;
  for (const [t, words] of INSTALL_WORDS) {
    if (s === t.replace("_", " ") || words.some((w) => s.includes(w))) return t;
  }
  return null;
}

/** "1200 x 600 mm", "120x60cm", "1.2 × 0.6 m" → millimetres. */
export function parseDimensions(v: unknown): { width_mm: number; height_mm: number } | null {
  const s = westernDigits(String(v ?? "")).toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const factor = /mm/.test(s) ? 1 : /cm/.test(s) ? 10 : /\d\s*m\b|\sm\b/.test(s) ? 1000 : 1;
  return { width_mm: Math.round(Number(m[1]) * factor * 10) / 10, height_mm: Math.round(Number(m[2]) * factor * 10) / 10 };
}

export type RowError = { row: number; message: Bi };

const TOTAL_WORDS = ["total", "grand total", "subtotal", "المجموع", "الإجمالي"];

/** rows: the sheet as arrays; headerRow: 0-based; errors carry 1-based spreadsheet row numbers. */
export function mapRows(
  rows: readonly (readonly unknown[])[],
  headerRow: number,
  mapping: ColumnMapping,
): { lines: BoqImportLine[]; errors: RowError[]; skipped: number } {
  const lines: BoqImportLine[] = [];
  const errors: RowError[] = [];
  let skipped = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const cell = (f: BoqField) => (mapping[f] === undefined ? null : (r[mapping[f] as number] ?? null));
    const text = (f: BoqField) => {
      const v = cell(f);
      const s = v == null ? "" : String(v).trim();
      return s === "" ? null : s;
    };
    if (r.every((c) => c == null || String(c).trim() === "")) {
      skipped++;
      continue;
    }
    const sign = text("sign_type") ?? text("description");
    if (sign && TOTAL_WORDS.some((w) => norm(sign).startsWith(w))) {
      skipped++;
      continue;
    }
    const row = i + 1;
    if (!sign) {
      errors.push({ row, message: { en: "No sign type or description", ar: "لا يوجد نوع لوحة أو وصف" } });
      continue;
    }
    const qty = parseNumber(cell("quantity"));
    if (qty == null || qty <= 0) {
      errors.push({ row, message: { en: "Quantity missing or not above zero", ar: "الكمية غير موجودة أو ليست أكبر من صفر" } });
      continue;
    }
    const rawInstall = text("install_type");
    const install = parseInstallType(rawInstall);
    if (rawInstall && !install) {
      errors.push({ row, message: { en: `Install type not recognised: ${rawInstall}`, ar: `نوع التركيب غير معروف: ${rawInstall}` } });
      continue;
    }
    const dims = parseDimensions(text("dimensions"));
    const positive = (n: number | null) => (n != null && n > 0 ? n : null);
    lines.push({
      sign_type: sign,
      description: text("description"),
      quantity: qty,
      unit: text("unit"),
      dimensions: text("dimensions"),
      material: text("material"),
      mounting: text("mounting"),
      illumination: text("illumination"),
      finish: text("finish"),
      location: text("location"),
      install_type: install,
      width_mm: positive(parseNumber(cell("width_mm"))) ?? dims?.width_mm ?? null,
      height_mm: positive(parseNumber(cell("height_mm"))) ?? dims?.height_mm ?? null,
      weight_kg: parseNumber(cell("weight_kg")),
      mount_height_m: parseNumber(cell("mount_height_m")),
      has_screen: parseBool(cell("has_screen")) ?? false,
      needs_floor_cut: parseBool(cell("needs_floor_cut")) ?? false,
    });
  }
  return { lines, errors, skipped };
}

/** Every sheet as rows of cells. SheetJS is loaded on demand so it stays out of the main bundle. */
export async function readWorkbook(file: File): Promise<{ name: string; rows: unknown[][] }[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: null, raw: true }),
  }));
}
```

Run: `bun test src/lib/boq-import.test.ts`
Expected: PASS. If "wall mounted, screwed" maps to something other than `wall_screw`, check the order of `INSTALL_WORDS`: pylon must stay before floor, and wall before both.

- [ ] **Step 4: Create `src/components/phc/pricing/BoqImportDialog.tsx`**

```tsx
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { BOQ_FIELDS, BOQ_FIELD_LABEL, findHeaderRow, guessMapping, mapRows, readWorkbook, type BoqField, type ColumnMapping } from "@/lib/boq-import";
import { importBoqLines } from "@/lib/pricing-actions";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";

const TEXT = {
  title: { en: "Import BOQ lines from Excel", ar: "استيراد بنود الكميات من Excel" },
  desc: { en: "Choose the file, check which column is which, then import. Nothing is saved until you press Import.", ar: "اختر الملف، وتحقق من الأعمدة، ثم استورد. لا يُحفظ شيء قبل الضغط على استيراد." },
  file: { en: "Spreadsheet (.xlsx, .xls, .csv)", ar: "جدول البيانات (.xlsx أو .xls أو .csv)" },
  sheet: { en: "Sheet", ar: "الورقة" },
  header: { en: "Header row", ar: "صف العناوين" },
  column: { en: "Column", ar: "العمود" },
  none: { en: "Not in this file", ar: "غير موجود في الملف" },
  ready: { en: "lines ready", ar: "بنداً جاهزاً" },
  bad: { en: "rows with problems (not imported)", ar: "صفاً فيه مشكلة (لن يُستورد)" },
  skipped: { en: "blank or total rows skipped", ar: "صفاً فارغاً أو إجمالياً تُرك" },
  row: { en: "Row", ar: "الصف" },
  append: { en: "Add to the lines already entered", ar: "أضف إلى البنود المُدخلة" },
  replace: { en: "Replace the lines already entered", ar: "استبدل البنود المُدخلة" },
  importBtn: { en: "Import", ar: "استيراد" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  done: { en: "lines imported", ar: "بنداً استُورد" },
  readFail: { en: "This file could not be read as a spreadsheet.", ar: "تعذّرت قراءة الملف كجدول بيانات." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

export function BoqImportDialog({
  open, onOpenChange, fileId, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; fileId: string; onDone: () => void }) {
  const { lang } = useI18n();
  const [sheets, setSheets] = useState<{ name: string; rows: unknown[][] }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = sheets[sheetIdx]?.rows ?? [];
  const header = rows[headerRow] ?? [];
  const result = useMemo(() => mapRows(rows, headerRow, mapping), [rows, headerRow, mapping]);

  function chooseSheet(all: { name: string; rows: unknown[][] }[], idx: number) {
    const h = findHeaderRow(all[idx]?.rows ?? []);
    setSheetIdx(idx);
    setHeaderRow(h);
    setMapping(guessMapping(all[idx]?.rows[h] ?? []));
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    try {
      const all = await readWorkbook(f);
      setSheets(all);
      chooseSheet(all, 0);
    } catch {
      toast.error(pick(TEXT.readFail, lang));
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const r = await importBoqLines(fileId, result.lines, replace);
      toast.success(`${r.inserted} ${pick(TEXT.done, lang)}`);
      onDone();
      onOpenChange(false);
      setSheets([]);
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{pick(TEXT.title, lang)}</DialogTitle>
          <DialogDescription>{pick(TEXT.desc, lang)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span>{pick(TEXT.file, lang)}</span>
            <input type="file" accept=".xlsx,.xls,.csv" className={FIELD} onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {sheets.length > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>{pick(TEXT.sheet, lang)}</span>
                  <select className={FIELD} value={sheetIdx} onChange={(e) => chooseSheet(sheets, Number(e.target.value))}>
                    {sheets.map((s, i) => (
                      <option key={s.name} value={i}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span>{pick(TEXT.header, lang)}</span>
                  <input
                    type="number" min={1} max={rows.length} className={FIELD} value={headerRow + 1}
                    onChange={(e) => {
                      const h = Math.max(0, Number(e.target.value) - 1);
                      setHeaderRow(h);
                      setMapping(guessMapping(rows[h] ?? []));
                    }}
                  />
                </label>
              </div>
              <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                {BOQ_FIELDS.map((field: BoqField) => (
                  <label key={field} className="flex items-center justify-between gap-2 text-sm">
                    <span>{pick(BOQ_FIELD_LABEL[field], lang)}</span>
                    <select
                      className={`${FIELD} max-w-[60%]`}
                      aria-label={`${pick(TEXT.column, lang)}: ${pick(BOQ_FIELD_LABEL[field], lang)}`}
                      value={mapping[field] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [field]: e.target.value === "" ? undefined : Number(e.target.value) }))
                      }
                    >
                      <option value="">{pick(TEXT.none, lang)}</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>{String(h ?? "").trim() || `${pick(TEXT.column, lang)} ${i + 1}`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="space-y-1 text-sm">
                <p>{result.lines.length} {pick(TEXT.ready, lang)} · {result.errors.length} {pick(TEXT.bad, lang)} · {result.skipped} {pick(TEXT.skipped, lang)}</p>
                <ul className="max-h-32 overflow-y-auto text-destructive">
                  {result.errors.slice(0, 20).map((er) => (
                    <li key={er.row}>{pick(TEXT.row, lang)} {er.row}: {pick(er.message, lang)}</li>
                  ))}
                </ul>
              </div>
              <fieldset className="space-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!replace} onChange={() => setReplace(false)} /> {pick(TEXT.append, lang)}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={replace} onChange={() => setReplace(true)} /> {pick(TEXT.replace, lang)}
                </label>
              </fieldset>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{pick(TEXT.cancel, lang)}</Button>
          <Button disabled={busy || result.lines.length === 0} onClick={() => void submit()}>{pick(TEXT.importBtn, lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Create `src/components/phc/pricing/BoqLineForm.tsx`**

```tsx
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { InstallType } from "@/lib/pricing";
import { importBoqLines } from "@/lib/pricing-actions";
import { BOQ_FIELD_LABEL, INSTALL_TYPES, INSTALL_TYPE_LABEL } from "@/lib/boq-import";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";

const TEXT = {
  title: { en: "Add a line by hand", ar: "أضف بنداً يدوياً" },
  none: { en: "None", ar: "بدون" },
  add: { en: "Add line", ar: "أضف البند" },
  added: { en: "Line added", ar: "أُضيف البند" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";
const EMPTY = { sign_type: "", description: "", quantity: "", unit: "", install_type: "", width_mm: "", height_mm: "", weight_kg: "", mount_height_m: "", has_screen: false, needs_floor_cut: false };

export function BoqLineForm({ fileId, onDone }: { fileId: string; onDone: () => void }) {
  const { lang } = useI18n();
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function add() {
    setBusy(true);
    try {
      await importBoqLines(fileId, [{
        sign_type: v.sign_type.trim(),
        description: v.description.trim() || null,
        quantity: Number(v.quantity),
        unit: v.unit.trim() || null,
        install_type: (v.install_type || null) as InstallType | null,
        width_mm: num(v.width_mm),
        height_mm: num(v.height_mm),
        weight_kg: num(v.weight_kg),
        mount_height_m: num(v.mount_height_m),
        has_screen: v.has_screen,
        needs_floor_cut: v.needs_floor_cut,
      }]);
      toast.success(pick(TEXT.added, lang));
      setV(EMPTY);
      onDone();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  const input = (k: "sign_type" | "description" | "quantity" | "unit" | "width_mm" | "height_mm" | "weight_kg" | "mount_height_m", type = "text") => (
    <label className="space-y-1 text-sm">
      <span>{pick(BOQ_FIELD_LABEL[k], lang)}</span>
      <input className={FIELD} type={type} value={v[k]} onChange={set(k)} />
    </label>
  );

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">{pick(TEXT.title, lang)}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        {input("sign_type")}
        {input("description")}
        {input("quantity", "number")}
        {input("unit")}
        <label className="space-y-1 text-sm">
          <span>{pick(BOQ_FIELD_LABEL.install_type, lang)}</span>
          <select className={FIELD} value={v.install_type} onChange={set("install_type")}>
            <option value="">{pick(TEXT.none, lang)}</option>
            {INSTALL_TYPES.map((t) => (
              <option key={t} value={t}>{pick(INSTALL_TYPE_LABEL[t], lang)}</option>
            ))}
          </select>
        </label>
        {input("width_mm", "number")}
        {input("height_mm", "number")}
        {input("weight_kg", "number")}
        {input("mount_height_m", "number")}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.has_screen} onChange={(e) => setV((x) => ({ ...x, has_screen: e.target.checked }))} />
          {pick(BOQ_FIELD_LABEL.has_screen, lang)}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.needs_floor_cut} onChange={(e) => setV((x) => ({ ...x, needs_floor_cut: e.target.checked }))} />
          {pick(BOQ_FIELD_LABEL.needs_floor_cut, lang)}
        </label>
      </div>
      <Button size="sm" disabled={busy || !v.sign_type.trim() || !(Number(v.quantity) > 0)} onClick={() => void add()}>
        {pick(TEXT.add, lang)}
      </Button>
    </div>
  );
}
```

- [ ] **Step 6: Replace `src/components/phc/pricing/PackageTab.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { DocumentsPanel } from "@/components/phc/DocumentsPanel";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import { answerNeedsInfo, askNeedsInfo, attachRevision, deleteBoqLine, freezeBoq, listBoqLines, listDealRevisions } from "@/lib/pricing-actions";
import { canEditPackage } from "@/lib/pricing-access";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { BoqImportDialog } from "@/components/phc/pricing/BoqImportDialog";
import { BoqLineForm } from "@/components/phc/pricing/BoqLineForm";
import { INSTALL_TYPE_LABEL } from "@/lib/boq-import";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  received: { en: "Start the package review from the header to work on this file.", ar: "ابدأ دراسة الباكيج من أعلى الصفحة للعمل على هذا الملف." },
  needsTitle: { en: "Missing items with sales", ar: "النواقص لدى المبيعات" },
  due: { en: "Due", ar: "الموعد" },
  answer: { en: "Record the rep's answer", ar: "سجّل رد المندوب" },
  answerTitle: { en: "The rep's answer", ar: "رد المندوب" },
  answerDesc: { en: "Until reps answer from their own screen, record what they sent you. The file goes back to package review.", ar: "إلى أن يرد المندوبون من شاشتهم، سجّل ما أرسلوه لك. يعود الملف إلى دراسة الباكيج." },
  answerField: { en: "Answer", ar: "الرد" },
  checklist: { en: "Checklist", ar: "قائمة التحقق" },
  checkDrawings: { en: "BOQ checked against the drawings", ar: "الكميات مطابقة للرسومات" },
  checkLocation: { en: "BOQ checked against the location plan", ar: "الكميات مطابقة لمخطط المواقع" },
  checkFiles: { en: "Files are complete for the supplier", ar: "الملفات مكتملة للمورد" },
  files: { en: "Drawings and files", ar: "الرسومات والملفات" },
  boq: { en: "BOQ", ar: "جدول الكميات" },
  revision: { en: "Revision", ar: "الإصدار" },
  noRevision: { en: "No BOQ on this file yet. Import it, add lines by hand, or use an existing revision.", ar: "لا كميات في هذا الملف بعد. استوردها أو أضف البنود يدوياً أو استخدم إصداراً موجوداً." },
  useRevision: { en: "Use an existing revision", ar: "استخدم إصداراً موجوداً" },
  frozen: { en: "Frozen", ar: "مجمّد" },
  draft: { en: "Draft", ar: "مسودة" },
  importBtn: { en: "Import from Excel", ar: "استيراد من Excel" },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  install: { en: "Install", ar: "التركيب" },
  size: { en: "Size (mm)", ar: "المقاس (مم)" },
  screen: { en: "Screen", ar: "شاشة" },
  yes: { en: "Yes", ar: "نعم" },
  remove: { en: "Remove", ar: "حذف" },
  ask: { en: "Ask sales for missing items", ar: "اطلب النواقص من المبيعات" },
  askTitle: { en: "Missing items", ar: "النواقص" },
  askDesc: { en: "The sales rep sees this list and the due date.", ar: "يرى مندوب المبيعات هذه القائمة والموعد." },
  items: { en: "One missing item per line", ar: "بند ناقص في كل سطر" },
  freeze: { en: "Freeze the BOQ", ar: "جمّد الكميات" },
  freezeTitle: { en: "Freeze this BOQ revision", ar: "تجميد إصدار الكميات" },
  freezeDesc: { en: "Freezing is one-way: a later quantity change opens a new revision. The note below is visible to the sales rep.", ar: "التجميد نهائي: أي تغيير لاحق في الكميات يفتح إصداراً جديداً. الملاحظة أدناه ظاهرة لمندوب المبيعات." },
  status: { en: "Verification", ar: "التحقق" },
  verified: { en: "Verified", ar: "متحقق" },
  partial: { en: "Partially verified", ar: "متحقق جزئياً" },
  note: { en: "Note", ar: "ملاحظة" },
  noteDefault: { en: "Checked against the drawings and the location plan; files complete.", ar: "طوبقت مع الرسومات ومخطط المواقع؛ الملفات مكتملة." },
  freezeNeedsChecks: { en: "Tick the three checks to freeze.", ar: "علّم البنود الثلاثة للتجميد." },
  done: { en: "Saved", ar: "تم الحفظ" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

export function PackageTab({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const editable = canEditPackage(file.state, rights);
  const revisions = useQuery({ queryKey: ["pricing-revisions", file.opportunity_id], queryFn: () => listDealRevisions(file.opportunity_id) });
  const revisionId = file.boq_revision_id;
  const lines = useQuery({
    queryKey: ["pricing-lines", revisionId],
    queryFn: () => listBoqLines(revisionId as string),
    enabled: revisionId != null,
  });
  const current = (revisions.data ?? []).find((rv) => rv.id === revisionId) ?? null;
  const frozen = current?.frozen_at != null;
  const others = (revisions.data ?? []).filter((rv) => rv.id !== revisionId && rv.superseded_by == null);
  const [checks, setChecks] = useState({ drawings: false, location: false, files: false });
  const [importOpen, setImportOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const allChecked = checks.drawings && checks.location && checks.files;
  const lineCount = lines.data?.length ?? 0;

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      toast.success(pick(TEXT.done, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  const check = (k: keyof typeof checks, label: Bi) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" disabled={!editable} checked={checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} />
      {pick(label, lang)}
    </label>
  );

  return (
    <div className="space-y-6">
      {file.state === "received" ? <p className="text-sm text-muted-foreground">{pick(TEXT.received, lang)}</p> : null}

      {file.state === "needs_info" ? (
        <Panel title={pick(TEXT.needsTitle, lang)} tone="attention"
          action={rights.is_pricer ? <Button size="sm" onClick={() => setAnswerOpen(true)}>{pick(TEXT.answer, lang)}</Button> : undefined}>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {file.needs_info_items.map((it) => <li key={it}>{it}</li>)}
          </ul>
          {file.needs_info_due ? <p className="mt-2 text-sm text-muted-foreground">{pick(TEXT.due, lang)}: {file.needs_info_due}</p> : null}
        </Panel>
      ) : null}

      <Panel title={pick(TEXT.checklist, lang)}>
        <div className="space-y-2">
          {check("drawings", TEXT.checkDrawings)}
          {check("location", TEXT.checkLocation)}
          {check("files", TEXT.checkFiles)}
        </div>
      </Panel>

      <DocumentsPanel entity={{ type: "opportunity", id: file.opportunity_id }} title={pick(TEXT.files, lang)} />

      <Panel
        title={pick(TEXT.boq, lang)}
        subtitle={current ? `${pick(TEXT.revision, lang)} ${current.revision_number} · ${pick(frozen ? TEXT.frozen : TEXT.draft, lang)}` : undefined}
        action={editable && !frozen ? <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>{pick(TEXT.importBtn, lang)}</Button> : undefined}
      >
        <div className="space-y-4">
          {editable && others.length > 0 ? (
            <label className="block max-w-sm space-y-1 text-sm">
              <span>{pick(TEXT.useRevision, lang)}</span>
              <select className={FIELD} value="" onChange={(e) => e.target.value && void run(() => attachRevision(file.file_id, e.target.value))}>
                <option value="">—</option>
                {others.map((rv) => (
                  <option key={rv.id} value={rv.id}>
                    {pick(TEXT.revision, lang)} {rv.revision_number} · {pick(rv.frozen_at ? TEXT.frozen : TEXT.draft, lang)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {!revisionId ? (
            <p className="text-sm text-muted-foreground">{pick(TEXT.noRevision, lang)}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>{pick(TEXT.sign, lang)}</TableHead>
                  <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
                  <TableHead>{pick(TEXT.install, lang)}</TableHead>
                  <TableHead>{pick(TEXT.size, lang)}</TableHead>
                  <TableHead>{pick(TEXT.screen, lang)}</TableHead>
                  {editable && !frozen ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lines.data ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums">{l.line_number ?? ""}</TableCell>
                    <TableCell>
                      <div className="font-medium">{l.sign_type}</div>
                      {l.description ? <div className="text-xs text-muted-foreground">{l.description}</div> : null}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{formatNumber(l.quantity, lang)} {l.unit ?? ""}</TableCell>
                    <TableCell>{l.install_type ? pick(INSTALL_TYPE_LABEL[l.install_type], lang) : "—"}</TableCell>
                    <TableCell className="tabular-nums">{l.width_mm && l.height_mm ? `${l.width_mm} × ${l.height_mm}` : (l.dimensions ?? "—")}</TableCell>
                    <TableCell>{l.has_screen ? <StatusPill>{pick(TEXT.yes, lang)}</StatusPill> : null}</TableCell>
                    {editable && !frozen ? (
                      <TableCell className="text-end">
                        <Button size="sm" variant="ghost" onClick={() => void run(() => deleteBoqLine(file.file_id, l.id))}>{pick(TEXT.remove, lang)}</Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {editable && !frozen ? <BoqLineForm fileId={file.file_id} onDone={onChanged} /> : null}
        </div>
      </Panel>

      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setAskOpen(true)}>{pick(TEXT.ask, lang)}</Button>
          <Button disabled={!allChecked || lineCount === 0} onClick={() => setFreezeOpen(true)}>{pick(TEXT.freeze, lang)}</Button>
          {!allChecked ? <span className="text-sm text-muted-foreground">{pick(TEXT.freezeNeedsChecks, lang)}</span> : null}
        </div>
      ) : null}

      <BoqImportDialog open={importOpen} onOpenChange={setImportOpen} fileId={file.file_id} onDone={onChanged} />

      <ActionDialog
        open={askOpen}
        onOpenChange={setAskOpen}
        title={pick(TEXT.askTitle, lang)}
        description={pick(TEXT.askDesc, lang)}
        fields={[
          { key: "items", type: "textarea", label: pick(TEXT.items, lang), required: true },
          { key: "due", type: "date", label: pick(TEXT.due, lang), required: true },
        ]}
        submitLabel={pick(TEXT.ask, lang)}
        recordId={file.file_id}
        onSubmit={async (v) => {
          try {
            await askNeedsInfo(file.file_id, v.items.split("\n").map((s) => s.trim()).filter(Boolean), v.due);
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={answerOpen}
        onOpenChange={setAnswerOpen}
        title={pick(TEXT.answerTitle, lang)}
        description={pick(TEXT.answerDesc, lang)}
        fields={[{ key: "answer", type: "textarea", label: pick(TEXT.answerField, lang), required: true }]}
        submitLabel={pick(TEXT.answer, lang)}
        recordId={file.file_id}
        onSubmit={async (v) => {
          try {
            await answerNeedsInfo(file.file_id, v.answer);
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={freezeOpen}
        onOpenChange={setFreezeOpen}
        title={pick(TEXT.freezeTitle, lang)}
        description={pick(TEXT.freezeDesc, lang)}
        fields={[
          {
            key: "status", type: "select", label: pick(TEXT.status, lang), required: true, defaultValue: "verified",
            options: [
              { value: "verified", label: pick(TEXT.verified, lang) },
              { value: "partially_verified", label: pick(TEXT.partial, lang) },
            ],
          },
          { key: "note", type: "textarea", label: pick(TEXT.note, lang), required: true, defaultValue: pick(TEXT.noteDefault, lang) },
        ]}
        submitLabel={pick(TEXT.freeze, lang)}
        recordId={file.file_id}
        onSubmit={async (v) => {
          try {
            await freezeBoq(file.file_id, v.status as "verified" | "partially_verified", v.note);
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Verify**

Run: `bun test src/lib/boq-import.test.ts && bun run verify`
Expected: PASS. Lint must have 0 errors. `ui-baseline` passes: there is no raw `<table>`, and the mapping `<select>`s have `aria-label`.

Manual check (local stack with Tasks 1–6 migrations applied, `bun run dev`):
1. As a pricer, open a file in `received` and click *Start package review*.
2. Import a small `.xlsx` with headers `Sign Type | Qty | Size | Install` and check the preview.
3. Add one line by hand, remove one, tick the three checks, and freeze. The file should show *BOQ frozen*.
4. Switch to Arabic and check RTL.
If no local stack is available, say so in the task report.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock src/lib/boq-import.ts src/lib/boq-import.test.ts src/components/phc/pricing/BoqImportDialog.tsx src/components/phc/pricing/BoqLineForm.tsx src/components/phc/pricing/PackageTab.tsx
git commit -m "feat(pricing): Package tab with Excel BOQ import and column mapping, manual lines, missing items, freeze" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Supplier and Cost review tabs (UI)

**Files:**
- Replace: `src/components/phc/pricing/SupplierTab.tsx`
- Replace: `src/components/phc/pricing/CostReviewTab.tsx`

**Interfaces:**
- Consumes:
  - Task 7: `listSupplierCosts`, `listBoqLines`, `listSellingGrid`, `setLineChoice`, `movePricingFile`, `GridRow`, `SupplierCostRow` (`@/lib/pricing-actions`); `canEditLineCost`, `daysWaiting` (`@/lib/pricing-access`); `canPricerMove`, `canGmMove` (`@/lib/pricing`).
  - Task 9: `INSTALL_TYPES`, `INSTALL_TYPE_LABEL` (`@/lib/boq-import`).
  - Task 8: `PricingTabProps`.
- Produces: `SupplierTab(props)`, `CostReviewTab(props)`.
  - `SupplierTab` has one marked slot comment, `{/* Task 14: SupplierEntryForm */}`, where the optional entry-on-behalf form goes.

- [ ] **Step 1: Replace `src/components/phc/pricing/SupplierTab.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/phc/Panel";
import { useI18n, localeFor } from "@/lib/i18n";
import { canPricerMove } from "@/lib/pricing";
import { listBoqLines, listSupplierCosts, movePricingFile } from "@/lib/pricing-actions";
import { daysWaiting } from "@/lib/pricing-access";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Supplier", ar: "المورد" },
  notYet: { en: "The BOQ is frozen first, on the Package tab.", ar: "تُجمَّد الكميات أولاً من تبويب الباكيج." },
  howToday: { en: "The supplier portal is not ready yet. Send the frozen BOQ and the files to the supplier as you do today, then mark it sent here. The supplier sees the project code only.", ar: "بوابة المورد ليست جاهزة بعد. أرسل الكميات المجمّدة والملفات للمورد كما تفعل اليوم، ثم سجّل الإرسال هنا. يرى المورد رمز المشروع فقط." },
  send: { en: "Mark as sent to the supplier", ar: "سجّل الإرسال للمورد" },
  sent: { en: "Marked as sent", ar: "سُجّل الإرسال" },
  atSupplier: { en: "At the supplier since", ar: "عند المورد منذ" },
  days: { en: "days", ar: "يوم" },
  pricedCount: { en: "lines have a supplier price", ar: "بنداً لها سعر مورد" },
  of: { en: "of", ar: "من" },
  priced: { en: "The supplier has priced", ar: "سعّر المورد" },
  confirm: { en: "Confirm: the supplier's prices are in and go to the GM", ar: "تأكيد: أسعار المورد وصلت وتذهب للمدير العام" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  movedOn: { en: "The file went to the GM", ar: "انتقل الملف للمدير العام" },
  noPrices: { en: "No supplier price is in the system yet; the Cost review will show every line unpriced.", ar: "لا يوجد سعر مورد في النظام بعد؛ ستظهر كل البنود بلا سعر في مراجعة التكلفة." },
  done: { en: "The supplier has priced this file. See Cost review.", ar: "سعّر المورد هذا الملف. راجع تبويب مراجعة التكلفة." },
} satisfies Record<string, Bi>;

export function SupplierTab({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const revisionId = file.boq_revision_id;
  const lines = useQuery({ queryKey: ["pricing-lines", revisionId], queryFn: () => listBoqLines(revisionId as string), enabled: revisionId != null });
  const costs = useQuery({
    queryKey: ["pricing-supplier-costs", revisionId],
    queryFn: () => listSupplierCosts(revisionId as string),
    enabled: revisionId != null && rights.can_read_cost,
  });
  const [confirming, setConfirming] = useState(false);
  const pricedLines = new Set((costs.data ?? []).filter((c) => c.unit_cost != null).map((c) => c.boq_line_id)).size;
  const lineCount = lines.data?.length ?? 0;

  async function move(to: "at_supplier" | "supplier_priced", ok: Bi) {
    try {
      await movePricingFile(file.file_id, to);
      toast.success(pick(ok, lang));
      setConfirming(false);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  const before = ["received", "package_review", "needs_info"].includes(file.state);
  return (
    <Panel title={pick(TEXT.title, lang)}>
      <div className="space-y-4 text-sm">
        {before ? <p className="text-muted-foreground">{pick(TEXT.notYet, lang)}</p> : null}

        {file.state === "boq_frozen" ? (
          <>
            <p className="text-muted-foreground">{pick(TEXT.howToday, lang)}</p>
            {rights.is_pricer && canPricerMove("boq_frozen", "at_supplier") ? (
              <Button onClick={() => void move("at_supplier", TEXT.sent)}>{pick(TEXT.send, lang)}</Button>
            ) : null}
          </>
        ) : null}

        {file.state === "at_supplier" ? (
          <>
            <p>
              {pick(TEXT.atSupplier, lang)} {new Date(file.state_changed_at).toLocaleDateString(localeFor(lang))} ·{" "}
              {daysWaiting(file.state_changed_at)} {pick(TEXT.days, lang)}
            </p>
            {rights.can_read_cost ? (
              <p>
                {pricedLines} {pick(TEXT.of, lang)} {lineCount} {pick(TEXT.pricedCount, lang)}
              </p>
            ) : null}
            {/* Task 14: SupplierEntryForm */}
            {rights.is_pricer ? (
              confirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  {pricedLines === 0 && rights.can_read_cost ? <p className="w-full text-amber-light">{pick(TEXT.noPrices, lang)}</p> : null}
                  <Button onClick={() => void move("supplier_priced", TEXT.movedOn)}>{pick(TEXT.confirm, lang)}</Button>
                  <Button variant="outline" onClick={() => setConfirming(false)}>{pick(TEXT.cancel, lang)}</Button>
                </div>
              ) : (
                <Button onClick={() => setConfirming(true)}>{pick(TEXT.priced, lang)}</Button>
              )
            ) : null}
          </>
        ) : null}

        {!before && file.state !== "boq_frozen" && file.state !== "at_supplier" ? (
          <p className="text-muted-foreground">{pick(TEXT.done, lang)}</p>
        ) : null}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 2: Replace `src/components/phc/pricing/CostReviewTab.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatNumber } from "@/lib/i18n";
import { canGmMove, canPricerMove, type InstallType } from "@/lib/pricing";
import { listSellingGrid, movePricingFile, setLineChoice, type LineChoice } from "@/lib/pricing-actions";
import { canEditLineCost } from "@/lib/pricing-access";
import { INSTALL_TYPES, INSTALL_TYPE_LABEL } from "@/lib/boq-import";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Supplier prices against the BOQ", ar: "أسعار المورد مقابل الكميات" },
  sub: { en: "Pick the normal or the with-screen price, and correct an install type. Cost only; the GM sets the selling price.", ar: "اختر السعر العادي أو مع الشاشة، وصحّح نوع التركيب. هذه تكلفة فقط؛ سعر البيع يضعه المدير العام." },
  noBoq: { en: "No BOQ on this file yet.", ar: "لا كميات في هذا الملف بعد." },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  unit: { en: "Supplier unit", ar: "سعر المورد للوحدة" },
  screenUnit: { en: "With screen", ar: "مع الشاشة" },
  useScreen: { en: "Use screen price", ar: "سعر الشاشة" },
  install: { en: "Install type", ar: "نوع التركيب" },
  noType: { en: "No type (fallback %)", ar: "بلا نوع (نسبة احتياطية)" },
  materials: { en: "Materials", ar: "المواد" },
  installation: { en: "Installation", ar: "التركيب" },
  fallback: { en: "% fallback", ar: "نسبة احتياطية" },
  unpriced: { en: "No supplier price", ar: "بلا سعر مورد" },
  noScreen: { en: "Screen price missing", ar: "سعر الشاشة ناقص" },
  differs: { en: "Differs from spec", ar: "يختلف عن المواصفة" },
  multi: { en: "More than one supplier", ar: "أكثر من مورد" },
  back: { en: "Send lines back to the supplier", ar: "أرجع بنوداً للمورد" },
  backTitle: { en: "Lines back to the supplier", ar: "إرجاع بنود للمورد" },
  backDesc: { en: "Say which lines and why. This note is a cost note: sales do not see it.", ar: "اذكر البنود والسبب. هذه ملاحظة تكلفة لا يراها فريق المبيعات." },
  which: { en: "Which lines, and what is wrong", ar: "أي البنود، وما المشكلة" },
  start: { en: "Start the selling price", ar: "ابدأ بناء سعر البيع" },
  started: { en: "Selling build started", ar: "بدأ بناء سعر البيع" },
} satisfies Record<string, Bi>;

const FIELD =
  "rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

export function CostReviewTab({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const grid = useQuery({
    queryKey: ["pricing-grid", file.file_id],
    queryFn: () => listSellingGrid(file.file_id),
    enabled: file.boq_revision_id != null,
  });
  const editable = canEditLineCost(file.state, rights);
  const [backOpen, setBackOpen] = useState(false);
  const money = (n: number | null) => (n == null ? "—" : formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  async function choose(lineId: string, choice: LineChoice) {
    try {
      await setLineChoice(file.file_id, lineId, choice);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  async function startSelling() {
    try {
      await movePricingFile(file.file_id, "selling_build");
      toast.success(pick(TEXT.started, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  if (!file.boq_revision_id) return <p className="text-sm text-muted-foreground">{pick(TEXT.noBoq, lang)}</p>;

  return (
    <div className="space-y-4">
      <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.sub, lang)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.sign, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.unit, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.screenUnit, lang)}</TableHead>
              <TableHead>{pick(TEXT.useScreen, lang)}</TableHead>
              <TableHead>{pick(TEXT.install, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.materials, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.installation, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(grid.data ?? []).map((g) => (
              <TableRow key={g.boq_line_id}>
                <TableCell>
                  <div className="font-medium">{g.sign_type}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.unpriced ? <StatusPill tone="danger">{pick(TEXT.unpriced, lang)}</StatusPill> : null}
                    {g.screen_price_missing ? <StatusPill tone="attention">{pick(TEXT.noScreen, lang)}</StatusPill> : null}
                    {g.quotes_count > 1 ? <StatusPill tone="attention">{pick(TEXT.multi, lang)}</StatusPill> : null}
                    {g.alternate_spec ? <StatusPill tone="attention">{pick(TEXT.differs, lang)}: {g.alternate_spec}</StatusPill> : null}
                  </div>
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(g.quantity, lang)}</TableCell>
                <TableCell className="text-end tabular-nums">{money(g.unit_cost)}</TableCell>
                <TableCell className="text-end tabular-nums">{money(g.unit_cost_with_screen)}</TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`${pick(TEXT.useScreen, lang)}: ${g.sign_type}`}
                    checked={g.use_screen_price}
                    disabled={!editable || g.unit_cost_with_screen == null}
                    onChange={(e) => void choose(g.boq_line_id, { use_screen_price: e.target.checked })}
                  />
                </TableCell>
                <TableCell>
                  <select
                    className={FIELD}
                    aria-label={`${pick(TEXT.install, lang)}: ${g.sign_type}`}
                    value={g.install_type ?? ""}
                    disabled={!editable}
                    onChange={(e) => void choose(g.boq_line_id, { install_type: (e.target.value || null) as InstallType | null })}
                  >
                    <option value="">{pick(TEXT.noType, lang)}</option>
                    {INSTALL_TYPES.map((t) => (
                      <option key={t} value={t}>{pick(INSTALL_TYPE_LABEL[t], lang)}</option>
                    ))}
                  </select>
                </TableCell>
                <TableCell className="text-end tabular-nums">{money(g.materials)}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {money(g.installation)}
                  {g.install_basis === "fallback" ? <div className="text-xs text-muted-foreground">{pick(TEXT.fallback, lang)}</div> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <div className="flex flex-wrap gap-2">
        {rights.is_pricer && file.state === "supplier_priced" && canPricerMove("supplier_priced", "at_supplier") ? (
          <Button variant="outline" onClick={() => setBackOpen(true)}>{pick(TEXT.back, lang)}</Button>
        ) : null}
        {rights.is_gm && file.state === "supplier_priced" && canGmMove("supplier_priced", "selling_build") ? (
          <Button onClick={() => void startSelling()}>{pick(TEXT.start, lang)}</Button>
        ) : null}
      </div>

      <ActionDialog
        open={backOpen}
        onOpenChange={setBackOpen}
        title={pick(TEXT.backTitle, lang)}
        description={pick(TEXT.backDesc, lang)}
        fields={[{ key: "note", type: "textarea", label: pick(TEXT.which, lang), required: true }]}
        submitLabel={pick(TEXT.back, lang)}
        recordId={file.file_id}
        onSubmit={async (v) => {
          try {
            await movePricingFile(file.file_id, "at_supplier", v.note);
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `bun run verify`
Expected: PASS. Typecheck, lint and tests are green, `ui-baseline` included (the checkbox and select carry `aria-label`).

Manual check on the local stack:
1. Put a file in `at_supplier`. Before Task 14, put a supplier quote on it with SQL as the owner while the revision is still unfrozen; see `supabase/tests/pricing_selling_grid.test.sql` for the shape.
2. As a pricer, click *The supplier has priced*, then confirm.
3. On Cost review, untick *Use screen price* and see Materials change.
4. As the GM, *Start the selling price*.

- [ ] **Step 4: Commit**

```bash
git add src/components/phc/pricing/SupplierTab.tsx src/components/phc/pricing/CostReviewTab.tsx
git commit -m "feat(pricing): Supplier and Cost review tabs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Selling price tab: grid, extras, logistics inputs, totals, Build price and Propose (UI)

**Files:**
- Create: `src/components/phc/pricing/CostInputsPanel.tsx`
- Create: `src/components/phc/pricing/ExtrasPanel.tsx`
- Replace: `src/components/phc/pricing/SellingPriceTab.tsx`

**Interfaces:**
- Consumes:
  - Task 7, from `@/lib/pricing-actions`:
    - reads: `getFileInputs`, `listSellingGrid`, `getSellingTotals`, `getPriceSummary`, `listFileExtras`, `listCatalog`;
    - writes: `setFileInputs`, `setLineChoice`, `suggestExtras`, `decideExtra`, `addExtra`, `buildPrice`, `proposePrice`;
    - types: `FileInputs`, `GridRow`, `TotalsRow`, `FileExtraRow`, `CatalogRow`, `LineChoice`.
  - Task 7, from `@/lib/pricing-access`: `canEditFileInputs`, `canEditLineCost`, `canEditSelling`, `canBuildPrice`.
  - Task 8: `PricingTabProps`.
  - SQL behaviour this screen relies on:
    - Totals and margin come from `pricing_selling_totals`.
    - Propose re-builds and refuses a stale total.
    - Below the floor, the justification is required by the Phase 8 guard (23514).
- Produces: `SellingPriceTab(props)`, `CostInputsPanel(props)`, `ExtrasPanel(props)`. All take `PricingTabProps`.
  - Query keys: `["pricing-grid", fileId]`, `["pricing-totals", fileId]`, `["pricing-inputs", fileId]`, `["pricing-extras", fileId, revisionId]`, `["pricing-catalog"]`, `["pricing-price", priceId]`.

- [ ] **Step 1: Create `src/components/phc/pricing/CostInputsPanel.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/phc/Panel";
import { useI18n } from "@/lib/i18n";
import { getFileInputs, setFileInputs, type FileInputs } from "@/lib/pricing-actions";
import { canEditFileInputs, canEditSelling } from "@/lib/pricing-access";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Logistics and project inputs", ar: "الشحن ومُدخلات المشروع" },
  sub: { en: "Spread over the lines by value. Rates come from Pricing settings.", ar: "تُوزَّع على البنود حسب القيمة. الأسعار من إعدادات التسعير." },
  containers: { en: "Containers", ar: "عدد الحاويات" },
  delivery: { en: "Inland delivery", ar: "التوصيل الداخلي" },
  none: { en: "None", ar: "بدون" },
  jeddah: { en: "Inside Jeddah", ar: "داخل جدة" },
  riyadh: { en: "Jeddah to Riyadh", ar: "جدة إلى الرياض" },
  clearing: { en: "Clearing agent", ar: "المخلّص الجمركي" },
  overhead: { en: "Overhead %", ar: "المصاريف العامة %" },
  cinema: { en: "Cinema project (suggests acoustic items)", ar: "مشروع سينمائي (يقترح بنود العزل الصوتي)" },
  margin: { en: "Default margin % for this file (GM)", ar: "الهامش الافتراضي % لهذا الملف (المدير العام)" },
  marginHint: { en: "Empty uses the settings default.", ar: "الفارغ يأخذ الافتراضي من الإعدادات." },
  save: { en: "Save inputs", ar: "احفظ المُدخلات" },
  saved: { en: "Inputs saved", ar: "حُفظت المُدخلات" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";
const DEFAULTS: Omit<FileInputs, "file_id"> = { is_cinema: false, containers: 0, delivery: "none", clearing: false, overhead_pct: 0, default_margin_pct: null };

export function CostInputsPanel({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const inputs = useQuery({ queryKey: ["pricing-inputs", file.file_id], queryFn: () => getFileInputs(file.file_id) });
  const editable = canEditFileInputs(file.state, rights);
  const marginEditable = canEditSelling(file.state, rights);
  const [draft, setDraft] = useState<Partial<Omit<FileInputs, "file_id">>>({});
  const saved = { ...DEFAULTS, ...(inputs.data ?? {}) };
  const v = { ...saved, ...draft };
  const changed = Object.keys(draft).length > 0;

  async function save() {
    const payload: Partial<Omit<FileInputs, "file_id">> = { ...draft };
    if (!marginEditable) delete payload.default_margin_pct;
    try {
      await setFileInputs(file.file_id, payload);
      toast.success(pick(TEXT.saved, lang));
      setDraft({});
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  const numberField = (key: "containers" | "overhead_pct", label: Bi) => (
    <label className="space-y-1 text-sm">
      <span>{pick(label, lang)}</span>
      <input
        type="number" min={0} step="0.01" className={FIELD} disabled={!editable}
        value={String(v[key])}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value === "" ? 0 : Number(e.target.value) }))}
      />
    </label>
  );

  return (
    <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.sub, lang)}
      action={editable ? <Button size="sm" disabled={!changed} onClick={() => void save()}>{pick(TEXT.save, lang)}</Button> : undefined}>
      <div className="grid gap-3 sm:grid-cols-3">
        {numberField("containers", TEXT.containers)}
        <label className="space-y-1 text-sm">
          <span>{pick(TEXT.delivery, lang)}</span>
          <select className={FIELD} disabled={!editable} value={v.delivery}
            onChange={(e) => setDraft((d) => ({ ...d, delivery: e.target.value as FileInputs["delivery"] }))}>
            <option value="none">{pick(TEXT.none, lang)}</option>
            <option value="jeddah">{pick(TEXT.jeddah, lang)}</option>
            <option value="riyadh">{pick(TEXT.riyadh, lang)}</option>
          </select>
        </label>
        {numberField("overhead_pct", TEXT.overhead)}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!editable} checked={v.clearing} onChange={(e) => setDraft((d) => ({ ...d, clearing: e.target.checked }))} />
          {pick(TEXT.clearing, lang)}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!editable} checked={v.is_cinema} onChange={(e) => setDraft((d) => ({ ...d, is_cinema: e.target.checked }))} />
          {pick(TEXT.cinema, lang)}
        </label>
        <label className="space-y-1 text-sm">
          <span>{pick(TEXT.margin, lang)}</span>
          <input
            type="number" step="0.01" className={FIELD} disabled={!marginEditable} placeholder={pick(TEXT.marginHint, lang)}
            value={v.default_margin_pct == null ? "" : String(v.default_margin_pct)}
            onChange={(e) => setDraft((d) => ({ ...d, default_margin_pct: e.target.value === "" ? null : Number(e.target.value) }))}
          />
        </label>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 2: Create `src/components/phc/pricing/ExtrasPanel.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatNumber } from "@/lib/i18n";
import { addExtra, decideExtra, listCatalog, listFileExtras, suggestExtras, type FileExtraRow } from "@/lib/pricing-actions";
import { canEditLineCost } from "@/lib/pricing-access";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Extras", ar: "البنود الإضافية" },
  sub: { en: "Every suggested item must be accepted or dismissed before the price can be proposed.", ar: "كل بند مقترح يجب قبوله أو رفضه قبل اقتراح السعر." },
  check: { en: "Check suggestions", ar: "افحص الاقتراحات" },
  added: { en: "new suggestions", ar: "اقتراحات جديدة" },
  item: { en: "Item", ar: "البند" },
  qty: { en: "Qty", ar: "الكمية" },
  rate: { en: "Rate", ar: "السعر" },
  status: { en: "Status", ar: "الحالة" },
  suggested: { en: "Suggested", ar: "مقترح" },
  accepted: { en: "Accepted", ar: "مقبول" },
  dismissed: { en: "Dismissed", ar: "مرفوض" },
  accept: { en: "Accept", ar: "اقبل" },
  dismiss: { en: "Dismiss", ar: "ارفض" },
  dismissTitle: { en: "Dismiss this item", ar: "رفض هذا البند" },
  reason: { en: "Why is it not needed?", ar: "لماذا لا حاجة له؟" },
  add: { en: "Add from the catalog", ar: "أضف من الكتالوج" },
  pickItem: { en: "Choose an item", ar: "اختر بنداً" },
  addBtn: { en: "Add", ar: "أضف" },
  none: { en: "No extras for this round yet.", ar: "لا بنود إضافية لهذه الجولة بعد." },
  saved: { en: "Saved", ar: "تم الحفظ" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

export function ExtrasPanel({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const revisionId = file.boq_revision_id;
  const extras = useQuery({
    queryKey: ["pricing-extras", file.file_id, revisionId],
    queryFn: () => listFileExtras(file.file_id, revisionId as string),
    enabled: revisionId != null,
  });
  const catalog = useQuery({ queryKey: ["pricing-catalog"], queryFn: listCatalog });
  const editable = canEditLineCost(file.state, rights);
  const [edits, setEdits] = useState<Record<string, { quantity?: string; rate?: string }>>({});
  const [dismissing, setDismissing] = useState<FileExtraRow | null>(null);
  const [add, setAdd] = useState({ id: "", quantity: "1", rate: "" });
  const name = (x: FileExtraRow) => (x.catalog ? (lang === "ar" ? x.catalog.name_ar : x.catalog.name_en) : "—");

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      toast.success(pick(TEXT.saved, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  async function check() {
    try {
      const n = await suggestExtras(file.file_id);
      toast.success(`${n} ${pick(TEXT.added, lang)}`);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  const num = (s: string | undefined) => (s == null || s.trim() === "" ? undefined : Number(s));

  return (
    <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.sub, lang)}
      action={editable ? <Button size="sm" variant="outline" onClick={() => void check()}>{pick(TEXT.check, lang)}</Button> : undefined}>
      <div className="space-y-4">
        {(extras.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{pick(TEXT.none, lang)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(TEXT.item, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.rate, lang)}</TableHead>
                <TableHead>{pick(TEXT.status, lang)}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(extras.data ?? []).map((x) => {
                const open = x.status === "suggested" && editable;
                const e = edits[x.id] ?? {};
                return (
                  <TableRow key={x.id}>
                    <TableCell>{name(x)}{x.catalog ? <span className="text-xs text-muted-foreground"> · {x.catalog.unit}</span> : null}</TableCell>
                    <TableCell className="text-end">
                      {open ? (
                        <input type="number" min={0} className={`${FIELD} w-24`} aria-label={`${pick(TEXT.qty, lang)}: ${name(x)}`}
                          value={e.quantity ?? String(x.quantity)}
                          onChange={(ev) => setEdits((m) => ({ ...m, [x.id]: { ...m[x.id], quantity: ev.target.value } }))} />
                      ) : (
                        <span className="tabular-nums">{formatNumber(x.quantity, lang)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {open ? (
                        <input type="number" min={0} className={`${FIELD} w-28`} aria-label={`${pick(TEXT.rate, lang)}: ${name(x)}`}
                          value={e.rate ?? String(x.rate)}
                          onChange={(ev) => setEdits((m) => ({ ...m, [x.id]: { ...m[x.id], rate: ev.target.value } }))} />
                      ) : (
                        <span className="tabular-nums">{formatNumber(x.rate, lang)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={x.status === "suggested" ? "attention" : x.status === "accepted" ? "positive" : "muted"}>
                        {pick(TEXT[x.status], lang)}
                      </StatusPill>
                      {x.dismiss_reason ? <div className="text-xs text-muted-foreground">{x.dismiss_reason}</div> : null}
                    </TableCell>
                    <TableCell className="text-end">
                      {open ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" onClick={() => void run(() => decideExtra(x.id, true, { quantity: num(e.quantity), rate: num(e.rate) }))}>
                            {pick(TEXT.accept, lang)}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDismissing(x)}>{pick(TEXT.dismiss, lang)}</Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {editable ? (
          <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <label className="space-y-1 text-sm">
              <span>{pick(TEXT.add, lang)}</span>
              <select className={FIELD} value={add.id} onChange={(e) => setAdd((a) => ({ ...a, id: e.target.value }))}>
                <option value="">{pick(TEXT.pickItem, lang)}</option>
                {(catalog.data ?? []).filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{lang === "ar" ? c.name_ar : c.name_en} · {c.unit}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{pick(TEXT.qty, lang)}</span>
              <input type="number" min={0} className={FIELD} value={add.quantity} onChange={(e) => setAdd((a) => ({ ...a, quantity: e.target.value }))} />
            </label>
            <label className="space-y-1 text-sm">
              <span>{pick(TEXT.rate, lang)}</span>
              <input type="number" min={0} className={FIELD} value={add.rate}
                placeholder={String((catalog.data ?? []).find((c) => c.id === add.id)?.default_rate ?? "")}
                onChange={(e) => setAdd((a) => ({ ...a, rate: e.target.value }))} />
            </label>
            <Button disabled={!add.id || !(Number(add.quantity) > 0)}
              onClick={() => void run(async () => {
                await addExtra(file.file_id, add.id, Number(add.quantity), num(add.rate) ?? null);
                setAdd({ id: "", quantity: "1", rate: "" });
              })}>
              {pick(TEXT.addBtn, lang)}
            </Button>
          </div>
        ) : null}
      </div>

      {/* recordId stays next to open: action-dialog-drafts.contract.test.ts reads the first 300 characters. */}
      <ActionDialog
        open={!!dismissing}
        recordId={dismissing?.id ?? null}
        onOpenChange={(o) => !o && setDismissing(null)}
        title={pick(TEXT.dismissTitle, lang)}
        description={dismissing ? name(dismissing) : undefined}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.dismiss, lang)}
        onSubmit={async (v) => {
          if (!dismissing) return;
          try {
            await decideExtra(dismissing.id, false, { reason: v.reason });
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </Panel>
  );
}
```

- [ ] **Step 3: Replace `src/components/phc/pricing/SellingPriceTab.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import {
  buildPrice, getPriceSummary, getSellingTotals, listFileExtras, listSellingGrid, proposePrice, setLineChoice,
  type GridRow, type LineChoice,
} from "@/lib/pricing-actions";
import { canBuildPrice, canEditSelling } from "@/lib/pricing-access";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { CostInputsPanel } from "@/components/phc/pricing/CostInputsPanel";
import { ExtrasPanel } from "@/components/phc/pricing/ExtrasPanel";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  noBoq: { en: "No BOQ on this file yet.", ar: "لا كميات في هذا الملف بعد." },
  lines: { en: "Selling price by line", ar: "سعر البيع لكل بند" },
  linesSub: { en: "Cost includes installation, extras and logistics spread by value, and overhead. Margin is on price.", ar: "التكلفة تشمل التركيب والبنود الإضافية والشحن موزعة حسب القيمة والمصاريف العامة. الهامش من سعر البيع." },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  cost: { en: "Cost", ar: "التكلفة" },
  marginIn: { en: "Margin %", ar: "الهامش %" },
  typed: { en: "Selling (typed)", ar: "سعر البيع (يدوي)" },
  selling: { en: "Selling", ar: "سعر البيع" },
  margin: { en: "Margin", ar: "الهامش" },
  unpriced: { en: "No supplier price", ar: "بلا سعر مورد" },
  totals: { en: "Totals", ar: "الإجماليات" },
  totalCost: { en: "Total cost", ar: "إجمالي التكلفة" },
  totalSelling: { en: "Total selling price", ar: "إجمالي سعر البيع" },
  marginTotal: { en: "Margin", ar: "الهامش" },
  floor: { en: "Margin floor", ar: "الحد الأدنى للهامش" },
  noFloor: { en: "No floor set", ar: "لا حد أدنى محدد" },
  belowFloor: { en: "Below the floor: write why this price is worth taking.", ar: "أقل من الحد الأدنى: اكتب لماذا يستحق هذا السعر." },
  justification: { en: "Justification", ar: "المبرر" },
  unpricedWarn: { en: "Some lines have no supplier price, so the price cannot be built.", ar: "بعض البنود بلا سعر مورد، فلا يمكن بناء السعر." },
  multiWarn: { en: "A line has prices from more than one supplier; one supplier per file for now.", ar: "أحد البنود له أسعار من أكثر من مورد؛ مورد واحد لكل ملف حالياً." },
  openWarn: { en: "Decide every suggested extra before proposing.", ar: "قرّر كل بند إضافي مقترح قبل الاقتراح." },
  price: { en: "Internal price", ar: "السعر الداخلي" },
  stale: { en: "The grid changed since the last build; build again before proposing.", ar: "تغيّر الجدول منذ آخر بناء؛ ابنِ السعر مجدداً قبل الاقتراح." },
  returned: { en: "Returned by Zayed", ar: "أعاده زايد" },
  build: { en: "Build price", ar: "ابنِ السعر" },
  built: { en: "Price built", ar: "بُني السعر" },
  propose: { en: "Propose price", ar: "اقترح السعر" },
  proposed: { en: "Proposed: the price goes to Zayed's review", ar: "اقتُرح السعر: يذهب لمراجعة زايد" },
  gmNote: { en: "Zayed reviews the price you propose. He can approve a price only if he did not set its figures; prices you build are yours.", ar: "يراجع زايد السعر الذي تقترحه. لا يعتمد سعراً وضع هو أرقامه؛ الأسعار التي تبنيها أنت أرقامها لك." },
  pricerNote: { en: "Only the GM sets margins and selling prices. You set the cost choices: screen price, install type, logistics and extras.", ar: "الهوامش وأسعار البيع يضعها المدير العام فقط. أنت تضبط اختيارات التكلفة: سعر الشاشة ونوع التركيب والشحن والبنود الإضافية." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-24 rounded-md border border-border bg-background px-2 py-1 text-end text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

export function SellingPriceTab(props: PricingTabProps) {
  const { file, rights, onChanged } = props;
  const { lang } = useI18n();
  const revisionId = file.boq_revision_id;
  const grid = useQuery({ queryKey: ["pricing-grid", file.file_id], queryFn: () => listSellingGrid(file.file_id), enabled: revisionId != null });
  const totals = useQuery({ queryKey: ["pricing-totals", file.file_id], queryFn: () => getSellingTotals(file.file_id), enabled: revisionId != null });
  const extras = useQuery({
    queryKey: ["pricing-extras", file.file_id, revisionId],
    queryFn: () => listFileExtras(file.file_id, revisionId as string),
    enabled: revisionId != null,
  });
  const price = useQuery({
    queryKey: ["pricing-price", file.internal_price_id],
    queryFn: () => getPriceSummary(file.internal_price_id as string),
    enabled: file.internal_price_id != null,
  });
  const sellingEditable = canEditSelling(file.state, rights);
  const canBuild = canBuildPrice(file.state, rights);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (n: number | null | undefined) => (n == null ? "—" : formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (n: number | null | undefined) => (n == null ? "—" : `${formatNumber(n, lang, { maximumFractionDigits: 2 })}%`);

  if (!revisionId) return <p className="text-sm text-muted-foreground">{pick(TEXT.noBoq, lang)}</p>;

  const t = totals.data;
  const openExtras = (extras.data ?? []).filter((x) => x.status === "suggested").length;
  const stale = price.data?.proposed_price != null && t?.total_selling != null && price.data.proposed_price !== t.total_selling;
  const ready = !!t && t.unpriced_lines === 0 && t.multi_quote_lines === 0 && (t.total_selling ?? 0) > 0;
  const canPropose = canBuild && ready && openExtras === 0 && (!t?.below_floor || justification.trim().length > 0);

  async function choose(g: GridRow, choice: LineChoice) {
    try {
      await setLineChoice(file.file_id, g.boq_line_id, choice);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }
  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

  async function act(fn: () => Promise<unknown>, ok: Bi) {
    setBusy(true);
    try {
      await fn();
      toast.success(pick(ok, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{pick(rights.is_gm ? TEXT.gmNote : TEXT.pricerNote, lang)}</p>
      <CostInputsPanel {...props} />
      <ExtrasPanel {...props} />

      <Panel title={pick(TEXT.lines, lang)} subtitle={pick(TEXT.linesSub, lang)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.sign, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.cost, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.marginIn, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.typed, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.selling, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.margin, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(grid.data ?? []).map((g) => (
              <TableRow key={g.boq_line_id}>
                <TableCell>
                  <div className="font-medium">{g.sign_type}</div>
                  {g.unpriced ? <StatusPill tone="danger">{pick(TEXT.unpriced, lang)}</StatusPill> : null}
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(g.quantity, lang)}</TableCell>
                <TableCell className="text-end tabular-nums">{money(g.line_cost)}</TableCell>
                <TableCell className="text-end">
                  <input
                    key={`m-${g.boq_line_id}-${g.line_margin_pct ?? ""}`}
                    type="number" step="0.01" className={FIELD}
                    aria-label={`${pick(TEXT.marginIn, lang)}: ${g.sign_type}`}
                    defaultValue={g.line_margin_pct ?? ""}
                    placeholder={String(g.default_margin_pct)}
                    disabled={!sellingEditable || g.typed_selling_price != null}
                    onBlur={(e) => {
                      const next = numOrNull(e.currentTarget.value);
                      if (next !== g.line_margin_pct) void choose(g, { margin_pct: next });
                    }}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <input
                    key={`s-${g.boq_line_id}-${g.typed_selling_price ?? ""}`}
                    type="number" step="0.01" min={0} className={FIELD}
                    aria-label={`${pick(TEXT.typed, lang)}: ${g.sign_type}`}
                    defaultValue={g.typed_selling_price ?? ""}
                    disabled={!sellingEditable}
                    onBlur={(e) => {
                      const next = numOrNull(e.currentTarget.value);
                      if (next !== g.typed_selling_price) void choose(g, { selling_price: next });
                    }}
                  />
                </TableCell>
                <TableCell className="text-end tabular-nums">{money(g.selling_price)}</TableCell>
                <TableCell className="text-end tabular-nums">{pct(g.margin_pct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <Panel title={pick(TEXT.totals, lang)} tone={t?.below_floor ? "attention" : "default"}>
        <div className="space-y-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-4">
            <div><dt className="text-muted-foreground">{pick(TEXT.totalCost, lang)}</dt><dd className="text-lg font-semibold tabular-nums">{money(t?.total_cost)}</dd></div>
            <div><dt className="text-muted-foreground">{pick(TEXT.totalSelling, lang)}</dt><dd className="text-lg font-semibold tabular-nums">{money(t?.total_selling)}</dd></div>
            <div><dt className="text-muted-foreground">{pick(TEXT.marginTotal, lang)}</dt><dd className="text-lg font-semibold tabular-nums">{pct(t?.margin_pct)}</dd></div>
            <div><dt className="text-muted-foreground">{pick(TEXT.floor, lang)}</dt><dd className="text-lg font-semibold tabular-nums">{t?.floor_pct == null ? pick(TEXT.noFloor, lang) : pct(t.floor_pct)}</dd></div>
          </dl>
          {t && t.unpriced_lines > 0 ? <p className="text-destructive">{pick(TEXT.unpricedWarn, lang)}</p> : null}
          {t && t.multi_quote_lines > 0 ? <p className="text-destructive">{pick(TEXT.multiWarn, lang)}</p> : null}
          {openExtras > 0 ? <p className="text-amber-light">{pick(TEXT.openWarn, lang)}</p> : null}
          {price.data ? (
            <p>
              {pick(TEXT.price, lang)}: {money(price.data.proposed_price)} · {price.data.status}
              {stale ? <span className="text-amber-light"> · {pick(TEXT.stale, lang)}</span> : null}
            </p>
          ) : null}
          {price.data?.status === "returned" && price.data.return_reason ? (
            <p className="text-amber-light">{pick(TEXT.returned, lang)}: {price.data.return_reason}</p>
          ) : null}
          {t?.below_floor && canBuild ? (
            <label className="block space-y-1">
              <span>{pick(TEXT.belowFloor, lang)}</span>
              <textarea
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                aria-label={pick(TEXT.justification, lang)}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
              />
            </label>
          ) : null}
          {canBuild ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || !ready} onClick={() => void act(() => buildPrice(file.file_id), TEXT.built)}>
                {pick(TEXT.build, lang)}
              </Button>
              <Button
                disabled={busy || !canPropose}
                onClick={() => void act(() => proposePrice(file.file_id, t?.total_selling ?? 0, justification.trim() || undefined), TEXT.proposed)}
              >
                {pick(TEXT.propose, lang)}
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `bun run verify`
Expected: PASS. In `ExtrasPanel`, `pick(TEXT[x.status], lang)` typechecks because `"suggested" | "accepted" | "dismissed"` are keys of `TEXT`.

Manual check on the local stack, using a file in `selling_build` with supplier prices:
1. As the GM, set one line to 30% and another to a typed price, and watch the totals change. The margin is never an input.
2. Accept one suggested extra and dismiss one with a reason.
3. Set containers to 1 and delivery to Riyadh, and save.
4. Click *Build price*, then *Propose price*. The header should show *Price review (finance)*.
5. As Zayed, check the margin inputs are disabled and the pricer note shows.
6. Below the floor, check Propose stays disabled until a justification is typed.
7. Switch to Arabic and check RTL.

- [ ] **Step 5: Commit**

```bash
git add src/components/phc/pricing/CostInputsPanel.tsx src/components/phc/pricing/ExtrasPanel.tsx src/components/phc/pricing/SellingPriceTab.tsx
git commit -m "feat(pricing): Selling price tab with grid, extras, logistics inputs, totals, Build price and Propose" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Pricing settings page (UI)

**Files:**
- Create: `src/components/phc/pricing/SettingsCards.tsx`
- Replace: `src/routes/_authenticated/pricing.settings.tsx` (Task 8's stub)
- Modify (generated): `src/routeTree.gen.ts`

**Interfaces:**
- Consumes:
  - Task 7, from `@/lib/pricing-actions`:
    - `listInstallationRates`, `setInstallationRate`, `listLogisticsRates`, `updateLogisticsRate`, `listCatalog`, `saveCatalogItem`, `getMarginFloor`, `setMarginFloor`;
    - types `InstallationRateRow`, `RateInput`, `LogisticsRateRow`, `LogisticsRateKey`, `CatalogRow`, `CatalogInput`.
  - Task 7: `NO_RIGHTS` (`@/lib/pricing-access`).
  - Task 8: `usePricingRights`.
  - Task 9: `INSTALL_TYPES`, `INSTALL_TYPE_LABEL` (`@/lib/boq-import`).
  - SQL rights: cost readers read; pricers edit rates, the catalog and logistics; the GM sets the floor (Task 3).
- Produces:
  - `InstallationRatesCard({ canEdit })`, `DefaultsCard({ canEdit, canSetFloor })`, `CatalogCard({ canEdit })`.
  - Route `/pricing/settings`.

- [ ] **Step 1: Create `src/components/phc/pricing/SettingsCards.tsx`**

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import type { InstallType } from "@/lib/pricing";
import {
  getMarginFloor, listCatalog, listInstallationRates, listLogisticsRates, saveCatalogItem, setInstallationRate,
  setMarginFloor, updateLogisticsRate, type CatalogInput, type CatalogRow, type LogisticsRateKey, type RateInput,
} from "@/lib/pricing-actions";
import { INSTALL_TYPES, INSTALL_TYPE_LABEL } from "@/lib/boq-import";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";
const today = () => new Date().toISOString().slice(0, 10);

function useSaver() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  return async (fn: () => Promise<unknown>, ok: Bi) => {
    try {
      await fn();
      toast.success(pick(ok, lang));
      await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("pricing-") });
      return true;
    } catch (e) {
      toast.error(dbMessage(e, lang));
      return false;
    }
  };
}

// ---- Installation rate card ---------------------------------------------------

const RT = {
  title: { en: "Installation rate card", ar: "جدول أسعار التركيب" },
  sub: { en: "What PHC pays the installer per sign, by type. A new rate starts on a date; the one before it ends that day.", ar: "ما تدفعه PHC للمركّب لكل لوحة حسب النوع. يبدأ السعر الجديد في تاريخ وينتهي السابق في اليوم نفسه." },
  type: { en: "Type", ar: "النوع" },
  from: { en: "From", ar: "من" },
  to: { en: "To", ar: "إلى" },
  base: { en: "Base", ar: "الأساس" },
  perKg: { en: "Per kg over", ar: "لكل كغ فوق" },
  kgFrom: { en: "kg threshold", ar: "حد الوزن (كغ)" },
  perM: { en: "Per m over", ar: "لكل متر فوق" },
  mFrom: { en: "Height threshold (m)", ar: "حد الارتفاع (م)" },
  cut: { en: "Floor cut", ar: "قص الأرضية" },
  scaffold: { en: "Scaffold", ar: "سقالة" },
  crane: { en: "Crane", ar: "رافعة" },
  inForce: { en: "In force", ar: "سارٍ" },
  open: { en: "open", ar: "مفتوح" },
  newRate: { en: "Set a rate", ar: "حدّد سعراً" },
  save: { en: "Save rate", ar: "احفظ السعر" },
  saved: { en: "Rate saved", ar: "حُفظ السعر" },
  none: { en: "No rates yet. Lines fall back to the % of materials.", ar: "لا أسعار بعد. تأخذ البنود النسبة الاحتياطية من المواد." },
} satisfies Record<string, Bi>;

const EMPTY_RATE = (): RateInput => ({
  install_type: "wall_screw", effective_from: today(), base_rate: 0, per_kg_over: 0, weight_threshold_kg: null,
  per_m_over: 0, height_threshold_m: null, floor_cut_add: 0, scaffold_add: 0, crane_add: 0,
});

export function InstallationRatesCard({ canEdit }: { canEdit: boolean }) {
  const { lang } = useI18n();
  const save = useSaver();
  const rates = useQuery({ queryKey: ["pricing-installation-rates"], queryFn: listInstallationRates });
  const [form, setForm] = useState<RateInput>(EMPTY_RATE());
  const n = (v: number | null) => (v == null ? "—" : formatNumber(v, lang));
  const d = today();
  type NumKey = "base_rate" | "per_kg_over" | "weight_threshold_kg" | "per_m_over" | "height_threshold_m" | "floor_cut_add" | "scaffold_add" | "crane_add";
  const numField = (k: NumKey, label: Bi, nullable = false) => (
    <label className="space-y-1 text-sm">
      <span>{pick(label, lang)}</span>
      <input type="number" min={0} step="0.01" className={FIELD}
        value={form[k] == null ? "" : String(form[k])}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value === "" ? (nullable ? null : 0) : Number(e.target.value) }))} />
    </label>
  );

  return (
    <Panel title={pick(RT.title, lang)} subtitle={pick(RT.sub, lang)}>
      <div className="space-y-4">
        {(rates.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{pick(RT.none, lang)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(RT.type, lang)}</TableHead>
                <TableHead>{pick(RT.from, lang)}</TableHead>
                <TableHead>{pick(RT.to, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.base, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.perKg, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.perM, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.cut, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.scaffold, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.crane, lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rates.data ?? []).map((r) => {
                const inForce = r.effective_from <= d && (r.effective_to == null || r.effective_to > d);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      {pick(INSTALL_TYPE_LABEL[r.install_type], lang)}{" "}
                      {inForce ? <StatusPill tone="positive">{pick(RT.inForce, lang)}</StatusPill> : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{r.effective_from}</TableCell>
                    <TableCell className="tabular-nums">{r.effective_to ?? pick(RT.open, lang)}</TableCell>
                    <TableCell className="text-end tabular-nums">{n(r.base_rate)}</TableCell>
                    <TableCell className="text-end tabular-nums">{n(r.per_kg_over)}{r.weight_threshold_kg != null ? ` > ${r.weight_threshold_kg}` : ""}</TableCell>
                    <TableCell className="text-end tabular-nums">{n(r.per_m_over)}{r.height_threshold_m != null ? ` > ${r.height_threshold_m}` : ""}</TableCell>
                    <TableCell className="text-end tabular-nums">{n(r.floor_cut_add)}</TableCell>
                    <TableCell className="text-end tabular-nums">{n(r.scaffold_add)}</TableCell>
                    <TableCell className="text-end tabular-nums">{n(r.crane_add)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {canEdit ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{pick(RT.newRate, lang)}</p>
            <div className="grid gap-3 sm:grid-cols-5">
              <label className="space-y-1 text-sm">
                <span>{pick(RT.type, lang)}</span>
                <select className={FIELD} value={form.install_type} onChange={(e) => setForm((f) => ({ ...f, install_type: e.target.value as InstallType }))}>
                  {INSTALL_TYPES.map((t) => <option key={t} value={t}>{pick(INSTALL_TYPE_LABEL[t], lang)}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>{pick(RT.from, lang)}</span>
                <input type="date" min={d} className={FIELD} value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} />
              </label>
              {numField("base_rate", RT.base)}
              {numField("per_kg_over", RT.perKg)}
              {numField("weight_threshold_kg", RT.kgFrom, true)}
              {numField("per_m_over", RT.perM)}
              {numField("height_threshold_m", RT.mFrom, true)}
              {numField("floor_cut_add", RT.cut)}
              {numField("scaffold_add", RT.scaffold)}
              {numField("crane_add", RT.crane)}
            </div>
            <Button size="sm" onClick={() => void save(() => setInstallationRate(form), RT.saved).then((ok) => ok && setForm(EMPTY_RATE()))}>
              {pick(RT.save, lang)}
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

// ---- Logistics and pricing defaults, margin floor ------------------------------

const KEY_LABEL: Record<LogisticsRateKey, Bi> = {
  container_rate: { en: "Container from China (per container)", ar: "شحن حاوية من الصين (لكل حاوية)" },
  customs_pct: { en: "Customs, % of goods value", ar: "الجمارك، % من قيمة البضاعة" },
  clearing_fee: { en: "Clearing agent fee", ar: "أجرة المخلّص" },
  delivery_jeddah: { en: "Delivery inside Jeddah", ar: "التوصيل داخل جدة" },
  delivery_riyadh: { en: "Jeddah to Riyadh warehouse", ar: "جدة إلى مستودع الرياض" },
  install_fallback_pct: { en: "Installation fallback, % of materials", ar: "التركيب الاحتياطي، % من المواد" },
  default_margin_pct: { en: "Default margin, % on price", ar: "الهامش الافتراضي، % من سعر البيع" },
};
const DT = {
  title: { en: "Logistics and pricing defaults", ar: "الشحن والقيم الافتراضية للتسعير" },
  sub: { en: "A new value is in force from the day it is saved; earlier values stay in the audit log.", ar: "القيمة الجديدة سارية من يوم حفظها؛ القيم السابقة تبقى في سجل التدقيق." },
  item: { en: "Item", ar: "البند" },
  value: { en: "Value", ar: "القيمة" },
  note: { en: "Note", ar: "ملاحظة" },
  since: { en: "In force since", ar: "سارٍ منذ" },
  save: { en: "Save", ar: "احفظ" },
  saved: { en: "Saved", ar: "تم الحفظ" },
  floor: { en: "Margin floor (the GM's)", ar: "الحد الأدنى للهامش (للمدير العام)" },
  floorSub: { en: "Below it, a price needs a written justification before it goes to review.", ar: "تحته يحتاج السعر مبرراً مكتوباً قبل إرساله للمراجعة." },
  noFloor: { en: "No floor is set, so no justification is asked for.", ar: "لا حد أدنى محدد، فلا يُطلب مبرر." },
  pct: { en: "Floor %", ar: "الحد %" },
  why: { en: "Why", ar: "السبب" },
  setFloor: { en: "Set the floor", ar: "حدّد الحد الأدنى" },
} satisfies Record<string, Bi>;

export function DefaultsCard({ canEdit, canSetFloor }: { canEdit: boolean; canSetFloor: boolean }) {
  const { lang } = useI18n();
  const save = useSaver();
  const rates = useQuery({ queryKey: ["pricing-logistics-rates"], queryFn: listLogisticsRates });
  const floor = useQuery({ queryKey: ["pricing-margin-floor"], queryFn: getMarginFloor });
  const [edits, setEdits] = useState<Record<string, { value?: string; note?: string }>>({});
  const [floorForm, setFloorForm] = useState({ pct: "", why: "" });

  return (
    <div className="space-y-6">
      <Panel title={pick(DT.title, lang)} subtitle={pick(DT.sub, lang)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(DT.item, lang)}</TableHead>
              <TableHead className="text-end">{pick(DT.value, lang)}</TableHead>
              <TableHead>{pick(DT.note, lang)}</TableHead>
              <TableHead>{pick(DT.since, lang)}</TableHead>
              {canEdit ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rates.data ?? []).map((r) => {
              const e = edits[r.key] ?? {};
              return (
                <TableRow key={r.key}>
                  <TableCell>{pick(KEY_LABEL[r.key], lang)} <span className="text-xs text-muted-foreground">({r.currency})</span></TableCell>
                  <TableCell className="text-end">
                    {canEdit ? (
                      <input type="number" min={0} step="0.01" className={`${FIELD} w-28`} aria-label={pick(KEY_LABEL[r.key], lang)}
                        value={e.value ?? String(r.value)} onChange={(ev) => setEdits((m) => ({ ...m, [r.key]: { ...m[r.key], value: ev.target.value } }))} />
                    ) : (
                      <span className="tabular-nums">{formatNumber(r.value, lang)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEdit ? (
                      <input className={FIELD} aria-label={`${pick(DT.note, lang)}: ${pick(KEY_LABEL[r.key], lang)}`}
                        value={e.note ?? r.note ?? ""} onChange={(ev) => setEdits((m) => ({ ...m, [r.key]: { ...m[r.key], note: ev.target.value } }))} />
                    ) : (
                      <span className="text-muted-foreground">{r.note}</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.effective_from}</TableCell>
                  {canEdit ? (
                    <TableCell className="text-end">
                      <Button size="sm" variant="outline" disabled={e.value === undefined && e.note === undefined}
                        onClick={() => void save(
                          () => updateLogisticsRate(r.key, e.value === undefined ? r.value : Number(e.value), e.note === undefined ? r.note : e.note || null),
                          DT.saved,
                        ).then((ok) => ok && setEdits((m) => ({ ...m, [r.key]: {} })))}>
                        {pick(DT.save, lang)}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Panel>

      <Panel title={pick(DT.floor, lang)} subtitle={pick(DT.floorSub, lang)}>
        <div className="space-y-3 text-sm">
          {floor.data ? (
            <p>
              <span className="text-lg font-semibold tabular-nums">{formatNumber(floor.data.min_margin_pct, lang)}%</span>{" "}
              <span className="text-muted-foreground">· {pick(DT.since, lang)} {floor.data.effective_from.slice(0, 10)}{floor.data.rationale ? ` · ${floor.data.rationale}` : ""}</span>
            </p>
          ) : (
            <p className="text-muted-foreground">{pick(DT.noFloor, lang)}</p>
          )}
          {canSetFloor ? (
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_3fr_auto]">
              <label className="space-y-1">
                <span>{pick(DT.pct, lang)}</span>
                <input type="number" step="0.01" className={FIELD} value={floorForm.pct} onChange={(e) => setFloorForm((f) => ({ ...f, pct: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span>{pick(DT.why, lang)}</span>
                <input className={FIELD} value={floorForm.why} onChange={(e) => setFloorForm((f) => ({ ...f, why: e.target.value }))} />
              </label>
              <Button size="sm" disabled={floorForm.pct === "" || !floorForm.why.trim()}
                onClick={() => void save(() => setMarginFloor(Number(floorForm.pct), floorForm.why), DT.saved).then((ok) => ok && setFloorForm({ pct: "", why: "" }))}>
                {pick(DT.setFloor, lang)}
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

// ---- Extras catalog --------------------------------------------------------------

const CT = {
  title: { en: "Extras catalog", ar: "كتالوج البنود الإضافية" },
  sub: { en: "Civil works, acoustic, lifting, painting and printing per m². Suggestions come from install type, mount height, or a cinema project.", ar: "أعمال مدنية وعزل صوتي ورفع ودهان وطباعة بالمتر. الاقتراحات من نوع التركيب أو ارتفاعه أو كون المشروع سينمائياً." },
  nameEn: { en: "Name (English)", ar: "الاسم (إنجليزي)" },
  nameAr: { en: "Name (Arabic)", ar: "الاسم (عربي)" },
  unit: { en: "Unit", ar: "الوحدة" },
  rate: { en: "Default rate", ar: "السعر الافتراضي" },
  suggests: { en: "Suggested for", ar: "يُقترح لـ" },
  minHeight: { en: "From mount height (m)", ar: "من ارتفاع تركيب (م)" },
  cinema: { en: "Cinema projects", ar: "المشاريع السينمائية" },
  active: { en: "Active", ar: "مفعّل" },
  since: { en: "Rate since", ar: "السعر منذ" },
  lump: { en: "Lump sum", ar: "مقطوع" },
  item: { en: "Per item", ar: "للقطعة" },
  m2: { en: "Per m²", ar: "للمتر المربع" },
  edit: { en: "Edit", ar: "تعديل" },
  add: { en: "Add an item", ar: "أضف بنداً" },
  save: { en: "Save item", ar: "احفظ البند" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  saved: { en: "Item saved", ar: "حُفظ البند" },
  yes: { en: "Yes", ar: "نعم" },
} satisfies Record<string, Bi>;

const EMPTY_ITEM = (): CatalogInput => ({
  code: "", name_en: "", name_ar: "", unit: "lump", default_rate: 0, suggest_for: [], suggest_min_height_m: null,
  suggest_if_cinema: false, active: true,
});
/** A stable code from the English name: lower case, words joined by _, 2–40 characters (the table's CHECK). */
const codeFrom = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function CatalogCard({ canEdit }: { canEdit: boolean }) {
  const { lang } = useI18n();
  const save = useSaver();
  const catalog = useQuery({ queryKey: ["pricing-catalog"], queryFn: listCatalog });
  const [editing, setEditing] = useState<{ id: string | null; item: CatalogInput } | null>(null);
  const unitLabel = (u: CatalogRow["unit"]) => pick(CT[u], lang);

  function form(e: { id: string | null; item: CatalogInput }) {
    const it = e.item;
    const set = (patch: Partial<CatalogInput>) => setEditing({ id: e.id, item: { ...it, ...patch } });
    return (
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span>{pick(CT.nameEn, lang)}</span>
            <input className={FIELD} value={it.name_en} onChange={(ev) => set({ name_en: ev.target.value, ...(e.id ? {} : { code: codeFrom(ev.target.value) }) })} />
          </label>
          <label className="space-y-1 text-sm">
            <span>{pick(CT.nameAr, lang)}</span>
            <input className={FIELD} dir="rtl" value={it.name_ar} onChange={(ev) => set({ name_ar: ev.target.value })} />
          </label>
          <label className="space-y-1 text-sm">
            <span>{pick(CT.unit, lang)}</span>
            <select className={FIELD} value={it.unit} onChange={(ev) => set({ unit: ev.target.value as CatalogRow["unit"] })}>
              {(["lump", "item", "m2"] as const).map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>{pick(CT.rate, lang)}</span>
            <input type="number" min={0} step="0.01" className={FIELD} value={String(it.default_rate)} onChange={(ev) => set({ default_rate: Number(ev.target.value || 0) })} />
          </label>
          <fieldset className="space-y-1 text-sm sm:col-span-2">
            <legend>{pick(CT.suggests, lang)}</legend>
            <div className="flex flex-wrap gap-3">
              {INSTALL_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input type="checkbox" checked={it.suggest_for.includes(t)}
                    onChange={(ev) => set({ suggest_for: ev.target.checked ? [...it.suggest_for, t] : it.suggest_for.filter((x) => x !== t) })} />
                  {pick(INSTALL_TYPE_LABEL[t], lang)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="space-y-1 text-sm">
            <span>{pick(CT.minHeight, lang)}</span>
            <input type="number" min={0} step="0.1" className={FIELD} value={it.suggest_min_height_m == null ? "" : String(it.suggest_min_height_m)}
              onChange={(ev) => set({ suggest_min_height_m: ev.target.value === "" ? null : Number(ev.target.value) })} />
          </label>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={it.suggest_if_cinema} onChange={(ev) => set({ suggest_if_cinema: ev.target.checked })} />
              {pick(CT.cinema, lang)}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={it.active} onChange={(ev) => set({ active: ev.target.checked })} />
              {pick(CT.active, lang)}
            </label>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={it.code.length < 2 || !it.name_en.trim() || !it.name_ar.trim()}
            onClick={() => void save(() => saveCatalogItem(e.id, it), CT.saved).then((ok) => ok && setEditing(null))}>
            {pick(CT.save, lang)}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>{pick(CT.cancel, lang)}</Button>
        </div>
      </div>
    );
  }

  return (
    <Panel title={pick(CT.title, lang)} subtitle={pick(CT.sub, lang)}
      action={canEdit && !editing ? <Button size="sm" variant="outline" onClick={() => setEditing({ id: null, item: EMPTY_ITEM() })}>{pick(CT.add, lang)}</Button> : undefined}>
      <div className="space-y-4">
        {editing ? form(editing) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(CT.nameEn, lang)}</TableHead>
              <TableHead>{pick(CT.unit, lang)}</TableHead>
              <TableHead className="text-end">{pick(CT.rate, lang)}</TableHead>
              <TableHead>{pick(CT.suggests, lang)}</TableHead>
              <TableHead>{pick(CT.since, lang)}</TableHead>
              {canEdit ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(catalog.data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  {lang === "ar" ? c.name_ar : c.name_en}
                  {!c.active ? <span className="text-xs text-muted-foreground"> · {pick(CT.active, lang)}: —</span> : null}
                </TableCell>
                <TableCell>{unitLabel(c.unit)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(c.default_rate, lang)}</TableCell>
                <TableCell className="text-sm">
                  {[
                    ...c.suggest_for.map((t) => pick(INSTALL_TYPE_LABEL[t], lang)),
                    ...(c.suggest_min_height_m != null ? [`≥ ${c.suggest_min_height_m} m`] : []),
                    ...(c.suggest_if_cinema ? [pick(CT.cinema, lang)] : []),
                  ].join(" · ") || "—"}
                </TableCell>
                <TableCell className="tabular-nums">{c.effective_from}</TableCell>
                {canEdit ? (
                  <TableCell className="text-end">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({
                      id: c.id,
                      item: {
                        code: c.code, name_en: c.name_en, name_ar: c.name_ar, unit: c.unit, default_rate: c.default_rate,
                        suggest_for: c.suggest_for, suggest_min_height_m: c.suggest_min_height_m,
                        suggest_if_cinema: c.suggest_if_cinema, active: c.active,
                      },
                    })}>
                      {pick(CT.edit, lang)}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 2: Write `src/routes/_authenticated/pricing.settings.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { useI18n } from "@/lib/i18n";
import { NO_RIGHTS } from "@/lib/pricing-access";
import { pick, type Bi } from "@/lib/pricing-text";
import { usePricingRights } from "@/components/phc/pricing/usePricingRights";
import { CatalogCard, DefaultsCard, InstallationRatesCard } from "@/components/phc/pricing/SettingsCards";

export const Route = createFileRoute("/_authenticated/pricing/settings")({
  head: () => ({ meta: [{ title: "Pricing settings — PHC" }, { name: "robots", content: "noindex" }] }),
  component: PricingSettingsPage,
});

const TEXT = {
  eyebrow: { en: "Pricing & Finance", ar: "التسعير والمالية" },
  title: { en: "Pricing settings", ar: "إعدادات التسعير" },
  editDesc: { en: "Rates every price is built from. Changes apply to prices built from now on; a price already proposed keeps its figures.", ar: "الأسعار التي يُبنى منها كل سعر. التغييرات تسري على ما يُبنى من الآن؛ السعر المقترح يحتفظ بأرقامه." },
  viewDesc: { en: "Estimation and finance keep these rates. You can read them.", ar: "يحدّث التقدير والمالية هذه الأسعار. يمكنك الاطلاع عليها." },
  noAccess: { en: "Pricing settings are for estimation, finance and management", ar: "إعدادات التسعير للتقدير والمالية والإدارة" },
} satisfies Record<string, Bi>;

function PricingSettingsPage() {
  const { lang } = useI18n();
  const rights = usePricingRights();
  const r = rights.data ?? NO_RIGHTS;
  if (rights.isLoading) return <SkeletonTable />;
  if (!r.can_read_cost) return <EmptyState icon={SlidersHorizontal} title={pick(TEXT.noAccess, lang)} />;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={pick(TEXT.eyebrow, lang)} title={pick(TEXT.title, lang)} description={pick(r.is_pricer ? TEXT.editDesc : TEXT.viewDesc, lang)} />
      <InstallationRatesCard canEdit={r.is_pricer} />
      <DefaultsCard canEdit={r.is_pricer} canSetFloor={r.is_gm} />
      <CatalogCard canEdit={r.is_pricer} />
    </div>
  );
}
```

- [ ] **Step 3: Regenerate and verify**

Run: `bun run build && bun run verify`
Expected: PASS. The route tree includes `/_authenticated/pricing/settings`.

Manual check on the local stack:
1. As Zayed, set a pylon rate from today, then another from next week. The first should end next week.
2. Change the customs % and see *In force since* move to today.
3. Add a catalog item "Acoustic insulation", m², cinema ticked.
4. As Kalas, set a floor of 12%. Check that the rate and catalog forms are hidden for him (he views only).
5. As Omar (sales manager), check the page is read-only.
6. As a rep, check the page says no access.

- [ ] **Step 4: Commit**

```bash
git add src/components/phc/pricing/SettingsCards.tsx src/routes/_authenticated/pricing.settings.tsx src/routeTree.gen.ts
git commit -m "feat(pricing): pricing settings (rate card, logistics and defaults, margin floor, extras catalog)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs in the same PR, and full verification

**Files:**
- Modify: `docs/USER_GUIDE.md` (section 7: the "Pages that left the sidebar" row for Quotations and a new "Pricing & Finance" page guide; section 8: two role routines; section 10: limitations; footer line)
- Modify: `docs/CHANGELOG.md` (new top entry)
- Modify: `docs/DECISIONS.md` (new top entry)
- Modify: `docs/AI_HANDOFF.md` (new top entry; PR 1's entry stays below it)
- Modify: `tasks/current.md` (new top item)

**Interfaces:**
- Consumes: everything above, as built. Text below marked *(Task 14)* applies only if Task 14 was done, and *(without Task 14)* only if it was skipped. Keep the one that applies, delete the other, and remove the markers.
- Produces: docs that match the code (CLAUDE.md: "any PR that changes a user flow updates the guide in the same PR").

- [ ] **Step 1: `docs/USER_GUIDE.md`**

1. In "Pages that left the sidebar — and still work", replace the Quotations row with:

```markdown
| **Quotations** `/quotations` | Back in the sidebar since 2026-11-04, under **Pricing & Finance — التسعير والمالية**. All three tabs (Quotations, RFQ & JIH, BOQ) work as before. |
```

2. Insert this section right before `### Reports & Analysis — التقارير والتحليل`:

```markdown
### Pricing & Finance — التسعير والمالية *(2026-11-04)*

Estimation, finance, the sales manager, the GM, MD and CEO see this group. Reps and the BD manager never see cost; they will see where a price is on the deal in the next release.

| Page | What it is for |
|---|---|
| **Pricing queue** `/pricing` | Every open pricing file: its state, who owes the next step, days waiting and the deal's value. Zayed opens on *Estimation & finance*, Kalas on *Set selling price (GM)*. A pricer can open a file by hand for a deal whose RFQ came in before pricing files existed. |
| **Pricing file** `/pricing/<id>` | One file per deal. Four tabs follow the work: Package, Supplier, Cost review, Selling price. The history at the bottom lists every move. |
| **Quotations** `/quotations` | Unchanged. |
| **Pricing settings** `/pricing/settings` | Installation rate card (by type, with a start date), logistics rates, the installation fallback % and the default margin, the margin floor (the GM sets it), and the extras catalog. Estimation and finance edit. Everyone else here reads. |

**The pricing file, tab by tab**

1. **Package (Zayed).**
   - Press *Start package review*, then tick the checklist: BOQ against the drawings, against the location plan, files complete.
   - The deal's files are on the same tab. Enter the BOQ in one of three ways:
     - **Import from Excel:** choose the sheet, check which column is which, and see the rows with problems before anything is saved.
     - **Add lines by hand.**
     - **Use a revision already on the deal.**
   - If something is missing, **Ask sales for missing items** with a due date; the rep sees the list. Until reps can answer from their own screen, record their answer with *Record the rep's answer*.
   - **Freeze the BOQ** when it is complete. Freezing is one-way: a later quantity change opens a new revision.
   - Freezing also suggests extras: a pylon or floor sign suggests a concrete base, a high ceiling a scaffold, a cinema project acoustic insulation.
2. **Supplier (Zayed).**
   - The supplier portal is not ready yet. Send the frozen BOQ and the files to the supplier as you do today, then *Mark as sent to the supplier*.
   - *(Task 14)* When the supplier answers, enter their prices on their behalf: normal and with-screen price, and any difference from the spec, per line.
   - When the prices are in, press *The supplier has priced*. The file goes to Kalas.
3. **Cost review (Zayed and Kalas).**
   - Each line shows the supplier's price, the with-screen price, and flags for no price, a missing screen price or a spec difference.
   - Zayed chooses the normal or the with-screen price, and can correct a line's install type.
   - Zayed can **send lines back to the supplier**. The note is a cost note; sales do not see it.
   - Kalas presses **Start the selling price**.
4. **Selling price (Kalas sets it; Zayed sets the cost choices).**
   - Logistics inputs: containers, inland delivery, clearing agent, overhead %, cinema project.
   - Extras: accept each suggestion (with its quantity and rate) or dismiss it with a reason, and add any catalog item by hand.
   - The grid gives each line's cost: materials, installation, and its share of the extras and logistics by value. Kalas sets a margin % or types a selling price per line.
   - The totals show cost, selling price, margin and the floor.
   - **Build price** writes the internal price. **Propose price** sends it to Zayed's review.
   - Propose needs every suggested extra decided, and a justification when the margin is below the floor.

**Rules the system enforces:**
- Margin is on price: 20% means 20% of what the client pays.
- Totals and margin are computed by the system; nobody types a margin.
- Only Kalas (or his delegate) sets margins and selling prices.
- Zayed cannot approve a price whose figures he set.
- The cost behind a price under review cannot change.
- One supplier per file in this release.
```

3. In section 8, under `### Estimation Manager / Finance Manager`, add:

```markdown
- **Pricing (2026-11-04):** `/pricing` on *Estimation & finance*: package review and BOQ entry, missing items, freeze, sending to the supplier, cost review (normal or with-screen price), logistics and extras. Settings at `/pricing/settings`.
```

and under `### General Manager / Managing Director`, add:

```markdown
5. **Pricing (GM):** `/pricing` on *Set selling price (GM)*: start the selling price, set margins or selling prices per line, decide extras, **Build price** and **Propose price**. You set the margin floor in `/pricing/settings`.
```

4. In section 10, replace the whole `### Pricing loop foundation (2026-11-03)` subsection with:

```markdown
### Pricing loop screens (2026-11-04)

- Zayed's review of a proposed price (approve, return, return lines to the supplier) and the quotation from the approved price come in the next release. Until then a proposed price waits in *Price review*.
- Reps do not see the pricing state on the deal yet, and cannot answer missing items from their own screen: Zayed records their answer.
- No notifications are sent yet for any pricing step.
- The supplier portal is not ready.
  - *(Task 14)* Zayed enters the supplier's prices on their behalf. The supplier's original file is not attached in the system yet.
  - *(without Task 14)* Supplier prices cannot be entered yet, so a price cannot be built.
- One supplier per file. A line priced by two suppliers stops the build.
- A client revision after a quotation (new quantities) comes in the next release.
```

5. Add a footer line after the last one:

```markdown
<!-- last reviewed 2026-11-04 · pricing loop screens: Pricing & Finance group, /pricing queue, pricing file (package, supplier, cost review, selling price), /pricing/settings · branch feat/pricing-loop-screens, not deployed · previous: pricing loop foundation, 2026-11-03 -->
```

- [ ] **Step 2: `docs/CHANGELOG.md`**. Add at the top, under the title:

```markdown
## 2026-11-04 — Pricing loop screens (Commercial & Finance part 1, PR 2; not deployed)

- Migrations `20261104100000`–`20261104150000`:
  - `pricing_my_rights`; `pricing_queue` view.
  - `pricing_file_attach_revision`, and `_pricing_file_link_price` with the PR 2 contract checks (revision ∈ deal, estimation ∈ revision, price ∈ estimation, price ≤ `internal_price_proposed`).
  - `open_pricing_file` checks the RFQ is the deal's. An RFQ moved to another deal re-points the old file.
  - The estimation behind an in-file price under review or approved is frozen.
  - `pricing_boq_import` (JSON lines with structured attributes, into a draft revision), `pricing_boq_line_delete`, `pricing_file_freeze_boq` (7A freeze + move + suggestions).
  - `logistics_rates` gains `install_fallback_pct` (10) and `default_margin_pct` (25) and an in-force date. The catalog gains `suggest_if_cinema` and an in-force date.
  - `pricing_set_installation_rate`, `pricing_set_margin_floor` (GM), `pricing_file_inputs` + `pricing_file_set_inputs`.
  - Extras belong to a BOQ revision (round). Suggest and the propose check lock the file. Cinema suggestion. `pricing_add_extra`.
  - `pricing_file_lines` + `pricing_file_set_line` (cost choices: pricer or GM; margin and typed price: GM).
  - Cost-gated views `pricing_selling_grid` and `pricing_selling_totals` (margin on price; total cost = Phase 8 `estimation_cost_basis` on the built estimation).
  - `pricing_file_build_price` and `pricing_file_propose` (GM; the existing in-file propose path, floor guard unchanged).
- `supabase/tests/pricing_calc.test.sql`: one assertion now expects a new round to suggest again (PR 1 deferred item).
- UI:
  - Sidebar group "التسعير والمالية / Pricing & Finance": `/pricing`, `/quotations` (back in the sidebar), `/pricing/settings`.
  - `/pricing/$id` with Package (Excel import with column mapping via SheetJS 0.20.3, loaded on demand), Supplier, Cost review and Selling price tabs.
- `src/lib`: `pricing-text`, `pricing-access`, `pricing-grid` (mirror + contract test), `boq-import`; `pricing-actions` extended.
- *(Task 14)* Migration `20261104160000`: 7B guards admit on-behalf supplier entry while the file is at the supplier; `pricing_enter_supplier_quote`; Supplier tab entry form.
```

- [ ] **Step 3: `docs/DECISIONS.md`**. Add at the top, under the header block:

```markdown
## 2026-11-04 — شاشات حلقة التسعير (PR 2)
- **سعر البيع يبنيه كلاص ويقترحه؛ اختيارات التكلفة لزايد أو كلاص.** الهامش لكل بند وسعر البيع اليدوي والهامش الافتراضي للملف للمدير العام وحده. سعر الشاشة أو العادي ونوع التركيب والشحن والمصاريف العامة والبنود الإضافية للمسعّر أو المدير العام. البناء والاقتراح للمدير العام فقط، فيكون `figure_set_by` كلاص ويستطيع زايد الاعتماد.
- **الهامش من سعر البيع** (قاعدة المرحلة 8): سعر البند = التكلفة ÷ (1 − الهامش/100). التكلفة = المواد + التركيب + حصة البنود الإضافية والشحن موزعة حسب القيمة (المواد + التركيب)، ثم المصاريف العامة. التكلفة الإجمالية تُحسب بالتعبير نفسه الذي تحسب به `estimation_cost_basis` على التقدير الذي يكتبه البناء (`cost_total` = مواد + إضافات + شحن، `installation_cost`، هدر 0)، فالهامش المعروض هو هامش السعر.
- **الاقتراح يعيد البناء ويرفض إجمالياً تغيّر** منذ رآه كلاص، ثم يمر بمسار الاقتراح القائم (الحارس وحد الهامش وتبعية الملف بلا تغيير).
- **اختيار المورد (`is_selected`) لا يُستخدم في ملفات التسعير.** لو وُجد لتجاهل `estimation_cost_basis` الجدول، فيُرفض البناء. مورد واحد لكل ملف في هذا الإصدار.
- **البنود الإضافية تتبع إصدار الكميات (الجولة).** قرار جولة سابقة لا يمنع اقتراح جولة جديدة. الاقتراح وفحص الاقتراح يقفلان صف الملف.
- **القيمتان الافتراضيتان (نسبة التركيب الاحتياطية 10% والهامش الافتراضي 25%) في `logistics_rates`**، بجانب أسعار الشحن، بتاريخ «سارٍ منذ». السجل في `audit_log`. القيمتان من الخطة وتنتظران تأكيد زايد وكلاص.
- **التوصيل الداخلي وأجرة المخلّص مرة لكل ملف**، والحاويات عدد × سعر الحاوية.
- **طلب تسعير نُقل لفرصة أخرى:** يُعاد ربط ملف الفرصة القديمة بآخر طلب حي لها أو يُفرَّغ الربط، ولا يُغلق تلقائياً.
- **طلب التسعير المؤقت من تعديل التصنيف يبقى يفتح ملفاً**، ويغلقه المسعّر بسبب إن لم يلزم.
- *(Task 14)* **الإدخال نيابة عن المورد انتقل من PR 3 إلى PR 2** بموافقة Mo، مع تعديل حارسي 7B ليقبلا أسعار المورد على كميات مجمّدة ما دام الملف عند المورد ومن خلال الدالة فقط.
- **السبب:** المواصفة 2026-11-03 (§3 و§4) وتعديل Mo (كلاص يضع السعر وزايد يراجعه)، والبنود المؤجلة في `docs/AI_HANDOFF.md` (PR 1). الخطة: `docs/superpowers/plans/2026-11-03-pricing-loop-screens.md`.
```

- [ ] **Step 4: `docs/AI_HANDOFF.md`**. Add a new top entry above PR 1's:

```markdown
## 2026-11-04 — Pricing loop screens (branch `feat/pricing-loop-screens`, worktree `~/dev/phc-pricing-ui`, stacked on PR #365)

Plan `docs/superpowers/plans/2026-11-03-pricing-loop-screens.md`. PR 2 of 5: Zayed's and Kalas's screens up to Propose, plus settings.
- Migrations `20261104100000`–`20261104150000` (and `20261104160000` if Task 14 was kept).
- UI: `/pricing`, `/pricing/$id`, `/pricing/settings`, and the sidebar group "Pricing & Finance" with `/quotations` back in the sidebar.
- No Edge Function change.

**Release (Mo runs; nothing here was pushed or deployed):**
1. Merge PR #365, then this PR, once CI is green.
2. `supabase db push` from `~/dev/phc-command-center` on `main`. It applies PR 1's six migrations and PR 2's.
3. Cloudflare canary.
4. Production Readiness.
5. Production.

No secrets. Settings to confirm with Zayed and Kalas after release: the fallback % (10), the default margin (25), the logistics values seeded in PR 1, the first installation rates, the extras catalog, and the margin floor (none set: no justification is asked for until Kalas sets one).

**Local checks:** `bun run verify`, `bun audit --audit-level=high`, and the pgTAP suite. Write the file and test totals that Step 6's DB run printed into this line before committing.

**PR 1 deferred items, closed here:**
- suggest/propose race (file lock in both);
- rounds (extras per `boq_revision_id`);
- fallback % store;
- `open_pricing_file` RFQ check;
- cost basis frozen under review (in-file prices only, `gm_pending` and `gm_approved`);
- RFQ moved to another deal (re-point, never auto-close);
- Zayed as the only finance manager (selling inputs are the GM's, and the selling screen says who reviews);
- placeholder RFQ (kept, a pricer closes it);
- no backfill (`/pricing` "Open a pricing file for a deal").

**Contract for PR 3 (supplier portal):**
- *(without Task 14)* Phase 7B refuses any supplier quote or line on a frozen revision, and the pricing loop freezes before the supplier prices. PR 3 must change `supplier_quote_guard` / `supplier_quote_line_guard` (Task 14 of this plan has the exact change) before the portal can save a price.
- Never set `supplier_quote_lines.is_selected` in pricing files: `pricing_file_build_price` refuses a revision with a selected line.
- The grid takes the latest current, non-cancelled quote per line and refuses a line with two (`multi_quote_lines`).
- Returned lines reopen (spec §2) and are not built yet. `supplier_invitations`, the `supplier` role, `profiles.vendor_id`, and attaching the supplier's original file are PR 3.

**Contract for PR 4 (review, quotation, sales status, client rounds):**
- Zayed approves with the existing in-file move (`internal_prices.status gm_pending → gm_approved`). PR 1's guard already checks finance, the GM's proposal, never his own and never his figure.
- The approved per-line figures are `pricing_file_lines.built_selling_price` / `built_cost` from the last build. The quotation subtotal must equal `internal_prices.proposed_price`, which equals Σ `built_selling_price`.
- Returning *selected* lines from `price_review`: PR 1's `pricing_file_move(…, 'at_supplier', note)` returns the price. Choosing the lines and reopening only them is PR 4.
- Client round (`quoted → boq_frozen`):
  - `pricing_boq_import`, `pricing_boq_line_delete`, `pricing_file_attach_revision` and `pricing_file_freeze_boq` accept `package_review` only. PR 4 adds the quoted-round entry: a new draft revision while `quoted`, frozen through `pricing_file_move(…, 'boq_frozen')`, whose check needs a revision frozen after the last quote.
  - Extras then start a new round by themselves.
- The opportunity page's pricing state for sales: reps cannot read `pricing_queue` (cost readers only). Read `pricing_files` (readable with the deal, no cost) and `pricing_file_events` with listed columns.

**Follow-ups found while planning (not done):**
- PR 1's pricing tables (`pricing_files`, `pricing_file_events`, `installation_rates`, `pricing_extras_catalog`, `logistics_rates`, `pricing_file_extras`) lack the restrictive `audit_session_boundary` policy that later tables carry. PR 2's new tables have it.
- `estimations_frozen_under_review` does not lock the price row, so an estimation edit at the exact moment of a propose is not serialized. The propose recomputes from what is stored.
```

- [ ] **Step 5: `tasks/current.md`**. Add at the top, under the title:

```markdown
## بند فعّال — حلقة التسعير، PR 2 (الشاشات حتى الاقتراح، 2026-11-04)

الفرع `feat/pricing-loop-screens` (worktree `~/dev/phc-pricing-ui`) فوق PR 1 (#365). قائمة التسعير وملف التسعير (الباكيج، المورد، مراجعة التكلفة، سعر البيع) وإعدادات التسعير، ومجموعة «التسعير والمالية» في الشريط الجانبي مع عودة عروض الأسعار إليه. المتبقي: مراجعة نهائية، فتح الـPR، CI، دمج #365 ثم هذا، ثم `db push` بموافقة، ثم كناري وإنتاج بيد Mo. بعد الإصدار: تأكيد القيم الافتراضية مع زايد وكلاص. التالي: PR 3 (بوابة المورد) وPR 4 (مراجعة زايد وعرض السعر). التفاصيل في أعلى `docs/AI_HANDOFF.md`.
```

- [ ] **Step 6: Full verification**

Run, in order:
1. `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`. Expected: every file ok. Write the file and test counts into the AI_HANDOFF entry.
2. `bun run verify`. Expected: typecheck, lint (0 errors), tests and build all green.
3. `bun audit --audit-level=high`. Expected: no high finding. The SheetJS tarball is 0.20.3.
4. `grep -rn "select(\"\\*\"\|select('\\*')" src/lib/pricing-actions.ts src/components/phc/pricing src/routes/_authenticated/pricing.*`. Expected: no output.
5. Browser walk-through on a local stack (`bun run dev` against local Supabase with all migrations, seeded users per role), in both languages:
   1. A rep: no Pricing group links except Quotations; `/pricing` says no access.
   2. Zayed: walk one file from received through freeze and *The supplier has priced*. *(Task 14)* Enter prices on behalf.
   3. Kalas: start the selling price, set margins, decide extras, Build, Propose.
   4. Omar: `/pricing` and settings read-only.

   If no local stack is available, say so in the report and list what was checked instead.

- [ ] **Step 7: Commit**

```bash
git add docs/USER_GUIDE.md docs/CHANGELOG.md docs/DECISIONS.md docs/AI_HANDOFF.md tasks/current.md
git commit -m "docs: pricing loop screens (user guide, changelog, decisions, handoff, current task)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14 (optional; Open question 1): Enter the supplier's prices on their behalf

Do this task only if Mo agrees to move "entry on behalf" from PR 3 to PR 2 (default: yes). If he says no, skip it and delete the *(Task 14)* sentences from Task 13's docs.

**Why it needs SQL:**
- Phase 7B's `supplier_quote_guard` and `supplier_quote_line_guard` refuse any supplier quote or line on a frozen BOQ revision. Their rule is that "a frozen BOQ revision freezes everything priced against it".
- The pricing loop freezes the BOQ *before* the supplier prices (spec §1). So no supplier price can enter the system today, by any path.
- The change admits writes on a frozen revision only when both hold: a transaction-local flag that only `pricing_enter_supplier_quote` sets, and the revision's pricing file is `at_supplier`.
- The flag follows the same pattern 7B already uses for its own freeze propagation (`phc.freezing_boq_revision`).

**Files:**
- Create: `supabase/migrations/20261104160000_pricing_supplier_entry.sql`
- Test: `supabase/tests/pricing_supplier_entry.test.sql`
- Modify: `src/lib/pricing-actions.ts` (append `listVendors`, `enterSupplierQuote`)
- Create: `src/components/phc/pricing/SupplierEntryForm.tsx`
- Modify: `src/components/phc/pricing/SupplierTab.tsx` (render the form at the `{/* Task 14: SupplierEntryForm */}` slot)

**Interfaces:**
- Consumes:
  - Phase 7B `supplier_quote_guard()` and `supplier_quote_line_guard()` (redefined here, everything else kept verbatim).
  - Task 2 `public._pricing_num_ok(text)`.
  - Task 7 `listBoqLines`, `listSupplierCosts`.
  - Task 10 `SupplierTab`.
- Produces:
  - `public._pricing_supplier_entry_open(_revision_id uuid) → boolean` (internal).
  - `public.pricing_enter_supplier_quote(_file_id uuid, _vendor_id uuid, _lines jsonb, _terms jsonb DEFAULT '{}') → jsonb` `{"supplier_quote_id": uuid, "lines": int}`.
    - `_lines` is a JSON array of `{boq_line_id, unit_cost, unit_cost_with_screen, alternate_spec}`. `_terms` keys are `lead_time_days`, `payment_terms`, `valid_until`.
    - Pricer only, while the file is `at_supplier`. One supplier per file. It never sets `is_selected`.
  - TS: `listVendors(): Promise<{ id: string; name: string }[]>`; `type SupplierPriceInput = { boq_line_id: string; unit_cost: number | null; unit_cost_with_screen: number | null; alternate_spec: string | null }`; `enterSupplierQuote(fileId, vendorId, lines: SupplierPriceInput[], terms: { lead_time_days?: number | null; payment_terms?: string | null; valid_until?: string | null })`; `SupplierEntryForm(props: PricingTabProps)`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_supplier_entry.test.sql`:

```sql
-- PR 2 (optional Task 14): Zayed enters the supplier's prices on their behalf
-- on a frozen BOQ while the file is at the supplier; nothing else can.
-- Test user UUIDs use the 7a… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('7a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','se-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,2) n;
update public.profiles set status = 'active' where id::text like '7a000000-%';
insert into public.user_roles (user_id, role) values
  ('7a000000-0000-0000-0000-000000000001','salesperson'),
  ('7a000000-0000-0000-0000-000000000002','estimation_manager'),
  ('7a000000-0000-0000-0000-000000000002','finance_manager');
insert into public.vendors (id, name) values
  ('7a100001-0000-0000-0000-000000000001','se-vendor-1'),
  ('7a100002-0000-0000-0000-000000000001','se-vendor-2');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('7a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'se-deal-' || n,
       '7a000000-0000-0000-0000-000000000001','7a000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('7a40000' || n || '-0000-0000-0000-000000000001')::uuid, ('7a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'se-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('7a50000' || n || '-0000-0000-0000-000000000001')::uuid, ('7a40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity) values
  ('7a510001-0000-0000-0000-000000000001','7a500001-0000-0000-0000-000000000001',1,'Pylon P1',2),
  ('7a510002-0000-0000-0000-000000000001','7a500001-0000-0000-0000-000000000001',2,'Ceiling C1',4),
  ('7a510003-0000-0000-0000-000000000001','7a500002-0000-0000-0000-000000000001',1,'Wall W1',1);
update public.boq_revisions set frozen_at = now(), frozen_by = '7a000000-0000-0000-0000-000000000002', status = 'verified'
 where id::text like '7a50000%';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('7a600001-0000-0000-0000-000000000001','7a200001-0000-0000-0000-000000000001','at_supplier','7a500001-0000-0000-0000-000000000001'),
  ('7a600002-0000-0000-0000-000000000001','7a200002-0000-0000-0000-000000000001','boq_frozen','7a500002-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":5000}]')$$, '42501', null, 'A rep cannot enter supplier prices');
select set_config('request.jwt.claims','{"sub":"7a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"not-a-line","unit_cost":5000}]')$$, '23514', null, 'A malformed line is refused');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600002-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510003-0000-0000-0000-000000000001","unit_cost":700}]')$$, 'P0001', null, 'Prices are entered while the file is at the supplier');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510003-0000-0000-0000-000000000001","unit_cost":700}]')$$, '23514', null, 'A line of another BOQ is refused');
select is((public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":5000},
    {"boq_line_id":"7a510002-0000-0000-0000-000000000001","unit_cost":1000,"unit_cost_with_screen":1500,"alternate_spec":"Acrylic instead of glass"}]',
  '{"lead_time_days":30,"payment_terms":"30% advance","valid_until":"2026-12-31"}'))->>'lines', '2',
  'Zayed enters the supplier''s prices on a frozen BOQ');
select is((select line_cost from public.supplier_quote_costs where boq_line_id = '7a510001-0000-0000-0000-000000000001'), 10000.00::numeric,
  'The line cost is unit x the BOQ quantity');
select is((select unit_cost_with_screen::text || '/' || alternate_spec from public.supplier_quote_costs where boq_line_id = '7a510002-0000-0000-0000-000000000001'),
  '1500.00/Acrylic instead of glass', 'The screen price and the spec difference are kept');
select is((select q.created_by::text || '/' || q.notes || '/' || q.lead_time_days from public.supplier_quotes q where q.boq_revision_id = '7a500001-0000-0000-0000-000000000001'),
  '7a000000-0000-0000-0000-000000000002/Entered on behalf of the supplier/30', 'The quote says who entered it, on whose behalf');
select lives_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":6000}]')$$, 'Entering again corrects a price');
select is((select count(*)::int || '/' || (max(unit_cost) filter (where boq_line_id = '7a510001-0000-0000-0000-000000000001'))::text
             from public.supplier_quote_costs where boq_revision_id = '7a500001-0000-0000-0000-000000000001'),
  '2/6000.00', 'Still one line per BOQ line, with the new price');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100002-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":4000}]')$$, 'P0001', null, 'One supplier per file in this release');
select throws_ok($$insert into public.supplier_quotes (boq_revision_id, vendor_id, currency) values ('7a500001-0000-0000-0000-000000000001','7a100002-0000-0000-0000-000000000001','SAR')$$,
  '42501', null, 'A direct insert on the frozen BOQ is still refused');
select set_config('phc.pricing_supplier_entry', 'on', true);
select throws_ok($$insert into public.supplier_quotes (boq_revision_id, vendor_id, currency) values ('7a500002-0000-0000-0000-000000000001','7a100002-0000-0000-0000-000000000001','SAR')$$,
  '42501', null, 'The flag alone opens nothing: the file must be at the supplier');
select set_config('phc.pricing_supplier_entry', 'off', true);
select set_config('request.jwt.claims','{"sub":"7a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_quote_costs), 0, 'A rep reads no supplier cost');
reset role;
select * from finish();
rollback;
```

Count check: 4 refusals + 4 (enter, line cost, screen/spec, who) + 2 (correct, still one) + 3 refusals + 1 isolation = 14.

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-ui.sh`
Expected: `pricing_supplier_entry.test.sql` FAILS with `function public.pricing_enter_supplier_quote(...) does not exist`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20261104160000_pricing_supplier_entry.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 2 (moved from PR 3 with Mo's agreement): Zayed enters the
-- supplier's prices on their behalf.
--
-- Phase 7B froze supplier quotes with their BOQ revision: "a frozen BOQ
-- revision freezes everything priced against it". The pricing loop freezes the
-- quantities BEFORE the supplier prices them (spec §1: boq_frozen →
-- at_supplier → supplier_priced), so no supplier price could ever be saved.
-- The two guards below are 7B's, verbatim, plus one exception: a write on a
-- frozen revision is admitted when pricing_enter_supplier_quote has set the
-- transaction-local flag AND the revision's pricing file is at the supplier.
-- The flag alone opens nothing (same pattern as 7B's phc.freezing_boq_revision).
-- The quantities stay frozen: boq_lines is untouched.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._pricing_supplier_entry_open(_revision_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(current_setting('phc.pricing_supplier_entry', true), '') = 'on'
     AND EXISTS (SELECT 1 FROM public.pricing_files f
                  WHERE f.boq_revision_id = _revision_id AND f.state = 'at_supplier');
$$;
REVOKE ALL ON FUNCTION public._pricing_supplier_entry_open(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.supplier_quote_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE _boq_ccy CHAR(3); _rev UUID; _propagating BOOLEAN; _entry BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Supplier quotes cannot be deleted — supersede or cancel instead. | لا تُحذف عروض المورّدين.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  _rev := NEW.boq_revision_id;
  _propagating := coalesce(current_setting('phc.freezing_boq_revision', true), '') = 'on';
  -- 2026-11-04: entry on behalf while the pricing file is at the supplier.
  _entry := public._pricing_supplier_entry_open(_rev);

  IF NOT _propagating AND (
       NEW.frozen_at IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.frozen_at END)
    OR NEW.frozen_by IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.frozen_by END)) THEN
    RAISE EXCEPTION 'frozen_at/frozen_by are set by freezing the BOQ revision, not on the quote. | التجميد يتم على مراجعة الـBOQ.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT _propagating AND NOT _entry AND public.boq_revision_is_frozen(_rev) THEN
    RAISE EXCEPTION 'The BOQ revision is frozen; its supplier quotes cannot change. | مراجعة الـBOQ مجمّدة.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT b.currency INTO _boq_ccy
    FROM public.boq_revisions r JOIN public.boqs b ON b.id = r.boq_id
   WHERE r.id = _rev;
  IF _boq_ccy IS NOT NULL AND NEW.currency <> _boq_ccy THEN
    RAISE EXCEPTION 'Supplier quote currency % does not match the BOQ currency % — conversion is not performed. | عملة عرض المورّد لا تطابق عملة الـBOQ.',
      NEW.currency, _boq_ccy USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.supplier_quote_line_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE _q RECORD; _line_rev UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Supplier quote lines cannot be deleted. | لا تُحذف بنود عرض المورّد.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT q.boq_revision_id, q.is_current, q.status INTO _q
    FROM public.supplier_quotes q WHERE q.id = NEW.supplier_quote_id;

  -- 2026-11-04: entry on behalf while the pricing file is at the supplier.
  IF public.boq_revision_is_frozen(_q.boq_revision_id)
     AND NOT public._pricing_supplier_entry_open(_q.boq_revision_id) THEN
    RAISE EXCEPTION 'The BOQ revision is frozen; its supplier lines cannot change.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT l.revision_id INTO _line_rev FROM public.boq_lines l WHERE l.id = NEW.boq_line_id;
  IF _line_rev IS DISTINCT FROM _q.boq_revision_id THEN
    RAISE EXCEPTION 'This BOQ line belongs to a different revision than the supplier quote. | البند يخص مراجعة أخرى.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_selected AND NOT coalesce(_q.is_current, FALSE) THEN
    RAISE EXCEPTION 'A superseded supplier quote cannot be selected. | لا يُختار عرض مورّد مُستبدَل.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_selected AND (TG_OP = 'INSERT' OR NOT coalesce(OLD.is_selected, FALSE)) THEN
    NEW.selected_by := coalesce(NEW.selected_by, auth.uid());
    NEW.selected_at := coalesce(NEW.selected_at, now());
  END IF;

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.pricing_enter_supplier_quote(_file_id uuid, _vendor_id uuid, _lines jsonb, _terms jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; q public.supplier_quotes;
        ccy text; code text; n integer := 0; e record; bad_ord bigint;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance enter supplier prices. | أسعار المورد يُدخلها التقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0
     OR _terms IS NULL OR jsonb_typeof(_terms) <> 'object'
     OR NOT public._pricing_num_ok(nullif(_terms->>'lead_time_days',''))
     OR coalesce(nullif(_terms->>'valid_until',''), '2000-01-01') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Give at least one line, and terms as lead time (days), payment terms and a valid-until date. | أدخل بنداً واحداً على الأقل، والشروط: مدة التوريد بالأيام وشروط الدفع وتاريخ الصلاحية.' USING ERRCODE = '23514';
  END IF;
  SELECT x.ord INTO bad_ord FROM jsonb_array_elements(_lines) WITH ORDINALITY AS x(v, ord)
   WHERE jsonb_typeof(x.v) <> 'object'
      OR coalesce(x.v->>'boq_line_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR NOT public._pricing_num_ok(nullif(x.v->>'unit_cost',''))
      OR NOT public._pricing_num_ok(nullif(x.v->>'unit_cost_with_screen',''))
      OR (x.v ? 'alternate_spec' AND jsonb_typeof(x.v->'alternate_spec') NOT IN ('string','null'))
   ORDER BY x.ord LIMIT 1;
  IF bad_ord IS NOT NULL THEN
    RAISE EXCEPTION 'Line % is not valid. | السطر % غير صالح.', bad_ord, bad_ord USING ERRCODE = '23514';
  END IF;

  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state <> 'at_supplier' THEN
    RAISE EXCEPTION 'Supplier prices are entered while the file is at the supplier. | تُدخل أسعار المورد والملف عند المورد.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) x(v)
              WHERE NOT EXISTS (SELECT 1 FROM public.boq_lines l
                                 WHERE l.id = (x.v->>'boq_line_id')::uuid AND l.revision_id = f.boq_revision_id)) THEN
    RAISE EXCEPTION 'A line is not in this file''s BOQ. | أحد البنود ليس في كميات هذا الملف.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = _vendor_id) THEN
    RAISE EXCEPTION 'Unknown supplier. | المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_quotes sq
              WHERE sq.boq_revision_id = f.boq_revision_id AND sq.is_current
                AND sq.status NOT IN ('cancelled','superseded') AND sq.vendor_id <> _vendor_id) THEN
    RAISE EXCEPTION 'This file already has another supplier''s prices; one supplier per file in this release. | لهذا الملف أسعار مورد آخر؛ مورد واحد لكل ملف في هذا الإصدار.' USING ERRCODE = 'P0001';
  END IF;

  SELECT b.currency INTO ccy FROM public.boq_revisions r JOIN public.boqs b ON b.id = r.boq_id WHERE r.id = f.boq_revision_id;
  SELECT o.project_code INTO code FROM public.opportunities o WHERE o.id = f.opportunity_id;
  PERFORM set_config('phc.pricing_supplier_entry', 'on', true);

  SELECT * INTO q FROM public.supplier_quotes
   WHERE boq_revision_id = f.boq_revision_id AND vendor_id = _vendor_id AND is_current FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.supplier_quotes (boq_revision_id, vendor_id, rfq_reference, status, response_received_at, currency,
                                        lead_time_days, payment_terms, valid_until, notes, created_by)
    VALUES (f.boq_revision_id, _vendor_id, code, 'responses_received', now(), coalesce(ccy, 'SAR'),
            (nullif(_terms->>'lead_time_days',''))::numeric::integer, nullif(btrim(coalesce(_terms->>'payment_terms','')), ''),
            (nullif(_terms->>'valid_until',''))::date, 'Entered on behalf of the supplier', u)
    RETURNING * INTO q;
  ELSE
    UPDATE public.supplier_quotes
       SET response_received_at = now(),
           lead_time_days = coalesce((nullif(_terms->>'lead_time_days',''))::numeric::integer, lead_time_days),
           payment_terms  = coalesce(nullif(btrim(coalesce(_terms->>'payment_terms','')), ''), payment_terms),
           valid_until    = coalesce((nullif(_terms->>'valid_until',''))::date, valid_until)
     WHERE id = q.id RETURNING * INTO q;
  END IF;

  FOR e IN
    SELECT (x.v->>'boq_line_id')::uuid AS line_id,
           (nullif(x.v->>'unit_cost',''))::numeric AS unit_cost,
           (nullif(x.v->>'unit_cost_with_screen',''))::numeric AS with_screen,
           nullif(btrim(coalesce(x.v->>'alternate_spec','')), '') AS alt
      FROM jsonb_array_elements(_lines) x(v)
  LOOP
    UPDATE public.supplier_quote_lines l
       SET unit_cost = e.unit_cost, unit_cost_with_screen = e.with_screen, alternate_spec = e.alt,
           quantity = bl.quantity, line_cost = round(e.unit_cost * bl.quantity, 2)
      FROM public.boq_lines bl
     WHERE l.supplier_quote_id = q.id AND l.boq_line_id = e.line_id AND bl.id = e.line_id;
    IF NOT FOUND THEN
      INSERT INTO public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, unit_cost_with_screen,
                                               alternate_spec, quantity, line_cost)
      SELECT q.id, bl.id, e.unit_cost, e.with_screen, e.alt, bl.quantity, round(e.unit_cost * bl.quantity, 2)
        FROM public.boq_lines bl WHERE bl.id = e.line_id;
    END IF;
    n := n + 1;
  END LOOP;
  PERFORM set_config('phc.pricing_supplier_entry', 'off', true);

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.supplier_prices_entered', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'supplier_quote_id', q.id, 'vendor_id', _vendor_id, 'lines', n));
  RETURN jsonb_build_object('supplier_quote_id', q.id, 'lines', n);
END $$;
REVOKE ALL ON FUNCTION public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb) TO authenticated;
```

Run the DB suite. Expected: `pricing_supplier_entry.test.sql .. ok`, and every other file still ok. 7B's behaviour tests still pass, because the guards are unchanged outside the flag.

- [ ] **Step 3: Append to `src/lib/pricing-actions.ts`**

```ts
// ---- Entry on behalf of the supplier (Task 14) ---------------------------------

export const listVendors = () => rows<{ id: string; name: string }>(db.from("vendors").select("id, name").order("name"));

export type SupplierPriceInput = {
  boq_line_id: string;
  unit_cost: number | null;
  unit_cost_with_screen: number | null;
  alternate_spec: string | null;
};
export const enterSupplierQuote = (
  fileId: string,
  vendorId: string,
  lines: SupplierPriceInput[],
  terms: { lead_time_days?: number | null; payment_terms?: string | null; valid_until?: string | null },
) =>
  call<{ supplier_quote_id: string; lines: number }>("pricing_enter_supplier_quote", {
    _file_id: fileId,
    _vendor_id: vendorId,
    _lines: lines,
    _terms: terms,
  });
```

- [ ] **Step 4: Create `src/components/phc/pricing/SupplierEntryForm.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n, formatNumber } from "@/lib/i18n";
import { enterSupplierQuote, listBoqLines, listSupplierCosts, listVendors } from "@/lib/pricing-actions";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Enter the supplier's prices on their behalf", ar: "أدخل أسعار المورد نيابة عنه" },
  hint: { en: "From the supplier's Excel or PDF. The quote is recorded as the supplier's, entered by you.", ar: "من ملف المورد (Excel أو PDF). يُسجَّل العرض باسم المورد، وأنت من أدخله." },
  supplier: { en: "Supplier", ar: "المورد" },
  pick: { en: "Choose the supplier", ar: "اختر المورد" },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  unit: { en: "Unit price", ar: "سعر الوحدة" },
  screen: { en: "With screen", ar: "مع الشاشة" },
  differs: { en: "Differs from spec", ar: "يختلف عن المواصفة" },
  lead: { en: "Lead time (days)", ar: "مدة التوريد (أيام)" },
  terms: { en: "Payment terms", ar: "شروط الدفع" },
  valid: { en: "Valid until", ar: "صالح حتى" },
  save: { en: "Save the supplier's prices", ar: "احفظ أسعار المورد" },
  saved: { en: "lines saved", ar: "بنداً حُفظ" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";
type Row = { unit_cost: string; unit_cost_with_screen: string; alternate_spec: string };

export function SupplierEntryForm({ file, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const revisionId = file.boq_revision_id as string;
  const vendors = useQuery({ queryKey: ["pricing-vendors"], queryFn: listVendors });
  const lines = useQuery({ queryKey: ["pricing-lines", revisionId], queryFn: () => listBoqLines(revisionId) });
  const costs = useQuery({ queryKey: ["pricing-supplier-costs", revisionId], queryFn: () => listSupplierCosts(revisionId) });
  const current = costs.data?.[0];
  const [vendorId, setVendorId] = useState("");
  const [rows, setRows] = useState<Record<string, Partial<Row>>>({});
  const [terms, setTerms] = useState({ lead: "", payment: "", valid: "" });
  const [busy, setBusy] = useState(false);
  const chosen = vendorId || current?.vendor_id || "";
  const existing = (lineId: string) => costs.data?.find((c) => c.boq_line_id === lineId);
  const val = (lineId: string, k: keyof Row) => {
    const typed = rows[lineId]?.[k];
    if (typed !== undefined) return typed;
    const c = existing(lineId);
    const v = c ? (k === "alternate_spec" ? c.alternate_spec : c[k]) : null;
    return v == null ? "" : String(v);
  };
  const setVal = (lineId: string, k: keyof Row, v: string) => setRows((m) => ({ ...m, [lineId]: { ...m[lineId], [k]: v } }));
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  async function save() {
    setBusy(true);
    try {
      const payload = (lines.data ?? []).map((l) => ({
        boq_line_id: l.id,
        unit_cost: num(val(l.id, "unit_cost")),
        unit_cost_with_screen: num(val(l.id, "unit_cost_with_screen")),
        alternate_spec: val(l.id, "alternate_spec").trim() || null,
      }));
      const r = await enterSupplierQuote(file.file_id, chosen, payload, {
        lead_time_days: num(terms.lead),
        payment_terms: terms.payment.trim() || null,
        valid_until: terms.valid || null,
      });
      toast.success(`${r.lines} ${pick(TEXT.saved, lang)}`);
      setRows({});
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="font-medium">{pick(TEXT.title, lang)}</p>
      <p className="text-muted-foreground">{pick(TEXT.hint, lang)}</p>
      <label className="block max-w-sm space-y-1">
        <span>{pick(TEXT.supplier, lang)}</span>
        <select className={FIELD} value={chosen} disabled={!!current} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">{pick(TEXT.pick, lang)}</option>
          {(vendors.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{pick(TEXT.sign, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
            <TableHead>{pick(TEXT.unit, lang)}</TableHead>
            <TableHead>{pick(TEXT.screen, lang)}</TableHead>
            <TableHead>{pick(TEXT.differs, lang)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(lines.data ?? []).map((l) => (
            <TableRow key={l.id}>
              <TableCell>{l.sign_type}</TableCell>
              <TableCell className="text-end tabular-nums">{formatNumber(l.quantity, lang)}</TableCell>
              <TableCell>
                <input type="number" min={0} step="0.01" className={FIELD} aria-label={`${pick(TEXT.unit, lang)}: ${l.sign_type}`}
                  value={val(l.id, "unit_cost")} onChange={(e) => setVal(l.id, "unit_cost", e.target.value)} />
              </TableCell>
              <TableCell>
                <input type="number" min={0} step="0.01" className={FIELD} aria-label={`${pick(TEXT.screen, lang)}: ${l.sign_type}`}
                  value={val(l.id, "unit_cost_with_screen")} onChange={(e) => setVal(l.id, "unit_cost_with_screen", e.target.value)} />
              </TableCell>
              <TableCell>
                <input className={FIELD} aria-label={`${pick(TEXT.differs, lang)}: ${l.sign_type}`}
                  value={val(l.id, "alternate_spec")} onChange={(e) => setVal(l.id, "alternate_spec", e.target.value)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span>{pick(TEXT.lead, lang)}</span>
          <input type="number" min={0} className={FIELD} value={terms.lead} onChange={(e) => setTerms((t) => ({ ...t, lead: e.target.value }))} />
        </label>
        <label className="space-y-1">
          <span>{pick(TEXT.terms, lang)}</span>
          <input className={FIELD} value={terms.payment} onChange={(e) => setTerms((t) => ({ ...t, payment: e.target.value }))} />
        </label>
        <label className="space-y-1">
          <span>{pick(TEXT.valid, lang)}</span>
          <input type="date" className={FIELD} value={terms.valid} onChange={(e) => setTerms((t) => ({ ...t, valid: e.target.value }))} />
        </label>
      </div>
      <Button disabled={busy || !chosen} onClick={() => void save()}>{pick(TEXT.save, lang)}</Button>
    </div>
  );
}
```

- [ ] **Step 5: Render it in `SupplierTab.tsx`**

Add `import { SupplierEntryForm } from "@/components/phc/pricing/SupplierEntryForm";`. Replace the slot comment line `{/* Task 14: SupplierEntryForm */}` with:

```tsx
            {rights.is_pricer && rights.can_read_cost && file.boq_revision_id ? (
              <SupplierEntryForm file={file} rights={rights} onChanged={onChanged} />
            ) : null}
```

Also replace the `howToday` string's second sentence in `TEXT`. The supplier still receives the files outside the system, so keep the first sentence, and change it to:

```ts
  howToday: { en: "The supplier portal is not ready yet. Send the frozen BOQ and the files to the supplier as you do today, mark it sent here, then enter the supplier's prices on their behalf when they answer. The supplier sees the project code only.", ar: "بوابة المورد ليست جاهزة بعد. أرسل الكميات المجمّدة والملفات للمورد كما تفعل اليوم، وسجّل الإرسال هنا، ثم أدخل أسعار المورد نيابة عنه حين يرد. يرى المورد رمز المشروع فقط." },
```

- [ ] **Step 6: Verify and commit**

Run: `bun run verify` and the DB suite. Expected: PASS. The `pricing-actions.contract.test.ts` now also covers `pricing_enter_supplier_quote`.

Manual check:
1. As Zayed, on a file at the supplier, choose the supplier and type prices for every line.
2. Save, then *The supplier has priced*.
3. Check the Cost review shows the prices.

```bash
git add supabase/migrations/20261104160000_pricing_supplier_entry.sql supabase/tests/pricing_supplier_entry.test.sql src/lib/pricing-actions.ts src/components/phc/pricing/SupplierEntryForm.tsx src/components/phc/pricing/SupplierTab.tsx
git commit -m "feat(pricing): enter the supplier's prices on their behalf while the file is at the supplier" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then re-run Task 13's Step 6 verification with the *(Task 14)* sentences kept. If the docs need a change, make a new commit; do not amend.

---

## Coverage check (self-review against the spec and AI_HANDOFF)

| Requirement | Where |
|---|---|
| Spec §1: path from `received` to Propose, enforced in SQL; who owes the next step; days waiting | PR 1 state machine; Tasks 1, 2, 6 (RPCs call `pricing_file_move` and the existing price path); Task 7 `nextOwner`; Task 8 queue and header |
| Spec §2: cost hidden from reps and the BD manager, readable by the sales manager | Tasks 1 (`pricing_queue`), 3 (`pricing_file_inputs`), 5 (`pricing_file_lines`, both views): pgTAP isolation; Task 7 tab and nav gating |
| Spec §3: per-line materials (normal / with screen), installation by type or % fallback, margin % or typed price | Task 5 (grid, `pricing_file_set_line`), Task 10 (Cost review), Task 11 (Selling grid) |
| Spec §3: extras catalog, per-m² items, auto-suggest including cinema, decide before Propose | Tasks 3 (catalog cinema), 4 (rounds, lock, cinema, add), 11 (Extras panel); PR 1 guard |
| Spec §3: logistics estimate allocated by value; overhead; footer; below-floor justification; SQL computes totals | Tasks 3 (inputs, rates), 5 (views), 6 (build/propose), 11 (footer) |
| Spec §4: sidebar group with `/quotations`; queue with filters; file tabs Package, Supplier, Cost review, Selling price; settings with dates | Tasks 8, 9, 10, 11, 12 |
| Scope 1a linking + contract | Task 1 (`pricing_file_attach_revision`, `_pricing_file_link_price`), Task 6 (calls it; inserts only `internal_price_proposed`) |
| Scope 1b BOQ import RPC, client-side mapping, manual entry, freeze path | Task 2, Task 9 |
| Scope 1c, 1d, 1e, 1f, 1g | Tasks 5, 5, 6, 3+4, 1+4 |
| AI_HANDOFF "PR 2 contract" (4 items) | Task 1/6 (link checks, status rule), Task 7 (`listFileEvents` lists columns; contract test bans `*`), Task 8 (close dialog text) |
| AI_HANDOFF "Deferred to PR 2" (9 items) | Race: Task 4. Rounds: Task 4. Fallback store: Task 3. RFQ check: Task 1. Frozen cost basis: Task 1. RFQ moved: Task 1 (Open question 6). Zayed as sole finance: Task 11 notes; selling inputs are the GM's (Tasks 5, 6). Placeholder RFQ: kept (Open question 7). No backfill: Task 8 "Open a pricing file for a deal" |
| Supplier step: send (state move), entry on behalf | Task 10; Task 14 (optional, Open question 1) |
| bun tests: allocation and margin mirrors (contract-tested), Excel mapping, gating helpers | Task 7 (`pricing-grid` + contract, `pricing-access`), Task 9 (`boq-import`) |
| Docs and release note | Task 13 |
