# info@ mailbox — setup guide

## 1. What this does

Every 5 minutes the system reads new mail in `info@phc-sa.com` (and only that mailbox). An AI step sorts each message: a quotation request or RFQ becomes a request in **Lead & Tender Inbox** (with location, client RFQ number, estimated value and scope filled in where the email states them); everything else waits in the **info@ mail — to route** panel at the top of that page, where a sales manager, BD or sales ops forwards it to a colleague's Outlook, turns it into a request, or dismisses it. Later client replies to a bound conversation appear under Correspondence on the deal and notify the active people on it (else the sales managers). The system never sends mail from info@ on its own; forwarding is a person's click and asks for confirmation first.

Who can read what: the triage summaries are readable by the info@ account in the system, which is also the login of the board screen. It sees summaries of mail that already sits in its own mailbox. Non-request mail (CVs, invoices, newsletters) keeps only sender, subject, label and one line; its text is never stored. Attachments are listed by name, not stored.

## 2. Exchange (Mo, once, ~15 min)

In PowerShell, as an Exchange admin (Organization Management):

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # first time only
Connect-ExchangeOnline
# IDs from entra.microsoft.com → Enterprise applications → "PHC Command Center" (NOT App registrations):
#   Application ID = <AppId>, Object ID = <ObjectId>
New-ServicePrincipal -AppId <AppId> -ObjectId <ObjectId> -DisplayName "PHC Command Center"
New-ManagementScope -Name "PHC info mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'info@phc-sa.com'"
New-ManagementRoleAssignment -App <ObjectId> -Role "Application Mail.Read" -CustomResourceScope "PHC info mailbox"
New-ManagementRoleAssignment -App <ObjectId> -Role "Application Mail.Send" -CustomResourceScope "PHC info mailbox"
Test-ServicePrincipalAuthorization -Identity <ObjectId> -Resource info@phc-sa.com      # InScope: True
Test-ServicePrincipalAuthorization -Identity <ObjectId> -Resource <any rep>@phc-sa.com  # InScope: False
```

**Do not** add Mail.Read or Mail.Send as *Application* permissions in Entra. The Entra grant and the Exchange grant add up, and an Entra grant would reach every mailbox. This is Exchange RBAC for Applications: the only access is the one limited to info@.

Exchange permission changes take 30 minutes to 2 hours to apply (Exchange's cache). If the two `Test-ServicePrincipalAuthorization` lines do not give True and False at first, wait and run them again before looking for a fault.

## 3. Sales can open the thread in Outlook

```powershell
Add-MailboxFolderPermission -Identity "info@phc-sa.com:\Inbox" -User <PHC-Sales-Mail, or each rep> -AccessRights Reviewer
```

Read-only. This needs a mail-enabled group, so if the group isn't mail-enabled, run it once per rep. Without it, a rep cannot open the original thread in Outlook from the Source email panel or the router list; the rest of the system is unaffected.

## 4. Turn it on

The order matters. Nothing deploys on merge; each step is approval-gated.

1. `supabase db push` for the two migrations: `20261025090000_inbox_source_info_mailbox.sql` and `20261025100000_info_mailbox.sql`.
2. Deploy `ai-orchestrator`, `outlook-sync` and `sales-os-api`.
3. Section 2 above (Exchange), and wait for it to apply.
4. Make sure the AI provider key is set.
5. `supabase secrets set INFO_MAILBOX=info@phc-sa.com`
6. Watch the first pass (section 5).
7. Canary, then production for the UI.

Enable `INFO_MAILBOX` only after the Exchange setup and after the AI provider key is set. Otherwise sorting pauses: it no longer loses text, but nothing gets sorted.

Things to know:

- The info@ profile in the system must stay **active**. It is the requester the AI usage is counted against (300 a day).
- An AI outage pauses sorting; it does not use up a message's three tries. `info_mailbox_state.last_error` then shows `triage paused: <code>`, and the backlog is sorted once the AI is back.
- The orchestrator gateway still needs a JWT, so the pass sends the anon key. Nothing to do about that.
- Triage never overrides a router: a message someone dismissed or forwarded never becomes a request afterwards.

## 5. Check it

Send a test RFQ to info@ from an outside address. Within about 10 minutes it should appear in Lead & Tender Inbox with the "Email to info@" chip. In the SQL editor:

```sql
select last_run_at, last_error from info_mailbox_state;
```

`last_error` empty means the last pass was clean. `triage paused: <code>` means the AI step is down or unconfigured (see section 4); an Exchange error here usually means the permissions in section 2 have not applied yet.

## 6. Turn it off

```
supabase secrets unset INFO_MAILBOX
```

Optionally remove the two assignments in PowerShell with `Remove-ManagementRoleAssignment` (Mail.Read and Mail.Send for the "PHC info mailbox" scope). The pass stops reading; requests already created stay.
