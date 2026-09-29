# Outlook Connect + Send (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A salesperson connects their own Outlook mailbox (delegated Microsoft Graph) and the existing Send button sends from that mailbox — landing in their Sent folder — falling back to Postmark for anyone not connected.

**Architecture:** One send path stays one send path: `sales-os-api` `send_email` branches on the caller's `mail_connections` row (Graph) vs. Postmark, after the same refusal checks. OAuth start/status/disconnect are `sales-os-api` actions (JWT + MFA); only the browser redirect target is a new function, `outlook-connector` (`verify_jwt=false`), authenticated by a one-time `state` whose hash is stored server-side with the PKCE verifier. Refresh tokens live in Supabase Vault behind service-role-only SQL functions.

**Tech Stack:** Supabase (Postgres 17, Vault, Edge Functions on Deno), TanStack Start/React, Bun tests, Deno tests, pgTAP.

## Global Constraints

- Delegated permissions only: `User.Read offline_access Mail.ReadBasic Mail.Read Mail.Send Calendars.ReadWrite`. No application permissions.
- Only a user's click sends; no AI/automation path reaches `send_email` (existing `email-send.contract.test.ts` rules keep holding).
- The connected mailbox must be the caller's own: Graph `/me` mail (lower-cased) must equal `profiles.email`; otherwise the connection is refused.
- Sales contributors only (`is_sales_contributor` / `canCreateSalesRecords`); Entra enforces the same with Assignment required + `PHC-Sales-Mail`.
- Tokens never reach the browser, logs, repo or chat. Secrets: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (`GRAPH_CLIENT_STATE` is for phase 2).
- Redirect URI: `https://lrfdtoexyeghrzynapyn.supabase.co/functions/v1/outlook-connector/callback`.
- App return URL after connect: `https://agent.phc-sa.com/settings?outlook=<result>`.
- Deviation from spec §4 (disconnect "revokes sign-in sessions"): that needs `User.RevokeSessions.All`, which is not in the delegated scope list. Deleting the stored refresh token ends the system's access; noted in the spec.

---

### Task 1: Schema — connections, pending OAuth, Vault helpers, Graph threads

**Files:**
- Create: `supabase/migrations/20261002100000_outlook_connect.sql`
- Create: `supabase/tests/outlook_connect_access.test.sql`
- Test: `src/lib/outlook-connect.contract.test.ts` (migration assertions)

**Interfaces — Produces (SQL, all `SECURITY DEFINER`, `service_role` only):**
- `public.save_mail_connection(_user uuid, _ms_user_id text, _email text, _scopes text[], _refresh_token text) returns void` — creates/rotates the Vault secret `mail_refresh_<user>` and upserts `mail_connections` (status `active`).
- `public.mail_refresh_token(_user uuid) returns text` — decrypted token or NULL.
- `public.rotate_mail_refresh_token(_user uuid, _refresh_token text) returns void`.
- `public.mark_mail_connection(_user uuid, _status text, _error text) returns void`.
- `public.delete_mail_connection(_user uuid) returns boolean` — deletes row and Vault secret.
- Tables `mail_connections`, `mail_oauth_pending(state_hash, user_id, code_verifier, expires_at)`; `email_threads.graph_conversation_id`, `token_hash` nullable with `CHECK (token_hash IS NOT NULL OR graph_conversation_id IS NOT NULL)`.

- [ ] Write pgTAP: client roles cannot select/insert/update/delete `mail_connections` or `mail_oauth_pending`; cannot execute the five functions; service role round-trip save → read → rotate → read → delete leaves no Vault secret; email_threads rejects a row with neither key.
- [ ] Write the migration (RLS on, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, grants to `service_role`, restrictive `audit_session_boundary` policies as in `20261001100000`).
- [ ] Verify on a throwaway Postgres with a `vault` stub (as done for Fireflies), then CI pgTAP.
- [ ] Commit.

### Task 2: Pure Graph rules — `_shared/graph.ts`

**Files:**
- Create: `supabase/functions/_shared/graph.ts`, `supabase/functions/_shared/graph.deno-test.ts`

**Interfaces — Produces:**
- `readGraphConfig(get): { configured: boolean; tenantId; clientId; clientSecret; redirectUri }`
- `GRAPH_SCOPES: string` (the delegated list above)
- `newPkce(): Promise<{ verifier: string; challenge: string }>` (S256, 64-char verifier)
- `newOAuthState(): string` + `hashState(state): Promise<string>` (SHA-256 hex)
- `authorizeUrl(cfg, state, challenge, loginHint): string`
- `sameMailbox(graphMail, profileEmail): boolean`
- `toGraphMessage(composed): { subject; body: { contentType: "Text"; content }; toRecipients; ccRecipients }` (from `composeOutbound` output)
- `parseTokenResponse(json): { ok: true; access; refresh | null; scopes: string[] } | { ok: false; reason: "invalid_grant" | "bad_response" }`

- [ ] Deno tests: PKCE challenge = base64url(SHA-256(verifier)); state hash stable, 64 hex; authorize URL has tenant, client_id, response_type=code, code_challenge_method=S256, prompt=select_account, login_hint, redirect_uri, exact scopes; `sameMailbox` case-insensitive, rejects other/empty; `toGraphMessage` maps to/cc; `parseTokenResponse` for success, `invalid_grant`, garbage.
- [ ] Implement; `deno test` green; commit.

### Task 3: Graph I/O — `_shared/graph-client.ts`

**Interfaces — Produces:**
- `exchangeCode(cfg, code, verifier, fetchImpl?)` → `parseTokenResponse` result
- `refreshAccess(cfg, refreshToken, fetchImpl?)` → same
- `getMe(access, fetchImpl?)` → `{ id; mail } | null` (`mail ?? userPrincipalName`)
- `sendAsMe(access, message, fetchImpl?)` → `{ ok: true; messageId; conversationId } | { ok: false; status; error }` — `POST /me/messages` then `POST /me/messages/{id}/send`.
- The only file in the repo containing `graph.microsoft.com` / `login.microsoftonline.com`.

- [ ] Deno tests with a fake `fetch`: token POST is form-encoded with client secret + verifier; send creates draft then sends; draft failure never calls send; returns ids.
- [ ] Implement; commit.

### Task 4: sales-os-api — status, connect start, disconnect; send via Graph

**Files:**
- Create: `supabase/functions/sales-os-api/handlers/outlook.ts` (`outlook_connect_start`, `outlook_disconnect`)
- Modify: `supabase/functions/sales-os-api/handlers/mail.ts` (`mail_status` adds `outlook`; `send_email` branches)
- Modify: `supabase/functions/sales-os-api/index.ts` (register `outlookModule`)
- Test: `src/lib/outlook-connect.contract.test.ts`, update `src/lib/email-send.contract.test.ts`

Behaviour:
- `mail_status` → `{ ok, sending, capture, outlook: { available, connected, email, status } }` (`available` = Graph configured AND caller is a sales contributor).
- `outlook_connect_start` → 503 not configured / 403 not sales contributor; creates PKCE + state, stores `{state_hash, user_id, code_verifier, expires_at = now()+10min}`, returns `{ url }` with `login_hint` = profile email.
- `outlook_disconnect` → `delete_mail_connection(caller)`; audit `outlook.disconnected`.
- `send_email`: steps 2–4 unchanged; then if caller has an `active` connection: compose with `composeOutbound(input, {sending:true, capture:false, fromDomain: <profile email domain>, captureDomain:null}, null)`, refresh access token (rotate if a new refresh token returns; on `invalid_grant` mark `needs_reconnect` and return 409 "Your Outlook connection expired — reconnect it in Settings"), `sendAsMe`, then record the activity exactly as today with `provider_message_id = messageId` and an `email_threads` row `{graph_conversation_id, …}`; response adds `via: "outlook"`. Otherwise the Postmark path, unchanged, `via: "postmark"`. A connection in `needs_reconnect` → the same 409 (never silently switch provider).

- [ ] Contract tests: Graph send happens after `is_sales_contributor`, opportunity check and `composeOutbound`; no `payload.from`; `graph.microsoft.com` only in `graph-client.ts`; handlers registered; send_email still the only send action.
- [ ] Implement; `deno check`; commit.

### Task 5: `outlook-connector` callback function

**Files:**
- Create: `supabase/functions/outlook-connector/index.ts`
- Modify: `supabase/config.toml` (`verify_jwt = false`, comment), `.github/workflows/ci.yml` (deno check list)

Flow (`GET /outlook-connector/callback?code&state` or `?error`): look up and delete `mail_oauth_pending` by `hashState(state)` (expired/unknown → redirect `?outlook=expired`); `error` param → `?outlook=denied`; exchange code; `getMe`; refuse unless `sameMailbox(me.mail, profiles.email)` → `?outlook=wrong_mailbox`; `save_mail_connection`; audit `outlook.connected`; redirect `?outlook=connected`. Every exit is a 302 to the app; nothing about tokens is logged.

- [ ] Contract tests (pending row consumed before exchange; mailbox check before save; config + CI entries; no token in logs).
- [ ] Implement; `deno check`; commit.

### Task 6: Frontend — Settings card and compose label

**Files:**
- Create: `src/components/phc/OutlookConnectionCard.tsx`
- Modify: `src/routes/_authenticated/settings.tsx` (render card; toast from `?outlook=`), `src/lib/mail-actions.ts` (types + `startOutlookConnect`, `disconnectOutlook`), `src/components/phc/EmailComposeModal.tsx` (Send enabled when `sending || outlook.connected`; show "Sends from your Outlook (<email>)"), `src/lib/i18n.tsx`
- Test: extend `src/lib/outlook-connect.contract.test.ts`

- [ ] Card: hidden unless `outlook.available`; Connect → `window.location.assign(url)`; Connected shows email + Disconnect (confirm); `needs_reconnect` shows Reconnect.
- [ ] `bun run verify`; commit.

### Task 7: Docs

- [ ] USER_GUIDE: "Connect your Outlook" (page table + §10 limitations), AI_HANDOFF, CHANGELOG, tasks/current, spec deviation note. Commit, PR.
