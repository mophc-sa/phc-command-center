# Outlook via Microsoft Graph — Design

Date: 2026-09-29 · Status: draft, choices made by the user, awaiting the Entra setup in §2 ·
Revives `docs/implementation/outlook-integration.md` §3–§5 and supersedes the
2026-09-13 decision "Graph refused" (DECISIONS).

## Why now

The 2026-09-13 decision parked Graph until someone at PHC held tenant admin. On 2026-09-24
Mo enabled **Admin Access** in GoDaddy and granted tenant-wide admin consent to the Claude
Microsoft 365 connector (two Entra apps). That is the §7 path "PHC holds Global Admin":
register an app, consent once, build.

## Choices (user, 2026-09-29)

| # | Question | Choice |
|---|----------|--------|
| 1 | Features | Send from the rep's own mailbox · capture client email automatically · bind replies to the deal · **two-way** calendar |
| 2 | Whose mailboxes | Sales team only |
| 3 | How they connect | Each person connects their own mailbox (delegated), can disconnect any time |

Delegated only, as `outlook-integration.md` §3 argues: an application `Mail.Read` grant
reaches every mailbox in the tenant. Sales-only is enforced in Entra (assignment required +
a security group) **and** in the system (only pipeline roles see "Connect Outlook").

## 1. Prerequisites (user)

1. **DNS (open since 2026-09-13):** SPF → `v=spf1 include:spf.protection.outlook.com include:secureserver.net -all`;
   enable DKIM in Defender and publish both CNAMEs. Without this, mail sent through Graph is
   unauthenticated.
2. **Confirm role:** admin.microsoft.com → Roles → Global Administrator lists Mo.

## 2. Entra setup (user, ~15 min)

1. entra.microsoft.com → App registrations → New: `PHC Command Center`, single tenant
   (`1b17e1ac-5944-4398-860e-4a07ac7c8476`).
2. Redirect URI (Web): `https://lrfdtoexyeghrzynapyn.supabase.co/functions/v1/outlook-connector/callback`.
3. API permissions → Microsoft Graph → **Delegated**: `User.Read`, `offline_access`,
   `Mail.ReadBasic`, `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite` → **Grant admin consent**.
   No application permissions.
4. Certificates & secrets → client secret (24 months; calendar reminder to rotate).
5. Enterprise applications → the app → Properties → **Assignment required = Yes** → Users and
   groups → add security group `PHC-Sales-Mail` (the sales team).
6. `supabase secrets set MS_TENANT_ID MS_CLIENT_ID MS_CLIENT_SECRET GRAPH_CLIENT_STATE`
   (loaded through `~/.supabase-guard.zsh`). Values never enter the repo or chat.

## 3. Components

| Piece | Kind | Notes |
|---|---|---|
| `outlook-connector` | Edge Function, JWT verified except `/callback` | OAuth start (PKCE + signed `state` bound to the user), callback, send, disconnect, status |
| `outlook-inbound` | Edge Function, `verify_jwt=false` | Graph change notifications + lifecycle events; echoes `validationToken`; rejects any `clientState` ≠ `GRAPH_CLIENT_STATE` (constant time, as `mail-inbound`) |
| `_shared/graph.ts` | pure rules, Deno-tested | token refresh, participant matching, event mapping, loop detection |
| pg_cron `outlook_maintenance` | every 6 h | renew subscriptions (mail < 7 days, events < 3 days), nightly delta sweep |

Tokens never reach the browser; Graph is not an AI provider, so `ai-orchestrator` is not involved.

## 4. Data model (one migration)

- `mail_connections` — `user_id` PK, `ms_user_id`, `email`, `scopes text[]`,
  `refresh_token_secret_id` (Supabase Vault), `status` ('active' | 'needs_reconnect'),
  `connected_at`, `last_sync_at`, `last_error`. Service role only (RLS on, grants revoked).
  A security-definer `my_mail_connection()` returns status/email only to its owner.
- `graph_subscriptions` — `id` (Graph's), `user_id`, `resource`, `expires_at`,
  `delta_link`. Service role only.
- `email_threads` + `graph_conversation_id text` (nullable, indexed) — replies bind by
  conversation, the Graph analogue of today's Reply-To token.
- `calendar_links` — `record_type` ('follow_up' | 'task'), `record_id`, `user_id`,
  `graph_event_id`, `last_pushed_change_key`, `detached_at`. Unique `(record_type, record_id, user_id)`.
- `activities.activity_type` + `email_sent_outlook` (sent from Outlook, not from the system).
- Disconnect deletes the connection row, its subscriptions and the Vault secret. It is not
  a flag. (Revoking the user's sign-in sessions would need `User.RevokeSessions.All`, which
  is outside the delegated scope list; with the refresh token deleted the system holds
  nothing that can act for the user. Decided while implementing phase 1.)

## 5. Send (phase 1)

Implemented inside the existing `send_email` action (one send path, not a new one):
`POST /me/sendMail` with `saveToSentItems: true` — `Mail.Send` only. (The first build drafted with
`POST /me/messages` then sent; that needs `Mail.ReadWrite`, which we do not request, and Graph
answered "Access is denied" in the 2026-09-29 test. Nothing was sent.) The sent copy is then found
in Sent Items (`Mail.Read`) by subject, first recipient and time, and its `conversationId` is stored
on `email_threads`; if it cannot be found the send still stands, only the binding is missing. The activity is `email_draft` / `status: 'sent'`,
so `last_verified_client_contact` counts it with no change. The existing rule holds: **only a
user's click sends**; no AI output or automation can call the send route (it requires the
user's JWT and MFA, same as today). Postmark stays as the path for anyone not connected.

## 6. Capture (phase 2)

**As built (2026-09-29), deviations from the text below:** polling with Graph delta every 5 min
(pg_cron → `outlook-sync`, key in Vault) instead of change notifications + subscriptions — no public
webhook, no renewals, ≤5 min latency; first sync reads 30 days back; mail sent from Outlook is stored
as `email_draft`/`sent` (counts as client contact) instead of a new `email_sent_outlook` type;
dedupe key `imid:<internetMessageId>`; body is Graph `uniqueBody` as text. Plan:
`docs/superpowers/plans/2026-09-29-outlook-capture.md`.

Subscriptions on `me/mailFolders('inbox')/messages` and `('sentitems')` (`created`, basic
notifications, no resource data). On a notification:

1. Fetch headers only (`Mail.ReadBasic`): from, to, cc, subject, `conversationId`, received time.
2. Match every external participant against `contacts.email` (exact) and company domains.
   Excluded: `phc-sa.com`, free-mail domains, messages with sensitivity `private` or the
   Outlook category `Private`.
3. **No match → nothing stored**, as `mail-inbound` today.
4. Match → fetch the body (text, capped at `MAX_BODY`) and write an activity
   (`email_received` or `email_sent_outlook`) on the contact/company.
5. Deal binding, no guessing — first rule that holds wins:
   1. `conversationId` in `email_threads` → that deal;
   2. a project code (`<CODE>-<YY>-<NNNN>`, `rfqs.rfq_number`) in the subject or body that
      matches exactly one RFQ → its opportunity;
   3. the company has exactly one open opportunity → that deal;
   4. else no deal, shown as "choose a deal" on the contact. Choosing binds the whole
      conversation (stored on `email_threads`), so later replies follow rule 1.
6. `missed` lifecycle event or nightly sweep → delta query recovers gaps.

Once Graph capture has run two weeks clean, Postmark reply capture is switched off
(code stays behind its secret, per the existing pattern).

## 6a. Correspondence panel and AI summary (phase 3, user 2026-09-29)

- **Panel** on the opportunity page: the deal's email activities, newest first (direction,
  counterpart, subject, time); each opens its stored text.
- **Who reads it:** whoever can read the deal, through the existing activity RLS — no new
  visibility rule (user's choice A).
- **Summary:** new agent `deal_correspondence_summary` in `ai-orchestrator` (registry, schema,
  prompt builder — no new Edge Function). Context: the deal's last 20 email activities, bodies
  capped, wrapped by `delimitUntrustedContext`. Output: current status, what the client asked,
  what we owe, proposed next step — each point citing the activity id it came from. Stored in
  `ai_agent_outputs` like every agent output; advice only, it changes nothing and cannot send.
- **Freshness (user: "choose the best" → on demand):** runs only on the user's click. The panel
  compares the summary's `created_at` with the newest email activity and shows
  "N new emails since the last summary — refresh". No background AI path.

## 6b. Daily digest (phase 4)

My Workspace gets "Your projects' email since yesterday": the caller's own opportunities with
email activity in the last 24 h — count, latest subject, and whether the summary is stale —
each linking to the deal. A query, not an AI call; summaries are made on the deal page.

## 7. Calendar, two-way (phases 5–6)

`outlook-integration.md` §4.3 deferred two-way sync because a conflict with no rule moves a
meeting nobody moved. These are the rules:

**System → Outlook (phase 5).** Follow-ups and tasks with a due date become events in the
owner's calendar, category `PHC`, carrying the record id in a single-value extended property.
Later system changes update the same event (`calendar_links`). For connected users this
replaces the ICS feed; unconnected users keep the feed.

**Outlook → System (phase 6).** Subscription on `me/events`.

| Change in Outlook | Effect in the system |
|---|---|
| A PHC event moved | Record's due date follows; audited as `calendar.rescheduled` with before/after; owner notified |
| A PHC event renamed / body edited | Ignored; the system owns the title. Not pushed back either |
| A PHC event deleted | Record untouched; link marked `detached_at`; owner asked "remove the task too?" |
| A non-PHC event with a known contact as attendee | Logged as a `meeting` activity on that contact (subject, time, attendees; no body). Deal binding as §6.5 |
| Any other event | Nothing stored |

Loops: a notification whose `changeKey` equals `last_pushed_change_key` is our own write and
is dropped. Simultaneous edits: last writer wins, both versions in the audit log.

## 8. Order and size

| Phase | Scope | Rough size |
|---|---|---|
| 0 | §1–§2 by the user | 15 min + DNS propagation |
| 1 | Connect/disconnect + send | ~1 week |
| 2 | Capture + reply binding | ~1 week |
| 3 | Correspondence panel + AI summary (§6a) | 3–4 days |
| 4 | Daily digest (§6b) | 1–2 days |
| 5 | Calendar system → Outlook | 3–4 days |
| 6 | Calendar Outlook → system | ~1 week |

Each phase ships off behind its secret or flag and follows `deployment-governance.md`.
The USER_GUIDE gets a "Connect Outlook" section in phase 1's PR.

## 9. Tests

- Deno: matching (exact email, domain, excluded domains, private flag), deal binding
  (thread → project code → single open deal → none; a code matching two RFQs binds nothing), notification auth (`clientState`, `validationToken`),
  loop detection, event mapping both ways.
- pgTAP: `mail_connections`, `graph_subscriptions`, `calendar_links` deny every client role;
  `my_mail_connection()` returns only the caller's row.
- E2E: connect as a test rep, send to a test contact, reply, see it on the deal; move the
  event in Outlook, see the due date move.
