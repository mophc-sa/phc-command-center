# Pricing loop — PR 4: Zayed's review, the quotation, sales status, client rounds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the pricing loop from *price review* to a quotation in the client's hands. Zayed approves Kalas's price, returns it with a reason, or returns selected lines to the supplier. Marie then issues quotation Rev 0 from the approved price, prints it to PDF on the PHC letterhead and marks it sent. The rep sees the pricing state on the deal and can answer missing items there. A client change opens the next round (Rev 1, 2, 3…).

**Architecture:** Three migrations (`20261110100000`–`20261110120000`) add:
- one review RPC;
- an event trigger that sends the loop's notifications;
- a snapshot table of quotation lines, and an issue / mark-sent RPC;
- a relaxed document gate for in-file quotations;
- a client-round RPC.

The browser calls RPCs and reads views and tables with listed columns. Screens: two new tabs on `/pricing/$id` (Approval, Quotations), a pricing card on `/opportunities/$id`, a "Review selling price" card on `/approvals`, and a print route `/quotation-print/$revisionId`. The PDF comes from the browser's print (Save as PDF). No PDF library is added, because browser print renders Arabic correctly.

**Tech Stack:** Postgres 15 (Supabase), pgTAP (`supabase/tests`), TypeScript, React 19, TanStack Router/Start, @tanstack/react-query, bun test.

**Spec:** `docs/superpowers/specs/2026-11-03-pricing-loop-design.md`: §1 (`price_review`, `approved`, `quoted` rows), §2 (notifications, the BD manager issues), §4 (screens 2 and 5) and §6 (PR 4). Meeting record: `docs/finance/2026-11-03-ahmed-zayed-meeting.md` §1 steps 5–7 and §2 (Rev 0, 1, 2…). Contract: `docs/AI_HANDOFF.md`, "Contract for PR 4" under 2026-11-08.

**Base:** branch `feat/pricing-review-quotation` in worktree `/Users/mo/dev/phc-pricing-review`, from `main` at `3568ed9` (PR 1–3 merged and deployed). Never edit an existing migration. New behaviour goes in new migrations that `CREATE OR REPLACE` what they change.

## Open questions for Mo

Each has a default. The tasks are written with the default, so nothing waits on the answer.

1. **Who signs the quotation document?** Phase 7C requires the GM (`can_approve_final_price`) to move a revision to `approved`. In the pricing loop, Kalas has already set the price and Zayed has approved it, so a second GM signature on the same number adds nothing. **Default: an in-file revision (one linked to a pricing file) whose subtotal equals the file's `gm_approved` price is approved by the issue RPC itself. Outside pricing files the GM gate stays.**
2. **Line prices on the PDF.** **Default: each line shows quantity, unit price and line total.** The line total is Kalas's built selling price for that line, so the lines sum exactly to the approved price. The unit price is `line total ÷ quantity`, rounded to 2 decimals, and is for display only.
3. **Who issues:** **default `bd_manager` (Marie) and `sales_manager` (Omar)**, through a new helper `can_issue_quotation(uuid)`.
4. **A client round with quantity changes** goes back through the supplier with a new request. The contract says "the old request belongs to the old revision and is never reused". **Default: the round reopens the file at package review with a copy of the current BOQ as a new, unfrozen revision. Zayed edits it and freezes it, and the loop runs again.** Carrying the previous supplier prices forward for unchanged lines is left to a later PR (see "Not in PR 4").
5. **A discount with no quantity change** goes through the existing BAFO chain, as the spec says. PR 4 adds nothing for it.
6. **PDF language:** **default: the language the issuer is using when they print.** There is no saved language per quotation.

## Global Constraints

- PR 1–3 constraints still apply:
  - Every new table has `ENABLE ROW LEVEL SECURITY` and the restrictive `audit_session_boundary` policy. Copy the policy statement from `supabase/migrations/20261108120000_supplier_invitations.sql`; the `supabase/tests/supplier_isolation_sweep.test.sql` sweep fails without it.
  - Writes go through RPCs. New tables get no INSERT/UPDATE/DELETE grant to `authenticated`.
  - Every RPC: `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated;`. Internal helpers (`_pricing_*`) are revoked from `authenticated` too.
  - Error messages are bilingual, `'English. | العربية.'`, with codes `42501` (not allowed), `23514` (bad input) and `P0001` (rule).
  - Every state change writes `audit_log` (`actor_type 'user'`).
  - Cost is read only when `public.can_read_commercial_cost(auth.uid())` is true. "Pricer" = `public.is_pricer(uuid)`. "GM" = `public.can_approve_final_price(uuid)`.
- **Never show cost or margin to sales.** The quotation lines carry selling figures only. The opportunity card reads `pricing_files` (state and dates only, no cost), `quotation_current_revision` and `quotation_revision_lines`.
- **Approval stays in the guard.** `pricing_file_review` moves `internal_prices.status`. It never sets the file state itself: the follow trigger (`pricing_file_follow_price`) does. Finance's rules (not the proposer, not the figure's author, file in `price_review`) stay in `internal_price_transition_guard`.
- **Migration numbers:** `20261110100000`, `20261110110000`, `20261110120000`. Before Task 1 run `git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3`. If any number there is ≥ `20261110100000`, renumber every migration in this plan upward, keeping their order.
- **Bilingual UI, RTL-safe:**
  - Components keep their strings in `const TEXT = { … } satisfies Record<string, Bi>` and show them with `pick(TEXT.key, lang)` (`src/lib/pricing-text.ts`).
  - Use logical CSS (`ms-`, `me-`, `ps-`, `pe-`, `text-start`, `text-end`).
  - Numbers go through `formatNumber` and `formatCurrency` from `@/lib/i18n`.
  - No Arabic-Indic digits in source files.
- **Database errors** reach the user through `dbMessage(e, lang)`. `ActionDialog` `onSubmit` rethrows `new Error(dbMessage(e, lang))`.
- **pgTAP sessions** always set `"aal":"aal2"` in `request.jwt.claims`.
  - Test user UUID prefixes for this PR: Task 1 `8a…`, Task 2 `8b…`, Task 3 `8c…`. Used already: `00 20 24 26–29 2a–2e 3d–3f 4a 4b 4d 5a–5f 6a–6f 7a 7c a2 d1 f0–f2`. Check with `grep -rho "'[0-9a-f]\{2\}000000-" supabase/tests | sort -u` before choosing.
  - Emails are `<short>-<role>+test@phc-sa.com`.
- **DB tests:** the local stack must be this repo's. `supabase status` must name `phc-command-center`. If another project's stack holds the ports (toplines-portal does today), ask Mo before stopping it. Then run `supabase db reset --local` (local only; the guard does not block `--local`) followed by `supabase test db`. **Never run any linked or remote command.** If the local stack cannot start, push the branch and rely on CI ("Supabase migrations and database tests"), and say so in the task report.
- **Frontend checks:** a task that adds a route runs `bun run build` once, which regenerates `src/routeTree.gen.ts` (commit it). Then `bun run verify`. Bun tests: `bun test <file>`.
- **No component tests** (the repo has no `*.test.tsx`). Logic lives in `src/lib` with bun tests.
- **Public repository:** no production amounts, real client names or customer text in code, tests, commits or PR text.
- **Release (Mo runs every step, nothing in this plan does it):**
  1. merge;
  2. `supabase db push` (three migrations);
  3. no Edge Function deploy: PR 4 changes no function;
  4. Cloudflare canary walk-through;
  5. Production Readiness;
  6. production.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261110100000_pricing_review.sql` | `pricing_file_review`, `pricing_my_rights` (+ `is_finance`, `can_issue_quotation`), `can_issue_quotation()`, notification trigger on `pricing_file_events` |
| `supabase/migrations/20261110110000_pricing_quotation.sql` | `quotation_revisions.pricing_file_id`, `quotation_revision_lines`, `quotation_revision_guard` (in-file gate), `pricing_issue_quotation`, `pricing_mark_quotation_sent` |
| `supabase/migrations/20261110120000_pricing_client_round.sql` | transition `quoted → package_review`, `pricing_file_client_round` |
| `supabase/tests/pricing_review.test.sql` | Task 1 |
| `supabase/tests/pricing_quotation.test.sql` | Task 2 |
| `supabase/tests/pricing_client_round.test.sql` | Task 3 |
| `src/lib/pricing-access.ts` (+ test) | rights type, the two new tabs, `canReview`, `canIssue`, `canStartClientRound` |
| `src/lib/quotation-doc.ts` (+ test) | pure helpers for the printed quotation: unit price, totals check, document number |
| `src/lib/pricing-actions.ts` (+ contract test) | wrappers for the four new RPCs |
| `src/components/phc/pricing/ApprovalTab.tsx` | Zayed's review |
| `src/components/phc/pricing/QuotationsTab.tsx` | revisions list, start client round |
| `src/components/phc/pricing/DealPricingCard.tsx` | opportunity page: state, needs-info answer, issue, revisions, print |
| `src/routes/_authenticated/quotation-print.$revisionId.tsx` | the printable quotation |
| `src/routes/_authenticated/pricing.$id.tsx` | mount the two tabs |
| `src/routes/_authenticated/opportunities.$id.tsx` | mount `DealPricingCard` |
| `src/lib/approvals-center.ts`, `src/routes/_authenticated/approvals.tsx` | "Review selling price" card |
| `docs/USER_GUIDE.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/AI_HANDOFF.md`, `tasks/current.md` | Task 8 |

---

### Task 1: Zayed's review RPC, rights, and the loop's notifications

**Files:**
- Create: `supabase/migrations/20261110100000_pricing_review.sql`
- Test: `supabase/tests/pricing_review.test.sql`

**Interfaces:**
- Consumes: `internal_price_transition_guard` (20261103140000), `pricing_file_follow_price`, `pricing_return_lines_to_supplier(uuid, uuid[], date, text, text)` (20261108150000), `emit_notification(_recipient uuid, _type, _entity_type, _entity_id, _title, _body, _severity, _source_event, _dedupe_key, _metadata)`, `emit_notification_to_roles(_roles app_role[], …same…)`.
- Produces:
  - `public.pricing_file_review(_file_id uuid, _decision text, _reason text DEFAULT NULL) RETURNS jsonb`, where `_decision ∈ {'approve','return'}`. It returns the file row as JSON.
  - `public.can_issue_quotation(_user_id uuid) RETURNS boolean`.
  - `public.pricing_my_rights()` now also returns `is_finance` and `can_issue_quotation`.
  - Notification types `pricing_price_review`, `pricing_price_returned`, `pricing_price_approved`, `pricing_needs_info`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/pricing_review.test.sql`. The fixture is the PR 2 worked example, which reaches `price_review`:
1. Copy lines 1–80 of `supabase/tests/pricing_build_price.test.sql` (users, roles, deal 1 fixture).
2. Replace the prefix `6f` with `8a` everywhere in the copy (`sed 's/6f/8a/g'` on the copied block only).
3. Add the Build and Propose statements below.
4. Add the assertions.

```sql
-- PR 4, part 1: Zayed reviews Kalas's price; the loop's notifications.
-- Fixture: pricing_build_price.test.sql lines 1-80 with the 6f prefix renamed 8a.
-- (paste here, then:)
-- Kalas (GM, 8a…04) builds and proposes deal 1 (cost 39900, selling 53200 at 25%).
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.pricing_file_build_price('8a600001-0000-0000-0000-000000000001');
select public.pricing_file_propose('8a600001-0000-0000-0000-000000000001', 53200, 39900);
reset role;

select is((select state::text from public.pricing_files where id = '8a600001-0000-0000-0000-000000000001'),
          'price_review', 'fixture: the file is in price review');

-- ===== Notifications on propose =====
select ok(exists(select 1 from public.notifications n
                  join public.user_roles r on r.user_id = n.recipient_id and r.role = 'finance_manager'
                 where n.type = 'pricing_price_review'), 'finance is told a price waits for review');

-- ===== Who may review =====
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','approve')$$,
                 '42501', null, 'a rep cannot review');
reset role;

-- The GM proposed it: he cannot approve his own price.
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','approve')$$,
                 '42501', null, 'the GM cannot review');
reset role;

-- ===== Bad input =====
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','maybe')$$,
                 '23514', null, 'an unknown decision is refused');
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','return','  ')$$,
                 '23514', null, 'a return needs a reason');

-- ===== Return to Kalas =====
select lives_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','return','Check the crane line')$$,
                'finance returns the price with a reason');
reset role;
select is((select state::text from public.pricing_files where id = '8a600001-0000-0000-0000-000000000001'),
          'selling_build', 'the file follows the price back to the selling build');
select is((select ip.return_reason from public.internal_prices ip
             join public.pricing_files f on f.internal_price_id = ip.id
            where f.id = '8a600001-0000-0000-0000-000000000001'),
          'Check the crane line', 'the reason stays on the price');
select ok(exists(select 1 from public.notifications n
                  join public.user_roles r on r.user_id = n.recipient_id and r.role = 'general_manager'
                 where n.type = 'pricing_price_returned'), 'the GM is told the price came back');
select ok(not exists(select 1 from public.notifications n
                      where n.type = 'pricing_price_returned' and n.body like '%crane%'),
          'the notice does not carry the reason (sales could read a forwarded notice)');

-- ===== Review only in price review =====
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','approve')$$,
                 'P0001', null, 'nothing to review outside price review');
reset role;

-- Kalas proposes again.
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.pricing_file_build_price('8a600001-0000-0000-0000-000000000001');
select public.pricing_file_propose('8a600001-0000-0000-0000-000000000001', 53200, 39900);
reset role;

-- ===== Approve =====
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','approve')$$,
                'finance approves');
reset role;
select is((select state::text from public.pricing_files where id = '8a600001-0000-0000-0000-000000000001'),
          'approved', 'the file follows the price to approved');
select ok(exists(select 1 from public.notifications n
                  where n.type = 'pricing_price_approved'
                    and n.recipient_id = '8a000000-0000-0000-0000-000000000001'), 'the rep is told');
select ok(exists(select 1 from public.notifications n
                  join public.user_roles r on r.user_id = n.recipient_id and r.role = 'bd_manager'
                 where n.type = 'pricing_price_approved'), 'the BD manager is told');
select ok(exists(select 1 from public.audit_log a where a.action = 'pricing_file.reviewed'
                  and a.after_value->>'decision' = 'approve'), 'the review is audited');

-- ===== Rights =====
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((public.pricing_my_rights()->>'is_finance')::boolean, true, 'finance sees is_finance');
reset role;
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((public.pricing_my_rights()->>'can_issue_quotation')::boolean, true, 'the BD manager may issue');
reset role;
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((public.pricing_my_rights()->>'can_issue_quotation')::boolean, false, 'a rep may not issue');
reset role;

-- ===== needs_info notifies the rep =====
-- Deal 2 of the fixture is in package_review after the copied setup; if it is not, move it there first
-- with pricing_file_move as the pricer (8a…03).
select set_config('request.jwt.claims', '{"sub":"8a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.pricing_file_set_needs_info('8a600002-0000-0000-0000-000000000001', array['Location plan'], current_date + 3);
reset role;
select ok(exists(select 1 from public.notifications n where n.type = 'pricing_needs_info'
                  and n.recipient_id = '8a000000-0000-0000-0000-000000000001'), 'the rep is told what is missing');

select * from finish();
rollback;
```

Set `select plan(N)` at the top to the number of assertions once the file is final. The UUIDs above follow the copied fixture. If the fixture's ids differ after the rename, use the copied ones; the shape of each assertion stays.

- [ ] **Step 2: Run it to make sure it fails**

Run `supabase test db` (local stack, see Global Constraints).
Expected: FAIL, `function public.pricing_file_review(uuid, unknown) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261110100000_pricing_review.sql`:

```sql
-- =============================================================================
-- Pricing loop, PR 4 part 1: Zayed reviews the price Kalas proposed.
-- The review moves the price; the file follows it (pricing_file_follow_price).
-- Who may approve stays in internal_price_transition_guard (finance, not the
-- proposer, not the figure's author, file in price_review). This RPC adds the
-- state check, the reason rule and the audit row.
-- Also: the loop's notifications (spec §2) as one trigger on the file's events,
-- and two rights the screens need.
-- =============================================================================

-- 1. Who may issue a quotation (spec §2: the BD manager; Mo default: also the sales manager).
CREATE OR REPLACE FUNCTION public.can_issue_quotation(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_app_access(_user_id)
     AND public.has_any_role(_user_id, ARRAY['bd_manager','sales_manager']::public.app_role[]);
$$;
REVOKE ALL ON FUNCTION public.can_issue_quotation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_issue_quotation(uuid) TO authenticated;

-- 2. Rights for the screens (adds is_finance and can_issue_quotation).
CREATE OR REPLACE FUNCTION public.pricing_my_rights()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'is_pricer',           coalesce(public.is_pricer(auth.uid()), false),
    'is_gm',               coalesce(public.can_approve_final_price(auth.uid()), false),
    'can_read_cost',       coalesce(public.can_read_commercial_cost(auth.uid()), false),
    'can_set_margins',     coalesce(public.can_set_pricing_margins(auth.uid()), false),
    'is_finance',          coalesce(public.has_app_access(auth.uid())
                                    AND public.has_role(auth.uid(), 'finance_manager'::public.app_role), false),
    'can_issue_quotation', coalesce(public.can_issue_quotation(auth.uid()), false));
$$;
REVOKE ALL ON FUNCTION public.pricing_my_rights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_my_rights() TO authenticated;

-- 3. The review.
CREATE OR REPLACE FUNCTION public.pricing_file_review(_file_id uuid, _decision text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; r text := nullif(btrim(_reason), ''); price_id uuid;
BEGIN
  IF NOT (public.has_app_access(u) AND public.has_role(u, 'finance_manager'::public.app_role)) THEN
    RAISE EXCEPTION 'Finance reviews the selling price. | مراجعة سعر البيع للمالية.' USING ERRCODE = '42501';
  END IF;
  IF _decision IS NULL OR _decision NOT IN ('approve','return') THEN
    RAISE EXCEPTION 'Choose approve or return. | اختر الاعتماد أو الإرجاع.' USING ERRCODE = '23514';
  END IF;
  IF _decision = 'return' AND r IS NULL THEN
    RAISE EXCEPTION 'A return needs a reason. | الإرجاع يحتاج سبباً.' USING ERRCODE = '23514';
  END IF;
  -- Lock order: the price, then the file (as pricing_file_move).
  SELECT internal_price_id INTO price_id FROM public.pricing_files WHERE id = _file_id;
  IF price_id IS NOT NULL THEN
    PERFORM 1 FROM public.internal_prices WHERE id = price_id FOR UPDATE;
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514'; END IF;
  IF f.state <> 'price_review' OR f.internal_price_id IS NULL OR f.internal_price_id IS DISTINCT FROM price_id THEN
    RAISE EXCEPTION 'There is no price waiting for review on this file. | لا يوجد سعر بانتظار المراجعة في هذا الملف.' USING ERRCODE = 'P0001';
  END IF;

  IF _decision = 'approve' THEN
    UPDATE public.internal_prices SET status = 'gm_approved' WHERE id = f.internal_price_id;
  ELSE
    UPDATE public.internal_prices SET status = 'returned', return_reason = r WHERE id = f.internal_price_id;
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.reviewed', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'internal_price_id', f.internal_price_id,
                             'decision', _decision, 'has_reason', r IS NOT NULL));
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_review(uuid, text, text) TO authenticated;

-- 4. Notifications (spec §2). One trigger on the append-only event log, so every
-- path that moves a file (RPC, follow trigger) notifies the same way.
-- Bodies carry no cost, margin or return reason: a notice can be forwarded.
-- The project code is the title, as in PR 3's overdue notice.
CREATE OR REPLACE FUNCTION public._pricing_notify_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files; o record; title text; meta jsonb;
BEGIN
  SELECT * INTO f FROM public.pricing_files WHERE id = NEW.file_id;
  SELECT op.id, op.owner_id, coalesce(op.project_code, op.sales_code, 'Pricing file') AS code
    INTO o FROM public.opportunities op WHERE op.id = f.opportunity_id;
  title := o.code;
  meta := jsonb_build_object('pricing_file_id', f.id);

  IF NEW.to_state = 'price_review' THEN
    PERFORM public.emit_notification_to_roles(ARRAY['finance_manager']::public.app_role[],
      'pricing_price_review', 'opportunity', o.id, title,
      'A selling price is waiting for your review. | سعر بيع بانتظار مراجعتك.',
      'attention', 'pricing_price_review', 'pricing_review:' || NEW.id, meta);
  ELSIF NEW.to_state = 'selling_build' AND NEW.from_state = 'price_review' THEN
    PERFORM public.emit_notification_to_roles(ARRAY['general_manager']::public.app_role[],
      'pricing_price_returned', 'opportunity', o.id, title,
      'Finance returned the selling price; the reason is on the file. | أرجعت المالية سعر البيع؛ السبب في الملف.',
      'attention', 'pricing_price_returned', 'pricing_returned:' || NEW.id, meta);
  ELSIF NEW.to_state = 'approved' THEN
    PERFORM public.emit_notification_to_roles(ARRAY['bd_manager']::public.app_role[],
      'pricing_price_approved', 'opportunity', o.id, title,
      'The selling price is approved; issue the quotation. | اعتُمد سعر البيع؛ أصدر عرض السعر.',
      'info', 'pricing_price_approved', 'pricing_approved_bd:' || NEW.id, meta);
    IF o.owner_id IS NOT NULL THEN
      PERFORM public.emit_notification(o.owner_id,
        'pricing_price_approved', 'opportunity', o.id, title,
        'The selling price for your deal is approved. | اعتُمد سعر البيع لصفقتك.',
        'info', 'pricing_price_approved', 'pricing_approved_rep:' || NEW.id, meta);
    END IF;
  ELSIF NEW.to_state = 'needs_info' AND o.owner_id IS NOT NULL THEN
    PERFORM public.emit_notification(o.owner_id,
      'pricing_needs_info', 'opportunity', o.id, title,
      'Pricing needs information from you before it can continue. | التسعير يحتاج معلومات منك ليكمل.',
      'attention', 'pricing_needs_info', 'pricing_needs_info:' || NEW.id, meta);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._pricing_notify_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pricing_file_events_notify ON public.pricing_file_events;
CREATE TRIGGER pricing_file_events_notify AFTER INSERT ON public.pricing_file_events
  FOR EACH ROW EXECUTE FUNCTION public._pricing_notify_event();
```

Before running, check four names against the live schema and adjust if one differs:
- `pricing_file_events` columns `from_state` and `to_state`: `grep -n "CREATE TABLE.*pricing_file_events" -A15 supabase/migrations/20261103100000_pricing_files.sql`.
- `notifications.recipient_id`: `grep -rn "CREATE TABLE.*public.notifications" -A12 supabase/migrations`.
- `has_app_access(uuid)` and `can_set_pricing_margins(uuid)` exist.
- `emit_notification`'s `_severity` accepts `'info'` and `'attention'`.

If `emit_notification*` already skip recipients without app access, keep them as they are. If they do not, nothing extra is needed: suppliers hold no `finance_manager`, `general_manager` or `bd_manager` role (PR 3 trigger).

- [ ] **Step 4: Run the tests and make sure they pass**

Run `supabase db reset --local && supabase test db`.
Expected: `pricing_review.test.sql` passes, and every other file still passes, including `supplier_isolation_sweep.test.sql`. The new functions are SECURITY DEFINER. The sweep accepts them only if each one checks its caller; `_pricing_notify_event` is revoked from `authenticated`, so it is not callable at all.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261110100000_pricing_review.sql supabase/tests/pricing_review.test.sql
git commit -m "feat(pricing): finance reviews the selling price; loop notifications"
```

---

### Task 2: The quotation: issue from the approved price, line snapshot, mark sent

**Files:**
- Create: `supabase/migrations/20261110110000_pricing_quotation.sql`
- Test: `supabase/tests/pricing_quotation.test.sql`

**Interfaces:**
- Consumes: Task 1 (`can_issue_quotation`); `quotation_revision_guard` (20260828110000); `_pricing_file_apply(pricing_files, pricing_file_state, uuid, text)`; `pricing_file_lines.built_selling_price`; `boq_lines (line_number, sign_type, description, quantity, unit)`.
- Produces:
  - Column `quotation_revisions.pricing_file_id uuid`.
  - Table `public.quotation_revision_lines(id, revision_id, line_number int, description text, quantity numeric, unit text, line_total numeric(16,2), created_at)`, readable through `can_read_quotation`.
  - `public.pricing_issue_quotation(_file_id uuid, _valid_until date, _payment_terms text, _delivery_terms text, _scope_summary text) RETURNS uuid` (the new revision id).
  - `public.pricing_mark_quotation_sent(_revision_id uuid) RETURNS jsonb`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/pricing_quotation.test.sql`. Its fixture is Task 1's: lines 1–80 of `pricing_build_price.test.sql` with `6f` renamed `8b`, then build, propose and approve deal 1:

```sql
-- PR 4, part 2: the quotation is issued from the approved price.
-- (fixture paste with prefix 8b, then:)
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.pricing_file_build_price('8b600001-0000-0000-0000-000000000001');
select public.pricing_file_propose('8b600001-0000-0000-0000-000000000001', 53200, 39900);
reset role;
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.pricing_file_review('8b600001-0000-0000-0000-000000000001','approve');
reset role;

-- ===== Who issues =====
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_issue_quotation('8b600001-0000-0000-0000-000000000001', current_date + 30, '30% advance', '60 days', 'Signage')$$,
                 '42501', null, 'a rep cannot issue');
reset role;

-- ===== Issue Rev 1 (Rev 0 in the client's words: revision_number starts at 1 in 7C) =====
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_issue_quotation('8b600001-0000-0000-0000-000000000001', current_date - 1, null, null, null)$$,
                 '23514', null, 'validity cannot be in the past');
select lives_ok($$select set_config('pq.rev', public.pricing_issue_quotation('8b600001-0000-0000-0000-000000000001', current_date + 30, '30% advance', '60 days', 'Signage')::text, true)$$,
                'the BD manager issues the quotation');
reset role;

select is((select status::text from public.quotation_revisions where id = current_setting('pq.rev')::uuid),
          'approved', 'an in-file revision is approved by the issue itself');
select is((select subtotal_excl_vat from public.quotation_revisions where id = current_setting('pq.rev')::uuid),
          53200.00::numeric, 'the subtotal is the approved price');
select is((select sum(line_total) from public.quotation_revision_lines where revision_id = current_setting('pq.rev')::uuid),
          53200.00::numeric, 'the lines sum to the approved price');
select is((select state::text from public.pricing_files where id = '8b600001-0000-0000-0000-000000000001'),
          'quoted', 'the file moves to quoted');
select is((select revision_number from public.quotation_revisions where id = current_setting('pq.rev')::uuid),
          1, 'first revision');

-- ===== Twice is refused =====
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_issue_quotation('8b600001-0000-0000-0000-000000000001', current_date + 30, null, null, null)$$,
                 'P0001', null, 'a quoted file cannot issue again');
reset role;

-- ===== The rep reads the quotation and its lines, never cost =====
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from public.quotation_revision_lines where revision_id = current_setting('pq.rev')::uuid),
          (select count(*)::int from public.boq_lines bl join public.pricing_files f on f.boq_revision_id = bl.revision_id
            where f.id = '8b600001-0000-0000-0000-000000000001'), 'the rep reads every line');
select is((select count(*)::int from public.pricing_file_lines where file_id = '8b600001-0000-0000-0000-000000000001'),
          0, 'the rep reads no built cost (pricing_file_lines is row-gated to cost readers)');
-- If this returns rows, stop: it is a cost leak that predates PR 4; report it instead of changing the assertion.
select throws_ok($$insert into public.quotation_revision_lines (revision_id, line_number, description, quantity, line_total)
                   values (current_setting('pq.rev')::uuid, 99, 'x', 1, 1)$$, '42501', null, 'no direct writes');
reset role;

-- ===== Mark sent =====
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_mark_quotation_sent(current_setting('pq.rev')::uuid)$$, '42501', null, 'a rep cannot mark it sent');
reset role;
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public.pricing_mark_quotation_sent(current_setting('pq.rev')::uuid)$$, 'the BD manager marks it sent');
reset role;
select is((select status::text from public.quotation_revisions where id = current_setting('pq.rev')::uuid),
          'submitted', 'submitted');

-- ===== Outside pricing files the GM gate stays =====
-- A hand-made draft revision with no pricing_file_id cannot be approved by the BD manager.
-- Build it with an insert as postgres (quotation + revision linked to the approved price), then:
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_like($$update public.quotation_revisions set status = 'approved'
                     where id = current_setting('pq.loose')::uuid$$, '%GM%', 'the BD manager cannot approve a loose revision');
reset role;

select * from finish();
rollback;
```

For `pq.loose`, insert one `quotations` row and one draft `quotation_revisions` row (no `pricing_file_id`) as `postgres`, then move it to `pending_approval` as `postgres` and keep its id with `set_config('pq.loose', …, false)`.

- [ ] **Step 2: Run it to make sure it fails**

Run `supabase test db`.
Expected: FAIL, `function public.pricing_issue_quotation(…) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261110110000_pricing_quotation.sql`. For section 3 (the guard), **copy the whole current body of `quotation_revision_guard` from `supabase/migrations/20260828110000_phase7c_quotation_revisions.sql`** (`grep -l "FUNCTION public.quotation_revision_guard" supabase/migrations/*.sql` must still list only that file). Change only the "GM gate on the document itself" block, as shown.

```sql
-- =============================================================================
-- Pricing loop, PR 4 part 2: the quotation.
-- Marie (BD) issues the quotation from the price Zayed approved: a new revision
-- whose subtotal is that price, with a snapshot of the selling line totals
-- (Kalas's built selling prices, which sum to the price). The client sees
-- selling figures only; no cost column exists on the snapshot.
-- Mo default (plan Q1): an in-file revision is approved by the issue itself.
-- The price was set by the GM and approved by finance, so a second GM
-- signature on the same number adds nothing. Outside pricing files Phase 7C's
-- GM gate is unchanged.
-- =============================================================================

-- 1. Which pricing file a revision came from.
ALTER TABLE public.quotation_revisions
  ADD COLUMN IF NOT EXISTS pricing_file_id uuid REFERENCES public.pricing_files(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS quotation_revisions_pricing_file ON public.quotation_revisions (pricing_file_id);

-- 2. The lines the client receives.
CREATE TABLE IF NOT EXISTS public.quotation_revision_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id  uuid NOT NULL REFERENCES public.quotation_revisions(id) ON DELETE RESTRICT,
  line_number  integer NOT NULL,
  description  text NOT NULL,
  quantity     numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit         text,
  line_total   numeric(16,2) NOT NULL CHECK (line_total >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, line_number)
);
COMMENT ON TABLE public.quotation_revision_lines IS
  'Selling line totals of a quotation revision, copied from the pricing file''s built selling prices when the quotation is issued. They sum to the revision subtotal. Selling figures only; written only by pricing_issue_quotation.';
ALTER TABLE public.quotation_revision_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Quotation lines readable with the quotation" ON public.quotation_revision_lines;
CREATE POLICY "Quotation lines readable with the quotation" ON public.quotation_revision_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotation_revisions r
                  WHERE r.id = revision_id
                    AND public.can_read_quotation(r.quotation_id, (SELECT auth.uid()))));
-- (paste the restrictive audit_session_boundary policy here, as in 20261108120000_supplier_invitations.sql,
--  with the table name changed)
REVOKE ALL ON public.quotation_revision_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.quotation_revision_lines TO authenticated;
GRANT ALL ON public.quotation_revision_lines TO service_role;
CREATE TRIGGER quotation_revision_lines_no_delete BEFORE DELETE OR UPDATE ON public.quotation_revision_lines
  FOR EACH ROW EXECUTE FUNCTION public.pricing_no_delete();
-- Check pricing_no_delete raises on UPDATE too. If it only covers DELETE, write a
-- two-line trigger function here that raises 'Quotation lines are a snapshot. | بنود العرض لقطة ثابتة.'.

-- 3. The guard: copy the full current body, then replace the GM gate block with:
--    IF NEW.status = 'approved' THEN
--      IF NOT (public.can_approve_final_price(_uid)
--              OR (NEW.pricing_file_id IS NOT NULL
--                  AND coalesce(current_setting('pricing.issuing', true), '') = NEW.id::text)) THEN
--        RAISE EXCEPTION 'Only the GM, or an active delegate, may approve a quotation revision. | اعتماد عرض السعر يقتصر على الإدارة العامة.'
--          USING ERRCODE = 'insufficient_privilege';
--      END IF;
--      NEW.approved_by := coalesce(NEW.approved_by, _uid);
--      NEW.approved_at := coalesce(NEW.approved_at, now());
--    END IF;
--    Also refuse a change of pricing_file_id once the row leaves draft (add it to the
--    "snapshot is immutable" list), and refuse setting it on INSERT unless the same
--    pricing.issuing flag is set (a hand-made revision must not claim a file).
-- The flag works like pricing.proposing (20261104150000): only the issue RPC sets
-- it, for the revision it is writing, and clears it right after. PostgREST cannot
-- set custom GUCs.

-- 4. Issue.
CREATE OR REPLACE FUNCTION public.pricing_issue_quotation(_file_id uuid, _valid_until date,
  _payment_terms text, _delivery_terms text, _scope_summary text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; p public.internal_prices; o public.opportunities;
        q_id uuid; prev public.quotation_revisions; rev_id uuid := gen_random_uuid(); n int; lines_sum numeric;
BEGIN
  IF NOT public.can_issue_quotation(u) THEN
    RAISE EXCEPTION 'The BD or sales manager issues the quotation. | يصدر عرضَ السعر مديرُ تطوير الأعمال أو مدير المبيعات.' USING ERRCODE = '42501';
  END IF;
  IF _valid_until IS NULL OR _valid_until < public._pricing_today() OR _valid_until > public._pricing_today() + 180 THEN
    RAISE EXCEPTION 'Validity must be between today and 180 days. | الصلاحية بين اليوم و180 يوماً.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514'; END IF;
  IF f.state <> 'approved' THEN
    RAISE EXCEPTION 'The quotation is issued once the price is approved, and once per round. | يصدر العرض بعد اعتماد السعر، مرة في كل جولة.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO p FROM public.internal_prices WHERE id = f.internal_price_id;
  IF p.status IS DISTINCT FROM 'gm_approved' THEN
    RAISE EXCEPTION 'The price is not approved. | السعر غير معتمد.' USING ERRCODE = 'P0001';
  END IF;
  SELECT sum(pl.built_selling_price) INTO lines_sum
    FROM public.pricing_file_lines pl JOIN public.boq_lines bl ON bl.id = pl.boq_line_id
   WHERE pl.file_id = f.id AND bl.revision_id = f.boq_revision_id AND pl.built_at IS NOT NULL;
  IF lines_sum IS DISTINCT FROM p.proposed_price THEN
    RAISE EXCEPTION 'The lines do not add up to the approved price; ask finance. | البنود لا تساوي السعر المعتمد؛ راجع المالية.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO o FROM public.opportunities WHERE id = f.opportunity_id;

  -- The quotation header: the deal's latest one from this loop, or a new one.
  SELECT r.quotation_id INTO q_id FROM public.quotation_revisions r
    JOIN public.pricing_files pf ON pf.id = r.pricing_file_id
   WHERE pf.opportunity_id = f.opportunity_id ORDER BY r.created_at DESC LIMIT 1;
  IF q_id IS NULL THEN
    INSERT INTO public.quotations (quote_number, related_opportunity_id, owner_id, value, currency, status, created_by)
    VALUES (coalesce(o.project_code, o.sales_code, 'Q') || '-Q', o.id, o.owner_id, p.proposed_price, 'SAR', 'draft', u)
    RETURNING id INTO q_id;
  END IF;

  SELECT * INTO prev FROM public.quotation_revisions WHERE quotation_id = q_id AND is_current FOR UPDATE;
  SELECT coalesce(max(revision_number), 0) + 1 INTO n FROM public.quotation_revisions WHERE quotation_id = q_id;
  IF prev.id IS NOT NULL THEN
    IF prev.status IN ('approved','submitted') THEN
      UPDATE public.quotation_revisions SET status = 'superseded' WHERE id = prev.id;
    ELSIF prev.status = 'draft' OR prev.status = 'pending_approval' THEN
      UPDATE public.quotation_revisions SET status = 'withdrawn', withdrawn_reason = 'Replaced by Rev ' || n,
             is_current = false WHERE id = prev.id;
    ELSE
      UPDATE public.quotation_revisions SET is_current = false WHERE id = prev.id;
    END IF;
  END IF;

  PERFORM set_config('pricing.issuing', rev_id::text, true);
  INSERT INTO public.quotation_revisions (id, quotation_id, revision_number, supersedes_id, is_current, status,
         boq_revision_id, internal_price_id, pricing_file_id, currency, subtotal_excl_vat,
         valid_until, payment_terms, delivery_terms, scope_summary, created_by)
  VALUES (rev_id, q_id, n, prev.id, true, 'draft', f.boq_revision_id, p.id, f.id, 'SAR', p.proposed_price,
          _valid_until, nullif(btrim(_payment_terms), ''), nullif(btrim(_delivery_terms), ''),
          nullif(btrim(_scope_summary), ''), u);
  INSERT INTO public.quotation_revision_lines (revision_id, line_number, description, quantity, unit, line_total)
  SELECT rev_id, bl.line_number,
         coalesce(nullif(btrim(concat_ws(' — ', bl.sign_type, bl.description)), ''), 'Line ' || bl.line_number),
         bl.quantity, bl.unit, pl.built_selling_price
    FROM public.pricing_file_lines pl JOIN public.boq_lines bl ON bl.id = pl.boq_line_id
   WHERE pl.file_id = f.id AND bl.revision_id = f.boq_revision_id AND pl.built_at IS NOT NULL;
  UPDATE public.quotation_revisions SET status = 'pending_approval' WHERE id = rev_id;
  UPDATE public.quotation_revisions SET status = 'approved' WHERE id = rev_id;
  PERFORM set_config('pricing.issuing', '', true);
  UPDATE public.quotations SET value = p.proposed_price, version = n, valid_until = _valid_until WHERE id = q_id;

  PERFORM public._pricing_file_apply(f, 'quoted', u, 'Rev ' || n);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.quotation_issued', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'revision_id', rev_id, 'revision_number', n));
  RETURN rev_id;
END $$;
REVOKE ALL ON FUNCTION public.pricing_issue_quotation(uuid, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_issue_quotation(uuid, date, text, text, text) TO authenticated;

-- 5. Mark sent (Marie sends the PDF herself; this records it).
CREATE OR REPLACE FUNCTION public.pricing_mark_quotation_sent(_revision_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); r public.quotation_revisions;
BEGIN
  IF NOT public.can_issue_quotation(u) THEN
    RAISE EXCEPTION 'The BD or sales manager records the sending. | يسجّل الإرسالَ مديرُ تطوير الأعمال أو مدير المبيعات.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.quotation_revisions WHERE id = _revision_id FOR UPDATE;
  IF NOT FOUND OR r.pricing_file_id IS NULL THEN
    RAISE EXCEPTION 'Unknown quotation revision. | مراجعة العرض غير موجودة.' USING ERRCODE = '23514';
  END IF;
  IF r.status <> 'approved' OR NOT r.is_current THEN
    RAISE EXCEPTION 'Only the current approved revision can be sent. | تُرسل المراجعة الحالية المعتمدة فقط.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.quotation_revisions SET status = 'submitted' WHERE id = r.id RETURNING * INTO r;
  UPDATE public.quotations SET status = 'sent', issued_date = coalesce(issued_date, public._pricing_today())
   WHERE id = r.quotation_id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'quotation_revision.submitted', 'quotation_revision', r.id,
          jsonb_build_object('revision_number', r.revision_number));
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.pricing_mark_quotation_sent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_mark_quotation_sent(uuid) TO authenticated;
```

Before running, check these against the schema and adjust the SQL (not the behaviour):
- `quotation_status` has a value `'sent'`: `grep -n "quotation_status" supabase/migrations/20260706120000_quotations_boq_targets.sql`. If it is named differently, use that name.
- `quotations (quote_number, version)` is UNIQUE. A deal gets one header, so `coalesce(project_code, sales_code, 'Q') || '-Q'` must be unique. If a collision is possible (two deals without a code), use `'Q-' || left(o.id::text, 8)` as the fallback.
- `boq_lines.unit` and `boq_lines.line_number` exist (`pricing_selling_grid` reads them).
- `_pricing_today()` exists (PR 3).
- The quotations INSERT policy limits who may insert; this RPC is SECURITY DEFINER, so it is not affected.

- [ ] **Step 4: Run the tests and make sure they pass**

Run `supabase db reset --local && supabase test db`.
Expected: `pricing_quotation.test.sql` and every other file pass, including `pricing_files.test.sql`, which pins the transitions view.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261110110000_pricing_quotation.sql supabase/tests/pricing_quotation.test.sql
git commit -m "feat(pricing): issue the quotation from the approved price, with a line snapshot"
```

---

### Task 3: The client round

**Files:**
- Create: `supabase/migrations/20261110120000_pricing_client_round.sql`
- Test: `supabase/tests/pricing_client_round.test.sql`

**Interfaces:**
- Consumes: Task 2 (a file in `quoted`); `pricing_file_transitions` view (20261103110000; replace it whole); `boq_revisions (id, boq_id, revision_number, frozen_at, frozen_by, status)`.
- Produces: `public.pricing_file_client_round(_file_id uuid, _note text) RETURNS jsonb`. It creates the next BOQ revision as an unfrozen copy, attaches it, and moves the file `quoted → package_review`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/pricing_client_round.test.sql`. Its fixture is Task 2's with prefix `8c`, up to the issued Rev 1. Then:

```sql
-- PR 4, part 3: a client change opens the next round.
select set_config('request.jwt.claims', '{"sub":"8c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_file_client_round('8c600001-0000-0000-0000-000000000001','Client cut 2 signs')$$,
                 '42501', null, 'a rep cannot start a round');
reset role;
select set_config('request.jwt.claims', '{"sub":"8c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_file_client_round('8c600001-0000-0000-0000-000000000001','  ')$$,
                 '23514', null, 'a round needs the client''s change');
select lives_ok($$select public.pricing_file_client_round('8c600001-0000-0000-0000-000000000001','Client cut 2 signs')$$,
                'a pricer starts the round');
reset role;
select is((select state::text from public.pricing_files where id = '8c600001-0000-0000-0000-000000000001'),
          'package_review', 'the file is back at package review');
select isnt((select boq_revision_id from public.pricing_files where id = '8c600001-0000-0000-0000-000000000001'),
            '8c500001-0000-0000-0000-000000000001'::uuid, 'on a new BOQ revision');
select is((select revision_number from public.boq_revisions r join public.pricing_files f on f.boq_revision_id = r.id
            where f.id = '8c600001-0000-0000-0000-000000000001'), 2, 'numbered 2');
select ok((select frozen_at is null from public.boq_revisions r join public.pricing_files f on f.boq_revision_id = r.id
            where f.id = '8c600001-0000-0000-0000-000000000001'), 'unfrozen, so Zayed can edit it');
select is((select count(*)::int from public.boq_lines bl join public.pricing_files f on f.boq_revision_id = bl.revision_id
            where f.id = '8c600001-0000-0000-0000-000000000001'),
          (select count(*)::int from public.boq_lines where revision_id = '8c500001-0000-0000-0000-000000000001'),
          'with the same lines to start from');
select is((select status::text from public.quotation_revisions where pricing_file_id = '8c600001-0000-0000-0000-000000000001'
            order by revision_number desc limit 1), 'approved',
          'the client''s current quotation stays valid until the next one supersedes it');
select set_config('request.jwt.claims', '{"sub":"8c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.pricing_file_client_round('8c600001-0000-0000-0000-000000000001','again')$$,
                 'P0001', null, 'only from quoted');
reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

Run `supabase test db`.
Expected: FAIL, the function does not exist.

- [ ] **Step 3: Write the migration**

1. Replace the transitions view whole. Copy the 14 rows from `20261103110000_pricing_state_machine.sql` lines 10–26, add the new row, and keep the grant.
2. Write the RPC.

For the copy of the lines, list `boq_lines`' columns first (`grep -n "CREATE TABLE.*boq_lines" -A40 supabase/migrations/*.sql`, plus later `ADD COLUMN`s on `boq_lines`). Copy every column except `id`, `revision_id` and timestamps.

```sql
-- =============================================================================
-- Pricing loop, PR 4 part 3: a client change opens the next round (spec §1 "quoted").
-- The old supplier request belongs to the old BOQ revision and is never reused
-- (AI_HANDOFF contract for PR 4), so the round starts again at package review
-- on a fresh copy of the BOQ. The client's current quotation stays valid until
-- the next issue supersedes it.
-- The quoted -> boq_frozen move (PR 1) stays legal for a pricer who froze a new
-- revision some other way.
-- =============================================================================
CREATE OR REPLACE VIEW public.pricing_file_transitions AS
SELECT * FROM (VALUES
  ('received'::public.pricing_file_state,       'package_review'::public.pricing_file_state, 'pricer'),
  ('package_review',  'needs_info',      'rpc_needs_info'),
  ('needs_info',      'package_review',  'rpc_answer'),
  ('package_review',  'boq_frozen',      'pricer'),
  ('boq_frozen',      'at_supplier',     'pricer'),
  ('at_supplier',     'supplier_priced', 'pricer'),
  ('supplier_priced', 'at_supplier',     'pricer'),
  ('supplier_priced', 'selling_build',   'gm'),
  ('selling_build',   'price_review',    'system'),
  ('price_review',    'approved',        'system'),
  ('price_review',    'selling_build',   'system'),
  ('price_review',    'at_supplier',     'pricer'),
  ('approved',        'quoted',          'system'),
  ('quoted',          'boq_frozen',      'pricer'),
  ('quoted',          'package_review',  'rpc_client_round')
) AS t(from_state, to_state, who);
GRANT SELECT ON public.pricing_file_transitions TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_client_round(_file_id uuid, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; old_rev public.boq_revisions; new_rev uuid := gen_random_uuid();
        n text := nullif(btrim(_note), '');
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Estimation or finance opens a client round. | جولة العميل يفتحها التقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF n IS NULL THEN
    RAISE EXCEPTION 'Say what the client changed. | اذكر ما غيّره العميل.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514'; END IF;
  IF f.state <> 'quoted' THEN
    RAISE EXCEPTION 'A client round starts from a quoted file. | جولة العميل تبدأ من ملف مُرسل عرضه.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO old_rev FROM public.boq_revisions WHERE id = f.boq_revision_id;
  INSERT INTO public.boq_revisions (id, boq_id, revision_number, status)
  VALUES (new_rev, old_rev.boq_id,
          (SELECT coalesce(max(revision_number), 0) + 1 FROM public.boq_revisions WHERE boq_id = old_rev.boq_id),
          'draft');
  -- Copy every content column of boq_lines (list them from the schema; see the step above).
  INSERT INTO public.boq_lines (revision_id, line_number, sign_type, description, quantity, unit /* , … */)
  SELECT new_rev, line_number, sign_type, description, quantity, unit /* , … */
    FROM public.boq_lines WHERE revision_id = old_rev.id;
  UPDATE public.pricing_files SET boq_revision_id = new_rev WHERE id = f.id RETURNING * INTO f;
  RETURN to_jsonb(public._pricing_file_apply(f, 'package_review', u, n));
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_client_round(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_client_round(uuid, text) TO authenticated;
```

Check `boq_revisions.status` accepts `'draft'` (`grep -n "boq_revision_status\|status" ` on its CREATE TABLE). Use the value the BOQ import RPC gives a new revision.

Check that `pricing_file_move` and the PR 2 RPCs read `who` only for `'pricer'`/`'gm'`/`'system'`: the new `'rpc_client_round'` rule must not be reachable through `pricing_file_move` (its check `rule NOT IN ('pricer','gm')` already refuses it). Add one assertion for that: `throws_ok` on `pricing_file_move(file, 'package_review')` from `quoted`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run `supabase db reset --local && supabase test db`.
Expected: all pass. `pricing_files.test.sql` may pin the transition count (14). If it does, update that one assertion to 15 and say why in the commit message.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261110120000_pricing_client_round.sql supabase/tests/pricing_client_round.test.sql
git commit -m "feat(pricing): a client change opens the next pricing round"
```

---

### Task 4: Access rules and action wrappers (TypeScript)

**Files:**
- Modify: `src/lib/pricing-access.ts`, `src/lib/pricing-access.test.ts`
- Modify: `src/lib/pricing-actions.ts`, `src/lib/pricing-actions.contract.test.ts`
- Create: `src/lib/quotation-doc.ts`, `src/lib/quotation-doc.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 RPC names and signatures.
- Produces:
  - `PricingRights` gains `is_finance: boolean; can_issue_quotation: boolean` (and `NO_RIGHTS` sets both false).
  - `PricingTab` gains `"approval" | "quotations"`.
  - `canReview(state, r)`, `canIssue(state, r)`, `canStartClientRound(state, r)`.
  - `reviewPrice(fileId, decision, reason?)`, `issueQuotation(fileId, terms)`, `markQuotationSent(revisionId)`, `startClientRound(fileId, note)` in `pricing-actions.ts`.
  - `unitPrice(lineTotal, qty)`, `vatOf(subtotal, rate)`, `linesMatch(lines, subtotal)`, `revisionLabel(n)` in `quotation-doc.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/pricing-access.test.ts`:

```ts
import { canIssue, canReview, canStartClientRound, visibleTabs, defaultTab, NO_RIGHTS } from "./pricing-access";

const finance = { ...NO_RIGHTS, is_pricer: true, can_read_cost: true, can_set_margins: true, is_finance: true };
const bd = { ...NO_RIGHTS, can_issue_quotation: true };

describe("PR 4 rights", () => {
  test("finance reviews only in price review", () => {
    expect(canReview("price_review", finance)).toBe(true);
    expect(canReview("selling_build", finance)).toBe(false);
    expect(canReview("price_review", { ...finance, is_finance: false })).toBe(false);
  });
  test("BD issues only an approved file", () => {
    expect(canIssue("approved", bd)).toBe(true);
    expect(canIssue("quoted", bd)).toBe(false);
    expect(canIssue("approved", NO_RIGHTS)).toBe(false);
  });
  test("a pricer opens a client round from quoted", () => {
    expect(canStartClientRound("quoted", finance)).toBe(true);
    expect(canStartClientRound("approved", finance)).toBe(false);
    expect(canStartClientRound("quoted", bd)).toBe(false);
  });
  test("cost readers see the approval and quotations tabs", () => {
    expect(visibleTabs(finance)).toEqual(["package", "supplier", "cost", "selling", "approval", "quotations"]);
    expect(visibleTabs({ ...NO_RIGHTS, is_pricer: true })).toEqual(["package", "supplier", "quotations"]);
  });
  test("default tab follows the state", () => {
    expect(defaultTab("price_review", finance)).toBe("approval");
    expect(defaultTab("approved", finance)).toBe("quotations");
    expect(defaultTab("quoted", finance)).toBe("quotations");
  });
});
```

Create `src/lib/quotation-doc.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { linesMatch, revisionLabel, unitPrice, vatOf } from "./quotation-doc";

describe("quotation document", () => {
  test("unit price is the line total over quantity, 2 decimals", () => {
    expect(unitPrice(1000, 3)).toBe(333.33);
    expect(unitPrice(0, 5)).toBe(0);
    expect(unitPrice(100, 0)).toBeNull();
  });
  test("VAT rounds to the halala like the generated column", () => {
    expect(vatOf(53200, 0.15)).toBe(7980);
    expect(vatOf(100.05, 0.15)).toBe(15.01);
  });
  test("lines must sum to the subtotal exactly", () => {
    expect(linesMatch([{ line_total: 100.1 }, { line_total: 200.2 }], 300.3)).toBe(true);
    expect(linesMatch([{ line_total: 100 }], 100.01)).toBe(false);
  });
  test("revision label counts from Rev 0 for the client", () => {
    expect(revisionLabel(1)).toBe("Rev 0");
    expect(revisionLabel(3)).toBe("Rev 2");
  });
});
```

Append to `src/lib/pricing-actions.contract.test.ts` one test per RPC, following the existing pattern in that file. It reads the migrations and checks that each wrapper's RPC name and argument names exist in SQL:

```ts
test.each([
  ["pricing_file_review", ["_file_id", "_decision", "_reason"]],
  ["pricing_issue_quotation", ["_file_id", "_valid_until", "_payment_terms", "_delivery_terms", "_scope_summary"]],
  ["pricing_mark_quotation_sent", ["_revision_id"]],
  ["pricing_file_client_round", ["_file_id", "_note"]],
])("%s exists in SQL with its argument names", (name, args) => {
  const sql = allMigrationsText(); // the helper this file already uses; reuse its name
  expect(sql).toContain(`FUNCTION public.${name}(`);
  for (const a of args) expect(sql).toMatch(new RegExp(`FUNCTION public\\.${name}\\([^)]*${a}`));
});
```

If the file's existing helper has a different name, use that name. The assertions stay as written.

- [ ] **Step 2: Run them to make sure they fail**

Run `bun test src/lib/pricing-access.test.ts src/lib/quotation-doc.test.ts src/lib/pricing-actions.contract.test.ts`.
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement**

In `src/lib/pricing-access.ts`:

```ts
export type PricingRights = {
  is_pricer: boolean;
  is_gm: boolean;
  can_read_cost: boolean;
  can_set_margins: boolean;
  /** 20261110100000: finance reviews the GM's price. */
  is_finance: boolean;
  /** 20261110100000: BD or sales manager issues and sends the quotation. */
  can_issue_quotation: boolean;
};
export const NO_RIGHTS: PricingRights = {
  is_pricer: false, is_gm: false, can_read_cost: false, can_set_margins: false,
  is_finance: false, can_issue_quotation: false,
};

export type PricingTab = "package" | "supplier" | "cost" | "selling" | "approval" | "quotations";
export const PRICING_TABS: readonly PricingTab[] = ["package", "supplier", "cost", "selling", "approval", "quotations"];
export const PRICING_TAB_LABEL: Record<PricingTab, Bi> = {
  package: { en: "Package", ar: "الباكيج" },
  supplier: { en: "Supplier", ar: "المورد" },
  cost: { en: "Cost review", ar: "مراجعة التكلفة" },
  selling: { en: "Selling price", ar: "سعر البيع" },
  approval: { en: "Approval", ar: "الاعتماد" },
  quotations: { en: "Quotations", ar: "عروض الأسعار" },
};

/** Cost, Selling and Approval show cost; Quotations shows selling figures only. */
export const visibleTabs = (r: PricingRights): PricingTab[] =>
  r.can_read_cost ? [...PRICING_TABS] : ["package", "supplier", "quotations"];

export function defaultTab(state: PricingState, r: PricingRights): PricingTab {
  const want: PricingTab =
    state === "supplier_priced"
      ? "cost"
      : state === "selling_build"
        ? "selling"
        : state === "price_review"
          ? "approval"
          : state === "approved" || state === "quoted"
            ? "quotations"
            : state === "boq_frozen" || state === "at_supplier"
              ? "supplier"
              : "package";
  return visibleTabs(r).includes(want) ? want : "package";
}

/** pricing_file_review: finance, while the file is in price review. */
export const canReview = (s: PricingState, r: PricingRights): boolean => r.is_finance && s === "price_review";
/** pricing_issue_quotation: BD or sales manager, once the price is approved. */
export const canIssue = (s: PricingState, r: PricingRights): boolean => r.can_issue_quotation && s === "approved";
/** pricing_file_client_round: a pricer, from a quoted file. */
export const canStartClientRound = (s: PricingState, r: PricingRights): boolean => r.is_pricer && s === "quoted";
```

Keep the rest of the file as it is. Then search for other places that build a `PricingRights` literal (`grep -rn "can_set_margins:" src`) and add the two fields there.

Create `src/lib/quotation-doc.ts`:

```ts
// Pure helpers for the printed quotation. The figures come from SQL
// (quotation_revisions, quotation_revision_lines); these only format them.
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Display only: the line total is the figure; the unit price is derived from it. */
export const unitPrice = (lineTotal: number, qty: number): number | null => (qty > 0 ? round2(lineTotal / qty) : null);

/** Mirrors the generated column round(subtotal * rate, 2). */
export const vatOf = (subtotal: number, rate: number): number => round2(subtotal * rate);

/** True when the lines add up to the subtotal to the halala. */
export const linesMatch = (lines: readonly { line_total: number }[], subtotal: number): boolean =>
  Math.round(lines.reduce((s, l) => s + Math.round(l.line_total * 100), 0)) === Math.round(subtotal * 100);

/** 7C numbers revisions from 1; the client and the meeting call the first one Rev 0. */
export const revisionLabel = (revisionNumber: number): string => `Rev ${revisionNumber - 1}`;
```

In `src/lib/pricing-actions.ts`, add four wrappers. Follow the existing wrappers' style: `supabase.rpc`, throw on error, return data.

```ts
export async function reviewPrice(fileId: string, decision: "approve" | "return", reason?: string) {
  const { data, error } = await supabase.rpc("pricing_file_review" as never, {
    _file_id: fileId, _decision: decision, _reason: reason ?? null,
  } as never);
  if (error) throw error;
  return data;
}

export type QuotationTerms = { validUntil: string; paymentTerms: string; deliveryTerms: string; scopeSummary: string };
export async function issueQuotation(fileId: string, t: QuotationTerms): Promise<string> {
  const { data, error } = await supabase.rpc("pricing_issue_quotation" as never, {
    _file_id: fileId, _valid_until: t.validUntil, _payment_terms: t.paymentTerms,
    _delivery_terms: t.deliveryTerms, _scope_summary: t.scopeSummary,
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

export async function markQuotationSent(revisionId: string) {
  const { data, error } = await supabase.rpc("pricing_mark_quotation_sent" as never, { _revision_id: revisionId } as never);
  if (error) throw error;
  return data;
}

export async function startClientRound(fileId: string, note: string) {
  const { data, error } = await supabase.rpc("pricing_file_client_round" as never, { _file_id: fileId, _note: note } as never);
  if (error) throw error;
  return data;
}
```

If the existing wrappers use a typed helper instead of `as never` casts (look at `sendToSupplier` in that file), use the same helper.

- [ ] **Step 4: Run the tests and make sure they pass**

Run `bun test src/lib/pricing-access.test.ts src/lib/quotation-doc.test.ts src/lib/pricing-actions.contract.test.ts`, then `bun run verify`.
Expected: PASS. `verify` may flag `pricing.$id.tsx`, which does not yet render the two new tabs; Task 5 adds them. If the typecheck fails only there, add the two `TabsContent` lines from Task 5 Step 3 now with a placeholder `null` body, and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing-access.ts src/lib/pricing-access.test.ts src/lib/quotation-doc.ts src/lib/quotation-doc.test.ts src/lib/pricing-actions.ts src/lib/pricing-actions.contract.test.ts
git commit -m "feat(pricing): access rules and actions for review, quotation and client rounds"
```

---

### Task 5: Approval and Quotations tabs on the pricing file

**Files:**
- Create: `src/components/phc/pricing/ApprovalTab.tsx`, `src/components/phc/pricing/QuotationsTab.tsx`
- Modify: `src/routes/_authenticated/pricing.$id.tsx`

**Interfaces:**
- Consumes: Task 4 (`canReview`, `canStartClientRound`, `reviewPrice`, `startClientRound`, `revisionLabel`); the tab props type in `src/components/phc/pricing/types.ts` (read it: the existing tabs take `{ file, rights, lang, … }`); `ReturnLinesDialog` (PR 3) for returning selected lines from price review; the `pricing_selling_totals` view.
- Produces: `ApprovalTab` and `QuotationsTab` components with the same props as the existing tabs.

- [ ] **Step 1: Read the patterns**

Read `src/components/phc/pricing/SellingPriceTab.tsx`, `ReturnLinesDialog.tsx`, `types.ts` and `src/components/phc/ActionDialog.tsx`. Use the same props, query keys (`["pricing-file", id]` etc.: copy the ones these files use), `ActionDialog`, `dbMessage` and `useQueryClient().invalidateQueries` pattern.

- [ ] **Step 2: Write `ApprovalTab.tsx`**

What it shows:
- **Summary** from `pricing_selling_totals` (`total_cost`, `total_selling`, `margin_pct`, `floor_pct`, `below_floor`) and, from `internal_prices` (listed columns: `proposed_price, below_floor_justification, proposed_by, proposed_at, return_reason, status`), Kalas's proposal. If below floor, show the justification in an amber `Callout`.
- **Three actions**, shown when `canReview(file.state, rights)`:
  - "Approve" → `ActionDialog` with a confirmation line ("Approve SAR X as the selling price?") → `reviewPrice(id, "approve")`.
  - "Return to the GM" → `ActionDialog` with a required textarea "Reason" → `reviewPrice(id, "return", reason)`.
  - "Return lines to the supplier" → open the existing `ReturnLinesDialog`. Check its props: it takes the file and calls `pricing_return_lines_to_supplier`, which accepts `price_review` (AI_HANDOFF contract). If it is hard-wired to `supplier_priced`, add a `from` prop rather than copying it.
- When the file is not in `price_review`: a one-line status. "Approved on {date}" after approval, "Waiting for the GM's proposal" before, and the last return reason if `status = 'returned'`.

Strings, all in `TEXT`:

```ts
const TEXT = {
  title: { en: "Price review", ar: "مراجعة السعر" },
  proposed: { en: "Proposed by the GM", ar: "اقترحه المدير العام" },
  cost: { en: "Total cost", ar: "إجمالي التكلفة" },
  selling: { en: "Selling price", ar: "سعر البيع" },
  margin: { en: "Margin", ar: "الهامش" },
  belowFloor: { en: "Below the margin floor. GM's justification:", ar: "تحت حد الهامش. مبرر المدير العام:" },
  approve: { en: "Approve", ar: "اعتماد" },
  approveConfirm: { en: "Approve this selling price? It goes to the quotation as it is.", ar: "اعتماد سعر البيع هذا؟ سيذهب إلى عرض السعر كما هو." },
  returnGm: { en: "Return to the GM", ar: "إرجاع للمدير العام" },
  reason: { en: "Reason", ar: "السبب" },
  returnLines: { en: "Return lines to the supplier", ar: "إرجاع بنود للمورد" },
  waiting: { en: "Waiting for the GM's proposal.", ar: "بانتظار اقتراح المدير العام." },
  approvedOn: { en: "Approved on", ar: "اعتُمد في" },
  lastReturn: { en: "Last returned with:", ar: "آخر إرجاع بسبب:" },
} satisfies Record<string, Bi>;
```

- [ ] **Step 3: Write `QuotationsTab.tsx` and mount both tabs**

`QuotationsTab` lists `quotation_revisions` where `pricing_file_id = file.id`, ordered by `revision_number desc`. Listed columns: `id, revision_number, status, subtotal_excl_vat, vat_amount, total_incl_vat, valid_until, approved_at, submitted_at`. Each row shows:
- `revisionLabel(n)`;
- the status (bilingual map for `approved`, `submitted`, `superseded`, `withdrawn`);
- the subtotal, VAT and total;
- the validity;
- an "Open / print" link to `/quotation-print/$revisionId`.

When `canStartClientRound(state, rights)`, show a "Client changes" button. It opens an `ActionDialog` with a required textarea ("What did the client change?") and calls `startClientRound`. Below the button, one hint line: "A discount without quantity changes goes through BAFO on the deal page."

When the file is `approved` and the reader cannot issue: "Approved. The BD manager issues the quotation from the deal page."

In `src/routes/_authenticated/pricing.$id.tsx`, import both components and add:

```tsx
{tabs.includes("approval") ? <TabsContent value="approval"><ApprovalTab {...props} /></TabsContent> : null}
<TabsContent value="quotations"><QuotationsTab {...props} /></TabsContent>
```

- [ ] **Step 4: Check**

Run `bun run verify`.
Expected: green. Then a local walk-through, if the local stack runs: as finance, open a file in price review; the Approval tab opens by default; approve; the Quotations tab shows nothing until issued.

- [ ] **Step 5: Commit**

```bash
git add src/components/phc/pricing/ApprovalTab.tsx src/components/phc/pricing/QuotationsTab.tsx src/routes/_authenticated/pricing.\$id.tsx
git commit -m "feat(pricing): approval and quotations tabs on the pricing file"
```

---

### Task 6: The deal page card and the printable quotation

**Files:**
- Create: `src/components/phc/pricing/DealPricingCard.tsx`
- Create: `src/routes/_authenticated/quotation-print.$revisionId.tsx`
- Modify: `src/routes/_authenticated/opportunities.$id.tsx`

**Interfaces:**
- Consumes: Task 4 (`canIssue`, `issueQuotation`, `markQuotationSent`, `revisionLabel`, `unitPrice`, `vatOf`, `linesMatch`); `daysWaiting`, `nextOwner`, `NEXT_OWNER_LABEL` (existing); `pricing_file_answer_needs_info(_file_id, _note)` (PR 1: allows the deal's sales contributors); `usePricingRights` (existing hook in `src/components/phc/pricing/usePricingRights.ts`).
- Produces: `<DealPricingCard opportunityId={…} />` and the route `/quotation-print/$revisionId`.

- [ ] **Step 1: Write `DealPricingCard.tsx`**

Data:
- `pricing_files` for the opportunity: `select("id, state, state_changed_at, needs_info_items, needs_info_due")`, `.eq("opportunity_id", id).neq("state","closed").maybeSingle()`. Check those column names against `20261103100000_pricing_files.sql`.
- Revisions: `quotation_revisions` with `pricing_file_id = file.id` (same listed columns as Task 5).

Shows:
- State and wait: "Pricing: {state label} · {daysWaiting} days · next: {NEXT_OWNER_LABEL}". Reuse the state labels the pricing queue uses (`src/lib/pricing-queue.ts` or `pricing.ts`: find `STATE_LABEL`).
- When `needs_info`: the list of missing items, their due date, and an "Answer" `ActionDialog` (required note) → `supabase.rpc("pricing_file_answer_needs_info", { _file_id, _note })`. This is for the rep; SQL decides who may.
- When `canIssue(state, rights)`: an "Issue quotation" `ActionDialog` with these fields → `issueQuotation`, then navigate to `/quotation-print/$newId`:
  - valid until (date, default today + 30);
  - payment terms (textarea, placeholder "e.g. 30% advance, 40% on delivery (MIR), 30% on installation (WIR)");
  - delivery terms;
  - scope summary.
- The revisions list, as in Task 5, plus "Mark as sent" on the current `approved` revision when `rights.can_issue_quotation` → `markQuotationSent`.
- Never any cost figure. The card reads no cost table or view.

Render nothing when the deal has no pricing file.

Mount it in `src/routes/_authenticated/opportunities.$id.tsx` next to the existing quotation and BAFO panels (`grep -n "BafoPanel" src/routes/_authenticated/opportunities.\$id.tsx`), as `<DealPricingCard opportunityId={id} />`.

- [ ] **Step 2: Write the print route**

`src/routes/_authenticated/quotation-print.$revisionId.tsx` loads:
- the revision: `quotation_revisions` (`id, quotation_id, revision_number, status, currency, subtotal_excl_vat, vat_rate, vat_amount, total_incl_vat, valid_until, payment_terms, delivery_terms, scope_summary, approved_at, issued_at`);
- its lines: `quotation_revision_lines` (`line_number, description, quantity, unit, line_total`, ordered by `line_number`);
- the header: `quotations` (`quote_number, related_opportunity_id`);
- the deal: `opportunities` (`project_name, client, project_code`).

Layout: one A4 page in the reader's language and direction.
- Header: `/phc-logo.png` at the start side; "Quotation / عرض سعر"; `quote_number` + `revisionLabel`; date (`issued_at ?? approved_at`); validity.
- "To": client and project name.
- Table: No., description, qty, unit, unit price (`unitPrice`), total.
- Totals: subtotal, VAT ({rate × 100}%), total incl. VAT. Use the stored `vat_amount` and `total_incl_vat`, not recomputed ones.
- Payment terms, delivery terms, scope.
- Footer: the company line from an existing letterhead constant if one exists (`grep -rn "phc-sa.com" src/lib | head`). Otherwise just "PHC".

A "Print / Save as PDF" button calls `window.print()`. It and the app shell are hidden in print with `print:hidden`. Check the app shell wraps routes under `_authenticated`; if the sidebar still prints, add `print:hidden` to its root in `AppShell.tsx`.

If `!linesMatch(lines, subtotal)`, show a red `Callout` ("The lines do not add up to the total; do not send this. Tell finance.") and disable the print button. This should never happen, since SQL checks it at issue.

Use `@media print` via Tailwind's `print:` variants only. Add `@page { size: A4; margin: 14mm; }` once in the route through a `<style>` element.

- [ ] **Step 3: Build and check**

Run `bun run build` (regenerates `src/routeTree.gen.ts`; commit it), then `bun run verify`.
Expected: green. Open the print route locally, print to PDF in Chrome in both languages, and check that Arabic renders joined and right-to-left.

- [ ] **Step 4: Commit**

```bash
git add src/components/phc/pricing/DealPricingCard.tsx src/routes/_authenticated/quotation-print.\$revisionId.tsx src/routes/_authenticated/opportunities.\$id.tsx src/routeTree.gen.ts src/components/phc/AppShell.tsx
git commit -m "feat(pricing): deal pricing card and printable quotation"
```

---

### Task 7: "Review selling price" on the approvals page

**Files:**
- Modify: `src/lib/approvals-center.ts` (+ `src/lib/approvals-center.test.ts`), `src/lib/approval-labels.ts` (+ test), `src/lib/approvals-loader.ts`, `src/routes/_authenticated/approvals.tsx`

**Interfaces:**
- Consumes: the `pricing_queue` view (PR 2: one row per open file with `state`, `state_changed_at`, project code). Check its columns with `grep -n "VIEW public.pricing_queue" -A30 supabase/migrations/*.sql`.
- Produces: an approvals item kind `pricing_price_review` with label `{ en: "Review selling price", ar: "مراجعة سعر البيع" }`, linking to `/pricing/$id?tab=approval`.

- [ ] **Step 1: Write the failing test**

Read how `approvals-center.ts` builds items from loader rows (look at an existing kind, e.g. the BAFO one). Add a test to `approvals-center.test.ts` in the same style:

```ts
test("a pricing file in price review is a finance decision", () => {
  const items = buildApprovalItems({ ...emptyInput, pricingReviews: [
    { id: "f1", project_code: "FA-26-0001", state_changed_at: "2026-11-09T08:00:00Z" },
  ] }, financeRoles);
  const item = items.find((i) => i.kind === "pricing_price_review");
  expect(item?.href).toBe("/pricing/f1?tab=approval");
});
```

Use the real names of the builder, its input type and the role fixture from that file. The assertion stays: a row in `pricingReviews` produces one item of kind `pricing_price_review` whose link opens the Approval tab.

- [ ] **Step 2: Run it to make sure it fails**

Run `bun test src/lib/approvals-center.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

- Loader: when the user holds `finance_manager`, query `pricing_queue` with `state = 'price_review'`.
- Center: map each row to an item of kind `pricing_price_review`, with the project code as title, days waiting, and href `/pricing/${id}?tab=approval`.
- Labels: add the kind to `approval-labels.ts` and its test.
- Page: the existing list renders items generically. Add a case only if kinds are switched on explicitly there.

- [ ] **Step 4: Run tests and verify**

Run `bun test src/lib/approvals-center.test.ts src/lib/approval-labels.test.ts && bun run verify`. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/approvals-center.ts src/lib/approvals-center.test.ts src/lib/approval-labels.ts src/lib/approval-labels.test.ts src/lib/approvals-loader.ts src/routes/_authenticated/approvals.tsx
git commit -m "feat(approvals): finance sees prices waiting for review"
```

---

### Task 8: Docs, whole-branch review, PR

**Files:**
- Modify: `docs/USER_GUIDE.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/AI_HANDOFF.md`, `tasks/current.md`

- [ ] **Step 1: Docs (Arabic first, the house style of these files)**
  - USER_GUIDE: "مراجعة سعر البيع" (Zayed's three actions), "إصدار عرض السعر وطباعته" (Marie: deal page → issue → print → mark sent), "جولة تعديل العميل".
  - CHANGELOG: one entry for PR 4.
  - DECISIONS: plan questions 1–6 with the defaults applied, marked "default, Mo did not answer" unless Mo answered.
  - AI_HANDOFF: a new top entry with release steps (`db push` of three migrations; no function deploy; canary walk-through below), the contract for PR 5 (the AI reviews notify through `emit_notification*` like Task 1's trigger; the quote review runs on `supplier_priced`), and "Not in PR 4" below.
  - tasks/current.md: a new active item for PR 4.

Canary walk-through for AI_HANDOFF:
1. Kalas proposes on a test file.
2. Zayed gets the notice and returns it with a reason. Kalas gets the notice; the reason is on the file, not in the notice.
3. Kalas proposes again; Zayed approves. Marie and the rep get the notice.
4. Marie, on the deal page, issues with terms; the print page opens. Print to PDF in Arabic and English and check the totals.
5. Marie marks it sent.
6. The rep sees the state, the quotation and the lines, and no cost anywhere (also `GET /rest/v1/pricing_file_lines?select=built_cost` returns 42501 or `[]`).
7. Zayed starts a client round; the file is at package review on BOQ Rev 2.

- [ ] **Step 2: Whole-branch review**

Run a read-only review of `git diff origin/main...HEAD` focused on:
- cost leaking to sales: the card, the print route, the notifications, `quotation_revision_lines`;
- the guard change: can anything other than the issue RPC approve a revision without the GM?;
- lock order in the new RPCs;
- the supplier isolation sweep.

Fix what it finds and run `supabase test db` and `bun run verify` again.

- [ ] **Step 3: Open the PR (do not merge)**

```bash
git push -u origin feat/pricing-review-quotation
gh pr create --base main --title "Pricing loop PR 4: Zayed's review, the quotation, sales status, client rounds" --body-file <(cat <<'EOF'
## What
- Finance (Zayed) approves the GM's price, returns it with a reason, or returns lines to the supplier.
- The BD manager issues the quotation from the approved price (line snapshot, VAT), prints it to PDF and marks it sent.
- The rep sees the pricing state on the deal and answers missing items there.
- A client change opens the next round on a new BOQ revision.
- Notifications for review, return, approval and missing items.

## Decisions to confirm (defaults applied)
See docs/DECISIONS.md: in-file quotations are approved by the issue itself (no second GM signature); line prices on the PDF; BD and sales manager issue; a client round goes back through the supplier.

## Release
1. `supabase db push` (3 migrations). 2. No function deploy. 3. Canary walk-through (AI_HANDOFF). 4. Production.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

- [ ] **Step 4: Commit the docs** (before the push above)

```bash
git add docs tasks/current.md
git commit -m "docs: PR 4 guide, decisions, handoff"
```

---

## Not in PR 4 (each with its reason; Task 8 records them in AI_HANDOFF)

- **Carrying supplier prices forward for unchanged lines in a client round.** It needs a rule for what "unchanged" means (same line number? same spec?). Ask Zayed after the first real round.
- **Sending the PDF by email from the system.** There is no transactional email provider yet (Postmark is parked).
- **The quotation numbering scheme** beyond the project code + `-Q`. Confirm Marie's format.
- **AI package and quote reviews:** PR 5.
- **Everything after the contract** (milestones, MIR/WIR, invoices, collections, variations): phase B, which needs its own design.
