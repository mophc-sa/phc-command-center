# Pricing loop — PR 3: the supplier portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the factory (the supplier) its own MFA-protected portal account, linked to one vendor, through which it sees only the pricing requests sent to it (project code, lines, the exact files), submits its prices, and re-prices only the lines Zayed returns, while every other path in the schema gives a supplier nothing.

**Architecture:** Six migrations (`20261108100000`–`20261108150000`). A supplier fails `has_app_access`, so the restrictive `audit_session_boundary` policy (now on every public table) and every role predicate close the whole schema to it; it reads and writes only through `supplier_portal_*` SECURITY DEFINER functions that start from `_supplier_session_vendor()` (active supplier, linked vendor, `aal2`). A pricer sends a frozen file to one vendor (`supplier_invitations` + lines + the exact file versions); the supplier's submission writes a new Phase 7B `supplier_quotes` revision that PR 2's selling grid picks, moves the file to `supplier_priced` and notifies Kalas and Zayed. `sales-os-api` gains a `supplier-portal` module (account creation with a one-time set-password link, and signed download links for suppliers), and the shared `resolveCaller` refuses supplier accounts in every other function. The portal is a separate route tree `/supplier` outside `/_authenticated`.

**Tech Stack:** Postgres 15 (Supabase), pgTAP, pg_cron, Deno Edge Functions (`sales-os-api`, `_shared`), TypeScript, React 19, TanStack Router/Start, @tanstack/react-query, bun test, deno test.

**Spec:** `docs/superpowers/specs/2026-11-03-pricing-loop-design.md` — §1 (flow: `boq_frozen → at_supplier → supplier_priced`, returns), §2 (supplier role, visibility table, portal, notifications), §5 (`supplier_invitations`, `profiles.vendor_id`, role `supplier`), §6 (PR 3). Meeting record: `docs/finance/2026-11-03-ahmed-zayed-meeting.md` §3 ("صفحة المورد": the supplier prices on the attached files and writes any material change). PR 2 plan: `docs/superpowers/plans/2026-11-03-pricing-loop-screens.md`. Contract and carried items: top two entries of `docs/AI_HANDOFF.md`; `docs/DECISIONS.md` 2026-11-03/04.

**Base:** branch `feat/pricing-supplier-portal` in worktree `/Users/mo/dev/phc-pricing-supplier`, from `main` `0f4025d` (PR 1 #365 and PR 2 #366, both in production). Earlier migrations are frozen: new behaviour goes in new migrations that `CREATE OR REPLACE` what they change.

**How this plan was checked:** every migration and pgTAP file below was run against a local database rebuilt from `main`'s migrations (all six new test files pass, and all 39 existing pgTAP files still pass with the new migrations applied). The TypeScript, React and Deno code was built in a scratch copy of the repository: `tsc --noEmit` clean, `eslint` 0 errors, `bun test` green, `deno check` and the new Deno tests green, `bun run build` green. Copy the code as written.

## Open questions for Mo

Each has a default. The tasks are written with the default, so nothing waits on the answer.

1. **How the supplier gets its links (no automated email exists: Postmark is not approved, the info@ mailbox is deferred, Supabase's built-in mailer only reaches the project's team).** **Default:** the pricer creates the portal account on the Supplier tab and copies two ready-made messages (a one-time set-password link; later, the portal link of each request) into his own email or WhatsApp. If the hosted project gets custom SMTP, a later change can let Supabase send the set-password email.
2. **A non-PHC email address.** `auth.users` accepts only `@phc-sa.com` (`enforce_signup_email_domain`, 2026-08-02). **Default:** an exception only for an account the supplier-account action is creating: a pricer's one-time request row (`supplier_account_invites`, 15 minutes) named in `app_metadata`, which a sign-up cannot set.
3. **Who creates supplier accounts.** **Default:** pricers (Zayed) and the system administrator. The supplier role cannot be combined with any staff role.
4. **A second supplier's quote entered before the freeze (Phase 7B).** **Default:** sending the file names its one supplier; with the pricer's tick, the other suppliers' live quotes on that revision are cancelled for this file (reason recorded) and any 7B selection is cleared, so the build never sees two quotes or a selection.
5. **What the supplier sees per line.** **Default:** sign type, description, dimensions, width and height, material, mounting, illumination, finish, quantity, unit and the screen flag; never `location`, installation data, PHC's cost or selling price. Files are renamed to `<project code>-NN.ext`. The pricer is told to keep client names out of descriptions and of the note.
6. **What a submission requires.** **Default:** lead time, payment terms and valid-until are required; at least one line priced; other lines may stay empty (the PR 5 AI review flags them).
7. **The overdue reminder.** **Default:** once per request and reply-by date, at 08:15 Riyadh (pg_cron), to estimation and finance (Zayed). Changing the reply-by date re-arms it. The Supplier tab also shows "Overdue by N days" on read.
8. **"Kalas and Zayed" on submit.** **Default:** every `general_manager`, `estimation_manager` and `finance_manager` holder.
9. **PR 2's "Mark as sent".** **Default:** the Supplier tab now sends through a request (always, even when the supplier will be priced on its behalf). `pricing_file_move(boq_frozen → at_supplier)` stays callable in SQL, so a file can still be at the supplier with no request; then entry on behalf and "The supplier has priced" work as in PR 2.
10. **Returned lines.** **Default:** the supplier sees which lines reopened and an optional message from PHC; the internal reason stays a cost note (PR 1 rule).

## Global Constraints

- **PR 1 and PR 2 constraints still apply** (`.superpowers/sdd/global-constraints-pr1.md`, `.superpowers/sdd/global-constraints-pr2.md`):
  - Every new table has `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL … FROM anon, authenticated`, explicit grants, and the restrictive `audit_session_boundary` policy (`USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK (same)`).
  - Writes go through RPCs. Workflow tables get no direct INSERT/UPDATE grants.
  - Cost is read only when `public.can_read_commercial_cost(auth.uid())` is true. "Pricer" = `public.is_pricer(uuid)`. "GM" = `public.can_approve_final_price(uuid)`.
  - Error messages are bilingual, `'English. | العربية.'`, with codes `42501` (not allowed), `23514` (bad input) and `P0001` (rule).
  - Every RPC: `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated;`. Internal helpers (`_…`) are revoked from `authenticated` too.
  - Every state change writes `audit_log` (`actor_type 'user'`), with no cost figures in it.
  - `pricing_file_events`, `boq_lines`, `supplier_quote_lines` and `internal_prices` have column grants: always list columns, never `select=*`.
- **The supplier boundary (PR 3):**
  - A supplier fails `has_app_access`. Never write a policy, view or function that admits a supplier through a role predicate; supplier-facing functions start from `public._supplier_session_vendor()` (or `public._supplier_invitation_for_session(uuid)`), which already require `aal2`.
  - A supplier-facing function returns only: its own request, line and file ids, the project code, line specs, its own prices and terms. Never a client, deal or site, PHC's cost or selling price, another vendor, a BOQ, deal or document id.
  - Any new SECURITY DEFINER function granted to `authenticated` must check the caller (the sweep test in Task 5 fails otherwise); any new owner-run view granted to `authenticated` must filter on the caller or be `security_invoker`.
- **Migration numbers:** `20261108100000` … `20261108150000`. Before Task 1 run `git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3`. If any number there is ≥ `20261108100000`, renumber every migration in this plan upward, keeping their order, and change the file names in later tasks' commands.
- **Never edit an existing migration.** Existing test and source files this plan edits, and only these: `src/lib/roles.ts`, `supabase/functions/_shared/roles.ts`, `src/lib/roles.capabilities.test.ts`, `src/lib/i18n.tsx`, `src/integrations/supabase/types.ts` (the `app_role` enum, and `profiles.vendor_id` in Task 1), `src/lib/team-members.ts` (+ new `team-members.test.ts`), `src/lib/info-mail-actions.ts`, `src/lib/opportunity-actions.ts`, `src/routes/_authenticated/targets.tsx`, `supabase/functions/meetings-inbound/index.ts`, `supabase/functions/sales-os-api/handlers/fireflies.ts` and `meetings-sync.ts` (the staff pickers and attendee-matching lists that must exclude vendor-linked profiles), and `src/integrations/supabase/types.ts` beyond the enum (`profiles.vendor_id`), `supabase/functions/_shared/supabase.ts`, `supabase/functions/sales-os-api/router.ts`, `supabase/functions/sales-os-api/index.ts`, `src/lib/sales-os-api-router.test.ts`, `src/lib/sales-os-api-modularization.contract.test.ts`, `src/lib/pricing-actions.ts`, `src/lib/pricing-actions.contract.test.ts`, `src/lib/notification-target.ts`, `src/lib/notification-target.test.ts`, `src/components/phc/pricing/SupplierTab.tsx`, `SupplierEntryForm.tsx`, `CostReviewTab.tsx`, `src/routes/_authenticated/route.tsx`, `src/routes/index.tsx`, `src/routeTree.gen.ts` (generated), and the docs in Task 10.
- **Kalas sets the price; Zayed reviews it** (unchanged). The supplier only supplies cost; nothing here touches the selling build.
- **One supplier per file** (spec decision 7). Never set `supplier_quote_lines.is_selected` in a pricing file. One current quote per vendor per revision (7B unique index); a new submission supersedes, never overwrites.
- **Bilingual UI, RTL-safe:**
  - Each component keeps its strings in a local `const TEXT = { … } satisfies Record<string, Bi>` and shows them with `pick(TEXT.key, lang)` (`src/lib/pricing-text.ts`).
  - Logical CSS only (`ms-`/`me-`/`ps-`/`pe-`/`text-start`/`text-end`).
  - Numbers through `formatNumber` / `formatCurrency` (`@/lib/i18n`).
  - No Arabic-Indic digits in any non-test source file (`src/lib/arabic-digits.test.ts` scans `src`, skipping `*.test.ts(x)`); a test may type them to check that they are read.
- **Database errors** reach the user through `dbMessage(e, lang)`; `ActionDialog` `onSubmit` handlers rethrow `asError(e, lang)` and always pass `recordId`.
- **Query keys:** staff screens use keys starting `pricing-` (the file page's `onChanged` invalidates that prefix); portal screens use keys starting `supplier-portal`.
- **UI gating mirrors SQL; SQL decides.**
- **DB tests:** run `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`. It rebuilds the local DB from this worktree's migrations and runs every pgTAP file; check that your file passes and that the others still do. **Never run `supabase db reset`** (the Supabase guard refuses it). If the script is missing or the stack cannot start, push the branch and rely on CI ("Supabase migrations and database tests"), and say so in the task report.
- **pgTAP sessions:** always set `"aal":"aal2"` in `request.jwt.claims` unless the assertion is about `aal1`. Supplier and MFA roles need it.
  - Test user UUID prefixes: Task 1 `8a…`, Task 2 `8b…`, Task 3 `8c…`, Task 4 `8d…`, Task 5 `8e…` (returns) and `8f…` (sweep).
  - Prefixes already used: `00 20 24 26–29 2a–2e 3d–3f 4a 4b 4d 5a–5f 6a–6f 7a 7c a0 a2 b1 b2 ca ce d1 de f0–f2`.
  - Emails are `<short>-<role>+test@phc-sa.com`.
  - A supplier fixture is linked with triggers off: `set local session_replication_role = replica;` → `update public.profiles set vendor_id = …` → `insert into public.user_roles (…,'supplier')` → `set local session_replication_role = origin;`.
  - What a supplier session cannot read (deal codes, file ids) is captured into a temp table as the owner before switching to it.
- **No component tests** (the repo has none). Logic is tested in `src/lib`; screens by `bun run verify` and the canary walk-through.
- **Frontend checks:** a task that adds a route runs `bun run build` once first (regenerates `src/routeTree.gen.ts`; commit it), then `bun run verify`. Single tests: `bun test <file>`.
- **Deno tests:** `bun run test:deno` (all `_shared/*.deno-test.ts`). Type-check a function: `deno check --frozen --allow-import --config supabase/functions/deno.json supabase/functions/sales-os-api/index.ts`.
- **Public repository** (AGENTS.md): no production amounts, real client or supplier names, or customer document text in code, tests, commits or PR text. The factory is "the supplier" everywhere; never its name.
- **Release:** Mo approves and runs every step (see "Release" at the end). Nothing in this plan pushes, deploys or runs `db push`.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261108100000_supplier_role.sql` | `app_role` gains `supplier` (alone: a new enum value cannot be used in its own transaction) |
| `supabase/migrations/20261108110000_supplier_accounts.sql` | `profiles.vendor_id` + guard (the supplier key); `is_supplier_account`, `_supplier_session_vendor`; `has_app_access`, `is_active_user`, `has_any_role` refuse vendor-linked profiles; supplier role exclusive and undeletable while linked; no task owned by a supplier; a supplier edits only its language; non-PHC email exception (`supplier_account_invites`, deferred check at commit); `supplier_account_prepare` / `_activate` / `_email`, `pricing_supplier_accounts`; two owner-run views made invoker; `current_margin_floor` hides the floor from suppliers and is closed to anon; `estimation_cost_basis` closed to anon and to non-cost-readers; `my_day`, `meeting_review_queue`, `my_fireflies_connection` check `has_app_access`; session boundary on every public table |
| `supabase/migrations/20261108120000_supplier_invitations.sql` | `supplier_invitations`, `_lines`, `_files`; `_pricing_today`; `pricing_send_to_supplier` (incl. the second supplier's earlier quote), `pricing_cancel_invitation`, `pricing_extend_invitation` |
| `supabase/migrations/20261108130000_supplier_portal_read.sql` | `_supplier_invitation_for_session`, `_supplier_invitation_editable`, `_supplier_portal_status`; `supplier_portal_invitations`, `supplier_portal_invitation`, `supplier_portal_file` |
| `supabase/migrations/20261108140000_supplier_portal_submit.sql` | `supplier_quotes.source` / `source_document_id`; `supplier_invitation_submissions`; `supplier_portal_confirmation`; `supplier_portal_submit`; `pricing_enter_supplier_quote` follows the request and keeps the supplier's file |
| `supabase/migrations/20261108150000_supplier_returns_overdue.sql` | `pricing_return_lines_to_supplier`; `pricing_notify_overdue_suppliers` + pg_cron job |
| `supabase/tests/supplier_accounts.test.sql` … `supplier_returns_overdue.test.sql`, `supplier_isolation_sweep.test.sql` | pgTAP per migration, and the sweep |
| `src/lib/roles.ts`, `supabase/functions/_shared/roles.ts`, `src/lib/roles.capabilities.test.ts` | `supplier` role, `isSupplier`, MFA |
| `src/integrations/supabase/types.ts` | `app_role` enum gains `supplier` |
| `supabase/functions/_shared/supplier-portal.ts` (+ `.deno-test.ts`) | Supplier actions allow-list, email and app-URL helpers |
| `supabase/functions/_shared/supabase.ts` | `resolveCaller` refuses suppliers unless the function opts in |
| `supabase/functions/sales-os-api/router.ts`, `index.ts`, `handlers/supplier-portal.ts` | Per-action gate; `supplier_account_create`, `supplier_account_password_link`, `supplier_file_link` |
| `src/lib/supplier-portal.ts` (+ `.test.ts`, `.contract.test.ts`) | Portal types, submission builder, dates, messages, guard decision |
| `src/lib/supplier-portal-actions.ts` | Portal RPC wrappers, file link |
| `src/lib/pricing-actions.ts` (+ contract test) | Pricer-side wrappers for requests, returns, accounts |
| `src/lib/notification-target.ts` (+ test), `src/lib/i18n.tsx` | Pricing notices open the pricing file; labels |
| `src/components/phc/pricing/SendToSupplierPanel.tsx`, `SupplierInvitationPanel.tsx`, `SupplierAccountsPanel.tsx`, `CopyText.tsx`, `ReturnLinesDialog.tsx` | Pricer UI |
| `src/components/phc/pricing/SupplierTab.tsx`, `SupplierEntryForm.tsx`, `CostReviewTab.tsx` | Wired to requests |
| `src/routes/supplier.tsx`, `supplier.index.tsx`, `supplier.$invitationId.tsx`, `src/components/phc/supplier/SupplierShell.tsx`, `InvitationForm.tsx` | The portal |
| `src/routes/_authenticated/route.tsx`, `src/routes/index.tsx` | Suppliers go to `/supplier` |
| `docs/USER_GUIDE.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/AI_HANDOFF.md`, `tasks/current.md` | Docs in this PR |

**Task order:** SQL 1–5 (each with pgTAP; Task 5 also holds the sweep), then the Edge layer (6), the TypeScript layer (7), the pricer UI (8), the portal UI (9), docs and verification (10).

---
### Task 1: The supplier role and the account boundary (SQL + role lists)

> **Fix round 1 (2026-11-08):** the code blocks below are the first version. The branch's `20261108110000_supplier_accounts.sql` and `supplier_accounts.test.sql` are authoritative: the boundary is keyed on `profiles.vendor_id`; the email check is a BEFORE INSERT check plus a deferred constraint trigger `auth.phc_supplier_invite_check` (GoTrue writes `app_metadata` after the INSERT); `current_margin_floor` / `estimation_cost_basis` are closed to anon; `my_day`, `meeting_review_queue`, `my_fireflies_connection` check `has_app_access`. See `.superpowers/sdd/task-1-report.md`, "Fix round 1".

**Files:**
- Create: `supabase/migrations/20261108100000_supplier_role.sql`
- Create: `supabase/migrations/20261108110000_supplier_accounts.sql`
- Test: `supabase/tests/supplier_accounts.test.sql`
- Modify: `src/lib/roles.ts`, `supabase/functions/_shared/roles.ts`, `src/lib/roles.capabilities.test.ts`, `src/lib/i18n.tsx`, `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: `public.has_app_access(uuid)` (20261104120000 body), `public.is_pricer(uuid)`, `public.has_role(uuid, app_role)`, `public.can_read_commercial_cost(uuid)`, `public.enforce_signup_email_domain()` (trigger `trg_enforce_signup_email_domain` on `auth.users`, BEFORE INSERT OR UPDATE OF email), `public.current_margin_floor()` (Phase 8), views `vendor_duplicate_candidates`, `automation_health`.
- Produces:
  - `app_role` value `'supplier'`; column `public.profiles.vendor_id uuid` (FK `vendors`), never changed by a client: set inside `supplier_account_activate` (flag `phc.supplier_account_link` = the profile id) or by the service role; cleared only by the service role on a non-active account. **It is what makes an account a supplier** (fix round 1); the role row is a second marker and cannot be deleted while the link is set.
  - `public.is_supplier_account(_user_id uuid) → boolean` (internal): `vendor_id IS NOT NULL` or the supplier role row.
  - `public.is_active_user(uuid)` and `public.has_any_role(uuid, app_role[])` are false for a vendor-linked profile, also when staff ask about it (assignees, recipients); `emit_notification` therefore skips suppliers, and a trigger refuses a task owned by a supplier.
  - `public._supplier_session_vendor() → uuid` (internal): the caller's vendor when the caller is an active supplier with a vendor and `aal2`, else NULL.
  - `public.has_app_access(uuid)` is false for any supplier account (vendor-linked profile or supplier role row).
  - Table `public.supplier_account_invites(id, vendor_id, email, full_name, created_by, created_at, expires_at, user_id, consumed_at)` (service role only).
  - `public.supplier_account_prepare(_vendor_id uuid, _email text, _full_name text) → uuid` (pricer or system admin; the invite id).
  - `public.supplier_account_activate(_invite_id uuid, _user_id uuid) → jsonb {"user_id","vendor_id"}` (service role only).
  - `public.supplier_account_email(_user_id uuid) → text` (pricer or system admin).
  - `public.pricing_supplier_accounts(_vendor_id uuid) → TABLE(user_id uuid, full_name text, email text, status user_status, created_at timestamptz)` (pricer, system admin or cost reader).
  - `app_role` in TypeScript: `AppRole` gains `"supplier"`; `isSupplier(r)`; `"supplier"` in `ALL_ROLES` (last) and `MFA_REQUIRED_ROLES`; `ROLE_GROUPS.supplier`. Same in the Edge mirror.

- [ ] **Step 1: Check the migration numbers**

Run: `git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3`
Expected: the highest is `20261104160000_pricing_supplier_entry.sql`. If anything is ≥ `20261108100000`, renumber this plan's six migrations upward first (Global Constraints).

- [ ] **Step 2: Write the failing pgTAP test**

Create `supabase/tests/supplier_accounts.test.sql`:

```sql
-- PR 3 Task 1: the supplier role, its boundary, and supplier accounts.
-- Test user UUIDs use the 8a prefix. Every session carries aal2 unless it says otherwise.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'sa-rep'),(2,'sa-pricer'),(3,'sa-gm'),(4,'sa-supplier'),(5,'sa-admin'),(6,'sa-new')) v(n, r);
update public.profiles set status = 'active' where id::text like '8a000000-%' and id <> '8a000000-0000-0000-0000-000000000006';
insert into public.user_roles (user_id, role) values
  ('8a000000-0000-0000-0000-000000000001','salesperson'),
  ('8a000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8a000000-0000-0000-0000-000000000002','finance_manager'),
  ('8a000000-0000-0000-0000-000000000003','general_manager'),
  ('8a000000-0000-0000-0000-000000000005','system_admin');
insert into public.vendors (id, name) values
  ('8a100001-0000-0000-0000-000000000001','sa Vendor One Co'),
  ('8a100002-0000-0000-0000-000000000001','SA VENDOR ONE co.');
-- Fixture only: the supplier account as supplier_account_activate leaves it (triggers off).
set local session_replication_role = replica;
update public.profiles set vendor_id = '8a100001-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000004','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage) values
  ('8a200001-0000-0000-0000-000000000001','sa-deal-1','8a000000-0000-0000-0000-000000000001','8a000000-0000-0000-0000-000000000001','rfq_received');
insert into public.automation_runs (trigger) values ('sa-probe');
insert into public.margin_policies (min_margin_pct, effective_from, rationale) values (12, now() - interval '1 day', 'sa-floor');

-- The role exists and the boundary closes on it.
select ok('supplier' = any(enum_range(null::public.app_role)::text[]), 'The app_role enum has supplier');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is(public.has_app_access('8a000000-0000-0000-0000-000000000004'), false, 'A supplier with MFA has no app access');
select is((select count(*)::int from public.profiles), 1, 'A supplier reads its own profile only');
select is((select count(*)::int from public.user_roles), 1, 'A supplier reads its own role only');
select is((select count(*)::int from public.opportunities), 0, 'A supplier reads no deal');
select is((select count(*)::int from public.vendors), 0, 'A supplier reads no vendor');
select is((select count(*)::int from public.vendor_duplicate_candidates), 0, 'A supplier reads no vendor names through the duplicates view');
select is((select count(*)::int from public.automation_health), 0, 'A supplier reads no automation health');
select is(public.current_margin_floor(), null::numeric, 'A supplier gets no margin floor');
select throws_ok($$update public.profiles set vendor_id = '8a100002-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'A supplier cannot move its own account to another vendor');
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','x@example.com','X')$$,
  '42501', null, 'A supplier cannot create supplier accounts');
select throws_ok($$select * from public.pricing_supplier_accounts('8a100001-0000-0000-0000-000000000001')$$,
  '42501', null, 'A supplier cannot list supplier accounts');

-- Staff are unaffected.
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.has_app_access('8a000000-0000-0000-0000-000000000002'), true, 'A pricer with MFA keeps app access');
select is((select count(*)::int from public.vendor_duplicate_candidates where vendor_count = 2), 1, 'Estimation still reads the duplicate vendors (as invoker)');
select is(public.current_margin_floor(), 12.00::numeric, 'Staff still read the margin floor');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.automation_health where trigger = 'sa-probe'), 1, 'The system administrator still reads automation health');
select throws_ok($$update public.profiles set vendor_id = '8a100002-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'Not even the system administrator edits a supplier''s vendor directly');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000004','salesperson')$$,
  '23514', null, 'A supplier account cannot also be given a staff role');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000001','supplier')$$,
  '23514', null, 'A staff account cannot be given the supplier role');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000006','supplier')$$,
  '23514', null, 'The supplier role needs a vendor on the profile');

-- Reading the session's vendor (internal helper: called as the owner with each session's claims).
reset role;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is(public._supplier_session_vendor(), '8a100001-0000-0000-0000-000000000001'::uuid, 'A supplier session with MFA prices for its vendor');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',true);
select is(public._supplier_session_vendor(), null::uuid, 'Without MFA a supplier session has no vendor');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public._supplier_session_vendor(), null::uuid, 'A pricer session has no vendor');

-- Creating an account: prepare (pricer), the sign-in account (GoTrue), activate (service role).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','new@factory.example','New Contact')$$,
  '42501', null, 'A rep cannot create supplier accounts');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','not-an-email','New Contact')$$,
  '23514', null, 'A malformed email is refused');
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','someone@phc-sa.com','New Contact')$$,
  '23514', null, 'A PHC address cannot be a supplier account');
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','sa-rep+test@phc-sa.com','Rep')$$,
  '23514', null, 'An existing staff address is refused');
select throws_ok($$select public.supplier_account_prepare('8a10000f-0000-0000-0000-000000000001','new@factory.example','New Contact')$$,
  '23514', null, 'An unknown vendor is refused');
create temp table sa_invite (id uuid);
grant all on sa_invite to authenticated, service_role;
insert into sa_invite select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001',' New@Factory.Example ','New Contact');
select throws_ok($$select count(*) from public.supplier_account_invites$$, '42501', null, 'Nobody reads the requests table directly');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.supplier_account_prepare('8a100002-0000-0000-0000-000000000001','other@factory.example','Other')$$,
  'The system administrator can prepare a supplier account');
reset role;
select is((select email from public.supplier_account_invites where id = (select id from sa_invite)), 'new@factory.example',
  'The request keeps the address trimmed and lower-cased');
select set_config('request.jwt.claims','',true);
-- GoTrue's insert: a non-PHC address passes only with the request id in app_metadata.
select throws_ok($$insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000','8a000000-0000-0000-0000-00000000000a','authenticated','authenticated','new@factory.example',
          '{"provider":"email"}','{}', now(), now())$$,
  '23514', null, 'A non-PHC sign-up without the request is refused');
select lives_ok(format($$insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000','8a000000-0000-0000-0000-00000000000a','authenticated','authenticated','new@factory.example',
          '{"provider":"email","phc_supplier_invite":"%s"}','{}', now(), now())$$, (select id from sa_invite)),
  'The supplier-account action''s insert passes');
select lives_ok($$update auth.users set last_sign_in_at = now(), email = email where id = '8a000000-0000-0000-0000-00000000000a'$$,
  'Signing in later (address unchanged) passes');
select throws_ok($$update auth.users set email = 'changed@factory.example' where id = '8a000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'Changing to another non-PHC address is refused');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_account_activate('%s','8a000000-0000-0000-0000-00000000000a')$$, (select id from sa_invite)),
  '42501', null, 'Only the service role activates an account');
set local role service_role;
select set_config('request.jwt.claims','',true);
select throws_ok(format($$select public.supplier_account_activate('%s','8a000000-0000-0000-0000-000000000006')$$, (select id from sa_invite)),
  '23514', null, 'The account must be the one the request named');
select is((public.supplier_account_activate((select id from sa_invite), '8a000000-0000-0000-0000-00000000000a'))->>'vendor_id',
  '8a100001-0000-0000-0000-000000000001', 'Activation links the account to the vendor');
select is((select status::text || '/' || coalesce(sales_code, '-') || '/' || full_name from public.profiles where id = '8a000000-0000-0000-0000-00000000000a'),
  'active/-/New Contact', 'The account is active, holds no sales code, and carries the contact''s name');
select is((select array_agg(role::text) from public.user_roles where user_id = '8a000000-0000-0000-0000-00000000000a'), array['supplier'],
  'The account holds the supplier role only');
select throws_ok(format($$select public.supplier_account_activate('%s','8a000000-0000-0000-0000-00000000000a')$$, (select id from sa_invite)),
  'P0001', null, 'A request is used once');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'supplier_account.created' and entity_id = '8a000000-0000-0000-0000-00000000000a'
  and actor_id = '8a000000-0000-0000-0000-000000000002'), 'Creating the account is audited as the pricer''s');

-- Listing and the set-password address.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_supplier_accounts('8a100001-0000-0000-0000-000000000001')), 2,
  'The pricer sees the vendor''s two portal accounts');
select is(public.supplier_account_email('8a000000-0000-0000-0000-00000000000a'), 'new@factory.example', 'The pricer gets the address for a new set-password link');
select throws_ok($$select public.supplier_account_email('8a000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'No set-password link for a staff account through this path');

-- Every public table carries the session boundary.
reset role;
select is((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and c.relname not in ('profiles','user_roles')
              and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                                and p.policyname = 'audit_session_boundary' and p.permissive = 'RESTRICTIVE')),
  null::text[], 'Every public table has the restrictive session boundary');

select * from finish();
rollback;
```

- [ ] **Step 3: Run it to see it fail**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_accounts.test.sql` fails before its first assertion (`profiles.vendor_id` and the supplier role do not exist yet); every other file passes.

- [ ] **Step 4: Write the two migrations**

Create `supabase/migrations/20261108100000_supplier_role.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 3: the supplier role (spec section 2). Alone in its file: a
-- new enum value cannot be used in the transaction that adds it, and the next
-- migration uses it.
-- =============================================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supplier';
```

Create `supabase/migrations/20261108110000_supplier_accounts.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 3, part 1: supplier accounts and the boundary around them.
--
-- A supplier is an external account linked to one vendors row. It reaches the
-- supplier portal's functions and nothing else. The boundary is has_app_access:
-- every public table carries the restrictive audit_session_boundary policy
-- built on it (20260928100000, and section 7 below for the tables made since),
-- storage.objects carries it, and every role predicate (has_role,
-- is_active_user, is_pricer, can_read_commercial_cost, ...) goes through it for
-- the caller. A supplier now fails it, so it reads and writes nothing through
-- PostgREST. The portal (later migrations) is SECURITY DEFINER functions that
-- start from _supplier_session_vendor() instead.
-- =============================================================================

-- 1. The vendor a supplier account prices for.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS profiles_vendor ON public.profiles (vendor_id) WHERE vendor_id IS NOT NULL;
COMMENT ON COLUMN public.profiles.vendor_id IS
  'Supplier accounts only: the vendor this account prices for. Set by supplier_account_activate; nobody edits it directly.';

-- Only supplier_account_activate sets it (transaction-local flag naming the profile).
CREATE OR REPLACE FUNCTION public.profiles_vendor_link_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF ((TG_OP = 'INSERT' AND NEW.vendor_id IS NOT NULL)
      OR (TG_OP = 'UPDATE' AND NEW.vendor_id IS DISTINCT FROM OLD.vendor_id))
     AND coalesce(current_setting('phc.supplier_account_link', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'A supplier account''s vendor is set when the account is created. | يُحدَّد مورد الحساب عند إنشائه.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_vendor_link_guard ON public.profiles;
CREATE TRIGGER profiles_vendor_link_guard BEFORE INSERT OR UPDATE OF vendor_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_vendor_link_guard();

-- 2. Who is a supplier, and which vendor the current session prices for.
CREATE OR REPLACE FUNCTION public.is_supplier_account(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'supplier'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public.is_supplier_account(uuid) FROM PUBLIC, anon, authenticated;

-- An active supplier account with a vendor, signed in with MFA (aal2). NULL for
-- anyone else. Every portal function starts here.
CREATE OR REPLACE FUNCTION public._supplier_session_vendor()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.vendor_id FROM public.profiles p
   WHERE p.id = auth.uid() AND p.status = 'active' AND p.vendor_id IS NOT NULL
     AND public.is_supplier_account(p.id)
     AND coalesce(auth.jwt()->>'aal', '') = 'aal2';
$$;
REVOKE ALL ON FUNCTION public._supplier_session_vendor() FROM PUBLIC, anon, authenticated;

-- 3. A supplier never has app access. Same body as 20261104120000 plus the supplier line.
CREATE OR REPLACE FUNCTION public.has_app_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND status = 'active')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'supplier')
    AND (NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id
      AND role IN ('general_manager','finance_manager','sales_manager','system_admin','managing_director')
    ) OR (auth.uid() = _user_id AND auth.jwt()->>'aal' = 'aal2')), false);
$$;
REVOKE ALL ON FUNCTION public.has_app_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_app_access(uuid) TO authenticated, service_role;

-- 4. The supplier role stands alone and always has its vendor.
CREATE OR REPLACE FUNCTION public.user_roles_supplier_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'supplier' THEN
    IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.user_id AND r.role <> 'supplier') THEN
      RAISE EXCEPTION 'A supplier account holds no other role. | حساب المورد لا يحمل دوراً آخر.' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.vendor_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Supplier accounts are created from the pricing file, linked to a supplier. | حسابات الموردين تُنشأ من ملف التسعير مربوطة بمورد.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.user_id AND r.role = 'supplier') THEN
    RAISE EXCEPTION 'A supplier account holds no other role. | حساب المورد لا يحمل دوراً آخر.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_roles_supplier_guard ON public.user_roles;
CREATE TRIGGER user_roles_supplier_guard BEFORE INSERT OR UPDATE OF role, user_id ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_supplier_guard();

-- 5. auth.users takes a non-PHC address only for a supplier account that the
-- supplier-account action (sales-os-api) is creating right now: a pricer's
-- request row (supplier_account_prepare), named in app_metadata, which only
-- the service role can set. A sign-up from the app cannot set app_metadata.
CREATE TABLE IF NOT EXISTS public.supplier_account_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  email       text NOT NULL,
  full_name   text NOT NULL,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  consumed_at timestamptz,
  CONSTRAINT sai_email_clean CHECK (email = lower(btrim(email)) AND char_length(email) <= 254
                                    AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT sai_name CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 200)
);
ALTER TABLE public.supplier_account_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_account_invites FROM anon, authenticated;
GRANT ALL ON public.supplier_account_invites TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_signup_email_domain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- An update that keeps the address is not a new address.
  IF TG_OP = 'UPDATE' AND NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NEW;
  END IF;
  IF NEW.email IS NOT NULL AND NEW.email !~* '@phc-sa\.com$' THEN
    IF TG_OP = 'INSERT' AND EXISTS (
         SELECT 1 FROM public.supplier_account_invites i
          WHERE i.id::text = coalesce(NEW.raw_app_meta_data->>'phc_supplier_invite', '')
            AND i.email = lower(NEW.email)
            AND i.consumed_at IS NULL AND i.expires_at > now()) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Account email must be an @phc-sa.com address'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Account RPCs. Pricers (Zayed) and the system administrator manage supplier accounts.
CREATE OR REPLACE FUNCTION public._supplier_account_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.is_pricer(_user_id) OR public.has_role(_user_id, 'system_admin'::public.app_role), false);
$$;
REVOKE ALL ON FUNCTION public._supplier_account_manager(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.supplier_account_prepare(_vendor_id uuid, _email text, _full_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); e text := lower(btrim(coalesce(_email, ''))); n text := btrim(coalesce(_full_name, ''));
        invite_id uuid;
BEGIN
  IF NOT public._supplier_account_manager(u) THEN
    RAISE EXCEPTION 'Only estimation, finance or the system administrator create supplier accounts. | حسابات الموردين ينشئها التقدير أو المالية أو مدير النظام.'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(e) > 254 OR e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter the supplier''s email address. | أدخل بريد المورد.' USING ERRCODE = '23514';
  END IF;
  IF e ~* '@phc-sa\.com$' THEN
    RAISE EXCEPTION 'A PHC address cannot be a supplier account. | لا يكون بريد PHC حساب مورد.' USING ERRCODE = '23514';
  END IF;
  IF char_length(n) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Enter the contact''s name (up to 200 characters). | أدخل اسم جهة الاتصال (حتى 200 حرف).' USING ERRCODE = '23514';
  END IF;
  IF _vendor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = _vendor_id) THEN
    RAISE EXCEPTION 'Unknown supplier. | المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = e) THEN
    RAISE EXCEPTION 'An account with this email already exists. | يوجد حساب بهذا البريد.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.supplier_account_invites (vendor_id, email, full_name, created_by)
  VALUES (_vendor_id, e, n, u) RETURNING id INTO invite_id;
  RETURN invite_id;
END $$;
REVOKE ALL ON FUNCTION public.supplier_account_prepare(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_account_prepare(uuid, text, text) TO authenticated;

-- Service role only: called by sales-os-api right after it created the sign-in account.
CREATE OR REPLACE FUNCTION public.supplier_account_activate(_invite_id uuid, _user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.supplier_account_invites; mail text; touched integer;
BEGIN
  SELECT * INTO i FROM public.supplier_account_invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND OR i.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This supplier account request was already used or does not exist. | طلب حساب المورد مستخدم أو غير موجود.' USING ERRCODE = 'P0001';
  END IF;
  SELECT lower(email) INTO mail FROM auth.users WHERE id = _user_id;
  IF mail IS DISTINCT FROM i.email THEN
    RAISE EXCEPTION 'The account does not match the request. | الحساب لا يطابق الطلب.' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('phc.supplier_account_link', _user_id::text, true);
  -- A supplier holds no sales code: the deal-code namespace is the reps'.
  UPDATE public.profiles
     SET vendor_id = i.vendor_id, status = 'active', full_name = i.full_name, sales_code = NULL
   WHERE id = _user_id;
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM set_config('phc.supplier_account_link', '', true);
  IF touched = 0 THEN
    RAISE EXCEPTION 'The new account has no profile. | لا يوجد ملف للحساب الجديد.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'supplier');
  UPDATE public.supplier_account_invites SET user_id = _user_id, consumed_at = now() WHERE id = i.id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (i.created_by, 'user', 'supplier_account.created', 'user', _user_id,
          jsonb_build_object('vendor_id', i.vendor_id, 'invite_id', i.id));
  RETURN jsonb_build_object('user_id', _user_id, 'vendor_id', i.vendor_id);
END $$;
REVOKE ALL ON FUNCTION public.supplier_account_activate(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_account_activate(uuid, uuid) TO service_role;

-- The address a new set-password link goes to (sales-os-api, as the caller).
CREATE OR REPLACE FUNCTION public.supplier_account_email(_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e text;
BEGIN
  IF NOT public._supplier_account_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only estimation, finance or the system administrator manage supplier accounts. | حسابات الموردين يديرها التقدير أو المالية أو مدير النظام.'
      USING ERRCODE = '42501';
  END IF;
  SELECT p.email INTO e FROM public.profiles p
   WHERE p.id = _user_id AND p.status = 'active' AND public.is_supplier_account(p.id);
  IF e IS NULL THEN
    RAISE EXCEPTION 'Not an active supplier account. | ليس حساب مورد نشطاً.' USING ERRCODE = '23514';
  END IF;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.supplier_account_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_account_email(uuid) TO authenticated;

-- The vendor's portal accounts, for the Supplier tab.
CREATE OR REPLACE FUNCTION public.pricing_supplier_accounts(_vendor_id uuid)
RETURNS TABLE (user_id uuid, full_name text, email text, status public.user_status, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT (public._supplier_account_manager(auth.uid()) OR public.can_read_commercial_cost(auth.uid())) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.email, p.status, p.created_at
      FROM public.profiles p
     WHERE p.vendor_id = _vendor_id AND public.is_supplier_account(p.id)
     ORDER BY p.created_at;
END $$;
REVOKE ALL ON FUNCTION public.pricing_supplier_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_supplier_accounts(uuid) TO authenticated;

-- 7. What any signed-in account could read without a check on the caller.
-- Two owner-run views read every row (vendor names; automation errors). As
-- invoker they follow vendors' and automation_runs' own policies, which is who
-- reads them today (no screen does).
ALTER VIEW public.vendor_duplicate_candidates SET (security_invoker = true);
ALTER VIEW public.automation_health SET (security_invoker = true);

-- The margin floor is commercial; a supplier gets NULL. Same body as Phase 8 plus one line.
CREATE OR REPLACE FUNCTION public.current_margin_floor()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.min_margin_pct FROM public.margin_policies p
   WHERE now() >= p.effective_from
     AND (p.effective_to IS NULL OR now() < p.effective_to)
     AND NOT public.is_supplier_account(auth.uid())
   ORDER BY p.effective_from DESC LIMIT 1;
$$;

-- The session boundary on every public table that does not have it yet
-- (tables made after 20260928100000, PR 1's pricing tables, and the table
-- above). Defence in depth: their own policies already go through the role
-- predicates. Later PR 3 migrations add it to their tables themselves.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
              AND c.relname NOT IN ('profiles','user_roles')
              AND NOT EXISTS (SELECT 1 FROM pg_policies p
                               WHERE p.schemaname = 'public' AND p.tablename = c.relname
                                 AND p.policyname = 'audit_session_boundary') LOOP
    EXECUTE format('CREATE POLICY audit_session_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
                   'USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())))',
                   t.relname);
  END LOOP;
END $$;
```

- [ ] **Step 5: Run the DB tests**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_accounts.test.sql .. ok` (46 tests) and every other file still ok. The session boundary added in section 7 changes nothing for staff with app access; the existing suites prove it.

- [ ] **Step 6: Add the role to the TypeScript role lists (the role contract test now fails without it)**

Run first: `bun test src/lib/roles.contract.test.ts`
Expected: FAIL, "DB enum values unknown to app: supplier".

In **both** `src/lib/roles.ts` and `supabase/functions/_shared/roles.ts` make the same four edits:

1. Replace

```ts
  | "viewer";
```

with

```ts
  | "viewer"
  | "supplier"; // external: a factory pricing through the supplier portal (pricing loop PR 3)
```

2. In `ALL_ROLES`, replace

```ts
  "viewer",
];
```

with

```ts
  "viewer",
  "supplier",
];
```

3. In `ROLE_GROUPS`, replace

```ts
  viewer: ["viewer"] as AppRole[],
```

with

```ts
  viewer: ["viewer"] as AppRole[],
  supplier: ["supplier"] as AppRole[],
```

4. Replace

```ts
export const isViewer = (r: RoleInput) => inGroup(r, ROLE_GROUPS.viewer);
```

with

```ts
export const isViewer = (r: RoleInput) => inGroup(r, ROLE_GROUPS.viewer);
export const isSupplier = (r: RoleInput) => inGroup(r, ROLE_GROUPS.supplier);
```

5. In `MFA_REQUIRED_ROLES`, replace

```ts
  "managing_director",
];
export const requiresMfa
```

with

```ts
  "managing_director",
  "supplier",
];
export const requiresMfa
```

In `src/lib/roles.capabilities.test.ts`:

1. In the import list, replace

```ts
  isViewer,
  canApproveCommercialAction,
```

with

```ts
  isViewer,
  isSupplier,
  requiresMfa,
  canApproveCommercialAction,
```

2. In the "group predicates partition every role" test, replace

```ts
    isSalesperson,
    isViewer,
  ];
```

with

```ts
    isSalesperson,
    isViewer,
    isSupplier,
  ];
```

3. Append at the end of the file:

```ts
// Pricing loop PR 3: a supplier account is external. It holds no staff
// capability at all, and it must sign in with MFA like the managers.
test("a supplier account holds no staff capability and needs MFA", async () => {
  const caps = (await import("./roles")) as unknown as Record<string, unknown>;
  const ctx = { isOwner: false, ownerId: null, userId: null };
  const granted = Object.entries(caps)
    .filter(([name, f]) => name.startsWith("can") && typeof f === "function")
    .filter(([, f]) => (f as (r: AppRole[], c: typeof ctx) => boolean)(["supplier"], ctx))
    .map(([name]) => name);
  expect(granted).toEqual([]);
  expect(requiresMfa(["supplier"])).toBe(true);
  expect(isSupplier(["supplier"])).toBe(true);
  expect(isSupplier(["estimation_manager"])).toBe(false);
});
```

In `src/lib/i18n.tsx`, replace

```ts
  role_viewer: { en: "Viewer", ar: "قارئ" },
```

with

```ts
  role_viewer: { en: "Viewer", ar: "قارئ" },
  role_supplier: { en: "Supplier (portal)", ar: "مورد (البوابة)" },
```

In `src/integrations/supabase/types.ts` (generated types; the enum is what `team-actions.ts` type-checks against), add `"supplier"` after `"estimation_manager"` in both places `app_role` is listed: the union (`| "estimation_manager"` → `| "estimation_manager"\n        | "supplier"`) and the `Constants` array (`"estimation_manager",` → `"estimation_manager",\n        "supplier",`).

- [ ] **Step 7: Run the role tests and the typecheck**

Run: `bun test src/lib/roles.contract.test.ts src/lib/roles.capabilities.test.ts && bun run typecheck`
Expected: all pass; typecheck clean. (The admin role matrix now shows a "Supplier (portal)" column; ticking it for a staff member is refused by `user_roles_supplier_guard`.)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261108100000_supplier_role.sql supabase/migrations/20261108110000_supplier_accounts.sql \
  supabase/tests/supplier_accounts.test.sql src/lib/roles.ts supabase/functions/_shared/roles.ts \
  src/lib/roles.capabilities.test.ts src/lib/i18n.tsx src/integrations/supabase/types.ts
git commit -m "feat(pricing): supplier role, supplier accounts and the session boundary on every table" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Send the frozen file to one supplier (SQL)

**Files:**
- Create: `supabase/migrations/20261108120000_supplier_invitations.sql`
- Test: `supabase/tests/supplier_invitations.test.sql`

> **Fix round 1 (Task 2 as built; the code below is the original brief, the migration and test files are authoritative):** sending also audits the ids of the quotes it cancelled and the selection lines it cleared; it refuses (P0001, `DETAIL` lists the estimation ids) when a selection would be cleared while another estimation, not the file's own, uses the revision; the checksum of a sent file is the storage object's ETag, not the documents row's; `_pricing_today()` is internal; cancel and extend refuse a file that is no longer `at_supplier`. An open invitation stays `sent`/`opened`/`reopened` when its file moves past `at_supplier` or closes.

**Interfaces:**
- Consumes: Task 1 (`has_app_access`, the boundary); PR 1 `public._pricing_file_apply(pricing_files, pricing_file_state, uuid, text) → pricing_files` (internal), `pricing_files`; PR 2 `public._pricing_supplier_entry_open(uuid)` and the entry flag `phc.pricing_supplier_entry` (the 7B guards admit a write on a frozen revision only while the flag names that revision and its file is `at_supplier`); `public.boq_revision_is_frozen(uuid)`; `documents`, `document_links`, `storage.objects`.
- Produces:
  - Tables `public.supplier_invitations(id, file_id, boq_revision_id, vendor_id, project_code, status ∈ sent|opened|submitted|reopened|cancelled, reply_by date, instructions, return_message, sent_by, sent_at, opened_at, submitted_at, cancelled_by, cancelled_at, cancel_reason, updated_at)`, `public.supplier_invitation_lines(id, invitation_id, boq_line_id, state ∈ open|submitted|reopened)`, `public.supplier_invitation_files(id, invitation_id, document_id, display_name, storage_bucket, storage_path, mime_type, size_bytes, checksum, object_version, object_updated_at)`. One open request per file (`sent|opened|reopened`). Readable by pricers and cost readers.
  - `public._pricing_today() → date` (Riyadh's date).
  - `public.pricing_send_to_supplier(_file_id uuid, _vendor_id uuid, _reply_by date, _document_ids uuid[], _instructions text DEFAULT NULL, _replace_earlier boolean DEFAULT false) → jsonb {"invitation_id","lines","files"}`.
  - `public.pricing_cancel_invitation(_invitation_id uuid, _reason text) → jsonb {"invitation_id","status"}`.
  - `public.pricing_extend_invitation(_invitation_id uuid, _reply_by date) → jsonb {"invitation_id","reply_by"}`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/supplier_invitations.test.sql`:

```sql
-- PR 3 Task 2: a pricer sends the frozen file to one supplier; cancel; change the reply-by date.
-- Test user UUIDs use the 8b prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8b000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'si-rep'),(2,'si-pricer'),(3,'si-gm'),(4,'si-supplier'),(5,'si-bd')) v(n, r);
update public.profiles set status = 'active' where id::text like '8b000000-%';
insert into public.user_roles (user_id, role) values
  ('8b000000-0000-0000-0000-000000000001','salesperson'),
  ('8b000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8b000000-0000-0000-0000-000000000002','finance_manager'),
  ('8b000000-0000-0000-0000-000000000003','general_manager'),
  ('8b000000-0000-0000-0000-000000000005','bd_manager');
insert into public.vendors (id, name) values
  ('8b100001-0000-0000-0000-000000000001','si-vendor-a'),
  ('8b100002-0000-0000-0000-000000000001','si-vendor-b');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8b100001-0000-0000-0000-000000000001' where id = '8b000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values ('8b000000-0000-0000-0000-000000000004','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'si-deal-' || n,
       '8b000000-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,3) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8b40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'si-boq-' || n
  from generate_series(1,3) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8b50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8b40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,3) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, location) values
  ('8b510001-0000-0000-0000-000000000001','8b500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'si-site-secret'),
  ('8b510002-0000-0000-0000-000000000001','8b500001-0000-0000-0000-000000000001',2,'Wall W1',4,null),
  ('8b510003-0000-0000-0000-000000000001','8b500002-0000-0000-0000-000000000001',1,'Ceiling C1',1,null),
  ('8b510004-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001',1,'Stand S1',3,null);
-- Revision 3: vendor B priced and estimation selected a line before the freeze (Phase 7B).
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency) values
  ('8b800001-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001','SAR');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost, is_selected, selected_by, selected_at) values
  ('8b800001-0000-0000-0000-000000000001','8b510004-0000-0000-0000-000000000001',3,100,true,'8b000000-0000-0000-0000-000000000002',now());
update public.boq_revisions set frozen_at = now(), frozen_by = '8b000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('8b500001-0000-0000-0000-000000000001','8b500002-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8b600001-0000-0000-0000-000000000001','8b200001-0000-0000-0000-000000000001','boq_frozen','8b500001-0000-0000-0000-000000000001'),
  ('8b600002-0000-0000-0000-000000000001','8b200002-0000-0000-0000-000000000001','package_review','8b500002-0000-0000-0000-000000000001'),
  ('8b600003-0000-0000-0000-000000000001','8b200003-0000-0000-0000-000000000001','boq_frozen','8b500003-0000-0000-0000-000000000001');
-- Files: 1 on deal 1 (in storage), 2 on deal 2, 3 on deal 1 but missing from storage, 4 on deal 3.
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by) values
  ('8b700001-0000-0000-0000-000000000001','attachments','opportunity/8b1/plan.pdf','Client Mall drawings.PDF','application/pdf',1000,repeat('a',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700002-0000-0000-0000-000000000001','attachments','opportunity/8b2/plan.pdf','other.pdf','application/pdf',1000,repeat('b',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700003-0000-0000-0000-000000000001','attachments','opportunity/8b1/missing.pdf','missing.pdf','application/pdf',1000,repeat('c',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700004-0000-0000-0000-000000000001','attachments','opportunity/8b3/plan.dwg','plan.dwg','application/octet-stream',1000,repeat('d',64),'drawing','8b000000-0000-0000-0000-000000000001');
insert into public.document_links (document_id, entity_type, entity_id, linked_by) values
  ('8b700001-0000-0000-0000-000000000001','opportunity','8b200001-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700002-0000-0000-0000-000000000001','opportunity','8b200002-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700003-0000-0000-0000-000000000001','opportunity','8b200001-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700004-0000-0000-0000-000000000001','opportunity','8b200003-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001');
insert into storage.objects (bucket_id, name, owner, version) values
  ('attachments','opportunity/8b1/plan.pdf','8b000000-0000-0000-0000-000000000001','v1'),
  ('attachments','opportunity/8b2/plan.pdf','8b000000-0000-0000-0000-000000000001','v1'),
  ('attachments','opportunity/8b3/plan.dwg','8b000000-0000-0000-0000-000000000001','v1');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, '42501', null, 'A rep cannot send a file to the supplier');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, '42501', null, 'A supplier cannot send a file');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date - 2, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, '23514', null, 'A reply-by date in the past is refused');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array[]::uuid[])$$, '23514', null, 'A request with no files is refused');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700002-0000-0000-0000-000000000001']::uuid[])$$, '23514', null, 'Another deal''s file is refused');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700003-0000-0000-0000-000000000001']::uuid[])$$, '23514', null, 'A file missing from storage is refused');
select throws_ok($$select public.pricing_send_to_supplier('8b600002-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700002-0000-0000-0000-000000000001']::uuid[])$$, 'P0001', null, 'A file still in package review cannot be sent');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b10000f-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, '23514', null, 'An unknown supplier is refused');

create temp table si_sent (r jsonb);
grant all on si_sent to authenticated;
insert into si_sent select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[], 'Please give a price with and without the screen.');
select is((select (r->>'lines') || '/' || (r->>'files') from si_sent), '2/1', 'Sending covers the BOQ''s two lines and one file');
select is((select state::text from public.pricing_files where id = '8b600001-0000-0000-0000-000000000001'), 'at_supplier', 'The file is now at the supplier');
select is((select status || '/' || project_code from public.supplier_invitations where id = (select (r->>'invitation_id')::uuid from si_sent)),
  'sent/' || (select project_code from public.opportunities where id = '8b200001-0000-0000-0000-000000000001'),
  'The request is sent under the deal''s project code');
select is((select count(*)::int from public.supplier_invitation_lines where invitation_id = (select (r->>'invitation_id')::uuid from si_sent) and state = 'open'), 2,
  'Both lines are open for pricing');
select is((select display_name from public.supplier_invitation_files where invitation_id = (select (r->>'invitation_id')::uuid from si_sent)),
  (select project_code from public.opportunities where id = '8b200001-0000-0000-0000-000000000001') || '-01.pdf',
  'The file is renamed to the project code: the client''s file name never reaches the supplier');
select is((select object_version from public.supplier_invitation_files where invitation_id = (select (r->>'invitation_id')::uuid from si_sent)), 'v1',
  'The exact storage version sent is kept');
select is((select count(*)::int from public.pricing_file_events where file_id = '8b600001-0000-0000-0000-000000000001'
             and to_state = 'at_supplier' and actor_id = '8b000000-0000-0000-0000-000000000002'), 1, 'The move is in the file''s history, by the pricer');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, 'P0001', null, 'A second open request on the same file is refused');

-- The second supplier's quote from before the freeze (AI_HANDOFF PR 3 contract).
select throws_ok($$select public.pricing_send_to_supplier('8b600003-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700004-0000-0000-0000-000000000001']::uuid[])$$, 'P0001', null,
  'Another supplier''s earlier quote needs the pricer''s confirmation');
select is((select state::text from public.pricing_files where id = '8b600003-0000-0000-0000-000000000001'), 'boq_frozen', 'A refused send leaves the file where it was');
select lives_ok($$select public.pricing_send_to_supplier('8b600003-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700004-0000-0000-0000-000000000001']::uuid[], null, true)$$, 'With the confirmation the file goes to the chosen supplier');
reset role;
select is((select status::text || '/' || cancel_reason from public.supplier_quotes where id = '8b800001-0000-0000-0000-000000000001'),
  'cancelled/Another supplier was chosen for this pricing file', 'The other supplier''s quote is cancelled for this file, with the reason');
select is((select count(*)::int from public.supplier_quote_lines where supplier_quote_id = '8b800001-0000-0000-0000-000000000001' and is_selected), 0,
  'The 7B selection is cleared, so the build does not refuse the file');
select is((select display_name from public.supplier_invitation_files f join public.supplier_invitations i on i.id = f.invitation_id
            where i.file_id = '8b600003-0000-0000-0000-000000000001'),
  (select project_code from public.opportunities where id = '8b200003-0000-0000-0000-000000000001') || '-01.dwg', 'The extension is kept, lower-cased');
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.sent_to_supplier'
  and after_value->>'file_id' = '8b600003-0000-0000-0000-000000000001' and (after_value->>'cancelled_quotes')::int = 1
  and (after_value->>'cleared_selections')::int = 1), 'Sending is audited with what it cancelled');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select unit_cost from public.pricing_selling_grid where file_id = '8b600003-0000-0000-0000-000000000001'), null::numeric,
  'The grid no longer sees the cancelled quote');

-- Who reads the requests.
select is((select count(*)::int from public.supplier_invitations), 2, 'The pricer reads the requests');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitation_lines), 3, 'The GM (a cost reader) reads them');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitations), 0, 'A rep does not see which supplier a file went to');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitation_files), 0, 'The BD manager does not either');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitations), 0, 'A supplier reads no request table directly (only through the portal)');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$insert into public.supplier_invitations (file_id, boq_revision_id, vendor_id, project_code, reply_by)
  values ('8b600002-0000-0000-0000-000000000001','8b500002-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001','X',current_date)$$,
  '42501', null, 'Requests are written through the RPCs only');

-- A new reply-by date; cancel; send again.
select throws_ok(format($$select public.pricing_extend_invitation('%s', current_date - 1)$$, (select r->>'invitation_id' from si_sent)),
  '23514', null, 'A new reply-by date in the past is refused');
select is((public.pricing_extend_invitation((select (r->>'invitation_id')::uuid from si_sent), current_date + 14))->>'reply_by',
  (current_date + 14)::text, 'The pricer gives the supplier more time');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.pricing_cancel_invitation('%s', 'no')$$, (select r->>'invitation_id' from si_sent)),
  '42501', null, 'A rep cannot cancel a request');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.pricing_cancel_invitation('%s', '  ')$$, (select r->>'invitation_id' from si_sent)),
  '23514', null, 'Cancelling needs a reason');
select is((public.pricing_cancel_invitation((select (r->>'invitation_id')::uuid from si_sent), 'Wrong supplier'))->>'status', 'cancelled',
  'The pricer cancels the request');
select throws_ok(format($$select public.pricing_cancel_invitation('%s', 'again')$$, (select r->>'invitation_id' from si_sent)),
  'P0001', null, 'A cancelled request cannot be cancelled again');
select is((select state::text from public.pricing_files where id = '8b600001-0000-0000-0000-000000000001'), 'at_supplier',
  'Cancelling leaves the file at the supplier');
select lives_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, 'A file at the supplier with no open request can be sent again');
reset role;
select is((select count(*)::int from public.audit_log where action in ('pricing_file.supplier_request_cancelled','pricing_file.supplier_reply_by_changed')
            and after_value->>'file_id' = '8b600001-0000-0000-0000-000000000001'), 2, 'Cancelling and changing the date are audited');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to see it fail**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_invitations.test.sql` fails (function `public.pricing_send_to_supplier` does not exist); every other file passes.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261108120000_supplier_invitations.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 3, part 2: a pricer sends the frozen file to one supplier.
--
-- An invitation is one request to one vendor for one frozen BOQ revision: the
-- lines it covers, the exact file versions sent, and a reply-by date. Sending
-- moves the file boq_frozen -> at_supplier. The supplier reads it through the
-- portal functions (next migration); staff read these tables (pricers and cost
-- readers: which supplier a file went to is supplier information).
--
-- One supplier per file in this release (spec decision 7). A Phase 7B quote
-- another supplier entered before the freeze, or a 7B selection, would make
-- the file unbuildable (multi_quote_lines; build refuses a selection, AI_HANDOFF
-- PR 3 contract). Sending therefore names the file's supplier: with the
-- pricer's confirmation it cancels the other suppliers' live quotes on this
-- revision and clears selections, through PR 2's entry flag (the file is
-- at_supplier by then, which the flag requires).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id         uuid NOT NULL REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  boq_revision_id uuid NOT NULL REFERENCES public.boq_revisions(id) ON DELETE RESTRICT,
  vendor_id       uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  -- What the supplier sees as the project's name. Never the client, deal or site.
  project_code    text NOT NULL,
  status          text NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent','opened','submitted','reopened','cancelled')),
  reply_by        date NOT NULL,
  -- Shown to the supplier: what PHC asks for (no client names).
  instructions    text CHECK (instructions IS NULL OR char_length(instructions) <= 1000),
  -- Shown to the supplier when lines come back (next migrations).
  return_message  text CHECK (return_message IS NULL OR char_length(return_message) <= 1000),
  sent_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  opened_at       timestamptz,
  submitted_at    timestamptz,
  cancelled_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at    timestamptz,
  cancel_reason   text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT si_cancelled_has_reason CHECK (status <> 'cancelled'
                                            OR (cancelled_at IS NOT NULL AND btrim(coalesce(cancel_reason, '')) <> ''))
);
-- One open request per file.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invitations_one_open
  ON public.supplier_invitations (file_id) WHERE status IN ('sent','opened','reopened');
CREATE INDEX IF NOT EXISTS supplier_invitations_vendor ON public.supplier_invitations (vendor_id, status);
CREATE INDEX IF NOT EXISTS supplier_invitations_file ON public.supplier_invitations (file_id, sent_at);

-- The lines a request covers. The revision is frozen, so boq_lines cannot
-- change under it (Phase 7A); state says which lines the supplier may price.
CREATE TABLE IF NOT EXISTS public.supplier_invitation_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES public.supplier_invitations(id) ON DELETE RESTRICT,
  boq_line_id   uuid NOT NULL REFERENCES public.boq_lines(id) ON DELETE RESTRICT,
  state         text NOT NULL DEFAULT 'open' CHECK (state IN ('open','submitted','reopened')),
  CONSTRAINT sil_one_per_line UNIQUE (invitation_id, boq_line_id)
);

-- The exact file versions sent: the document, its storage object's version
-- and time, and a neutral name (<project code>-NN.ext) so no client name in a
-- file name reaches the supplier.
CREATE TABLE IF NOT EXISTS public.supplier_invitation_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id     uuid NOT NULL REFERENCES public.supplier_invitations(id) ON DELETE RESTRICT,
  document_id       uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  display_name      text NOT NULL,
  storage_bucket    text NOT NULL,
  storage_path      text NOT NULL,
  mime_type         text,
  size_bytes        bigint,
  checksum          text,
  object_version    text,
  object_updated_at timestamptz NOT NULL,
  CONSTRAINT sif_one_per_document UNIQUE (invitation_id, document_id)
);

ALTER TABLE public.supplier_invitations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invitation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invitation_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_invitations, public.supplier_invitation_lines, public.supplier_invitation_files FROM anon, authenticated;
GRANT SELECT ON public.supplier_invitations, public.supplier_invitation_lines, public.supplier_invitation_files TO authenticated;
GRANT ALL ON public.supplier_invitations, public.supplier_invitation_lines, public.supplier_invitation_files TO service_role;

CREATE POLICY "Supplier invitations readable by pricers and cost readers" ON public.supplier_invitations
  FOR SELECT TO authenticated USING (public.is_pricer(auth.uid()) OR public.can_read_commercial_cost(auth.uid()));
CREATE POLICY "Supplier invitation lines readable by pricers and cost readers" ON public.supplier_invitation_lines
  FOR SELECT TO authenticated USING (public.is_pricer(auth.uid()) OR public.can_read_commercial_cost(auth.uid()));
CREATE POLICY "Supplier invitation files readable by pricers and cost readers" ON public.supplier_invitation_files
  FOR SELECT TO authenticated USING (public.is_pricer(auth.uid()) OR public.can_read_commercial_cost(auth.uid()));
CREATE POLICY audit_session_boundary ON public.supplier_invitations AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
CREATE POLICY audit_session_boundary ON public.supplier_invitation_lines AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
CREATE POLICY audit_session_boundary ON public.supplier_invitation_files AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- Riyadh's date: reply-by dates are business days in Saudi Arabia, not UTC.
CREATE OR REPLACE FUNCTION public._pricing_today()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date; $$;

CREATE OR REPLACE FUNCTION public.pricing_send_to_supplier(_file_id uuid, _vendor_id uuid, _reply_by date,
  _document_ids uuid[], _instructions text DEFAULT NULL, _replace_earlier boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; inv public.supplier_invitations; code text;
        today date := public._pricing_today(); others integer; selected integer; n_lines integer;
        d record; ext text; ins text := nullif(btrim(coalesce(_instructions, '')), '');
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance send a file to the supplier. | إرسال الملف للمورد للتقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _file_id IS NULL OR _vendor_id IS NULL OR _reply_by IS NULL THEN
    RAISE EXCEPTION 'Choose the supplier and the reply-by date. | اختر المورد وموعد الرد.' USING ERRCODE = '23514';
  END IF;
  IF _reply_by < today OR _reply_by > today + 180 THEN
    RAISE EXCEPTION 'The reply-by date is from today and within 180 days. | موعد الرد من اليوم وخلال 180 يوماً.' USING ERRCODE = '23514';
  END IF;
  IF _document_ids IS NULL OR cardinality(_document_ids) = 0 OR cardinality(_document_ids) > 50
     OR (SELECT count(DISTINCT x) FROM unnest(_document_ids) x) <> cardinality(_document_ids) THEN
    RAISE EXCEPTION 'Choose the files to send (1 to 50, each once). | اختر الملفات المرسلة (من 1 إلى 50، كل ملف مرة).' USING ERRCODE = '23514';
  END IF;
  IF char_length(coalesce(ins, '')) > 1000 THEN
    RAISE EXCEPTION 'The note to the supplier is up to 1000 characters. | الملاحظة للمورد حتى 1000 حرف.' USING ERRCODE = '23514';
  END IF;

  -- Lock order: the file's price, then the file. A file at boq_frozen or
  -- at_supplier has no price under review, so the file lock is the first.
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state NOT IN ('boq_frozen','at_supplier') THEN
    RAISE EXCEPTION 'A file goes to the supplier once its BOQ is frozen. | يُرسل الملف للمورد بعد تجميد الكميات.' USING ERRCODE = 'P0001';
  END IF;
  IF f.boq_revision_id IS NULL OR NOT public.boq_revision_is_frozen(f.boq_revision_id) THEN
    RAISE EXCEPTION 'The file has no frozen BOQ revision. | لا توجد مراجعة كميات مجمّدة للملف.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_invitations i
              WHERE i.file_id = f.id AND i.status IN ('sent','opened','reopened')) THEN
    RAISE EXCEPTION 'This file already has an open supplier request; cancel it first. | لهذا الملف طلب مفتوح لدى مورد؛ ألغه أولاً.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = _vendor_id) THEN
    RAISE EXCEPTION 'Unknown supplier. | المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.boq_lines l WHERE l.revision_id = f.boq_revision_id) THEN
    RAISE EXCEPTION 'The BOQ has no lines to price. | لا بنود في الكميات للتسعير.' USING ERRCODE = 'P0001';
  END IF;
  -- Each file: a live document attached to this deal or its RFQ, its bytes in storage.
  IF EXISTS (SELECT 1 FROM unnest(_document_ids) x
              WHERE NOT EXISTS (
                SELECT 1 FROM public.documents dd
                  JOIN public.document_links l ON l.document_id = dd.id AND l.unlinked_at IS NULL
                 WHERE dd.id = x AND dd.deleted_at IS NULL
                   AND ((l.entity_type = 'opportunity' AND l.entity_id = f.opportunity_id)
                     OR (l.entity_type = 'rfq' AND f.rfq_id IS NOT NULL AND l.entity_id = f.rfq_id)))) THEN
    RAISE EXCEPTION 'A file is not attached to this deal. | أحد الملفات ليس مرفقاً بهذه الفرصة.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_document_ids) x JOIN public.documents dd ON dd.id = x
              WHERE NOT EXISTS (SELECT 1 FROM storage.objects o
                                 WHERE o.bucket_id = dd.storage_bucket AND o.name = dd.storage_path)) THEN
    RAISE EXCEPTION 'A file is missing from storage; upload it again. | أحد الملفات غير موجود في التخزين؛ ارفعه مجدداً.' USING ERRCODE = '23514';
  END IF;
  SELECT o.project_code INTO code FROM public.opportunities o WHERE o.id = f.opportunity_id;
  IF code IS NULL THEN
    RAISE EXCEPTION 'The deal has no project code; the supplier sees the project code only. | لا رمز مشروع للفرصة؛ المورد يرى رمز المشروع فقط.' USING ERRCODE = 'P0001';
  END IF;

  -- Earlier supplier prices on this revision (Phase 7B, before the freeze).
  SELECT count(*) INTO others FROM public.supplier_quotes q
   WHERE q.boq_revision_id = f.boq_revision_id AND q.vendor_id <> _vendor_id
     AND q.is_current AND q.status NOT IN ('cancelled','superseded');
  SELECT count(*) INTO selected FROM public.supplier_quote_lines l
    JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
   WHERE q.boq_revision_id = f.boq_revision_id AND l.is_selected;
  IF (others > 0 OR selected > 0) AND NOT coalesce(_replace_earlier, false) THEN
    RAISE EXCEPTION 'This BOQ already has supplier prices from before the freeze (another supplier''s quote or a selection). Confirm to cancel them for this file. | لهذه الكميات أسعار مورد من قبل التجميد (عرض مورد آخر أو اختيار). أكّد لإلغائها لهذا الملف.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Move first: PR 2's entry exception below needs the file at the supplier.
  IF f.state = 'boq_frozen' THEN
    f := public._pricing_file_apply(f, 'at_supplier', u, NULL);
  END IF;
  IF others > 0 OR selected > 0 THEN
    PERFORM set_config('phc.pricing_supplier_entry', f.boq_revision_id::text, true);
    UPDATE public.supplier_quote_lines l SET is_selected = false, selected_by = NULL, selected_at = NULL
      FROM public.supplier_quotes q
     WHERE q.id = l.supplier_quote_id AND q.boq_revision_id = f.boq_revision_id AND l.is_selected;
    UPDATE public.supplier_quotes q
       SET status = 'cancelled', cancel_reason = 'Another supplier was chosen for this pricing file'
     WHERE q.boq_revision_id = f.boq_revision_id AND q.vendor_id <> _vendor_id
       AND q.is_current AND q.status NOT IN ('cancelled','superseded');
    PERFORM set_config('phc.pricing_supplier_entry', '', true);
  END IF;

  INSERT INTO public.supplier_invitations (file_id, boq_revision_id, vendor_id, project_code, reply_by, instructions, sent_by)
  VALUES (f.id, f.boq_revision_id, _vendor_id, code, _reply_by, ins, u)
  RETURNING * INTO inv;
  INSERT INTO public.supplier_invitation_lines (invitation_id, boq_line_id)
  SELECT inv.id, l.id FROM public.boq_lines l WHERE l.revision_id = f.boq_revision_id;
  GET DIAGNOSTICS n_lines = ROW_COUNT;
  FOR d IN
    SELECT dd.id, dd.original_filename, dd.storage_bucket, dd.storage_path, dd.mime_type, dd.size_bytes, dd.checksum,
           o.version AS object_version, o.updated_at AS object_updated_at, x.ord
      FROM unnest(_document_ids) WITH ORDINALITY AS x(id, ord)
      JOIN public.documents dd ON dd.id = x.id
      JOIN storage.objects o ON o.bucket_id = dd.storage_bucket AND o.name = dd.storage_path
     ORDER BY x.ord
  LOOP
    ext := lower(substring(d.original_filename from '\.([A-Za-z0-9]{1,8})$'));
    INSERT INTO public.supplier_invitation_files (invitation_id, document_id, display_name, storage_bucket, storage_path,
                                                  mime_type, size_bytes, checksum, object_version, object_updated_at)
    VALUES (inv.id, d.id, code || '-' || lpad(d.ord::text, 2, '0') || coalesce('.' || ext, ''),
            d.storage_bucket, d.storage_path, d.mime_type, d.size_bytes, d.checksum, d.object_version,
            coalesce(d.object_updated_at, now()));
  END LOOP;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.sent_to_supplier', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'invitation_id', inv.id, 'vendor_id', _vendor_id, 'reply_by', _reply_by,
                             'lines', n_lines, 'files', cardinality(_document_ids),
                             'cancelled_quotes', others, 'cleared_selections', selected));
  RETURN jsonb_build_object('invitation_id', inv.id, 'lines', n_lines, 'files', cardinality(_document_ids));
END $$;
REVOKE ALL ON FUNCTION public.pricing_send_to_supplier(uuid, uuid, date, uuid[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_send_to_supplier(uuid, uuid, date, uuid[], text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_cancel_invitation(_invitation_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); inv public.supplier_invitations; fid uuid; opp uuid; r text := btrim(coalesce(_reason, ''));
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance cancel a supplier request. | إلغاء طلب المورد للتقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF char_length(r) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Give a reason (up to 500 characters). | اذكر السبب (حتى 500 حرف).' USING ERRCODE = '23514';
  END IF;
  SELECT i.file_id INTO fid FROM public.supplier_invitations i WHERE i.id = _invitation_id;
  IF fid IS NULL THEN
    RAISE EXCEPTION 'Unknown supplier request. | طلب المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  -- Lock order: the file, then its request.
  SELECT f.opportunity_id INTO opp FROM public.pricing_files f WHERE f.id = fid FOR UPDATE;
  SELECT * INTO inv FROM public.supplier_invitations WHERE id = _invitation_id FOR UPDATE;
  IF inv.status NOT IN ('sent','opened','reopened') THEN
    RAISE EXCEPTION 'Only an open request can be cancelled. | يُلغى الطلب المفتوح فقط.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.supplier_invitations
     SET status = 'cancelled', cancelled_by = u, cancelled_at = now(), cancel_reason = r, updated_at = now()
   WHERE id = inv.id RETURNING * INTO inv;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.supplier_request_cancelled', 'opportunity', opp,
          jsonb_build_object('file_id', fid, 'invitation_id', inv.id));
  RETURN jsonb_build_object('invitation_id', inv.id, 'status', inv.status);
END $$;
REVOKE ALL ON FUNCTION public.pricing_cancel_invitation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_cancel_invitation(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_extend_invitation(_invitation_id uuid, _reply_by date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); inv public.supplier_invitations; fid uuid; opp uuid; today date := public._pricing_today();
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance change the reply-by date. | تغيير موعد الرد للتقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _reply_by IS NULL OR _reply_by < today OR _reply_by > today + 180 THEN
    RAISE EXCEPTION 'The reply-by date is from today and within 180 days. | موعد الرد من اليوم وخلال 180 يوماً.' USING ERRCODE = '23514';
  END IF;
  SELECT i.file_id INTO fid FROM public.supplier_invitations i WHERE i.id = _invitation_id;
  IF fid IS NULL THEN
    RAISE EXCEPTION 'Unknown supplier request. | طلب المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  SELECT f.opportunity_id INTO opp FROM public.pricing_files f WHERE f.id = fid FOR UPDATE;
  SELECT * INTO inv FROM public.supplier_invitations WHERE id = _invitation_id FOR UPDATE;
  IF inv.status NOT IN ('sent','opened','reopened') THEN
    RAISE EXCEPTION 'Only an open request has a reply-by date to change. | يتغير موعد الرد للطلب المفتوح فقط.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.supplier_invitations SET reply_by = _reply_by, updated_at = now() WHERE id = inv.id RETURNING * INTO inv;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.supplier_reply_by_changed', 'opportunity', opp,
          jsonb_build_object('file_id', fid, 'invitation_id', inv.id, 'reply_by', _reply_by));
  RETURN jsonb_build_object('invitation_id', inv.id, 'reply_by', inv.reply_by);
END $$;
REVOKE ALL ON FUNCTION public.pricing_extend_invitation(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_extend_invitation(uuid, date) TO authenticated;
```

- [ ] **Step 4: Run the DB tests**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_invitations.test.sql .. ok` (39 tests); every other file still ok.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261108120000_supplier_invitations.sql supabase/tests/supplier_invitations.test.sql
git commit -m "feat(pricing): send a frozen file to one supplier with the exact file versions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: What the supplier reads in the portal (SQL)

**Files:**
- Create: `supabase/migrations/20261108130000_supplier_portal_read.sql`
- Test: `supabase/tests/supplier_portal_read.test.sql`

> **Note from Task 2:** an invitation is not closed when its file moves past `at_supplier` or closes, so every portal read (`supplier_portal_invitations`, `supplier_portal_invitation`, `_supplier_invitation_for_session`, `supplier_portal_file`) must also require the file's state to be `at_supplier` (otherwise a supplier keeps reading a finished file). The re-check in `supplier_portal_file` compares the storage object's `version` and `updated_at` with what was sent; `supplier_invitation_files.checksum` is the storage ETag read at send time and is informational (shown in the confirmation snapshot), not compared.

**Interfaces:**
- Consumes: Task 1 `public._supplier_session_vendor()`; Task 2 tables and `pricing_send_to_supplier` (the test sends through it); 7B `supplier_quotes`, `supplier_quote_lines`.
- Produces:
  - `public._supplier_invitation_for_session(_invitation_id uuid) → supplier_invitations` (internal; 42501 "This request is not available." for another vendor's, a cancelled or an unknown request).
  - `public._supplier_invitation_editable(supplier_invitations) → boolean`, `public._supplier_portal_status(supplier_invitations) → text` ∈ `open|returned|submitted|closed` (internal).
  - `public.supplier_portal_invitations() → TABLE(invitation_id uuid, project_code text, reply_by date, status text, sent_at timestamptz, submitted_at timestamptz, lines integer, open_lines integer)`.
  - `public.supplier_portal_invitation(_invitation_id uuid) → jsonb` with keys `invitation_id, project_code, reply_by, sent_at, instructions, return_message, status, editable, terms{lead_time_days, payment_terms, valid_until}, lines[{line_id, line_number, sign_type, description, dimensions, material, mounting, illumination, finish, quantity, unit, width_mm, height_mm, has_screen, state, editable, unit_cost, unit_cost_with_screen, spec_difference}], files[{file_id, name, size_bytes, mime_type}]`. Marks an open `sent` request `opened`.
  - `public.supplier_portal_file(_invitation_id uuid, _file_id uuid) → jsonb {"bucket","path","name"}` (only the exact version sent; audited `supplier_portal.file_downloaded`).

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/supplier_portal_read.test.sql`:

```sql
-- PR 3 Task 3: what a supplier reads in the portal, and the file it may download.
-- Test user UUIDs use the 8c prefix. Sessions carry aal2 unless they say otherwise.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8c000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'pr-rep'),(2,'pr-pricer'),(3,'pr-gm'),(4,'pr-supplier-a'),(5,'pr-supplier-b')) v(n, r);
update public.profiles set status = 'active' where id::text like '8c000000-%';
insert into public.user_roles (user_id, role) values
  ('8c000000-0000-0000-0000-000000000001','salesperson'),
  ('8c000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8c000000-0000-0000-0000-000000000002','finance_manager'),
  ('8c000000-0000-0000-0000-000000000003','general_manager');
insert into public.vendors (id, name) values
  ('8c100001-0000-0000-0000-000000000001','pr-vendor-a'),
  ('8c100002-0000-0000-0000-000000000001','pr-vendor-b');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8c100001-0000-0000-0000-000000000001' where id = '8c000000-0000-0000-0000-000000000004';
update public.profiles set vendor_id = '8c100002-0000-0000-0000-000000000001' where id = '8c000000-0000-0000-0000-000000000005';
insert into public.user_roles (user_id, role) values
  ('8c000000-0000-0000-0000-000000000004','supplier'), ('8c000000-0000-0000-0000-000000000005','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8c20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pr-deal-secret-' || n,
       '8c000000-0000-0000-0000-000000000001','8c000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8c40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8c20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pr-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8c50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8c40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, description, quantity, unit, location, has_screen) values
  ('8c510001-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001',1,'Pylon P1','Double-sided pylon',2,'pcs','pr-site-secret',true),
  ('8c510002-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001',2,'Wall W1','Channel letters',4,'pcs',null,false),
  ('8c510003-0000-0000-0000-000000000001','8c500002-0000-0000-0000-000000000001',1,'Ceiling C1','Hanging sign',1,'pcs',null,false);
-- Vendor A's own quote from before the freeze: its prices show in its portal.
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, lead_time_days) values
  ('8c800001-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001','8c100001-0000-0000-0000-000000000001','SAR',21);
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost) values
  ('8c800001-0000-0000-0000-000000000001','8c510001-0000-0000-0000-000000000001',2,100);
update public.boq_revisions set frozen_at = now(), frozen_by = '8c000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('8c500001-0000-0000-0000-000000000001','8c500002-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8c600001-0000-0000-0000-000000000001','8c200001-0000-0000-0000-000000000001','boq_frozen','8c500001-0000-0000-0000-000000000001'),
  ('8c600002-0000-0000-0000-000000000001','8c200002-0000-0000-0000-000000000001','boq_frozen','8c500002-0000-0000-0000-000000000001');
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by) values
  ('8c700001-0000-0000-0000-000000000001','attachments','opportunity/8c1/a.pdf','pr-deal-secret-1 drawings.pdf','application/pdf',1000,repeat('a',64),'drawing','8c000000-0000-0000-0000-000000000001'),
  ('8c700002-0000-0000-0000-000000000001','attachments','opportunity/8c2/b.pdf','b.pdf','application/pdf',1000,repeat('b',64),'drawing','8c000000-0000-0000-0000-000000000001');
insert into public.document_links (document_id, entity_type, entity_id, linked_by) values
  ('8c700001-0000-0000-0000-000000000001','opportunity','8c200001-0000-0000-0000-000000000001','8c000000-0000-0000-0000-000000000001'),
  ('8c700002-0000-0000-0000-000000000001','opportunity','8c200002-0000-0000-0000-000000000001','8c000000-0000-0000-0000-000000000001');
insert into storage.objects (bucket_id, name, owner, version) values
  ('attachments','opportunity/8c1/a.pdf','8c000000-0000-0000-0000-000000000001','v1'),
  ('attachments','opportunity/8c2/b.pdf','8c000000-0000-0000-0000-000000000001','v1');

-- The pricer sends file 1 to vendor A and file 2 to vendor B.
create temp table pr_inv (k text, id uuid);
grant all on pr_inv to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into pr_inv select 'a', (public.pricing_send_to_supplier('8c600001-0000-0000-0000-000000000001','8c100001-0000-0000-0000-000000000001',
  current_date + 7, array['8c700001-0000-0000-0000-000000000001']::uuid[], 'Two prices for the pylon, please.')->>'invitation_id')::uuid;
insert into pr_inv select 'b', (public.pricing_send_to_supplier('8c600002-0000-0000-0000-000000000001','8c100002-0000-0000-0000-000000000001',
  current_date + 7, array['8c700002-0000-0000-0000-000000000001']::uuid[])->>'invitation_id')::uuid;
select throws_ok($$select * from public.supplier_portal_invitations()$$, '42501', null, 'Staff do not use the portal functions');
-- What the supplier sessions below cannot read themselves.
reset role;
create temp table pr_ref (k text, v text);
grant all on pr_ref to authenticated;
insert into pr_ref
  select 'code', project_code from public.opportunities where id = '8c200001-0000-0000-0000-000000000001'
  union all select 'file_a', f.id::text from public.supplier_invitation_files f where f.document_id = '8c700001-0000-0000-0000-000000000001'
  union all select 'file_b', f.id::text from public.supplier_invitation_files f where f.document_id = '8c700002-0000-0000-0000-000000000001';
set local role authenticated;

select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select * from public.supplier_portal_invitations()$$, '42501', null, 'Without two-step verification a supplier reads nothing');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_portal_invitations()), 1, 'Supplier A lists its one request');
select is((select project_code || '/' || status || '/' || lines || '/' || open_lines from public.supplier_portal_invitations()),
  (select v from pr_ref where k = 'code') || '/open/2/2',
  'The list shows the project code, the status and the open lines');
select is((select count(*)::int from public.supplier_portal_invitations() where invitation_id = (select id from pr_inv where k = 'b')), 0,
  'Supplier A does not list vendor B''s request');

create temp table pr_doc (j jsonb);
grant all on pr_doc to authenticated;
insert into pr_doc select public.supplier_portal_invitation((select id from pr_inv where k = 'a'));
select is((select j->>'status' || '/' || (j->>'editable') from pr_doc), 'open/true', 'The request is open and takes prices');
select is((select jsonb_array_length(j->'lines') from pr_doc), 2, 'It carries both lines');
select is((select j->'lines'->0->>'sign_type' || '/' || (j->'lines'->0->>'quantity') || '/' || (j->'lines'->0->>'has_screen') from pr_doc),
  'Pylon P1/2.000/true', 'A line shows its sign type, quantity and screen');
select is((select (j->'lines'->0->>'unit_cost')::numeric from pr_doc), 100.00::numeric, 'The supplier sees its own earlier price');
select is((select (j->'terms'->>'lead_time_days')::int from pr_doc), 21, 'And its own earlier lead time');
select ok((select not (j->'lines'->0 ? 'location') and not (j->'lines'->0 ? 'boq_line_id') from pr_doc),
  'A line carries no site and no internal BOQ id');
select is((select strpos(j::text, 'pr-deal-secret') + strpos(j::text, 'pr-site-secret') + strpos(j::text, '8c510001') + strpos(j::text, '8c200001') from pr_doc), 0,
  'No deal name, site, BOQ line id or deal id reaches the supplier');
select is((select j->'files'->0->>'name' from pr_doc),
  (select v from pr_ref where k = 'code') || '-01.pdf',
  'The file is listed under its neutral name');
select is((select j->>'instructions' from pr_doc), 'Two prices for the pylon, please.', 'The pricer''s note is shown');
reset role;
select is((select status || '/' || (opened_at is not null)::text from public.supplier_invitations where id = (select id from pr_inv where k = 'a')),
  'opened/true', 'Reading the request marks it opened');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_invitation('%s')$$, (select id from pr_inv where k = 'b')),
  '42501', null, 'Supplier A cannot open vendor B''s request');
select throws_ok($$select public.supplier_portal_invitation('8c90000f-0000-0000-0000-000000000001')$$,
  '42501', null, 'An unknown request answers the same as another supplier''s');

-- Files: only the version sent, only one's own.
select is((public.supplier_portal_file((select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')))->>'path',
  'opportunity/8c1/a.pdf', 'The supplier gets its file''s location for a signed link');
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_b')),
  '42501', null, 'Another request''s file is refused');
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'b'),
  (select v::uuid from pr_ref where k = 'file_b')),
  '42501', null, 'Another supplier''s file is refused');
select is((select count(*)::int from storage.objects), 0, 'The supplier has no storage access of its own');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'supplier_portal.file_downloaded'
  and actor_id = '8c000000-0000-0000-0000-000000000004'), 'A download is audited');
update storage.objects set version = 'v2' where name = 'opportunity/8c1/a.pdf';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')),
  'P0001', null, 'A file overwritten after it was sent is refused');
reset role;
update storage.objects set version = 'v1' where name = 'opportunity/8c1/a.pdf';
update public.documents set deleted_at = now(), deleted_by = '8c000000-0000-0000-0000-000000000001' where id = '8c700001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')),
  'P0001', null, 'A file deleted after it was sent is refused');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')),
  '42501', null, 'Staff do not download through the supplier path');

-- When the file leaves the supplier, or the request is cancelled.
reset role;
update public.pricing_files set state = 'supplier_priced' where id = '8c600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select status from public.supplier_portal_invitations()), 'closed', 'A request whose file moved on is closed');
select is((public.supplier_portal_invitation((select id from pr_inv where k = 'a')))->>'editable', 'false', 'And takes no prices');
select is((select open_lines from public.supplier_portal_invitations()), 0, 'A closed request has no open lines');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok(format($$select public.pricing_cancel_invitation('%s', 'Sent by mistake')$$, (select id from pr_inv where k = 'b')),
  'The pricer cancels vendor B''s request');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_portal_invitations()), 0, 'A cancelled request disappears from the supplier''s list');
select throws_ok(format($$select public.supplier_portal_invitation('%s')$$, (select id from pr_inv where k = 'b')),
  '42501', null, 'And cannot be opened');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to see it fail**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_portal_read.test.sql` fails (function `public.supplier_portal_invitations` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261108130000_supplier_portal_read.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 3, part 3: what a supplier reads in the portal.
--
-- A supplier has no table access (has_app_access is false for it). It reads
-- through these SECURITY DEFINER functions only, each of which starts from
-- _supplier_session_vendor() (active supplier, linked vendor, MFA). What they
-- return is the spec's list: project code, reply-by, lines (quantity, size,
-- specs), the files sent, and the supplier's OWN prices. Never the client, the
-- deal, the site (boq_lines.location), PHC's cost or selling price, another
-- supplier, or an internal id other than the request's own.
-- =============================================================================

-- The caller's request, or 42501 with the same message for "not yours" and "unknown".
CREATE OR REPLACE FUNCTION public._supplier_invitation_for_session(_invitation_id uuid)
RETURNS public.supplier_invitations LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid := public._supplier_session_vendor(); inv public.supplier_invitations;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'Sign in to the supplier portal with two-step verification. | سجّل الدخول لبوابة المورد بالتحقق بخطوتين.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO inv FROM public.supplier_invitations i
   WHERE i.id = _invitation_id AND i.vendor_id = v AND i.status <> 'cancelled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This request is not available. | هذا الطلب غير متاح.' USING ERRCODE = '42501';
  END IF;
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public._supplier_invitation_for_session(uuid) FROM PUBLIC, anon, authenticated;

-- A request takes prices while it is open and its file is at the supplier on the same revision.
CREATE OR REPLACE FUNCTION public._supplier_invitation_editable(_inv public.supplier_invitations)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _inv.status IN ('sent','opened','reopened') AND EXISTS (
    SELECT 1 FROM public.pricing_files f
     WHERE f.id = _inv.file_id AND f.state = 'at_supplier' AND f.boq_revision_id = _inv.boq_revision_id);
$$;
REVOKE ALL ON FUNCTION public._supplier_invitation_editable(public.supplier_invitations) FROM PUBLIC, anon, authenticated;

-- What the supplier sees as the request's status: open, returned (lines came back), submitted, closed.
CREATE OR REPLACE FUNCTION public._supplier_portal_status(_inv public.supplier_invitations)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _inv.status = 'submitted' THEN 'submitted'
              WHEN public._supplier_invitation_editable(_inv) THEN
                   CASE WHEN _inv.status = 'reopened' THEN 'returned' ELSE 'open' END
              ELSE 'closed' END;
$$;
REVOKE ALL ON FUNCTION public._supplier_portal_status(public.supplier_invitations) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.supplier_portal_invitations()
RETURNS TABLE (invitation_id uuid, project_code text, reply_by date, status text, sent_at timestamptz,
               submitted_at timestamptz, lines integer, open_lines integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v uuid := public._supplier_session_vendor();
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'Sign in to the supplier portal with two-step verification. | سجّل الدخول لبوابة المورد بالتحقق بخطوتين.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT i.id, i.project_code, i.reply_by, public._supplier_portal_status(i), i.sent_at, i.submitted_at,
           (SELECT count(*)::int FROM public.supplier_invitation_lines l WHERE l.invitation_id = i.id),
           (SELECT count(*)::int FROM public.supplier_invitation_lines l
             WHERE l.invitation_id = i.id AND l.state IN ('open','reopened')
               AND public._supplier_invitation_editable(i))
      FROM public.supplier_invitations i
     WHERE i.vendor_id = v AND i.status <> 'cancelled'
     ORDER BY (public._supplier_portal_status(i) IN ('open','returned')) DESC, i.reply_by, i.sent_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.supplier_portal_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_portal_invitations() TO authenticated;

-- One request with its lines, files and the supplier's own current prices.
-- The first read of an open request marks it opened (Zayed sees "opened").
CREATE OR REPLACE FUNCTION public.supplier_portal_invitation(_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.supplier_invitations := public._supplier_invitation_for_session(_invitation_id);
        ed boolean; q public.supplier_quotes;
BEGIN
  ed := public._supplier_invitation_editable(inv);
  IF inv.status = 'sent' AND ed THEN
    UPDATE public.supplier_invitations SET status = 'opened', opened_at = now(), updated_at = now()
     WHERE id = inv.id RETURNING * INTO inv;
  END IF;
  -- The supplier's own live quote on this revision (theirs, whoever typed it).
  SELECT * INTO q FROM public.supplier_quotes sq
   WHERE sq.boq_revision_id = inv.boq_revision_id AND sq.vendor_id = inv.vendor_id
     AND sq.is_current AND sq.status NOT IN ('cancelled','superseded');
  RETURN jsonb_build_object(
    'invitation_id', inv.id,
    'project_code', inv.project_code,
    'reply_by', inv.reply_by,
    'sent_at', inv.sent_at,
    'instructions', inv.instructions,
    'return_message', CASE WHEN inv.status = 'reopened' THEN inv.return_message END,
    'status', public._supplier_portal_status(inv),
    'editable', ed,
    'terms', jsonb_build_object('lead_time_days', q.lead_time_days, 'payment_terms', q.payment_terms,
                                'valid_until', q.valid_until),
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'line_id', il.id, 'line_number', bl.line_number, 'sign_type', bl.sign_type,
               'description', bl.description, 'dimensions', bl.dimensions, 'material', bl.material,
               'mounting', bl.mounting, 'illumination', bl.illumination, 'finish', bl.finish,
               'quantity', bl.quantity, 'unit', bl.unit, 'width_mm', bl.width_mm, 'height_mm', bl.height_mm,
               'has_screen', bl.has_screen, 'state', il.state,
               'editable', ed AND il.state IN ('open','reopened'),
               'unit_cost', ql.unit_cost, 'unit_cost_with_screen', ql.unit_cost_with_screen,
               'spec_difference', ql.alternate_spec)
             ORDER BY bl.line_number NULLS LAST, bl.sort_order NULLS LAST, il.id)
        FROM public.supplier_invitation_lines il
        JOIN public.boq_lines bl ON bl.id = il.boq_line_id
        LEFT JOIN public.supplier_quote_lines ql ON ql.supplier_quote_id = q.id AND ql.boq_line_id = il.boq_line_id
       WHERE il.invitation_id = inv.id), '[]'::jsonb),
    'files', coalesce((
      SELECT jsonb_agg(jsonb_build_object('file_id', sf.id, 'name', sf.display_name, 'size_bytes', sf.size_bytes,
                                          'mime_type', sf.mime_type) ORDER BY sf.display_name)
        FROM public.supplier_invitation_files sf WHERE sf.invitation_id = inv.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.supplier_portal_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_portal_invitation(uuid) TO authenticated;

-- Where a sent file's bytes are, for sales-os-api to sign a short download link
-- (the supplier has no storage access of its own). Only the exact version sent:
-- a document deleted since, or a storage object overwritten since, is refused.
CREATE OR REPLACE FUNCTION public.supplier_portal_file(_invitation_id uuid, _file_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.supplier_invitations := public._supplier_invitation_for_session(_invitation_id);
        sf public.supplier_invitation_files; opp uuid;
BEGIN
  SELECT * INTO sf FROM public.supplier_invitation_files f WHERE f.id = _file_id AND f.invitation_id = inv.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This request is not available. | هذا الطلب غير متاح.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = sf.document_id AND d.deleted_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM storage.objects o
                     WHERE o.bucket_id = sf.storage_bucket AND o.name = sf.storage_path
                       AND coalesce(o.version, '') = coalesce(sf.object_version, '')
                       AND o.updated_at = sf.object_updated_at) THEN
    RAISE EXCEPTION 'This file changed or was removed after it was sent; ask PHC to send the request again. | تغيّر هذا الملف أو حُذف بعد إرساله؛ اطلب من PHC إعادة إرسال الطلب.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT f.opportunity_id INTO opp FROM public.pricing_files f WHERE f.id = inv.file_id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (auth.uid(), 'user', 'supplier_portal.file_downloaded', 'opportunity', opp,
          jsonb_build_object('invitation_id', inv.id, 'file_id', sf.id, 'document_id', sf.document_id));
  RETURN jsonb_build_object('bucket', sf.storage_bucket, 'path', sf.storage_path, 'name', sf.display_name);
END $$;
REVOKE ALL ON FUNCTION public.supplier_portal_file(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_portal_file(uuid, uuid) TO authenticated;
```

- [ ] **Step 4: Run the DB tests**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_portal_read.test.sql .. ok` (31 tests); every other file still ok.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261108130000_supplier_portal_read.sql supabase/tests/supplier_portal_read.test.sql
git commit -m "feat(pricing): supplier portal reads its own requests, lines and files only" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The supplier submits; entry on behalf follows the request (SQL)

**Files:**
- Create: `supabase/migrations/20261108140000_supplier_portal_submit.sql`
- Test: `supabase/tests/supplier_portal_submit.test.sql`

> **Note from Task 2:** Task 2 must not ship without this task. Until `pricing_enter_supplier_quote` follows the open request, a pricer can enter prices on behalf of another vendor while an invitation to a different vendor is open (Task 2 only blocks it at send time). Task 4 must refuse on-behalf entry for any vendor other than the open invitation's, and the submit RPC must refuse when the file is no longer `at_supplier`.

**Interfaces:**
- Consumes: Tasks 1–3; PR 2 `public._pricing_supplier_num_ok(text, integer, integer)` (internal), the 7B guards and entry flag, `pricing_selling_grid` / `pricing_selling_totals` (the test reads them), PR 1 `pricing_file_move`; `public.emit_notification_to_roles(app_role[], text, text, uuid, text, text, text, text, text, jsonb)`.
- Produces:
  - Columns `public.supplier_quotes.source text` ∈ `internal|portal|on_behalf` (default `internal`) and `source_document_id uuid` (FK `documents`).
  - Table `public.supplier_invitation_submissions(id, invitation_id, supplier_quote_id, source ∈ portal|on_behalf, submitted_by, submitted_at, confirmation_text, confirmation_lang ∈ en|ar, confirmed_files jsonb, lines)`. Readable by pricers and cost readers.
  - `public.supplier_portal_confirmation(_lang text) → text` (`en`/`ar`; the spec's sentence; NULL otherwise).
  - `public.supplier_portal_submit(_invitation_id uuid, _lines jsonb, _terms jsonb, _confirm_lang text) → jsonb {"supplier_quote_id","lines"}`. `_lines`: `[{"line_id": <supplier_invitation_lines.id>, "unit_cost": num|string|null, "unit_cost_with_screen": …, "spec_difference": text|null}]`, exactly the open lines. `_terms`: `{"lead_time_days": int, "payment_terms": text, "valid_until": "YYYY-MM-DD"}`, all required.
  - Notification type `pricing_supplier_submitted` (entity `opportunity`, metadata `{"pricing_file_id"}`).
  - `public.pricing_enter_supplier_quote(_file_id uuid, _vendor_id uuid, _lines jsonb, _terms jsonb DEFAULT '{}', _document_id uuid DEFAULT NULL) → jsonb` (the 4-argument version is dropped; positional 4-argument calls still resolve).

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/supplier_portal_submit.test.sql`:

```sql
-- PR 3 Task 4: the supplier submits, the quote locks, entry on behalf follows the request.
-- Test user UUIDs use the 8d prefix. Sessions carry aal2 unless they say otherwise.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8d000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'ps-rep'),(2,'ps-pricer'),(3,'ps-gm'),(4,'ps-supplier-a'),(5,'ps-supplier-b')) v(n, r);
update public.profiles set status = 'active' where id::text like '8d000000-%';
insert into public.user_roles (user_id, role) values
  ('8d000000-0000-0000-0000-000000000001','salesperson'),
  ('8d000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8d000000-0000-0000-0000-000000000002','finance_manager'),
  ('8d000000-0000-0000-0000-000000000003','general_manager');
insert into public.vendors (id, name) values
  ('8d100001-0000-0000-0000-000000000001','ps-vendor-a'),
  ('8d100002-0000-0000-0000-000000000001','ps-vendor-b');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8d100001-0000-0000-0000-000000000001' where id = '8d000000-0000-0000-0000-000000000004';
update public.profiles set vendor_id = '8d100002-0000-0000-0000-000000000001' where id = '8d000000-0000-0000-0000-000000000005';
insert into public.user_roles (user_id, role) values
  ('8d000000-0000-0000-0000-000000000004','supplier'), ('8d000000-0000-0000-0000-000000000005','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8d20000' || n || '-0000-0000-0000-000000000001')::uuid, 'ps-deal-' || n,
       '8d000000-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8d40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8d20000' || n || '-0000-0000-0000-000000000001')::uuid, 'ps-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8d50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8d40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, has_screen) values
  ('8d510001-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001',1,'Pylon P1',2,true),
  ('8d510002-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001',2,'Wall W1',4,false),
  ('8d510003-0000-0000-0000-000000000001','8d500002-0000-0000-0000-000000000001',1,'Ceiling C1',1,false);
-- Vendor A's quote from before the freeze (it will be superseded by the portal submission).
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency) values
  ('8d800001-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001','SAR');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost) values
  ('8d800001-0000-0000-0000-000000000001','8d510002-0000-0000-0000-000000000001',4,50);
update public.boq_revisions set frozen_at = now(), frozen_by = '8d000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('8d500001-0000-0000-0000-000000000001','8d500002-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8d600001-0000-0000-0000-000000000001','8d200001-0000-0000-0000-000000000001','boq_frozen','8d500001-0000-0000-0000-000000000001'),
  ('8d600002-0000-0000-0000-000000000001','8d200002-0000-0000-0000-000000000001','boq_frozen','8d500002-0000-0000-0000-000000000001');
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by) values
  ('8d700001-0000-0000-0000-000000000001','attachments','opportunity/8d1/a.pdf','a.pdf','application/pdf',1000,repeat('a',64),'drawing','8d000000-0000-0000-0000-000000000001'),
  ('8d700002-0000-0000-0000-000000000001','attachments','opportunity/8d2/b.pdf','b.pdf','application/pdf',1000,repeat('b',64),'drawing','8d000000-0000-0000-0000-000000000001'),
  ('8d700003-0000-0000-0000-000000000001','attachments','opportunity/8d2/quote.xlsx','supplier quote.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1000,repeat('c',64),'quotation','8d000000-0000-0000-0000-000000000002');
insert into public.document_links (document_id, entity_type, entity_id, linked_by) values
  ('8d700001-0000-0000-0000-000000000001','opportunity','8d200001-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000001'),
  ('8d700002-0000-0000-0000-000000000001','opportunity','8d200002-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000001'),
  ('8d700003-0000-0000-0000-000000000001','opportunity','8d200002-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000002');
insert into storage.objects (bucket_id, name, owner, version) values
  ('attachments','opportunity/8d1/a.pdf','8d000000-0000-0000-0000-000000000001','v1'),
  ('attachments','opportunity/8d2/b.pdf','8d000000-0000-0000-0000-000000000001','v1');

create temp table ps_ref (k text, v text);
grant all on ps_ref to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into ps_ref select 'inv_a', public.pricing_send_to_supplier('8d600001-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  current_date + 7, array['8d700001-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
insert into ps_ref select 'inv_2', public.pricing_send_to_supplier('8d600002-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  current_date + 7, array['8d700002-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
reset role;
insert into ps_ref select 'line1', l.id::text from public.supplier_invitation_lines l
  where l.invitation_id = (select v::uuid from ps_ref where k = 'inv_a') and l.boq_line_id = '8d510001-0000-0000-0000-000000000001';
insert into ps_ref select 'line2', l.id::text from public.supplier_invitation_lines l
  where l.invitation_id = (select v::uuid from ps_ref where k = 'inv_a') and l.boq_line_id = '8d510002-0000-0000-0000-000000000001';
insert into ps_ref select 'line_other', l.id::text from public.supplier_invitation_lines l
  where l.invitation_id = (select v::uuid from ps_ref where k = 'inv_2');
-- The payload a correct submission sends, built once.
insert into ps_ref select 'good', jsonb_build_array(
  jsonb_build_object('line_id', (select v from ps_ref where k = 'line1'), 'unit_cost', 5000, 'unit_cost_with_screen', 6500,
                     'spec_difference', 'Aluminium face instead of acrylic'),
  jsonb_build_object('line_id', (select v from ps_ref where k = 'line2'), 'unit_cost', '700.5'))::text;
insert into ps_ref values ('terms', '{"lead_time_days":30,"payment_terms":"30% advance, 70% before shipping","valid_until":"2099-12-31"}');

select is(public.supplier_portal_confirmation('en'),
  'My prices are based only on the files attached to this request; any material or spec difference is written on its line.',
  'The English confirmation is the spec''s sentence');
select is(public.supplier_portal_confirmation('ar'),
  'أسعاري مبنية فقط على الملفات المرفقة بهذا الطلب، وأي اختلاف في الخامة أو المواصفة مكتوب على سطره.', 'The Arabic confirmation');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',true);
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  '42501', null, 'Without two-step verification a supplier cannot submit');
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  '42501', null, 'Another supplier cannot submit on this request');
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  '42501', null, 'Staff do not submit through the portal');
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'fr')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'Submitting needs the confirmation');
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '{"lead_time_days":30,"valid_until":"2099-12-31"}', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good')),
  '23514', null, 'Payment terms are required');
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '{"lead_time_days":30,"payment_terms":"x","valid_until":"2020-01-01"}', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good')),
  '23514', null, 'An offer already expired is refused');
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '{"lead_time_days":"3.5","payment_terms":"x","valid_until":"2099-12-31"}', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good')),
  '23514', null, 'A lead time in part days is refused');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s","unit_cost":5000}]', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'line1'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'Every open line must be sent, priced or empty');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s","unit_cost":5000},{"line_id":"%s","unit_cost":1}]', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'line1'), (select v from ps_ref where k = 'line_other'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'A line of another request is refused');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s","unit_cost":-5},{"line_id":"%s"}]', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'line1'), (select v from ps_ref where k = 'line2'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'A negative price is refused');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s"},{"line_id":"%s"}]', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'line1'), (select v from ps_ref where k = 'line2'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'At least one line must be priced');

select is((public.supplier_portal_submit((select v::uuid from ps_ref where k = 'inv_a'), (select v::jsonb from ps_ref where k = 'good'),
  (select v::jsonb from ps_ref where k = 'terms'), 'ar'))->>'lines', '2', 'The supplier submits both lines');
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  'P0001', null, 'A submitted request is locked');
select is((public.supplier_portal_invitation((select v::uuid from ps_ref where k = 'inv_a')))->>'status', 'submitted',
  'The supplier sees it as submitted');
select is((public.supplier_portal_invitation((select v::uuid from ps_ref where k = 'inv_a')))->'lines'->0->>'spec_difference',
  'Aluminium face instead of acrylic', 'The supplier still reads its own prices and notes');
reset role;
select is((select state::text from public.pricing_files where id = '8d600001-0000-0000-0000-000000000001'), 'supplier_priced',
  'The file goes to the GM');
select is((select actor_id from public.pricing_file_events where file_id = '8d600001-0000-0000-0000-000000000001' and to_state = 'supplier_priced'),
  '8d000000-0000-0000-0000-000000000004'::uuid, 'The supplier is the move''s actor');
select is((select string_agg(state, ',' order by state) from public.supplier_invitation_lines where invitation_id = (select v::uuid from ps_ref where k = 'inv_a')),
  'submitted,submitted', 'Both lines are locked');
select is((select source || '/' || confirmation_lang || '/' || confirmation_text || '/' || jsonb_array_length(confirmed_files)
             from public.supplier_invitation_submissions where invitation_id = (select v::uuid from ps_ref where k = 'inv_a')),
  'portal/ar/' || public.supplier_portal_confirmation('ar') || '/1', 'The confirmation is stored with its text and the file versions');
select is((select confirmed_files->0->>'object_version' from public.supplier_invitation_submissions where invitation_id = (select v::uuid from ps_ref where k = 'inv_a')),
  'v1', 'The stored files carry the exact storage version');
select is((select source || '/' || revision_number || '/' || created_by::text || '/' || payment_terms || '/' || lead_time_days
             from public.supplier_quotes where boq_revision_id = '8d500001-0000-0000-0000-000000000001' and is_current),
  'portal/2/8d000000-0000-0000-0000-000000000004/30% advance, 70% before shipping/30', 'A new quote revision, the supplier''s, with its terms');
select is((select status::text || '/' || is_current::text from public.supplier_quotes where id = '8d800001-0000-0000-0000-000000000001'),
  'superseded/false', 'The earlier quote is superseded, not overwritten');
select is((select count(*)::int from public.notifications where notification_type = 'pricing_supplier_submitted'
             and recipient_user_id in ('8d000000-0000-0000-0000-000000000002','8d000000-0000-0000-0000-000000000003')
             and metadata->>'pricing_file_id' = '8d600001-0000-0000-0000-000000000001'), 2, 'Kalas and Zayed are told the supplier has priced');
select is((select count(*)::int from public.notifications where recipient_user_id = '8d000000-0000-0000-0000-000000000001'
             and notification_type = 'pricing_supplier_submitted'), 0, 'The rep is not');
select ok(exists (select 1 from public.audit_log where action = 'supplier_portal.submitted' and actor_id = '8d000000-0000-0000-0000-000000000004'),
  'The submission is audited');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select unit_cost::text || '/' || unit_cost_with_screen::text || '/' || quotes_count from public.pricing_selling_grid
            where file_id = '8d600001-0000-0000-0000-000000000001' and boq_line_id = '8d510001-0000-0000-0000-000000000001'),
  '5000.00/6500.00/1', 'The selling grid picks the portal quote, one quote per line');
select is((select multi_quote_lines from public.pricing_selling_totals where file_id = '8d600001-0000-0000-0000-000000000001'), 0,
  'No line has two quotes');

-- Entry on behalf follows the request.
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_enter_supplier_quote('8d600002-0000-0000-0000-000000000001','8d100002-0000-0000-0000-000000000001',
  '[{"boq_line_id":"8d510003-0000-0000-0000-000000000001","unit_cost":900}]')$$, 'P0001', null,
  'Entry on behalf for a supplier other than the open request''s is refused');
select throws_ok($$select public.pricing_enter_supplier_quote('8d600002-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"8d510003-0000-0000-0000-000000000001","unit_cost":900}]', '{}', '8d700001-0000-0000-0000-000000000001')$$, '23514', null,
  'The supplier''s file must be attached to this deal');
select is((public.pricing_enter_supplier_quote('8d600002-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"8d510003-0000-0000-0000-000000000001","unit_cost":900}]', '{"lead_time_days":20}', '8d700003-0000-0000-0000-000000000001'))->>'lines', '1',
  'Zayed enters the request''s supplier''s prices with their original file');
reset role;
select is((select status from public.supplier_invitations where id = (select v::uuid from ps_ref where k = 'inv_2')), 'submitted',
  'The request closes as entered on behalf');
select is((select source || '/' || submitted_by::text || '/' || coalesce(confirmation_text, '-') from public.supplier_invitation_submissions
            where invitation_id = (select v::uuid from ps_ref where k = 'inv_2')),
  'on_behalf/8d000000-0000-0000-0000-000000000002/-', 'The submission says who entered it, with no supplier confirmation');
select is((select source || '/' || source_document_id::text from public.supplier_quotes where boq_revision_id = '8d500002-0000-0000-0000-000000000001' and is_current),
  'on_behalf/8d700003-0000-0000-0000-000000000001', 'The quote keeps the supplier''s original file');
select is((select state::text from public.pricing_files where id = '8d600002-0000-0000-0000-000000000001'), 'at_supplier',
  'Entry on behalf still leaves the move to the pricer');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((public.supplier_portal_invitation((select v::uuid from ps_ref where k = 'inv_2')))->>'editable', 'false',
  'The supplier cannot price a request PHC entered on its behalf');

-- Entry on behalf over a portal quote supersedes it: what the supplier submitted stays on record.
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_move('8d600001-0000-0000-0000-000000000001','at_supplier','Fix line 1')$$,
  'The pricer sends the file back to the supplier (the plain move)');
select lives_ok($$select public.pricing_enter_supplier_quote('8d600001-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"8d510001-0000-0000-0000-000000000001","unit_cost":4800},{"boq_line_id":"8d510002-0000-0000-0000-000000000001","unit_cost":700.5}]')$$,
  'And corrects the prices on the supplier''s behalf');
reset role;
select is((select string_agg(source || ':' || status || ':' || is_current, ',' order by revision_number)
             from public.supplier_quotes where boq_revision_id = '8d500001-0000-0000-0000-000000000001'),
  'internal:superseded:false,portal:superseded:false,on_behalf:responses_received:true',
  'The portal quote is superseded by the entry, and kept');
select is((select count(*)::int from public.supplier_quotes where boq_revision_id = '8d500001-0000-0000-0000-000000000001' and is_current
             and status not in ('cancelled','superseded')), 1, 'Still one live quote');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to see it fail**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_portal_submit.test.sql` fails (function `public.supplier_portal_confirmation` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261108140000_supplier_portal_submit.sql`. `pricing_enter_supplier_quote` is PR 2's body (20261104160000) with the parts marked `PR 3` added; everything else is unchanged so PR 2's `pricing_supplier_entry.test.sql` keeps passing.

```sql
-- =============================================================================
-- Pricing loop PR 3, part 4: the supplier submits; entry on behalf follows the request.
--
-- Submit writes a NEW supplier_quotes revision (Phase 7B's supersede pattern):
-- the vendor's previous current quote on the revision is superseded, so there
-- is always one current quote per vendor and the selling grid never counts two
-- (multi_quote_lines). Every line of the request gets a row: this round's
-- values for the open lines, the previous values for the locked ones. The
-- supplier confirms the spec's sentence; the text, the time and the exact file
-- versions are stored per submission. The request then locks, the file moves
-- at_supplier -> supplier_priced (the supplier is the actor), and Kalas and
-- Zayed are notified.
--
-- Entry on behalf (PR 2) now follows the request: it is refused for a vendor
-- other than the open request's, it closes the request as entered on behalf,
-- it keeps the supplier's original file (spec decision 4), and it supersedes a
-- portal quote instead of overwriting it, so what the supplier submitted stays
-- on record.
-- =============================================================================

ALTER TABLE public.supplier_quotes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal','portal','on_behalf')),
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.supplier_quotes.source IS
  'internal = Phase 7B (typed by estimation); portal = the supplier submitted it; on_behalf = a pricer entered the supplier''s prices (pricing_enter_supplier_quote). Rows before PR 3 stay internal.';
COMMENT ON COLUMN public.supplier_quotes.source_document_id IS
  'Entry on behalf: the supplier''s own Excel or PDF, attached to the deal.';

CREATE TABLE IF NOT EXISTS public.supplier_invitation_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id     uuid NOT NULL REFERENCES public.supplier_invitations(id) ON DELETE RESTRICT,
  supplier_quote_id uuid NOT NULL REFERENCES public.supplier_quotes(id) ON DELETE RESTRICT,
  source            text NOT NULL CHECK (source IN ('portal','on_behalf')),
  submitted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  confirmation_text text,
  confirmation_lang text CHECK (confirmation_lang IN ('en','ar')),
  confirmed_files   jsonb,
  lines             integer NOT NULL,
  CONSTRAINT sis_portal_confirmed CHECK (source <> 'portal'
    OR (confirmation_text IS NOT NULL AND confirmation_lang IS NOT NULL AND confirmed_files IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS supplier_invitation_submissions_invitation
  ON public.supplier_invitation_submissions (invitation_id, submitted_at);
ALTER TABLE public.supplier_invitation_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_invitation_submissions FROM anon, authenticated;
GRANT SELECT ON public.supplier_invitation_submissions TO authenticated;
GRANT ALL ON public.supplier_invitation_submissions TO service_role;
CREATE POLICY "Supplier submissions readable by pricers and cost readers" ON public.supplier_invitation_submissions
  FOR SELECT TO authenticated USING (public.is_pricer(auth.uid()) OR public.can_read_commercial_cost(auth.uid()));
CREATE POLICY audit_session_boundary ON public.supplier_invitation_submissions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- The sentence the supplier confirms (spec section 2). The client sends only the language.
CREATE OR REPLACE FUNCTION public.supplier_portal_confirmation(_lang text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _lang
    WHEN 'en' THEN 'My prices are based only on the files attached to this request; any material or spec difference is written on its line.'
    WHEN 'ar' THEN 'أسعاري مبنية فقط على الملفات المرفقة بهذا الطلب، وأي اختلاف في الخامة أو المواصفة مكتوب على سطره.'
  END;
$$;

CREATE OR REPLACE FUNCTION public.supplier_portal_submit(_invitation_id uuid, _lines jsonb, _terms jsonb, _confirm_lang text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); v uuid := public._supplier_session_vendor();
        inv public.supplier_invitations; f public.pricing_files; old_q public.supplier_quotes; q public.supplier_quotes;
        today date := public._pricing_today(); vday date; lead integer; pay text; bad_ord bigint;
        open_count integer; n integer; conf text; files jsonb;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'Sign in to the supplier portal with two-step verification. | سجّل الدخول لبوابة المورد بالتحقق بخطوتين.' USING ERRCODE = '42501';
  END IF;
  conf := public.supplier_portal_confirmation(_confirm_lang);
  IF conf IS NULL THEN
    RAISE EXCEPTION 'Confirm that your prices are based only on the attached files. | أكّد أن أسعارك مبنية فقط على الملفات المرفقة.' USING ERRCODE = '23514';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 OR jsonb_array_length(_lines) > 2000
     OR _terms IS NULL OR jsonb_typeof(_terms) <> 'object' THEN
    RAISE EXCEPTION 'Send the lines and the terms. | أرسل البنود والشروط.' USING ERRCODE = '23514';
  END IF;
  -- Terms: all three are required from the portal.
  IF coalesce(_terms->>'lead_time_days', '') !~ '^[0-9]{1,4}$'
     OR jsonb_typeof(_terms->'payment_terms') IS DISTINCT FROM 'string'
     OR char_length(btrim(_terms->>'payment_terms')) NOT BETWEEN 1 AND 500
     OR coalesce(_terms->>'valid_until', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Give the lead time in whole days (up to 9999), the payment terms (up to 500 characters) and the valid-until date. | أدخل مدة التوريد بالأيام الكاملة (حتى 9999) وشروط الدفع (حتى 500 حرف) وتاريخ صلاحية العرض.'
      USING ERRCODE = '23514';
  END IF;
  BEGIN
    vday := (_terms->>'valid_until')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'The valid-until date does not exist. | تاريخ الصلاحية غير موجود.' USING ERRCODE = '23514';
  END;
  IF vday < today THEN
    RAISE EXCEPTION 'The valid-until date is today or later. | تاريخ الصلاحية اليوم أو بعده.' USING ERRCODE = '23514';
  END IF;
  lead := (_terms->>'lead_time_days')::integer;
  pay := btrim(_terms->>'payment_terms');
  SELECT x.ord INTO bad_ord FROM jsonb_array_elements(_lines) WITH ORDINALITY AS x(v, ord)
   WHERE jsonb_typeof(x.v) <> 'object'
      OR coalesce(x.v->>'line_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (x.v ? 'unit_cost' AND jsonb_typeof(x.v->'unit_cost') NOT IN ('number','string','null'))
      OR (x.v ? 'unit_cost_with_screen' AND jsonb_typeof(x.v->'unit_cost_with_screen') NOT IN ('number','string','null'))
      OR NOT public._pricing_supplier_num_ok(nullif(x.v->>'unit_cost',''), 12, 2)
      OR NOT public._pricing_supplier_num_ok(nullif(x.v->>'unit_cost_with_screen',''), 12, 2)
      OR (x.v ? 'spec_difference' AND jsonb_typeof(x.v->'spec_difference') NOT IN ('string','null'))
      OR char_length(coalesce(x.v->>'spec_difference','')) > 500
   ORDER BY x.ord LIMIT 1;
  IF bad_ord IS NOT NULL THEN
    RAISE EXCEPTION 'Line % is not valid: prices are numbers below 1,000,000,000,000 and the note is up to 500 characters. | السطر % غير صالح: الأسعار أرقام أقل من 1,000,000,000,000 والملاحظة حتى 500 حرف.', bad_ord, bad_ord
      USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT x.v->>'line_id') FROM jsonb_array_elements(_lines) x(v)) <> jsonb_array_length(_lines) THEN
    RAISE EXCEPTION 'A line appears twice. | بند مكرر.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) x(v) WHERE nullif(x.v->>'unit_cost','') IS NOT NULL) THEN
    RAISE EXCEPTION 'Price at least one line. | سعّر بنداً واحداً على الأقل.' USING ERRCODE = '23514';
  END IF;

  -- Lock order: the file, then its request (as in cancel and return).
  SELECT * INTO inv FROM public.supplier_invitations i WHERE i.id = _invitation_id AND i.vendor_id = v AND i.status <> 'cancelled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This request is not available. | هذا الطلب غير متاح.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = inv.file_id FOR UPDATE;
  SELECT * INTO inv FROM public.supplier_invitations WHERE id = inv.id FOR UPDATE;
  IF NOT public._supplier_invitation_editable(inv) THEN
    RAISE EXCEPTION 'This request is closed; it can no longer be changed. | هذا الطلب مغلق ولا يمكن تغييره.' USING ERRCODE = 'P0001';
  END IF;
  -- The payload names exactly the lines this round may change.
  SELECT count(*) INTO open_count FROM public.supplier_invitation_lines il
   WHERE il.invitation_id = inv.id AND il.state IN ('open','reopened');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) x(v)
              WHERE NOT EXISTS (SELECT 1 FROM public.supplier_invitation_lines il
                                 WHERE il.id = (x.v->>'line_id')::uuid AND il.invitation_id = inv.id
                                   AND il.state IN ('open','reopened')))
     OR jsonb_array_length(_lines) <> open_count THEN
    RAISE EXCEPTION 'Send every open line of this request, priced or left empty, and no other line. | أرسل كل بند مفتوح في هذا الطلب، مسعّراً أو فارغاً، ولا بند غيره.'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('file_id', sf.id, 'document_id', sf.document_id, 'name', sf.display_name,
                                               'checksum', sf.checksum, 'object_version', sf.object_version,
                                               'object_updated_at', sf.object_updated_at) ORDER BY sf.display_name), '[]'::jsonb)
    INTO files FROM public.supplier_invitation_files sf WHERE sf.invitation_id = inv.id;

  -- PR 2's entry exception: this revision only, while its file is at the supplier.
  PERFORM set_config('phc.pricing_supplier_entry', inv.boq_revision_id::text, true);
  SELECT * INTO old_q FROM public.supplier_quotes sq
   WHERE sq.boq_revision_id = inv.boq_revision_id AND sq.vendor_id = v AND sq.is_current FOR UPDATE;
  IF FOUND THEN
    UPDATE public.supplier_quotes
       SET is_current = false,
           status = CASE WHEN status = 'cancelled' THEN status ELSE 'superseded'::public.supplier_quote_status END
     WHERE id = old_q.id;
  END IF;
  INSERT INTO public.supplier_quotes (boq_revision_id, vendor_id, rfq_reference, status, response_received_at, currency,
                                      lead_time_days, payment_terms, valid_until, notes, created_by,
                                      revision_number, supersedes_id, source)
  VALUES (inv.boq_revision_id, v, inv.project_code, 'responses_received', now(), 'SAR',
          lead, pay, vday, 'Submitted through the supplier portal', u,
          coalesce((SELECT max(s.revision_number) + 1 FROM public.supplier_quotes s
                     WHERE s.boq_revision_id = inv.boq_revision_id AND s.vendor_id = v), 1),
          old_q.id, 'portal')
  RETURNING * INTO q;
  -- Every line of the request: this round's values for the open lines, the
  -- previous live values for the locked ones.
  INSERT INTO public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, unit_cost_with_screen,
                                           alternate_spec, quantity, line_cost)
  SELECT q.id, s.boq_line_id, s.unit_cost, s.with_screen, s.spec, s.quantity, round(s.unit_cost * s.quantity, 2)
    FROM (
      SELECT il.boq_line_id, bl.quantity,
             CASE WHEN p.v IS NOT NULL THEN nullif(p.v->>'unit_cost','')::numeric(14,2) ELSE prev.unit_cost END AS unit_cost,
             CASE WHEN p.v IS NOT NULL THEN nullif(p.v->>'unit_cost_with_screen','')::numeric(14,2) ELSE prev.unit_cost_with_screen END AS with_screen,
             CASE WHEN p.v IS NOT NULL THEN nullif(btrim(coalesce(p.v->>'spec_difference','')), '') ELSE prev.alternate_spec END AS spec
        FROM public.supplier_invitation_lines il
        JOIN public.boq_lines bl ON bl.id = il.boq_line_id
        LEFT JOIN LATERAL (SELECT x.v FROM jsonb_array_elements(_lines) x(v) WHERE (x.v->>'line_id')::uuid = il.id) p ON true
        LEFT JOIN public.supplier_quote_lines prev
               ON prev.supplier_quote_id = old_q.id AND prev.boq_line_id = il.boq_line_id
              AND old_q.status NOT IN ('cancelled','superseded')
       WHERE il.invitation_id = inv.id) s;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('phc.pricing_supplier_entry', '', true);

  UPDATE public.supplier_invitation_lines SET state = 'submitted' WHERE invitation_id = inv.id AND state IN ('open','reopened');
  UPDATE public.supplier_invitations
     SET status = 'submitted', submitted_at = now(), opened_at = coalesce(opened_at, now()), updated_at = now()
   WHERE id = inv.id;
  INSERT INTO public.supplier_invitation_submissions (invitation_id, supplier_quote_id, source, submitted_by,
                                                      confirmation_text, confirmation_lang, confirmed_files, lines)
  VALUES (inv.id, q.id, 'portal', u, conf, _confirm_lang, files, open_count);
  f := public._pricing_file_apply(f, 'supplier_priced', u, NULL);

  -- Kalas (the GM) and Zayed (estimation and finance): the supplier has priced.
  PERFORM public.emit_notification_to_roles(
    ARRAY['general_manager','estimation_manager','finance_manager']::public.app_role[],
    'pricing_supplier_submitted', 'opportunity', f.opportunity_id, inv.project_code,
    'The supplier submitted prices for ' || open_count || ' lines.', 'attention', 'supplier_quote_submitted',
    'supplier_submitted:' || q.id, jsonb_build_object('pricing_file_id', f.id));
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'supplier_portal.submitted', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'invitation_id', inv.id, 'supplier_quote_id', q.id, 'lines', open_count));
  RETURN jsonb_build_object('supplier_quote_id', q.id, 'lines', open_count);
END $$;
REVOKE ALL ON FUNCTION public.supplier_portal_submit(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_portal_submit(uuid, jsonb, jsonb, text) TO authenticated;

-- Entry on behalf (PR 2, 20261104160000) with the request rules. A new
-- optional parameter, so the old signature is dropped first (an overload would
-- leave the old rules callable).
DROP FUNCTION IF EXISTS public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.pricing_enter_supplier_quote(_file_id uuid, _vendor_id uuid, _lines jsonb,
  _terms jsonb DEFAULT '{}'::jsonb, _document_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; q public.supplier_quotes; old_q public.supplier_quotes;
        inv public.supplier_invitations; code text; n integer := 0; e record; bad_ord bigint; vday date; ccy_in text;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance enter supplier prices. | أسعار المورد يُدخلها التقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _file_id IS NULL OR _vendor_id IS NULL THEN
    RAISE EXCEPTION 'Choose the file and the supplier. | اختر الملف والمورد.' USING ERRCODE = '23514';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 OR jsonb_array_length(_lines) > 2000
     OR _terms IS NULL OR jsonb_typeof(_terms) <> 'object' THEN
    RAISE EXCEPTION 'Give at least one line, and terms as lead time (days), payment terms, valid-until date and currency. | أدخل بنداً واحداً على الأقل، والشروط: مدة التوريد بالأيام وشروط الدفع وتاريخ الصلاحية والعملة.' USING ERRCODE = '23514';
  END IF;
  IF coalesce(nullif(_terms->>'lead_time_days',''), '0') !~ '^[0-9]{1,4}$'
     OR (_terms ? 'payment_terms' AND jsonb_typeof(_terms->'payment_terms') NOT IN ('string','null'))
     OR char_length(coalesce(_terms->>'payment_terms','')) > 500
     OR (_terms ? 'valid_until' AND jsonb_typeof(_terms->'valid_until') NOT IN ('string','null'))
     OR coalesce(nullif(_terms->>'valid_until',''), '2000-01-01') !~ '^\d{4}-\d{2}-\d{2}$'
     OR (_terms ? 'currency' AND jsonb_typeof(_terms->'currency') NOT IN ('string','null'))
     OR coalesce(nullif(_terms->>'currency',''), 'SAR') !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'The terms are not valid: lead time in whole days (up to 9999), payment terms up to 500 characters, a valid-until date (YYYY-MM-DD) and a 3-letter currency. | الشروط غير صالحة: مدة التوريد بالأيام الكاملة (حتى 9999)، وشروط الدفع حتى 500 حرف، وتاريخ صلاحية (YYYY-MM-DD)، وعملة من 3 أحرف.' USING ERRCODE = '23514';
  END IF;
  BEGIN
    vday := nullif(_terms->>'valid_until','')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'The valid-until date does not exist. | تاريخ الصلاحية غير موجود.' USING ERRCODE = '23514';
  END;
  ccy_in := nullif(_terms->>'currency','');

  SELECT x.ord INTO bad_ord FROM jsonb_array_elements(_lines) WITH ORDINALITY AS x(v, ord)
   WHERE jsonb_typeof(x.v) <> 'object'
      OR coalesce(x.v->>'boq_line_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (x.v ? 'unit_cost' AND jsonb_typeof(x.v->'unit_cost') NOT IN ('number','string','null'))
      OR (x.v ? 'unit_cost_with_screen' AND jsonb_typeof(x.v->'unit_cost_with_screen') NOT IN ('number','string','null'))
      OR NOT public._pricing_supplier_num_ok(nullif(x.v->>'unit_cost',''), 12, 2)
      OR NOT public._pricing_supplier_num_ok(nullif(x.v->>'unit_cost_with_screen',''), 12, 2)
      OR (x.v ? 'alternate_spec' AND jsonb_typeof(x.v->'alternate_spec') NOT IN ('string','null'))
      OR char_length(coalesce(x.v->>'alternate_spec','')) > 500
   ORDER BY x.ord LIMIT 1;
  IF bad_ord IS NOT NULL THEN
    RAISE EXCEPTION 'Line % is not valid: prices are numbers below 1,000,000,000,000 and the spec note is up to 500 characters. | السطر % غير صالح: الأسعار أرقام أقل من 1,000,000,000,000 وملاحظة المواصفة حتى 500 حرف.', bad_ord, bad_ord USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT x.v->>'boq_line_id') FROM jsonb_array_elements(_lines) x(v)) <> jsonb_array_length(_lines) THEN
    RAISE EXCEPTION 'A BOQ line appears twice. | بند من الكميات مكرر.' USING ERRCODE = '23514';
  END IF;

  -- Lock order: estimation -> price -> file -> request. This RPC touches neither of the first two.
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state <> 'at_supplier' THEN
    RAISE EXCEPTION 'Supplier prices are entered while the file is at the supplier. | تُدخل أسعار المورد والملف عند المورد.' USING ERRCODE = 'P0001';
  END IF;
  IF f.boq_revision_id IS NULL OR NOT public.boq_revision_is_frozen(f.boq_revision_id) THEN
    RAISE EXCEPTION 'The file has no frozen BOQ revision. | لا توجد مراجعة كميات مجمّدة للملف.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) x(v)
              WHERE NOT EXISTS (SELECT 1 FROM public.boq_lines l
                                 WHERE l.id = (x.v->>'boq_line_id')::uuid AND l.revision_id = f.boq_revision_id)) THEN
    RAISE EXCEPTION 'A line is not in this file''s BOQ. | أحد البنود ليس في كميات هذا الملف.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = _vendor_id) THEN
    RAISE EXCEPTION 'Unknown supplier. | المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  -- PR 3: the open request names the file's supplier.
  SELECT * INTO inv FROM public.supplier_invitations i
   WHERE i.file_id = f.id AND i.status IN ('sent','opened','reopened') FOR UPDATE;
  IF FOUND AND inv.vendor_id <> _vendor_id THEN
    RAISE EXCEPTION 'This file was sent to another supplier through the portal; cancel that request first. | أُرسل هذا الملف لمورد آخر عبر البوابة؛ ألغِ ذلك الطلب أولاً.' USING ERRCODE = 'P0001';
  END IF;
  -- PR 3: the supplier's original file, attached to this deal or its RFQ.
  IF _document_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.documents dd
         JOIN public.document_links l ON l.document_id = dd.id AND l.unlinked_at IS NULL
        WHERE dd.id = _document_id AND dd.deleted_at IS NULL
          AND ((l.entity_type = 'opportunity' AND l.entity_id = f.opportunity_id)
            OR (l.entity_type = 'rfq' AND f.rfq_id IS NOT NULL AND l.entity_id = f.rfq_id))) THEN
    RAISE EXCEPTION 'The supplier''s file is not attached to this deal. | ملف المورد ليس مرفقاً بهذه الفرصة.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_quotes sq
              WHERE sq.boq_revision_id = f.boq_revision_id AND sq.is_current
                AND sq.status NOT IN ('cancelled','superseded') AND sq.vendor_id <> _vendor_id) THEN
    RAISE EXCEPTION 'This file already has another supplier''s prices; one supplier per file in this release. | لهذا الملف أسعار مورد آخر؛ مورد واحد لكل ملف في هذا الإصدار.' USING ERRCODE = 'P0001';
  END IF;

  SELECT o.project_code INTO code FROM public.opportunities o WHERE o.id = f.opportunity_id;
  PERFORM set_config('phc.pricing_supplier_entry', f.boq_revision_id::text, true);

  SELECT * INTO old_q FROM public.supplier_quotes
   WHERE boq_revision_id = f.boq_revision_id AND vendor_id = _vendor_id AND is_current FOR UPDATE;
  -- A dead quote is retired; a portal quote is superseded so the supplier's own submission stays on record.
  IF FOUND AND (old_q.status IN ('cancelled','superseded') OR old_q.source = 'portal') THEN
    UPDATE public.supplier_quotes
       SET is_current = false,
           status = CASE WHEN status IN ('cancelled','superseded') THEN status ELSE 'superseded'::public.supplier_quote_status END
     WHERE id = old_q.id;
    old_q := NULL;
  END IF;

  IF old_q.id IS NULL THEN
    INSERT INTO public.supplier_quotes (boq_revision_id, vendor_id, rfq_reference, status, response_received_at, currency,
                                        lead_time_days, payment_terms, valid_until, notes, created_by,
                                        revision_number, supersedes_id, source, source_document_id)
    VALUES (f.boq_revision_id, _vendor_id, code, 'responses_received', now(), coalesce(ccy_in, 'SAR'),
            nullif(_terms->>'lead_time_days','')::integer, nullif(btrim(coalesce(_terms->>'payment_terms','')), ''),
            vday, 'Entered on behalf of the supplier', u,
            coalesce((SELECT max(s.revision_number) + 1 FROM public.supplier_quotes s
                       WHERE s.boq_revision_id = f.boq_revision_id AND s.vendor_id = _vendor_id), 1),
            (SELECT s.id FROM public.supplier_quotes s
              WHERE s.boq_revision_id = f.boq_revision_id AND s.vendor_id = _vendor_id
              ORDER BY s.revision_number DESC LIMIT 1),
            'on_behalf', _document_id)
    RETURNING * INTO q;
  ELSE
    -- Entering again corrects the same quote in place: still one current quote.
    UPDATE public.supplier_quotes
       SET response_received_at = now(),
           status = CASE WHEN status IN ('draft','sent') THEN 'responses_received'::public.supplier_quote_status ELSE status END,
           currency = coalesce(ccy_in, currency),
           lead_time_days = coalesce(nullif(_terms->>'lead_time_days','')::integer, lead_time_days),
           payment_terms  = coalesce(nullif(btrim(coalesce(_terms->>'payment_terms','')), ''), payment_terms),
           valid_until    = coalesce(vday, valid_until),
           source = 'on_behalf',
           source_document_id = coalesce(_document_id, source_document_id)
     WHERE id = old_q.id RETURNING * INTO q;
  END IF;

  FOR e IN
    SELECT (x.v->>'boq_line_id')::uuid AS line_id,
           nullif(x.v->>'unit_cost','')::numeric(14,2) AS unit_cost,
           nullif(x.v->>'unit_cost_with_screen','')::numeric(14,2) AS with_screen,
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
  -- This call replaces the entry: a line it no longer prices is cleared (rows are never deleted).
  UPDATE public.supplier_quote_lines l
     SET unit_cost = NULL, unit_cost_with_screen = NULL, alternate_spec = NULL, line_cost = NULL
   WHERE l.supplier_quote_id = q.id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) x(v) WHERE (x.v->>'boq_line_id')::uuid = l.boq_line_id)
     AND (l.unit_cost IS NOT NULL OR l.unit_cost_with_screen IS NOT NULL OR l.alternate_spec IS NOT NULL);
  PERFORM set_config('phc.pricing_supplier_entry', '', true);

  -- PR 3: an open request for this supplier closes as entered on behalf.
  IF inv.id IS NOT NULL THEN
    UPDATE public.supplier_invitation_lines SET state = 'submitted' WHERE invitation_id = inv.id AND state IN ('open','reopened');
    UPDATE public.supplier_invitations SET status = 'submitted', submitted_at = now(), updated_at = now() WHERE id = inv.id;
    INSERT INTO public.supplier_invitation_submissions (invitation_id, supplier_quote_id, source, submitted_by, lines)
    VALUES (inv.id, q.id, 'on_behalf', u, n);
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.supplier_prices_entered', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'supplier_quote_id', q.id, 'vendor_id', _vendor_id,
                             'lines', n, 'currency', q.currency, 'on_behalf', true,
                             'invitation_id', inv.id, 'document_id', _document_id));
  RETURN jsonb_build_object('supplier_quote_id', q.id, 'lines', n);
END $$;
REVOKE ALL ON FUNCTION public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_enter_supplier_quote(uuid, uuid, jsonb, jsonb, uuid) TO authenticated;
```

- [ ] **Step 4: Run the DB tests**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_portal_submit.test.sql .. ok` (41 tests); `pricing_supplier_entry.test.sql` and every other file still ok.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261108140000_supplier_portal_submit.sql supabase/tests/supplier_portal_submit.test.sql
git commit -m "feat(pricing): supplier submits a quote revision; entry on behalf follows the request" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Returned lines, the overdue reminder, and the isolation sweep (SQL)

**Files:**
- Create: `supabase/migrations/20261108150000_supplier_returns_overdue.sql`
- Test: `supabase/tests/supplier_returns_overdue.test.sql`
- Test: `supabase/tests/supplier_isolation_sweep.test.sql`

**Interfaces:**
- Consumes: Tasks 1–4; PR 1 `public.pricing_file_move(uuid, pricing_file_state, text)` (locks price then file, keeps the note in `cost_note`, returns a `gm_pending` price on `price_review → at_supplier`).
- Produces:
  - `public.pricing_return_lines_to_supplier(_file_id uuid, _boq_line_ids uuid[], _reply_by date, _note text, _message text DEFAULT NULL) → jsonb {"invitation_id","lines"}` (from `supplier_priced` or `price_review`; needs a submitted request on the file's revision).
  - `public.pricing_notify_overdue_suppliers() → integer` (service role; cron `pricing-supplier-overdue`, `15 5 * * *`), notification type `pricing_supplier_overdue` (metadata `{"pricing_file_id"}`).
  - The sweep test, which every later change must keep green: a supplier reads only its own profile and role and the static `pricing_file_transitions`; every SECURITY DEFINER function a client can call checks the caller or is on the reviewed list; every owner-run view filters on the caller or is reviewed; every public table has row security and the session boundary.

- [ ] **Step 1: Write the two failing pgTAP tests**

Create `supabase/tests/supplier_returns_overdue.test.sql`:

```sql
-- PR 3 Task 5: returned lines reopen alone; the overdue reminder.
-- Test user UUIDs use the 8e prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8e000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'rt-rep'),(2,'rt-pricer'),(3,'rt-gm'),(4,'rt-supplier')) v(n, r);
update public.profiles set status = 'active' where id::text like '8e000000-%';
insert into public.user_roles (user_id, role) values
  ('8e000000-0000-0000-0000-000000000001','salesperson'),
  ('8e000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8e000000-0000-0000-0000-000000000002','finance_manager'),
  ('8e000000-0000-0000-0000-000000000003','general_manager');
insert into public.vendors (id, name) values ('8e100001-0000-0000-0000-000000000001','rt-vendor-a');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8e100001-0000-0000-0000-000000000001' where id = '8e000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values ('8e000000-0000-0000-0000-000000000004','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'rt-deal-' || n,
       '8e000000-0000-0000-0000-000000000001','8e000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,3) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8e40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'rt-boq-' || n
  from generate_series(1,3) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8e50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8e40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,3) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity) values
  ('8e510001-0000-0000-0000-000000000001','8e500001-0000-0000-0000-000000000001',1,'Pylon P1',2),
  ('8e510002-0000-0000-0000-000000000001','8e500001-0000-0000-0000-000000000001',2,'Wall W1',4),
  ('8e510003-0000-0000-0000-000000000001','8e500002-0000-0000-0000-000000000001',1,'Ceiling C1',1),
  ('8e510004-0000-0000-0000-000000000001','8e500003-0000-0000-0000-000000000001',1,'Stand S1',1);
update public.boq_revisions set frozen_at = now(), frozen_by = '8e000000-0000-0000-0000-000000000002', status = 'verified'
 where id::text like '8e50000%';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8e600001-0000-0000-0000-000000000001','8e200001-0000-0000-0000-000000000001','boq_frozen','8e500001-0000-0000-0000-000000000001'),
  ('8e600002-0000-0000-0000-000000000001','8e200002-0000-0000-0000-000000000001','boq_frozen','8e500002-0000-0000-0000-000000000001'),
  ('8e600003-0000-0000-0000-000000000001','8e200003-0000-0000-0000-000000000001','supplier_priced','8e500003-0000-0000-0000-000000000001');
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by)
select ('8e70000' || n || '-0000-0000-0000-000000000001')::uuid, 'attachments', 'opportunity/8e' || n || '/a.pdf', 'a.pdf', 'application/pdf',
       1000, repeat('a',64), 'drawing', '8e000000-0000-0000-0000-000000000001'
  from generate_series(1,2) n;
insert into public.document_links (document_id, entity_type, entity_id, linked_by)
select ('8e70000' || n || '-0000-0000-0000-000000000001')::uuid, 'opportunity', ('8e20000' || n || '-0000-0000-0000-000000000001')::uuid,
       '8e000000-0000-0000-0000-000000000001'
  from generate_series(1,2) n;
insert into storage.objects (bucket_id, name, owner, version)
select 'attachments', 'opportunity/8e' || n || '/a.pdf', '8e000000-0000-0000-0000-000000000001', 'v1' from generate_series(1,2) n;

create temp table rt_ref (k text, v text);
grant all on rt_ref to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into rt_ref select 'inv', public.pricing_send_to_supplier('8e600001-0000-0000-0000-000000000001','8e100001-0000-0000-0000-000000000001',
  current_date + 7, array['8e700001-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
insert into rt_ref select 'inv2', public.pricing_send_to_supplier('8e600002-0000-0000-0000-000000000001','8e100001-0000-0000-0000-000000000001',
  current_date + 7, array['8e700002-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
reset role;
insert into rt_ref select 'l1', id::text from public.supplier_invitation_lines
 where invitation_id = (select v::uuid from rt_ref where k = 'inv') and boq_line_id = '8e510001-0000-0000-0000-000000000001';
insert into rt_ref select 'l2', id::text from public.supplier_invitation_lines
 where invitation_id = (select v::uuid from rt_ref where k = 'inv') and boq_line_id = '8e510002-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select public.supplier_portal_submit((select v::uuid from rt_ref where k = 'inv'),
  jsonb_build_array(jsonb_build_object('line_id', (select v from rt_ref where k = 'l1'), 'unit_cost', 1000),
                    jsonb_build_object('line_id', (select v from rt_ref where k = 'l2'), 'unit_cost', 200, 'spec_difference', 'Acrylic')),
  '{"lead_time_days":30,"payment_terms":"Net 30","valid_until":"2099-12-31"}', 'en');

-- Returning lines.
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510001-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Missing screen price')$$, '42501', null, 'A rep cannot send lines back');
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510001-0000-0000-0000-000000000001']::uuid[], current_date + 3, '  ')$$, '23514', null, 'Sending lines back needs a reason');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510001-0000-0000-0000-000000000001']::uuid[], current_date - 1, 'Missing screen price')$$, '23514', null, 'A reply-by date in the past is refused');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510003-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Missing screen price')$$, '23514', null, 'A line outside the request is refused');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array[]::uuid[], current_date + 3, 'Missing screen price')$$, '23514', null, 'At least one line goes back');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600003-0000-0000-0000-000000000001',
  array['8e510004-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Missing screen price')$$, 'P0001', null,
  'A file priced without a portal request is sent back with a plain note instead');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600002-0000-0000-0000-000000000001',
  array['8e510003-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Missing screen price')$$, 'P0001', null,
  'Lines go back only from cost review or price review');
select is((public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510001-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Line 1 has no screen price; margin too thin without it',
  'Please add the price with the screen for the pylon.'))->>'lines', '1', 'Zayed sends one line back');
reset role;
select is((select state::text from public.pricing_files where id = '8e600001-0000-0000-0000-000000000001'), 'at_supplier', 'The file is back at the supplier');
select is((select status || '/' || reply_by::text || '/' || return_message from public.supplier_invitations where id = (select v::uuid from rt_ref where k = 'inv')),
  'reopened/' || (current_date + 3)::text || '/Please add the price with the screen for the pylon.', 'The request reopens with a new date and the message');
select is((select string_agg(state, ',' order by boq_line_id) from public.supplier_invitation_lines where invitation_id = (select v::uuid from rt_ref where k = 'inv')),
  'reopened,submitted', 'Only the returned line reopens');
select is((select cost_note from public.pricing_file_events where file_id = '8e600001-0000-0000-0000-000000000001' and from_state = 'supplier_priced'),
  'Line 1 has no screen price; margin too thin without it', 'The internal reason is a cost note');
select is((select note from public.pricing_file_events where file_id = '8e600001-0000-0000-0000-000000000001' and from_state = 'supplier_priced'),
  null, 'The deal''s readable history does not carry it');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
create temp table rt_doc (j jsonb);
grant all on rt_doc to authenticated;
insert into rt_doc select public.supplier_portal_invitation((select v::uuid from rt_ref where k = 'inv'));
select is((select j->>'status' || '/' || (j->>'return_message') from rt_doc), 'returned/Please add the price with the screen for the pylon.',
  'The supplier sees the request returned, with PHC''s message');
select is((select string_agg(l->>'editable', ',' order by (l->>'line_number')::int) from rt_doc, jsonb_array_elements(j->'lines') l), 'true,false',
  'Only the returned line takes a price');
select is((select (j->'lines'->1->>'unit_cost')::numeric from rt_doc), 200.00::numeric, 'The locked line shows its submitted price');
select is((select open_lines from public.supplier_portal_invitations() where invitation_id = (select v::uuid from rt_ref where k = 'inv')), 1,
  'The list counts one open line');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s","unit_cost":1100},{"line_id":"%s","unit_cost":1}]',
  '{"lead_time_days":30,"payment_terms":"Net 30","valid_until":"2099-12-31"}', 'en')$$,
  (select v from rt_ref where k = 'inv'), (select v from rt_ref where k = 'l1'), (select v from rt_ref where k = 'l2')),
  '23514', null, 'A locked line cannot be re-priced');
select is((public.supplier_portal_submit((select v::uuid from rt_ref where k = 'inv'),
  jsonb_build_array(jsonb_build_object('line_id', (select v from rt_ref where k = 'l1'), 'unit_cost', 1000, 'unit_cost_with_screen', 1400)),
  '{"lead_time_days":30,"payment_terms":"Net 30","valid_until":"2099-12-31"}', 'en'))->>'lines', '1', 'The supplier re-prices the returned line only');
reset role;
select is((select string_agg(coalesce(l.unit_cost_with_screen::text, '-') || ':' || l.unit_cost::text || ':' || coalesce(l.alternate_spec, '-'), ',' order by l.boq_line_id)
             from public.supplier_quote_lines l join public.supplier_quotes q on q.id = l.supplier_quote_id
            where q.boq_revision_id = '8e500001-0000-0000-0000-000000000001' and q.is_current),
  '1400.00:1000.00:-,-:200.00:Acrylic', 'The new revision carries the locked line''s price and note unchanged');
select is((select count(*)::int from public.supplier_quotes where boq_revision_id = '8e500001-0000-0000-0000-000000000001'), 2,
  'Each submission is its own quote revision');
select is((select state::text from public.pricing_files where id = '8e600001-0000-0000-0000-000000000001'), 'supplier_priced', 'The file goes back to the GM');

-- The overdue reminder.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_notify_overdue_suppliers()$$, '42501', null, 'Clients cannot run the reminder');
reset role;
select set_config('request.jwt.claims','',true);
update public.supplier_invitations set reply_by = current_date - 2 where id = (select v::uuid from rt_ref where k = 'inv2');
select is(public.pricing_notify_overdue_suppliers(), 1, 'One overdue request: Zayed is told once');
select is(public.pricing_notify_overdue_suppliers(), 0, 'Running again tells nobody twice');
select is((select metadata->>'pricing_file_id' || '/' || title from public.notifications where notification_type = 'pricing_supplier_overdue'
             and recipient_user_id = '8e000000-0000-0000-0000-000000000002'),
  '8e600002-0000-0000-0000-000000000001/' || (select project_code from public.opportunities where id = '8e200002-0000-0000-0000-000000000001'),
  'The reminder opens the pricing file and names the project code');
select is((select count(*)::int from public.notifications where notification_type = 'pricing_supplier_overdue'
             and recipient_user_id in ('8e000000-0000-0000-0000-000000000001','8e000000-0000-0000-0000-000000000003')), 0,
  'The rep and the GM are not reminded');

select * from finish();
rollback;
```

Create `supabase/tests/supplier_isolation_sweep.test.sql`:

```sql
-- PR 3 Task 5: a supplier sees its own request and nothing else in the schema.
-- A sweep over every table and view, the storage objects, the SECURITY DEFINER
-- functions a client can call, and the views that bypass row security.
-- Test user UUIDs use the 8f prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8f000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'sw-rep'),(2,'sw-pricer'),(3,'sw-supplier-a'),(4,'sw-supplier-b')) v(n, r);
update public.profiles set status = 'active' where id::text like '8f000000-%';
insert into public.user_roles (user_id, role) values
  ('8f000000-0000-0000-0000-000000000001','salesperson'),
  ('8f000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8f000000-0000-0000-0000-000000000002','finance_manager');
-- Two vendors whose names normalise alike, so the duplicates view has a row to leak.
insert into public.vendors (id, name) values
  ('8f100001-0000-0000-0000-000000000001','Sweep Signs Co'),
  ('8f100002-0000-0000-0000-000000000001','SWEEP SIGNS co.');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8f100001-0000-0000-0000-000000000001' where id = '8f000000-0000-0000-0000-000000000003';
update public.profiles set vendor_id = '8f100002-0000-0000-0000-000000000001' where id = '8f000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values
  ('8f000000-0000-0000-0000-000000000003','supplier'), ('8f000000-0000-0000-0000-000000000004','supplier');
set local session_replication_role = origin;
insert into public.automation_runs (trigger) values ('sw-probe');
insert into public.margin_policies (min_margin_pct, effective_from, rationale) values (15, now() - interval '1 day', 'sw-floor');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8f20000' || n || '-0000-0000-0000-000000000001')::uuid, 'sw-deal-' || n,
       '8f000000-0000-0000-0000-000000000001','8f000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8f40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8f20000' || n || '-0000-0000-0000-000000000001')::uuid, 'sw-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8f50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8f40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity) values
  ('8f510001-0000-0000-0000-000000000001','8f500001-0000-0000-0000-000000000001',1,'Pylon P1',2),
  ('8f510002-0000-0000-0000-000000000001','8f500002-0000-0000-0000-000000000001',1,'Wall W1',1);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency) values
  ('8f800001-0000-0000-0000-000000000001','8f500001-0000-0000-0000-000000000001','8f100001-0000-0000-0000-000000000001','SAR');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost) values
  ('8f800001-0000-0000-0000-000000000001','8f510001-0000-0000-0000-000000000001',2,100);
update public.boq_revisions set frozen_at = now(), frozen_by = '8f000000-0000-0000-0000-000000000002', status = 'verified'
 where id::text like '8f50000%';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8f600001-0000-0000-0000-000000000001','8f200001-0000-0000-0000-000000000001','boq_frozen','8f500001-0000-0000-0000-000000000001'),
  ('8f600002-0000-0000-0000-000000000001','8f200002-0000-0000-0000-000000000001','boq_frozen','8f500002-0000-0000-0000-000000000001');
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by)
select ('8f70000' || n || '-0000-0000-0000-000000000001')::uuid, 'attachments', 'opportunity/8f' || n || '/a.pdf', 'a.pdf', 'application/pdf',
       1000, repeat('a',64), 'drawing', '8f000000-0000-0000-0000-000000000001'
  from generate_series(1,2) n;
insert into public.document_links (document_id, entity_type, entity_id, linked_by)
select ('8f70000' || n || '-0000-0000-0000-000000000001')::uuid, 'opportunity', ('8f20000' || n || '-0000-0000-0000-000000000001')::uuid,
       '8f000000-0000-0000-0000-000000000001'
  from generate_series(1,2) n;
insert into storage.objects (bucket_id, name, owner, version)
select 'attachments', 'opportunity/8f' || n || '/a.pdf', '8f000000-0000-0000-0000-000000000001', 'v1' from generate_series(1,2) n;
-- The pricer sends file 1 to supplier A and file 2 to supplier B; a notification and an audit row exist.
create temp table sw_ref (k text, v text);
grant all on sw_ref to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into sw_ref select 'inv_a', public.pricing_send_to_supplier('8f600001-0000-0000-0000-000000000001','8f100001-0000-0000-0000-000000000001',
  current_date + 7, array['8f700001-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
insert into sw_ref select 'inv_b', public.pricing_send_to_supplier('8f600002-0000-0000-0000-000000000001','8f100002-0000-0000-0000-000000000001',
  current_date + 7, array['8f700002-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
reset role;
insert into sw_ref select 'code_a', project_code from public.opportunities where id = '8f200001-0000-0000-0000-000000000001';
-- Inserted directly: emit_notification skips supplier accounts (Task 1 fix round 1).
insert into public.notifications (recipient_user_id, notification_type, entity_type, entity_id, title, body, severity, source_event, dedupe_key)
values ('8f000000-0000-0000-0000-000000000003', 'mention', 'opportunity', '8f200001-0000-0000-0000-000000000001',
        'sw-title', 'sw-body', 'info', 'sw', 'sw-1');

-- 1. Every table and view, as supplier A: nothing but its own profile and the static state map.
create temp table sw_seen (rel text, n bigint);
grant all on sw_seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
do $$ declare r record; c bigint; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','v','m','p') order by 1 loop
    begin
      execute format('select count(*) from public.%I', r.relname) into c;
    exception when insufficient_privilege then c := 0;  -- no grant at all: nothing to read
    end;
    if c > 0 then insert into sw_seen values (r.relname, c); end if;
  end loop;
end $$;
select is((select array_agg(rel || '=' || n order by rel) from sw_seen), array['pricing_file_transitions=14','profiles=1','user_roles=1'],
  'A supplier reads only its own profile and role, and the static state map, in every table and view');
select is((select count(*)::int from storage.objects), 0, 'A supplier reads no stored file');
select throws_ok($$insert into public.supplier_quotes (boq_revision_id, vendor_id, currency)
  values ('8f500001-0000-0000-0000-000000000001','8f100001-0000-0000-0000-000000000001','SAR')$$, '42501', null,
  'A supplier cannot write a quote directly');
select throws_ok($$insert into public.documents (storage_bucket, storage_path, original_filename, doc_type, uploaded_by)
  values ('attachments','x/y.pdf','y.pdf','other','8f000000-0000-0000-0000-000000000003')$$, '42501', null,
  'A supplier cannot register a document');
select is((select array_agg(project_code) from public.supplier_portal_invitations()),
  array[(select v from sw_ref where k = 'code_a')], 'Through the portal it sees its own request only');
select throws_ok(format($$select public.supplier_portal_invitation('%s')$$, (select v from sw_ref where k = 'inv_b')), '42501', null,
  'And not the other supplier''s');
select is(public.pricing_my_rights(), '{"is_gm": false, "is_pricer": false, "can_read_cost": false, "can_set_margins": false}'::jsonb,
  'The pricing rights call grants a supplier nothing');
select is(public.current_margin_floor(), null::numeric, 'Nor the margin floor');

-- 2. Every SECURITY DEFINER function a client can call checks the caller, or is on this reviewed list.
reset role;
select is((select array_agg(distinct p.proname::text order by p.proname::text)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and p.prosrc !~* '(has_app_access|is_active_user|has_role|has_any_role|can_[a-z_]+\(|is_pricer|is_pipeline_operator|is_platform_admin|is_[a-z_]+_manager|_assert_|_supplier_session_vendor|_supplier_invitation_for_session|_supplier_account_manager|is_supplier_account)'),
  array['ai_knowledge_source_current','ai_output_entity_still_owned','boq_revision_is_frozen','current_sla_days',
        'has_app_access','historical_collision_class','historical_quote_number',
        'is_display_account','next_sales_code',
        'pricing_file_propose','project_has_valid_boq','source_is_approved_for_agents'],
  'Every SECURITY DEFINER function a client can call checks the caller, or is reviewed (id-keyed, own-data or a boolean)');

-- 3. Views that bypass row security filter on the caller, run as the invoker, or are reviewed.
select is((select array_agg(c.relname::text order by c.relname::text)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('v','m')
              and has_table_privilege('authenticated', c.oid, 'SELECT')
              and not coalesce('security_invoker=true' = any(c.reloptions), false)
              and pg_get_viewdef(c.oid) !~ '(auth\.uid|has_app_access|can_read|is_pricer|is_active_user|has_role|has_any_role)'),
  array['conversion_summary','loss_analysis','pricing_file_transitions','pricing_selling_totals','sales_forecast','team_performance'],
  'Owner-run views either filter on the caller or are reviewed (built on filtered views, or static)');

-- 4. Every public table: row security on, and the session boundary.
select is((select array_agg(c.relname::text) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity), null::text[],
  'Row security is on for every public table');
select is((select array_agg(c.relname::text order by c.relname::text) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and c.relname not in ('profiles','user_roles')
              and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                                and p.policyname = 'audit_session_boundary' and p.permissive = 'RESTRICTIVE')),
  null::text[], 'Every public table carries the restrictive session boundary');

select * from finish();
rollback;
```

- [ ] **Step 2: Run them to see them fail**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_returns_overdue.test.sql` fails (function `public.pricing_return_lines_to_supplier` does not exist). `supplier_isolation_sweep.test.sql` already passes (it guards Tasks 1–4); keep it.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261108150000_supplier_returns_overdue.sql`:

```sql
-- =============================================================================
-- Pricing loop PR 3, part 5: returned lines reopen alone; Zayed hears when the
-- supplier is late.
--
-- Returning lines (spec section 1: supplier_priced -> at_supplier, and
-- price_review -> at_supplier) goes through PR 1's pricing_file_move, so the
-- lock order, the note rule (kept in cost_note) and the return of the price
-- under review stay in one place. This RPC adds what the supplier needs: only
-- the chosen lines reopen, a new reply-by date, and an optional message the
-- supplier reads (the internal note stays internal).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pricing_return_lines_to_supplier(_file_id uuid, _boq_line_ids uuid[], _reply_by date,
  _note text, _message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; inv public.supplier_invitations; n integer;
        today date := public._pricing_today(); msg text := nullif(btrim(coalesce(_message, '')), '');
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance send lines back to the supplier. | إرجاع البنود للمورد للتقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _boq_line_ids IS NULL OR cardinality(_boq_line_ids) = 0 OR cardinality(_boq_line_ids) > 2000
     OR (SELECT count(DISTINCT x) FROM unnest(_boq_line_ids) x) <> cardinality(_boq_line_ids) THEN
    RAISE EXCEPTION 'Choose the lines that go back (each once). | اختر البنود المُرجعة (كل بند مرة).' USING ERRCODE = '23514';
  END IF;
  IF _reply_by IS NULL OR _reply_by < today OR _reply_by > today + 180 THEN
    RAISE EXCEPTION 'The reply-by date is from today and within 180 days. | موعد الرد من اليوم وخلال 180 يوماً.' USING ERRCODE = '23514';
  END IF;
  IF char_length(btrim(coalesce(_note, ''))) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Say why the lines go back (up to 1000 characters). | اذكر سبب إرجاع البنود (حتى 1000 حرف).' USING ERRCODE = '23514';
  END IF;
  IF char_length(coalesce(msg, '')) > 1000 THEN
    RAISE EXCEPTION 'The message to the supplier is up to 1000 characters. | الرسالة للمورد حتى 1000 حرف.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state NOT IN ('supplier_priced','price_review') THEN
    RAISE EXCEPTION 'Lines go back to the supplier from cost review or price review. | تُرجع البنود للمورد من مراجعة التكلفة أو مراجعة السعر.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO inv FROM public.supplier_invitations i
   WHERE i.file_id = f.id AND i.boq_revision_id = f.boq_revision_id AND i.status = 'submitted'
   ORDER BY i.submitted_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This file has no supplier request to return lines to; send it back with a note instead. | لا يوجد طلب مورد لإرجاع البنود إليه؛ أرجع الملف بملاحظة بدلاً من ذلك.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_boq_line_ids) x
              WHERE NOT EXISTS (SELECT 1 FROM public.supplier_invitation_lines il
                                 WHERE il.invitation_id = inv.id AND il.boq_line_id = x)) THEN
    RAISE EXCEPTION 'A line is not in the supplier''s request. | أحد البنود ليس في طلب المورد.' USING ERRCODE = '23514';
  END IF;

  -- PR 1's move: locks the price then the file, checks the path, keeps the note
  -- in cost_note and returns the price under review.
  PERFORM public.pricing_file_move(_file_id, 'at_supplier', _note);
  UPDATE public.supplier_invitations
     SET status = 'reopened', reply_by = _reply_by, return_message = msg, updated_at = now()
   WHERE id = inv.id;
  UPDATE public.supplier_invitation_lines SET state = 'reopened'
   WHERE invitation_id = inv.id AND boq_line_id = ANY(_boq_line_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.lines_returned_to_supplier', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'invitation_id', inv.id, 'lines', n, 'reply_by', _reply_by));
  RETURN jsonb_build_object('invitation_id', inv.id, 'lines', n);
END $$;
REVOKE ALL ON FUNCTION public.pricing_return_lines_to_supplier(uuid, uuid[], date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_return_lines_to_supplier(uuid, uuid[], date, text, text) TO authenticated;

-- Zayed (estimation and finance) hears once per request and reply-by date when
-- the supplier is late. The Supplier tab also shows it on read.
CREATE OR REPLACE FUNCTION public.pricing_notify_overdue_suppliers()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0; today date := public._pricing_today();
BEGIN
  FOR r IN
    SELECT i.id, i.reply_by, i.project_code, f.id AS file_id, f.opportunity_id
      FROM public.supplier_invitations i
      JOIN public.pricing_files f ON f.id = i.file_id
     WHERE i.status IN ('sent','opened','reopened') AND f.state = 'at_supplier'
       AND f.boq_revision_id = i.boq_revision_id AND i.reply_by < today
  LOOP
    n := n + public.emit_notification_to_roles(
      ARRAY['estimation_manager','finance_manager']::public.app_role[],
      'pricing_supplier_overdue', 'opportunity', r.opportunity_id, r.project_code,
      'The supplier has not replied; the reply-by date was ' || r.reply_by::text || '.',
      'attention', 'supplier_reply_overdue', 'supplier_overdue:' || r.id || ':' || r.reply_by::text,
      jsonb_build_object('pricing_file_id', r.file_id));
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pricing_notify_overdue_suppliers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_notify_overdue_suppliers() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — the supplier overdue reminder is not scheduled.';
    RETURN;
  END IF;
  PERFORM cron.unschedule('pricing-supplier-overdue') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pricing-supplier-overdue');
  -- 05:15 UTC = 08:15 in Riyadh.
  PERFORM cron.schedule('pricing-supplier-overdue', '15 5 * * *', $job$ SELECT public.pricing_notify_overdue_suppliers(); $job$);
END $$;
```

- [ ] **Step 4: Run the DB tests**

Run: `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`
Expected: `supplier_returns_overdue.test.sql .. ok` (27 tests), `supplier_isolation_sweep.test.sql .. ok` (12 tests), every other file ok. Locally pg_cron is not installed, so the migration prints a NOTICE and schedules nothing; that is expected.

If the sweep's function list fails after a future change, the new function must check the caller (see Global Constraints) rather than be added to the list, unless it is truly harmless to a supplier (id-keyed, own data, or a boolean); say which in the commit.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261108150000_supplier_returns_overdue.sql supabase/tests/supplier_returns_overdue.test.sql supabase/tests/supplier_isolation_sweep.test.sql
git commit -m "feat(pricing): returned lines reopen alone, overdue reminder, supplier isolation sweep" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Supplier accounts and downloads in sales-os-api; every other function refuses suppliers (Edge)

**Files:**
- Create: `supabase/functions/_shared/supplier-portal.ts`
- Create: `supabase/functions/_shared/supplier-portal.deno-test.ts`
- Create: `supabase/functions/sales-os-api/handlers/supplier-portal.ts`
- Modify: `supabase/functions/_shared/supabase.ts` (`resolveCaller`)
- Modify: `supabase/functions/sales-os-api/router.ts`, `supabase/functions/sales-os-api/index.ts`
- Test: `src/lib/sales-os-api-router.test.ts`, `src/lib/sales-os-api-modularization.contract.test.ts`

**Interfaces:**
- Consumes: Task 1 `supplier_account_prepare`, `supplier_account_activate` (service role), `supplier_account_email`; Task 3 `supplier_portal_file`; Task 1's `"supplier"` in `_shared/roles.ts` (and in `MFA_REQUIRED_ROLES`).
- Produces:
  - `SUPPLIER_ACTIONS = ["supplier_file_link"]`, `callerMayUseAction(roles, action): boolean`, `normalizeSupplierEmail(raw): string | null`, `appUrl(env): string` in `_shared/supplier-portal.ts`.
  - `resolveCaller(authHeader, options?: { allowSupplier?: boolean })`: a supplier is refused `{status: 403, message: "Supplier accounts use the supplier portal only"}` unless `allowSupplier`; then MFA (`aal2`) is still required.
  - `SalesOsRouterDependencies.authorizeAction?: (caller, action) => boolean` → 403 `"This account cannot use this action"`.
  - sales-os-api actions (module `supplier-portal`):
    - `supplier_account_create` payload `{vendorId, email, fullName}` → `{ok, user_id, set_password_url}` (`set_password_url` may be null if the link could not be made).
    - `supplier_account_password_link` payload `{userId}` → `{ok, set_password_url}`.
    - `supplier_file_link` payload `{invitationId, fileId}` → `{ok, url}` (5-minute signed download link; the only action a supplier may call).
  - Function deploys at release: `sales-os-api` (required), `ai-orchestrator` and `import-pipeline` (carry the shared supplier refusal).

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/_shared/supplier-portal.deno-test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appUrl, callerMayUseAction, normalizeSupplierEmail, SUPPLIER_ACTIONS } from "./supplier-portal.ts";
import { resolveCaller } from "./supabase.ts";

Deno.test("a supplier account may call only the supplier actions", () => {
  assertEquals(SUPPLIER_ACTIONS, ["supplier_file_link"]);
  assertEquals(callerMayUseAction(["supplier"], "supplier_file_link"), true);
  assertEquals(callerMayUseAction(["supplier"], "send_email"), false);
  assertEquals(callerMayUseAction(["supplier"], "supplier_account_create"), false);
  assertEquals(callerMayUseAction(["estimation_manager", "finance_manager"], "supplier_account_create"), true);
  assertEquals(callerMayUseAction([], "daily_assistant"), true);
});

Deno.test("supplier emails are trimmed, lower-cased and checked", () => {
  assertEquals(normalizeSupplierEmail("  Robbie@Factory.Example "), "robbie@factory.example");
  assertEquals(normalizeSupplierEmail("not-an-email"), null);
  assertEquals(normalizeSupplierEmail(""), null);
  assertEquals(normalizeSupplierEmail(undefined), null);
  assertEquals(normalizeSupplierEmail(`${"a".repeat(250)}@x.io`), null);
});

Deno.test("the app URL comes from APP_URL, without a trailing slash", () => {
  assertEquals(appUrl(() => undefined), "https://agent.phc-sa.com");
  assertEquals(appUrl((k) => (k === "APP_URL" ? "https://canary.example//" : undefined)), "https://canary.example");
});

Deno.test("resolveCaller refuses a supplier unless the function admits suppliers, and then still needs MFA", async () => {
  const oldFetch = globalThis.fetch;
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"];
  const oldEnv = keys.map((k) => Deno.env.get(k));
  Deno.env.set("SUPABASE_URL", "https://supplier.invalid");
  Deno.env.set("SUPABASE_ANON_KEY", "supplier-public");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "supplier-service");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  let role = "supplier";
  const reply = (data: unknown, code = 200) =>
    new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "supplier.invalid") throw new Error("Unexpected external request");
    if (url.pathname === "/auth/v1/user") return reply({ id: "b0000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated" });
    if (url.pathname === "/rest/v1/profiles") return reply({ status: "active" });
    if (url.pathname === "/rest/v1/user_roles") return reply([{ role }]);
    return reply({ message: "not found" }, 404);
  }) as typeof fetch;
  const outcome = (p: Promise<unknown>) => p.then(() => null, (e) => e as { status: number; message: string });
  try {
    assertEquals(await outcome(resolveCaller("Bearer not-a-jwt")), {
      status: 403,
      message: "Supplier accounts use the supplier portal only",
    });
    assertEquals(await outcome(resolveCaller("Bearer not-a-jwt", { allowSupplier: true })), {
      status: 403,
      message: "MFA verification required",
    });
    role = "bd_manager";
    assertEquals(await outcome(resolveCaller("Bearer not-a-jwt")), null);
  } finally {
    globalThis.fetch = oldFetch;
    keys.forEach((k, i) => (oldEnv[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, oldEnv[i]!)));
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `deno test --frozen --allow-import --config supabase/functions/deno.json --allow-env --allow-net --allow-read supabase/functions/_shared/supplier-portal.deno-test.ts`
Expected: FAIL, module `./supplier-portal.ts` not found.

- [ ] **Step 3: Write the helpers and the `resolveCaller` refusal**

Create `supabase/functions/_shared/supplier-portal.ts`:

```ts
// =============================================================================
// Supplier accounts at the function boundary (pricing loop PR 3).
//
// A supplier account is external. resolveCaller refuses it in every function
// unless the function opts in (sales-os-api does), and sales-os-api then lets
// it call SUPPLIER_ACTIONS only. Everything else here is a pure helper so the
// rules are tested without a network.
// =============================================================================

import type { AppRole } from "./roles.ts";

/** The sales-os-api actions a supplier account may call. Every other action answers 403. */
export const SUPPLIER_ACTIONS: readonly string[] = ["supplier_file_link"];

export function callerMayUseAction(roles: readonly AppRole[], action: string): boolean {
  return !roles.includes("supplier") || SUPPLIER_ACTIONS.includes(action);
}

/** Trimmed and lower-cased, or null when it is not an email address. */
export function normalizeSupplierEmail(raw: unknown): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  return e.length > 0 && e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

export const DEFAULT_APP_URL = "https://agent.phc-sa.com";

/** The app's origin for links in messages (same setting outlook-connector reads). */
export function appUrl(env: (key: string) => string | undefined): string {
  return (env("APP_URL") ?? DEFAULT_APP_URL).replace(/\/+$/, "");
}
```

In `supabase/functions/_shared/supabase.ts`, replace

```ts
// Resolve the caller: their user id and roles. Throws a 401-style error object
// if the JWT is missing or invalid.
export async function resolveCaller(
  authHeader: string | null,
): Promise<{ userId: string; roles: AppRole[] }> {
```

with

```ts
// Resolve the caller: their user id and roles. Throws a 401-style error object
// if the JWT is missing or invalid.
//
// A supplier account (pricing loop PR 3) is refused with 403 unless the function
// passes allowSupplier: a supplier reaches the supplier portal and nothing else.
// sales-os-api opts in and then admits only its supplier actions.
export async function resolveCaller(
  authHeader: string | null,
  options: { allowSupplier?: boolean } = {},
): Promise<{ userId: string; roles: AppRole[] }> {
```

and replace

```ts
  const { data: profile, error: profileError } = await svc.from("profiles").select("status").eq("id", userData.user.id).single();
```

with (Task 1 fix round 1: `profiles.vendor_id` is what makes an account a supplier; the role row is a second marker)

```ts
  const { data: profile, error: profileError } = await svc.from("profiles").select("status, vendor_id").eq("id", userData.user.id).single();
```

and replace

```ts
  const roles = (roleRows ?? []).map((r: { role: AppRole }) => r.role);
  if (requiresMfa(roles)) {
```

with

```ts
  const roles = (roleRows ?? []).map((r: { role: AppRole }) => r.role);
  if (profile.vendor_id && !roles.includes("supplier")) roles.push("supplier");
  if (roles.includes("supplier") && !options.allowSupplier) {
    throw { status: 403, message: "Supplier accounts use the supplier portal only" };
  }
  if (requiresMfa(roles)) {
```

- [ ] **Step 4: Run the Deno tests**

Run: `bun run test:deno`
Expected: PASS, including the four new tests and `audit-boundaries.deno-test.ts`.

- [ ] **Step 5: Write the failing router test**

Append to `src/lib/sales-os-api-router.test.ts`:

```ts
test("router lets authorizeAction refuse a caller before the handler runs", async () => {
  let ran = 0;
  const route = createSalesOsRequestHandler({
    handlers: { known: async () => { ran += 1; return new Response("ran"); } },
    corsHeaders: {},
    errorResponse,
    resolveCaller: async () => ({ userId: "supplier-1", roles: ["supplier"] }),
    authorizeAction: (who, action) => !who.roles.includes("supplier") || action === "supplier_file_link",
    createContext: (resolvedCaller, authorization) =>
      createSalesOsContext(resolvedCaller, authorization, () => ({}) as never, () => ({}) as never, audit as never),
  });
  const response = await route(
    new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer test" },
      body: JSON.stringify({ action: "known" }),
    }),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "This account cannot use this action" });
  expect(ran).toBe(0);
});
```

Run: `bun test src/lib/sales-os-api-router.test.ts`
Expected: FAIL (status 200, the handler ran).

- [ ] **Step 6: Add the per-action gate to the router**

In `supabase/functions/sales-os-api/router.ts`, replace

```ts
  readonly createContext: (caller: SalesOsCaller, authorization: string) => SalesOsContext;
}
```

with

```ts
  readonly createContext: (caller: SalesOsCaller, authorization: string) => SalesOsContext;
  /** Optional per-action gate after the caller is known (supplier accounts: their actions only). */
  readonly authorizeAction?: (caller: SalesOsCaller, action: string) => boolean;
}
```

and replace

```ts
    try {
      return await handler(body.payload ?? {}, dependencies.createContext(caller, authorization!));
```

with

```ts
    if (dependencies.authorizeAction && !dependencies.authorizeAction(caller, action)) {
      return dependencies.errorResponse("This account cannot use this action", 403);
    }

    try {
      return await handler(body.payload ?? {}, dependencies.createContext(caller, authorization!));
```

Run: `bun test src/lib/sales-os-api-router.test.ts`
Expected: PASS.

- [ ] **Step 7: Register the module (failing contract test first)**

In `src/lib/sales-os-api-modularization.contract.test.ts`, replace

```ts
    "flag_duplicate",
    "resolve_duplicate_group",
  ],
} as const;
```

with

```ts
    "flag_duplicate",
    "resolve_duplicate_group",
  ],
  "supplier-portal": ["supplier_account_create", "supplier_account_password_link", "supplier_file_link"],
} as const;
```

Run: `bun test src/lib/sales-os-api-modularization.contract.test.ts`
Expected: FAIL (`handlers/supplier-portal.ts` not found).

Create `supabase/functions/sales-os-api/handlers/supplier-portal.ts`:

```ts
// =============================================================================
// Supplier accounts and supplier downloads (pricing loop PR 3).
//
// supplier_account_create: a pricer (or the system administrator) creates a
//   portal account for one vendor. The database decides who may and records the
//   request (supplier_account_prepare, as the caller); the sign-in account is
//   created here with the service role, carrying the request id in
//   app_metadata (the only way past the @phc-sa.com rule, which a sign-up
//   cannot set); supplier_account_activate links it to the vendor. The answer
//   is a one-time set-password link the pricer sends to the supplier: no
//   automated email exists yet (Postmark is not approved, info@ is deferred).
// supplier_account_password_link: a new set-password link for an existing
//   supplier account (the old one expired, or the supplier lost it).
// supplier_file_link: the one action a supplier account may call. The database
//   says which file and checks it is the version sent (supplier_portal_file,
//   as the caller); the signed link is made here because a supplier has no
//   storage access of its own. Five minutes, download only.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../shared.ts";
import { appUrl, normalizeSupplierEmail } from "../../_shared/supplier-portal.ts";

const env = (k: string) => Deno.env.get(k);
const SIGNED_URL_SECONDS = 300;

type DbError = { message?: string; code?: string } | null;

function dbError(e: DbError, fallback: string): Response {
  const status = e?.code === "42501" ? 403 : e?.code === "23514" ? 400 : 409;
  return err(e?.message ?? fallback, status);
}

async function setPasswordLink(ctx: SalesOsContext, email: string): Promise<string | null> {
  const { data, error } = await ctx.svc.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl(env)}/reset-password` },
  });
  if (error) return null;
  return data?.properties?.action_link ?? null;
}

async function supplier_account_create(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const vendorId = String(payload.vendorId ?? "");
  const fullName = String(payload.fullName ?? "").trim();
  const email = normalizeSupplierEmail(payload.email);
  if (!email) return err("Enter the supplier's email address. | أدخل بريد المورد.", 400);

  // 1. The database decides who may, and records the request.
  const { data: inviteId, error: prepareError } = await ctx.asCaller.rpc("supplier_account_prepare", {
    _vendor_id: vendorId,
    _email: email,
    _full_name: fullName,
  });
  if (prepareError || typeof inviteId !== "string") return dbError(prepareError, "Could not prepare the supplier account");

  // 2. The sign-in account. Only the service role can set app_metadata.
  const { data: created, error: createError } = await ctx.svc.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { phc_supplier_invite: inviteId },
  });
  if (createError || !created?.user) return err("Could not create the sign-in account", 409);

  // 3. Link it to the vendor and give it the supplier role; undo the sign-in account if that fails.
  const { error: activateError } = await ctx.svc.rpc("supplier_account_activate", {
    _invite_id: inviteId,
    _user_id: created.user.id,
  });
  if (activateError) {
    await ctx.svc.auth.admin.deleteUser(created.user.id);
    return dbError(activateError, "Could not link the supplier account");
  }

  const url = await setPasswordLink(ctx, email);
  await ctx.audit(ctx.svc, ctx.caller.userId, "supplier_account.link_issued", "user", created.user.id, {}, ctx.caller.roles);
  return json({ ok: true, user_id: created.user.id, set_password_url: url });
}

async function supplier_account_password_link(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const userId = String(payload.userId ?? "");
  const { data: email, error } = await ctx.asCaller.rpc("supplier_account_email", { _user_id: userId });
  if (error || typeof email !== "string") return dbError(error, "Not an active supplier account");
  const url = await setPasswordLink(ctx, email);
  if (!url) return err("Could not make a set-password link", 502);
  await ctx.audit(ctx.svc, ctx.caller.userId, "supplier_account.link_issued", "user", userId, {}, ctx.caller.roles);
  return json({ ok: true, set_password_url: url });
}

async function supplier_file_link(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { data, error } = await ctx.asCaller.rpc("supplier_portal_file", {
    _invitation_id: String(payload.invitationId ?? ""),
    _file_id: String(payload.fileId ?? ""),
  });
  if (error || !data) return dbError(error, "This file is not available");
  const file = data as { bucket: string; path: string; name: string };
  const { data: signed, error: signError } = await ctx.svc.storage
    .from(file.bucket)
    .createSignedUrl(file.path, SIGNED_URL_SECONDS, { download: file.name });
  if (signError || !signed?.signedUrl) return err("Could not prepare the download", 502);
  return json({ ok: true, url: signed.signedUrl });
}

export const supplierPortalModule: HandlerModule = {
  name: "supplier-portal",
  handlers: { supplier_account_create, supplier_account_password_link, supplier_file_link },
};
```

In `supabase/functions/sales-os-api/index.ts`, replace

```ts
import { pipelineModule } from "./handlers/pipeline.ts";
```

with

```ts
import { pipelineModule } from "./handlers/pipeline.ts";
import { supplierPortalModule } from "./handlers/supplier-portal.ts";
import { callerMayUseAction } from "../_shared/supplier-portal.ts";
```

replace

```ts
  infoMailModule,
]);
```

with

```ts
  infoMailModule,
  supplierPortalModule,
]);
```

and replace

```ts
  resolveCaller,
  createContext:
```

with

```ts
  // Supplier accounts get through resolveCaller here, then only to their own actions.
  resolveCaller: (authorization) => resolveCaller(authorization, { allowSupplier: true }),
  authorizeAction: (caller, action) => callerMayUseAction(caller.roles, action),
  createContext:
```

- [ ] **Step 8: Run the checks**

Run: `bun test src/lib/sales-os-api-router.test.ts src/lib/sales-os-api-modularization.contract.test.ts && bun run test:deno && deno check --frozen --allow-import --config supabase/functions/deno.json supabase/functions/sales-os-api/index.ts supabase/functions/ai-orchestrator/index.ts supabase/functions/import-pipeline/index.ts`
Expected: all pass; `deno check` prints only `Check …` lines.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/supplier-portal.ts supabase/functions/_shared/supplier-portal.deno-test.ts \
  supabase/functions/_shared/supabase.ts supabase/functions/sales-os-api/router.ts supabase/functions/sales-os-api/index.ts \
  supabase/functions/sales-os-api/handlers/supplier-portal.ts src/lib/sales-os-api-router.test.ts \
  src/lib/sales-os-api-modularization.contract.test.ts
git commit -m "feat(sales-os-api): supplier accounts, supplier downloads, and suppliers refused everywhere else" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: TypeScript layer: portal logic, wrappers, notification targets

**Files:**
- Create: `src/lib/supplier-portal.ts`, `src/lib/supplier-portal.test.ts`, `src/lib/supplier-portal.contract.test.ts`
- Create: `src/lib/supplier-portal-actions.ts`
- Modify: `src/lib/pricing-actions.ts`, `src/lib/pricing-actions.contract.test.ts`
- Modify: `src/lib/notification-target.ts`, `src/lib/notification-target.test.ts`, `src/lib/i18n.tsx`

**Interfaces:**
- Consumes: Tasks 1–6 (SQL signatures and the three sales-os-api actions); `parseDraft`, `draftText`, `DraftRules`, `DraftFailure` (`src/lib/pricing-input.ts`); `callBackend` (`src/lib/backend.ts`).
- Produces (later tasks use these exact names):
  - `src/lib/supplier-portal.ts`: types `PortalStatus`, `PortalListRow`, `PortalLine`, `PortalFile`, `PortalInvitation`, `LineDraft`, `TermsDraft`, `SubmissionLine`, `SubmissionTerms`, `SubmissionProblem`, `SubmissionError`, `PortalRedirect`, `GateInput`; constants `PORTAL_STATUS_LABEL`, `PORTAL_CONFIRMATION`, `PRICE_RULES`, `LEAD_RULES`; functions `buildSubmission(lines, drafts, terms, today)`, `riyadhToday(now?)`, `daysLeft(replyBy, today)`, `isOverdue(replyBy, today)`, `portalLink(origin, invitationId?)`, `inviteMessage(link, lang)`, `accountMessage(setPasswordUrl, signInUrl, lang)`, `supplierGate(input, next) → { redirect, signOut }`.
  - `src/lib/supplier-portal-actions.ts`: `listPortalInvitations()`, `getPortalInvitation(id)`, `submitPortalQuote(id, lines, terms, lang)`, `getPortalFileUrl(invitationId, fileId) → Promise<string>`.
  - `src/lib/pricing-actions.ts`: `enterSupplierQuote(fileId, vendorId, lines, terms, documentId?)`; `InvitationStatus`, `OPEN_INVITATION`, `InvitationRow`, `listFileInvitations(fileId)`, `InvitationLineRow`, `listInvitationLines(id)`, `InvitationFileRow`, `listInvitationFiles(id)`, `SubmissionRow`, `listInvitationSubmissions(id)`, `EarlierQuoteRow`, `listEarlierQuotes(revisionId)`, `sendToSupplier(fileId, vendorId, replyBy, documentIds, instructions, replaceEarlier)`, `cancelInvitation(id, reason)`, `extendInvitation(id, replyBy)`, `returnLinesToSupplier(fileId, boqLineIds, replyBy, note, message)`, `SupplierAccountRow`, `listSupplierAccounts(vendorId)`, `createSupplierAccount(vendorId, email, fullName)`, `newSupplierPasswordLink(userId)`.
  - `targetFor` / `resolveTarget`: a notification with `metadata.pricing_file_id` opens `/pricing/<id>` without a lookup.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/supplier-portal.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  accountMessage, buildSubmission, daysLeft, inviteMessage, isOverdue, portalLink, riyadhToday, supplierGate,
  type PortalLine,
} from "./supplier-portal";

const line = (id: string, over: Partial<PortalLine> = {}): PortalLine => ({
  line_id: id, line_number: 1, sign_type: "Pylon", description: null, dimensions: null, material: null, mounting: null,
  illumination: null, finish: null, quantity: 2, unit: "pcs", width_mm: null, height_mm: null, has_screen: true,
  state: "open", editable: true, unit_cost: null, unit_cost_with_screen: null, spec_difference: null, ...over,
});
const TERMS = { lead: "30", payment: "30% advance", valid: "2099-12-31" };
const TODAY = "2026-11-08";

describe("buildSubmission", () => {
  it("sends every editable line, typed or kept, and the three terms", () => {
    const r = buildSubmission(
      [line("a"), line("b", { unit_cost: 50, spec_difference: "Acrylic" }), line("c", { editable: false, state: "submitted", unit_cost: 9 })],
      { a: { unit_cost: "1,200.5", unit_cost_with_screen: "1500", spec_difference: "  Aluminium  " } },
      TERMS,
      TODAY,
    );
    expect(r).toEqual({
      ok: true,
      lines: [
        { line_id: "a", unit_cost: 1200.5, unit_cost_with_screen: 1500, spec_difference: "Aluminium" },
        { line_id: "b", unit_cost: 50, unit_cost_with_screen: null, spec_difference: "Acrylic" },
      ],
      terms: { lead_time_days: 30, payment_terms: "30% advance", valid_until: "2099-12-31" },
    });
  });
  it("an emptied box sends no price", () => {
    const r = buildSubmission([line("a", { unit_cost: 50 }), line("b", { unit_cost: 9 })], { a: { unit_cost: "" } }, TERMS, TODAY);
    expect(r.ok && r.lines[0].unit_cost).toBe(null);
  });
  it("names every box that needs fixing", () => {
    const r = buildSubmission(
      [line("a"), line("b")],
      { a: { unit_cost: "-5" }, b: { unit_cost: "12 pcs", spec_difference: "x".repeat(501) } },
      { lead: "3.5", payment: " ", valid: "2020-01-01" },
      TODAY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        { key: "a:unit_cost", problem: "range" },
        { key: "b:unit_cost", problem: "not_a_number" },
        { key: "b:spec_difference", problem: "too_long" },
        { key: "lead", problem: "not_integer" },
        { key: "payment", problem: "required" },
        { key: "valid", problem: "past_date" },
      ]);
    }
  });
  it("needs at least one price, a lead time and a date", () => {
    const r = buildSubmission([line("a")], {}, { lead: "", payment: "Net 30", valid: "" }, TODAY);
    expect(!r.ok && r.errors.map((e) => `${e.key}:${e.problem}`)).toEqual(["lines:no_price", "lead:required", "valid:required"]);
  });
  it("accepts Arabic-Indic digits typed by the supplier", () => {
    const r = buildSubmission([line("a")], { a: { unit_cost: "١٢٠" } }, TERMS, TODAY);
    expect(r.ok && r.lines[0].unit_cost).toBe(120);
  });
});

describe("dates", () => {
  it("counts days to the reply-by date, negative when late", () => {
    expect(daysLeft("2026-11-10", TODAY)).toBe(2);
    expect(daysLeft("2026-11-06", TODAY)).toBe(-2);
    expect(isOverdue("2026-11-07", TODAY)).toBe(true);
    expect(isOverdue(TODAY, TODAY)).toBe(false);
  });
  it("today is Riyadh's date, not UTC's", () => {
    expect(riyadhToday(new Date("2026-11-07T22:30:00Z"))).toBe("2026-11-08");
  });
});

describe("messages", () => {
  it("the invite carries the portal link and no project detail", () => {
    const link = portalLink("https://agent.phc-sa.com/", "abc");
    expect(link).toBe("https://agent.phc-sa.com/supplier/abc");
    expect(inviteMessage(link, "en")).toBe(`PHC has sent you a new pricing request. Sign in to the PHC supplier portal to see it: ${link}`);
    expect(inviteMessage(link, "ar")).toContain(link);
    expect(portalLink("https://agent.phc-sa.com")).toBe("https://agent.phc-sa.com/supplier");
  });
  it("the account message has the set-password link and the sign-in page", () => {
    expect(accountMessage("https://x/set", "https://agent.phc-sa.com/auth", "en")).toContain("https://x/set");
    expect(accountMessage("https://x/set", "https://agent.phc-sa.com/auth", "ar")).toContain("https://agent.phc-sa.com/auth");
  });
});

describe("supplierGate", () => {
  const ok = { signedIn: true, status: "active", roles: ["supplier"] as const, aal: { currentLevel: "aal2", nextLevel: "aal2" } };
  it("lets an active supplier with MFA in", () => expect(supplierGate(ok, "/supplier")).toEqual({ redirect: null, signOut: false }));
  it("sends everyone else where they belong", () => {
    expect(supplierGate({ ...ok, signedIn: false }, "/supplier/x").redirect).toEqual({ to: "/auth", search: { next: "/supplier/x" } });
    expect(supplierGate({ ...ok, status: "pending_approval" }, "").redirect).toEqual({ to: "/pending-approval" });
    expect(supplierGate({ ...ok, status: "suspended" }, "")).toEqual({ redirect: { to: "/auth", search: { next: "" } }, signOut: true });
    expect(supplierGate({ ...ok, roles: ["estimation_manager"] }, "").redirect).toEqual({ to: "/" });
    expect(supplierGate({ ...ok, aal: { currentLevel: "aal1", nextLevel: "aal1" } }, "").redirect).toEqual({ to: "/mfa-setup" });
    expect(supplierGate({ ...ok, aal: { currentLevel: "aal1", nextLevel: "aal2" } }, "").redirect).toEqual({ to: "/mfa-verify" });
  });
});
```

Create `src/lib/supplier-portal.contract.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PORTAL_CONFIRMATION } from "./supplier-portal";
import { SUPPLIER_ACTIONS } from "../../supabase/functions/_shared/supplier-portal";

// The browser and the database agree on the supplier portal's fixed parts.
const dir = new URL("../../supabase/migrations/", import.meta.url);
const SQL = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("supplier portal contract", () => {
  it("the confirmation the supplier reads is the one the database stores", () => {
    const fn = SQL.slice(SQL.lastIndexOf("CREATE OR REPLACE FUNCTION public.supplier_portal_confirmation("));
    expect(fn).toContain(`WHEN 'en' THEN '${PORTAL_CONFIRMATION.en.replace(/'/g, "''")}'`);
    expect(fn).toContain(`WHEN 'ar' THEN '${PORTAL_CONFIRMATION.ar.replace(/'/g, "''")}'`);
  });

  it("every sales-os-api action the screens call is registered, and a supplier may call only its own", () => {
    const handlers = read("../../supabase/functions/sales-os-api/handlers/supplier-portal.ts");
    const manifest = handlers.match(/handlers:\s*\{([^}]+)\}/)?.[1].split(",").map((s) => s.trim()) ?? [];
    const called = (src: string) => [...src.matchAll(/callBackend(?:<[^>]*>)?\(\s*"(supplier_\w+)"/g)].map((m) => m[1]);
    const pricer = called(read("./pricing-actions.ts"));
    const supplier = called(read("./supplier-portal-actions.ts"));
    expect(pricer.sort()).toEqual(["supplier_account_create", "supplier_account_password_link"]);
    expect(supplier).toEqual(["supplier_file_link"]);
    for (const a of [...pricer, ...supplier]) expect(manifest).toContain(a);
    expect([...SUPPLIER_ACTIONS]).toEqual(supplier);
  });

  it("supplier_portal_invitation never returns a site, a deal or a BOQ id", () => {
    const fn = SQL.slice(SQL.lastIndexOf("CREATE OR REPLACE FUNCTION public.supplier_portal_invitation("));
    const body = fn.slice(0, fn.indexOf("END $$;"));
    expect(body).toContain("'line_id', il.id");
    for (const leak of ["'location'", "'opportunity_id'", "'project_name'", "'boq_line_id'", "'vendor_id'"]) {
      expect(body).not.toContain(leak);
    }
  });
});
```

Append to `src/lib/notification-target.test.ts`:

```ts
describe("a pricing notice (PR 3)", () => {
  const notice = { entity_type: "opportunity", entity_id: "opp-1", metadata: { pricing_file_id: "pf-1" } };
  it("opens the pricing file, not the deal", () => {
    expect(targetFor(notice, null)).toEqual({ to: "/pricing/pf-1" });
    expect(targetFor(notice, "opp-1")).toEqual({ to: "/pricing/pf-1" });
  });
  it("reads nothing first", async () => {
    let reads = 0;
    const target = await resolveTarget(notice, async () => {
      reads += 1;
      return null;
    });
    expect(target).toEqual({ to: "/pricing/pf-1" });
    expect(reads).toBe(0);
  });
});
```

In `src/lib/pricing-actions.contract.test.ts`, replace

```ts
const SRC = readFileSync(new URL("./pricing-actions.ts", import.meta.url), "utf8");
```

with

```ts
// The supplier portal's wrappers (PR 3) follow the same rules.
const SRC = ["./pricing-actions.ts", "./supplier-portal-actions.ts"]
  .map((f) => readFileSync(new URL(f, import.meta.url), "utf8"))
  .join("\n");
/** RPCs that take no parameter. */
const NO_PARAMS = new Set(["pricing_my_rights", "supplier_portal_invitations"]);
```

and replace

```ts
    if (fn !== "pricing_my_rights") expect(required.length).toBeGreaterThan(0);
```

with

```ts
    if (!NO_PARAMS.has(fn)) expect(required.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test src/lib/supplier-portal.test.ts src/lib/supplier-portal.contract.test.ts src/lib/notification-target.test.ts src/lib/pricing-actions.contract.test.ts`
Expected: FAIL (modules `./supplier-portal` and `./supplier-portal-actions.ts` not found; the pricing notice opens the deal).

- [ ] **Step 3: Write `src/lib/supplier-portal.ts`**

```ts
// The supplier portal's rules in the browser (pricing loop PR 3). SQL decides
// (supplier_portal_* in 20261108130000 and 20261108140000); this only shapes
// what the supplier types into what supplier_portal_submit takes, decides where
// the portal's guard sends a session, and words the messages the pricer copies.
// supplier-portal.test.ts pins it.
import type { Lang } from "@/lib/i18n";
import type { AppRole } from "@/lib/roles";
import { parseDraft, type DraftFailure, type DraftRules } from "@/lib/pricing-input";
import type { Bi } from "@/lib/pricing-text";

export type PortalStatus = "open" | "returned" | "submitted" | "closed";
export const PORTAL_STATUS_LABEL: Record<PortalStatus, Bi> = {
  open: { en: "Waiting for your prices", ar: "بانتظار أسعارك" },
  returned: { en: "Returned for changes", ar: "أُعيد للتعديل" },
  submitted: { en: "Submitted", ar: "أُرسل" },
  closed: { en: "Closed", ar: "مغلق" },
};

/** supplier_portal_invitations() rows. */
export type PortalListRow = {
  invitation_id: string;
  project_code: string;
  reply_by: string;
  status: PortalStatus;
  sent_at: string;
  submitted_at: string | null;
  lines: number;
  open_lines: number;
};

export type PortalLine = {
  line_id: string;
  line_number: number | null;
  sign_type: string | null;
  description: string | null;
  dimensions: string | null;
  material: string | null;
  mounting: string | null;
  illumination: string | null;
  finish: string | null;
  quantity: number;
  unit: string | null;
  width_mm: number | null;
  height_mm: number | null;
  has_screen: boolean | null;
  state: "open" | "submitted" | "reopened";
  editable: boolean;
  unit_cost: number | null;
  unit_cost_with_screen: number | null;
  spec_difference: string | null;
};
export type PortalFile = { file_id: string; name: string; size_bytes: number | null; mime_type: string | null };

/** supplier_portal_invitation(id). */
export type PortalInvitation = {
  invitation_id: string;
  project_code: string;
  reply_by: string;
  sent_at: string;
  instructions: string | null;
  return_message: string | null;
  status: PortalStatus;
  editable: boolean;
  terms: { lead_time_days: number | null; payment_terms: string | null; valid_until: string | null };
  lines: PortalLine[];
  files: PortalFile[];
};

/** supplier_portal_confirmation(lang) returns the same two strings (supplier-portal.contract.test.ts). */
export const PORTAL_CONFIRMATION: Bi = {
  en: "My prices are based only on the files attached to this request; any material or spec difference is written on its line.",
  ar: "أسعاري مبنية فقط على الملفات المرفقة بهذا الطلب، وأي اختلاف في الخامة أو المواصفة مكتوب على سطره.",
};

// numeric(14,2) in the database; the SQL refuses 1e12 and above.
export const PRICE_RULES: DraftRules = { min: 0, below: 1e12 };
export const LEAD_RULES: DraftRules = { min: 0, max: 9999, integer: true };

export type LineDraft = { unit_cost?: string; unit_cost_with_screen?: string; spec_difference?: string };
export type TermsDraft = { lead: string; payment: string; valid: string };
export type SubmissionLine = {
  line_id: string;
  unit_cost: number | null;
  unit_cost_with_screen: number | null;
  spec_difference: string | null;
};
export type SubmissionTerms = { lead_time_days: number; payment_terms: string; valid_until: string };
export type SubmissionProblem = DraftFailure | "required" | "too_long" | "past_date" | "no_price";
/** key: `<line_id>:<field>` for a line box, "lead" / "payment" / "valid" for the terms, "lines" for the whole table. */
export type SubmissionError = { key: string; problem: SubmissionProblem };

const text = (lineDraft: string | undefined, saved: number | null): string =>
  lineDraft !== undefined ? lineDraft : saved == null ? "" : String(saved);

/**
 * What supplier_portal_submit takes, or every box that needs fixing. Only the
 * editable lines are sent (the SQL refuses any other), each one, priced or not;
 * a box the supplier did not touch keeps the price already on file.
 */
export function buildSubmission(
  lines: readonly PortalLine[],
  drafts: Readonly<Record<string, LineDraft>>,
  terms: TermsDraft,
  today: string,
): { ok: true; lines: SubmissionLine[]; terms: SubmissionTerms } | { ok: false; errors: SubmissionError[] } {
  const errors: SubmissionError[] = [];
  const out: SubmissionLine[] = [];
  for (const l of lines.filter((x) => x.editable)) {
    const d = drafts[l.line_id] ?? {};
    const unit = parseDraft(text(d.unit_cost, l.unit_cost), PRICE_RULES);
    const screen = parseDraft(text(d.unit_cost_with_screen, l.unit_cost_with_screen), PRICE_RULES);
    const spec = (d.spec_difference !== undefined ? d.spec_difference : (l.spec_difference ?? "")).trim();
    if (!unit.ok) errors.push({ key: `${l.line_id}:unit_cost`, problem: unit.reason });
    if (!screen.ok) errors.push({ key: `${l.line_id}:unit_cost_with_screen`, problem: screen.reason });
    if (spec.length > 500) errors.push({ key: `${l.line_id}:spec_difference`, problem: "too_long" });
    out.push({
      line_id: l.line_id,
      unit_cost: unit.ok ? unit.value : null,
      unit_cost_with_screen: screen.ok ? screen.value : null,
      spec_difference: spec || null,
    });
  }
  if (out.length > 0 && errors.length === 0 && out.every((l) => l.unit_cost == null)) errors.push({ key: "lines", problem: "no_price" });
  const lead = parseDraft(terms.lead, LEAD_RULES);
  if (!lead.ok) errors.push({ key: "lead", problem: lead.reason });
  else if (lead.value == null) errors.push({ key: "lead", problem: "required" });
  const payment = terms.payment.trim();
  if (!payment) errors.push({ key: "payment", problem: "required" });
  else if (payment.length > 500) errors.push({ key: "payment", problem: "too_long" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(terms.valid)) errors.push({ key: "valid", problem: "required" });
  else if (terms.valid < today) errors.push({ key: "valid", problem: "past_date" });
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    lines: out,
    terms: { lead_time_days: (lead as { value: number }).value, payment_terms: payment, valid_until: terms.valid },
  };
}

/** Today in Riyadh, YYYY-MM-DD: reply-by dates are Saudi business days (SQL: _pricing_today()). */
export const riyadhToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Whole days from today to the reply-by date: negative when overdue. */
export function daysLeft(replyBy: string, today: string): number {
  return Math.round((Date.parse(`${replyBy}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
export const isOverdue = (replyBy: string, today: string): boolean => daysLeft(replyBy, today) < 0;

/** The portal link a pricer sends: the list, or one request. */
export const portalLink = (origin: string, invitationId?: string): string =>
  `${origin.replace(/\/+$/, "")}/supplier${invitationId ? `/${invitationId}` : ""}`;

/** The invite text: the portal link only, no project details (spec section 2). */
export function inviteMessage(link: string, lang: Lang): string {
  return lang === "ar"
    ? `أرسلت لكم PHC طلب تسعير جديداً. سجّلوا الدخول إلى بوابة الموردين لرؤيته: ${link}`
    : `PHC has sent you a new pricing request. Sign in to the PHC supplier portal to see it: ${link}`;
}

/** The new-account text: the one-time set-password link, then where to sign in. */
export function accountMessage(setPasswordUrl: string, signInUrl: string, lang: Lang): string {
  return lang === "ar"
    ? `أُنشئ حسابكم في بوابة موردي PHC. اختاروا كلمة المرور من هذا الرابط (يعمل مرة واحدة ولفترة محدودة): ${setPasswordUrl}\nثم سجّلوا الدخول من ${signInUrl} وفعّلوا التحقق بخطوتين.`
    : `Your PHC supplier portal account is ready. Choose your password with this link (it works once, for a limited time): ${setPasswordUrl}\nThen sign in at ${signInUrl} and set up two-step verification.`;
}

/** Where the portal's guard sends a session. null: let it in. */
export type PortalRedirect =
  | { to: "/auth"; search: { next: string } }
  | { to: "/pending-approval" }
  | { to: "/" }
  | { to: "/mfa-setup" }
  | { to: "/mfa-verify" };
export type GateInput = {
  signedIn: boolean;
  status: string | null;
  roles: readonly AppRole[];
  aal: { currentLevel: string | null; nextLevel: string | null } | null;
};
export function supplierGate(i: GateInput, next: string): { redirect: PortalRedirect | null; signOut: boolean } {
  if (!i.signedIn) return { redirect: { to: "/auth", search: { next } }, signOut: false };
  if (!i.status || i.status === "pending_approval") return { redirect: { to: "/pending-approval" }, signOut: false };
  if (i.status !== "active") return { redirect: { to: "/auth", search: { next: "" } }, signOut: true };
  if (!i.roles.includes("supplier")) return { redirect: { to: "/" }, signOut: false };
  if (i.aal?.nextLevel === "aal1") return { redirect: { to: "/mfa-setup" }, signOut: false };
  if (i.aal?.nextLevel === "aal2" && i.aal.currentLevel !== "aal2") return { redirect: { to: "/mfa-verify" }, signOut: false };
  return { redirect: null, signOut: false };
}
```

- [ ] **Step 4: Write `src/lib/supplier-portal-actions.ts`**

```ts
// The supplier portal's calls (pricing loop PR 3). A supplier account has no
// table access: everything goes through the supplier_portal_* functions, which
// check the session's vendor and MFA themselves. File downloads come from
// sales-os-api (supplier_file_link), because a supplier has no storage access.
import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";
import type { Lang } from "@/lib/i18n";
import type { PortalInvitation, PortalListRow, SubmissionLine, SubmissionTerms } from "@/lib/supplier-portal";

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export const listPortalInvitations = () => call<PortalListRow[]>("supplier_portal_invitations", {});

export const getPortalInvitation = (invitationId: string) =>
  call<PortalInvitation>("supplier_portal_invitation", { _invitation_id: invitationId });

export const submitPortalQuote = (invitationId: string, lines: SubmissionLine[], terms: SubmissionTerms, lang: Lang) =>
  call<{ supplier_quote_id: string; lines: number }>("supplier_portal_submit", {
    _invitation_id: invitationId,
    _lines: lines,
    _terms: terms,
    _confirm_lang: lang,
  });

/** A five-minute download link for one file of the request. */
export async function getPortalFileUrl(invitationId: string, fileId: string): Promise<string> {
  const r = await callBackend<{ url?: string }>("supplier_file_link", { invitationId, fileId });
  if (!r?.url) throw new Error("Could not prepare the download");
  return r.url;
}
```

- [ ] **Step 5: Extend `src/lib/pricing-actions.ts`**

Replace

```ts
import { NO_RIGHTS, type PricingRights } from "@/lib/pricing-access";
```

with

```ts
import { NO_RIGHTS, type PricingRights } from "@/lib/pricing-access";
import { callBackend } from "@/lib/backend";
```

and replace the whole `enterSupplierQuote` export (the last export in the file) with:

```ts
/** `documentId`: the supplier's own Excel or PDF, attached to the deal (PR 3). */
export const enterSupplierQuote = (
  fileId: string,
  vendorId: string,
  lines: SupplierPriceInput[],
  terms: { lead_time_days?: number | null; payment_terms?: string | null; valid_until?: string | null; currency?: string | null },
  documentId?: string | null,
) =>
  call<{ supplier_quote_id: string; lines: number }>("pricing_enter_supplier_quote", {
    _file_id: fileId,
    _vendor_id: vendorId,
    _lines: lines,
    _terms: terms,
    _document_id: documentId ?? null,
  });

// ---- PR 3: requests to the supplier (pricer side) -------------------------------

export type InvitationStatus = "sent" | "opened" | "submitted" | "reopened" | "cancelled";
export const OPEN_INVITATION: readonly InvitationStatus[] = ["sent", "opened", "reopened"];
export type InvitationRow = {
  id: string;
  file_id: string;
  boq_revision_id: string;
  vendor_id: string;
  project_code: string;
  status: InvitationStatus;
  reply_by: string;
  instructions: string | null;
  return_message: string | null;
  sent_by: string | null;
  sent_at: string;
  opened_at: string | null;
  submitted_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};
const INVITATION_COLUMNS =
  "id, file_id, boq_revision_id, vendor_id, project_code, status, reply_by, instructions, return_message, sent_by, sent_at, opened_at, submitted_at, cancelled_at, cancel_reason";
/** Newest first. Readable by pricers and cost readers only. */
export const listFileInvitations = (fileId: string) =>
  rows<InvitationRow>(db.from("supplier_invitations").select(INVITATION_COLUMNS).eq("file_id", fileId).order("sent_at", { ascending: false }));

export type InvitationLineRow = { id: string; invitation_id: string; boq_line_id: string; state: "open" | "submitted" | "reopened" };
export const listInvitationLines = (invitationId: string) =>
  rows<InvitationLineRow>(db.from("supplier_invitation_lines").select("id, invitation_id, boq_line_id, state").eq("invitation_id", invitationId));

export type InvitationFileRow = { id: string; invitation_id: string; document_id: string; display_name: string; size_bytes: number | null };
export const listInvitationFiles = (invitationId: string) =>
  rows<InvitationFileRow>(
    db.from("supplier_invitation_files").select("id, invitation_id, document_id, display_name, size_bytes").eq("invitation_id", invitationId).order("display_name"),
  );

export type SubmissionRow = {
  id: string;
  invitation_id: string;
  supplier_quote_id: string;
  source: "portal" | "on_behalf";
  submitted_by: string | null;
  submitted_at: string;
  confirmation_text: string | null;
  lines: number;
};
export const listInvitationSubmissions = (invitationId: string) =>
  rows<SubmissionRow>(
    db
      .from("supplier_invitation_submissions")
      .select("id, invitation_id, supplier_quote_id, source, submitted_by, submitted_at, confirmation_text, lines")
      .eq("invitation_id", invitationId)
      .order("submitted_at", { ascending: false }),
  );

/** Live supplier prices already on this revision (Phase 7B, before the freeze), for the send warning. */
export type EarlierQuoteRow = { vendor_id: string; vendor_name: string; status: string; is_selected: boolean };
export const listEarlierQuotes = (revisionId: string) =>
  rows<EarlierQuoteRow>(
    db.from("supplier_quote_costs").select("vendor_id, vendor_name, status, is_selected").eq("boq_revision_id", revisionId).eq("is_current", true),
  );

/** boq_frozen -> at_supplier with a request; `replaceEarlier` confirms cancelling other suppliers' earlier prices. */
export const sendToSupplier = (
  fileId: string,
  vendorId: string,
  replyBy: string,
  documentIds: string[],
  instructions: string | null,
  replaceEarlier: boolean,
) =>
  call<{ invitation_id: string; lines: number; files: number }>("pricing_send_to_supplier", {
    _file_id: fileId,
    _vendor_id: vendorId,
    _reply_by: replyBy,
    _document_ids: documentIds,
    _instructions: instructions,
    _replace_earlier: replaceEarlier,
  });
export const cancelInvitation = (invitationId: string, reason: string) =>
  call("pricing_cancel_invitation", { _invitation_id: invitationId, _reason: reason });
export const extendInvitation = (invitationId: string, replyBy: string) =>
  call("pricing_extend_invitation", { _invitation_id: invitationId, _reply_by: replyBy });
/** supplier_priced or price_review -> at_supplier: only these lines reopen. `note` stays internal; `message` is for the supplier. */
export const returnLinesToSupplier = (fileId: string, boqLineIds: string[], replyBy: string, note: string, message: string | null) =>
  call<{ invitation_id: string; lines: number }>("pricing_return_lines_to_supplier", {
    _file_id: fileId,
    _boq_line_ids: boqLineIds,
    _reply_by: replyBy,
    _note: note,
    _message: message,
  });

export type SupplierAccountRow = { user_id: string; full_name: string | null; email: string | null; status: string; created_at: string };
export const listSupplierAccounts = (vendorId: string) =>
  call<SupplierAccountRow[]>("pricing_supplier_accounts", { _vendor_id: vendorId });
/** Creates the portal account (sales-os-api) and returns a one-time set-password link to send. */
export const createSupplierAccount = (vendorId: string, email: string, fullName: string) =>
  callBackend<{ ok: boolean; user_id: string; set_password_url: string | null }>("supplier_account_create", { vendorId, email, fullName });
export const newSupplierPasswordLink = (userId: string) =>
  callBackend<{ ok: boolean; set_password_url: string }>("supplier_account_password_link", { userId });
```

- [ ] **Step 6: Pricing notices open the pricing file**

In `src/lib/notification-target.ts`, replace

```ts
export function targetFor(n: NotificationLike, opportunityId: string | null): Target {
  const opp = opportunityId ?? metadataOpportunityId(n);
```

with

```ts
export function targetFor(n: NotificationLike, opportunityId: string | null): Target {
  // Pricing notices (supplier submitted, supplier overdue; PR 3) open the pricing
  // file. They are about cost, so they never send a reader to the deal instead.
  const pricingFile = metaString(n, "pricing_file_id");
  if (pricingFile) return { to: `/pricing/${pricingFile}` };
  const opp = opportunityId ?? metadataOpportunityId(n);
```

and replace

```ts
export async function resolveTarget(n: NotificationLike, read: ReadRow): Promise<Target> {
  if (metadataOpportunityId(n) || !n.entity_id) return targetFor(n, null);
```

with

```ts
export async function resolveTarget(n: NotificationLike, read: ReadRow): Promise<Target> {
  if (metaString(n, "pricing_file_id") || metadataOpportunityId(n) || !n.entity_id) return targetFor(n, null);
```

In `src/lib/i18n.tsx`, replace

```ts
  notif_type_follow_up_due: { en: "Follow-up due", ar: "متابعة مستحقة" },
```

with

```ts
  notif_type_follow_up_due: { en: "Follow-up due", ar: "متابعة مستحقة" },
  notif_type_pricing_supplier_submitted: { en: "Supplier prices in", ar: "وصلت أسعار المورد" },
  notif_type_pricing_supplier_overdue: { en: "Supplier late", ar: "تأخر المورد" },
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `bun test src/lib/supplier-portal.test.ts src/lib/supplier-portal.contract.test.ts src/lib/notification-target.test.ts src/lib/pricing-actions.contract.test.ts src/lib/arabic-digits.test.ts && bun run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/supplier-portal.ts src/lib/supplier-portal.test.ts src/lib/supplier-portal.contract.test.ts \
  src/lib/supplier-portal-actions.ts src/lib/pricing-actions.ts src/lib/pricing-actions.contract.test.ts \
  src/lib/notification-target.ts src/lib/notification-target.test.ts src/lib/i18n.tsx
git commit -m "feat(pricing): supplier portal logic and wrappers; pricing notices open the file" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Pricer screens: send, follow the request, accounts, return lines (UI)

**Files:**
- Create: `src/components/phc/pricing/CopyText.tsx`, `SupplierAccountsPanel.tsx`, `SendToSupplierPanel.tsx`, `SupplierInvitationPanel.tsx`, `ReturnLinesDialog.tsx`
- Modify: `src/components/phc/pricing/SupplierTab.tsx` (whole file), `SupplierEntryForm.tsx`, `CostReviewTab.tsx`

**Interfaces:**
- Consumes: Task 7 wrappers and helpers (exact names in Task 7's Produces); `listEntityDocuments`, `formatBytes` (`src/lib/document-actions.ts`); `PricingTabProps` (`file: QueueRow`, `rights`, `onChanged`); `ActionDialog`; `Dialog*` (`@/components/ui/dialog`).
- Produces:
  - `CopyText({ label, text })`, `SupplierAccountsPanel({ vendorId })`, `SendToSupplierPanel({ file, onChanged })`, `SupplierInvitationPanel({ invitation, rights, onChanged })`, `ReturnLinesDialog({ open, onOpenChange, fileId, fromPriceReview, lines: {id,label}[], onDone })`.
  - `SupplierEntryForm` takes an optional `lockedVendorId` and passes the supplier's own file (`documentId`) to `enterSupplierQuote`.
  - Behaviour: `boq_frozen` → "Send to the supplier" (vendor, reply-by, ticked files, note, earlier-prices confirmation, portal accounts). `at_supplier` with an open request → request panel (status, opened, overdue, copyable portal message, change date, cancel) and entry on behalf locked to that supplier; "The supplier has priced" only when no request is open. Cost review "Send lines back" opens the line picker when the file has a portal answer, else PR 2's note dialog.

There are no component tests in this repo (Global Constraints); this task is checked by the typecheck, lint, the full test suite and the build, and by the canary walk-through in Task 10.

- [ ] **Step 1: Create the small pieces**

Create `src/components/phc/pricing/CopyText.tsx`:

```tsx
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { pick, type Bi } from "@/lib/pricing-text";

const TEXT = {
  copy: { en: "Copy", ar: "نسخ" },
  copied: { en: "Copied", ar: "نُسخ" },
  failed: { en: "Could not copy; select the text and copy it.", ar: "تعذر النسخ؛ حدّد النص وانسخه." },
} satisfies Record<string, Bi>;

/** A message the pricer sends from their own email or WhatsApp (no automated email in PR 3). */
export function CopyText({ label, text }: { label: string; text: string }) {
  const { lang } = useI18n();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(pick(TEXT.copied, lang));
    } catch {
      toast.error(pick(TEXT.failed, lang));
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Button size="sm" variant="outline" onClick={() => void copy()}>{pick(TEXT.copy, lang)}</Button>
      </div>
      <textarea
        readOnly
        dir="auto"
        aria-label={label}
        className="w-full rounded-md border border-border bg-surface-2/40 p-2 text-xs text-foreground"
        rows={3}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}
```

Create `src/components/phc/pricing/SupplierAccountsPanel.tsx`:

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/phc/StatusPill";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n } from "@/lib/i18n";
import { createSupplierAccount, listSupplierAccounts, newSupplierPasswordLink } from "@/lib/pricing-actions";
import { accountMessage } from "@/lib/supplier-portal";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { CopyText } from "@/components/phc/pricing/CopyText";

const TEXT = {
  title: { en: "Portal accounts for this supplier", ar: "حسابات البوابة لهذا المورد" },
  none: { en: "No portal account yet. Create one, or enter the supplier's prices on their behalf when they answer.", ar: "لا حساب بوابة بعد. أنشئ حساباً، أو أدخل أسعار المورد نيابة عنه حين يرد." },
  name: { en: "Contact name", ar: "اسم جهة الاتصال" },
  email: { en: "Contact email", ar: "بريد جهة الاتصال" },
  create: { en: "Create portal account", ar: "أنشئ حساب بوابة" },
  creating: { en: "Creating…", ar: "جارٍ الإنشاء…" },
  created: { en: "Account created. Send the message below to the supplier.", ar: "أُنشئ الحساب. أرسل الرسالة أدناه للمورد." },
  newLink: { en: "New set-password link", ar: "رابط جديد لكلمة المرور" },
  message: { en: "Message to send (your email or WhatsApp)", ar: "الرسالة المرسلة (بريدك أو واتساب)" },
  noLink: { en: "The account exists but no link was made; use New set-password link.", ar: "الحساب موجود لكن لم يُنشأ رابط؛ استخدم «رابط جديد لكلمة المرور»." },
  active: { en: "Active", ar: "نشط" },
  inactive: { en: "Not active", ar: "غير نشط" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

export function SupplierAccountsPanel({ vendorId }: { vendorId: string }) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ["pricing-supplier-accounts", vendorId], queryFn: () => listSupplierAccounts(vendorId) });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signIn = `${window.location.origin}/auth`;

  function showLink(url: string | null) {
    if (!url) {
      toast.error(pick(TEXT.noLink, lang));
      return;
    }
    setMessage(accountMessage(url, signIn, lang));
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await createSupplierAccount(vendorId, email.trim(), name.trim());
      await qc.invalidateQueries({ queryKey: ["pricing-supplier-accounts", vendorId] });
      setName("");
      setEmail("");
      toast.success(pick(TEXT.created, lang));
      showLink(r.set_password_url);
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  async function reissue(userId: string) {
    if (busy) return;
    setBusy(true);
    try {
      showLink((await newSupplierPasswordLink(userId)).set_password_url);
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  if (accounts.isError) return <QueryFailure retry={() => void accounts.refetch()} />;
  const rows = accounts.data ?? [];
  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      <p className="font-medium">{pick(TEXT.title, lang)}</p>
      {rows.length === 0 && !accounts.isLoading ? <p className="text-muted-foreground">{pick(TEXT.none, lang)}</p> : null}
      <ul className="space-y-2">
        {rows.map((a) => (
          <li key={a.user_id} className="flex flex-wrap items-center gap-2">
            <span>{a.full_name ?? a.email}</span>
            <span className="text-muted-foreground" dir="ltr">{a.email}</span>
            <StatusPill tone={a.status === "active" ? "positive" : "muted"}>{pick(a.status === "active" ? TEXT.active : TEXT.inactive, lang)}</StatusPill>
            {a.status === "active" ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void reissue(a.user_id)}>{pick(TEXT.newLink, lang)}</Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1">
          <span>{pick(TEXT.name, lang)}</span>
          <input type="text" maxLength={200} className={FIELD} disabled={busy} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span>{pick(TEXT.email, lang)}</span>
          <input type="email" dir="ltr" maxLength={254} className={FIELD} disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <Button disabled={busy || !name.trim() || !email.trim()} onClick={() => void create()}>
          {pick(busy ? TEXT.creating : TEXT.create, lang)}
        </Button>
      </div>
      {message ? <CopyText label={pick(TEXT.message, lang)} text={message} /> : null}
    </div>
  );
}
```

Create `src/components/phc/pricing/ReturnLinesDialog.tsx`:

```tsx
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { returnLinesToSupplier } from "@/lib/pricing-actions";
import { riyadhToday } from "@/lib/supplier-portal";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";

const TEXT = {
  title: { en: "Return lines to the supplier", ar: "إرجاع بنود للمورد" },
  titlePr: { en: "Return lines to the supplier, and the selling price", ar: "إرجاع بنود للمورد، مع سعر البيع" },
  desc: { en: "Only the lines you tick reopen in the supplier's portal; the others keep their prices.", ar: "تُفتح في بوابة المورد البنود المختارة فقط، وتبقى أسعار البقية." },
  descPr: { en: "This also returns the GM's proposed price: it must be built and proposed again. Only the lines you tick reopen.", ar: "يُعيد هذا أيضاً السعر الذي اقترحه المدير العام: يجب بناؤه واقتراحه من جديد. تُفتح البنود المختارة فقط." },
  lines: { en: "Lines that go back", ar: "البنود المُرجعة" },
  replyBy: { en: "New reply-by date", ar: "موعد رد جديد" },
  note: { en: "Why (internal cost note; sales and the supplier do not see it)", ar: "السبب (ملاحظة تكلفة داخلية؛ لا يراها فريق المبيعات ولا المورد)" },
  message: { en: "Message to the supplier (optional, shown in the portal)", ar: "رسالة للمورد (اختيارية، تظهر في البوابة)" },
  send: { en: "Return the lines", ar: "أرجع البنود" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  done: { en: "Lines returned to the supplier", ar: "أُرجعت البنود للمورد" },
  pickLine: { en: "Tick at least one line.", ar: "اختر بنداً واحداً على الأقل." },
  needNote: { en: "Say why the lines go back.", ar: "اذكر سبب إرجاع البنود." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function ReturnLinesDialog({
  open, onOpenChange, fileId, fromPriceReview, lines, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fileId: string;
  fromPriceReview: boolean;
  lines: { id: string; label: string }[];
  onDone: () => void;
}) {
  const { lang } = useI18n();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [replyBy, setReplyBy] = useState(() => addDays(riyadhToday(), 3));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function submit() {
    if (busy) return;
    if (picked.size === 0) { toast.error(pick(TEXT.pickLine, lang)); return; }
    if (!note.trim()) { toast.error(pick(TEXT.needNote, lang)); return; }
    setBusy(true);
    try {
      await returnLinesToSupplier(fileId, [...picked], replyBy, note.trim(), message.trim() || null);
      toast.success(pick(TEXT.done, lang));
      setPicked(new Set());
      setNote("");
      setMessage("");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{pick(fromPriceReview ? TEXT.titlePr : TEXT.title, lang)}</DialogTitle>
          <DialogDescription>{pick(fromPriceReview ? TEXT.descPr : TEXT.desc, lang)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <fieldset className="max-h-56 space-y-1 overflow-y-auto">
            <legend className="mb-1">{pick(TEXT.lines, lang)}</legend>
            {lines.map((l) => (
              <label key={l.id} className="flex items-center gap-2">
                <input type="checkbox" disabled={busy} checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
                <span>{l.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1">
            <span>{pick(TEXT.replyBy, lang)}</span>
            <input type="date" className={FIELD} min={riyadhToday()} disabled={busy} value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span>{pick(TEXT.note, lang)}</span>
            <textarea className={FIELD} rows={2} maxLength={1000} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span>{pick(TEXT.message, lang)}</span>
            <textarea className={FIELD} rows={2} maxLength={1000} disabled={busy} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{pick(TEXT.cancel, lang)}</Button>
          <Button disabled={busy} onClick={() => void submit()}>{pick(TEXT.send, lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create the send panel and the request panel**

Create `src/components/phc/pricing/SendToSupplierPanel.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n } from "@/lib/i18n";
import { formatBytes, listEntityDocuments } from "@/lib/document-actions";
import { listEarlierQuotes, listVendors, sendToSupplier } from "@/lib/pricing-actions";
import { riyadhToday } from "@/lib/supplier-portal";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { SupplierAccountsPanel } from "@/components/phc/pricing/SupplierAccountsPanel";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Send to the supplier", ar: "أرسل للمورد" },
  sub: {
    en: "The supplier sees the project code, the lines (sign type, description, size, material, specs, quantity) and the files you tick. Never the client, the site or any price but its own. Check the descriptions name no client.",
    ar: "يرى المورد رمز المشروع والبنود (نوع اللوحة والوصف والمقاس والخامة والمواصفات والكمية) والملفات التي تختارها. لا يرى العميل ولا الموقع ولا أي سعر غير سعره. تأكد أن الأوصاف لا تذكر اسم العميل.",
  },
  supplier: { en: "Supplier", ar: "المورد" },
  pick: { en: "Choose the supplier", ar: "اختر المورد" },
  replyBy: { en: "Reply by", ar: "موعد الرد" },
  files: { en: "Files to send", ar: "الملفات المرسلة" },
  noFiles: { en: "No file is attached to this deal. Attach the drawings and the location plan on the Package tab first.", ar: "لا ملفات مرفقة بهذه الفرصة. أرفق الرسومات ومخطط المواقع من تبويب الباكيج أولاً." },
  renamed: { en: "The supplier sees each file under the project code (e.g. code-01.pdf), not its name here.", ar: "يرى المورد كل ملف باسم رمز المشروع (مثل code-01.pdf) لا باسمه هنا." },
  note: { en: "Note to the supplier (optional, no client names)", ar: "ملاحظة للمورد (اختيارية، دون أسماء العملاء)" },
  earlier: { en: "This BOQ already has prices from before the freeze from:", ar: "لهذه الكميات أسعار من قبل التجميد من:" },
  selection: { en: "This BOQ has a supplier selection from before the freeze.", ar: "لهذه الكميات اختيار مورد من قبل التجميد." },
  replace: { en: "Cancel those earlier prices for this file (one supplier per file)", ar: "ألغِ تلك الأسعار السابقة لهذا الملف (مورد واحد لكل ملف)" },
  send: { en: "Send to the supplier", ar: "أرسل للمورد" },
  sending: { en: "Sending…", ar: "جارٍ الإرسال…" },
  sent: { en: "Sent to the supplier", ar: "أُرسل للمورد" },
  lines: { en: "lines", ar: "بنود" },
  filesSent: { en: "files", ar: "ملفات" },
  chooseVendor: { en: "Choose the supplier first.", ar: "اختر المورد أولاً." },
  chooseFiles: { en: "Tick at least one file.", ar: "اختر ملفاً واحداً على الأقل." },
  confirmEarlier: { en: "Tick the box to cancel the earlier prices first.", ar: "ضع العلامة لإلغاء الأسعار السابقة أولاً." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** boq_frozen (or at_supplier with no open request): one supplier, a reply-by date, the files. */
export function SendToSupplierPanel({ file, onChanged }: Pick<PricingTabProps, "file" | "onChanged">) {
  const { lang } = useI18n();
  const revisionId = file.boq_revision_id as string;
  const vendors = useQuery({ queryKey: ["pricing-vendors"], queryFn: listVendors });
  const docs = useQuery({
    queryKey: ["pricing-deal-documents", file.opportunity_id],
    queryFn: () => listEntityDocuments({ type: "opportunity", id: file.opportunity_id }),
  });
  const earlier = useQuery({ queryKey: ["pricing-earlier-quotes", revisionId], queryFn: () => listEarlierQuotes(revisionId) });
  const [vendorId, setVendorId] = useState("");
  const [replyBy, setReplyBy] = useState(() => addDays(riyadhToday(), 7));
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  if (vendors.isLoading || docs.isLoading || earlier.isLoading) return <SkeletonTable rows={3} />;
  if (vendors.isError || docs.isError || earlier.isError) {
    return <QueryFailure retry={() => { void vendors.refetch(); void docs.refetch(); void earlier.refetch(); }} />;
  }

  // The latest version of each file; every one is ticked until the pricer changes it.
  const current = (docs.data ?? []).filter((d) => !d.superseded_by);
  const chosen = picked ?? new Set(current.map((d) => d.id));
  const live = (earlier.data ?? []).filter((q) => q.status !== "cancelled" && q.status !== "superseded");
  const others = [...new Set(live.filter((q) => q.vendor_id !== vendorId).map((q) => q.vendor_name))];
  const selected = live.some((q) => q.is_selected);
  const needsConfirm = vendorId !== "" && (others.length > 0 || selected);

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function send() {
    if (busy) return;
    if (!vendorId) { toast.error(pick(TEXT.chooseVendor, lang)); return; }
    if (chosen.size === 0) { toast.error(pick(TEXT.chooseFiles, lang)); return; }
    if (needsConfirm && !replace) { toast.error(pick(TEXT.confirmEarlier, lang)); return; }
    setBusy(true);
    try {
      const r = await sendToSupplier(file.file_id, vendorId, replyBy, [...chosen], note.trim() || null, replace);
      toast.success(`${pick(TEXT.sent, lang)} · ${r.lines} ${pick(TEXT.lines, lang)} · ${r.files} ${pick(TEXT.filesSent, lang)}`);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.sub, lang)}>
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span>{pick(TEXT.supplier, lang)}</span>
            <select className={FIELD} value={vendorId} disabled={busy} onChange={(e) => { setVendorId(e.target.value); setReplace(false); }}>
              <option value="">{pick(TEXT.pick, lang)}</option>
              {(vendors.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span>{pick(TEXT.replyBy, lang)}</span>
            <input type="date" className={FIELD} disabled={busy} min={riyadhToday()} value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
          </label>
        </div>

        <fieldset className="space-y-1">
          <legend className="mb-1">{pick(TEXT.files, lang)}</legend>
          {current.length === 0 ? <p className="text-amber-light">{pick(TEXT.noFiles, lang)}</p> : null}
          {current.map((d) => (
            <label key={d.id} className="flex items-center gap-2">
              <input type="checkbox" disabled={busy} checked={chosen.has(d.id)} onChange={() => toggle(d.id)} />
              <span>{d.title || d.original_filename}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(d.size_bytes)}</span>
            </label>
          ))}
          {current.length > 0 ? <p className="text-xs text-muted-foreground">{pick(TEXT.renamed, lang)}</p> : null}
        </fieldset>

        <label className="block space-y-1">
          <span>{pick(TEXT.note, lang)}</span>
          <textarea className={FIELD} rows={2} maxLength={1000} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {needsConfirm ? (
          <div className="space-y-1 rounded-md border border-amber/40 bg-amber/10 p-2">
            {others.length > 0 ? <p>{pick(TEXT.earlier, lang)} {others.join(lang === "ar" ? "، " : ", ")}</p> : null}
            {selected ? <p>{pick(TEXT.selection, lang)}</p> : null}
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={busy} checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              <span>{pick(TEXT.replace, lang)}</span>
            </label>
          </div>
        ) : null}

        <Button disabled={busy || !vendorId || chosen.size === 0} onClick={() => void send()}>
          {pick(busy ? TEXT.sending : TEXT.send, lang)}
        </Button>

        {vendorId ? <SupplierAccountsPanel vendorId={vendorId} /> : null}
      </div>
    </Panel>
  );
}
```

Create `src/components/phc/pricing/SupplierInvitationPanel.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, localeFor } from "@/lib/i18n";
import {
  cancelInvitation, extendInvitation, listInvitationFiles, listInvitationSubmissions, listVendors,
  OPEN_INVITATION, type InvitationRow, type InvitationStatus,
} from "@/lib/pricing-actions";
import { daysLeft, inviteMessage, portalLink, riyadhToday } from "@/lib/supplier-portal";
import { asError, pick, type Bi } from "@/lib/pricing-text";
import { CopyText } from "@/components/phc/pricing/CopyText";
import { SupplierAccountsPanel } from "@/components/phc/pricing/SupplierAccountsPanel";
import type { PricingRights } from "@/lib/pricing-access";

const TEXT = {
  title: { en: "Request to the supplier", ar: "طلب المورد" },
  supplier: { en: "Supplier", ar: "المورد" },
  sentAt: { en: "Sent", ar: "أُرسل" },
  replyBy: { en: "Reply by", ar: "موعد الرد" },
  opened: { en: "Opened by the supplier", ar: "فتحه المورد" },
  notOpened: { en: "Not opened yet", ar: "لم يُفتح بعد" },
  overdue: { en: "Overdue by", ar: "متأخر" },
  left: { en: "days left", ar: "يوم متبقٍ" },
  days: { en: "days", ar: "يوم" },
  files: { en: "Files sent", ar: "الملفات المرسلة" },
  submissions: { en: "Answers", ar: "الردود" },
  byPortal: { en: "Submitted by the supplier", ar: "أرسله المورد" },
  onBehalf: { en: "Entered on the supplier's behalf", ar: "أُدخل نيابة عن المورد" },
  confirmed: { en: "Confirmed:", ar: "أكّد:" },
  linesWord: { en: "lines", ar: "بنود" },
  message: { en: "Message to send the supplier (your email or WhatsApp)", ar: "الرسالة المرسلة للمورد (بريدك أو واتساب)" },
  extend: { en: "Change the reply-by date", ar: "غيّر موعد الرد" },
  extendTitle: { en: "New reply-by date", ar: "موعد رد جديد" },
  extended: { en: "Reply-by date changed", ar: "تغيّر موعد الرد" },
  cancel: { en: "Cancel this request", ar: "ألغِ هذا الطلب" },
  cancelTitle: { en: "Cancel the request to the supplier", ar: "إلغاء طلب المورد" },
  cancelDesc: { en: "The supplier will no longer see it. The file stays at the supplier: send a new request, or enter the prices on their behalf.", ar: "لن يراه المورد بعد الآن. يبقى الملف عند المورد: أرسل طلباً جديداً أو أدخل الأسعار نيابة عنه." },
  reason: { en: "Reason", ar: "السبب" },
  cancelled: { en: "Request cancelled", ar: "أُلغي الطلب" },
  save: { en: "Save", ar: "احفظ" },
} satisfies Record<string, Bi>;

const STATUS_LABEL: Record<InvitationStatus, Bi> = {
  sent: { en: "Sent", ar: "أُرسل" },
  opened: { en: "Opened", ar: "فُتح" },
  submitted: { en: "Answered", ar: "رُدّ عليه" },
  reopened: { en: "Lines returned", ar: "أُرجعت بنود" },
  cancelled: { en: "Cancelled", ar: "ملغى" },
};
const STATUS_TONE: Record<InvitationStatus, "neutral" | "attention" | "positive" | "muted"> = {
  sent: "neutral",
  opened: "neutral",
  submitted: "positive",
  reopened: "attention",
  cancelled: "muted",
};

export function SupplierInvitationPanel({
  invitation, rights, onChanged,
}: { invitation: InvitationRow; rights: PricingRights; onChanged: () => void }) {
  const { lang } = useI18n();
  const vendors = useQuery({ queryKey: ["pricing-vendors"], queryFn: listVendors });
  const files = useQuery({ queryKey: ["pricing-invitation-files", invitation.id], queryFn: () => listInvitationFiles(invitation.id) });
  const answers = useQuery({ queryKey: ["pricing-invitation-submissions", invitation.id], queryFn: () => listInvitationSubmissions(invitation.id) });
  const [dialog, setDialog] = useState<"extend" | "cancel" | null>(null);
  const isOpen = OPEN_INVITATION.includes(invitation.status);
  const today = riyadhToday();
  const left = daysLeft(invitation.reply_by, today);
  const when = (iso: string) => new Date(iso).toLocaleString(localeFor(lang));
  const vendorName = vendors.data?.find((v) => v.id === invitation.vendor_id)?.name ?? "—";
  const link = portalLink(window.location.origin, invitation.id);

  return (
    <Panel title={pick(TEXT.title, lang)}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STATUS_TONE[invitation.status]}>{pick(STATUS_LABEL[invitation.status], lang)}</StatusPill>
          <span>{pick(TEXT.supplier, lang)}: {vendorName}</span>
          <span className="text-muted-foreground">{pick(TEXT.sentAt, lang)} {when(invitation.sent_at)}</span>
        </div>
        {isOpen ? (
          <p>
            {pick(TEXT.replyBy, lang)} {new Date(`${invitation.reply_by}T00:00:00`).toLocaleDateString(localeFor(lang))} ·{" "}
            {left < 0 ? (
              <StatusPill tone="danger">{pick(TEXT.overdue, lang)} {-left} {pick(TEXT.days, lang)}</StatusPill>
            ) : (
              <span>{left} {pick(TEXT.left, lang)}</span>
            )}{" "}
            · {invitation.opened_at ? `${pick(TEXT.opened, lang)} ${when(invitation.opened_at)}` : pick(TEXT.notOpened, lang)}
          </p>
        ) : null}

        {(files.data ?? []).length > 0 ? (
          <div>
            <p className="text-muted-foreground">{pick(TEXT.files, lang)}</p>
            <ul className="list-disc ps-5">{(files.data ?? []).map((f) => <li key={f.id} dir="ltr" className="text-start">{f.display_name}</li>)}</ul>
          </div>
        ) : null}

        {(answers.data ?? []).length > 0 ? (
          <div className="space-y-1">
            <p className="text-muted-foreground">{pick(TEXT.submissions, lang)}</p>
            {(answers.data ?? []).map((s) => (
              <div key={s.id} className="rounded-md border border-border p-2">
                <p>
                  {pick(s.source === "portal" ? TEXT.byPortal : TEXT.onBehalf, lang)} · {when(s.submitted_at)} · {s.lines} {pick(TEXT.linesWord, lang)}
                </p>
                {s.confirmation_text ? <p className="text-xs text-muted-foreground">{pick(TEXT.confirmed, lang)} {s.confirmation_text}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        {isOpen ? <CopyText label={pick(TEXT.message, lang)} text={inviteMessage(link, lang)} /> : null}

        {isOpen && rights.is_pricer ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog("extend")}>{pick(TEXT.extend, lang)}</Button>
            <Button variant="outline" onClick={() => setDialog("cancel")}>{pick(TEXT.cancel, lang)}</Button>
          </div>
        ) : null}
        {isOpen && rights.is_pricer ? <SupplierAccountsPanel vendorId={invitation.vendor_id} /> : null}
      </div>

      <ActionDialog
        open={dialog === "extend"}
        onOpenChange={(v) => setDialog(v ? "extend" : null)}
        title={pick(TEXT.extendTitle, lang)}
        fields={[{ key: "reply_by", type: "date", label: pick(TEXT.replyBy, lang), required: true, defaultValue: invitation.reply_by }]}
        submitLabel={pick(TEXT.save, lang)}
        recordId={invitation.id}
        onSubmit={async (v) => {
          try {
            await extendInvitation(invitation.id, v.reply_by);
            toast.success(pick(TEXT.extended, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={dialog === "cancel"}
        onOpenChange={(v) => setDialog(v ? "cancel" : null)}
        title={pick(TEXT.cancelTitle, lang)}
        description={pick(TEXT.cancelDesc, lang)}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.cancel, lang)}
        destructive
        recordId={invitation.id}
        onSubmit={async (v) => {
          try {
            await cancelInvitation(invitation.id, v.reason);
            toast.success(pick(TEXT.cancelled, lang));
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

- [ ] **Step 3: Replace `src/components/phc/pricing/SupplierTab.tsx`**

The whole file becomes (PR 2's `QuotesTable` is unchanged; the "Mark as sent" button and its text are gone):

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, localeFor, formatNumber } from "@/lib/i18n";
import { canPricerMove } from "@/lib/pricing";
import {
  listBoqLines, listFileInvitations, listSupplierCosts, movePricingFile, OPEN_INVITATION,
  type BoqLineRow, type SupplierCostRow,
} from "@/lib/pricing-actions";
import { daysWaiting } from "@/lib/pricing-access";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { SupplierEntryForm } from "@/components/phc/pricing/SupplierEntryForm";
import { SendToSupplierPanel } from "@/components/phc/pricing/SendToSupplierPanel";
import { SupplierInvitationPanel } from "@/components/phc/pricing/SupplierInvitationPanel";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Supplier", ar: "المورد" },
  notYet: { en: "The BOQ is frozen first, on the Package tab.", ar: "تُجمَّد الكميات أولاً من تبويب الباكيج." },
  waitingSend: { en: "Estimation sends the frozen BOQ to the supplier.", ar: "يرسل التقدير الكميات المجمّدة للمورد." },
  atSupplier: { en: "At the supplier since", ar: "عند المورد منذ" },
  days: { en: "days", ar: "يوم" },
  pricedCount: { en: "lines have a supplier price", ar: "بنداً لها سعر مورد" },
  of: { en: "of", ar: "من" },
  nonSar: { en: "lines are quoted in another currency; they stay unpriced until the quote is in SAR.", ar: "بنداً مسعّرة بعملة أخرى؛ تبقى بلا سعر حتى يصبح عرض المورد بالريال." },
  noRequest: { en: "No portal request is open for this file. Send one, or enter the supplier's prices on their behalf.", ar: "لا طلب مفتوح في البوابة لهذا الملف. أرسل طلباً، أو أدخل أسعار المورد نيابة عنه." },
  priced: { en: "The supplier has priced", ar: "سعّر المورد" },
  confirm: { en: "Confirm: the supplier's prices are in and go to the GM", ar: "تأكيد: أسعار المورد وصلت وتذهب للمدير العام" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  movedOn: { en: "The file went to the GM", ar: "انتقل الملف للمدير العام" },
  noPrices: { en: "No supplier price is in the system yet; the Cost review will show every line unpriced.", ar: "لا يوجد سعر مورد في النظام بعد؛ ستظهر كل البنود بلا سعر في مراجعة التكلفة." },
  done: { en: "The supplier has priced this file. See Cost review.", ar: "سعّر المورد هذا الملف. راجع تبويب مراجعة التكلفة." },
  closed: { en: "This file is closed.", ar: "هذا الملف مغلق." },
  quotesTitle: { en: "Supplier prices received", ar: "أسعار المورد المستلمة" },
  quotesSub: { en: "Read-only. Cost, visible to cost readers only.", ar: "للقراءة فقط. تكلفة، تظهر لمن يحق له قراءة التكلفة فقط." },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  vendor: { en: "Supplier", ar: "المورد" },
  currency: { en: "Currency", ar: "العملة" },
  unit: { en: "Unit price", ar: "سعر الوحدة" },
  screenUnit: { en: "With screen", ar: "مع الشاشة" },
  lead: { en: "Lead time (days)", ar: "مدة التوريد (يوم)" },
  noQuote: { en: "No price yet", ar: "لا سعر بعد" },
  notSar: { en: "Not SAR", ar: "ليس بالريال" },
  multi: { en: "More than one quote", ar: "أكثر من عرض" },
} satisfies Record<string, Bi>;

// The grid ignores cancelled and superseded quotes, so the Supplier tab does too.
const isLiveQuote = (c: SupplierCostRow) => c.status !== "cancelled" && c.status !== "superseded";

function QuotesTable({ lines, costs }: { lines: BoqLineRow[]; costs: SupplierCostRow[] }) {
  const { lang } = useI18n();
  const byLine = new Map<string, SupplierCostRow[]>();
  for (const c of costs.filter(isLiveQuote)) byLine.set(c.boq_line_id, [...(byLine.get(c.boq_line_id) ?? []), c]);
  const money = (n: number | null) => (n == null ? "—" : formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const amount = (n: number | null, q: SupplierCostRow) => (n != null && q.currency !== "SAR" ? `${money(n)} ${q.currency}` : money(n));
  return (
    <Panel title={pick(TEXT.quotesTitle, lang)} subtitle={pick(TEXT.quotesSub, lang)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{pick(TEXT.sign, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
            <TableHead>{pick(TEXT.vendor, lang)}</TableHead>
            <TableHead>{pick(TEXT.currency, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.unit, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.screenUnit, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.lead, lang)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => {
            const qs = byLine.get(l.id) ?? [];
            return (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="font-medium">{l.sign_type}</div>
                  {qs.length > 1 ? <StatusPill tone="attention">{pick(TEXT.multi, lang)}</StatusPill> : null}
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(l.quantity, lang)}</TableCell>
                {qs.length === 0 ? (
                  <TableCell colSpan={5} className="text-muted-foreground">{pick(TEXT.noQuote, lang)}</TableCell>
                ) : (
                  <>
                    <TableCell>{qs.map((q) => <div key={q.id}>{q.vendor_name}</div>)}</TableCell>
                    <TableCell>
                      {qs.map((q) => (
                        <div key={q.id}>
                          {q.currency}
                          {q.currency !== "SAR" ? <StatusPill tone="danger" className="ms-1">{pick(TEXT.notSar, lang)}</StatusPill> : null}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{qs.map((q) => <div key={q.id}>{amount(q.unit_cost, q)}</div>)}</TableCell>
                    <TableCell className="text-end tabular-nums">{qs.map((q) => <div key={q.id}>{amount(q.unit_cost_with_screen, q)}</div>)}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {qs.map((q) => <div key={q.id}>{q.lead_time_days == null ? "—" : formatNumber(q.lead_time_days, lang)}</div>)}
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Panel>
  );
}

export function SupplierTab({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const revisionId = file.boq_revision_id;
  const readsRequests = rights.is_pricer || rights.can_read_cost;
  const lines = useQuery({ queryKey: ["pricing-lines", revisionId], queryFn: () => listBoqLines(revisionId as string), enabled: revisionId != null });
  const costs = useQuery({
    queryKey: ["pricing-supplier-costs", revisionId],
    queryFn: () => listSupplierCosts(revisionId as string),
    enabled: revisionId != null && rights.can_read_cost,
  });
  const invitations = useQuery({
    queryKey: ["pricing-invitations", file.file_id],
    queryFn: () => listFileInvitations(file.file_id),
    enabled: readsRequests,
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const costRows = rights.can_read_cost ? (costs.data ?? []).filter(isLiveQuote) : [];
  const costsReady = !rights.can_read_cost || (revisionId != null && costs.isSuccess);
  const sarPriced = new Set(costRows.filter((c) => c.unit_cost != null && c.currency === "SAR").map((c) => c.boq_line_id)).size;
  const nonSar = new Set(costRows.filter((c) => c.currency !== "SAR").map((c) => c.boq_line_id)).size;
  const lineCount = lines.data?.length ?? 0;
  // Newest first: the open request, else the last one this BOQ had.
  const requests = (invitations.data ?? []).filter((i) => i.boq_revision_id === revisionId);
  const open = requests.find((i) => OPEN_INVITATION.includes(i.status)) ?? null;
  const latest = open ?? requests.find((i) => i.status !== "cancelled") ?? null;

  async function markPriced() {
    if (busy) return;
    setBusy(true);
    try {
      await movePricingFile(file.file_id, "supplier_priced");
      toast.success(pick(TEXT.movedOn, lang));
      setConfirming(false);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  if (revisionId != null && (lines.isLoading || (rights.can_read_cost && costs.isLoading) || (readsRequests && invitations.isLoading))) {
    return <SkeletonTable />;
  }
  if (lines.isError || (rights.can_read_cost && costs.isError) || (readsRequests && invitations.isError)) {
    return (
      <QueryFailure
        retry={() => {
          void lines.refetch();
          if (rights.can_read_cost) void costs.refetch();
          if (readsRequests) void invitations.refetch();
        }}
      />
    );
  }

  const before = ["received", "package_review", "needs_info"].includes(file.state);
  const showQuotes = rights.can_read_cost && revisionId != null && !before && file.state !== "boq_frozen";
  return (
    <div className="space-y-4">
      <Panel title={pick(TEXT.title, lang)}>
        <div className="space-y-4 text-sm">
          {before ? <p className="text-muted-foreground">{pick(TEXT.notYet, lang)}</p> : null}
          {file.state === "boq_frozen" && !rights.is_pricer ? <p className="text-muted-foreground">{pick(TEXT.waitingSend, lang)}</p> : null}

          {file.state === "at_supplier" ? (
            <>
              <p>
                {pick(TEXT.atSupplier, lang)} {new Date(file.state_changed_at).toLocaleDateString(localeFor(lang))} ·{" "}
                {daysWaiting(file.state_changed_at)} {pick(TEXT.days, lang)}
              </p>
              {rights.can_read_cost && costsReady ? (
                <>
                  <p>
                    {sarPriced} {pick(TEXT.of, lang)} {lineCount} {pick(TEXT.pricedCount, lang)}
                  </p>
                  {nonSar > 0 ? (
                    <p className="text-amber-light">
                      {nonSar} {pick(TEXT.nonSar, lang)}
                    </p>
                  ) : null}
                </>
              ) : null}
              {!open && readsRequests ? <p className="text-muted-foreground">{pick(TEXT.noRequest, lang)}</p> : null}
              {/* With a request open, the supplier's submission (or entry on behalf) moves the file on. */}
              {!open && rights.is_pricer && canPricerMove("at_supplier", "supplier_priced") ? (
                confirming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {sarPriced === 0 && rights.can_read_cost && costsReady ? <p className="w-full text-amber-light">{pick(TEXT.noPrices, lang)}</p> : null}
                    <Button disabled={busy} onClick={() => void markPriced()}>{pick(TEXT.confirm, lang)}</Button>
                    <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>{pick(TEXT.cancel, lang)}</Button>
                  </div>
                ) : (
                  <Button onClick={() => setConfirming(true)}>{pick(TEXT.priced, lang)}</Button>
                )
              ) : null}
            </>
          ) : null}

          {file.state === "closed" ? <p className="text-muted-foreground">{pick(TEXT.closed, lang)}</p> : null}
          {!before && file.state !== "boq_frozen" && file.state !== "at_supplier" && file.state !== "closed" ? (
            <p className="text-muted-foreground">{pick(TEXT.done, lang)}</p>
          ) : null}
        </div>
      </Panel>

      {latest ? <SupplierInvitationPanel invitation={latest} rights={rights} onChanged={onChanged} /> : null}
      {rights.is_pricer && revisionId != null && (file.state === "boq_frozen" || (file.state === "at_supplier" && !open)) ? (
        <SendToSupplierPanel file={file} onChanged={onChanged} />
      ) : null}
      {file.state === "at_supplier" && rights.is_pricer && rights.can_read_cost && revisionId != null ? (
        <SupplierEntryForm file={file} rights={rights} onChanged={onChanged} lockedVendorId={open?.vendor_id ?? null} />
      ) : null}
      {showQuotes && lines.data ? <QuotesTable lines={lines.data} costs={costRows} /> : null}
    </div>
  );
}
```

- [ ] **Step 4: `SupplierEntryForm.tsx`: lock to the request's supplier; keep the supplier's own file**

Make these replacements, in order:

1. Replace

```tsx
import { enterSupplierQuote, listBoqLines, listSupplierCosts, listVendors, type SupplierPriceInput } from "@/lib/pricing-actions";
```

with

```tsx
import { enterSupplierQuote, listBoqLines, listSupplierCosts, listVendors, type SupplierPriceInput } from "@/lib/pricing-actions";
import { listEntityDocuments } from "@/lib/document-actions";
```

2. Replace

```tsx
  chooseSupplier: { en: "Choose the supplier first.", ar: "اختر المورد أولاً." },
} satisfies Record<string, Bi>;
```

with

```tsx
  chooseSupplier: { en: "Choose the supplier first.", ar: "اختر المورد أولاً." },
  requestSupplier: { en: "The file was sent to this supplier through the portal; entering here closes that request.", ar: "أُرسل الملف لهذا المورد عبر البوابة؛ الإدخال هنا يغلق ذلك الطلب." },
  original: { en: "The supplier's own file (Excel or PDF)", ar: "ملف المورد الأصلي (Excel أو PDF)" },
  noOriginal: { en: "None attached", ar: "لا ملف مرفق" },
  originalHint: { en: "Attach it to the deal on the Package tab first.", ar: "أرفقه بالفرصة من تبويب الباكيج أولاً." },
} satisfies Record<string, Bi>;
```

3. Replace

```tsx
export function SupplierEntryForm({ file, onChanged }: PricingTabProps) {
```

with

```tsx
/** `lockedVendorId`: the open portal request's supplier (PR 3); entry on behalf is for that supplier only. */
export function SupplierEntryForm({ file, onChanged, lockedVendorId }: PricingTabProps & { lockedVendorId?: string | null }) {
```

4. Replace

```tsx
  const costs = useQuery({ queryKey: ["pricing-supplier-costs", revisionId], queryFn: () => listSupplierCosts(revisionId) });
```

with

```tsx
  const costs = useQuery({ queryKey: ["pricing-supplier-costs", revisionId], queryFn: () => listSupplierCosts(revisionId) });
  const docs = useQuery({
    queryKey: ["pricing-deal-documents", file.opportunity_id],
    queryFn: () => listEntityDocuments({ type: "opportunity", id: file.opportunity_id }),
  });
```

5. Replace

```tsx
  const [busy, setBusy] = useState(false);

  if (vendors.isLoading || lines.isLoading || costs.isLoading) return <SkeletonTable />;
  if (vendors.isError || lines.isError || costs.isError) {
    return <QueryFailure retry={() => { void vendors.refetch(); void lines.refetch(); void costs.refetch(); }} />;
  }

  const chosen = current?.vendor_id ?? vendorId;
```

with

```tsx
  const [busy, setBusy] = useState(false);
  const [documentId, setDocumentId] = useState("");

  if (vendors.isLoading || lines.isLoading || costs.isLoading || docs.isLoading) return <SkeletonTable />;
  if (vendors.isError || lines.isError || costs.isError || docs.isError) {
    return <QueryFailure retry={() => { void vendors.refetch(); void lines.refetch(); void costs.refetch(); void docs.refetch(); }} />;
  }

  const chosen = lockedVendorId ?? current?.vendor_id ?? vendorId;
```

6. Replace

```tsx
        currency: terms.currency || (current ? null : "SAR"),
      });
```

with

```tsx
        currency: terms.currency || (current ? null : "SAR"),
      }, documentId || null);
```

7. Replace

```tsx
      setTerms({ lead: "", payment: "", valid: "", currency: "" });
```

with

```tsx
      setTerms({ lead: "", payment: "", valid: "", currency: "" });
      setDocumentId("");
```

8. Replace

```tsx
          <select className={FIELD} value={chosen} disabled={busy || !!current} onChange={(e) => setVendorId(e.target.value)}>
```

with

```tsx
          <select className={FIELD} value={chosen} disabled={busy || !!current || !!lockedVendorId} onChange={(e) => setVendorId(e.target.value)}>
```

9. Replace

```tsx
          {current ? <span className="block text-xs text-muted-foreground">{pick(TEXT.oneSupplier, lang)}</span> : null}
        </label>
```

with

```tsx
          {lockedVendorId ? <span className="block text-xs text-muted-foreground">{pick(TEXT.requestSupplier, lang)}</span>
            : current ? <span className="block text-xs text-muted-foreground">{pick(TEXT.oneSupplier, lang)}</span> : null}
        </label>
        <label className="block max-w-sm space-y-1">
          <span>{pick(TEXT.original, lang)}</span>
          <select className={FIELD} value={documentId} disabled={busy} onChange={(e) => setDocumentId(e.target.value)}>
            <option value="">{pick(TEXT.noOriginal, lang)}</option>
            {(docs.data ?? []).filter((d) => !d.superseded_by).map((d) => <option key={d.id} value={d.id}>{d.title || d.original_filename}</option>)}
          </select>
          <span className="block text-xs text-muted-foreground">{pick(TEXT.originalHint, lang)}</span>
        </label>
```


- [ ] **Step 5: `CostReviewTab.tsx`: return chosen lines when the supplier answered through the portal**

Make these replacements, in order (the last one is the end of the file: the closing of the second `ActionDialog`, the root `div` and the component):

1. Replace

```tsx
import {
  listSellingGrid,
  listSupplierCosts,
```

with

```tsx
import {
  listFileInvitations,
  listSellingGrid,
  listSupplierCosts,
```

2. Replace

```tsx
import type { PricingTabProps } from "@/components/phc/pricing/types";
```

with

```tsx
import type { PricingTabProps } from "@/components/phc/pricing/types";
import { ReturnLinesDialog } from "@/components/phc/pricing/ReturnLinesDialog";
```

3. Replace

```tsx
  const editable = canEditLineCost(file.state, rights);
  const [backOpen, setBackOpen] = useState(false);
```

with

```tsx
  // PR 3: a file the supplier answered through the portal reopens only the lines Zayed picks.
  const invitations = useQuery({
    queryKey: ["pricing-invitations", file.file_id],
    queryFn: () => listFileInvitations(file.file_id),
    enabled: costOk,
  });
  const editable = canEditLineCost(file.state, rights);
  const [backOpen, setBackOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
```

4. Replace

```tsx
      (file.state === "price_review" && canPricerMove("price_review", "at_supplier")));
```

with

```tsx
      (file.state === "price_review" && canPricerMove("price_review", "at_supplier")));
  const portalRequest = (invitations.data ?? []).find((i) => i.status === "submitted" && i.boq_revision_id === revisionId) ?? null;
```

5. Replace

```tsx
{canSendBack ? <Button variant="outline" disabled={busy} onClick={() => setBackOpen(true)}>
```

with

```tsx
{canSendBack ? <Button variant="outline" disabled={busy} onClick={() => (portalRequest ? setReturnOpen(true) : setBackOpen(true))}>
```

6. Replace

```tsx
      />
    </div>
  );
}
```

with

```tsx
      />
      <ReturnLinesDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        fileId={file.file_id}
        fromPriceReview={fromPriceReview}
        lines={gridRows.map((g) => ({ id: g.boq_line_id, label: `${g.line_number ?? ""} ${g.sign_type}`.trim() }))}
        onDone={onChanged}
      />
    </div>
  );
}
```


- [ ] **Step 6: Run the checks**

Run: `bun run typecheck && bun run lint && bun test src/lib/action-dialog-drafts.contract.test.ts src/lib/arabic-digits.test.ts`
Expected: typecheck clean; lint 0 errors (warnings as on `main`); both tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/phc/pricing/CopyText.tsx src/components/phc/pricing/SupplierAccountsPanel.tsx \
  src/components/phc/pricing/SendToSupplierPanel.tsx src/components/phc/pricing/SupplierInvitationPanel.tsx \
  src/components/phc/pricing/ReturnLinesDialog.tsx src/components/phc/pricing/SupplierTab.tsx \
  src/components/phc/pricing/SupplierEntryForm.tsx src/components/phc/pricing/CostReviewTab.tsx
git commit -m "feat(pricing): send to the supplier, follow the request, supplier accounts, return chosen lines" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The supplier portal (UI)

**Files:**
- Create: `src/routes/supplier.tsx`, `src/routes/supplier.index.tsx`, `src/routes/supplier.$invitationId.tsx`
- Create: `src/components/phc/supplier/SupplierShell.tsx`, `src/components/phc/supplier/InvitationForm.tsx`
- Modify: `src/routes/_authenticated/route.tsx`, `src/routes/index.tsx`
- Generated: `src/routeTree.gen.ts`

**Interfaces:**
- Consumes: Task 7 (`supplierGate`, `PortalRedirect`, `buildSubmission`, `PORTAL_CONFIRMATION`, `PORTAL_STATUS_LABEL`, `PRICE_RULES`, `LEAD_RULES`, `daysLeft`, `riyadhToday`, `listPortalInvitations`, `getPortalInvitation`, `submitPortalQuote`, `getPortalFileUrl`); Task 1 `isSupplier`; `useIdleLogout(enabled, minutes, lang)`; `useAuth().signOut`.
- Produces: routes `/supplier` (layout + guard, outside `/_authenticated`), `/supplier/` (requests list), `/supplier/$invitationId` (request page). Staff routes and the landing page send a supplier to `/supplier`; `/supplier` sends anyone else to `/`. After MFA set-up or verify (which navigate to `/`), a supplier lands on `/supplier`.

- [ ] **Step 1: Create the shell and the request form**

Create `src/components/phc/supplier/SupplierShell.tsx`:

```tsx
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { pick, type Bi } from "@/lib/pricing-text";

const phcLogo = { url: "/phc-logo.png" };

const TEXT = {
  portal: { en: "Supplier portal", ar: "بوابة الموردين" },
  signOut: { en: "Sign out", ar: "تسجيل الخروج" },
} satisfies Record<string, Bi>;

/** The supplier's whole frame: no staff navigation, no search, no notifications. */
export function SupplierShell({ children }: { children: ReactNode }) {
  const { lang, setLang, dir } = useI18n();
  const { signOut } = useAuth();
  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <Link to="/supplier" className="flex items-center gap-3">
          <img src={phcLogo.url} alt="PHC" className="h-7 w-auto object-contain brightness-0 dark:brightness-100" />
          <span className="text-sm font-medium text-muted-foreground">{pick(TEXT.portal, lang)}</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {lang === "en" ? "AR" : "EN"}
          </button>
          <button
            onClick={() => void signOut()}
            className="flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            {pick(TEXT.signOut, lang)}
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
```

Create `src/components/phc/supplier/InvitationForm.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, localeFor, formatNumber } from "@/lib/i18n";
import { formatBytes } from "@/lib/document-actions";
import { draftText } from "@/lib/pricing-input";
import { dbMessage, draftError, pick, type Bi } from "@/lib/pricing-text";
import {
  buildSubmission, daysLeft, LEAD_RULES, PORTAL_CONFIRMATION, PORTAL_STATUS_LABEL, PRICE_RULES, riyadhToday,
  type LineDraft, type PortalInvitation, type PortalLine, type SubmissionProblem, type TermsDraft,
} from "@/lib/supplier-portal";
import { getPortalFileUrl, submitPortalQuote } from "@/lib/supplier-portal-actions";

const TEXT = {
  replyBy: { en: "Reply by", ar: "موعد الرد" },
  daysLeft: { en: "days left", ar: "يوم متبقٍ" },
  late: { en: "Late by", ar: "متأخر" },
  days: { en: "days", ar: "يوم" },
  fromPhc: { en: "From PHC", ar: "من PHC" },
  returned: { en: "Returned for changes", ar: "أُعيد للتعديل" },
  files: { en: "Files", ar: "الملفات" },
  filesHint: { en: "Price only from these files.", ar: "سعّر فقط من هذه الملفات." },
  download: { en: "Download", ar: "تنزيل" },
  lines: { en: "Lines", ar: "البنود" },
  item: { en: "Item", ar: "البند" },
  qty: { en: "Qty", ar: "الكمية" },
  unitPrice: { en: "Unit price (SAR)", ar: "سعر الوحدة (ريال)" },
  withScreen: { en: "With screen (SAR)", ar: "مع الشاشة (ريال)" },
  differs: { en: "Differs from spec", ar: "يختلف عن المواصفة" },
  hasScreen: { en: "Screen", ar: "شاشة" },
  locked: { en: "Submitted", ar: "أُرسل" },
  terms: { en: "Terms", ar: "الشروط" },
  lead: { en: "Lead time (days)", ar: "مدة التوريد (أيام)" },
  payment: { en: "Payment terms", ar: "شروط الدفع" },
  valid: { en: "Offer valid until", ar: "العرض صالح حتى" },
  confirm: { en: "I confirm:", ar: "أؤكد:" },
  submit: { en: "Submit prices", ar: "أرسل الأسعار" },
  submitting: { en: "Submitting…", ar: "جارٍ الإرسال…" },
  submitted: { en: "Your prices were sent to PHC.", ar: "أُرسلت أسعاركم إلى PHC." },
  readOnly: { en: "This request no longer takes prices. You can still read what you sent.", ar: "هذا الطلب لم يعد يقبل أسعاراً. يمكنكم قراءة ما أرسلتم." },
  fix: { en: "Some boxes need fixing before you submit.", ar: "بعض الحقول تحتاج تصحيحاً قبل الإرسال." },
  required: { en: "Required.", ar: "مطلوب." },
  tooLong: { en: "Too long.", ar: "أطول من المسموح." },
  pastDate: { en: "The date has passed.", ar: "التاريخ مضى." },
  noPrice: { en: "Price at least one line.", ar: "سعّر بنداً واحداً على الأقل." },
  mustConfirm: { en: "Tick the confirmation first.", ar: "ضع علامة التأكيد أولاً." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full min-w-24 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

/** The specs a factory prices from, in one line. */
function specs(l: PortalLine): string {
  const size = l.width_mm != null && l.height_mm != null ? `${l.width_mm} × ${l.height_mm} mm` : null;
  return [l.description, l.dimensions, size, l.material, l.mounting, l.illumination, l.finish].filter(Boolean).join(" · ");
}

export function InvitationForm({ invitation }: { invitation: PortalInvitation }) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = riyadhToday();
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [terms, setTerms] = useState<TermsDraft>({
    lead: draftText(invitation.terms.lead_time_days),
    payment: invitation.terms.payment_terms ?? "",
    valid: invitation.terms.valid_until ?? "",
  });
  const [errors, setErrors] = useState<Record<string, SubmissionProblem>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const left = daysLeft(invitation.reply_by, today);

  const problemText = (p: SubmissionProblem, rules = PRICE_RULES): string =>
    p === "required" ? pick(TEXT.required, lang)
      : p === "too_long" ? pick(TEXT.tooLong, lang)
        : p === "past_date" ? pick(TEXT.pastDate, lang)
          : p === "no_price" ? pick(TEXT.noPrice, lang)
            : draftError(p, lang, rules);
  const err = (key: string, rules = PRICE_RULES) =>
    errors[key] ? <span className="block text-xs text-destructive">{problemText(errors[key], rules)}</span> : null;
  const value = (l: PortalLine, k: keyof LineDraft): string => {
    const typed = drafts[l.line_id]?.[k];
    if (typed !== undefined) return typed;
    return k === "spec_difference" ? (l.spec_difference ?? "") : draftText(l[k]);
  };
  const setCell = (lineId: string, k: keyof LineDraft, v: string) => {
    setDrafts((d) => ({ ...d, [lineId]: { ...d[lineId], [k]: v } }));
    setErrors((e) => { const { [`${lineId}:${k}`]: _gone, ...rest } = e; return rest; });
  };

  async function download(fileId: string) {
    try {
      window.location.assign(await getPortalFileUrl(invitation.invitation_id, fileId));
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  async function submit() {
    if (busy) return;
    if (!confirmed) { toast.error(pick(TEXT.mustConfirm, lang)); return; }
    const built = buildSubmission(invitation.lines, drafts, terms, today);
    if (!built.ok) {
      setErrors(Object.fromEntries(built.errors.map((e) => [e.key, e.problem])));
      toast.error(pick(built.errors.some((e) => e.key === "lines") ? TEXT.noPrice : TEXT.fix, lang));
      return;
    }
    setBusy(true);
    try {
      await submitPortalQuote(invitation.invitation_id, built.lines, built.terms, lang);
      toast.success(pick(TEXT.submitted, lang));
      await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("supplier-portal") });
      void navigate({ to: "/supplier" });
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  const priceBox = (l: PortalLine, k: "unit_cost" | "unit_cost_with_screen", label: Bi) =>
    l.editable ? (
      <>
        <input type="text" inputMode="decimal" dir="ltr" className={FIELD} disabled={busy} aria-label={`${pick(label, lang)}: ${l.sign_type ?? ""}`}
          aria-invalid={errors[`${l.line_id}:${k}`] ? true : undefined}
          value={value(l, k)} onChange={(e) => setCell(l.line_id, k, e.target.value)} />
        {err(`${l.line_id}:${k}`)}
      </>
    ) : (
      <span className="tabular-nums">{l[k] == null ? "—" : formatNumber(l[k], lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusPill tone={invitation.editable ? "attention" : "muted"}>{pick(PORTAL_STATUS_LABEL[invitation.status], lang)}</StatusPill>
        <span>{pick(TEXT.replyBy, lang)} {new Date(`${invitation.reply_by}T00:00:00`).toLocaleDateString(localeFor(lang))}</span>
        {invitation.editable ? (
          left < 0 ? <StatusPill tone="danger">{pick(TEXT.late, lang)} {-left} {pick(TEXT.days, lang)}</StatusPill>
            : <span className="text-muted-foreground">{left} {pick(TEXT.daysLeft, lang)}</span>
        ) : null}
      </div>
      {!invitation.editable ? <p className="text-sm text-muted-foreground">{pick(TEXT.readOnly, lang)}</p> : null}
      {invitation.return_message ? (
        <Panel title={pick(TEXT.returned, lang)} tone="attention"><p className="whitespace-pre-line text-sm" dir="auto">{invitation.return_message}</p></Panel>
      ) : null}
      {invitation.instructions ? (
        <Panel title={pick(TEXT.fromPhc, lang)}><p className="whitespace-pre-line text-sm" dir="auto">{invitation.instructions}</p></Panel>
      ) : null}

      <Panel title={pick(TEXT.files, lang)} subtitle={pick(TEXT.filesHint, lang)}>
        <ul className="space-y-2 text-sm">
          {invitation.files.map((f) => (
            <li key={f.file_id} className="flex flex-wrap items-center gap-2">
              <span dir="ltr">{f.name}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(f.size_bytes)}</span>
              <Button size="sm" variant="outline" onClick={() => void download(f.file_id)}>
                <Download className="me-1 h-3.5 w-3.5" />{pick(TEXT.download, lang)}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={pick(TEXT.lines, lang)}>
        {err("lines")}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(TEXT.item, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
                <TableHead>{pick(TEXT.unitPrice, lang)}</TableHead>
                <TableHead>{pick(TEXT.withScreen, lang)}</TableHead>
                <TableHead>{pick(TEXT.differs, lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitation.lines.map((l) => (
                <TableRow key={l.line_id}>
                  <TableCell className="min-w-48 align-top">
                    <div className="font-medium">{l.line_number != null ? `${l.line_number}. ` : ""}{l.sign_type}</div>
                    <div className="text-xs text-muted-foreground" dir="auto">{specs(l)}</div>
                    {l.has_screen ? <StatusPill tone="neutral" className="mt-1">{pick(TEXT.hasScreen, lang)}</StatusPill> : null}
                    {!l.editable && invitation.editable ? <StatusPill tone="muted" className="ms-1 mt-1">{pick(TEXT.locked, lang)}</StatusPill> : null}
                  </TableCell>
                  <TableCell className="text-end align-top tabular-nums">{formatNumber(l.quantity, lang)} {l.unit ?? ""}</TableCell>
                  <TableCell className="align-top">{priceBox(l, "unit_cost", TEXT.unitPrice)}</TableCell>
                  <TableCell className="align-top">{priceBox(l, "unit_cost_with_screen", TEXT.withScreen)}</TableCell>
                  <TableCell className="min-w-48 align-top">
                    {l.editable ? (
                      <>
                        <input type="text" maxLength={500} dir="auto" className={FIELD} disabled={busy} aria-label={`${pick(TEXT.differs, lang)}: ${l.sign_type ?? ""}`}
                          value={value(l, "spec_difference")} onChange={(e) => setCell(l.line_id, "spec_difference", e.target.value)} />
                        {err(`${l.line_id}:spec_difference`)}
                      </>
                    ) : (
                      <span dir="auto">{l.spec_difference ?? "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel title={pick(TEXT.terms, lang)}>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <label className="space-y-1">
            <span>{pick(TEXT.lead, lang)}</span>
            <input type="text" inputMode="numeric" dir="ltr" className={FIELD} disabled={busy || !invitation.editable}
              value={terms.lead} onChange={(e) => { setTerms((t) => ({ ...t, lead: e.target.value })); setErrors((x) => { const { lead: _gone, ...rest } = x; return rest; }); }} />
            {err("lead", LEAD_RULES)}
          </label>
          <label className="space-y-1">
            <span>{pick(TEXT.payment, lang)}</span>
            <input type="text" maxLength={500} dir="auto" className={FIELD} disabled={busy || !invitation.editable}
              value={terms.payment} onChange={(e) => { setTerms((t) => ({ ...t, payment: e.target.value })); setErrors((x) => { const { payment: _gone, ...rest } = x; return rest; }); }} />
            {err("payment")}
          </label>
          <label className="space-y-1">
            <span>{pick(TEXT.valid, lang)}</span>
            <input type="date" min={today} className={FIELD} disabled={busy || !invitation.editable}
              value={terms.valid} onChange={(e) => { setTerms((t) => ({ ...t, valid: e.target.value })); setErrors((x) => { const { valid: _gone, ...rest } = x; return rest; }); }} />
            {err("valid")}
          </label>
        </div>
      </Panel>

      {invitation.editable ? (
        <div className="space-y-3 rounded-md border border-border p-4 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" disabled={busy} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span><strong>{pick(TEXT.confirm, lang)}</strong> {pick(PORTAL_CONFIRMATION, lang)}</span>
          </label>
          <Button disabled={busy || !confirmed} onClick={() => void submit()}>{pick(busy ? TEXT.submitting : TEXT.submit, lang)}</Button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create the three routes**

Create `src/routes/supplier.tsx`:

```tsx
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { useI18n } from "@/lib/i18n";
import type { AppRole } from "@/lib/roles";
import { supplierGate, type PortalRedirect } from "@/lib/supplier-portal";
import { SupplierShell } from "@/components/phc/supplier/SupplierShell";

// The supplier portal's layout (pricing loop PR 3). Outside /_authenticated on
// purpose: a supplier never gets the staff shell, and staff never land here.
// Same pattern as /_authenticated: the decision is RETURNED from beforeLoad and
// applied from an effect (see the note in _authenticated/route.tsx on why a
// thrown redirect breaks hydration). The database is the real boundary: every
// portal call checks the supplier session itself.
export const Route = createFileRoute("/supplier")({
  ssr: false,
  head: () => ({ meta: [{ title: "Supplier portal — PHC" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async ({ location }): Promise<{ redirectTo: PortalRedirect | null }> => {
    const { data, error } = await supabase.auth.getUser();
    const signedIn = !error && !!data.user;
    let status: string | null = null;
    let roles: AppRole[] = [];
    let aal: { currentLevel: string | null; nextLevel: string | null } | null = null;
    if (signedIn) {
      const { data: profile } = await supabase.from("profiles").select("status").eq("id", data.user!.id).single();
      status = profile?.status ?? null;
      const { data: rolesRows } = await supabase.from("user_roles").select("role").eq("user_id", data.user!.id);
      roles = (rolesRows ?? []).map((r) => r.role as AppRole);
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      aal = level ? { currentLevel: level.currentLevel, nextLevel: level.nextLevel } : null;
    }
    const gate = supplierGate({ signedIn, status, roles, aal }, location.pathname);
    if (gate.signOut) await supabase.auth.signOut();
    return { redirectTo: gate.redirect };
  },
  component: SupplierLayout,
});

function SupplierLayout() {
  const { redirectTo } = Route.useRouteContext();
  const navigate = useNavigate();
  const { lang } = useI18n();
  // A supplier is an MFA account: the same 30-minute idle sign-out as the managers.
  useIdleLogout(redirectTo == null, 30, lang);

  useEffect(() => {
    if (redirectTo) void navigate({ ...redirectTo, replace: true } as never);
  }, [redirectTo, navigate]);

  if (redirectTo) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground" role="status" aria-label="Loading" />
      </div>
    );
  }
  return (
    <SupplierShell>
      <Outlet />
    </SupplierShell>
  );
}
```

Create `src/routes/supplier.index.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n, localeFor, formatNumber } from "@/lib/i18n";
import { daysLeft, PORTAL_STATUS_LABEL, riyadhToday, type PortalStatus } from "@/lib/supplier-portal";
import { listPortalInvitations } from "@/lib/supplier-portal-actions";
import { pick, type Bi } from "@/lib/pricing-text";

export const Route = createFileRoute("/supplier/")({
  component: SupplierInvitationsPage,
});

const TEXT = {
  title: { en: "Pricing requests", ar: "طلبات التسعير" },
  sub: { en: "Price only from the files attached to each request. Write any material or spec difference on its line.", ar: "سعّر فقط من الملفات المرفقة بكل طلب، واكتب أي اختلاف في الخامة أو المواصفة على سطره." },
  project: { en: "Project", ar: "المشروع" },
  replyBy: { en: "Reply by", ar: "موعد الرد" },
  status: { en: "Status", ar: "الحالة" },
  lines: { en: "Lines", ar: "البنود" },
  open: { en: "open", ar: "مفتوحة" },
  late: { en: "late", ar: "متأخر" },
  empty: { en: "No pricing request yet", ar: "لا طلبات تسعير بعد" },
  emptyHint: { en: "PHC will send you a link when a request is ready.", ar: "سترسل لكم PHC رابطاً عندما يجهز طلب." },
} satisfies Record<string, Bi>;

const TONE: Record<PortalStatus, "attention" | "positive" | "muted" | "neutral"> = {
  open: "attention",
  returned: "attention",
  submitted: "positive",
  closed: "muted",
};

function SupplierInvitationsPage() {
  const { lang } = useI18n();
  const list = useQuery({ queryKey: ["supplier-portal-list"], queryFn: listPortalInvitations });
  const today = riyadhToday();
  return (
    <div className="space-y-4">
      <PageHeader title={pick(TEXT.title, lang)} description={pick(TEXT.sub, lang)} />
      {list.isLoading ? <SkeletonTable rows={4} /> : null}
      {list.isError ? <QueryFailure retry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? (
        <EmptyState icon={Inbox} title={pick(TEXT.empty, lang)} description={pick(TEXT.emptyHint, lang)} />
      ) : null}
      {list.data && list.data.length > 0 ? (
        <Panel title={pick(TEXT.title, lang)}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{pick(TEXT.project, lang)}</TableHead>
                  <TableHead>{pick(TEXT.replyBy, lang)}</TableHead>
                  <TableHead>{pick(TEXT.status, lang)}</TableHead>
                  <TableHead className="text-end">{pick(TEXT.lines, lang)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((r) => {
                  const active = r.status === "open" || r.status === "returned";
                  return (
                    <TableRow key={r.invitation_id}>
                      <TableCell>
                        <Link to="/supplier/$invitationId" params={{ invitationId: r.invitation_id }} className="font-medium underline-offset-2 hover:underline" dir="ltr">
                          {r.project_code}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {new Date(`${r.reply_by}T00:00:00`).toLocaleDateString(localeFor(lang))}
                        {active && daysLeft(r.reply_by, today) < 0 ? <StatusPill tone="danger" className="ms-2">{pick(TEXT.late, lang)}</StatusPill> : null}
                      </TableCell>
                      <TableCell><StatusPill tone={TONE[r.status]}>{pick(PORTAL_STATUS_LABEL[r.status], lang)}</StatusPill></TableCell>
                      <TableCell className="text-end tabular-nums">
                        {formatNumber(r.lines, lang)}
                        {active ? ` · ${formatNumber(r.open_lines, lang)} ${pick(TEXT.open, lang)}` : ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
```

Create `src/routes/supplier.$invitationId.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/phc/PageHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { InvitationForm } from "@/components/phc/supplier/InvitationForm";
import { useI18n } from "@/lib/i18n";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { getPortalInvitation } from "@/lib/supplier-portal-actions";

export const Route = createFileRoute("/supplier/$invitationId")({
  component: SupplierInvitationPage,
});

const TEXT = {
  eyebrow: { en: "Pricing request", ar: "طلب تسعير" },
  back: { en: "All requests", ar: "كل الطلبات" },
  unavailable: { en: "This request is not available", ar: "هذا الطلب غير متاح" },
} satisfies Record<string, Bi>;

function SupplierInvitationPage() {
  const { invitationId } = Route.useParams();
  const { lang } = useI18n();
  // Not retried: "not available" is an answer, not a network error.
  const inv = useQuery({ queryKey: ["supplier-portal-invitation", invitationId], queryFn: () => getPortalInvitation(invitationId), retry: false });
  const back = <Link to="/supplier" className="text-sm underline-offset-2 hover:underline">{pick(TEXT.back, lang)}</Link>;

  if (inv.isLoading) return <SkeletonTable rows={5} />;
  if (inv.isError || !inv.data) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState variant="error" title={pick(TEXT.unavailable, lang)} description={inv.error ? dbMessage(inv.error, lang) : undefined} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {back}
      <PageHeader eyebrow={pick(TEXT.eyebrow, lang)} title={<span dir="ltr">{inv.data.project_code}</span>} />
      <InvitationForm key={inv.data.invitation_id + inv.data.status} invitation={inv.data} />
    </div>
  );
}
```

- [ ] **Step 3: Send suppliers out of the staff app**

In `src/routes/_authenticated/route.tsx`, replace

```ts
import { requiresMfa, type AppRole } from "@/lib/roles";
```

with

```ts
import { isSupplier, requiresMfa, type AppRole } from "@/lib/roles";
```

replace

```ts
  | { to: "/mfa-setup" }
  | { to: "/mfa-verify" };
```

with

```ts
  | { to: "/mfa-setup" }
  | { to: "/mfa-verify" }
  | { to: "/supplier" };
```

and replace

```ts
    const roleList = (rolesRows ?? []).map((r) => r.role as AppRole);
    if (requiresMfa(roleList)) {
```

with

```ts
    const roleList = (rolesRows ?? []).map((r) => r.role as AppRole);
    // A supplier account (pricing loop PR 3) never gets the staff app: it has its own portal and guard.
    if (isSupplier(roleList)) {
      return { user: null, redirectTo: { to: "/supplier" } };
    }
    if (requiresMfa(roleList)) {
```

In `src/routes/index.tsx`, replace

```ts
import { isSystemAdmin, isExecutive, isSalesManager, isBdOrSalesOps, isSalesperson, type AppRole } from "@/lib/roles";
```

with

```ts
import { isSystemAdmin, isExecutive, isSalesManager, isBdOrSalesOps, isSalesperson, isSupplier, type AppRole } from "@/lib/roles";
```

replace

```ts
//   salesperson            → /my-workspace (personal target/pipeline)
```

with

```ts
//   salesperson            → /my-workspace (personal target/pipeline)
//   supplier               → /supplier (the supplier portal, pricing loop PR 3)
```

and replace

```ts
    if (isSystemAdmin(r)) {
```

with

```ts
    if (isSupplier(r)) {
      void navigate({ to: "/supplier", replace: true });
    } else if (isSystemAdmin(r)) {
```

- [ ] **Step 4: Generate the route tree, then verify**

Run: `bun run build`
Expected: success; `src/routeTree.gen.ts` now has `/supplier`, `/supplier/` and `/supplier/$invitationId`.

Run: `bun run verify`
Expected: typecheck, lint (0 errors), tests and build all green.

- [ ] **Step 5: Commit**

```bash
git add src/routes/supplier.tsx src/routes/supplier.index.tsx 'src/routes/supplier.$invitationId.tsx' \
  src/components/phc/supplier/SupplierShell.tsx src/components/phc/supplier/InvitationForm.tsx \
  src/routes/_authenticated/route.tsx src/routes/index.tsx src/routeTree.gen.ts
git commit -m "feat(pricing): the supplier portal: requests list, request page with confirmation, own guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Docs in the same PR, and full verification

**Files:**
- Modify: `docs/USER_GUIDE.md` (section 7 Pricing & Finance, supplier step; a new "Supplier portal" page guide; section 8 estimation routine; section 10 limitations; footer)
- Modify: `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/AI_HANDOFF.md` (new top entries), `tasks/current.md` (new top item)

**Interfaces:**
- Consumes: everything above, as built. Write the test counts you actually see.
- Produces: docs that match the code (CLAUDE.md: a PR that changes a user flow updates the guide in the same PR).

- [ ] **Step 1: `docs/USER_GUIDE.md`**

1. In "Pricing & Finance — التسعير والمالية", replace the whole item `2. **Supplier (Zayed).**` (its four bullets) with:

```markdown
2. **Supplier (Zayed).** *(2026-11-08)*
   - **Send to the supplier:** choose the supplier, a reply-by date and the files to send (the latest version of each is ticked), and add a note if needed. The supplier sees the project code, the lines (sign type, description, size, material, specs, quantity) and the files under neutral names (`<project code>-01.pdf`). Never the client, the site or a price other than its own, so keep client names out of descriptions and of the note.
   - If the BOQ already has another supplier's prices from before the freeze, tick the box to cancel them for this file: one supplier per file.
   - **Portal account:** the first time, create the supplier's account (contact name and email) on the same panel and copy the message with the one-time set-password link into your email or WhatsApp. *New set-password link* makes a fresh one. The supplier then signs in at the usual address and must set up two-step verification.
   - **The request panel** shows sent, opened, the reply-by date (and how late), and the answers. Copy the portal message to tell the supplier a request is waiting. You can change the reply-by date or cancel the request.
   - When the supplier submits, the file goes to Kalas by itself and you and Kalas get a notification. A late supplier sends you one reminder (08:15) per reply-by date.
   - If the supplier answers outside the portal, **enter their prices on their behalf** (normal and with-screen price, and any spec difference per line) and pick their own Excel or PDF, attached to the deal first. That closes the request. Without a request, press *The supplier has priced* when the prices are in.
```

2. In the same section, under item 3 (Cost review), replace the bullet

```markdown
   - Zayed can **send lines back to the supplier**. The note is a cost note; sales do not see it.
```

with

```markdown
   - Zayed can **send lines back to the supplier**. If the supplier answered through the portal, tick the lines that go back, give a new reply-by date, the reason (a cost note: sales and the supplier do not see it) and, if you want, a message the supplier sees. Only those lines reopen in the portal; the others keep their prices.
```

3. Insert this section right after the "Pricing & Finance" section (before `### Reports & Analysis — التقارير والتحليل`):

```markdown
### Supplier portal — بوابة الموردين *(2026-11-08)*

For the factory, not for PHC staff. A supplier account is linked to one supplier, needs two-step verification, and sees nothing of the Command Center.

| Page | What it is for |
|---|---|
| **Requests** `/supplier` | Every request sent to the supplier: project code, reply-by date, status (waiting for your prices, returned for changes, submitted, closed). |
| **One request** `/supplier/<id>` | The files (download only the versions PHC sent), the lines with quantity and specs, and per line: unit price, price with screen, and what differs from the spec. Then lead time, payment terms and the offer's validity. |

**Submitting:** tick *"My prices are based only on the files attached to this request; any material or spec difference is written on its line."* and press *Submit prices*. The prices lock. If PHC returns lines, only those lines open again, with PHC's message.
```

4. In section 8, under `### Estimation Manager / Finance Manager`, add:

```markdown
- **Supplier portal (2026-11-08):** send each frozen file from the Supplier tab, create the supplier's portal account once, copy the messages to the supplier, and follow the request panel. Return only the lines that need fixing from Cost review.
```

5. In section 10, in `### Pricing loop screens (2026-11-04)`, replace the two bullets

```markdown
- No notifications are sent yet for any pricing step.
- The supplier portal is not ready. Zayed enters the supplier's prices on their behalf. The supplier's original file is not attached in the system yet, and entering again overwrites the prices without keeping the earlier ones in the history.
```

with

```markdown
- Notifications: the supplier's submission and a late supplier only (2026-11-08). Price review, return and quotation notifications come with the next release.
- No email is sent by the system yet: Zayed copies the account and request messages into his own email or WhatsApp.
- Entering a supplier's prices on their behalf again overwrites that entry in place (a supplier's own portal submission is always kept as its own revision).
```

6. Add a footer line after the last one:

```markdown
<!-- last reviewed 2026-11-08 · supplier portal: supplier accounts with MFA, send to the supplier, /supplier portal, returned lines, notifications on submit and overdue · branch feat/pricing-supplier-portal, not deployed · previous: pricing loop screens, 2026-11-04 -->
```

- [ ] **Step 2: `docs/CHANGELOG.md`**. Add at the top, under the title:

```markdown
## 2026-11-08 — Supplier portal (Commercial & Finance part 1, PR 3; not deployed)

- Migrations `20261108100000`–`20261108150000`:
  - `app_role` gains `supplier`; `profiles.vendor_id`, set only by `supplier_account_activate` (or the service role), is what makes an account a supplier. The supplier role holds no other role and cannot be removed while the account is linked (suspend it instead).
  - `has_app_access` is false for supplier accounts, so the session boundary and every role predicate close the schema to them. `is_active_user` and `has_any_role` are false about a supplier for staff too: no task, notification or picker reaches one. `my_day`, `meeting_review_queue` and `my_fireflies_connection` check `has_app_access`; `current_margin_floor` and `estimation_cost_basis` are closed to anon, and `estimation_cost_basis` answers only cost readers outside the margin trigger. The restrictive `audit_session_boundary` policy is now on every public table (PR 1's pricing tables and others made after 2026-09-28 lacked it). `vendor_duplicate_candidates` and `automation_health` run as invoker. `current_margin_floor` returns nothing to a supplier.
  - `auth.users` accepts a non-PHC address only for an account the supplier-account action is creating: an open `supplier_account_invites` row for the address at INSERT, and its id in `app_metadata` at commit (deferred trigger; GoTrue writes `app_metadata` after the INSERT). A supplier account keeps its address.
  - `supplier_account_prepare`, `supplier_account_activate` (service role), `supplier_account_email`, `pricing_supplier_accounts`.
  - `supplier_invitations` (+ lines, files with the exact storage version, submissions); `pricing_send_to_supplier` (cancels another supplier's earlier quote and clears 7B selections on the pricer's confirmation), `pricing_cancel_invitation`, `pricing_extend_invitation`.
  - Portal functions `supplier_portal_invitations`, `supplier_portal_invitation`, `supplier_portal_file`, `supplier_portal_submit` (a new `supplier_quotes` revision; `supplier_quotes.source` and `source_document_id`), `supplier_portal_confirmation`.
  - `pricing_enter_supplier_quote` gains `_document_id` (the supplier's own file), follows the open request and supersedes a portal quote instead of overwriting it.
  - `pricing_return_lines_to_supplier`; `pricing_notify_overdue_suppliers` with pg_cron `pricing-supplier-overdue` (05:15 UTC).
  - Notifications `pricing_supplier_submitted` (GM, estimation, finance) and `pricing_supplier_overdue` (estimation, finance); both open the pricing file.
- `sales-os-api`: module `supplier-portal` (`supplier_account_create`, `supplier_account_password_link`, `supplier_file_link`); a per-action gate lets a supplier call `supplier_file_link` only. `_shared/supabase.ts` `resolveCaller` refuses supplier accounts unless a function opts in.
- UI: Supplier tab (send, request panel, portal accounts, entry on behalf with the supplier's file), Cost review returns chosen lines; `/supplier`, `/supplier/$invitationId`.
- Tests: six pgTAP files (incl. a sweep over every table, view, client-callable SECURITY DEFINER function and owner-run view), `supplier-portal` bun and contract tests, `supplier-portal.deno-test.ts`; `roles.capabilities.test.ts`, `pricing-actions.contract.test.ts`, the router and modularization tests extended.
```

- [ ] **Step 3: `docs/DECISIONS.md`**. Add at the top, under the header block:

```markdown
## 2026-11-08 — بوابة المورد (PR 3)
- **حساب المورد خارجي ولا يصل إلى شيء من النظام.** `has_app_access` يعيد false لحساب المورد، فتغلق سياسة `audit_session_boundary` (الآن على كل جداول public) وكل دوال الأدوار المخطط كله في وجهه. يقرأ ويكتب عبر دوال `supplier_portal_*` فقط، وكلها تبدأ من `_supplier_session_vendor()` (حساب نشط مربوط بمورد مع التحقق بخطوتين aal2). دور `supplier` لا يجتمع مع دور آخر، ومورده (`profiles.vendor_id`) يُحدَّد عند إنشاء الحساب فقط. `resolveCaller` في دوال Edge يرفض حساب المورد إلا في `sales-os-api`، وفيها إجراء واحد له: رابط تنزيل ملف.
- **اختبار مسح يحرس الحدود:** حساب مورد لا يقرأ في أي جدول أو view إلا ملفه ودوره وخريطة الحالات الثابتة؛ وكل دالة SECURITY DEFINER يستطيع العميل استدعاءها تتحقق من المستدعي أو هي في قائمة مراجَعة؛ وكل view يعمل بصلاحية المالك يرشّح على المستدعي أو هو في قائمة مراجَعة. تغيّر خارج التسعير: `vendor_duplicate_candidates` و`automation_health` صارا `security_invoker`، و`current_margin_floor` لا يعيد شيئاً للمورد، وسياسة الجلسة أضيفت للجداول التي كانت بلا سياسة.
- **المورد يرى:** رمز المشروع، والبنود (النوع والوصف والمقاس والخامة والمواصفات والكمية والشاشة)، والملفات المرسلة بأسماء محايدة (`<رمز المشروع>-01.pdf`) وبالنسخة المرسلة بالضبط (ملف عُدّل أو حُذف بعد الإرسال لا يُنزَّل)، وأسعاره وشروطه هو. لا يرى العميل ولا الموقع (`location`) ولا تكلفة PHC ولا سعر البيع ولا مورداً آخر.
- **الإرسال يسمّي مورد الملف:** عرض مورد آخر من قبل التجميد (المرحلة 7B) يُلغى لهذا الملف بتأكيد المسعّر، ويُمسح اختيار 7B، فلا يتعطل البناء. مورد واحد لكل ملف.
- **الإرسال من البوابة يكتب مراجعة جديدة لعرض المورد** (نمط 7B: الاستبدال لا التعديل)، ويحفظ نص التأكيد ووقته والنسخ الدقيقة للملفات، ثم يقفل الطلب وينقل الملف إلى `supplier_priced` ويُبلغ كلاص وزايد. الإدخال نيابة عن المورد يتبع الطلب المفتوح (لا لمورد آخر)، ويغلقه، ويحفظ ملف المورد الأصلي، ويستبدل عرض البوابة بمراجعة جديدة بدل الكتابة فوقه.
- **إرجاع بنود:** تُفتح البنود المختارة فقط مع موعد رد جديد ورسالة اختيارية للمورد؛ السبب الداخلي ملاحظة تكلفة (قاعدة PR 1). الإرجاع يمر عبر `pricing_file_move` فيعيد السعر قيد المراجعة من `price_review` كما كان.
- **لا بريد آلي بعد** (Postmark غير معتمد، وصندوق info@ مؤجل): المسعّر ينسخ رسالة الحساب (رابط كلمة مرور لمرة واحدة) ورسالة الطلب (رابط البوابة فقط بلا تفاصيل المشروع) ويرسلهما بنفسه. بريد غير @phc-sa.com يُقبل فقط لحساب يُنشئه إجراء المورد (`supplier_account_invites` في `app_metadata`).
- **التنبيهات:** عند إرسال المورد لكلاص وزايد (أدوار المدير العام والتقدير والمالية)، وعند تأخر المورد لزايد (مرة لكل موعد رد، 08:15 بتوقيت الرياض). تفتح ملف التسعير لا الفرصة.
- **السبب:** المواصفة 2026-11-03 (§1 و§2 و§5) واجتماع زايد (§3: يسعّر المورد على الملفات المرفوعة ويكتب أي تغيير في الخامة)، وعقد PR 3 في `docs/AI_HANDOFF.md`. الخطة: `docs/superpowers/plans/2026-11-08-pricing-supplier-portal.md`.
```

- [ ] **Step 4: `docs/AI_HANDOFF.md`**. Add at the top, under the title:

```markdown
## 2026-11-08 — Supplier portal (branch `feat/pricing-supplier-portal`, worktree `~/dev/phc-pricing-supplier`)

Plan `docs/superpowers/plans/2026-11-08-pricing-supplier-portal.md`. PR 3 of 5: the `supplier` role and accounts, sending a frozen file to one supplier, the portal (`/supplier`), submission into a 7B quote revision, returned lines, notifications on submit and overdue.
- Migrations `20261108100000`–`20261108150000`. Functions: `sales-os-api` (new module `supplier-portal`), and the shared `resolveCaller` change for `ai-orchestrator` and `import-pipeline`.

**Release (Mo runs; nothing here was pushed or deployed):**
1. Merge once CI is green.
2. Deploy the Edge functions' `resolveCaller` supplier refusal together with, or before, `db push`: `supabase functions deploy ai-orchestrator` and `import-pipeline` first, then `supabase db push` from `~/dev/phc-command-center` on `main` (six migrations), then at once `supabase functions deploy sales-os-api` (its new actions call the new SQL). **No supplier account may be created before both the migrations and all three functions are live.** Check `select jobname, schedule from cron.job where jobname = 'pricing-supplier-overdue';` → one row.
3. No new secret; `APP_URL` defaults to `https://agent.phc-sa.com`. `https://agent.phc-sa.com/reset-password` must stay in Auth's redirect allow-list (forgot-password already uses it).
4. Cloudflare canary → Production Readiness → production.

**Canary walk-through (real accounts: Zayed, Kalas, and a supplier test account on a mailbox Mo controls, never the factory's):**
- Zayed: a test deal's file to `boq_frozen`; Supplier tab → create the portal account for a test vendor; copy the set-password message.
- Supplier test account: set the password, set up two-step verification, land on `/supplier`; open the request; download a file; check no client name or site shows; submit with the confirmation.
- Kalas and Zayed: the notification opens the pricing file; the file is at *Supplier priced*; Cost review shows the portal prices.
- Zayed: return one line with a message; the supplier sees only that line open; re-submits; the other line kept its price.
- The supplier account opening `/command-center`, `/pricing` or `/opportunities` lands back on `/supplier`; with its access token, `GET /rest/v1/opportunities?select=id` and `/rest/v1/vendors?select=id` return `[]`.
- Entry on behalf on a second test file: pick the supplier's own file; the request closes as entered on behalf.
- Both languages, desktop and phone width.

**Local checks (2026-11-08):** DB suite (`dbtest-sup.sh`: 45 files ok, `<total>` tests), `bun run verify`, `bun run test:deno`, `bun audit --audit-level=high`. Replace `<total>` with the number Step 6 prints.

**Behaviour that changes outside the portal** (DECISIONS 2026-11-08): the session boundary on every public table; `vendor_duplicate_candidates` and `automation_health` as invoker; `current_margin_floor` hidden from suppliers and closed to anon; `estimation_cost_basis` closed to anon and answering only cost readers outside the margin trigger; `my_day`, `meeting_review_queue` and `my_fireflies_connection` empty without `has_app_access` (also staff on an aal1 session whose role needs MFA); `is_active_user` / `has_any_role` false about suppliers; the user_roles guard refuses deleting a linked supplier's role (Admin settings → suspend instead); staff pickers and the Fireflies/meetings attendee match skip vendor-linked profiles; `enforce_signup_email_domain` admits a non-PHC address for supplier accounts only (plus a deferred commit check) and ignores updates that keep the address; `resolveCaller` refuses suppliers; `pricing_enter_supplier_quote` gains `_document_id` and the request rules; staff routes send suppliers to `/supplier`.

**PR 3 contract items (AI_HANDOFF 2026-11-04), closed:** `is_selected` never set (send clears 7B selections); one current quote per vendor (submission supersedes); the portal's own entry path keeps the file-at-supplier condition (PR 2's flag); a second vendor's pre-freeze quote (cancelled on the pricer's confirmation); returned lines reopen alone; `supplier_invitations`, the role, `profiles.vendor_id`, the supplier's original file on an on-behalf quote; notifications for supplier steps. Several BOQs per deal: every request binds to the file's own `boq_revision_id`, never the deal's current revision. PR 1's tables now carry `audit_session_boundary`.

**Contract for PR 4:**
- Returning *selected* lines from `price_review` already works in SQL (`pricing_return_lines_to_supplier` accepts `price_review` and returns the price through `pricing_file_move`). PR 4's Approval tab calls it; without a portal request it falls back to `pricing_file_move` with a note.
- A client round (`quoted → boq_frozen`) needs a new request: the old request belongs to the old revision and is never reused.
- Read requests with listed columns from `supplier_invitations` (pricers and cost readers only; reps must not see which supplier).

**Not done (each with its reason):**
- `pricing_settings_audit` still writes full rate rows to `audit_log`: not a supplier exposure (suppliers fail the session boundary on `audit_log`); fixing it rewrites PR 1 assertions and needs Mo's choice (strip values or gate the read). Clean-up PR.
- Automated email: no transactional provider yet. When Postmark or custom SMTP is live, send the two messages from the system.
- AI quote review and its notice to the supplier: PR 5.
- Server-side drafts in the portal: the form keeps typed values until submit; a refresh loses them.
- Carried minor items from PR 2 (lock-order TOCTOU on `estimations`, extras bounds, UTC `current_date` for "in force since", direct writes to `installation_rates`, settings UI rough edges) are unchanged.
```

- [ ] **Step 5: `tasks/current.md`**. Add at the top, under the title:

```markdown
## بند فعّال — حلقة التسعير، PR 3 (بوابة المورد، 2026-11-08)

الفرع `feat/pricing-supplier-portal` (worktree `~/dev/phc-pricing-supplier`) من `main` بعد PR 1 وPR 2. دور المورد وحساباته بالتحقق بخطوتين، وإرسال الملف المجمّد لمورد واحد، والبوابة `/supplier`، والإرسال إلى مراجعة عرض جديدة، وإرجاع بنود بعينها، وتنبيهات الإرسال والتأخر. المتبقي: مراجعة نهائية، فتح الـPR، CI، دمج، ثم `db push` ونشر `sales-os-api` و`ai-orchestrator` و`import-pipeline` بموافقة، ثم كناري بحساب مورد تجريبي وإنتاج بيد Mo. التالي: PR 4 (مراجعة زايد وعرض السعر). التفاصيل في أعلى `docs/AI_HANDOFF.md`.
```

- [ ] **Step 6: Full verification**

Run, in order:
1. `zsh /private/tmp/claude-501/-Users-mo-Documents/d3b74010-fdd1-47e9-9671-a92bc8f74819/scratchpad/dbtest-sup.sh`. Expected: every file ok (45 files). Write the counts into the AI_HANDOFF entry.
2. `bun run verify`. Expected: typecheck, lint (0 errors), tests and build all green.
3. `bun run test:deno`. Expected: all pass.
4. `bun audit --audit-level=high`. Expected: no high finding.
5. `grep -rn "select(\"\\*\"\|select('\\*')" src/lib/pricing-actions.ts src/lib/supplier-portal-actions.ts src/components/phc/pricing src/components/phc/supplier src/routes/supplier*`. Expected: no output.
6. Browser walk-through on a local stack if one is available (`bun run dev` against local Supabase with all migrations; seed a pricer and a supplier account by SQL as in the pgTAP fixtures): send, sign in as the supplier with MFA, submit, return a line, re-submit, in both languages. Supplier downloads need `sales-os-api` served locally (`supabase functions serve sales-os-api`). If no local stack is available, say so in the report and rely on the canary walk-through.

- [ ] **Step 7: Commit**

```bash
git add docs/USER_GUIDE.md docs/CHANGELOG.md docs/DECISIONS.md docs/AI_HANDOFF.md tasks/current.md
git commit -m "docs: supplier portal (user guide, changelog, decisions, handoff, current task)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Release

Mo approves and runs every step; nothing in this plan pushes or deploys.

1. Merge the PR once CI ("Supabase migrations and database tests", verify) is green.
2. Deploy the Edge functions' `resolveCaller` supplier refusal **together with or before** `db push`: `supabase functions deploy ai-orchestrator` and `supabase functions deploy import-pipeline` (refusal only), then `supabase db push` from `~/dev/phc-command-center` on `main` (applies `20261108100000`–`20261108150000`; check the cron job `pricing-supplier-overdue` exists), then straight away `supabase functions deploy sales-os-api` (its new actions call the new SQL). No new secret.
3. **No supplier account may be created before both are live** (the migrations and all three functions): until then a supplier's token would reach Edge functions that do not yet refuse it.
4. Cloudflare canary, with the supplier test account walk-through (Task 10, AI_HANDOFF entry). Create the test supplier account on a mailbox Mo controls; suspend it from Admin settings after the walk-through.
5. Production Readiness, then production.
6. Create the factory's real portal account only after production, from the Supplier tab of a real file.

**Rollback:** suspend supplier accounts (Admin settings); `select cron.unschedule('pricing-supplier-overdue');`; redeploy the three functions from the previous `main`. The migrations add tables, columns and functions; the redefined functions (`has_app_access`, `is_active_user`, `has_any_role`, `enforce_signup_email_domain` and the deferred `auth.phc_supplier_invite_check`, `current_margin_floor`, `estimation_cost_basis`, `my_day`, `meeting_review_queue`, `my_fireflies_connection`, `pricing_enter_supplier_quote`) would need a new migration restoring their PR 2 bodies, which is only needed if the supplier boundary itself misbehaves.

## Not in PR 3 (each with its reason)

- **`pricing_settings_audit` writes rate values to `audit_log`** (AI_HANDOFF carried item): not a supplier exposure, since suppliers fail the session boundary on `audit_log`; the fix rewrites PR 1 assertions and needs Mo's choice between stripping values and gating the read. Clean-up PR.
- **Automated invite email:** no transactional provider is live (Open question 1).
- **Returning selected lines from `price_review` on screen:** the SQL is ready here; the Approval tab that calls it is PR 4.
- **AI quote review and its notice to the supplier:** PR 5 (spec decision 8b).
- **Notifications other than submit and overdue:** PR 4 (propose, return, approval, needs-info) and PR 5 (AI reviews).
- **Multi-supplier comparison:** out of the spec's scope; one supplier per file (decision 7).
- **Server-side portal drafts:** not in the spec; YAGNI until a supplier asks.
- **Filtering supplier accounts out of staff people-pickers:** no data exposure (a supplier reads nothing); cosmetic follow-up.

## Coverage check (self-review against the spec and AI_HANDOFF)

| Requirement | Where |
|---|---|
| Role `supplier`, linked to one vendor (`profiles.vendor_id`) | Task 1 |
| Email + password with mandatory MFA | Task 1 (`_supplier_session_vendor` needs `aal2`; `MFA_REQUIRED_ROLES`), Task 6 (`resolveCaller`), Task 9 (guard → `/mfa-setup`, `/mfa-verify`) |
| Reaches only `/supplier/*` | Task 9 (staff layout and landing redirect; `/supplier` guard) |
| Every other route and RLS path gives a supplier nothing; broad predicates audited and closed | Task 1 (`has_app_access`, boundary on every table, two views, margin floor), Task 5 sweep (tables, views, storage, client-callable definer functions, owner-run views), Task 6 (every Edge function) |
| Invitations from `boq_frozen → at_supplier`, reply-by, exact file versions | Task 2 |
| Supplier sees only its lines (qty, size, specs), files, its own prices; no cost of others, no selling price, no client/deal names | Task 3 (+ leak assertions), Task 5 sweep |
| Portal list and request page; unit price, with-screen price, differs-from-spec; lead time, payment terms, validity | Task 3 (SQL), Task 9 (UI) |
| Confirmation text stored with time and file versions | Task 4 (`supplier_invitation_submissions`) |
| Submit locks; returned lines alone reopen | Tasks 4 and 5 |
| Submit writes a quote revision the PR 2 grid picks; SAR; one supplier per file; `multi_quote_lines` stays 0; on-behalf and portal produce one current quote | Task 4 (grid and totals asserted), Task 2 (one supplier) |
| Invite email links to the portal only, no project details | Task 7 (`inviteMessage`), Task 8 (copyable) — Open question 1 |
| Kalas and Zayed notified on submit; Zayed when overdue | Task 4, Task 5 (pg_cron + on-read on the Supplier tab) |
| A second vendor's pre-freeze 7B quote | Task 2 |
| Attach the supplier's original file to an on-behalf quote (PR 2 deferral) | Task 4, Task 8 |
| Several BOQs per deal | Task 2 (requests bind to the file's revision) |
| PR 1 tables without the session boundary | Task 1 |
| pgTAP for every role/RLS rule, state moves, locking, MFA; bun logic; contract tests | Tasks 1–5, 7; Task 6 Deno + router |
| Release with db push, function deploys, canary with a supplier test account | Release, Task 10 |
