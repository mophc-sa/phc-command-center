# Manager's five actions and the info@ mailbox — Design

Date: 2026-10-19 · Status: approved in brainstorming by Mo, 2026-10-19 · Due 2026-10-25 ·
Source: the manager's feedback list of 2026-10-19, group 3. Builds on
`2026-09-29-outlook-graph-design.md` and on PR #349 (approvals split into manager decisions and other requests).

## Choices (Mo, 2026-10-19)

| # | Question | Choice |
|---|----------|--------|
| 1 | What the five actions are | Five cards. Each shows a count and its top 3 items, filled in by the system |
| 2 | Meeting card source | The manager's own Outlook calendar, today and tomorrow, read-only |
| 3 | Call card | Clients on top-priority deals (at risk, stalled, closing soon) with no client contact for 14+ days |
| 4 | How the system reads info@ | App access limited to info@ only (Exchange RBAC for Applications); nobody signs in as info@ |
| 5 | Who gets an RFQ | The sender company's account owner; otherwise unassigned, and the sales manager is notified to assign it |
| 6 | Non-RFQ mail | Labelled and listed. A person picks a colleague and the system forwards it. Nothing is forwarded automatically |
| 7 | "Replies go to whoever entered the project" | The client's later replies show on the project and notify whoever entered it; they reply from their own Outlook with CC and @mention |
| 8 | "Open in Outlook" | Sales get read access to info@; the project shows the source email and an Outlook link |
| 9 | "System link on the company domain" | The system already runs at `https://agent.phc-sa.com`. The manager means a "Staff login" link on phc-sa.com. That lives in the website repo and is a separate task, not part of this spec |

Delivered as two PRs: **A** (home page, no migration) and **B** (info@ mailbox, one migration).

---

## Part A — The five actions on the manager's home page

### Where

`/command-center` is the landing page for `executive` and `sales_manager`. A strip of five cards goes directly under the
`PageHeader`, above "Performance against target". It replaces the "Decisions awaiting approval" strip, whose job
moves into the Approve card. Desktop shows one row of five; narrower screens wrap; a phone shows one column. Each card has a title, an
icon, a count, up to three items, an empty state and a "View all" link.

### The cards

| Card | Items (max 3 shown, count = all) | Item action | View all |
|---|---|---|---|
| **Call** (اتصال) | One row per deal: open deals whose attention reasons include at risk, stalled or closing soon, and whose last verified client contact is 14+ days ago or missing. Ranked by attention score. Shows the contact, phone, deal and days quiet. Contact = the deal's decision maker from the stakeholders the page already loads, else the first contact with a phone | `tel:` link and **Log call**, which records a `call` activity on the deal through the existing activity insert (the same path the deal page uses) | `/action-center` |
| **Meetings** (اجتماعات) | Events from the manager's Outlook calendar, now to end of tomorrow (Riyadh), skipping cancelled ones and any marked private. Shows the time, subject and location | Opens the event's Outlook `webLink` | Outlook calendar on the web |
| **Email** (البريد) | The stored `daily_email_brief` for the manager (the same one My Workspace shows), top items by priority | Opens the deal, or the email in the existing brief view | `/my-workspace` (daily assistant) |
| **Follow up with the team** (متابعة الفريق) | Reps from `daily_completion(today)` with overdue > 0, or open_due > 0 and done = 0. Ranked by overdue, then open_due | Counts only, as `TeamDayPanel` shows (titles stay with their owners). **Give a task** opens a small form that calls `createTask` from `daily-tasks.ts` with that rep as owner, the same call `TeamDayPanel` makes | `/my-workspace` team panel |
| **Approve** (اعتماد) | Pending approvals where `isManagerDecision(...)` is true (PR #349), oldest first, with plain names from `approval-labels.ts` | Opens `/approvals` on the Manager decisions tab | `/approvals` |

States: a card that has no items shows a short empty line (e.g. "No quiet deals"). If Outlook is not connected, the Meetings and Email cards
show a "Connect Outlook" button linking to `/settings`. A card whose query failed shows its own retry line and does not take
the page down. Numbers use Latin digits (the existing rule).

### New server piece

`outlook-connector` gets a JWT-verified action `calendar_upcoming`. It reads `GET /me/calendarView?startDateTime=…&endDateTime=…`
with `$select=subject,start,end,location,webLink,isCancelled,sensitivity`, `$top=20`, and `Prefer: outlook.timezone="Arab Standard Time"`.
It uses the caller's own delegated token (`Calendars.ReadWrite` is already granted; only reading is done).
It returns `{ connected: false }` when the caller has no connection and never stores anything. Who may call it: anyone with their own active connection.
Requirement: `executive` and `sales_manager` users can connect Outlook. If the connector's role gate refuses them today, widen it to include them,
and only them.

### Code shape

- `src/lib/manager-actions.ts` holds the pure functions `callItems`, `teamItems`, `approveItems` and `meetingItems`, unit-tested.
- `src/components/phc/ManagerActions.tsx` renders the strip, with one `ActionCard` per card. Its data hooks live there too, so the 1,280-line route only
  gains the component and the data it already holds (opportunities, attention, stakeholders, approvals).
- No migration. Part A rebases onto #349 for `isManagerDecision`.

---

## Part B — The info@ mailbox

### B1. Access (Mo, once, about 15 minutes)

Exchange **RBAC for Applications** replaces Application Access Policies. Microsoft advises against creating new access
policies. With RBAC for Applications **no Mail permission is added in Entra**, so the app cannot reach any other mailbox.
In Exchange Online PowerShell (`Connect-ExchangeOnline` as Global Admin):

```powershell
# 1. Exchange's view of the existing app (AppId = MS_CLIENT_ID; ObjectId = the Enterprise application's Object ID)
New-ServicePrincipal -AppId <MS_CLIENT_ID> -ObjectId <enterprise-app-object-id> -DisplayName "PHC Command Center"
# 2. A scope that matches info@ only
New-ManagementScope -Name "PHC info mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'info@phc-sa.com'"
# 3. Read and send, inside that scope only
New-ManagementRoleAssignment -App <MS_CLIENT_ID> -Role "Application Mail.Read" -CustomResourceScope "PHC info mailbox"
New-ManagementRoleAssignment -App <MS_CLIENT_ID> -Role "Application Mail.Send" -CustomResourceScope "PHC info mailbox"
# 4. Check: InScope True for info@, False for any rep
Test-ServicePrincipalAuthorization -Identity <MS_CLIENT_ID> -Resource info@phc-sa.com
Test-ServicePrincipalAuthorization -Identity <MS_CLIENT_ID> -Resource <a rep>@phc-sa.com
# 5. Sales can read info@ in Outlook (read-only, Inbox)
Add-MailboxFolderPermission -Identity "info@phc-sa.com:\Inbox" -User <PHC-Sales-Mail> -AccessRights Reviewer
```

Check the exact syntax against Microsoft's "Role Based Access Control for Applications in Exchange Online" page when writing
the plan. Folder permissions need a mail-enabled security group; if `PHC-Sales-Mail` is not mail-enabled, add the reps
one by one. New secret: `INFO_MAILBOX=info@phc-sa.com`. Without it, the info@ pass is off. The app-only token uses the existing
`MS_TENANT_ID`/`MS_CLIENT_ID`/`MS_CLIENT_SECRET` with the client-credentials grant (`https://graph.microsoft.com/.default`).

### B2. Data (one migration)

- `inbox_source_type` + `'email'`.
- `inbox_items` + `client_rfq_ref text`, `source_mail_id uuid` (FK to `info_mail`).
- `info_mail`: `id`, `graph_message_id` (unique), `internet_message_id`, `conversation_id` (indexed), `from_email`,
  `from_name`, `subject`, `received_at`, `category` (`rfq` | `quotation_request` | `client_reply` | `supplier` | `finance` | `hr` |
  `general` | `spam` | `unclassified`), `confidence numeric`, `summary` (one line), `body_text` (**RFQ, quotation and client reply only**, capped
  at `MAX_BODY`), `attachment_names text[]`, `web_link`, `status` (`new` | `intake_created` | `forwarded` | `dismissed` |
  `attached`), `inbox_item_id`, `opportunity_id`, `forwarded_to uuid`, `handled_by uuid`, `handled_at`.
  RLS: read for `is_pipeline_operator`. No client writes. Every change goes through security-definer RPCs: `info_mail_forward`,
  `info_mail_dismiss`, `info_mail_mark_rfq` for routers (`sales_manager`, `ceo`, `bd_manager`, `sales_ops`). `info_mail_forward`
  only records intent. The actual Graph call happens in the edge function, which checks the role again.
- `info_mailbox_state`: one row, `delta_link`, `last_sync_at`, `last_error`. Service role only.
- `email_threads` rows bind an info@ `conversation_id` to the deal on conversion (existing table, existing reply rule 1).
- Notification types: `info_mail_assigned`, `info_mail_unassigned`, `client_reply`, `mention`. They use the `notification-target.ts`
  routing from #349.
- `activities` + `mentions uuid[]` (or a small `activity_mentions` table, decided in the plan) for @mentions on sent email.

### B3. The 5-minute pass

`outlook-sync` (pg_cron, already every 5 min) runs a second pass when `INFO_MAILBOX` is set:

1. App-only token → `GET /users/{INFO_MAILBOX}/mailFolders('inbox')/messages/delta` with headers, `uniqueBody`,
   `conversationId`, `webLink` and `hasAttachments`. First run: 7 days back. Attachment names come from `/attachments?$select=name`; files are not downloaded.
2. Skip mail from `phc-sa.com` senders and auto-replies (`Auto-Submitted`, `X-Auto-Response-Suppress`).
3. **Conversation already known** (`email_threads` or `info_mail.opportunity_id`): store as `client_reply`, write an
   `email_received` activity on the deal, and notify the person who entered the deal (`opportunities.created_by`) plus the owner if
   different. No AI call.
4. **Conversation belongs to an intake item not yet converted**: store as `client_reply` against the item and notify its assignee
   (or the sales managers if unassigned). No AI call.
5. **New conversation** → agent `info_mail_triage` in `ai-orchestrator` (see B4).
   - `rfq` / `quotation_request` with confidence ≥ 0.7 → create an `inbox_items` row: `source_type='email'`, `source_name=from`,
     company, contact, email, phone, project_name, location, scope, estimated_value, `client_rfq_ref`, deadline, `evidence_url=web_link`,
     `classification` as the intake page does for an RFQ. Owner: the account whose `company domain` or contact email matches the sender and that has an
     `owner_id` → `assigned_owner_id`, notification `info_mail_assigned`. Otherwise unassigned + `info_mail_unassigned` to every active
     `sales_manager`.
   - Anything else, or low confidence → stays in `info_mail` with label and summary; body not stored unless RFQ/quotation.
6. Converting an intake item to a project (existing flow) also writes the `email_threads` row and sets `info_mail.opportunity_id`.

Failures: Graph 401/403 → `last_error`, pass stops, rep sync unaffected. AI unavailable → message stored `unclassified`, shown in
the list for a person; retried on the next pass up to 3 times.

### B4. Agent `info_mail_triage` (orchestrator)

Registry entry, schema and prompt builder, like every agent. Input: from, subject, body (capped, wrapped by `delimitUntrustedContext`),
attachment names. Output: `category`, `confidence`, `summary` (one line, Arabic and English), and for RFQ/quotation `{ company, contact_name,
phone, project_name, location, client_rfq_ref, estimated_value, currency, scope, deadline }`. Every field may be null; nothing is guessed.
Stored in `ai_agent_outputs`.

**New: first background caller.** Until now the orchestrator is called only on a person's click. `outlook-sync` calls it with a
server-only secret (`ORCHESTRATOR_SERVICE_KEY`, constant-time compare). That secret is accepted **only** for agents marked
`serviceCallable` in the registry, and only `info_mail_triage` is marked. Recorded in DECISIONS.md.

### B5. Screens

- **Lead & Tender Inbox**: items from email show an "Email" source chip, the client RFQ number and a "Source email" link.
- **info@ mail** (new tab on the Lead & Tender Inbox page, visible to routers): the non-RFQ list, grouped by label, newest first. Actions:
  **Forward to ▾** (a colleague; edge action `info_mail_forward` → `POST /users/{info}/messages/{id}/forward` with a one-line comment
  naming who routed it), **This is an RFQ** (creates the intake item from a fresh triage of the full message), **Dismiss**.
- **Project page**: a "Source email" panel when the deal came from info@ (subject, sender, date, text, attachment names,
  **Open in Outlook ↗**) above the existing correspondence panel, where client replies already appear.
- **Send window** (existing, from the rep's own mailbox): CC already exists; add **@mention** (colleague picker). On send, each
  mentioned person gets a `mention` notification linking to the deal. Mentions are not emailed.

Known limit, stated in the USER_GUIDE: a rep's reply starts a new email "RE: subject" from their mailbox. It does not continue the info@
thread in the client's inbox, because the rep's mailbox does not hold the original message.

---

## Tests

- Unit (Vitest): `manager-actions.ts` covers quiet threshold, ranking, the three-item cap, approvals filter, team ranking and the empty cases.
- Deno: info pass routing covers known conversation → reply, intake conversation → item reply, new → triage, internal sender skipped,
  auto-reply skipped, low confidence → list. Owner resolution covers contact email, domain, no owner and two accounts on one domain (→ unassigned).
  Service-key gate covers a wrong key, a right key for a non-service agent (refused) and a right key for triage. Calendar mapping covers cancelled/private dropped and Riyadh day bounds.
- pgTAP: `info_mail` and `info_mailbox_state` deny writes to every client role; routers' RPCs refuse non-routers; non-RFQ rows have
  null `body_text` (CHECK).
- The no-Arabic-Indic-digits test covers all new strings.

## Release

Follows `deployment-governance.md`. PR A: merge → canary → production. PR B: CI → approval-gated `db push` → deploy
`ai-orchestrator`, `outlook-sync`, `outlook-connector`, `sales-os-api` → Mo runs B1 and sets `INFO_MAILBOX` + `ORCHESTRATOR_SERVICE_KEY`
→ watch the first pass → canary → production. Nothing auto-deploys on merge. USER_GUIDE is updated in each PR (sections for the manager's home
page, info@ mail, source email and mentions, plus section 10 limits).

## Out of scope

The phc-sa.com "Staff login" link (website repo, separate task). Calendar write-back (Graph design phases 5–6). Downloading
attachments. Auto-forwarding by category.
