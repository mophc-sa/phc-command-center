# Pricing loop — PR 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the database foundation of the pricing loop: one pricing file per RFQ with an enforced state machine, the installation rate card, the extras catalog with auto-suggestions, logistics rates, structured BOQ line attributes, and a one-step GM approval path. Plus the TypeScript mirror the screens in PR 2 will use.

**Architecture:** Five migrations add tables and SECURITY DEFINER RPCs on top of the Phase 7A–8 engine (`boq_revisions`, `boq_lines`, `estimations`, `internal_prices`, `supplier_quote_lines`). Authorization lives in SQL; the browser calls RPCs through `supabase.rpc`. Calculations are in SQL with a pure TypeScript mirror for display and tests. There is no UI in this PR, and no Edge Function change.

**Tech Stack:** Postgres 15 (Supabase), pgTAP (`supabase/tests`), TypeScript + bun test (`src/lib`).

**Spec:** `docs/superpowers/specs/2026-11-03-pricing-loop-design.md`. Meeting record: `docs/finance/2026-11-03-ahmed-zayed-meeting.md`.

## Global Constraints

- Every new table has `ENABLE ROW LEVEL SECURITY`. Writes go through RPCs: no direct INSERT/UPDATE grants on workflow tables.
- Cost columns are never readable by sales. A cost read requires `public.can_read_commercial_cost(auth.uid())` (estimation_manager, finance_manager, MD, GM, CEO).
- "Pricer" = `estimation_manager` or `finance_manager`, through the new `public.is_pricer(uuid)`.
- Error messages are bilingual: `'English. | العربية.'`. The codes are `42501` (not allowed), `23514` (bad input) and `P0001` (rule).
- No Arabic-Indic digits in any source string. `src/lib/arabic-digits.test.ts` enforces this.
- Migration numbers: `20261103100000` … `20261103140000`. Before starting, re-check that the highest on `origin/main` is below `20261103100000`, and renumber upward if not.
- Every RPC: `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated;`.
- Every state change writes `audit_log` (`actor_type 'user'`).

**Deviations from the spec's delivery table (recorded in DECISIONS in Task 7):**
1. Actions are SQL RPCs instead of `sales-os-api` actions, so this PR needs no function deploy.
2. The `supplier` role moves to PR 3, together with the portal that uses it.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261103100000_pricing_files.sql` | State enum, `is_pricer`, `pricing_files`, `pricing_file_events`, RLS, open RPC, auto-open on RFQ insert |
| `supabase/migrations/20261103110000_pricing_state_machine.sql` | `pricing_file_move`, `pricing_file_set_needs_info`, `pricing_file_answer_needs_info` |
| `supabase/migrations/20261103120000_pricing_rates.sql` | `install_type` enum, `installation_rates`, `pricing_extras_catalog`, `logistics_rates`, new `boq_lines` / `supplier_quote_lines` columns, cost-gated RLS |
| `supabase/migrations/20261103130000_pricing_calc.sql` | `pricing_installation_cost()`, `pricing_file_extras`, `pricing_suggest_extras()`, `pricing_decide_extra()`, propose guard |
| `supabase/migrations/20261103140000_pricing_gm_one_step.sql` | Allow `internal_price_proposed → gm_pending` for finance; sync file state from `internal_prices` |
| `supabase/tests/pricing_files.test.sql` | Access and auto-open |
| `supabase/tests/pricing_state_machine.test.sql` | Transitions and who may make them |
| `supabase/tests/pricing_rates.test.sql` | Cost isolation for rates and lines |
| `supabase/tests/pricing_calc.test.sql` | Installation cost, suggestions, propose guard |
| `supabase/tests/pricing_gm_one_step.test.sql` | One-step approval and state sync |
| `src/lib/pricing.ts` | States, labels (en/ar), transition table, `installationCost()` mirror |
| `src/lib/pricing.test.ts` | Unit tests for the mirror |
| `src/lib/pricing.contract.test.ts` | TS transitions match the SQL transition list |
| `src/lib/pricing-actions.ts` | `supabase.rpc` wrappers |
| `src/integrations/supabase/types.ts` | Hand patch for the new tables, enums and RPCs |
| `docs/USER_GUIDE.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/AI_HANDOFF.md`, `tasks/current.md` | Docs, in the same PR |

**Local DB tests.** Run:

```bash
zsh -c 'source ~/.supabase-guard.zsh && supabase db start && supabase test db'
```

If the local stack is unavailable (port 54322 can be taken by another project), rely on the CI job "Supabase migrations and database tests", which runs `supabase test db` on every push.

---

### Task 1: Pricing files: table, access, opening

**Files:**
- Create: `supabase/migrations/20261103100000_pricing_files.sql`
- Test: `supabase/tests/pricing_files.test.sql`

**Interfaces:**
- Produces:
  - SQL type `public.pricing_file_state` with values `received, package_review, needs_info, boq_frozen, at_supplier, supplier_priced, cost_review, selling_build, gm_pending, approved, quoted, closed`.
  - `public.is_pricer(uuid) → boolean`
  - Table `public.pricing_files(id, opportunity_id, rfq_id, state, boq_revision_id, estimation_id, internal_price_id, due_at, needs_info_items, needs_info_due, closed_reason, opened_by, created_at, updated_at, state_changed_at, state_changed_by)`
  - Table `public.pricing_file_events(id, file_id, from_state, to_state, actor_id, note, created_at)`
  - `public.open_pricing_file(_opportunity_id uuid, _rfq_id uuid DEFAULT NULL) → jsonb`, which returns the file row.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_files.test.sql`:

```sql
-- Pricing files: who reads them, who opens them, and the auto-open on a new RFQ.
-- Test user UUIDs use the 5a… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000001','authenticated','authenticated','pf-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000002','authenticated','authenticated','pf-other+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000003','authenticated','authenticated','pf-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5a000000-%';
insert into public.user_roles (user_id, role) values
  ('5a000000-0000-0000-0000-000000000001','salesperson'),
  ('5a000000-0000-0000-0000-000000000002','salesperson'),
  ('5a000000-0000-0000-0000-000000000003','estimation_manager');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('5a200000-0000-0000-0000-000000000001','pf-deal','5a000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','rfq_received');

-- An RFQ on a deal opens a pricing file by itself.
insert into public.rfqs (id, opportunity_id, sales_owner_id, status)
values ('5a300000-0000-0000-0000-000000000001','5a200000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','open');
select is((select count(*)::int from public.pricing_files where opportunity_id = '5a200000-0000-0000-0000-000000000001'), 1,
  'A new RFQ on a deal opens one pricing file');
select is((select state::text from public.pricing_files where opportunity_id = '5a200000-0000-0000-0000-000000000001'), 'received',
  '... in state received');
select is((select count(*)::int from public.pricing_file_events e join public.pricing_files f on f.id = e.file_id
  where f.opportunity_id = '5a200000-0000-0000-0000-000000000001' and e.to_state = 'received'), 1,
  '... and logs the opening');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.pricing_files), 1, 'The deal owner reads the file state');
select throws_ok($$insert into public.pricing_files (opportunity_id) values ('5a200000-0000-0000-0000-000000000001')$$,
  '42501', null, 'Direct inserts are refused');

select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.pricing_files), 0, 'Someone outside the deal reads nothing');
select throws_ok($$select public.open_pricing_file('5a200000-0000-0000-0000-000000000001')$$,
  '42501', null, 'Only a pricer may open a file by hand');

select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((public.open_pricing_file('5a200000-0000-0000-0000-000000000001'))->>'state', 'received',
  'Opening again returns the open file instead of a second one');
reset role;
select * from finish();
rollback;
```

If an `rfqs` insert in a test fails on another NOT NULL column, copy the minimal insert from `supabase/tests/intake_code_follows_sales_rep.test.sql`. `boqs` also needs `title` (NOT NULL); the later tests include it.

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected: FAIL in `pricing_files.test.sql`, with `relation "public.pricing_files" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261103100000_pricing_files.sql`:

```sql
-- =============================================================================
-- Pricing loop, part 1: one pricing file per RFQ (spec 2026-11-03-pricing-loop-design).
--
-- The file carries one state for the whole RFQ-to-quotation path, so the
-- estimation queue, the deal page and the GM all read the same answer to
-- "where is this price and who owes the next step". It holds no money: cost
-- lives in the Phase 7A–8 tables it points at, behind their own gates.
-- Writes go through RPCs only; the state machine is in the next migration.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.pricing_file_state AS ENUM (
    'received','package_review','needs_info','boq_frozen','at_supplier',
    'supplier_priced','cost_review','selling_build','gm_pending',
    'approved','quoted','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estimation and finance are one person today (Ahmed Zayed, DECISIONS
-- 2026-08); the predicate admits either role so the split stays possible.
CREATE OR REPLACE FUNCTION public.is_pricer(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL
     AND public.has_app_access(_user_id)
     AND (public.has_role(_user_id, 'estimation_manager'::public.app_role)
          OR public.has_role(_user_id, 'finance_manager'::public.app_role));
$$;
REVOKE ALL ON FUNCTION public.is_pricer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_pricer(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.pricing_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id    uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  rfq_id            uuid REFERENCES public.rfqs(id) ON DELETE SET NULL,
  state             public.pricing_file_state NOT NULL DEFAULT 'received',
  boq_revision_id   uuid REFERENCES public.boq_revisions(id) ON DELETE RESTRICT,
  estimation_id     uuid REFERENCES public.estimations(id) ON DELETE RESTRICT,
  internal_price_id uuid REFERENCES public.internal_prices(id) ON DELETE RESTRICT,
  due_at            date,
  needs_info_items  text[] NOT NULL DEFAULT '{}',
  needs_info_due    date,
  closed_reason     text,
  opened_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  state_changed_at  timestamptz NOT NULL DEFAULT now(),
  state_changed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT pricing_files_closed_has_reason CHECK (state <> 'closed' OR closed_reason IS NOT NULL)
);
-- One open file per deal: a client revision reuses the file, it does not fork it.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_files_one_open_per_deal
  ON public.pricing_files (opportunity_id) WHERE state <> 'closed';
CREATE INDEX IF NOT EXISTS pricing_files_state ON public.pricing_files (state, state_changed_at);

CREATE TABLE IF NOT EXISTS public.pricing_file_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id     uuid NOT NULL REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  from_state  public.pricing_file_state,
  to_state    public.pricing_file_state NOT NULL,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pricing_file_events_file ON public.pricing_file_events (file_id, created_at);

ALTER TABLE public.pricing_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_file_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_files, public.pricing_file_events FROM anon, authenticated;
GRANT SELECT ON public.pricing_files, public.pricing_file_events TO authenticated;
GRANT ALL ON public.pricing_files, public.pricing_file_events TO service_role;

-- Whoever can read the deal can read where its price is; pricers read all.
DROP POLICY IF EXISTS "Pricing files readable with the deal" ON public.pricing_files;
CREATE POLICY "Pricing files readable with the deal" ON public.pricing_files FOR SELECT TO authenticated
  USING (public.is_pricer(auth.uid()) OR public.can_read_boq(opportunity_id, auth.uid()));
DROP POLICY IF EXISTS "Pricing file events readable with the file" ON public.pricing_file_events;
CREATE POLICY "Pricing file events readable with the file" ON public.pricing_file_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pricing_files f WHERE f.id = file_id
                 AND (public.is_pricer(auth.uid()) OR public.can_read_boq(f.opportunity_id, auth.uid()))));

-- Opens (or returns) the deal's open file. Shared by the RPC and the RFQ trigger.
CREATE OR REPLACE FUNCTION public._pricing_file_open(_opportunity_id uuid, _rfq_id uuid, _actor uuid)
RETURNS public.pricing_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files;
BEGIN
  SELECT * INTO f FROM public.pricing_files
   WHERE opportunity_id = _opportunity_id AND state <> 'closed' FOR UPDATE;
  IF FOUND THEN RETURN f; END IF;
  INSERT INTO public.pricing_files (opportunity_id, rfq_id, opened_by, state_changed_by)
  VALUES (_opportunity_id, _rfq_id, _actor, _actor) RETURNING * INTO f;
  INSERT INTO public.pricing_file_events (file_id, from_state, to_state, actor_id, note)
  VALUES (f.id, NULL, 'received', _actor, CASE WHEN _actor IS NULL THEN 'Opened with the RFQ' END);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (_actor, CASE WHEN _actor IS NULL THEN 'system' ELSE 'user' END, 'pricing_file.opened',
          'opportunity', _opportunity_id, jsonb_build_object('file_id', f.id, 'rfq_id', _rfq_id));
  RETURN f;
END $$;
REVOKE ALL ON FUNCTION public._pricing_file_open(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

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
  f := public._pricing_file_open(_opportunity_id, _rfq_id, u);
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.open_pricing_file(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_pricing_file(uuid, uuid) TO authenticated;

-- An RFQ that belongs to a deal starts its price. RFQs without a deal wait
-- for one: a BOQ (boqs.related_opportunity_id NOT NULL) cannot exist without it.
CREATE OR REPLACE FUNCTION public.pricing_file_on_rfq()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.opportunity_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    PERFORM public._pricing_file_open(NEW.opportunity_id, NEW.id, NULL);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_on_rfq() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rfqs_open_pricing_file ON public.rfqs;
CREATE TRIGGER rfqs_open_pricing_file AFTER INSERT ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.pricing_file_on_rfq();

COMMENT ON TABLE public.pricing_files IS
  'One per RFQ-to-quotation path. State only, no money. Read with the deal; written through RPCs (pricing_file_*). Spec 2026-11-03-pricing-loop-design.';
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected: `pricing_files.test.sql .. ok`, and every other file still `ok`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261103100000_pricing_files.sql supabase/tests/pricing_files.test.sql
git commit -m "feat(pricing): pricing files opened per RFQ, readable with the deal"
```

---

### Task 2: The state machine

**Files:**
- Create: `supabase/migrations/20261103110000_pricing_state_machine.sql`
- Test: `supabase/tests/pricing_state_machine.test.sql`

**Interfaces:**
- Consumes: `pricing_files`, `pricing_file_events`, `is_pricer` (Task 1).
- Produces:
  - `public.pricing_file_transitions` (view of `from_state, to_state, who`), where `who` ∈ `pricer`, `deal`, `system`.
  - `public.pricing_file_move(_file_id uuid, _to public.pricing_file_state, _note text DEFAULT NULL) → jsonb`
  - `public.pricing_file_set_needs_info(_file_id uuid, _items text[], _due date) → jsonb`
  - `public.pricing_file_answer_needs_info(_file_id uuid, _note text) → jsonb`

**Rules** (from spec §1, with `closed` added as the terminal state for won, lost or cancelled):

| from → to | who | extra rule |
|---|---|---|
| received → package_review | pricer | — |
| package_review → needs_info | pricer | only through `pricing_file_set_needs_info`, which needs ≥1 item and a due date |
| needs_info → package_review | deal (owner, or pipeline operator) or pricer | only through `pricing_file_answer_needs_info` |
| package_review → boq_frozen | pricer | `boq_revision_id` set and that revision `frozen_at IS NOT NULL` |
| boq_frozen → at_supplier | pricer | — |
| at_supplier → supplier_priced | pricer | — (PR 3 adds the supplier) |
| supplier_priced → cost_review | pricer | — |
| cost_review → at_supplier | pricer | note required (which lines go back) |
| cost_review → selling_build | pricer | — |
| selling_build → gm_pending | system | set by Task 5 when the internal price reaches `gm_pending` |
| gm_pending → approved | system | Task 5, on `gm_approved` |
| gm_pending → selling_build | system | Task 5, on `returned` |
| approved → quoted | deal | PR 4 (the quotation is sent) |
| quoted → boq_frozen | pricer | a new frozen revision, different from the current one |
| any non-closed → closed | pricer | note required (becomes `closed_reason`) |

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_state_machine.test.sql`:

```sql
-- The pricing file moves only along its path, and only by the right person.
-- Test user UUIDs use the 5b… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5b000000-0000-0000-0000-000000000001','authenticated','authenticated','sm-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5b000000-0000-0000-0000-000000000003','authenticated','authenticated','sm-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5b000000-%';
insert into public.user_roles (user_id, role) values
  ('5b000000-0000-0000-0000-000000000001','salesperson'),
  ('5b000000-0000-0000-0000-000000000003','estimation_manager');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('5b200000-0000-0000-0000-000000000001','sm-deal','5b000000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001','rfq_received');
insert into public.rfqs (id, opportunity_id, sales_owner_id, status)
values ('5b300000-0000-0000-0000-000000000001','5b200000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001','open');
insert into public.boqs (id, related_opportunity_id, title) values ('5b400000-0000-0000-0000-000000000001','5b200000-0000-0000-0000-000000000001','sm-boq');
insert into public.boq_revisions (id, boq_id, revision_number) values ('5b500000-0000-0000-0000-000000000001','5b400000-0000-0000-0000-000000000001',1);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'package_review')$$,
  '42501', null, 'A rep cannot start the review');

select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((public.pricing_file_move((select id from public.pricing_files limit 1),'package_review'))->>'state',
  'package_review', 'The pricer starts the review');
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'at_supplier')$$,
  'P0001', null, 'A state cannot be skipped');
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'needs_info')$$,
  'P0001', null, 'Needs-info goes through its own RPC with a list');
select is((public.pricing_file_set_needs_info((select id from public.pricing_files limit 1), array['Location plan'], current_date + 2))->>'state',
  'needs_info', 'The pricer asks sales for missing items');

select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((public.pricing_file_answer_needs_info((select id from public.pricing_files limit 1), 'Uploaded'))->>'state',
  'package_review', 'The deal owner answers and the file returns to review');

select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'boq_frozen')$$,
  'P0001', null, 'BOQ frozen needs a frozen revision on the file');
reset role;
update public.boq_revisions set frozen_at = now(), frozen_by = '5b000000-0000-0000-0000-000000000003', status = 'verified'
 where id = '5b500000-0000-0000-0000-000000000001';
update public.pricing_files set boq_revision_id = '5b500000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((public.pricing_file_move((select id from public.pricing_files limit 1),'boq_frozen'))->>'state',
  'boq_frozen', 'With a frozen revision the BOQ freezes');
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'closed')$$,
  'P0001', null, 'Closing needs a reason');
select is((select count(*)::int from public.pricing_file_events), 5, 'Every move is logged (open + 4 moves)');
select throws_ok($$update public.pricing_files set state = 'approved'$$, '42501', null, 'Direct state writes are refused');
reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected: FAIL, with `function public.pricing_file_move(uuid, pricing_file_state) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261103110000_pricing_state_machine.sql`:

```sql
-- =============================================================================
-- Pricing loop, part 2: the pricing file's path, enforced.
-- Anything not in pricing_file_transitions is refused, so a skip is an error
-- rather than a shortcut. 'system' moves are made by triggers only (Task 5
-- for gm_pending/approved, PR 4 for quoted); RPC callers can never make them.
-- =============================================================================

CREATE OR REPLACE VIEW public.pricing_file_transitions AS
SELECT * FROM (VALUES
  ('received'::public.pricing_file_state,       'package_review'::public.pricing_file_state, 'pricer'),
  ('package_review',  'needs_info',      'rpc_needs_info'),
  ('needs_info',      'package_review',  'rpc_answer'),
  ('package_review',  'boq_frozen',      'pricer'),
  ('boq_frozen',      'at_supplier',     'pricer'),
  ('at_supplier',     'supplier_priced', 'pricer'),
  ('supplier_priced', 'cost_review',     'pricer'),
  ('cost_review',     'at_supplier',     'pricer'),
  ('cost_review',     'selling_build',   'pricer'),
  ('selling_build',   'gm_pending',      'system'),
  ('gm_pending',      'approved',        'system'),
  ('gm_pending',      'selling_build',   'system'),
  ('approved',        'quoted',          'system'),
  ('quoted',          'boq_frozen',      'pricer')
) AS t(from_state, to_state, who);
GRANT SELECT ON public.pricing_file_transitions TO authenticated;

-- The one place a state changes. Callers pass who they are acting as.
CREATE OR REPLACE FUNCTION public._pricing_file_apply(_file public.pricing_files, _to public.pricing_file_state,
                                                       _actor uuid, _note text)
RETURNS public.pricing_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files;
BEGIN
  UPDATE public.pricing_files
     SET state = _to, state_changed_at = now(), state_changed_by = _actor, updated_at = now(),
         closed_reason = CASE WHEN _to = 'closed' THEN _note ELSE closed_reason END
   WHERE id = _file.id RETURNING * INTO f;
  INSERT INTO public.pricing_file_events (file_id, from_state, to_state, actor_id, note)
  VALUES (f.id, _file.state, _to, _actor, nullif(btrim(coalesce(_note,'')), ''));
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (_actor, CASE WHEN _actor IS NULL THEN 'system' ELSE 'user' END, 'pricing_file.moved',
          'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'from', _file.state, 'to', _to));
  RETURN f;
END $$;
REVOKE ALL ON FUNCTION public._pricing_file_apply(public.pricing_files, public.pricing_file_state, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_move(_file_id uuid, _to public.pricing_file_state, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; rule text;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may move a pricing file. | تحريك ملف التسعير يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514'; END IF;
  IF f.state = 'closed' THEN RAISE EXCEPTION 'This pricing file is closed. | ملف التسعير مغلق.'; END IF;

  IF _to = 'closed' THEN
    IF length(btrim(coalesce(_note,''))) = 0 THEN
      RAISE EXCEPTION 'Closing needs a reason. | الإغلاق يحتاج سبباً.';
    END IF;
    RETURN to_jsonb(public._pricing_file_apply(f, _to, u, _note));
  END IF;

  SELECT who INTO rule FROM public.pricing_file_transitions WHERE from_state = f.state AND to_state = _to;
  IF rule IS DISTINCT FROM 'pricer' THEN
    RAISE EXCEPTION 'Illegal pricing move % -> %. | انتقال غير مسموح في ملف التسعير.', f.state, _to;
  END IF;

  IF _to = 'boq_frozen' AND NOT EXISTS (
       SELECT 1 FROM public.boq_revisions r WHERE r.id = f.boq_revision_id AND r.frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Freeze a BOQ revision on this file first. | جمّد إصدار جدول الكميات أولاً.';
  END IF;
  IF f.state = 'quoted' AND _to = 'boq_frozen' AND NOT EXISTS (
       SELECT 1 FROM public.pricing_file_events e
        WHERE e.file_id = f.id AND e.to_state = 'quoted'
          AND e.created_at < (SELECT r.frozen_at FROM public.boq_revisions r WHERE r.id = f.boq_revision_id)) THEN
    RAISE EXCEPTION 'A client revision needs a new frozen BOQ revision. | مراجعة العميل تحتاج إصدار كميات جديداً مجمّداً.';
  END IF;
  IF f.state = 'cost_review' AND _to = 'at_supplier' AND length(btrim(coalesce(_note,''))) = 0 THEN
    RAISE EXCEPTION 'Say which lines go back to the supplier. | اذكر الأسطر المُرجعة للمورد.';
  END IF;

  RETURN to_jsonb(public._pricing_file_apply(f, _to, u, _note));
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_move(uuid, public.pricing_file_state, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_move(uuid, public.pricing_file_state, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_set_needs_info(_file_id uuid, _items text[], _due date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; clean text[];
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may ask for missing items. | طلب النواقص يقتصر على التقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(btrim(i)) INTO clean FROM unnest(coalesce(_items,'{}')) i WHERE length(btrim(i)) > 0;
  IF coalesce(array_length(clean,1),0) = 0 OR _due IS NULL OR _due < current_date THEN
    RAISE EXCEPTION 'List at least one missing item and a due date from today. | اذكر بنداً ناقصاً واحداً على الأقل وموعداً من اليوم.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND OR f.state <> 'package_review' THEN
    RAISE EXCEPTION 'Missing items can be asked during package review only. | النواقص تُطلب أثناء دراسة الباكيج فقط.';
  END IF;
  UPDATE public.pricing_files SET needs_info_items = clean, needs_info_due = _due WHERE id = f.id RETURNING * INTO f;
  RETURN to_jsonb(public._pricing_file_apply(f, 'needs_info', u, array_to_string(clean, '; ')));
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_set_needs_info(uuid, text[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_set_needs_info(uuid, text[], date) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_answer_needs_info(_file_id uuid, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files;
BEGIN
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514'; END IF;
  IF NOT (public.is_pricer(u) OR (public.is_sales_contributor(u) AND public.can_read_boq(f.opportunity_id, u))) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  IF f.state <> 'needs_info' THEN RAISE EXCEPTION 'Nothing is waiting for an answer. | لا توجد نواقص بانتظار الرد.'; END IF;
  UPDATE public.pricing_files SET needs_info_due = NULL WHERE id = f.id RETURNING * INTO f;
  RETURN to_jsonb(public._pricing_file_apply(f, 'package_review', u, _note));
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_answer_needs_info(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_answer_needs_info(uuid, text) TO authenticated;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected: `pricing_state_machine.test.sql .. ok`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261103110000_pricing_state_machine.sql supabase/tests/pricing_state_machine.test.sql
git commit -m "feat(pricing): the pricing file moves only along its path, by the right person"
```

---

### Task 3: Rates, catalog, logistics, line attributes

**Files:**
- Create: `supabase/migrations/20261103120000_pricing_rates.sql`
- Test: `supabase/tests/pricing_rates.test.sql`

**Interfaces:**
- Produces:
  - `public.install_type` enum: `double_tape, wall_screw, pylon, ceiling, floor`
  - `public.installation_rates(id, install_type, base_rate, per_kg_over, weight_threshold_kg, per_m_over, height_threshold_m, floor_cut_add, scaffold_add, crane_add, currency, effective_from, effective_to, created_by, created_at)`
  - `public.pricing_extra_unit` enum: `lump, item, m2`
  - `public.pricing_extras_catalog(id, code, name_en, name_ar, unit, default_rate, suggest_for public.install_type[], suggest_min_height_m, active, created_at)`. The spec's "cinema → acoustic" suggestion needs a project-level flag that doesn't exist yet. PR 2 adds the flag with the screen. Until then, acoustic is picked from the catalog by hand.
  - `public.logistics_rates(key, value, currency, note, updated_by, updated_at)`. Keys: `container_rate, customs_pct, clearing_fee, delivery_jeddah, delivery_riyadh`.
  - New `boq_lines` columns: `install_type, width_mm, height_mm, weight_kg, mount_height_m, has_screen, needs_floor_cut`
  - New `supplier_quote_lines` column `unit_cost_with_screen`, cost: not granted. "Differs from spec" reuses the existing `alternate_spec`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_rates.test.sql`:

```sql
-- Rates and the supplier's screen price are cost: pricers read and write them, sales never.
-- Test user UUIDs use the 5c… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5c000000-0000-0000-0000-000000000001','authenticated','authenticated','pr-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5c000000-0000-0000-0000-000000000003','authenticated','authenticated','pr-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5c000000-%';
insert into public.user_roles (user_id, role) values
  ('5c000000-0000-0000-0000-000000000001','sales_manager'),
  ('5c000000-0000-0000-0000-000000000003','estimation_manager');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5c000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select lives_ok($$insert into public.installation_rates (install_type, base_rate) values ('double_tape', 150)$$,
  'A pricer adds an installation rate');
select lives_ok($$insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_for)
  values ('concrete_base','Concrete base','قاعدة خرسانية','item', 1200, array['pylon','floor']::public.install_type[])$$,
  'A pricer adds a catalog extra');
select lives_ok($$update public.logistics_rates set value = 12000 where key = 'container_rate'$$,
  'A pricer updates a logistics rate');
select is((select count(*)::int from public.logistics_rates), 5, 'Five logistics keys are seeded');

select set_config('request.jwt.claims','{"sub":"5c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.installation_rates), 0, 'A sales manager reads no installation rates');
select throws_ok($$select unit_cost_with_screen from public.supplier_quote_lines limit 1$$,
  '42501', null, 'The screen price is revoked like every supplier cost');
select throws_ok($$insert into public.installation_rates (install_type, base_rate) values ('pylon', 1)$$,
  '42501', null, 'Sales cannot write rates');
select lives_ok($$select install_type, width_mm, has_screen from public.boq_lines limit 1$$,
  'The new line attributes are readable (they are not cost)');
reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected: FAIL, with `relation "public.installation_rates" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261103120000_pricing_rates.sql`:

```sql
-- =============================================================================
-- Pricing loop, part 3: what a price is built from (meeting 2026-11-03, rec. 74–76).
--
-- Installation is one rate per sign TYPE, not per sign ("they all go up with
-- double tape"), with modifiers for weight, height, floor cutting and
-- scaffold/crane. The rate is what PHC pays the installer; selling adds margin.
-- Extras (civil works, acoustic, lifting) come from a catalog and are
-- suggested from the install type so none is missed silently.
-- Logistics defaults change with freight prices, so they are a table.
-- All of it is cost: readable and writable by pricers and cost holders only.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.install_type AS ENUM ('double_tape','wall_screw','pylon','ceiling','floor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.pricing_extra_unit AS ENUM ('lump','item','m2');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.installation_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  install_type        public.install_type NOT NULL,
  base_rate           numeric(14,2) NOT NULL CHECK (base_rate >= 0),
  per_kg_over         numeric(14,2) NOT NULL DEFAULT 0 CHECK (per_kg_over >= 0),
  weight_threshold_kg numeric(10,2),
  per_m_over          numeric(14,2) NOT NULL DEFAULT 0 CHECK (per_m_over >= 0),
  height_threshold_m  numeric(6,2),
  floor_cut_add       numeric(14,2) NOT NULL DEFAULT 0 CHECK (floor_cut_add >= 0),
  scaffold_add        numeric(14,2) NOT NULL DEFAULT 0 CHECK (scaffold_add >= 0),
  crane_add           numeric(14,2) NOT NULL DEFAULT 0 CHECK (crane_add >= 0),
  currency            text NOT NULL DEFAULT 'SAR',
  effective_from      date NOT NULL DEFAULT current_date,
  effective_to        date,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installation_rates_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);
-- One rate per type in force on any day.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.installation_rates DROP CONSTRAINT IF EXISTS installation_rates_no_overlap;
ALTER TABLE public.installation_rates ADD CONSTRAINT installation_rates_no_overlap
  EXCLUDE USING gist (install_type WITH =, daterange(effective_from, effective_to, '[)') WITH &&);

CREATE TABLE IF NOT EXISTS public.pricing_extras_catalog (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]{2,40}$'),
  name_en              text NOT NULL,
  name_ar              text NOT NULL,
  unit                 public.pricing_extra_unit NOT NULL,
  default_rate         numeric(14,2) NOT NULL DEFAULT 0 CHECK (default_rate >= 0),
  suggest_for          public.install_type[] NOT NULL DEFAULT '{}',
  suggest_min_height_m numeric(6,2),
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.logistics_rates (
  key        text PRIMARY KEY CHECK (key IN ('container_rate','customs_pct','clearing_fee','delivery_jeddah','delivery_riyadh')),
  value      numeric(14,4) NOT NULL CHECK (value >= 0),
  currency   text NOT NULL DEFAULT 'SAR',
  note       text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Seeds from the meeting (rec. 74 [16:56]). Unclear figures are marked in the
-- note; Ahmed confirms them in the settings screen (PR 2).
INSERT INTO public.logistics_rates (key, value, currency, note) VALUES
  ('container_rate', 12000, 'SAR', 'Meeting 74: 12,000 per container from China, currency unstated — confirm'),
  ('customs_pct',    5,     'SAR', 'Meeting 74: about 5% of goods value (unclear) — confirm'),
  ('clearing_fee',   500,   'SAR', 'Meeting 74: clearing agent fee'),
  ('delivery_jeddah',2000,  'SAR', 'Meeting 74: delivery inside Jeddah'),
  ('delivery_riyadh',5000,  'SAR', 'Meeting 74: Jeddah to Riyadh warehouse')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.logistics_rates_stamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_by := auth.uid(); NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS logistics_rates_stamp ON public.logistics_rates;
CREATE TRIGGER logistics_rates_stamp BEFORE UPDATE ON public.logistics_rates
  FOR EACH ROW EXECUTE FUNCTION public.logistics_rates_stamp();

ALTER TABLE public.installation_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_extras_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.installation_rates, public.pricing_extras_catalog, public.logistics_rates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.installation_rates, public.pricing_extras_catalog TO authenticated;
GRANT SELECT, UPDATE ON public.logistics_rates TO authenticated;
GRANT ALL ON public.installation_rates, public.pricing_extras_catalog, public.logistics_rates TO service_role;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['installation_rates','pricing_extras_catalog','logistics_rates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Cost holders read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Cost holders read %1$s" ON public.%1$I FOR SELECT TO authenticated
                    USING (public.can_read_commercial_cost(auth.uid()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Pricers write %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Pricers write %1$s" ON public.%1$I FOR UPDATE TO authenticated
                    USING (public.is_pricer(auth.uid())) WITH CHECK (public.is_pricer(auth.uid()))', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "Pricers add installation rates" ON public.installation_rates;
CREATE POLICY "Pricers add installation rates" ON public.installation_rates FOR INSERT TO authenticated
  WITH CHECK (public.is_pricer(auth.uid()));
DROP POLICY IF EXISTS "Pricers add catalog extras" ON public.pricing_extras_catalog;
CREATE POLICY "Pricers add catalog extras" ON public.pricing_extras_catalog FOR INSERT TO authenticated
  WITH CHECK (public.is_pricer(auth.uid()));

-- Structured line attributes: what installation and the later AI need.
-- material / illumination / dimensions stay as the existing text columns.
ALTER TABLE public.boq_lines
  ADD COLUMN IF NOT EXISTS install_type    public.install_type,
  ADD COLUMN IF NOT EXISTS width_mm        numeric(10,1) CHECK (width_mm IS NULL OR width_mm > 0),
  ADD COLUMN IF NOT EXISTS height_mm       numeric(10,1) CHECK (height_mm IS NULL OR height_mm > 0),
  ADD COLUMN IF NOT EXISTS weight_kg       numeric(10,2) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  ADD COLUMN IF NOT EXISTS mount_height_m  numeric(6,2)  CHECK (mount_height_m IS NULL OR mount_height_m >= 0),
  ADD COLUMN IF NOT EXISTS has_screen      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_floor_cut boolean NOT NULL DEFAULT false;
-- boq_lines uses COLUMN-level SELECT grants (Phase 7A, "a cost column added
-- later is NOT granted by default"). These are not cost, so grant them by name.
GRANT SELECT (install_type, width_mm, height_mm, weight_kg, mount_height_m, has_screen, needs_floor_cut)
  ON public.boq_lines TO authenticated;

-- The supplier's "with screen" price (meeting 73 [01:17]) is cost like unit_cost.
-- supplier_quote_lines uses COLUMN-level SELECT grants (Phase 7B §6), so a new
-- column is unreadable by default: not granting it IS the revoke. "Differs
-- from spec" already exists as alternate_spec.
ALTER TABLE public.supplier_quote_lines
  ADD COLUMN IF NOT EXISTS unit_cost_with_screen numeric(14,2) CHECK (unit_cost_with_screen IS NULL OR unit_cost_with_screen >= 0);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected: `pricing_rates.test.sql .. ok`.

Check also that `supabase/tests/security_baseline.test.sql` still passes: it asserts RLS on every public table.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261103120000_pricing_rates.sql supabase/tests/pricing_rates.test.sql
git commit -m "feat(pricing): installation rate card, extras catalog, logistics rates, line attributes"
```

---

### Task 4: Installation cost, suggested extras, propose guard

**Files:**
- Create: `supabase/migrations/20261103130000_pricing_calc.sql`
- Test: `supabase/tests/pricing_calc.test.sql`

**Interfaces:**
- Consumes: Task 3 tables, `pricing_files` (Task 1).
- Produces:
  - `public.pricing_installation_cost(_type install_type, _weight_kg numeric, _mount_height_m numeric, _floor_cut boolean, _on date DEFAULT current_date) → numeric`. Returns NULL when no rate is in force for the type.
  - Table `public.pricing_file_extras(id, file_id, catalog_id, quantity, rate, status, dismiss_reason, source_line_id, decided_by, decided_at, created_at)`, where `status` ∈ `suggested, accepted, dismissed`.
  - `public.pricing_suggest_extras(_file_id uuid) → integer`, the number of new suggestions.
  - `public.pricing_decide_extra(_extra_id uuid, _accept boolean, _quantity numeric DEFAULT NULL, _rate numeric DEFAULT NULL, _reason text DEFAULT NULL) → jsonb`
  - `public.pricing_file_open_suggestions(_file_id uuid) → integer`

**Installation rule:**
- `base_rate`
- `+ per_kg_over × max(0, weight − weight_threshold_kg)`
- `+ per_m_over × max(0, height − height_threshold_m)`
- `+ floor_cut_add` (if floor cut)
- `+ scaffold_add` (if the type is ceiling and height > `height_threshold_m`)

Crane is a catalog extra, not automatic.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_calc.test.sql`:

```sql
-- Installation by type with modifiers; suggested extras must be decided.
-- Test user UUIDs use the 5d… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5d000000-0000-0000-0000-000000000003','authenticated','authenticated','pc-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5d000000-0000-0000-0000-000000000001','authenticated','authenticated','pc-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5d000000-%';
insert into public.user_roles (user_id, role) values
  ('5d000000-0000-0000-0000-000000000003','estimation_manager'),
  ('5d000000-0000-0000-0000-000000000001','salesperson');

insert into public.installation_rates (install_type, base_rate, per_kg_over, weight_threshold_kg, per_m_over, height_threshold_m, floor_cut_add, scaffold_add)
values ('ceiling', 300, 5, 20, 50, 4, 0, 400), ('floor', 500, 0, null, 0, null, 250, 0), ('pylon', 900, 0, null, 0, null, 0, 0);
insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_for)
values ('concrete_base','Concrete base','قاعدة خرسانية','item',1200, array['pylon','floor']::public.install_type[]);
insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_min_height_m)
values ('scaffold_hire','Scaffold hire','استئجار سقالة','lump',800, 6);

insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('5d200000-0000-0000-0000-000000000001','pc-deal','5d000000-0000-0000-0000-000000000001','5d000000-0000-0000-0000-000000000001','rfq_received');
insert into public.boqs (id, related_opportunity_id, title) values ('5d400000-0000-0000-0000-000000000001','5d200000-0000-0000-0000-000000000001','pc-boq');
insert into public.boq_revisions (id, boq_id, revision_number) values ('5d500000-0000-0000-0000-000000000001','5d400000-0000-0000-0000-000000000001',1);
insert into public.boq_lines (revision_id, sign_type, quantity, install_type, mount_height_m) values
  ('5d500000-0000-0000-0000-000000000001','Pylon P1',2,'pylon',null),
  ('5d500000-0000-0000-0000-000000000001','Ceiling C1',4,'ceiling',7);
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id)
values ('5d600000-0000-0000-0000-000000000001','5d200000-0000-0000-0000-000000000001','selling_build','5d500000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
-- The cost function answers cost holders only, so these run as the pricer.
select is(public.pricing_installation_cost('ceiling', 30, 6, false), 300 + 5*10 + 50*2 + 400::numeric,
  'Ceiling: base + weight over + height over + scaffold');
select is(public.pricing_installation_cost('floor', null, null, true), 750::numeric, 'Floor with cutting adds the cut');
select is(public.pricing_installation_cost('wall_screw', null, null, false), null::numeric, 'No rate in force gives null (falls back to %)');
select is(public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001'), 2,
  'A pylon suggests a concrete base; a 7 m ceiling suggests a scaffold');
select is(public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001'), 0, 'Suggesting again adds nothing');
select is(public.pricing_file_open_suggestions('5d600000-0000-0000-0000-000000000001'), 2, 'Two suggestions are open');
select throws_ok($$select public.pricing_decide_extra((select id from public.pricing_file_extras limit 1), false)$$,
  '23514', null, 'Dismissing needs a reason');

select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.pricing_file_extras), 0, 'Sales read no extras (they carry rates)');
reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected: FAIL, with `function public.pricing_installation_cost(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261103130000_pricing_calc.sql`:

```sql
-- =============================================================================
-- Pricing loop, part 4: installation cost and the extras that must not be missed.
-- "If I miss one of these items I lose its value" (meeting 75 [01:17]): every
-- suggestion must be accepted or dismissed (with a reason) before a price can
-- be proposed. The guard lives on internal_prices in the next migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pricing_installation_cost(
  _type public.install_type, _weight_kg numeric, _mount_height_m numeric,
  _floor_cut boolean, _on date DEFAULT current_date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.base_rate
       + r.per_kg_over * greatest(0, coalesce(_weight_kg,0) - coalesce(r.weight_threshold_kg, coalesce(_weight_kg,0)))
       + r.per_m_over  * greatest(0, coalesce(_mount_height_m,0) - coalesce(r.height_threshold_m, coalesce(_mount_height_m,0)))
       + CASE WHEN coalesce(_floor_cut,false) THEN r.floor_cut_add ELSE 0 END
       + CASE WHEN _type = 'ceiling' AND r.height_threshold_m IS NOT NULL
                   AND coalesce(_mount_height_m,0) > r.height_threshold_m THEN r.scaffold_add ELSE 0 END
    FROM public.installation_rates r
   WHERE r.install_type = _type
     AND r.effective_from <= _on AND (r.effective_to IS NULL OR r.effective_to > _on)
     AND public.can_read_commercial_cost(auth.uid())
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.pricing_installation_cost(public.install_type, numeric, numeric, boolean, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_installation_cost(public.install_type, numeric, numeric, boolean, date) TO authenticated;

CREATE TABLE IF NOT EXISTS public.pricing_file_extras (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id        uuid NOT NULL REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  catalog_id     uuid NOT NULL REFERENCES public.pricing_extras_catalog(id) ON DELETE RESTRICT,
  quantity       numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  rate           numeric(14,2) NOT NULL CHECK (rate >= 0),
  status         text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','accepted','dismissed')),
  dismiss_reason text,
  source_line_id uuid REFERENCES public.boq_lines(id) ON DELETE SET NULL,
  decided_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_file_extras_dismiss_reason CHECK (status <> 'dismissed' OR length(btrim(coalesce(dismiss_reason,''))) > 0)
);
-- One suggestion per catalog item per file; accepting more is a quantity.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_file_extras_one_per_item ON public.pricing_file_extras (file_id, catalog_id);
ALTER TABLE public.pricing_file_extras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_file_extras FROM anon, authenticated;
GRANT SELECT ON public.pricing_file_extras TO authenticated;
GRANT ALL ON public.pricing_file_extras TO service_role;
DROP POLICY IF EXISTS "Cost holders read file extras" ON public.pricing_file_extras;
CREATE POLICY "Cost holders read file extras" ON public.pricing_file_extras FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost(auth.uid()));

CREATE OR REPLACE FUNCTION public.pricing_suggest_extras(_file_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; n integer;
BEGIN
  IF NOT public.is_pricer(u) THEN RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id;
  IF NOT FOUND OR f.boq_revision_id IS NULL THEN
    RAISE EXCEPTION 'The file has no BOQ revision yet. | لا يوجد إصدار كميات في الملف بعد.' USING ERRCODE = '23514';
  END IF;
  WITH hits AS (
    SELECT DISTINCT ON (c.id) c.id AS catalog_id, c.default_rate, l.id AS line_id
      FROM public.boq_lines l
      JOIN public.pricing_extras_catalog c ON c.active
       AND ((l.install_type IS NOT NULL AND l.install_type = ANY (c.suggest_for))
            OR (c.suggest_min_height_m IS NOT NULL AND coalesce(l.mount_height_m,0) >= c.suggest_min_height_m))
     WHERE l.revision_id = f.boq_revision_id
     ORDER BY c.id, l.line_number NULLS LAST
  ), ins AS (
    INSERT INTO public.pricing_file_extras (file_id, catalog_id, rate, source_line_id)
    SELECT f.id, h.catalog_id, h.default_rate, h.line_id FROM hits h
    ON CONFLICT (file_id, catalog_id) DO NOTHING
    RETURNING 1)
  SELECT count(*)::int INTO n FROM ins;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pricing_suggest_extras(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_suggest_extras(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_decide_extra(_extra_id uuid, _accept boolean,
  _quantity numeric DEFAULT NULL, _rate numeric DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); e public.pricing_file_extras;
BEGIN
  IF NOT public.is_pricer(u) THEN RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501'; END IF;
  IF NOT _accept AND length(btrim(coalesce(_reason,''))) = 0 THEN
    RAISE EXCEPTION 'Say why this item is not needed. | اذكر سبب عدم الحاجة لهذا البند.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.pricing_file_extras
     SET status = CASE WHEN _accept THEN 'accepted' ELSE 'dismissed' END,
         quantity = coalesce(_quantity, quantity), rate = coalesce(_rate, rate),
         dismiss_reason = CASE WHEN _accept THEN NULL ELSE btrim(_reason) END,
         decided_by = u, decided_at = now()
   WHERE id = _extra_id RETURNING * INTO e;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown item. | البند غير موجود.' USING ERRCODE = '23514'; END IF;
  RETURN to_jsonb(e);
END $$;
REVOKE ALL ON FUNCTION public.pricing_decide_extra(uuid, boolean, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_decide_extra(uuid, boolean, numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_file_open_suggestions(_file_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.pricing_file_extras WHERE file_id = _file_id AND status = 'suggested';
$$;
REVOKE ALL ON FUNCTION public.pricing_file_open_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_file_open_suggestions(uuid) TO authenticated;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected: `pricing_calc.test.sql .. ok`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261103130000_pricing_calc.sql supabase/tests/pricing_calc.test.sql
git commit -m "feat(pricing): installation cost by type, suggested extras that must be decided"
```

---

### Task 5: One-step GM approval, and the file following the price

**Files:**
- Create: `supabase/migrations/20261103140000_pricing_gm_one_step.sql`
- Test: `supabase/tests/pricing_gm_one_step.test.sql`

**Interfaces:**
- Consumes: `internal_price_transition_guard` (Phase 7A, `20260826120000:103-160`); `pricing_files.internal_price_id`; `pricing_file_open_suggestions` (Task 4); `_pricing_file_apply` (Task 2).
- Produces:
  - `internal_prices` may go `internal_price_proposed → gm_pending` when the caller is finance. This stamps `finance_reviewed_by/at`.
  - That move is refused while the linked pricing file has open suggestions.
  - A trigger moves the pricing file: `gm_pending` (file to `gm_pending`), `gm_approved` (to `approved`), `returned` (to `selling_build`).

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/pricing_gm_one_step.test.sql`:

```sql
-- Zayed proposes (counts as finance review), Kalas approves; the file follows.
-- Test user UUIDs use the 5e… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5e000000-0000-0000-0000-000000000003','authenticated','authenticated','g1-finance+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5e000000-0000-0000-0000-000000000004','authenticated','authenticated','g1-gm+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5e000000-0000-0000-0000-000000000001','authenticated','authenticated','g1-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5e000000-%';
insert into public.user_roles (user_id, role) values
  ('5e000000-0000-0000-0000-000000000003','finance_manager'),
  ('5e000000-0000-0000-0000-000000000003','estimation_manager'),
  ('5e000000-0000-0000-0000-000000000004','general_manager'),
  ('5e000000-0000-0000-0000-000000000001','salesperson');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('5e200000-0000-0000-0000-000000000001','g1-deal','5e000000-0000-0000-0000-000000000001','5e000000-0000-0000-0000-000000000001','rfq_received');
insert into public.boqs (id, related_opportunity_id, title) values ('5e400000-0000-0000-0000-000000000001','5e200000-0000-0000-0000-000000000001','g1-boq');
insert into public.boq_revisions (id, boq_id, revision_number, frozen_at, frozen_by, status)
values ('5e500000-0000-0000-0000-000000000001','5e400000-0000-0000-0000-000000000001',1, now(), '5e000000-0000-0000-0000-000000000003','verified');
insert into public.estimations (id, boq_revision_id, cost_total) values ('5e700000-0000-0000-0000-000000000001','5e500000-0000-0000-0000-000000000001', 100000);
insert into public.internal_prices (id, estimation_id, proposed_price, status)
values ('5e800000-0000-0000-0000-000000000001','5e700000-0000-0000-0000-000000000001', 140000, 'internal_price_proposed');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id, estimation_id, internal_price_id)
values ('5e600000-0000-0000-0000-000000000001','5e200000-0000-0000-0000-000000000001','selling_build',
        '5e500000-0000-0000-0000-000000000001','5e700000-0000-0000-0000-000000000001','5e800000-0000-0000-0000-000000000001');
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate)
values ('5e900000-0000-0000-0000-000000000001','crane_hire','Crane hire','رافعة','lump',2000);
insert into public.pricing_file_extras (file_id, catalog_id, rate) values ('5e600000-0000-0000-0000-000000000001','5e900000-0000-0000-0000-000000000001',2000);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Proposing is blocked while a suggestion is open');
reset role;
update public.pricing_file_extras set status = 'accepted';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800000-0000-0000-0000-000000000001'$$,
  'Finance takes a proposed price straight to the GM');
select is((select state::text from public.pricing_files where id = '5e600000-0000-0000-0000-000000000001'), 'gm_pending',
  'The file follows to gm_pending');
select throws_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800000-0000-0000-0000-000000000001'$$,
  '42501', null, 'Finance cannot approve its own price');

select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800000-0000-0000-0000-000000000001'$$,
  'The GM approves');
select is((select state::text from public.pricing_files where id = '5e600000-0000-0000-0000-000000000001'), 'approved',
  'The file follows to approved');
reset role;
select * from finish();
rollback;
```

If `internal_prices` refuses an INSERT straight into `internal_price_proposed`, insert it as `draft` and walk it up as the test superuser (`draft → cost_complete → internal_price_proposed`; `auth.uid()` is null there, so the role checks pass).

Before relying on this test, check one thing: GM approval runs the Phase 8 floor guard (`internal_prices_zz_floor_guard`). With no active `margin_policies` row the guard passes. If a policy is seeded by an earlier migration, set `proposed_price` above its floor.

- [ ] **Step 2: Run it and confirm it fails**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected: FAIL on "Finance takes a proposed price straight to the GM", with `Illegal price transition internal_price_proposed -> gm_pending`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261103140000_pricing_gm_one_step.sql`.

The function body below is the Phase 7A function (`20260826120000:103-160`) with three additions, each marked `-- 2026-11-03`. Copy the current definition from that migration first, and diff it against this one. If a later migration has redefined it, start from the latest.

```sql
-- =============================================================================
-- Pricing loop, part 5: Zayed proposes, Kalas approves (spec decision 2).
-- Estimation and finance are one person, so his proposal IS the finance
-- review: proposed -> gm_pending in one move, by finance only. The old chain
-- (via commercial_review and finance_review) stays legal for anything else.
-- The pricing file follows its price instead of being moved by hand.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.internal_price_transition_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE _ok BOOLEAN := FALSE; _uid UUID := auth.uid();
BEGIN
  IF NEW.status = OLD.status THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'gm_approved' THEN
    RAISE EXCEPTION 'An approved price is final; propose a new price instead. | السعر المعتمد نهائي — اقترح سعرًا جديدًا.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  _ok := (OLD.status, NEW.status) IN (
    ('draft','cost_complete'),
    ('cost_complete','internal_price_proposed'),
    ('internal_price_proposed','commercial_review'),
    ('commercial_review','finance_review'),
    ('finance_review','gm_pending'),
    ('internal_price_proposed','gm_pending'),          -- 2026-11-03: one step for finance
    ('gm_pending','gm_approved'),
    ('returned','internal_price_proposed')
  ) OR (NEW.status = 'returned' AND OLD.status <> 'gm_approved');

  IF NOT _ok THEN
    RAISE EXCEPTION 'Illegal price transition % -> %. The chain is draft, cost_complete, internal_price_proposed, commercial_review, finance_review, gm_pending, gm_approved. | انتقال غير مسموح.',
      OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'gm_approved' AND NOT public.can_approve_final_price(_uid) THEN
    RAISE EXCEPTION 'Only the General Manager, or an active delegate, may approve a final price. | اعتماد السعر النهائي يقتصر على المدير العام أو مفوّض ساري.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'finance_review'
     AND _uid IS NOT NULL
     AND NOT public.has_role(_uid, 'finance_manager'::public.app_role) THEN
    RAISE EXCEPTION 'Only finance may take a price into finance review.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- 2026-11-03: the one-step move is finance's, and never with an undecided extra.
  IF OLD.status = 'internal_price_proposed' AND NEW.status = 'gm_pending' THEN
    IF _uid IS NOT NULL AND NOT public.has_role(_uid, 'finance_manager'::public.app_role) THEN
      RAISE EXCEPTION 'Only finance may send a proposed price to the GM. | إرسال السعر المقترح للمدير العام يقتصر على المالية.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM public.pricing_files pf
                WHERE pf.internal_price_id = NEW.id
                  AND public.pricing_file_open_suggestions(pf.id) > 0) THEN
      RAISE EXCEPTION 'Accept or dismiss every suggested item before proposing. | اقبل أو ارفض كل بند مقترح قبل اقتراح السعر.';
    END IF;
    NEW.finance_reviewed_by := _uid; NEW.finance_reviewed_at := now();
  END IF;
  IF NEW.status = 'commercial_review'
     AND _uid IS NOT NULL
     AND NOT public.is_pipeline_operator(_uid) THEN
    RAISE EXCEPTION 'Only a pipeline operator may take a price into commercial review.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = 'commercial_review' THEN
    NEW.commercial_reviewed_by := _uid; NEW.commercial_reviewed_at := now();
  ELSIF NEW.status = 'finance_review' THEN
    NEW.finance_reviewed_by := _uid;    NEW.finance_reviewed_at := now();
  ELSIF NEW.status IN ('gm_approved','returned') THEN
    NEW.gm_decided_by := _uid;          NEW.gm_decided_at := now();
  ELSIF NEW.status = 'internal_price_proposed' THEN
    NEW.proposed_by := coalesce(NEW.proposed_by, _uid);
    NEW.proposed_at := coalesce(NEW.proposed_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

-- 2026-11-03: the pricing file follows its price.
CREATE OR REPLACE FUNCTION public.pricing_file_follow_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files; target public.pricing_file_state;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  target := CASE NEW.status WHEN 'gm_pending' THEN 'gm_pending'
                            WHEN 'gm_approved' THEN 'approved'
                            WHEN 'returned' THEN 'selling_build' END;
  IF target IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO f FROM public.pricing_files WHERE internal_price_id = NEW.id AND state <> 'closed' FOR UPDATE;
  IF NOT FOUND OR f.state = target THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pricing_file_transitions t
                  WHERE t.from_state = f.state AND t.to_state = target AND t.who = 'system') THEN
    RETURN NEW;   -- the file is elsewhere (e.g. closed in between); the price still moves
  END IF;
  PERFORM public._pricing_file_apply(f, target, auth.uid(),
    CASE WHEN NEW.status = 'returned' THEN NEW.return_reason END);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_follow_price() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS internal_prices_zzz_pricing_file ON public.internal_prices;
CREATE TRIGGER internal_prices_zzz_pricing_file AFTER UPDATE OF status ON public.internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.pricing_file_follow_price();
```

- [ ] **Step 4: Run all DB tests and confirm they pass**

Run: `zsh -c 'source ~/.supabase-guard.zsh && supabase test db'`
Expected:
- `pricing_gm_one_step.test.sql .. ok`.
- The existing Phase 7A suites still pass: `tests/db-behaviour/phase7a_pricing_workflow.sql` runs locally via `bun run test:db:behaviour`. That suite currently stops at the older `20261003100000`, so here CI is the evidence.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261103140000_pricing_gm_one_step.sql supabase/tests/pricing_gm_one_step.test.sql
git commit -m "feat(pricing): finance proposes straight to the GM; the file follows its price"
```

---

### Task 6: TypeScript mirror, RPC wrappers, generated types

**Files:**
- Create: `src/lib/pricing.ts`, `src/lib/pricing.test.ts`, `src/lib/pricing.contract.test.ts`, `src/lib/pricing-actions.ts`
- Modify: `src/integrations/supabase/types.ts`. Add the `Tables` entries for `pricing_files`, `pricing_file_events`, `installation_rates`, `pricing_extras_catalog`, `pricing_file_extras`, `logistics_rates`; the `Enums` entries `pricing_file_state`, `install_type`, `pricing_extra_unit`; the `Functions` entries for the RPCs; and the new `boq_lines` / `supplier_quote_lines` columns.

**Interfaces:**
- Produces (used by PR 2 screens):
  - `type PricingState`
  - `PRICING_STATES: readonly PricingState[]`
  - `PRICING_STATE_LABEL: Record<PricingState, { en: string; ar: string }>`
  - `PRICER_MOVES: ReadonlyArray<readonly [PricingState, PricingState]>`
  - `canPricerMove(from, to): boolean`
  - `type InstallType`
  - `type InstallationRate`
  - `installationCost(rate: InstallationRate | null, line: { weightKg?: number | null; mountHeightM?: number | null; floorCut?: boolean }): number | null`
  - `pricing-actions.ts`: `openPricingFile(opportunityId, rfqId?)`, `movePricingFile(fileId, to, note?)`, `askNeedsInfo(fileId, items, due)`, `answerNeedsInfo(fileId, note)`, `suggestExtras(fileId)`, `decideExtra(extraId, accept, opts?)`. Each returns the RPC's JSON and throws on error.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pricing.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { canPricerMove, installationCost, PRICING_STATE_LABEL, PRICING_STATES } from "@/lib/pricing";

describe("installation cost mirrors pricing_installation_cost", () => {
  const ceiling = {
    install_type: "ceiling" as const, base_rate: 300, per_kg_over: 5, weight_threshold_kg: 20,
    per_m_over: 50, height_threshold_m: 4, floor_cut_add: 0, scaffold_add: 400, crane_add: 0,
  };
  it("adds weight over, height over and scaffold for a high heavy ceiling sign", () => {
    expect(installationCost(ceiling, { weightKg: 30, mountHeightM: 6 })).toBe(300 + 50 + 100 + 400);
  });
  it("is just the base for a light low one", () => {
    expect(installationCost(ceiling, { weightKg: 10, mountHeightM: 3 })).toBe(300);
  });
  it("adds the cut for a floor sign that needs it", () => {
    const floor = { ...ceiling, install_type: "floor" as const, base_rate: 500, per_kg_over: 0, per_m_over: 0,
      weight_threshold_kg: null, height_threshold_m: null, scaffold_add: 0, floor_cut_add: 250 };
    expect(installationCost(floor, { floorCut: true })).toBe(750);
  });
  it("returns null with no rate, so the caller falls back to a % of materials", () => {
    expect(installationCost(null, {})).toBeNull();
  });
});

describe("pricing states", () => {
  it("label every state in both languages", () => {
    for (const s of PRICING_STATES) {
      expect(PRICING_STATE_LABEL[s].en.length).toBeGreaterThan(0);
      expect(PRICING_STATE_LABEL[s].ar.length).toBeGreaterThan(0);
    }
  });
  it("lets the pricer move along the path and never skip", () => {
    expect(canPricerMove("received", "package_review")).toBe(true);
    expect(canPricerMove("received", "at_supplier")).toBe(false);
    expect(canPricerMove("selling_build", "gm_pending")).toBe(false); // the price moves it, not a button
  });
});
```

Create `src/lib/pricing.contract.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { PRICER_MOVES } from "@/lib/pricing";

// The screens decide which buttons to show from PRICER_MOVES; the database
// decides what is allowed from pricing_file_transitions. They must agree.
const SQL = readFileSync("supabase/migrations/20261103110000_pricing_state_machine.sql", "utf8");

describe("pricer moves match the SQL transition list", () => {
  it("lists exactly the 'pricer' rows", () => {
    const rows = [...SQL.matchAll(/\('(\w+)'(?:::public\.pricing_file_state)?,\s*'(\w+)'(?:::public\.pricing_file_state)?,\s*'pricer'\)/g)]
      .map((m) => `${m[1]}>${m[2]}`).sort();
    expect(rows.length).toBeGreaterThan(5);
    expect(PRICER_MOVES.map(([a, b]) => `${a}>${b}`).sort()).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test src/lib/pricing.test.ts src/lib/pricing.contract.test.ts`
Expected: FAIL, with `Cannot find module '@/lib/pricing'`.

- [ ] **Step 3: Write the code**

Create `src/lib/pricing.ts`:

```ts
// =============================================================================
// Pricing loop — shared types and the pure mirror of the SQL rules
// (spec 2026-11-03-pricing-loop-design; migrations 20261103100000–140000).
//
// The database is the authority: these exist so screens can show the right
// buttons and figures before a round trip. pricing.contract.test.ts keeps
// PRICER_MOVES equal to the SQL transition list.
// =============================================================================

export type PricingState =
  | "received" | "package_review" | "needs_info" | "boq_frozen" | "at_supplier"
  | "supplier_priced" | "cost_review" | "selling_build" | "gm_pending"
  | "approved" | "quoted" | "closed";

export const PRICING_STATES: readonly PricingState[] = [
  "received", "package_review", "needs_info", "boq_frozen", "at_supplier",
  "supplier_priced", "cost_review", "selling_build", "gm_pending", "approved", "quoted", "closed",
];

export const PRICING_STATE_LABEL: Record<PricingState, { en: string; ar: string }> = {
  received: { en: "Received for pricing", ar: "وارد للتسعير" },
  package_review: { en: "Package review", ar: "دراسة الباكيج" },
  needs_info: { en: "Missing items with sales", ar: "نواقص لدى المبيعات" },
  boq_frozen: { en: "BOQ frozen", ar: "الكميات مجمّدة" },
  at_supplier: { en: "At supplier", ar: "عند المورد" },
  supplier_priced: { en: "Supplier priced", ar: "سعّر المورد" },
  cost_review: { en: "Cost review", ar: "مراجعة التكلفة" },
  selling_build: { en: "Building selling price", ar: "بناء سعر البيع" },
  gm_pending: { en: "Awaiting GM approval", ar: "بانتظار اعتماد المدير العام" },
  approved: { en: "Approved", ar: "معتمد" },
  quoted: { en: "Quoted to client", ar: "أُرسل العرض للعميل" },
  closed: { en: "Closed", ar: "مغلق" },
};

/** Moves a pricer makes with pricing_file_move. Needs-info has its own RPCs; system moves follow the price. */
export const PRICER_MOVES: ReadonlyArray<readonly [PricingState, PricingState]> = [
  ["received", "package_review"],
  ["package_review", "boq_frozen"],
  ["boq_frozen", "at_supplier"],
  ["at_supplier", "supplier_priced"],
  ["supplier_priced", "cost_review"],
  ["cost_review", "at_supplier"],
  ["cost_review", "selling_build"],
  ["quoted", "boq_frozen"],
];

export function canPricerMove(from: PricingState, to: PricingState): boolean {
  if (to === "closed") return from !== "closed";
  return PRICER_MOVES.some(([a, b]) => a === from && b === to);
}

export type InstallType = "double_tape" | "wall_screw" | "pylon" | "ceiling" | "floor";

export type InstallationRate = {
  install_type: InstallType;
  base_rate: number;
  per_kg_over: number;
  weight_threshold_kg: number | null;
  per_m_over: number;
  height_threshold_m: number | null;
  floor_cut_add: number;
  scaffold_add: number;
  crane_add: number;
};

/** Mirror of public.pricing_installation_cost. Null means "no rate in force: use the % fallback". */
export function installationCost(
  rate: InstallationRate | null,
  line: { weightKg?: number | null; mountHeightM?: number | null; floorCut?: boolean },
): number | null {
  if (!rate) return null;
  const w = line.weightKg ?? 0;
  const h = line.mountHeightM ?? 0;
  const overW = rate.weight_threshold_kg == null ? 0 : Math.max(0, w - rate.weight_threshold_kg);
  const overH = rate.height_threshold_m == null ? 0 : Math.max(0, h - rate.height_threshold_m);
  const scaffold =
    rate.install_type === "ceiling" && rate.height_threshold_m != null && h > rate.height_threshold_m ? rate.scaffold_add : 0;
  return rate.base_rate + rate.per_kg_over * overW + rate.per_m_over * overH + (line.floorCut ? rate.floor_cut_add : 0) + scaffold;
}
```

Create `src/lib/pricing-actions.ts`:

```ts
// RPC wrappers for the pricing loop. Authorization is in SQL; these only call it.
import { supabase } from "@/integrations/supabase/client";
import type { PricingState } from "@/lib/pricing";

async function call<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export const openPricingFile = (opportunityId: string, rfqId?: string | null) =>
  call("open_pricing_file", { _opportunity_id: opportunityId, _rfq_id: rfqId ?? null });

export const movePricingFile = (fileId: string, to: PricingState, note?: string) =>
  call("pricing_file_move", { _file_id: fileId, _to: to, _note: note ?? null });

export const askNeedsInfo = (fileId: string, items: string[], due: string) =>
  call("pricing_file_set_needs_info", { _file_id: fileId, _items: items, _due: due });

export const answerNeedsInfo = (fileId: string, note: string) =>
  call("pricing_file_answer_needs_info", { _file_id: fileId, _note: note });

export const suggestExtras = (fileId: string) => call<number>("pricing_suggest_extras", { _file_id: fileId });

export const decideExtra = (
  extraId: string,
  accept: boolean,
  opts: { quantity?: number; rate?: number; reason?: string } = {},
) =>
  call("pricing_decide_extra", {
    _extra_id: extraId, _accept: accept,
    _quantity: opts.quantity ?? null, _rate: opts.rate ?? null, _reason: opts.reason ?? null,
  });
```

Then patch `src/integrations/supabase/types.ts` by hand. Follow how the existing `opportunity_updates` and `deal_submittals` entries are written: Row, Insert, Update and Relationships for each new table; the new enum string unions under `Enums`; Args and Returns under `Functions`. Keep alphabetical order within each block.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run:
```bash
bun test src/lib/pricing.test.ts src/lib/pricing.contract.test.ts && bun run typecheck && bun run lint
```
Expected: the tests pass, `tsc` prints nothing, and lint reports 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing.ts src/lib/pricing.test.ts src/lib/pricing.contract.test.ts src/lib/pricing-actions.ts src/integrations/supabase/types.ts
git commit -m "feat(pricing): TS mirror of states and installation cost, RPC wrappers, types"
```

---

### Task 7: Docs, full verify, PR

**Files:**
- Modify: `docs/USER_GUIDE.md` (section 10), `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/AI_HANDOFF.md`, `tasks/current.md`

- [ ] **Step 1: Write the docs**

1. `docs/USER_GUIDE.md`, section 10 (Current limitations): add `### Pricing loop foundation (2026-11-03)` with:
   - "The pricing file, its path, the installation rate card, extras and logistics rates exist in the database. There are no screens yet (PR 2). A new RFQ on a deal opens a pricing file in state *Received for pricing*. Nothing is visible to users until the screens ship."
   - Update the footer line.
2. `docs/CHANGELOG.md`, at the top:

   ```markdown
   ## 2026-11-03 — Pricing loop foundation (Commercial & Finance part 1, PR 1; not deployed)

   - Migrations `20261103100000`–`20261103140000`: `pricing_files` + `pricing_file_events` (one per RFQ, auto-opened on a new RFQ with a deal), the enforced path (`pricing_file_move`, needs-info RPCs), `installation_rates` by `install_type` with weight/height/cut/scaffold modifiers, `pricing_extras_catalog` + `pricing_file_extras` with auto-suggestions that must be decided, `logistics_rates` (seeded from the meeting, unclear figures marked), structured `boq_lines` attributes, `supplier_quote_lines.unit_cost_with_screen` (cost-revoked). `internal_prices` may go `internal_price_proposed → gm_pending` for finance (one-step GM approval); the file follows its price.
   - `src/lib/pricing.ts` mirror + contract test; `src/lib/pricing-actions.ts`.
   ```
3. `docs/DECISIONS.md`: add `## 2026-11-03 — Pricing actions are SQL RPCs; the supplier role ships with its portal`, with the two deviations listed in Global Constraints and the reason: "no function deploy; authorization and tests stay in one place; the role and its only consumer ship together".
4. `docs/AI_HANDOFF.md`: a new top entry with the branch name, the migrations, "needs `db push` before PR 2's screens are useful", and the open points from the spec.
5. `tasks/current.md`: a new active item, "Pricing loop PR 1", with what remains (CI, `db push`).

- [ ] **Step 2: Full verify**

Run: `bun run verify`
Expected: typecheck, lint (0 errors), all tests and the build pass.

Run: `bun audit --audit-level=high`
Expected: exit 0.

- [ ] **Step 3: Commit, push, PR**

```bash
git add docs tasks
git commit -m "docs: pricing loop foundation (user guide limits, changelog, decisions, handoff)"
gh auth switch -u mophc-sa
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin HEAD
gh pr create --repo mophc-sa/phc-command-center --base main --title "Pricing loop PR 1: foundation (pricing files, path, rates, extras, one-step GM)" --body-file - <<'EOF'
Commercial & Finance part 1, PR 1 of 4. Spec: `docs/superpowers/specs/2026-11-03-pricing-loop-design.md`. Plan: `docs/superpowers/plans/2026-11-03-pricing-loop-foundation.md`.

Database foundation only, with no screens. Migrations `20261103100000`–`20261103140000`, and pgTAP for each.

Release: `db push` only. There is no function deploy and no UI change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
gh auth switch -u moalagab
```

Expected: the PR URL prints, and CI runs. The "Supabase migrations and database tests" job must pass.

---

## Next plans (written when this PR is merged)

- **PR 2:** Zayed's screens (`/pricing`, `/pricing/$id` up to Propose, `/pricing/settings`), BOQ Excel import, the selling-price grid, and the new sidebar group. The cost-gated SQL view for the grid: materials (selected supplier line, normal or with screen), plus installation (`pricing_installation_cost` or the % fallback), plus accepted extras, plus logistics allocated by line value, then margin. It feeds `estimations` / `internal_prices` so the Phase 8 margin and floor rules apply unchanged. Also the project-level cinema flag for the acoustic suggestion.
- **PR 3:** the `supplier` role, `profiles.vendor_id`, `supplier_invitations`, the portal, the invite email, entry on behalf.
- **PR 4:** Kalas approval card, the quotation revision from the approved price, the PDF for Marie, the pricing state on the deal page, and the client-revision loop.
