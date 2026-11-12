# Data sync from the master quotation list — design

Date: 2026-11-12 · Approved by Mo on 2026-11-12 (sync with preview and undo; the file wins unless the system is newer).

## Why the earlier design changed

The plan was to activate the 554 archive rows. Comparing Marie's *PHC Quotation List - SEPT 2026* (722 quotations, to 2026-11-03) with production showed that 658 of them already exist as deals (created by the July imports, code in `extra_data.sales_code`), 146 sales codes are on more than one deal (*SALES 2025-2026 Updates* was committed twice; 126 legacy rows were reconciled but never archived), and only 27 are new (+11 archive-only). Promoting the archive would have doubled the duplicates. The mechanism is a **sync by sales code** instead.

## The engine (SQL, applied by the server)

- `data_sync_runs` (source, file, as-of date, status `staged → planned → applied → undone`, summary) and `data_sync_rows` (sheet, row, payload, normalised code, planned action, target deal, field changes). `data_sync_changes` keeps every change's before and after, for undo.
- `data_sync_plan(run)`: per quotation row, by normalised sales code:
  - **duplicates**: several live deals with the code → keep one (the promoted/reconciled canonical, else the one with most activity, else the oldest), archive the others (`stage = archived`, `exclusion_reason = duplicate_opportunity`, `extra_data.duplicate_of`). Archived deals are already out of every dashboard; nothing is moved or deleted.
  - **update** the deal: stage from the status (below), quotation value when numeric, outcome date, last activity from the row's last update, the file's update log and follow-up in `extra_data`.
  - **create** a deal for a code not in the system.
  - **review** when the file cannot decide: no code, unknown status, a won deal the file shows open, a stage moved in the system after the row's last update ("the system is newer"), an owner prefix with no account.
- Status → stage: WON → won (won date = last update, else submission); LOST → lost; DECLINE → lost (loss reason *Declined (master list)*); SUBMITTED / WAITING FOR CLIENT / FOR ACTION → open (an open deal keeps its open stage; a closed one reopens at `jih`); NOT SUBMITTED → `rfq_received`, or lost (*Not submitted*) when received more than 90 days before the file; ON-HOLD → on hold; empty / NO RECORD → review.
- **Missing data** on every deal the file touches: owner from the code prefix (`historical_sales_owner_map`; BA/AD/AN/AH/MB have no account → review), company by exact name (created when absent, *pending review*), expected contract date for open deals = submission date + 90 days (received date when no submission). The project code follows the owner (existing trigger).
- `data_sync_apply(run)` runs as the server (the opportunity guards let service writes through: "must go through sales-os-api"), logs every change, and `data_sync_undo(run)` reverses them in reverse order (created deals are archived, not deleted).
- Both are service-role only. A person cannot call them; the run's actor is recorded.

## The review list

`data_sync_review` (view): every row the run could not decide, with the reason, for the sales manager and the deal owner. Readable by commercial managers.

## Other sheets

The weekly report's notes go to `extra_data.weekly_update` on the matched deal. Sales target, client relations, project references, ProTenders leads and SEVEN are staged in the same run and reported; loading them is the next step. The *VENDOR PORTALS* sheet holds credentials and is never staged.
