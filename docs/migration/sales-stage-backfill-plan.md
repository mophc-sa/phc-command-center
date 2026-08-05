# `sales_stage` NULL backfill — plan

Status: **planning only, nothing executed.** No production row was modified.
Built from a read-only query of PHC AGENT (`lrfdtoexyeghrzynapyn`) on 2026-08-05.

---

## 1. What was found

2 of 4 production opportunities carried `sales_stage = NULL`:

| id | project_name | stage | flow_type | created | quotations | rfqs |
|---|---|---|---|---|---|---|
| `d82757e1…f805` | `[UAT-DEMO-SALES-ACTION-QUEUE] In…` | qualification | manual | 2026-07-09 | 0 | 0 |
| `1afecdd2…50ef` | `[UAT-DEMO-SALES-ACTION-QUEUE] Ac…` | quotation | manual | 2026-07-09 | 1 | 0 |

**Both are UAT demo records.** No real commercial record is currently affected,
so this backfill is not urgent — but the code defect that produced them was
live, and would have produced the same result for real records.

## 2. Root cause

Not a migration, a trigger, or a default. Two of the five `INSERT` sites simply
did not set the column:

| Site | Path | Set `sales_stage`? |
|---|---|---|
| `src/lib/rfq-actions.ts` | Intake → RFQ conversion | ✅ `rfq_received` |
| `src/lib/crm-actions.ts` | **Account → New Opportunity** | ❌ **omitted** |
| `handlers/pipeline.ts` (lead conversion) | **Lead → Opportunity** | ❌ **omitted** |
| `handlers/pipeline.ts` (RFQ conversion) | RFQ → Opportunity | ✅ `jih` |
| `shared.ts` | Tender → JIH conversion | ✅ `jih` |

### Why it stayed invisible

The read path and the write path disagreed about what `NULL` meant:

- **Write path treats NULL as `jih`.** `advance_sales_stage` does
  `opp.sales_stage ?? "jih"`, and `nextSalesStages` does `TRANSITIONS[from ?? "jih"]`.
  So the record is fully workable — a user can advance it and nothing errors.
- **Read path excludes NULL entirely.** Every dashboard filters
  `.in("sales_stage", [...])`, and `computeJihPipelineTotal` skips nulls explicitly.

Result: a record that behaves normally when opened, but never appears in a JIH
panel, the Award Queue, or any pipeline total. It is workable and uncountable at
the same time — the worst combination for trusting a dashboard number.

## 3. Code fix (applied in this branch — no production change)

Both sites now set `sales_stage: "rfq_received"`.

**Why `rfq_received` and not `jih`:** `rfq_received` is the enum's genuine entry
point. Writing `jih` would match the existing implicit NULL fallback but would
fabricate progress for a deal that has not received an RFQ. `rfq_received → jih`
is a legal transition, so nothing downstream is blocked by the more conservative
choice.

> ⚠️ **Confirm this is the intended business semantics.** An opportunity started
> from an Account page, or converted from a qualified lead, may in practice
> already be past the RFQ step. If PHC considers those to start at `jih`, change
> both constants — the transition map allows either.

Guarded by `src/lib/opportunity-sales-stage.contract.test.ts`, which parses every
`INSERT` body at all five sites and fails if any omits the column.

## 4. Proposed backfill — NOT EXECUTED

Requires explicit approval. Two options.

### Option A — delete the demo rows (recommended)

Both affected rows are UAT fixtures with no commercial meaning. Removing them is
cleaner than assigning a stage to fake data, and it also clears them out of the
opportunity counts before the real masterlist import.

```sql
-- REVIEW BEFORE RUNNING. Deletion is gated by the two-person rule —
-- route it through the approvals flow, not a direct DELETE.
SELECT id, project_name, stage, created_at
FROM public.opportunities
WHERE project_name LIKE '[UAT-DEMO-%'
ORDER BY created_at;
-- expected: 3 rows (2 with sales_stage NULL, 1 verbally_awarded)
```

### Option B — backfill in place

If the demo rows are to be kept as fixtures:

```sql
-- Dry run first: confirm the row set is exactly what is expected.
SELECT id, project_name, stage, sales_stage, flow_type
FROM public.opportunities
WHERE sales_stage IS NULL;

-- Then, inside a transaction:
BEGIN;
UPDATE public.opportunities
   SET sales_stage = 'rfq_received'
 WHERE sales_stage IS NULL;
-- verify 2 rows affected, then COMMIT (or ROLLBACK if not)
COMMIT;
```

### Follow-up hardening — separate approval

Once no NULL rows remain, make the state unreachable at database level:

```sql
ALTER TABLE public.opportunities
  ALTER COLUMN sales_stage SET DEFAULT 'rfq_received';

ALTER TABLE public.opportunities
  ALTER COLUMN sales_stage SET NOT NULL;
```

**Do not apply the `NOT NULL` before the backfill** — it will fail on the
existing NULL rows. And note it removes the `?? "jih"` fallback's reason to
exist; that code can then be simplified in a follow-up.

## 5. Related — the same shape of defect elsewhere

`rfqs.response_due_date` held `275760-07-29` on the only real RFQ, from an
unvalidated `<input type="date">`. Client-side bounds validation is applied in
this branch (`src/lib/date-bounds.ts`). The equivalent database hardening is
**also deferred**, for the same reason — a `CHECK` constraint cannot be added
while the bad row exists:

```sql
-- 1. Fix the row (needs approval — it is real commercial data, not a fixture):
UPDATE public.rfqs
   SET response_due_date = NULL          -- or the correct deadline, if known
 WHERE id = '499e3955-a310-4acd-ae4c-c849a01a1753';

-- 2. Only then constrain the column:
ALTER TABLE public.rfqs
  ADD CONSTRAINT rfqs_response_due_date_sane
  CHECK (response_due_date IS NULL
         OR response_due_date BETWEEN DATE '1990-01-01' AND CURRENT_DATE + INTERVAL '20 years');
```

The correct deadline for `RFQ-2026-0001` (NEW MURABBA ACTIVATION CENTRE) is not
recoverable from the record — it needs to come from whoever created it on
2026-07-29.
