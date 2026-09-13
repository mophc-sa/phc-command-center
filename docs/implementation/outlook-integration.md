# Outlook integration — design and prerequisites

> Status: **design, not built.** Blocked on Microsoft 365 admin access, which is
> undetermined. Nothing below ships until §1 is answered — see §8 for why no code
> is written ahead of it.

Requested 2026-09-13: send from inside the system, capture incoming client email
onto records, and sync the calendar. All three, through the company's Outlook.

---

## 1. What the mailbox actually is — measured, not assumed

"GoDaddy, linked to Outlook" has two meanings that lead to unrelated designs. The
public DNS and Microsoft's discovery endpoints settle it:

| Record | Value | Meaning |
|---|---|---|
| MX | `phcsa-com0i.mail.protection.outlook.com` | Mail is delivered to **Exchange Online** |
| TXT | `MS=ms66464112` | Domain verified in a Microsoft 365 tenant |
| Tenant | `1b17e1ac-5944-4398-860e-4a07ac7c8476` | From the OpenID configuration |
| Realm | `NameSpaceType: Federated`, `AuthURL: sso.godaddy.com` | **Federated with GoDaddy** |

So this is **Microsoft 365 bought through GoDaddy**, not GoDaddy's own mail. The
integration path is **Microsoft Graph**, and every one of the three features needs
it.

**The federation is the blocker.** In a GoDaddy-federated tenant GoDaddy usually
retains the Global Administrator role. Registering an application and setting the
consent policy both sit behind that role. This is the same wall that has held
PR 258 (the SharePoint bridge) dormant since 2026-08-31.

Whether PHC holds Global Admin is **not known**. Finding out takes two minutes —
§6 — and it decides between three paths in §7.

---

## 2. A deliverability defect that exists today, independent of this work

```
SPF    v=spf1 include:secureserver.net -all
DKIM   selector1._domainkey  (absent)
       selector2._domainkey  (absent)
DMARC  p=none; adkim=r; aspf=r
```

SPF authorises only GoDaddy's servers, with a hard fail. Mail from Exchange Online
leaves from Microsoft's IPs, so **it fails SPF, and there is no DKIM to fall back
on**. DMARC `p=none` stops it being rejected — but it is unauthenticated mail, and
receiving filters treat it that way.

This affects every email PHC sends from Outlook now, before any integration. It
also decides whether mail sent through Graph arrives at all, so it is the first
prerequisite, not a footnote.

**Fix (DNS, at GoDaddy — no code):**
1. SPF → `v=spf1 include:spf.protection.outlook.com include:secureserver.net -all`
2. Enable DKIM in the Microsoft 365 Defender portal, then publish the two CNAMEs it
   generates (`selector1._domainkey`, `selector2._domainkey`).
3. After a week of clean DMARC reports to `info@phc-sa.com`, move `p=none` to
   `p=quarantine`.

Keep `include:secureserver.net` until it is confirmed nothing still relays through
GoDaddy; removing it first is how a working sender silently breaks.

---

## 3. The one security decision that shapes everything: delegated, not application

Graph offers two permission models, and they are not two flavours of the same
thing.

| | Delegated | Application |
|---|---|---|
| Acts as | the signed-in salesperson | the system itself |
| `Mail.Read` reaches | **that person's own mailbox** | **every mailbox in the tenant** — including the CEO's |
| Consent | per user, if the tenant policy allows it | admin only |
| Revocable by | the user, or an admin | an admin |

**This design is delegated throughout.** An application-scoped `Mail.Read` grant
turns a sales tool into a way to read the whole company's email, and a credential
leak into a company-wide breach. That trade is never worth making for a CRM.

Scopes requested, and nothing more:

```
User.Read              who connected
Mail.Send              send as themselves
Mail.ReadBasic         headers only, for matching (see §4.2)
Mail.Read              the body — only for messages already matched to a record
Calendars.ReadWrite    their own calendar
offline_access         a refresh token, so sync runs without a live session
```

---

## 4. The three features

### 4.1 Send from inside the system — build first

Smallest surface, highest value, lowest privacy risk.

The existing "Email via Outlook" button (`src/lib/outlook-compose.ts`) opens a
draft in the desktop client and logs `email_draft` / `status: draft`. It never
learns whether the mail was sent — by design, Phase 1.

Phase 2 sends it: the Edge Function calls `POST /me/sendMail` with the user's
token and writes the same `activities` row with **`status: 'sent'`**.

That one field is worth noticing. `last_verified_client_contact` already counts
`email_draft` with `status = 'sent'` as real client contact
(`20260917100000`). So sent mail feeds stale-deal detection **with no schema
change** — and `last_activity_at` is currently filled on 46 of 741 opportunities.

### 4.2 Capture incoming client email — build last

The most privacy-sensitive of the three, so it is narrowest by construction.

- A Graph **change-notification subscription** on the user's inbox posts to an
  Edge Function when a message arrives.
- The function fetches **headers only** (`Mail.ReadBasic`) and matches the sender
  against `contacts.email` and known company domains.
- **No match → nothing is stored.** Not the subject, not a hash, not a count. A
  message from a doctor, a bank or a family member never enters the system.
- Match → the body is fetched and attached to that contact's record as an activity.

Outlook `message` subscriptions last at most **10,080 minutes (under seven
days)** — but only **1,440 minutes (under one day)** if they carry resource data.
This design uses basic notifications and fetches headers afterwards, which is
what keeps the seven-day window, and is also why no message content ever travels
inside a notification payload. (Source: Microsoft Graph `subscription` resource
reference, checked 2026-09-13; an earlier draft of this note said three days from
memory, which is the limit for other resource types.)

Renewal runs on a schedule well inside that window. A lapsed subscription stops
delivering without an error, so the function also sets `lifecycleNotificationUrl`
to receive `reauthorizationRequired`, `subscriptionRemoved` and `missed` events,
and a `missed` event triggers a delta query to recover what was not delivered.

### 4.3 Calendar sync — one-way first

System → Outlook: follow-ups and meetings become events in the owner's calendar
(`POST /me/events`), carrying the record id so an update edits rather than
duplicates.

Two-way sync is deferred deliberately. The moment both sides can edit the same
event, every conflict needs a rule, and a rule nobody chose is a meeting that
moved without anyone moving it.

---

## 5. Architecture

```
Browser ──"Connect Outlook"──▶ Microsoft login (via sso.godaddy.com) ──▶ consent
                                                                            │
                                     authorization code + PKCE ◀────────────┘
                                                │
                                  Edge Function: outlook-connector
                                   ├─ exchanges code → tokens (server side)
                                   ├─ stores refresh token, encrypted (Vault)
                                   └─ never returns a token to the browser
                                                │
                ┌───────────────────────────────┼──────────────────────────────┐
             sendMail                     subscriptions                     /me/events
          activities (sent)         webhook → match → attach           follow-ups → events
```

- **Tokens never reach the browser.** Same rule `ai-orchestrator` follows for
  provider keys (`docs/ai-orchestrator.md`).
- `mail_connections`: one row per user, refresh token encrypted with Supabase
  Vault, RLS denying every client read — only the service role touches it.
- **Disconnect** deletes the row and revokes the grant; it is not a flag.
- Every Graph call is audited with the actor, never with message bodies.

---

## 6. How to find out who holds Global Admin — two minutes

1. Sign in at **https://admin.microsoft.com** with your `@phc-sa.com` account.
2. If it opens: **Roles → Role assignments → Global Administrator** lists who
   holds it.
3. If it refuses, or redirects to a GoDaddy page: GoDaddy holds it.
4. Also check **https://entra.microsoft.com → Identity → Users → User settings →
   "Users can register applications"** and **Enterprise apps → Consent and
   permissions → User consent settings**. Those two settings decide whether the
   delegated design in §3 can proceed without an admin at all.

Screenshots of those two settings answer more than any description of them.

---

## 7. Three paths, by what §6 finds

| Finding | Path | Cost |
|---|---|---|
| **PHC holds Global Admin** | Register the app, set consent, build §4 in order | Build only |
| **GoDaddy holds it, user consent allowed** | Delegated flow works per user; app registration via GoDaddy support | One support ticket |
| **GoDaddy holds it, consent locked** | Ask GoDaddy to grant admin consent, **or** defederate the tenant from GoDaddy | Defederation is a real infrastructure change: licences, billing and DNS move. A business decision, not a technical one |

---

## 8. Why no code is written yet

PR 258 is the precedent. It built a Graph integration ahead of access, and has
been open and dormant for two weeks; merging it would ship "a table nobody writes
to and a function returning 501". Code written before §6 is answered is either
that again or, worse, merged and pretending to work.

The design is complete enough that implementation starts the day access is
confirmed, in this order:

1. DNS fix (§2) — can happen today, independently
2. App registration and consent (§6–§7)
3. Send (§4.1)
4. Calendar, one-way (§4.3)
5. Capture incoming (§4.2)
