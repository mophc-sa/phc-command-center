# Orphaned RFQs — backfill plan

Status: **planning only, nothing executed.** No production row was modified.
Read-only query of PHC AGENT (`lrfdtoexyeghrzynapyn`) on 2026-08-06.

---

## 1. What is orphaned

Five RFQs carry `opportunity_id IS NULL`. All predate PR #171, which made
conversion produce the opportunity. They are **not broken — they are incomplete**:
the flow that created them simply didn't produce an opportunity.

| RFQ | Received | Company | Project | Contact | Due | Value |
|---|---|---|---|---|---|---|
| *(no number)* | 2026-07-23 | Saudi Icon | — | — | 2026-09-30 | 800,000 |
| `RFQ-2026-0001` | 2026-07-29 | ICAD | — | Engr. Akash Suresh | **275760-07-29** ⚠️ | 768,500 |
| `RFQ-2026-0002` | 2026-08-05 | CHEC | ajwad | — | 2026-08-05 | — |
| `RFQ-2026-0003` | 2026-08-05 | — | ajwad | — | 2026-08-12 | — |
| `RFQ-2026-0004` | 2026-08-05 | eve | evvv | — | 2026-08-12 | — |

All five have a sales owner. None has a classification (`jih`/`tender`), because
that column was only wired up in PR #175.

## 2. Why this is not a script

**These rows are not uniformly real.** Reading them:

- **Saudi Icon** (800K, deadline Sep 30) and **ICAD** (768.5K, named contact) look
  like genuine commercial records worth recovering.
- **CHEC / ajwad** is plausible but its deadline equals its received date, which
  is more likely a placeholder than a real submission date.
- **`RFQ-2026-0003`** has no company and the same project name as 0002 — probably
  a duplicate attempt.
- **`RFQ-2026-0004`** — company "eve", project "evvv" — is a test entry.

A blanket `INSERT ... SELECT` would manufacture opportunities for the test rows and
put fake value into the pipeline. **Each row needs a human decision**, and the
person who created them (all five have an owner) is the one who knows.

## 3. Decision needed per row

For each: **recover**, **archive**, or **delete**.

- **Recover** → create an opportunity at `rfq_received`, link the RFQ, set the
  classification, and attach the contact as a stakeholder — the same shape the
  current flow produces.
- **Archive** → leave the RFQ, mark it closed, no opportunity. Right for anything
  real but dead.
- **Delete** → test rows. Deletion is gated by the two-person rule; route it
  through the approvals flow, not a direct `DELETE`.

## 4. Recovery SQL — per row, NOT a batch

Run one row at a time, reviewing the result before the next. Fill in the
classification from what the owner says the deal actually is.

```sql
-- REVIEW EACH VALUE BEFORE RUNNING. One row at a time.
BEGIN;

WITH r AS (
  SELECT * FROM public.rfqs WHERE rfq_number = 'RFQ-2026-0001'   -- ← the row
),
new_opp AS (
  INSERT INTO public.opportunities
    (project_name, company_id, owner_id, stage, sales_stage, flow_type,
     estimated_value_max, created_by)
  SELECT
    COALESCE((SELECT name FROM public.projects WHERE id = r.project_id),
             (SELECT name FROM public.companies WHERE id = r.company_id),
             r.rfq_number),
    r.company_id, r.sales_owner_id,
    'quotation', 'rfq_received', 'direct_rfq',
    r.estimated_value, r.sales_owner_id
  FROM r
  RETURNING id
)
UPDATE public.rfqs
   SET opportunity_id = (SELECT id FROM new_opp),
       classification = 'jih'          -- ← confirm with the owner: 'jih' or 'tender'
 WHERE rfq_number = 'RFQ-2026-0001';

-- Verify before committing:
SELECT r.rfq_number, r.classification, o.project_name, o.sales_stage
  FROM public.rfqs r JOIN public.opportunities o ON o.id = r.opportunity_id
 WHERE r.rfq_number = 'RFQ-2026-0001';

COMMIT;   -- or ROLLBACK
```

Then attach the contact, where the RFQ has one:

```sql
INSERT INTO public.stakeholders (opportunity_id, name, phone, organization, contact_order)
SELECT r.opportunity_id, c.name, c.phone,
       (SELECT name FROM public.companies WHERE id = r.company_id), 1
  FROM public.rfqs r JOIN public.contacts c ON c.id = r.contact_id
 WHERE r.rfq_number = 'RFQ-2026-0001' AND r.contact_id IS NOT NULL;
```

## 5. `RFQ-2026-0001` also needs its date fixed

It carries `response_due_date = '275760-07-29'` — the JavaScript maximum date,
from before validation existed (see `docs/DECISIONS.md` and
`sales-stage-backfill-plan.md`). While it stands, that RFQ is excluded from every
deadline query.

**The correct date is not recoverable from the record.** It needs to come from
whoever created it on 2026-07-29. Until then:

```sql
-- Either the real date, or NULL so it stops pretending to have one:
UPDATE public.rfqs
   SET response_due_date = NULL       -- ← or the real deadline
 WHERE id = '499e3955-a310-4acd-ae4c-c849a01a1753';
```

Once no out-of-range dates remain, the column can be constrained:

```sql
ALTER TABLE public.rfqs
  ADD CONSTRAINT rfqs_response_due_date_sane
  CHECK (response_due_date IS NULL
         OR response_due_date BETWEEN DATE '1990-01-01' AND CURRENT_DATE + INTERVAL '20 years');
```

## 6. Not urgent

New RFQs are created correctly — `RFQ-2026-0005` (2026-08-06) has its opportunity,
its classification, and its stakeholder. Nothing is accumulating. This is cleanup
of a finite, five-row backlog, and it can wait for the owner's input.
