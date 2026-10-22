# info@ mailbox — setup guide

## 1. What this does

Every 5 minutes the system reads new mail in `info@phc-sa.com` (and only that mailbox). An AI step sorts each message: a quotation request or RFQ becomes a request in **Lead & Tender Inbox** (with location, client RFQ number, estimated value and scope filled in where the email states them); everything else waits in the **info@ mail — to route** panel at the top of that page, where a sales manager, BD or sales ops forwards it to a colleague's Outlook, turns it into a request, or dismisses it. Later client replies to a bound conversation appear under Correspondence on the deal and notify the active people on it (else the sales managers). The system never sends mail from info@ on its own; forwarding is a person's click and asks for confirmation first.

Who can read what: the triage summaries are readable by the info@ account in the system, which is also the login of the board screen. It sees summaries of mail that already sits in its own mailbox. Non-request mail (CVs, invoices, newsletters) keeps only sender, subject, label and one line; its text is never stored. Attachments are listed by name, not stored.

## 2. Before you start: two checks

Do both before anything else. If either result differs, stop and fix it first.

1. In PowerShell, as an Exchange admin, check that `info@phc-sa.com` is a real mailbox, not a group or an alias:

```powershell
Connect-ExchangeOnline
Get-EXOMailbox info@phc-sa.com | Format-List RecipientTypeDetails,PrimarySmtpAddress
```

`RecipientTypeDetails` must be `UserMailbox` or `SharedMailbox`, and `PrimarySmtpAddress` must be `info@phc-sa.com`. Anything else (a group, a distribution list, "not found") means info@ is an alias; the system cannot read it until it is a mailbox.

2. In the Supabase SQL editor, check that the info@ login exists once, is active, and is a display account:

```sql
select id, status, is_display_account from profiles where lower(email) = 'info@phc-sa.com';
```

It must return exactly one row with `status = active` and `is_display_account = true`. Zero rows or two rows, an inactive status, or `false` means stop. This profile is who the AI usage is counted against, so it must stay active.

## 3. Exchange (Mo, once, about 15 minutes)

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

## 4. Sales can open the thread in Outlook

```powershell
Add-MailboxFolderPermission -Identity "info@phc-sa.com:\Inbox" -User <PHC-Sales-Mail, or each rep> -AccessRights Reviewer
```

Read-only. This needs a mail-enabled group, so if the group isn't mail-enabled, run it once per rep. Without it, a rep cannot open the original thread in Outlook from the Source email panel or the router list; the rest of the system is unaffected.

Then check it: sign in to PHC Command Center as a rep (not as yourself), open a deal that began as an email to info@, and click **Open in Outlook** in the Source email panel. The original thread must open. If Outlook says you have no access, the permission has not applied yet (wait and try again) or the rep is not in the group.

## 5. Turn it on

The order matters. Nothing deploys on merge; each step is approval-gated. Run these from the repo root, in this order.

1. Deploy the three functions **first**. Until `INFO_MAILBOX` is set they answer "off" and do nothing, so this is safe:

```
supabase functions deploy ai-orchestrator --project-ref lrfdtoexyeghrzynapyn --import-map supabase/functions/import_map.json
supabase functions deploy outlook-sync --project-ref lrfdtoexyeghrzynapyn
supabase functions deploy sales-os-api --project-ref lrfdtoexyeghrzynapyn
```

2. Then `supabase db push --linked` for the two migrations: `20261025090000_inbox_source_info_mailbox.sql` and `20261025100000_info_mailbox.sql`. This also creates the 5-minute job `info-mailbox-sync`. Check it:

```sql
select jobname, schedule, active from cron.job where jobname = 'info-mailbox-sync';
```

One row, `*/5 * * * *`, `active = true`. If it is missing, `pg_cron` or `pg_net` is not installed; the migration printed a notice instead of failing.

3. Section 3 above (Exchange), and wait for it to apply (up to 2 hours). Both `Test-ServicePrincipalAuthorization` lines must give True and False.
4. Make sure the AI provider key is set (`supabase secrets list` shows the provider key you use).
5. `supabase secrets set INFO_MAILBOX=info@phc-sa.com`
6. Watch the first pass (section 6).
7. Canary, then production for the UI.

Enable `INFO_MAILBOX` only after the Exchange setup and after the AI provider key is set. Otherwise sorting pauses: it no longer loses text, but nothing gets sorted.

What the first run does:

- Mail that arrived **before** go-live is not sorted by the AI. Routers see it in **info@ mail — to route** under "Not sorted — route by hand" (Arabic: "لم يُفرز — وجّهه يدويًا"). For one of those, **This is an RFQ** fetches the text from Outlook and creates the request.
- Only new mail is sorted by the AI.
- Newsletters and bulk mail (messages with an unsubscribe header) go straight to the **Newsletters & spam** group without the AI. A router clears the group with **Dismiss all** (asks to confirm). Glance at the group first: a client who writes through a mailing tool can land there too.
- Only the **Inbox** folder is read. Mail moved by an Outlook rule, or sitting in Junk, is not seen.

Things to know:

- The info@ profile in the system must stay **active**. It is the requester the AI usage is counted against. The mailbox has a daily AI cap of 300; at the cap, sorting stops and resumes by itself after 03:00 Riyadh time.
- An AI outage pauses sorting; it does not use up a message's three tries. Sorting backs off, trying again after 30 minutes, then 60, then 120 (the longest wait), and resumes on its own as soon as the AI answers. `info_mailbox_state.last_error` shows `triage paused: <code>`. Storing new mail continues meanwhile.
- The orchestrator gateway still needs a JWT, so the pass sends the anon key. Nothing to do about that.
- Triage never overrides a router: a message someone dismissed or forwarded never becomes a request afterwards.

## 6. Check it

Send a test RFQ to info@ from an outside address. Within about 10 minutes it should appear in Lead & Tender Inbox with the "Email to info@" chip. In the SQL editor:

```sql
select started_at, last_run_at, last_error, triage_retry_at, triage_backoff_minutes from info_mailbox_state;
```

`started_at` is set on the first pass; mail older than that is the "route by hand" mail. `triage_retry_at` and `triage_backoff_minutes` are empty or 0 when sorting is healthy. `last_error` empty means the last pass was clean. `triage paused: <code>` means the AI step is down or unconfigured (see section 5); an Exchange error here usually means the permissions in section 3 have not applied yet.

## 7. Turn it off

```
supabase secrets unset INFO_MAILBOX
```

Optionally remove the two assignments in PowerShell with `Remove-ManagementRoleAssignment` (Mail.Read and Mail.Send for the "PHC info mailbox" scope). The pass stops reading; requests already created stay.
