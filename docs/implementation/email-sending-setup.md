# Turning on "Send" from the system — setup

The code ships **off**. Until every step below is done, the email window behaves
exactly as before: Open in Outlook, nothing sent from PHC. Nothing here needs
Microsoft 365 admin access. Background: `outlook-integration.md`.

Only a person with access to GoDaddy DNS and the Supabase project can do this.
**Never paste a token into chat, a ticket, a document or source code** — only into
the Supabase secrets screen.

---

## 1. Fix the company mail records first (GoDaddy DNS)

Independent of this feature, and it protects every email PHC sends today.

| Record | Change |
|---|---|
| SPF (`TXT @`) | `v=spf1 include:spf.protection.outlook.com include:secureserver.net -all` |
| DKIM | Microsoft 365 Defender → Email & collaboration → Policies → DKIM → enable for `phc-sa.com`, then publish the two CNAMEs it shows |

Postmark's own records are added in step 3; do not add them yet.

## 2. Create the Postmark account

1. Sign up at postmarkapp.com and create a **Server** named `PHC Command Center`.
2. Use the **Transactional** message stream (named `outbound`). Do not send
   marketing through it.
3. New accounts start in test mode and can only send to their own domain. Request
   approval from inside Postmark before real clients will receive mail.

## 3. Verify the sending domain (GoDaddy DNS)

In Postmark → Sender Signatures → **Add Domain** → `phc-sa.com`. Postmark shows:

| Record | Purpose |
|---|---|
| DKIM — `TXT`, hostname and value **copied exactly from the Postmark page** | Signs mail as `phc-sa.com` |
| Return-Path — `CNAME`, host `pm_bounces` → `pm.mtasv.net` | Aligns SPF for DMARC |

The DKIM hostname is generated per account, so copy it rather than typing a
guess. The Return-Path host uses an **underscore** (`pm_bounces`), not a hyphen.
(Checked against Postmark's domain-verification article, 2026-09-13.)

Add both in GoDaddy and click **Verify** in Postmark. Both must show green.

This does **not** change where `@phc-sa.com` mail is delivered. Mailboxes stay in
Outlook; the MX record is not touched.

## 4. Add the secrets (Supabase)

Supabase dashboard → Project Settings → Edge Functions → **Secrets**:

| Name | Value |
|---|---|
| `POSTMARK_SERVER_TOKEN` | Postmark → Server → API Tokens → **Server API token** |
| `MAIL_FROM_DOMAIN` | `phc-sa.com` |

Leave `MAIL_CAPTURE_DOMAIN` and `MAIL_INBOUND_SECRET` **unset** for now. They switch
on reply capture (§6). Setting the domain before the receiver works would put a
capture address in Reply-To that nothing receives, and clients who reply would get
a bounce — which is why the code refuses to enable capture without the secret.

## 5. Deploy and check

1. Deploy the migration `20260930100000_email_send_from_system.sql` and the
   `sales-os-api` Edge Function (approval-gated — see `deployment-governance.md`).
2. Open any opportunity → email → the window now shows **Send**.
3. Send one email to an address you control. Confirm:
   - it arrives, from your own name and `@phc-sa.com` address;
   - "Reply" goes back to your address;
   - a copy is in your Outlook inbox;
   - the deal's activity timeline shows it as sent.
4. In the received message, view the original headers and confirm
   `dkim=pass` and `dmarc=pass`. If either fails, recheck step 3 before anyone
   else sends.

## 6. Reply capture — client replies attach to the deal

Do this only after steps 1–5 work. It adds a **subdomain** for replies; it does not
change where `@phc-sa.com` mail goes.

1. **Generate a secret** of at least 32 characters with a password manager. It never
   goes into chat, a ticket or code.
2. **Postmark → Servers → PHC Command Center → Inbound stream → Settings:**
   - Inbound domain: `crm.phc-sa.com`
   - Webhook URL: `https://postmark:<SECRET>@<project-ref>.supabase.co/functions/v1/mail-inbound`
     (the username must be exactly `postmark`; attachments are not stored).
3. **GoDaddy DNS:** add an `MX` record for host `crm` → `inbound.postmarkapp.com`,
   priority `10`. This is the capture subdomain only — leave the `@` MX pointing at
   Outlook exactly as it is.
4. **Supabase secrets:**

   | Name | Value |
   |---|---|
   | `MAIL_CAPTURE_DOMAIN` | `crm.phc-sa.com` |
   | `MAIL_INBOUND_SECRET` | the secret from step 1 |

5. **Deploy** migrations `20260930110000` and `20260930120000` (in that order — the
   first adds the activity type the second uses) and the `mail-inbound` function.
   It is configured with `verify_jwt = false`; do not change that, or the gateway
   rejects every reply before the function can check the secret.
6. **Test:** send an email from the system to an address you control, reply to it,
   and within about a minute the reply appears on that deal's timeline as a received
   email. Your reply still arrives in the salesperson's Outlook too.

**What is captured:** replies to emails sent **from the system**. A message a client
starts fresh to someone's Outlook is not captured, and mail that reaches the capture
address without a valid reply id is discarded without being stored.

## Turning it off

- **Sending:** delete `POSTMARK_SERVER_TOKEN`. The Send button disappears on the next
  page load and the window returns to Open in Outlook.
- **Reply capture:** delete `MAIL_INBOUND_SECRET`. New sends stop carrying a capture
  address immediately, and the webhook refuses every request.

Emails and replies already recorded stay on their deals.

## Cost

Postmark prices per volume; credits cover both sending and (later) receiving.
Check the current plan at postmarkapp.com/pricing before choosing a tier.
