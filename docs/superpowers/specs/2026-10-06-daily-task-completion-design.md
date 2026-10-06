# Daily task completion on the board — design (phase 1 of the sales-engineer playbook)

Date: 2026-10-06. Approved by the user in chat ("موافق").

## Context

The user wants each salesperson's day tracked, with a daily completion rate on the
permanent wall board (`/board`), refreshed every day with new work — added by hand or
proposed by AI. A sales-engineer role document (pasted 2026-10-06) was discussed and
split into three phases; this is phase 1. Phase 2 (stage playbook: "evidence of done"
per stage, a pre-RFQ stage, buyer type, contact roles, account-level prequalification,
AI proposals from the gaps) and phase 3 (pre-submission checklist, PO-vs-quote check,
handover, mandatory loss reason, weekly auto-report, hygiene flags) get their own specs.

What exists today (2026-10-06):

- `tasks` (owner_id, due_date, status TEXT without CHECK, source, completed_at). Created
  only by approved RPCs: daily assistant (`ai_daily:`), AI recommendation
  (`ai_recommendation:`), meetings (`meeting_action:`). **No UI creates a task by hand
  and nothing ever closes one.** Status values disagree: UI filters `<> 'done'`,
  `opportunity_next_action` uses `<> 'completed'`.
- `follow_ups` (enum scheduled/due/overdue/completed/cancelled) and `commitments`
  (open/…, owner_id, due_date, closed_at) are the rest of a rep's daily work.
- `/board` polls every 60 s, reads no tasks, shows "Team performance" per rep. It is
  driven by the display account (`profiles.is_display_account`, info@).

## Decisions

1. **Rep plans the day; the manager can add.** Rep adds own tasks; pipeline operators
   (sales/BD managers, sales ops, MD/GM) assign tasks to a rep. AI proposes; the rep
   approves (existing rule — AI never creates work by itself). Mandatory items
   (follow-ups, commitments) enter on their own.
2. **Today's list** for a rep, Riyadh calendar day D:
   - open tasks owned, `due_date <= D` (a task without a due date is due the day it was created);
   - follow-ups owned in scheduled/due/overdue with `due_date <= D`;
   - open commitments owned, `due_date <= D`, either direction (chasing the client counts);
   - plus everything owned that was completed on D, whatever its due date (working ahead counts).
   Cancelled items never count.
3. **Rate** = done on D ÷ (done on D + open items due by D). Overdue = open with due < D.
   No items → no rate (shown as "—", not 0 % or 100 %).
4. **Source buckets** shown next to every item and in the board breakdown:
   mandatory (follow-up, commitment), manager (`manager:<uid>`), self (`self`),
   AI (`ai_daily:`, `ai_recommendation:`), meeting (`meeting_action:`).
5. **Task status** becomes `open | done | cancelled` with a CHECK; `opportunity_next_action`
   is fixed to `<> 'done'`. Existing open tasks: count shown to the user before release;
   the user decides keep-open or close-as-baseline.
6. **Cancel**: a rep cancels own self/AI tasks with a reason; manager tasks only by a
   pipeline operator. No deletes (the `tasks_no_delete` trigger stays).
7. **Board shows numbers only** — never task titles (wall display).
8. **History**: a nightly snapshot (23:55 Riyadh) per rep per day, for "yesterday" now
   and a weekly trend later.

## Data

- Migration `20261006100000_daily_task_completion.sql`:
  - normalise `tasks.status` (`completed` → `done`), add CHECK, add `cancel_reason TEXT`,
    fix `opportunity_next_action`.
  - RPCs (SECURITY DEFINER, `search_path = public`):
    - `create_task(_title, _due_date, _opportunity_id, _owner_id)` — owner = caller
      (source `self`) or, for pipeline operators only, another active non-display user
      (source `manager:<caller>`, notification `task_assigned`).
    - `set_task_status(_id, _status, _reason)` — done/open by the owner or a pipeline
      operator; cancelled per decision 6, reason required. Stamps `completed_at`.
    - `daily_completion(_day date)` — one row per rep: user_id, name, done, open_due,
      overdue, counts per source bucket, rate. Readable by pipeline operators, system
      admins and the display account; nobody else. Aggregates only.
  - `daily_completion_snapshots(day, user_id, done, open_due, overdue, buckets jsonb)`,
    primary key (day, user_id); pg_cron `daily-completion-snapshot` at 20:55 UTC.
  - "Reps" = active, non-display users who have at least one item that day or a sales
    target.
- Follow-ups and commitments are closed through their existing paths (follow-up
  completion, commitment close with outcome note); the list just links to them.

## UI

- **My Workspace → "My tasks today"** replaces the current task split: today's list
  (overdue first, then due today, then done today), a ✓ per item, source badge, an
  "Add task" form (title, due date default today, optional deal), and the day's rate.
- **Assign task** (pipeline operators): owner picker + title + due date + deal; from
  My Workspace.
- **Board**: new "Today's completion" panel next to Team performance — team rate, then a
  row per rep: name, bar, `6 / 8`, overdue count, source split, yesterday's rate. Uses
  `daily_completion(today)` and the snapshot for yesterday; same 60 s poll. Typography
  follows the board's viewport-clamped scale.

## Changes made while planning

- No snapshot table or cron: `daily_completion(day)` recomputes any past day from `completed_at` /
  `closed_at`, so "yesterday" is live.
- The per-source split lives in the managers' "Team today" table; the wall board gets a compact "Today"
  column in Team performance (rate, done/total, yesterday) so the tuned board grid is unchanged.

## Errors and edge cases

- Day boundaries use Asia/Riyadh everywhere (SQL and UI).
- A rep with only done items → 100 %; with none → "—".
- Reassigned task: counts for the current owner.
- Completed then reopened the same day → not counted (completed_at cleared).

## Testing

- pgTAP: status CHECK; rep creates own task, cannot assign to others; operator assigns
  and the owner is notified; cancel rules; `daily_completion` maths (overdue carried,
  early completion counted, cancelled excluded, no items → null rate); a salesperson
  cannot call `daily_completion`; display account can.
- Bun: rate/bucket helpers, Riyadh day helper, contract test that the board never
  selects task titles.
- Isolated role checks (CI) cover the board for the display account.

## Out of scope (later phases)

Stage evidence checklists and AI proposals from gaps (phase 2); quotation checklist,
PO reconciliation, handover, loss reason, weekly report, hygiene flags (phase 3).
