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

Leave `MAIL_CAPTURE_DOMAIN` and `MAIL_INBOUND_SECRET` **unset**. They switch on
reply capture, which ships in a later release; setting the domain now would put a
capture address in Reply-To that nothing receives yet, and clients who reply would
get a bounce. The code refuses to enable capture without the inbound secret, but
leaving both unset is the clear signal.

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

## Turning it off

Delete `POSTMARK_SERVER_TOKEN` from the Supabase secrets. The Send button
disappears on the next page load and the window returns to Open in Outlook.
Emails already sent stay recorded on their deals.

## Cost

Postmark prices per volume; credits cover both sending and (later) receiving.
Check the current plan at postmarkapp.com/pricing before choosing a tier.
