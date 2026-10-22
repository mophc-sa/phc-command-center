# Samples, drawings and client reminders (manager feedback group 5)

Date: 2026-10-22 · Due: 2026-11-01 · Approved by Mo ("Approve, build it") on 2026-10-22.

## What the manager asked for

1. Sample tracking per project: sales request → approval → manufacturing by Ammar (production)
   → received → sent to client → client response (Code B / Code C / rejected / approved with
   comments). Each step has who, when and notes; the status shows on the deal page and in a list.
2. Drawings tracking: the designer sends → sales sends to the client → approved, or comments
   returned. Revisions are kept.
3. Client follow-up reminders on a specific date, or repeating monthly or yearly.

## Decisions

- **One model for both.** Samples and drawings are submittals: something we send the client for a
  coded answer. One table `deal_submittals` (kind `sample` | `drawing`) and one append-only step log
  `deal_submittal_steps`. Separate tables would double the policies, tests and screens for one
  lifecycle.
- **Sales records every step** (Mo, 2026-10-22). Ammar and the designer do not log in to record
  their own steps. A step names who did it: a system user (`actor_id`) or a typed name
  (`actor_name`, e.g. "Ammar"). `recorded_by` is always the signed-in person.
- **The sample approval is inside the tracker, not the Approvals queue.** Routing it through
  `approvals` needs a `sales-os-api` change and deploy, and collides with group 3's open approvals
  work. Only commercial managers (`is_commercial_manager`: MD, GM, CEO, sales manager) may record
  `approved` / `declined`; the sales manager and GM are notified of each request.
- **Client response codes:** `approved` = Approved (Code A), `approved_with_comments` = Approved
  with comments (Code B), `revise_resubmit` = Revise and resubmit (Code C), `rejected` = Rejected.
  Standard submittal practice treats "Code B" and "approved with comments" as the same answer.
- **Reminders extend `follow_ups`**, not a new system. `recurrence` is `none` | `monthly` |
  `yearly`. A reminder may belong to a deal or to a client company (monthly and yearly check-ins
  are about the relationship, not a deal).

## Data (migration `20261026100000_samples_drawings_reminders.sql`)

### `deal_submittals`
`id`, `opportunity_id` (cascade), `kind`, `title` (1–200 chars), `notes`, `revision` (starts at 0),
`current_step`, `client_response` (latest), `last_step_at`, `created_by`, `created_at`,
`updated_at`. Clients may insert and edit `title`/`notes`; the state columns are written only by the
step trigger.

### `deal_submittal_steps`
`id`, `submittal_id` (cascade), `revision`, `step`, `response` (only on `client_response`),
`actor_id` / `actor_name` (who did it), `occurred_at` (when it happened; may be back-dated, not
in the future), `notes`, `document_id` (optional file from the registry, so a drawing PDF keeps its
version chain), `recorded_by`, `recorded_at`. No UPDATE or DELETE: the log is history.

### Allowed order (enforced by a BEFORE INSERT trigger; mirrored in `src/lib/submittals.ts`)

| Kind | Current step | Next steps |
|---|---|---|
| sample | (none) | requested |
| sample | requested | approved, declined, cancelled |
| sample | approved | in_production, cancelled |
| sample | in_production | received, cancelled |
| sample | received | sent_to_client, cancelled |
| sample | sent_to_client | client_response, cancelled |
| sample | client_response, declined | requested (new revision) |
| drawing | (none) | designer_sent |
| drawing | designer_sent | sent_to_client, cancelled |
| drawing | sent_to_client | client_response, cancelled |
| drawing | client_response | designer_sent (new revision) |

`cancelled` is final. The first step of a new cycle increments `revision`; earlier revisions stay.

### Who

- Read: whoever can read the deal (`EXISTS` on `opportunities` under the caller's RLS), as
  `opportunity_updates` does.
- Insert a submittal or a step: `is_sales_contributor` and the deal is readable, as themselves.
- `approved` / `declined`: `is_commercial_manager` only (42501 otherwise).

### Notifications (`emit_notification`, entity `opportunity`, metadata carries `opportunity_id`)

- Sample `requested` → sales managers and general managers: "Sample approval needed".
- `approved` / `declined` → whoever recorded the request.
- `client_response` → the deal owner (skipped when they recorded it).

### Reminders

- `follow_ups.recurrence` (`none` default), `follow_ups.company_id` (FK companies),
  `follow_ups.recurs_from` (the reminder this one follows). `opportunity_id` becomes nullable with
  `CHECK (opportunity_id IS NOT NULL OR company_id IS NOT NULL)`.
- Completing a repeating reminder inserts the next: same owner, deal/company, channel, tier,
  notes, recurrence; due date = the series anchor plus whole months (1 or 12), the first one after
  the completed due date and not before today (so the 31st stays the 31st where it exists, and a
  late completion does not create a reminder already overdue). Cancelling ends the series.
- `run_sales_automations` rules 6 and 7 (follow-up due / overdue flags) keep to deal reminders
  (`opportunity_id IS NOT NULL`); the rest of the function is unchanged.
- New `notify_due_follow_ups()` called from `run_sales_automations` (07:00 AST nightly, and on
  demand): "Follow-up due today" to the owner, entity `opportunity` or `company`. Dedupe key
  `followup_due:<id>:<date>`. `notifications.entity_type` gains `company`; the click opens
  `/accounts/<id>`.

## Screens

- **Deal page:** "Samples and drawings" panel beside Files. Each item: kind, title, revision,
  current step pill, client response, "Next step" (only valid steps; approve/decline shown only to
  managers), history grouped by revision. "New sample" / "New drawing" create the item and its
  first step.
- **`/submittals`** ("Samples and drawings", Production group in the sidebar and ⌘K): every item
  the reader can see, filters by kind and by stage (awaiting approval, in production, with client,
  done, cancelled), awaiting-approval count first.
- **Reminders:** the deal's Schedule follow-up dialog gains "Repeat" (once / monthly / yearly). The
  client page (`/accounts/<id>`) gains a "Reminders" panel to add, complete and list reminders for
  that company. The Follow-ups page shows the repeat and the company for company reminders.

## Tests

- pgTAP `samples_drawings_reminders.test.sql`: deal isolation (another rep neither reads nor
  writes), step order refused out of sequence, manager-only approval, revision increments,
  notifications emitted, next reminder created with the right date, cancelling ends a series, a
  company reminder raises no deal flag, due-today notification.
- `src/lib/submittals.test.ts`: transitions, labels; drift test that the TS transition table
  equals the SQL one in the migration.
- `src/lib/follow-up-recurrence.test.ts`: next-date rule mirrors the SQL.
- `notification-target.test.ts`: `company` → `/accounts/<id>`.

## Out of scope

Approvals-queue integration for samples (follow-up after #353 lands), logins and notifications for
Ammar/the designer, editing or deleting recorded steps.
