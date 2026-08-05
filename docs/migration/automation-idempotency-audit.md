# Automation idempotency audit — before scheduling `run_automations`

Status: **audit only, nothing changed.** No migration applied, no production row
modified. Read-only queries against PHC AGENT (`lrfdtoexyeghrzynapyn`) on
2026-08-05, plus source review of
`supabase/functions/sales-os-api/handlers/automation.ts`.

**Verdict: do NOT schedule `run_automations` on pg_cron as it stands.** It is
idempotent enough for the manual, occasional cadence it runs at today, and not
idempotent enough for a daily one. Two defects that are currently invisible
become daily noise the moment a scheduler is attached.

---

## 1. How deduplication works today

Every rule funnels through one `raiseFlag()` helper, which does a check-then-insert:

```
SELECT id FROM opportunity_flags
 WHERE linked_record_id = :record
   AND queue_action_type = :type
   AND status IN ('open','in_progress','escalated','blocked')
 LIMIT 1
-- if found: skip. else: INSERT.
```

For the normal case — run it twice in a row, nothing changed — this is correct.
The second run finds the open flag and skips. That much holds.

## 2. Defect A — the dedup is not enforced, only checked

`opportunity_flags` has **no unique constraint**. Confirmed live:

| index | columns | unique |
|---|---|---|
| `opportunity_flags_pkey` | `(id)` | ✅ |
| `idx_flags_record` | `(linked_record_type, linked_record_id)` | ❌ |
| `idx_flags_status` | `(status)` | ❌ |
| `idx_flags_queue_action_type` | `(queue_action_type)` | ❌ |
| `idx_flags_status_due_date` | `(status, due_date)` | ❌ |

So the SELECT-then-INSERT is a textbook TOCTOU race. Two concurrent runs — a
manager clicking **Run Automations** while cron fires, or two managers clicking
at once — can both pass the check before either inserts. Nothing at the database
level stops the duplicate.

Today this is unlikely, because runs are manual and rare. Adding a scheduler adds
exactly the second concurrent writer that makes it likely.

## 3. Defect B — resolved flags come back, and this is already happening

The dedup only looks at **active** statuses. Once a flag is `completed`,
`resolved`, or `dismissed`, it stops suppressing anything.

But the rules test the *underlying condition*, not the flag. `follow_up_overdue`
selects follow-ups where `status NOT IN (completed, cancelled) AND due_date < today`.
The flag is a separate record. So:

1. A follow-up is overdue → flag raised.
2. The user marks **the flag** done, without completing the follow-up itself.
3. The follow-up is still overdue → next run raises a **new** flag.
4. Repeat, forever.

**This is not hypothetical — it is already in the production data:**

| record | queue_action_type | flags | statuses |
|---|---|---|---|
| `7c64ea5b…5151` | `approval_needed` | 2 | completed + in_progress |
| `d82757e1…f805` | `no_next_action` | 2 | completed + open |

Two duplicates accumulated at a manual cadence over roughly a month. The
conditions currently standing that would re-fire on every single run:

| condition | count |
|---|---|
| follow-ups still overdue | **4** |
| pending approvals | **3** |
| tier A/B opportunities with no next action | **2** |
| follow-ups due today | 0 |

At a daily schedule, each of these produces a fresh flag every day it stays
unresolved and its previous flag was dismissed. That is roughly **270 junk flags
a month** against a queue that currently holds 12 open items. The Action Center
stops being usable, and users learn to ignore it — which costs more than not
having the automation at all.

## 4. Defect C — legacy flags cannot dedup

Two production flags carry `queue_action_type = NULL` (raised before the Sprint 5
vocabulary existed, both still `open`). The dedup does
`.eq("queue_action_type", :type)`, and SQL `NULL = anything` is never true, so
these rows suppress nothing. A typed flag will be raised alongside them for the
same condition.

Small — 2 rows — but it should be cleaned up before the volume goes up.

## 5. Defect D — no run log

There is no `automation_runs` table, no `last_run` timestamp, nothing. The only
scheduled job in the system is the AI weekly report. If cron is attached and
then silently stops firing, **nothing surfaces that** — the queue simply goes
quiet, which looks identical to "no problems today".

## 6. What is genuinely fine

- Rules are **read-only over the source records**. They never mutate an
  opportunity, follow-up, or approval — only insert flags. A bad run cannot
  corrupt commercial data.
- Multiple overdue follow-ups on one opportunity correctly collapse into a
  single flag, because dedup is keyed on `opportunity_id`.
- `missing_data` is deliberately excluded here (produced by the scoring engine
  instead), so it is not double-raised.
- The `raised` counter reports inserts only, so it does not overstate.

---

## 7. Remediation — in the order it should be done

### Step 1 — make dedup an invariant, not a hope (migration, approval-gated)

```sql
-- Deduplicate first: the index cannot be created while duplicates exist.
-- Expected: 2 rows, both already-completed halves of the pairs in §3.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY linked_record_type, linked_record_id, queue_action_type
           ORDER BY created_at DESC
         ) AS rn
    FROM public.opportunity_flags
   WHERE status IN ('open','in_progress','escalated','blocked')
     AND queue_action_type IS NOT NULL
)
SELECT * FROM ranked WHERE rn > 1;   -- review before deleting anything

CREATE UNIQUE INDEX CONCURRENTLY opportunity_flags_active_dedup
    ON public.opportunity_flags (linked_record_type, linked_record_id, queue_action_type)
 WHERE status IN ('open','in_progress','escalated','blocked')
   AND queue_action_type IS NOT NULL;
```

Then make `raiseFlag()` tolerate a unique violation (Postgres `23505`) as a
successful no-op instead of an error, so the race resolves to "already exists".

### Step 2 — stop re-raising a condition the user already judged

The clean fix is to key dedup on the *condition*, not just its type, so a flag is
raised once per distinct occurrence rather than once per run:

```
dedup key = (record, queue_action_type, triggering_value)
```

where `triggering_value` is the thing that makes the condition true — for
`follow_up_overdue`, the follow-up's `due_date`. While the condition persists
unchanged, the key is unchanged, so a dismissed flag stays dismissed. When the
follow-up is rescheduled, the key changes and a new flag is correct.

This needs a nullable `condition_key TEXT` column on `opportunity_flags` and the
unique index above extended to include it.

**Cheaper interim if that is too much for now:** add a cooldown — skip if a flag
of the same type for the same record was created within the last 7 days
*regardless of status*. Blunt, but it caps the noise at ~4/month per condition
instead of ~30.

### Step 3 — auto-resolve flags whose condition has cleared

Currently a flag is only closed by hand. If `run_automations` also resolved
active flags whose condition no longer holds, the queue would self-clean and
Step 2 would matter much less. This is the correct long-term design and the
largest change — worth doing, but not a prerequisite for scheduling.

### Step 4 — add a run log, then schedule

A minimal `automation_runs (id, started_at, finished_at, raised, error)` table,
written on every invocation, makes cron health observable. Schedule only after
Steps 1 and 2 are in.

---

## 8. Recommendation

Schedule after **Step 1 + Step 2**. Steps 3 and 4 can follow.

Scheduling before then converts a real capability into a real liability: the
rules are correct, the queue is the right place for them, and the only thing
standing between the two is that the same condition can be raised more than once.
