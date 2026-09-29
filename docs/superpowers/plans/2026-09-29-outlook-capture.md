# Outlook Capture + Deal Binding (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every 5 minutes, each connected salesperson's Inbox and Sent Items are read through Graph delta; mail with a known client is stored as an activity and bound to its deal by conversation → project code → single open deal → none; unbound mail can be linked to a deal once, which binds the whole conversation.

**Architecture:** A new `outlook-sync` Edge Function (`verify_jwt=false`) is called by pg_cron through pg_net with a key that lives only in Vault (created by the migration; the function compares it through a service-only RPC). Pure matching/binding rules in `_shared/mail-capture.ts`; Graph I/O added to `_shared/graph-client.ts`. Binding a conversation manually is a SECURITY DEFINER RPC reached through `sales-os-api`.

**Tech Stack:** Supabase Postgres (pg_cron, pg_net, Vault), Deno Edge Functions, Bun/Deno/pgTAP tests, React.

## Global Constraints (deviations from spec §6 recorded in the spec)

- Polling with delta every 5 min instead of change notifications + subscriptions (no public webhook, no renewals; ≤5 min latency). `GRAPH_CLIENT_STATE` unused.
- First sync reads from `connected_at − 30 days` (`$filter=receivedDateTime ge …`, `changeType=created`).
- Stored only when a participant matches a known contact (`lower(contacts.email)`) or a company `website_domain`. Excluded domains: `phc-sa.com`, free-mail list. Skipped: drafts, `sensitivity` private/personal, category `Private`.
- Inbound → `email_received`/`logged`; outbound from Outlook → `email_draft`/`sent` (counts as client contact, no new enum).
- Dedupe: `provider_message_id = 'imid:' || internetMessageId` (same across mailboxes); a Sent Items copy of a system send (Graph id already stored) is skipped.
- Body: Graph `uniqueBody` as text, capped at `MAX_BODY`. Logs carry counts/outcomes only.
- Binding: (1) `email_threads.graph_conversation_id`; (2) project codes `[A-Z]{2,3}-\d{2}-\d{4,}` or legacy `([A-Z]{2,3}-)?RFQ-\d{4}-\d{4}` matching exactly one opportunity; (3) the company's single opportunity with `sales_stage` not in (won, lost); (4) none. Rules 2–3 also write an `email_threads` row so later mail follows rule 1.
- Visibility is the existing `can_read_activity`: unbound → owner + pipeline operators; bound → whoever can read the deal.

### Task 1: Schema
`supabase/migrations/20261003100000_outlook_capture.sql`, `supabase/tests/outlook_capture_access.test.sql`
- `activities.email_conversation_id text` + index.
- `mail_sync_state(user_id, folder, delta_link, last_run_at, last_error)` PK (user_id, folder); service only.
- Vault secret `outlook_sync_key` created if missing; `outlook_sync_key_matches(_key text) returns boolean` (service only).
- `bind_email_conversation(_activity_id uuid, _opportunity_id uuid) returns jsonb` — caller must be the activity owner or a pipeline operator and able to read the deal; binds every unbound activity with that conversation id owned by the same user, upserts `email_threads`, audits.
- cron `outlook-sync` every 5 min: `net.http_post` to `…/functions/v1/outlook-sync` with header `x-phc-sync-key` read from Vault at run time. Guarded by extension checks.

### Task 2: Pure rules `_shared/mail-capture.ts` (+ deno tests)
`FREE_MAIL_DOMAINS`, `externalAddresses(msg, ownDomain)`, `shouldSkip(msg)`, `extractProjectCodes(text)`, `pickDeal(candidates)`, `toActivityRow(msg, folder, match, binding, body)`.

### Task 3: Graph I/O
`deltaPage(access, url)`, `initialDeltaUrl(folder, sinceIso)`, `getUniqueBody(access, id)` in `graph-client.ts` (+ fake-fetch tests).

### Task 4: `outlook-sync` function
Auth by key → for each active connection: refresh token (rotate / needs_reconnect) → per folder: follow delta pages (≤10 per run), batch lookups (contacts, companies, threads, rfqs, open opps), insert, store delta link. Config + CI entries, contract tests.

### Task 5: Link to deal (UI)
`sales-os-api` action `bind_email_to_deal`; `CommunicationTimeline` shows email icons and, for an unbound email the caller owns/operates, a "Link to deal" select of the company's opportunities; i18n.

### Task 6: Docs
USER_GUIDE, spec deviations, AI_HANDOFF, CHANGELOG, tasks/current.
