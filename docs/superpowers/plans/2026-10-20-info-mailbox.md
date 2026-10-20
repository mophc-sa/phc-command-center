# info@ Mailbox (Part B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read info@phc-sa.com every 5 minutes. Turn RFQs and quotation requests into assigned intake items with the request data extracted. List everything else for a person to forward. Show the source email on the project, with an Outlook link. Route the client's later replies to the people on the project. Add CC and @mention to the send window.

**Architecture:** The app reads one mailbox with an app-only Graph token. Exchange limits that token to info@ ("RBAC for Applications"), and no Mail permission is added in Entra. The existing `outlook-sync` cron function gets a second pass (`info-pass.ts`). It stores each message in a new `info_mail` table and asks `ai-orchestrator` to classify it. That makes the orchestrator's first *service* caller: it is authenticated by the same Vault key the cron already holds, it may only run agents marked `serviceCallable`, and it is billed to the info@ profile. Every database decision (owner, intake item, reply binding, notifications) is a SECURITY DEFINER SQL function, tested with pgTAP. The browser gets a router list on the Lead & Tender Inbox page, a Source email panel on the deal, and an @mention field in the send window.

**Tech Stack:** Supabase (Postgres, pgTAP, pg_cron, Edge Functions on Deno), Microsoft Graph, React + TanStack, bun:test, Deno tests.

**Spec:** `docs/superpowers/specs/2026-10-19-manager-actions-info-mail-design.md`, Part B. Read §B1–B5 first.

**Deviations from the spec, decided while planning (facts in `.superpowers/sdd/planB-facts.md` in the worktree; research notes):**
1. **No `ORCHESTRATOR_SERVICE_KEY` secret.** The orchestrator checks the service caller with the existing `outlook_sync_key_matches` RPC, the Vault key the cron job already sends to `outlook-sync`. One key, already rotated by the same migration pattern.
2. **The service caller is the info@ profile.** `reserve_ai_usage` and `ai_agent_outputs.requested_by` need a real active user. The info@ profile (active, viewer role, the board's screen account) is that user. A new usage kind, `mailbox`, caps it at 300 a day.
3. **An info@ conversation is bound to its deal through `info_mail` itself** (`conversation_id` → `opportunity_id`), not `email_threads`. Graph conversation ids are per mailbox, and `email_threads` is keyed per owner mailbox.
4. **Conversion stays in the browser** (`markConverted`), which then calls one new RPC, `info_mail_link_conversion`, to bind the mail to the new deal.
5. **"This is an RFQ" does not re-run the AI.** It fetches the full message from Graph, stores the text, and creates the intake item from the sender and subject. The reviewer completes the fields in the normal intake review.
6. **Notifications reuse the intake triggers.** A new `inbox_items` row already notifies the reviewer roles (`intake_review_requested`), and a later `assigned_owner_id` update notifies the owner (`intake_assigned`). New notification types: `client_reply`, `mention`, `info_mail_forwarded` (`notification_type` is plain text, so no migration is needed for them).
7. **The router list is a panel at the top of the Lead & Tender Inbox page**, not a tab (the page has no tabs). Routers = `is_pipeline_operator` (`canManageSalesPipeline` in the UI).

## Global Constraints

- Work in a new worktree `~/dev/phc-g3b` on branch `feat/info-mailbox`, cut from `feat/manager-actions` (Part A). Push via `mophc-sa`, then switch back to `moalagab`.
- **Migrations:** `20261024090000_inbox_source_info_mailbox.sql` (enum value only) and `20261024100000_info_mailbox.sql`. Group 4 took `20261022100000`, #352 took `20261023100000`. Both must sort after every migration on `main` at PR time; rename them if needed. `db push` happens only with Mo's approval, never on merge.
- Only `supabase/functions/_shared/graph-client.ts` may contain `graph.microsoft.com`. No browser code may mention `mail_refresh_token`, `mail_connections`, `MS_CLIENT_SECRET`, `code_verifier` or `x-phc-sync-key`.
- Privacy: `info_mail.body_text` is kept only for `unclassified` (until triage), `rfq`, `quotation_request` and `client_reply`. It is cleared after 3 failed triage attempts. Logs carry counts and outcomes, never an address, subject or body.
- Nothing is forwarded automatically. Only a router's click forwards, and only to an active `@phc-sa.com` colleague.
- The intake threshold is **confidence ≥ 0.7**, in one SQL place (`info_mail_apply_triage`).
- Bilingual UI strings; no Arabic-Indic digits (U+0660–U+0669) in source; never a bare `"ar"`/`"ar-SA"` locale.
- New Edge entrypoints: none (`outlook-sync`, `ai-orchestrator` and `sales-os-api` already exist).
- `src/integrations/supabase/types.ts` is generated but stale; patch it by hand for the new table, enum value and RPCs, as earlier phases did.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261024090000_inbox_source_info_mailbox.sql` (new) | `inbox_source_type` + `info_mailbox` |
| `supabase/migrations/20261024100000_info_mailbox.sql` (new) | `info_mail`, `info_mailbox_state`, usage kind, owner rule, triage/reply/forward/promote/dismiss/link/mention functions, cron job |
| `supabase/tests/info_mailbox.test.sql` (new) | pgTAP for the above |
| `src/integrations/supabase/types.ts` | Hand patch: table, enum value, RPCs |
| `supabase/functions/_shared/info-mail.ts` (new) | Pure rules: message shape, internal sender, auto-reply, body cap |
| `supabase/functions/_shared/info-mail.deno-test.ts` (new) | Deno tests for it |
| `supabase/functions/_shared/graph-client.ts` | + `appAccess`, `mailboxDeltaUrl`, `getMailboxMessage`, `forwardMailboxMessage` |
| `supabase/functions/_shared/graph.deno-test.ts` | + tests for those |
| `supabase/functions/_shared/ai-schemas.ts`, `ai-guardrails.ts`, `ai-prompts.ts`, `ai-agent-registry.ts` | Agent `info_mail_triage`, entity type `info_mail`, `serviceCallable` |
| `supabase/functions/ai-orchestrator/index.ts` | Service caller path |
| `supabase/functions/_shared/ai-info-mail.deno-test.ts` (new) | Registry/context tests |
| `supabase/functions/outlook-sync/info-pass.ts` (new) + `index.ts` | The info@ pass and its dispatch |
| `supabase/functions/sales-os-api/handlers/info-mail.ts` (new) + `index.ts` | `info_mail_forward`, `info_mail_mark_rfq` |
| `supabase/functions/sales-os-api/handlers/mail.ts` | `send_email` accepts `mentions` |
| `src/lib/info-mail-actions.ts` (new) | Browser calls |
| `src/lib/info-mail.contract.test.ts` (new) | Source-reading contract tests |
| `src/components/phc/InfoMailPanel.tsx` (new) | Router list on the inbox page |
| `src/components/phc/SourceEmailPanel.tsx` (new) | Source email on the deal page |
| `src/routes/_authenticated/lead-tender-inbox.tsx`, `src/components/phc/IntakeReviewPanel.tsx`, `src/routes/_authenticated/opportunities.$id.tsx`, `src/lib/inbox-actions.ts`, `src/components/phc/EmailComposeModal.tsx`, `src/lib/mail-actions.ts`, `src/lib/i18n.tsx`, `src/components/phc/NotificationCenter.tsx` | Wiring |
| `docs/info-mailbox-setup.md` (new), `docs/USER_GUIDE.md`, `docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/AI_HANDOFF.md`, `tasks/current.md` | Docs |

---

### Task 0: Worktree

- [ ] **Step 1**

```bash
cd ~/dev/phc-command-center
git fetch origin
git worktree add -b feat/info-mailbox ~/dev/phc-g3b feat/manager-actions
cd ~/dev/phc-g3b && bun install --frozen-lockfile && bun run test 2>&1 | tail -2 && bun run test:deno 2>&1 | tail -2
ls supabase/migrations | tail -3
```
Expected: the tests are green. The newest migration sorts before `20261024090000`. If it doesn't, bump both new timestamps past it and use the new names everywhere below.

---

### Task 1: Database (migrations, pgTAP, generated types)

**Files:**
- Create: `supabase/migrations/20261024090000_inbox_source_info_mailbox.sql`, `supabase/migrations/20261024100000_info_mailbox.sql`, `supabase/tests/info_mailbox.test.sql`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces (Produces; later tasks call these by these exact names):**
- Table `public.info_mail` (columns below); table `public.info_mailbox_state` (single row, `id = true`).
- Service-role only: `info_mail_owner_for(_from_email text) → uuid`, `info_mail_create_intake(_mail_id uuid, _fields jsonb) → uuid`, `info_mail_apply_triage(_mail_id uuid, _category text, _confidence numeric, _summary text, _fields jsonb) → text` ('intake_created' | 'listed' | 'skipped'), `info_mail_triage_failed(_mail_id uuid) → void`, `info_mail_record_reply(_mail_id uuid, _parent_id uuid) → void`, `info_mail_record_forward(_id uuid, _to uuid, _by uuid) → void`, `info_mail_promote(_id uuid, _by uuid, _body text) → uuid`.
- Authenticated: `info_mail_dismiss(_id uuid) → void`, `info_mail_link_conversion(_inbox_item_id uuid) → integer`, `notify_mentions(_activity_id uuid, _users uuid[]) → integer`.
- `ai_usage_limits` row `('mailbox', 300, 300)`.
- Cron job `info-mailbox-sync`, every 5 minutes, POST to `outlook-sync` with body `{"mailbox":"info"}` and the `x-phc-sync-key` header.

- [ ] **Step 1: Enum migration**

```sql
-- supabase/migrations/20261024090000_inbox_source_info_mailbox.sql
-- Intake items read from the info@phc-sa.com mailbox (manager feedback
-- 2026-10-19, group 3 part B). Its own migration: a new enum value cannot be
-- used in the same transaction that adds it (see 20260922100000).
ALTER TYPE public.inbox_source_type ADD VALUE IF NOT EXISTS 'info_mailbox';
```

- [ ] **Step 2: Write the pgTAP test first**

Copy the user-fixture style from `supabase/tests/outlook_connect_access.test.sql`. Use the `2d…` UUID prefix and a transaction that rolls back. Before writing the fixture inserts, read the NOT NULL columns of `companies`, `contacts`, `opportunities` and `activities` in `src/integrations/supabase/types.ts` (`Insert` types) and fill every required one.

```sql
-- supabase/tests/info_mailbox.test.sql
-- The info@ mailbox: who reads it, what is kept, and how a message becomes an
-- intake item, a reply on a deal, or a forward. Test user UUIDs use 2d…; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Users: a manager (pipeline operator), a rep (salesperson), a second rep.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000001','authenticated','authenticated','mgr+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000002','authenticated','authenticated','rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000003','authenticated','authenticated','rep2+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '2d000000-%';
insert into public.user_roles (user_id, role) values
  ('2d000000-0000-0000-0000-000000000001','sales_manager'),
  ('2d000000-0000-0000-0000-000000000002','salesperson'),
  ('2d000000-0000-0000-0000-000000000003','salesperson');

-- A client company owned by rep 1, with a contact.
insert into public.companies (id, name, account_owner_id, website_domain)
  values ('2d0000c0-0000-0000-0000-000000000001','Acme Build','2d000000-0000-0000-0000-000000000002','acme.example');
insert into public.contacts (id, name, email, company_id)
  values ('2d0000c1-0000-0000-0000-000000000001','Sara','sara@acme.example','2d0000c0-0000-0000-0000-000000000001');

-- 1-2. Owner rule
select is(public.info_mail_owner_for('Sara@Acme.example'), '2d000000-0000-0000-0000-000000000002'::uuid,
  'A known contact maps to the account owner');
select is(public.info_mail_owner_for('someone@gmail.com'), null::uuid, 'Free mail never maps to an owner');

-- 3. Body privacy CHECK
select throws_ok($$insert into public.info_mail (graph_message_id, received_at, category, body_text)
                   values ('g-hr', now(), 'hr', 'a CV')$$, '23514', null,
  'An HR message cannot keep its text');

-- Messages
insert into public.info_mail (id, graph_message_id, internet_message_id, conversation_id, from_email, from_name, subject, received_at, body_text, web_link) values
  ('2d0000a0-0000-0000-0000-000000000001','g-1','<m1@acme>','conv-1','sara@acme.example','Sara','RFQ - Diriyah villas', now(), 'Please quote signage for 40 villas in Diriyah. RFQ-ACM-77.', 'https://outlook.office365.com/owa/?ItemID=1'),
  ('2d0000a0-0000-0000-0000-000000000002','g-2','<m2@x>','conv-2','cv@gmail.com','Ali','CV - site engineer', now(), 'My CV', null),
  ('2d0000a0-0000-0000-0000-000000000003','g-3','<m3@y>','conv-3','buyer@unknown.example','Omar','Quotation request', now(), 'Need a price', null);

-- 4-6. Triage: a confident RFQ from a known client becomes an assigned intake item
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000001','rfq',0.92,'Signage for 40 villas',
  '{"company":"Acme Build","project_name":"Diriyah villas","location":"Diriyah","client_rfq_ref":"RFQ-ACM-77","estimated_value":"1200000","scope":"Wayfinding signage"}'::jsonb),
  'intake_created', 'A confident RFQ creates an intake item');
select results_eq($$select source_type::text, assigned_owner_id, created_by, client_rfq_reference, location
                    from public.inbox_items i join public.info_mail m on m.inbox_item_id = i.id
                   where m.id = '2d0000a0-0000-0000-0000-000000000001'$$,
  $$values ('info_mailbox', '2d000000-0000-0000-0000-000000000002'::uuid, '2d000000-0000-0000-0000-000000000002'::uuid, 'RFQ-ACM-77', 'Diriyah')$$,
  'The item carries the extracted data and the account owner');
select ok(exists(select 1 from public.notifications where recipient_user_id = '2d000000-0000-0000-0000-000000000002'
                   and notification_type = 'intake_assigned'), 'The owner is notified');

-- 7. Non-request mail drops its text
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000002','hr',0.95,'A CV for a site engineer post','null'::jsonb),
  'listed', 'An HR message is listed');
select is((select body_text from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000002'), null,
  'Its text is gone');

-- 9. An unsure request is listed with its text kept, and no item
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000003','quotation_request',0.5,'Asks for a price','{}'::jsonb),
  'listed', 'Below 0.7 the request waits for a person');

-- 10. Triage runs once
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000003','spam',0.9,'x','{}'::jsonb),
  'skipped', 'A classified message is not classified again');

-- 11. Three failed triage attempts drop the text
insert into public.info_mail (id, graph_message_id, received_at, body_text) values ('2d0000a0-0000-0000-0000-000000000004','g-4', now(), 'text');
select public.info_mail_triage_failed('2d0000a0-0000-0000-0000-000000000004');
select public.info_mail_triage_failed('2d0000a0-0000-0000-0000-000000000004');
select public.info_mail_triage_failed('2d0000a0-0000-0000-0000-000000000004');
select is((select body_text from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000004'), null,
  'After three failures the text is dropped');

-- 12-13. Clients cannot write; a rep cannot read mail that is not theirs
set local role authenticated;
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}';
select throws_ok($$insert into public.info_mail (graph_message_id, received_at) values ('g-x', now())$$, '42501', null,
  'Nobody writes info_mail from the browser');
select is((select count(*)::int from public.info_mail), 0, 'Rep 2 sees none of it');

-- 14. The routing rep reads the item's mail
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}';
select is((select count(*)::int from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000001'), 1,
  'The assigned rep reads the source email of their item');

-- 15. Only routers dismiss
select throws_ok($$select public.info_mail_dismiss('2d0000a0-0000-0000-0000-000000000003')$$, '42501', null,
  'A rep cannot dismiss info@ mail');

-- 16. A manager dismisses
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select lives_ok($$select public.info_mail_dismiss('2d0000a0-0000-0000-0000-000000000003')$$, 'A manager can dismiss');
reset role;
-- Back to the service role with no signed-in user: emit_notification skips the
-- caller as a recipient, so a lingering manager identity would hide one notice.
set local request.jwt.claims = '{}';

-- 17-18. A client reply on a converted item lands on the deal and notifies its people
insert into public.opportunities (id, project_name, stage, sales_stage, owner_id, company_id)
  values ('2d0000b0-0000-0000-0000-000000000001','Diriyah villas','quotation','rfq_received','2d000000-0000-0000-0000-000000000001','2d0000c0-0000-0000-0000-000000000001');
update public.inbox_items set status = 'converted', converted_record_type = 'opportunity', converted_record_id = '2d0000b0-0000-0000-0000-000000000001'
 where id = (select inbox_item_id from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000001');
update public.info_mail set opportunity_id = '2d0000b0-0000-0000-0000-000000000001' where id = '2d0000a0-0000-0000-0000-000000000001';
insert into public.info_mail (id, graph_message_id, internet_message_id, conversation_id, from_email, subject, received_at, body_text)
  values ('2d0000a0-0000-0000-0000-000000000005','g-5','<m5@acme>','conv-1','sara@acme.example','RE: RFQ - Diriyah villas', now(), 'Any update?');
select public.info_mail_record_reply('2d0000a0-0000-0000-0000-000000000005','2d0000a0-0000-0000-0000-000000000001');
select ok(exists(select 1 from public.activities where related_opportunity_id = '2d0000b0-0000-0000-0000-000000000001'
                   and activity_type = 'email_received' and provider_message_id = 'imid:<m5@acme>'), 'The reply is on the deal');
select is((select count(distinct recipient_user_id)::int from public.notifications where notification_type = 'client_reply'), 2,
  'The deal owner and the item owner are told');

select * from finish();
rollback;
```

- [ ] **Step 3: Run it and see it fail**

Run: `supabase test db --file supabase/tests/info_mailbox.test.sql 2>&1 | tail -20` (or `bun run test:db:behaviour` if the local stack has no `--file` support. That script is known to fail early at `20261003100000`'s `gen_random_bytes`; if so, rely on CI's pgTAP run and say so in the report).
Expected: FAIL. `info_mail` does not exist.

- [ ] **Step 4: Write the main migration**

```sql
-- supabase/migrations/20261024100000_info_mailbox.sql
-- =============================================================================
-- The info@phc-sa.com mailbox (manager feedback 2026-10-19, group 3 part B).
-- Spec: docs/superpowers/specs/2026-10-19-manager-actions-info-mail-design.md §B2–B3
-- Plan: docs/superpowers/plans/2026-10-20-info-mailbox.md
--
-- outlook-sync reads info@ every five minutes with an app-only token that
-- Exchange limits to that one mailbox, stores each message here, and asks the
-- orchestrator to classify it. Everything that decides something — the owner,
-- the intake item, a reply on a deal, a forward — is a function in this file.
--
-- WHAT THIS FILE REFUSES TO DO
-- - Keep the text of mail that is not a request or a reply (CVs, invoices).
-- - Let the browser write here. Routers act through the RPCs below.
-- - Guess an owner. A sender maps to one account owner or to nobody.
-- =============================================================================

-- 1. Messages ---------------------------------------------------------------
CREATE TABLE public.info_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_message_id text NOT NULL UNIQUE,
  internet_message_id text,
  conversation_id text,
  from_email text,
  from_name text,
  subject text,
  received_at timestamptz NOT NULL,
  category text NOT NULL DEFAULT 'unclassified'
    CHECK (category IN ('unclassified','rfq','quotation_request','client_reply','supplier','finance','hr','general','spam')),
  confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  summary text CHECK (summary IS NULL OR length(summary) <= 400),
  body_text text CHECK (body_text IS NULL OR length(body_text) <= 20000),
  attachment_names text[] NOT NULL DEFAULT '{}',
  web_link text CHECK (web_link IS NULL OR web_link ~ '^https://outlook\.office(365)?\.com/'),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','intake_created','forwarded','dismissed','attached')),
  triage_attempts smallint NOT NULL DEFAULT 0,
  inbox_item_id uuid REFERENCES public.inbox_items(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  forwarded_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Privacy: only a request or a reply keeps its text; unclassified keeps it
  -- only until triage (or three failed attempts) decides.
  CONSTRAINT info_mail_body_only_for_requests
    CHECK (body_text IS NULL OR category IN ('unclassified','rfq','quotation_request','client_reply'))
);
CREATE INDEX info_mail_conversation_idx ON public.info_mail (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX info_mail_inbox_item_idx ON public.info_mail (inbox_item_id) WHERE inbox_item_id IS NOT NULL;
CREATE INDEX info_mail_opportunity_idx ON public.info_mail (opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX info_mail_open_idx ON public.info_mail (received_at DESC) WHERE status = 'new';

ALTER TABLE public.info_mail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.info_mail FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.info_mail TO authenticated;
GRANT ALL ON public.info_mail TO service_role;

-- Routers read everything; a deal's readers read its source mail; an intake
-- item's owner and creator read the mail it came from.
CREATE POLICY info_mail_readers ON public.info_mail FOR SELECT TO authenticated USING (
  public.is_pipeline_operator(auth.uid())
  OR (opportunity_id IS NOT NULL AND public.can_read_boq(opportunity_id, auth.uid()))
  OR (inbox_item_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.inbox_items i
         WHERE i.id = info_mail.inbox_item_id
           AND auth.uid() IN (i.assigned_owner_id, i.created_by)))
);
DROP POLICY IF EXISTS audit_session_boundary ON public.info_mail;
CREATE POLICY audit_session_boundary ON public.info_mail AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- 2. Where the last read stopped ---------------------------------------------
CREATE TABLE public.info_mailbox_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  delta_link text,
  last_run_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500)
);
INSERT INTO public.info_mailbox_state (id) VALUES (true);
ALTER TABLE public.info_mailbox_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.info_mailbox_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.info_mailbox_state TO service_role;
DROP POLICY IF EXISTS audit_session_boundary ON public.info_mailbox_state;
CREATE POLICY audit_session_boundary ON public.info_mailbox_state AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- 3. A daily AI budget for the mailbox, apart from people's own -----------------
INSERT INTO public.ai_usage_limits VALUES ('mailbox', 300, 300) ON CONFLICT (kind) DO NOTHING;

-- 4. Who owns a sender: a known contact's company, else the one company that
--    holds the domain. Two answers is no answer. ------------------------------
CREATE OR REPLACE FUNCTION public.info_mail_owner_for(_from_email text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  addr text := lower(btrim(coalesce(_from_email, '')));
  dom text;
  owners uuid[];
BEGIN
  IF addr = '' OR position('@' in addr) = 0 THEN RETURN NULL; END IF;
  dom := split_part(addr, '@', 2);

  SELECT array_agg(DISTINCT c.account_owner_id) INTO owners
    FROM public.contacts k JOIN public.companies c ON c.id = k.company_id
   WHERE lower(k.email) = addr AND k.archived_at IS NULL AND c.archived_at IS NULL;
  IF owners IS NOT NULL THEN
    IF array_length(owners, 1) = 1 AND owners[1] IS NOT NULL AND public.is_active_user(owners[1]) THEN
      RETURN owners[1];
    END IF;
    RETURN NULL;
  END IF;

  IF public.is_free_mail_domain(dom) OR dom = 'phc-sa.com' OR dom LIKE '%.phc-sa.com' THEN RETURN NULL; END IF;
  SELECT array_agg(DISTINCT c.account_owner_id) INTO owners
    FROM public.companies c
   WHERE lower(c.website_domain) = dom AND c.archived_at IS NULL;
  IF array_length(owners, 1) = 1 AND owners[1] IS NOT NULL AND public.is_active_user(owners[1]) THEN
    RETURN owners[1];
  END IF;
  RETURN NULL;
END $$;

-- 5. A message → an intake item (once). Unassigned items reach the reviewers
--    through trg_notify_inbox_intake_events; the owner, through the
--    assigned_owner_id update below (intake_assigned). ------------------------
CREATE OR REPLACE FUNCTION public.info_mail_create_intake(_mail_id uuid, _fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.info_mail;
  f jsonb := CASE WHEN jsonb_typeof(_fields) = 'object' THEN _fields ELSE '{}'::jsonb END;
  owner uuid;
  item uuid;
  value_text text := btrim(coalesce(f->>'estimated_value', ''));
  deadline_text text := btrim(coalesce(f->>'deadline', ''));
  deadline_val date;
  notes text;
BEGIN
  SELECT * INTO m FROM public.info_mail WHERE id = _mail_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'info mail not found' USING ERRCODE = 'P0002'; END IF;
  IF m.inbox_item_id IS NOT NULL THEN RETURN m.inbox_item_id; END IF;

  owner := public.info_mail_owner_for(m.from_email);
  IF deadline_text ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN deadline_val := deadline_text::date; EXCEPTION WHEN others THEN deadline_val := NULL; END;
  END IF;
  notes := concat_ws(E'\n',
    'From info@: ' || coalesce(m.summary, m.subject, ''),
    CASE WHEN cardinality(m.attachment_names) > 0
         THEN 'Attachments: ' || array_to_string(m.attachment_names, ', ') END);

  INSERT INTO public.inbox_items (
    source_type, source_name, company_name, contact_name, phone, email, project_name,
    location, scope, estimated_value, deadline, client_rfq_reference, notes, evidence_url,
    classification, request_type, created_by)
  VALUES (
    'info_mailbox', left(coalesce(nullif(btrim(m.from_name), ''), m.from_email), 200),
    nullif(btrim(f->>'company'), ''),
    coalesce(nullif(btrim(f->>'contact_name'), ''), nullif(btrim(m.from_name), '')),
    nullif(btrim(f->>'phone'), ''),
    coalesce(nullif(btrim(f->>'email'), ''), m.from_email),
    left(coalesce(nullif(btrim(f->>'project_name'), ''), m.subject, 'info@ request'), 300),
    nullif(btrim(f->>'location'), ''),
    nullif(btrim(f->>'scope'), ''),
    CASE WHEN value_text ~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' THEN value_text::numeric END,
    deadline_val,
    nullif(btrim(f->>'client_rfq_ref'), ''),
    notes,
    m.web_link,
    'rfq', 'unknown', owner)
  RETURNING id INTO item;

  UPDATE public.info_mail SET inbox_item_id = item, status = 'intake_created' WHERE id = _mail_id;
  IF owner IS NOT NULL THEN
    UPDATE public.inbox_items SET assigned_owner_id = owner WHERE id = item;
  END IF;
  RETURN item;
END $$;

-- 6. The orchestrator's verdict. 0.7 is the one place the threshold lives. ----
CREATE OR REPLACE FUNCTION public.info_mail_apply_triage(
  _mail_id uuid, _category text, _confidence numeric, _summary text, _fields jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_request boolean := _category IN ('rfq', 'quotation_request');
BEGIN
  IF _category IS NULL OR _category NOT IN ('rfq','quotation_request','supplier','finance','hr','general','spam') THEN
    RAISE EXCEPTION 'unknown category' USING ERRCODE = '22023';
  END IF;
  UPDATE public.info_mail
     SET category = _category,
         confidence = greatest(0, least(1, coalesce(_confidence, 0))),
         summary = left(_summary, 400),
         body_text = CASE WHEN is_request THEN body_text END,
         triage_attempts = triage_attempts + 1
   WHERE id = _mail_id AND category = 'unclassified';
  IF NOT FOUND THEN RETURN 'skipped'; END IF;
  IF is_request AND coalesce(_confidence, 0) >= 0.7 THEN
    PERFORM public.info_mail_create_intake(_mail_id, _fields);
    RETURN 'intake_created';
  END IF;
  RETURN 'listed';
END $$;

CREATE OR REPLACE FUNCTION public.info_mail_triage_failed(_mail_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.info_mail
     SET triage_attempts = triage_attempts + 1,
         body_text = CASE WHEN triage_attempts + 1 >= 3 THEN NULL ELSE body_text END
   WHERE id = _mail_id AND category = 'unclassified';
$$;

-- 7. A later message in a known conversation: on the deal, and its people told.
CREATE OR REPLACE FUNCTION public.info_mail_record_reply(_mail_id uuid, _parent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.info_mail;
  p public.info_mail;
  opp public.opportunities;
  item public.inbox_items;
  r uuid;
  told int := 0;
BEGIN
  SELECT * INTO m FROM public.info_mail WHERE id = _mail_id FOR UPDATE;
  SELECT * INTO p FROM public.info_mail WHERE id = _parent_id;
  IF m.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'info mail not found' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.info_mail
     SET category = 'client_reply', status = 'attached',
         inbox_item_id = p.inbox_item_id, opportunity_id = p.opportunity_id
   WHERE id = _mail_id;

  IF p.inbox_item_id IS NOT NULL THEN SELECT * INTO item FROM public.inbox_items WHERE id = p.inbox_item_id; END IF;
  IF p.opportunity_id IS NOT NULL THEN
    SELECT * INTO opp FROM public.opportunities WHERE id = p.opportunity_id;
    BEGIN
      INSERT INTO public.activities (
        activity_type, status, summary, draft_content, occurred_at, owner_id, created_by,
        related_opportunity_id, company_id, provider_message_id, email_conversation_id, email_from)
      VALUES (
        'email_received', 'logged', left(coalesce(m.subject, ''), 300), m.body_text, m.received_at,
        coalesce(opp.owner_id, item.assigned_owner_id), coalesce(opp.owner_id, item.assigned_owner_id),
        opp.id, opp.company_id,
        CASE WHEN m.internet_message_id IS NOT NULL THEN 'imid:' || m.internet_message_id END,
        m.conversation_id, m.from_email);
    EXCEPTION WHEN unique_violation THEN NULL;  -- a rep's own capture got there first
    END;
  END IF;

  FOR r IN SELECT DISTINCT x FROM unnest(ARRAY[opp.owner_id, item.assigned_owner_id, item.created_by]) AS x WHERE x IS NOT NULL LOOP
    PERFORM public.emit_notification(
      r, 'client_reply',
      CASE WHEN opp.id IS NOT NULL THEN 'opportunity' ELSE 'inbox_item' END,
      coalesce(opp.id, item.id),
      left(coalesce(m.subject, 'Client reply'), 200),
      'The client wrote again to info@.',
      'attention', 'info_mail.client_reply', m.id::text,
      CASE WHEN opp.id IS NOT NULL THEN jsonb_build_object('opportunity_id', opp.id) END);
    told := told + 1;
  END LOOP;
  IF told = 0 THEN
    PERFORM public.emit_notification_to_roles(
      ARRAY['sales_manager']::public.app_role[], 'client_reply',
      CASE WHEN opp.id IS NOT NULL THEN 'opportunity' ELSE 'inbox_item' END,
      coalesce(opp.id, item.id), left(coalesce(m.subject, 'Client reply'), 200),
      'The client wrote again to info@.', 'attention', 'info_mail.client_reply', m.id::text, NULL);
  END IF;
END $$;

-- 8. Router actions ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.info_mail_dismiss(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL OR NOT public.is_pipeline_operator(u) THEN
    RAISE EXCEPTION 'Only sales managers, BD and sales ops route info@ mail' USING ERRCODE = '42501';
  END IF;
  UPDATE public.info_mail SET status = 'dismissed', handled_by = u, handled_at = now()
   WHERE id = _id AND status = 'new' AND inbox_item_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This message was already handled' USING ERRCODE = 'P0002'; END IF;
END $$;

-- Called by sales-os-api after Graph accepted the forward (the caller's role was
-- checked there, as the caller).
CREATE OR REPLACE FUNCTION public.info_mail_record_forward(_id uuid, _to uuid, _by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.info_mail;
BEGIN
  UPDATE public.info_mail SET status = 'forwarded', forwarded_to = _to, handled_by = _by, handled_at = now()
   WHERE id = _id AND status = 'new' RETURNING * INTO m;
  IF m.id IS NULL THEN RAISE EXCEPTION 'This message was already handled' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.emit_notification(
    _to, 'info_mail_forwarded', 'system', NULL, left(coalesce(m.subject, 'Email from info@'), 200),
    'Forwarded to your Outlook from info@.', 'info', 'info_mail.forwarded', m.id::text, NULL);
END $$;

-- "This is an RFQ": the full text, fetched again from Graph by sales-os-api.
CREATE OR REPLACE FUNCTION public.info_mail_promote(_id uuid, _by uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.info_mail
     SET category = 'rfq', confidence = 1, body_text = left(_body, 20000), handled_by = _by, handled_at = now()
   WHERE id = _id AND status = 'new' AND inbox_item_id IS NULL AND category <> 'client_reply';
  IF NOT FOUND THEN RAISE EXCEPTION 'This message was already handled' USING ERRCODE = 'P0002'; END IF;
  RETURN public.info_mail_create_intake(_id, '{}'::jsonb);
END $$;

-- 9. Conversion happens in the browser (inbox-actions.ts markConverted); this
--    binds the item's mail to the deal it became. ----------------------------
CREATE OR REPLACE FUNCTION public.info_mail_link_conversion(_inbox_item_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); item public.inbox_items; n integer;
BEGIN
  IF u IS NULL OR NOT public.is_active_user(u) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO item FROM public.inbox_items WHERE id = _inbox_item_id;
  IF NOT FOUND OR item.converted_record_type IS DISTINCT FROM 'opportunity' OR item.converted_record_id IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT (public.can_review_intake(u) OR public.is_pipeline_operator(u)
          OR u IN (item.assigned_owner_id, item.created_by)
          OR public.can_read_boq(item.converted_record_id, u)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.info_mail SET opportunity_id = item.converted_record_id
   WHERE inbox_item_id = item.id AND opportunity_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 10. @mentions on an email the caller just sent: a notification, never a copy.
CREATE OR REPLACE FUNCTION public.notify_mentions(_activity_id uuid, _users uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid := auth.uid();
  a public.activities;
  who text;
  r uuid;
  n integer := 0;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF cardinality(coalesce(_users, '{}')) > 10 THEN RAISE EXCEPTION 'At most 10 mentions' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM public.activities WHERE id = _activity_id;
  IF NOT FOUND OR a.sent_by IS DISTINCT FROM u OR a.related_opportunity_id IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(nullif(btrim(full_name), ''), email) INTO who FROM public.profiles WHERE id = u;
  FOR r IN SELECT DISTINCT x FROM unnest(_users) AS x LOOP
    -- Only people who can open the deal: a mention never widens who reads it.
    IF r <> u AND public.is_active_user(r) AND public.can_read_boq(a.related_opportunity_id, r) THEN
      PERFORM public.emit_notification(
        r, 'mention', 'opportunity', a.related_opportunity_id,
        left(coalesce(who, 'A colleague') || ' mentioned you on an email', 200),
        left(coalesce(a.summary, ''), 300), 'info', 'email.mention', a.id::text,
        jsonb_build_object('opportunity_id', a.related_opportunity_id, 'activity_id', a.id));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- 11. Grants -----------------------------------------------------------------
REVOKE ALL ON FUNCTION public.info_mail_owner_for(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_create_intake(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_apply_triage(uuid, text, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_triage_failed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_record_reply(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_record_forward(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_promote(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.info_mail_owner_for(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_create_intake(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_apply_triage(uuid, text, numeric, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_triage_failed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_record_reply(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_record_forward(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_promote(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.info_mail_dismiss(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.info_mail_link_conversion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notify_mentions(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.info_mail_dismiss(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.info_mail_link_conversion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_mentions(uuid, uuid[]) TO authenticated;

-- 12. Every five minutes, the same function and key as the reps' mail sync.
--     The function answers "off" until INFO_MAILBOX is set.
```

Then append the cron block. **Copy section 4 of `supabase/migrations/20261003100000_outlook_capture.sql` (lines ~111-130) exactly**, changing only: the job name → `'info-mailbox-sync'`, the body → `'{"mailbox":"info"}'::jsonb`, and **drop the `WHERE EXISTS (… mail_connections …)` condition**. Keep the unschedule-if-exists guard, the hard-coded project URL, the `x-phc-sync-key` header from Vault `outlook_sync_key`, and `timeout_milliseconds := 55000`.

Before writing the reply-activity insert, read the `activities` NOT NULL columns (types.ts `activities` `Insert`). If `owner_id` or `created_by` is NOT NULL, the `coalesce(...)` can still be null for an item with no owner. Guard it with `IF coalesce(opp.owner_id, item.assigned_owner_id) IS NOT NULL THEN … END IF;` around the insert.

- [ ] **Step 5: Run the pgTAP test**

Run the same command as Step 3. Expected: `ok 1..18`, all pass. If the local runner can't reach this migration (the known `gen_random_bytes` failure), say so in the report; CI's pgTAP job is then the gate, and Task 9 must not open the PR before it is green.

- [ ] **Step 6: Patch the generated types** in `src/integrations/supabase/types.ts`:
  - Under `Tables`, add `info_mail` with `Row`/`Insert`/`Update`/`Relationships`, mirroring the column list above (`attachment_names: string[]`, timestamps as `string`, nullable as `| null`). Use any neighbouring table as the template.
  - In `Enums.inbox_source_type` add `| "info_mailbox"`, and add `"info_mailbox"` to the `Constants.public.Enums.inbox_source_type` array if that section exists.
  - Under `Functions`, add `info_mail_dismiss: { Args: { _id: string }; Returns: undefined }`, `info_mail_link_conversion: { Args: { _inbox_item_id: string }; Returns: number }` and `notify_mentions: { Args: { _activity_id: string; _users: string[] }; Returns: number }`.

  Run: `bun run typecheck`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261024090000_inbox_source_info_mailbox.sql supabase/migrations/20261024100000_info_mailbox.sql \
  supabase/tests/info_mailbox.test.sql src/integrations/supabase/types.ts
git commit -m "feat(info@): mail table, routing functions and five-minute job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure mail rules and the app-only Graph calls

**Files:**
- Create: `supabase/functions/_shared/info-mail.ts`, `supabase/functions/_shared/info-mail.deno-test.ts`
- Modify: `supabase/functions/_shared/graph-client.ts` (append), `supabase/functions/_shared/graph.deno-test.ts` (append; extend the existing `./graph-client.ts` import)
- Modify: `package.json` only if `test:deno`'s glob doesn't already pick up `_shared/*.deno-test.ts` (it does: `supabase/functions/_shared/*.deno-test.ts`).

**Interfaces (Produces):**
- `info-mail.ts`: `INTERNAL_DOMAIN` (re-exported from mail-capture), `MAX_INFO_BODY = 8000`, `type InfoMessage = { graphId: string; internetMessageId: string | null; conversationId: string | null; subject: string | null; fromEmail: string | null; fromName: string | null; receivedAt: string; webLink: string | null; hasAttachments: boolean }`, `toInfoMessage(raw: Record<string, unknown>): InfoMessage | null`, `isInternalSender(m: InfoMessage): boolean`, `isAutoReply(headers: Array<{ name?: string; value?: string }>): boolean`, `capBody(text: string | null): string | null`.
- `graph-client.ts`: `appAccess(cfg: GraphConfig, f?)` → `Promise<TokenResult>`; `mailboxDeltaUrl(mailbox: string, sinceIso: string): string`; `getMailboxMessage(access: string, mailbox: string, messageId: string, withAttachments: boolean, f?)` → `Promise<{ body: string | null; sensitivity: string | null; headers: Array<{ name?: string; value?: string }>; attachmentNames: string[] } | null>`; `forwardMailboxMessage(access: string, mailbox: string, messageId: string, to: string, comment: string, f?)` → `Promise<{ ok: true } | { ok: false; status: number }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/_shared/info-mail.deno-test.ts
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { capBody, isAutoReply, isInternalSender, MAX_INFO_BODY, toInfoMessage } from "./info-mail.ts";

const RAW = {
  id: "AAMk1",
  internetMessageId: "<m1@acme>",
  conversationId: "conv-1",
  subject: " RFQ - Diriyah ",
  from: { emailAddress: { address: "Sara@Acme.example", name: "Sara" } },
  receivedDateTime: "2026-10-20T08:00:00Z",
  isDraft: false,
  webLink: "https://outlook.office365.com/owa/?ItemID=1",
  hasAttachments: true,
};

Deno.test("a Graph message becomes the shape the pass stores", () => {
  assertEquals(toInfoMessage(RAW), {
    graphId: "AAMk1",
    internetMessageId: "<m1@acme>",
    conversationId: "conv-1",
    subject: "RFQ - Diriyah",
    fromEmail: "sara@acme.example",
    fromName: "Sara",
    receivedAt: "2026-10-20T08:00:00Z",
    webLink: "https://outlook.office365.com/owa/?ItemID=1",
    hasAttachments: true,
  });
});

Deno.test("removed items, drafts and messages without an id or date are dropped", () => {
  assertEquals(toInfoMessage({ ...RAW, "@removed": { reason: "deleted" } }), null);
  assertEquals(toInfoMessage({ ...RAW, isDraft: true }), null);
  assertEquals(toInfoMessage({ ...RAW, id: "" }), null);
  assertEquals(toInfoMessage({ ...RAW, receivedDateTime: undefined }), null);
});

Deno.test("a web link that is not Outlook's is not kept", () => {
  assertEquals(toInfoMessage({ ...RAW, webLink: "https://evil.example/x" })?.webLink, null);
});

Deno.test("mail from our own domain is internal", () => {
  assert(isInternalSender(toInfoMessage({ ...RAW, from: { emailAddress: { address: "khalid@phc-sa.com" } } })!));
  assert(isInternalSender(toInfoMessage({ ...RAW, from: { emailAddress: { address: "x@mail.phc-sa.com" } } })!));
  assertFalse(isInternalSender(toInfoMessage(RAW)!));
});

Deno.test("auto-replies are recognised by their headers", () => {
  assert(isAutoReply([{ name: "Auto-Submitted", value: "auto-replied" }]));
  assert(isAutoReply([{ name: "auto-submitted", value: "auto-generated" }]));
  assert(isAutoReply([{ name: "Precedence", value: "auto_reply" }]));
  assertFalse(isAutoReply([{ name: "Auto-Submitted", value: "no" }]));
  assertFalse(isAutoReply([]));
});

Deno.test("the stored text is capped and blank text is nothing", () => {
  assertEquals(capBody("  "), null);
  assertEquals(capBody(null), null);
  assertEquals(capBody("x".repeat(MAX_INFO_BODY + 50))?.length, MAX_INFO_BODY);
});
```

Append to `graph.deno-test.ts` (and add `appAccess, forwardMailboxMessage, getMailboxMessage, mailboxDeltaUrl` to its `./graph-client.ts` import):

```ts
Deno.test("the app-only token asks for .default with the client-credentials grant", async () => {
  let body = "";
  const fake = ((_u: string, init?: RequestInit) => {
    body = String(init?.body);
    return Promise.resolve(new Response(JSON.stringify({ access_token: "app-tok" }), { status: 200 }));
  }) as typeof fetch;
  const r = await appAccess(CFG, fake);
  assertEquals(r.ok && r.access, "app-tok");
  const p = new URLSearchParams(body);
  assertEquals(p.get("grant_type"), "client_credentials");
  assertEquals(p.get("scope"), "https://graph.microsoft.com/.default");
});

Deno.test("the info@ delta reads that one mailbox's inbox", () => {
  const u = mailboxDeltaUrl("info@phc-sa.com", "2026-10-13T00:00:00Z");
  assert(u.startsWith("https://graph.microsoft.com/v1.0/users/info%40phc-sa.com/mailFolders/inbox/messages/delta?"));
  assert(u.includes("webLink") && u.includes("hasAttachments") && u.includes("receivedDateTime+ge+2026-10-13T00:00:00Z"));
  let threw = false;
  try { mailboxDeltaUrl("info@phc-sa.com/../x", "2026-10-13T00:00:00Z"); } catch { threw = true; }
  assert(threw);
});

Deno.test("a mailbox message brings its text, headers and attachment names", async () => {
  const urls: string[] = [];
  const fake = ((url: string) => {
    urls.push(url);
    if (url.includes("/attachments")) {
      return Promise.resolve(new Response(JSON.stringify({ value: [{ name: "BOQ.xlsx" }, { name: "Drawings.pdf" }] }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({
      uniqueBody: { content: " Please quote " },
      internetMessageHeaders: [{ name: "Auto-Submitted", value: "no" }],
      singleValueExtendedProperties: [{ id: "Integer 0x36", value: "0" }],
    }), { status: 200 }));
  }) as typeof fetch;
  const r = await getMailboxMessage("tok", "info@phc-sa.com", "AAMk1", true, fake);
  assertEquals(r, {
    body: "Please quote",
    sensitivity: "0",
    headers: [{ name: "Auto-Submitted", value: "no" }],
    attachmentNames: ["BOQ.xlsx", "Drawings.pdf"],
  });
  assert(urls[0].startsWith("https://graph.microsoft.com/v1.0/users/info%40phc-sa.com/messages/AAMk1?"));
  assertEquals(urls.length, 2);
  const none = await getMailboxMessage("tok", "info@phc-sa.com", "AAMk1", false, fake);
  assertEquals(none?.attachmentNames, []);
});

Deno.test("forwarding sends one recipient and a comment, and reports Graph's refusal", async () => {
  let seen: { url: string; body: unknown } = { url: "", body: null };
  const ok = ((url: string, init?: RequestInit) => {
    seen = { url, body: JSON.parse(String(init?.body)) };
    return Promise.resolve(new Response(null, { status: 202 }));
  }) as typeof fetch;
  assertEquals(await forwardMailboxMessage("tok", "info@phc-sa.com", "AAMk1", "khalid@phc-sa.com", "Routed by Mo", ok), { ok: true });
  assertEquals(seen.url, "https://graph.microsoft.com/v1.0/users/info%40phc-sa.com/messages/AAMk1/forward");
  assertEquals(seen.body, { comment: "Routed by Mo", toRecipients: [{ emailAddress: { address: "khalid@phc-sa.com" } }] });
  const no = (() => Promise.resolve(new Response("{}", { status: 403 }))) as typeof fetch;
  assertEquals(await forwardMailboxMessage("tok", "info@phc-sa.com", "AAMk1", "k@phc-sa.com", "c", no), { ok: false, status: 403 });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `bun run test:deno 2>&1 | tail -5`. Expected: FAIL (module/exports missing).

- [ ] **Step 3: Implement `info-mail.ts`**

```ts
// supabase/functions/_shared/info-mail.ts
// =============================================================================
// The info@phc-sa.com mailbox — the pure rules the five-minute pass applies to
// each message before anything is stored. (Graph calls: graph-client.ts.
// Decisions about owners, items and replies: the SQL in 20261024100000.)
// =============================================================================

import { INTERNAL_DOMAIN } from "./mail-capture.ts";

export { INTERNAL_DOMAIN };
/** Characters of a message's own text kept for triage and for the deal page. */
export const MAX_INFO_BODY = 8000;

export type InfoMessage = {
  graphId: string;
  internetMessageId: string | null;
  conversationId: string | null;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  receivedAt: string;
  webLink: string | null;
  hasAttachments: boolean;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const OUTLOOK_LINK = /^https:\/\/outlook\.office(365)?\.com\//;

/** A delta item → what the pass stores. Removed items and drafts are not mail. */
export function toInfoMessage(raw: Record<string, unknown>): InfoMessage | null {
  if (raw["@removed"] || raw.isDraft === true) return null;
  const graphId = str(raw.id);
  const receivedAt = str(raw.receivedDateTime);
  if (!graphId || !receivedAt) return null;
  const from = (raw.from as { emailAddress?: { address?: unknown; name?: unknown } } | undefined)?.emailAddress;
  const webLink = str(raw.webLink);
  return {
    graphId,
    internetMessageId: str(raw.internetMessageId),
    conversationId: str(raw.conversationId),
    subject: str(raw.subject),
    fromEmail: str(from?.address)?.toLowerCase() ?? null,
    fromName: str(from?.name),
    receivedAt,
    webLink: webLink && OUTLOOK_LINK.test(webLink) ? webLink : null,
    hasAttachments: raw.hasAttachments === true,
  };
}

/** Our own people writing to info@ are not clients. */
export function isInternalSender(m: InfoMessage): boolean {
  const domain = (m.fromEmail ?? "").split("@")[1] ?? "";
  return domain === INTERNAL_DOMAIN || domain.endsWith(`.${INTERNAL_DOMAIN}`);
}

/** RFC 3834 Auto-Submitted (anything but "no"), or Precedence: auto_reply. */
export function isAutoReply(headers: Array<{ name?: string; value?: string }>): boolean {
  return headers.some((h) => {
    const name = (h.name ?? "").toLowerCase();
    const value = (h.value ?? "").trim().toLowerCase();
    return (name === "auto-submitted" && value !== "" && value !== "no") ||
      (name === "precedence" && value === "auto_reply");
  });
}

export function capBody(text: string | null): string | null {
  const t = (text ?? "").trim();
  return t ? t.slice(0, MAX_INFO_BODY) : null;
}
```

If `mail-capture.ts` does not export `INTERNAL_DOMAIN`, check with `grep -n "INTERNAL_DOMAIN" supabase/functions/_shared/mail-capture.ts`. The research says it does: `export const INTERNAL_DOMAIN = "phc-sa.com"`.

- [ ] **Step 4: Implement the Graph calls** (append to `graph-client.ts`)

```ts
// ---- The info@ mailbox: app-only, and Exchange lets this app reach info@ alone
// (RBAC for Applications; docs/info-mailbox-setup.md). --------------------------

/** Client-credentials token. No Mail permission is consented in Entra; Exchange grants it for info@ only. */
export function appAccess(cfg: GraphConfig, f: typeof fetch = fetch) {
  return postToken(cfg, { grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }, f);
}

const INFO_DELTA_SELECT = "id,internetMessageId,conversationId,subject,from,receivedDateTime,isDraft,webLink,hasAttachments";
const MAILBOX = /^[^@\s/?#]+@[^@\s/?#]+$/;
const mailboxPath = (mailbox: string) => {
  if (!MAILBOX.test(mailbox)) throw new Error("bad mailbox");
  return `${GRAPH}/users/${encodeURIComponent(mailbox)}`;
};

/** The first delta request for info@'s inbox: new messages since a date. */
export function mailboxDeltaUrl(mailbox: string, sinceIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(sinceIso)) throw new Error("bad since date");
  return `${mailboxPath(mailbox)}/mailFolders/inbox/messages/delta` +
    `?$select=${INFO_DELTA_SELECT}&$filter=receivedDateTime+ge+${sinceIso}&changeType=created`;
}

/** One info@ message: its own text (no quoted history), headers, sensitivity, and attachment names (never the files). */
export async function getMailboxMessage(
  access: string,
  mailbox: string,
  messageId: string,
  withAttachments: boolean,
  f: typeof fetch = fetch,
): Promise<{ body: string | null; sensitivity: string | null; headers: Array<{ name?: string; value?: string }>; attachmentNames: string[] } | null> {
  const base = `${mailboxPath(mailbox)}/messages/${encodeURIComponent(messageId)}`;
  const auth = { Authorization: `Bearer ${access}` };
  try {
    const res = await f(`${base}?$select=uniqueBody,internetMessageHeaders&$expand=${SENSITIVITY_EXPAND}`, {
      headers: { ...auth, Prefer: 'outlook.body-content-type="text"' },
    });
    if (!res.ok) return null;
    const j = await res.json() as {
      uniqueBody?: { content?: string };
      internetMessageHeaders?: Array<{ name?: string; value?: string }>;
      singleValueExtendedProperties?: Array<{ id?: string; value?: string }>;
    };
    let attachmentNames: string[] = [];
    if (withAttachments) {
      const a = await f(`${base}/attachments?$select=name`, { headers: auth });
      if (!a.ok) return null;
      const aj = await a.json() as { value?: Array<{ name?: unknown }> };
      attachmentNames = (aj.value ?? []).map((x) => (typeof x.name === "string" ? x.name.slice(0, 200) : "")).filter(Boolean).slice(0, 20);
    }
    return {
      body: (j.uniqueBody?.content ?? "").trim() || null,
      sensitivity: (j.singleValueExtendedProperties ?? []).find((p) => /0x0*36$/i.test(p.id ?? ""))?.value ?? null,
      headers: j.internetMessageHeaders ?? [],
      attachmentNames,
    };
  } catch {
    return null;
  }
}

/** Forward an info@ message to one colleague. Only a router's click reaches this. */
export async function forwardMailboxMessage(
  access: string,
  mailbox: string,
  messageId: string,
  to: string,
  comment: string,
  f: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; status: number }> {
  try {
    const res = await f(`${mailboxPath(mailbox)}/messages/${encodeURIComponent(messageId)}/forward`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment, toRecipients: [{ emailAddress: { address: to } }] }),
    });
    return res.ok ? { ok: true } : { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 502 };
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `bun run test:deno 2>&1 | tail -5 && bun test src/lib/outlook-connect.contract.test.ts`
Expected: all PASS (the "only graph-client.ts names Graph" rule still holds).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/info-mail.ts supabase/functions/_shared/info-mail.deno-test.ts \
  supabase/functions/_shared/graph-client.ts supabase/functions/_shared/graph.deno-test.ts
git commit -m "feat(info@): message rules and app-only Graph calls for one mailbox

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `info_mail_triage` agent and the orchestrator's service caller

**Files:**
- Modify: `supabase/functions/_shared/ai-schemas.ts`, `ai-guardrails.ts`, `ai-prompts.ts`, `ai-agent-registry.ts`, `supabase/functions/ai-orchestrator/index.ts`, `docs/ai-orchestrator.md`
- Create: `supabase/functions/_shared/ai-info-mail.deno-test.ts`
- Test: also run the existing bun contract tests that read these files (`src/lib/ai-orchestrator.contract.test.ts`, `ai-orchestrator-hardening.contract.test.ts`, `ai-agent-wiring-expansion.contract.test.ts`, `ai-schemas.test.ts`, `ai-guardrails.test.ts`, `ai-prompts.test.ts`).

**Interfaces (Produces):**
- `AGENT_KEYS` gains `"info_mail_triage"`; `ENTITY_TYPES` gains `"info_mail"`.
- `INFO_MAIL_CATEGORIES = ["rfq","quotation_request","supplier","finance","hr","general","spam"] as const`.
- `InfoMailTriageOutputSchema` (below). `AGENT_OUTPUT_TYPES.info_mail_triage = "staged_classification"`.
- `AgentDefinition` gains optional `serviceCallable?: true`; only `info_mail_triage` sets it.
- Orchestrator: a request with header `x-phc-service-key` is a **service call**. It is valid only if `outlook_sync_key_matches(_key)` is true and the `INFO_MAILBOX` env names an active profile. Its caller is `{ userId: <that profile id>, roles: [], service: true }`. It may run only `serviceCallable` agents, and its usage kind is `"mailbox"`.

- [ ] **Step 1: Write the failing Deno tests** (model the fake client on `ai-daily-brief-context.deno-test.ts`; read it first)

```ts
// supabase/functions/_shared/ai-info-mail.deno-test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_REGISTRY } from "./ai-agent-registry.ts";
import { InfoMailTriageOutputSchema } from "./ai-schemas.ts";
import { scanForGuardrailViolations } from "./ai-guardrails.ts";

const MAIL_ID = "2d0000a0-0000-0000-0000-000000000001";
function fakeDb(row: Record<string, unknown> | null) {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "order", "limit"]) chain[k] = () => chain;
  chain.maybeSingle = () => ({ throwOnError: () => Promise.resolve({ data: row }) , then: (r: (v: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(r) });
  return { from: () => chain } as never;
}

Deno.test("only a service call may run the triage", () => {
  const a = AGENT_REGISTRY.info_mail_triage;
  assertEquals(a.allowedEntityTypes, ["info_mail"]);
  assertEquals(a.serviceCallable, true);
  assertEquals(a.hasRole(["sales_manager"]), false);
  assertEquals(a.hasRole(["system_admin"]), false);
  for (const [key, def] of Object.entries(AGENT_REGISTRY)) {
    if (key !== "info_mail_triage") assert(!def.serviceCallable, `${key} must not be service-callable`);
  }
});

Deno.test("the context is the one message, its text delimited and capped", async () => {
  const r = await AGENT_REGISTRY.info_mail_triage.loadContext(fakeDb({
    id: MAIL_ID, category: "unclassified", from_email: "sara@acme.example", from_name: "Sara",
    subject: "RFQ - Diriyah villas", received_at: "2026-10-20T08:00:00Z",
    body_text: "x".repeat(9000), attachment_names: ["BOQ.xlsx"],
  }), "info_mail", MAIL_ID, {});
  assert(r.ok);
  if (r.ok) {
    const ctx = JSON.parse(r.contextText);
    assertEquals(ctx.subject, "RFQ - Diriyah villas");
    assertEquals(ctx.attachments, ["BOQ.xlsx"]);
    assert(ctx.text.length <= 6000);
  }
});

Deno.test("a message that was already classified is not sent to the model", async () => {
  const r = await AGENT_REGISTRY.info_mail_triage.loadContext(fakeDb({ id: MAIL_ID, category: "hr" }), "info_mail", MAIL_ID, {});
  assertEquals(r.ok, false);
  const missing = await AGENT_REGISTRY.info_mail_triage.loadContext(fakeDb(null), "info_mail", MAIL_ID, {});
  assertEquals(missing.ok, false);
});

Deno.test("the output schema takes a request with nulls and refuses extra fields", () => {
  const good = {
    category: "rfq", confidence: 0.9, summary_en: "Signage for 40 villas", summary_ar: "لوحات إرشادية لأربعين فيلا",
    request: { company: "Acme", contact_name: null, phone: null, email: null, project_name: "Diriyah villas",
      location: "Diriyah", client_rfq_ref: "RFQ-ACM-77", estimated_value: 1200000, currency: "SAR", scope: "Signage", deadline: "2026-11-01" },
  };
  assert(InfoMailTriageOutputSchema.safeParse(good).success);
  assert(InfoMailTriageOutputSchema.safeParse({ ...good, request: null, category: "spam" }).success);
  assertEquals(InfoMailTriageOutputSchema.safeParse({ ...good, extra: 1 }).success, false);
  assertEquals(InfoMailTriageOutputSchema.safeParse({ ...good, request: { ...good.request, deadline: "1 Nov" } }).success, false);
  assertEquals(scanForGuardrailViolations(good).length === 0 || scanForGuardrailViolations(good) === null, true);
});
```

(Adjust the last assertion to `scanForGuardrailViolations`'s real return shape after reading it. The point is that a normal triage output passes the guardrail scan. Fix the `fakeDb` chain to match how your `loadContext` queries; keep it minimal.)

- [ ] **Step 2: Run them to make sure they fail.** `bun run test:deno 2>&1 | tail -5` → FAIL (no `info_mail_triage`).

- [ ] **Step 3: Schemas** (`ai-schemas.ts`)
  - Add `"info_mail_triage"` at the end of `AGENT_KEYS`.
  - Add to `ENTITY_TYPES`, after `"my_email"`:
    ```ts
      // One message in the info@ mailbox — info_mail_triage, service calls only.
      "info_mail",
    ```
  - Add near `DailyEmailBriefOutputSchema`:
    ```ts
    export const INFO_MAIL_CATEGORIES = ["rfq", "quotation_request", "supplier", "finance", "hr", "general", "spam"] as const;
    const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
    export const InfoMailTriageOutputSchema = z.object({
      category: z.enum(INFO_MAIL_CATEGORIES),
      confidence: z.number().min(0).max(1),
      summary_en: z.string().min(1).max(200),
      summary_ar: z.string().min(1).max(200),
      request: z.object({
        company: nullableText(200),
        contact_name: nullableText(200),
        phone: nullableText(40),
        email: nullableText(200),
        project_name: nullableText(300),
        location: nullableText(200),
        client_rfq_ref: nullableText(100),
        estimated_value: z.number().nonnegative().max(1e13).nullable(),
        currency: nullableText(10),
        scope: nullableText(1000),
        deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      }).strict().nullable(),
    }).strict();
    ```
  - Register it in `AGENT_OUTPUT_SCHEMAS` (`info_mail_triage: InfoMailTriageOutputSchema`) and in `AGENT_OUTPUT_TYPES` (`info_mail_triage: "staged_classification"`).

- [ ] **Step 4: Guardrails** (`ai-guardrails.ts`): `AGENT_ENTITY_ALLOWLIST.info_mail_triage = ["info_mail"]`, and `AGENT_ROLE_CHECK.info_mail_triage = () => false` with the comment `// No person runs it: the info@ pass calls it as a service (orchestrator, serviceCallable).`

- [ ] **Step 5: Prompt** (`ai-prompts.ts`), after the daily brief builder:

```ts
const INFO_MAIL_TRIAGE_INSTRUCTIONS = `
AGENT: info_mail_triage (${PROMPT_VERSION})
You sort one email that arrived at PHC's general mailbox, info@phc-sa.com. PHC
designs, makes and installs wayfinding and signage. The CONTEXT holds the
sender, subject, date, attachment names and the email's own text. You do NOT
reply, forward or change anything; a person acts on your labels.

category — exactly one:
- "rfq": a client asks PHC to price a project or sends tender/RFQ documents
- "quotation_request": a client asks for a price, catalogue or offer without formal RFQ documents
- "supplier": a supplier or subcontractor offering products or services, or sending their own quotes
- "finance": invoices, payments, statements, bank or tax matters
- "hr": CVs, job applications, recruitment
- "general": anything else a person should read
- "spam": unsolicited marketing, phishing, newsletters
confidence: 0..1, how sure you are of the category.
summary_en / summary_ar: one short line each (<= 200 chars), third person
("The client asks…"), in English and in Arabic. Never quote the sender.
request: for "rfq" and "quotation_request" only, else null. Fill a field only
when the email states it; otherwise null. Never guess. estimated_value is a
number with no currency sign; currency is its 3-letter code if stated;
deadline is the submission date as YYYY-MM-DD if stated.

Return a JSON object with exactly: category, confidence, summary_en,
summary_ar, request.
`.trim();

export function buildInfoMailTriagePrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${INFO_MAIL_TRIAGE_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("info_mail", context),
    version: PROMPT_VERSION,
    schemaName: "info_mail_triage_output",
  };
}
```
Register it in `AGENT_PROMPT_BUILDERS`: `info_mail_triage: buildInfoMailTriagePrompt,`.

- [ ] **Step 6: Registry** (`ai-agent-registry.ts`)
  - Add `serviceCallable?: true;` to `AgentDefinition` with the comment `/** The only agents a service call (no person) may run. See the orchestrator's service caller. */`.
  - Add the loader near `loadDailyEmailBriefContext`:

```ts
const INFO_MAIL_TEXT = 6000;

/** One info@ message, for info_mail_triage. Only an unclassified message is sent to the model. */
export async function loadInfoMailContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data } = await svc
    .from("info_mail")
    .select("id, category, from_email, from_name, subject, received_at, body_text, attachment_names")
    .eq("id", entityId)
    .maybeSingle();
  const m = data as {
    id: string; category: string; from_email: string | null; from_name: string | null; subject: string | null;
    received_at: string; body_text: string | null; attachment_names: string[] | null;
  } | null;
  if (!m) return { ok: false, code: "AI_INPUT_INVALID", message: "No such message." };
  if (m.category !== "unclassified") return { ok: false, code: "AI_INPUT_INVALID", message: "Already classified." };
  const contextText = JSON.stringify({
    from: m.from_name ? `${m.from_name} <${m.from_email ?? ""}>` : m.from_email,
    subject: m.subject,
    date: m.received_at,
    attachments: (m.attachment_names ?? []).slice(0, 20),
    text: (m.body_text ?? "").slice(0, INFO_MAIL_TEXT),
  });
  return {
    ok: true,
    contextText,
    recordCount: 1,
    manifest: {
      fields_loaded: ["from_email", "from_name", "subject", "received_at", "body_text", "attachment_names"],
      record_counts: { info_mail: 1 },
      source_entity_types: ["info_mail"],
      redacted_identifiers: { info_mail_id: m.id },
    },
  };
}
```

  - Add the entry to `AGENT_REGISTRY`:

```ts
  info_mail_triage: {
    key: "info_mail_triage",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.info_mail_triage,
    hasRole: AGENT_ROLE_CHECK.info_mail_triage,
    // The service caller is authenticated by the orchestrator; the record is the message itself.
    checkAccess: async () => ({ ok: true }),
    loadContext: (svc, entityType, entityId) => loadInfoMailContext(svc, entityType, entityId),
    buildPrompt: AGENT_PROMPT_BUILDERS.info_mail_triage,
    outputSchema: AGENT_OUTPUT_SCHEMAS.info_mail_triage,
    outputType: AGENT_OUTPUT_TYPES.info_mail_triage,
    maxContextRecords: 1,
    allowProviderFallback: true,
    serviceCallable: true,
  },
```

- [ ] **Step 7: Orchestrator service caller** (`ai-orchestrator/index.ts`)
  - Change `type Caller` to `type Caller = { userId: string; roles: AppRole[]; service?: true };`.
  - Add above `handleRequest`:

```ts
// ---- Service caller (info@ mailbox, 2026-10-20) -----------------------------
// outlook-sync's info@ pass classifies mail with no person present. It proves
// itself with the same Vault key pg_cron sends it (outlook_sync_key_matches),
// runs as the info@ profile (so usage and requested_by stay a real, active
// user), and may run ONLY agents marked serviceCallable in the registry.
async function resolveServiceCaller(svc: ServiceClient, key: string): Promise<Caller | null> {
  const { data: ok } = await svc.rpc("outlook_sync_key_matches", { _key: key });
  if (ok !== true) return null;
  const mailbox = (Deno.env.get("INFO_MAILBOX") ?? "").trim().toLowerCase();
  if (!mailbox) return null;
  const { data: profile } = await svc
    .from("profiles").select("id, status").ilike("email", mailbox).maybeSingle();
  if (!profile || profile.status !== "active") return null;
  return { userId: profile.id as string, roles: [], service: true };
}
```

  - In step 2 (Authenticate), replace the block with:

```ts
  let caller: Caller;
  const svc = serviceClient();
  const serviceKey = req.headers.get("x-phc-service-key");
  if (serviceKey) {
    const s = await resolveServiceCaller(svc, serviceKey);
    if (!s) return errorEnvelope("AI_UNAUTHENTICATED", "Authentication is required.", null, 401);
    caller = s;
  } else {
    try {
      caller = await resolveCaller(req.headers.get("Authorization"));
    } catch {
      // Deliberately generic — never confirm/deny *why* auth failed.
      return errorEnvelope("AI_UNAUTHENTICATED", "Authentication is required.", null, 401);
    }
  }
```
  and delete the later `const svc = serviceClient();` line.
  - Where the role check is (`if (!agentDef.hasRole(caller.roles))`), make it:

```ts
  const allowed = caller.service ? agentDef.serviceCallable === true : agentDef.hasRole(caller.roles);
  if (!allowed) return errorEnvelope("AI_AGENT_NOT_ALLOWED", <keep the existing message>, traceId, 403);
```
  - Where `usageKind` is set, make it:

```ts
  const usageKind = caller.service
    ? "mailbox"
    : entityType === "import_batches" || entityType === "import_rows" ? "import" : "interactive";
```
  - Make sure the provider-override/admin path (`adminOverrideAllowed`) is false for a service caller (`roles: []` already gives that; check how it's computed).

- [ ] **Step 8: Docs.** In `docs/ai-orchestrator.md`, add a row for `info_mail_triage` to the "Later agents" table, and a short section "### Service caller (info@ mailbox)" saying: the header, the Vault key check, the info@ profile as requester, the `mailbox` usage kind (300/day), and that only `serviceCallable` agents run this way.

- [ ] **Step 9: Run everything that reads these files**

```bash
bun run test:deno 2>&1 | tail -3
bun test src/lib/ai-orchestrator.contract.test.ts src/lib/ai-orchestrator-hardening.contract.test.ts \
  src/lib/ai-agent-wiring-expansion.contract.test.ts src/lib/ai-schemas.test.ts src/lib/ai-guardrails.test.ts src/lib/ai-prompts.test.ts
deno check --allow-import --config supabase/functions/deno.json supabase/functions/ai-orchestrator/index.ts
bun run test 2>&1 | tail -2
```
Expected: all pass. If a contract test pins an exact agent count or entity list, update the expected list in that test to include the new key (only that), and note it in the report.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/_shared/ai-*.ts supabase/functions/ai-orchestrator/index.ts docs/ai-orchestrator.md src/lib/*.test.ts
git commit -m "feat(ai): info_mail_triage agent and a service caller limited to it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The info@ pass in `outlook-sync`

**Files:**
- Create: `supabase/functions/outlook-sync/info-pass.ts`
- Modify: `supabase/functions/outlook-sync/index.ts`
- Test: `src/lib/info-mail.contract.test.ts` (new, source-reading), plus Deno tests from Task 2.

**Interfaces:**
- Consumes: Task 1 RPCs (`info_mail_record_reply`, `info_mail_apply_triage`, `info_mail_triage_failed`), Task 2 (`appAccess`, `mailboxDeltaUrl`, `deltaPage`, `getMailboxMessage`, `toInfoMessage`, `isInternalSender`, `isAutoReply`, `capBody`), Task 3 (orchestrator service call).
- Produces: `syncInfoMailbox(svc, cfg, opts: { mailbox: string; syncKey: string; started: number; budgetMs: number }): Promise<{ stored: number; triaged: number; error: string | null }>`.

- [ ] **Step 1: Write the contract test first**

```ts
// src/lib/info-mail.contract.test.ts
// =============================================================================
// The info@ mailbox — where its code lives and what it never does.
// Unit behaviour: supabase/functions/_shared/info-mail.deno-test.ts,
// ai-info-mail.deno-test.ts; database: supabase/tests/info_mailbox.test.sql.
// =============================================================================
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PASS = read("supabase/functions/outlook-sync/info-pass.ts");
const SYNC = read("supabase/functions/outlook-sync/index.ts");

describe("the info@ pass", () => {
  it("runs only behind the cron key, before anything else", () => {
    const keyCheck = SYNC.indexOf("outlook_sync_key_matches");
    const dispatch = SYNC.indexOf("syncInfoMailbox(");
    expect(keyCheck).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(keyCheck);
  });

  it("is off until INFO_MAILBOX is set", () => {
    expect(SYNC).toContain('Deno.env.get("INFO_MAILBOX")');
  });

  it("classifies through the orchestrator, never a provider", () => {
    expect(PASS).toContain("/functions/v1/ai-orchestrator");
    expect(PASS).toContain('"x-phc-service-key"');
    expect(PASS).not.toMatch(/generateStructured|OPENAI_API_KEY|ANTHROPIC_API_KEY|api\.openai\.com|api\.anthropic\.com/);
  });

  it("never forwards or sends from the pass", () => {
    expect(PASS).not.toMatch(/forwardMailboxMessage|sendAsMe|sendMail/);
  });

  it("logs counts, never addresses, subjects or bodies", () => {
    for (const line of PASS.split("\n").filter((l) => l.includes("log("))) {
      expect(line).not.toMatch(/fromEmail|subject|body|from_email/);
    }
  });
});
```

Run: `bun test src/lib/info-mail.contract.test.ts`. Expected: FAIL (file missing).

- [ ] **Step 2: Write `info-pass.ts`**

```ts
// supabase/functions/outlook-sync/info-pass.ts
// =============================================================================
// The info@phc-sa.com pass (manager feedback 2026-10-19, group 3 part B).
//
// Every five minutes (cron job info-mailbox-sync): read new inbox mail with an
// app-only token Exchange limits to info@, store each message, put a reply in a
// known conversation on its deal, and ask the orchestrator to classify the rest.
// What a classification does — an intake item, an owner, a notification — is
// decided in SQL (info_mail_apply_triage), not here.
// =============================================================================

import type { serviceClient } from "../_shared/supabase.ts";
import type { readGraphConfig } from "../_shared/graph.ts";
import { appAccess, deltaPage, getMailboxMessage, mailboxDeltaUrl } from "../_shared/graph-client.ts";
import { capBody, isAutoReply, isInternalSender, toInfoMessage } from "../_shared/info-mail.ts";

type Svc = ReturnType<typeof serviceClient>;
type Cfg = ReturnType<typeof readGraphConfig>;

const FIRST_READ_DAYS = 7;
const MAX_PAGES = 10;
const TRIAGE_PER_RUN = 8;
const PRIVATE = new Set(["1", "2"]); // PR_SENSITIVITY: personal, private

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ fn: "outlook-sync", pass: "info", ...o }));

export async function syncInfoMailbox(
  svc: Svc,
  cfg: Cfg,
  opts: { mailbox: string; syncKey: string; started: number; budgetMs: number },
): Promise<{ stored: number; triaged: number; error: string | null }> {
  const inBudget = () => Date.now() - opts.started < opts.budgetMs;
  const tok = await appAccess(cfg);
  if (!tok.ok) {
    await saveState(svc, null, "token refused", true);
    log({ outcome: "token_failed" });
    return { stored: 0, triaged: 0, error: "token" };
  }

  // 1. Read new mail.
  const { data: state } = await svc.from("info_mailbox_state").select("delta_link").eq("id", true).maybeSingle();
  const since = new Date(Date.now() - FIRST_READ_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  let url = (state?.delta_link as string | null) ?? mailboxDeltaUrl(opts.mailbox, since);
  let resume: string | null = (state?.delta_link as string | null) ?? null;
  let error: string | null = null;
  const batch: Array<Record<string, unknown>> = [];
  for (let i = 0; i < MAX_PAGES && inBudget(); i++) {
    const r = await deltaPage(tok.access, url);
    if (!r.ok) {
      error = r.error ?? `graph ${r.status}`;
      resume = r.gone ? null : resume;
      break;
    }
    batch.push(...r.messages);
    if (r.deltaLink) { resume = r.deltaLink; break; }
    if (!r.next) break;
    url = r.next;
    resume = r.next;
  }

  // 2. Store them.
  let stored = 0;
  let complete = true;
  for (const raw of batch) {
    if (!inBudget()) { complete = false; break; }
    const m = toInfoMessage(raw);
    if (!m || isInternalSender(m)) continue;
    const { data: seen } = await svc.from("info_mail").select("id").eq("graph_message_id", m.graphId).maybeSingle();
    if (seen) continue;
    const detail = await getMailboxMessage(tok.access, opts.mailbox, m.graphId, m.hasAttachments);
    if (!detail) { complete = false; break; } // try the whole round again next time
    if (PRIVATE.has(detail.sensitivity ?? "") || isAutoReply(detail.headers)) continue;

    const { data: row, error: insErr } = await svc.from("info_mail").insert({
      graph_message_id: m.graphId,
      internet_message_id: m.internetMessageId,
      conversation_id: m.conversationId,
      from_email: m.fromEmail,
      from_name: m.fromName,
      subject: m.subject,
      received_at: m.receivedAt,
      body_text: capBody(detail.body),
      attachment_names: detail.attachmentNames,
      web_link: m.webLink,
    }).select("id").single();
    if (insErr) {
      if (insErr.code === "23505") continue;
      complete = false;
      error = "store failed";
      break;
    }
    stored++;

    // A later message in a conversation that already became an item or a deal.
    if (m.conversationId) {
      const { data: parent } = await svc.from("info_mail").select("id")
        .eq("conversation_id", m.conversationId)
        .neq("id", row.id)
        .or("inbox_item_id.not.is.null,opportunity_id.not.is.null")
        .order("received_at", { ascending: true }).limit(1).maybeSingle();
      if (parent) await svc.rpc("info_mail_record_reply", { _mail_id: row.id, _parent_id: parent.id });
    }
  }
  await saveState(svc, complete ? resume : (state?.delta_link as string | null) ?? null, error, false);

  // 3. Classify what is waiting, oldest first, while there is time.
  let triaged = 0;
  const { data: waiting } = await svc.from("info_mail").select("id, triage_attempts")
    .eq("category", "unclassified").lt("triage_attempts", 3)
    .order("received_at", { ascending: true }).limit(TRIAGE_PER_RUN);
  for (const w of waiting ?? []) {
    if (!inBudget()) break;
    const verdict = await classify(w.id as string, Number(w.triage_attempts), opts.syncKey);
    if (!verdict) {
      await svc.rpc("info_mail_triage_failed", { _mail_id: w.id });
      continue;
    }
    await svc.rpc("info_mail_apply_triage", {
      _mail_id: w.id,
      _category: verdict.category,
      _confidence: verdict.confidence,
      _summary: `${verdict.summary_en}\n${verdict.summary_ar}`,
      _fields: verdict.request,
    });
    triaged++;
  }
  log({ outcome: error ? "partial" : "done", stored, triaged, read: batch.length });
  return { stored, triaged, error };
}

type Verdict = {
  category: string;
  confidence: number;
  summary_en: string;
  summary_ar: string;
  request: Record<string, unknown> | null;
};

async function classify(mailId: string, attempt: number, syncKey: string): Promise<Verdict | null> {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  try {
    const res = await fetch(`${base}/functions/v1/ai-orchestrator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The gateway checks a JWT before the function runs; the anon key
        // passes it. The function itself trusts only the service key below.
        Authorization: `Bearer ${anon}`,
        apikey: anon,
        "x-phc-service-key": syncKey,
      },
      body: JSON.stringify({
        agent: "info_mail_triage",
        entityType: "info_mail",
        entityId: mailId,
        input: {},
        clientRequestId: `info_mail:${mailId}:${attempt}`,
      }),
    });
    const j = await res.json().catch(() => null) as { ok?: boolean; result?: Verdict } | null;
    return j?.ok && j.result ? j.result : null;
  } catch {
    return null;
  }
}

async function saveState(svc: Svc, deltaLink: string | null, error: string | null, keepLink: boolean) {
  const patch: Record<string, unknown> = { last_run_at: new Date().toISOString(), last_error: error?.slice(0, 500) ?? null };
  if (!keepLink) patch.delta_link = deltaLink;
  await svc.from("info_mailbox_state").update(patch).eq("id", true);
}
```

- [ ] **Step 3: Dispatch in `index.ts`.** Right after the existing key check and the `cfg.configured` check in `handleSync`, add:

```ts
  // The info@ pass (cron job info-mailbox-sync sends {"mailbox":"info"}).
  const body = await req.json().catch(() => ({})) as { mailbox?: unknown };
  if (body.mailbox === "info") {
    const mailbox = (Deno.env.get("INFO_MAILBOX") ?? "").trim().toLowerCase();
    if (!mailbox) return text(200, "off");
    const r = await syncInfoMailbox(svc, cfg, { mailbox, syncKey: key, started: Date.now(), budgetMs: TIME_BUDGET_MS });
    return text(200, r.error ? "partial" : "ok");
  }
```
Import `syncInfoMailbox` from `./info-pass.ts`. Read the existing handler first. If it already reads the body or names the start time differently, reuse those names. The reps' pass must behave exactly as before for any request without `mailbox: "info"`.

- [ ] **Step 4: Check and run**

```bash
deno check --allow-import --config supabase/functions/deno.json supabase/functions/outlook-sync/index.ts
bun test src/lib/info-mail.contract.test.ts src/lib/outlook-capture.contract.test.ts src/lib/outlook-connect.contract.test.ts
bun run test:deno 2>&1 | tail -2
```
Expected: all pass. (`outlook-capture.contract.test.ts` asserts the key check comes before any DB read; keep it true.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/outlook-sync/info-pass.ts supabase/functions/outlook-sync/index.ts src/lib/info-mail.contract.test.ts
git commit -m "feat(info@): five-minute pass — store, bind replies, classify

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Router actions in `sales-os-api` and the browser calls

**Files:**
- Create: `supabase/functions/sales-os-api/handlers/info-mail.ts`, `src/lib/info-mail-actions.ts`
- Modify: `supabase/functions/sales-os-api/index.ts` (register the module), `src/lib/info-mail.contract.test.ts` (append)

**Interfaces (Produces):**
- Backend actions `info_mail_forward { id: string, toUserId: string } → { ok: true }` and `info_mail_mark_rfq { id: string } → { ok: true, inboxItemId: string }`.
- Browser (`src/lib/info-mail-actions.ts`):
  - `type InfoMailRow = { id; from_email; from_name; subject; received_at; category; summary; status; web_link; attachment_names: string[] }`
  - `listOpenInfoMail(): Promise<InfoMailRow[]>`
  - `forwardInfoMail(id: string, toUserId: string): Promise<void>`
  - `markInfoMailRfq(id: string): Promise<string>`
  - `dismissInfoMail(id: string): Promise<void>`
  - `sourceEmailFor(opportunityId: string): Promise<(InfoMailRow & { body_text: string | null }) | null>`

- [ ] **Step 1: Append contract tests**

```ts
describe("routing info@ mail", () => {
  const H = read("supabase/functions/sales-os-api/handlers/info-mail.ts");
  const A = read("src/lib/info-mail-actions.ts");

  it("checks the router role as the caller before touching Graph", () => {
    const gate = H.slice(H.indexOf("async function routerGate"), H.indexOf("function mailbox"));
    expect(gate).toContain('ctx.asCaller.rpc("is_pipeline_operator"');
    for (const fn of ["info_mail_forward", "info_mail_mark_rfq"]) {
      const body = H.slice(H.indexOf(`async function ${fn}`));
      const role = body.indexOf("routerGate(ctx)");
      const graph = body.indexOf("appAccess(");
      expect(role).toBeGreaterThan(-1);
      expect(graph).toBeGreaterThan(role);
    }
  });

  it("forwards only to an active colleague on the company domain", () => {
    expect(H).toMatch(/status !== "active"/);
    expect(H).toMatch(/@phc-sa\.com/);
  });

  it("the browser never calls Graph and never sees the cron key", () => {
    expect(A).not.toMatch(/graph\.microsoft\.com|x-phc-sync-key|outlook_sync_key/);
    expect(A).toContain('callBackend("info_mail_forward"');
    expect(A).toContain('supabase.rpc("info_mail_dismiss"');
  });
});
```

- [ ] **Step 2: The handler**

```ts
// supabase/functions/sales-os-api/handlers/info-mail.ts
// =============================================================================
// Routing info@ mail (group 3 part B). A router — is_pipeline_operator, checked
// as the caller — forwards a message to one colleague, or marks it as an RFQ.
// Both reach info@ with the app-only token Exchange limits to that mailbox.
// Nothing here runs without a person's click.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../shared.ts";
import { readGraphConfig } from "../../_shared/graph.ts";
import { appAccess, forwardMailboxMessage, getMailboxMessage } from "../../_shared/graph-client.ts";
import { capBody } from "../../_shared/info-mail.ts";

const env = (k: string) => Deno.env.get(k);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function routerGate(ctx: SalesOsContext) {
  const { data, error } = await ctx.asCaller.rpc("is_pipeline_operator", { _user_id: ctx.caller.userId });
  if (error) return err("Could not verify your permissions", 500);
  if (data !== true) return err("Only sales managers, BD and sales ops route info@ mail", 403);
  return null;
}

function mailbox() {
  return (env("INFO_MAILBOX") ?? "").trim().toLowerCase();
}

async function openMessage(ctx: SalesOsContext, id: string) {
  const { data } = await ctx.svc.from("info_mail")
    .select("id, graph_message_id, subject, status, inbox_item_id, category").eq("id", id).maybeSingle();
  return data as { id: string; graph_message_id: string; subject: string | null; status: string; inbox_item_id: string | null; category: string } | null;
}

async function info_mail_forward(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const id = String(payload.id ?? "");
  const toUserId = String(payload.toUserId ?? "");
  if (!UUID.test(id) || !UUID.test(toUserId)) return err("Choose a message and a colleague", 400);
  const denied = await routerGate(ctx);
  if (denied) return denied;
  const box = mailbox();
  const cfg = readGraphConfig(env);
  if (!box || !cfg.configured) return err("The info@ mailbox is not connected yet", 503);

  const m = await openMessage(ctx, id);
  if (!m || m.status !== "new" || m.inbox_item_id) return err("This message was already handled", 409);
  const { data: to } = await ctx.svc.from("profiles").select("email, status").eq("id", toUserId).maybeSingle();
  const address = String(to?.email ?? "").trim().toLowerCase();
  if (!to || to.status !== "active" || !address.endsWith("@phc-sa.com")) {
    return err("You can forward only to an active colleague", 400);
  }
  const { data: me } = await ctx.svc.from("profiles").select("full_name, email").eq("id", ctx.caller.userId).maybeSingle();
  const who = String(me?.full_name || me?.email || "a colleague");

  const tok = await appAccess(cfg);
  if (!tok.ok) return err("The info@ mailbox could not be reached", 502);
  const sent = await forwardMailboxMessage(tok.access, box, m.graph_message_id, address,
    `Routed to you by ${who} from info@ via PHC Command Center.`);
  if (!sent.ok) return err("Outlook refused the forward", 502);

  const { error } = await ctx.svc.rpc("info_mail_record_forward", { _id: id, _to: toUserId, _by: ctx.caller.userId });
  if (error) return err("Forwarded, but it could not be recorded", 500);
  await ctx.audit(ctx.svc, ctx.caller.userId, "info_mail.forwarded", "info_mail", id, { to: toUserId }, ctx.caller.roles);
  return json({ ok: true });
}

async function info_mail_mark_rfq(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const id = String(payload.id ?? "");
  if (!UUID.test(id)) return err("Choose a message", 400);
  const denied = await routerGate(ctx);
  if (denied) return denied;
  const box = mailbox();
  const cfg = readGraphConfig(env);
  if (!box || !cfg.configured) return err("The info@ mailbox is not connected yet", 503);

  const m = await openMessage(ctx, id);
  if (!m || m.status !== "new" || m.inbox_item_id || m.category === "client_reply") {
    return err("This message was already handled", 409);
  }
  const tok = await appAccess(cfg);
  if (!tok.ok) return err("The info@ mailbox could not be reached", 502);
  const detail = await getMailboxMessage(tok.access, box, m.graph_message_id, false);
  if (!detail) return err("The message could not be read from Outlook", 502);

  const { data: item, error } = await ctx.svc.rpc("info_mail_promote", {
    _id: id, _by: ctx.caller.userId, _body: capBody(detail.body) ?? "",
  });
  if (error) return err("The request could not be created", 409);
  await ctx.audit(ctx.svc, ctx.caller.userId, "info_mail.marked_rfq", "info_mail", id, { inbox_item_id: item }, ctx.caller.roles);
  return json({ ok: true, inboxItemId: item });
}

export const infoMailModule: HandlerModule = {
  name: "info-mail",
  handlers: { info_mail_forward, info_mail_mark_rfq },
};
```

Before using it, check that `ctx.audit`'s signature matches the call in `handlers/outlook.ts` (`ctx.audit(ctx.svc, userId, action, entityType, entityId, details, roles)`). If `audit_log`'s entity type is constrained, use whatever `"user"`-style value the existing calls use and put the id in details. Register `infoMailModule` in `sales-os-api/index.ts`, next to `outlookModule`.

- [ ] **Step 3: The browser calls**

```ts
// src/lib/info-mail-actions.ts
// The info@ mailbox from the browser: read through RLS, act through the backend
// (forward, mark as RFQ) or one RPC (dismiss). Never Graph directly.
import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";

export type InfoMailRow = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string;
  category: string;
  summary: string | null;
  status: string;
  web_link: string | null;
  attachment_names: string[];
};
const COLS = "id, from_email, from_name, subject, received_at, category, summary, status, web_link, attachment_names";

/** Messages waiting for a router: not an item, not a reply, not yet handled. */
export async function listOpenInfoMail(): Promise<InfoMailRow[]> {
  const { data, error } = await supabase.from("info_mail").select(COLS)
    .eq("status", "new").is("inbox_item_id", null).neq("category", "client_reply")
    .order("received_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as InfoMailRow[];
}

export async function forwardInfoMail(id: string, toUserId: string): Promise<void> {
  await callBackend("info_mail_forward", { id, toUserId });
}

export async function markInfoMailRfq(id: string): Promise<string> {
  const r = await callBackend<{ inboxItemId?: string }>("info_mail_mark_rfq", { id });
  if (!r?.inboxItemId) throw new Error("The request could not be created");
  return r.inboxItemId;
}

export async function dismissInfoMail(id: string): Promise<void> {
  const { error } = await supabase.rpc("info_mail_dismiss", { _id: id });
  if (error) throw error;
}

/** The email a deal came from (the first request in its info@ conversation), if any. */
export async function sourceEmailFor(opportunityId: string): Promise<(InfoMailRow & { body_text: string | null }) | null> {
  const { data, error } = await supabase.from("info_mail").select(`${COLS}, body_text`)
    .eq("opportunity_id", opportunityId).in("category", ["rfq", "quotation_request"])
    .order("received_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  return (data ?? null) as (InfoMailRow & { body_text: string | null }) | null;
}
```

- [ ] **Step 4: Run**

```bash
deno check --allow-import --config supabase/functions/deno.json supabase/functions/sales-os-api/index.ts
bun test src/lib/info-mail.contract.test.ts && bun run typecheck
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sales-os-api/handlers/info-mail.ts supabase/functions/sales-os-api/index.ts \
  src/lib/info-mail-actions.ts src/lib/info-mail.contract.test.ts
git commit -m "feat(info@): forward and mark-as-RFQ actions for routers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Screens — router list, intake chip, source email, conversion link

**Files:**
- Create: `src/components/phc/InfoMailPanel.tsx`, `src/components/phc/SourceEmailPanel.tsx`
- Modify: `src/routes/_authenticated/lead-tender-inbox.tsx`, `src/components/phc/IntakeReviewPanel.tsx`, `src/routes/_authenticated/opportunities.$id.tsx`, `src/lib/inbox-actions.ts`, `src/lib/i18n.tsx`, `src/components/phc/NotificationCenter.tsx`

**Interfaces:** Consumes Task 5's browser calls and Task 1's `info_mail_link_conversion`.

- [ ] **Step 1: Conversion binds the mail (`inbox-actions.ts`).** At the end of `markConverted`, after the audit call, add:

```ts
  // An item read from info@ brings its email thread to the deal it became
  // (client replies then land on the deal). No info@ mail → 0 rows, no error.
  if (recordType === "opportunity") {
    const { error: linkErr } = await supabase.rpc("info_mail_link_conversion", { _inbox_item_id: id });
    if (linkErr) console.warn("info@ mail could not be linked to the new deal", linkErr.message);
  }
```

- [ ] **Step 2: i18n keys (`src/lib/i18n.tsx`).** Add these next to the matching existing groups (`src_…` near `src_phone_call`, `notif_type_…` near `notif_type_intake_assigned`):

```ts
  src_info_mailbox: { en: "Email to info@", ar: "بريد info@" },
  notif_type_client_reply: { en: "Client replied", ar: "رد العميل" },
  notif_type_mention: { en: "You were mentioned", ar: "تمت الإشارة إليك" },
  notif_type_info_mail_forwarded: { en: "Email forwarded to you", ar: "بريد مُحوَّل إليك" },
```
In `NotificationCenter.tsx`'s `iconFor`, map `client_reply` and `info_mail_forwarded` to the existing mail icon (or `Mail` from lucide-react), and `mention` to `AtSign`. Don't add `info_mailbox` to `INBOX_SOURCE_TYPES`: people never pick it by hand.

- [ ] **Step 3: Intake list chip (`IntakeReviewPanel.tsx`).** Add `source_type, client_rfq_reference, evidence_url` to the review panel's select list (~lines 207-215). In the project-name cell, when `source_type === "info_mailbox"`, render a small chip `t("src_info_mailbox")` next to the name, and the RFQ ref (`client_rfq_reference`) as muted text. In the expanded detail, when `evidence_url` is set, add a field "Source email" with an external link (`target="_blank" rel="noreferrer"`), label `lang === "ar" ? "البريد الأصلي" : "Source email"`. Also check the inbox page's own `select("*")` rows: if it renders its own table, add the same chip there.

- [ ] **Step 4: `InfoMailPanel.tsx`**

```tsx
// src/components/phc/InfoMailPanel.tsx
// =============================================================================
// info@ mail that is not a request (group 3 part B): labelled by the triage
// agent, listed for a router — sales manager, BD or sales ops — who forwards
// each to a colleague, turns it into a request, or dismisses it. Nothing is
// forwarded on its own.
// =============================================================================
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, formatNumber, localeFor } from "@/lib/i18n";
import { dismissInfoMail, forwardInfoMail, listOpenInfoMail, markInfoMailRfq, type InfoMailRow } from "@/lib/info-mail-actions";

const LABEL: Record<string, { en: string; ar: string }> = {
  unclassified: { en: "Being sorted", ar: "قيد الفرز" },
  rfq: { en: "Possible RFQ", ar: "طلب تسعير محتمل" },
  quotation_request: { en: "Possible price request", ar: "طلب سعر محتمل" },
  supplier: { en: "Supplier", ar: "مورّد" },
  finance: { en: "Finance", ar: "مالية" },
  hr: { en: "HR", ar: "موارد بشرية" },
  general: { en: "General", ar: "عام" },
  spam: { en: "Spam", ar: "رسائل مزعجة" },
};
const ORDER = ["rfq", "quotation_request", "general", "supplier", "finance", "hr", "unclassified", "spam"];

export function InfoMailPanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["info-mail-open"], queryFn: listOpenInfoMail, staleTime: 60_000 });
  const people = useQuery({
    queryKey: ["info-mail-colleagues"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles")
        .select("id, full_name, email").eq("status", "active").eq("is_display_account", false).order("full_name");
      if (error) throw error;
      return (data ?? []).filter((p) => String(p.email ?? "").toLowerCase().endsWith("@phc-sa.com"));
    },
  });
  const [busy, setBusy] = useState<string | null>(null);
  const rows = q.data ?? [];
  if (!q.isLoading && !q.isError && rows.length === 0) return null;

  async function act(id: string, run: () => Promise<unknown>, done: string) {
    setBusy(id);
    try {
      await run();
      toast.success(done);
      await qc.invalidateQueries({ queryKey: ["info-mail-open"] });
      await qc.invalidateQueries({ queryKey: ["inbox-items"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const groups = ORDER.map((c) => [c, rows.filter((r) => r.category === c)] as const).filter(([, list]) => list.length);
  const summaryLine = (r: InfoMailRow) => {
    const [en, arLine] = (r.summary ?? "").split("\n");
    return (ar ? arLine || en : en) || r.subject || "";
  };

  return (
    <section aria-labelledby="info-mail-title" className="rounded-xl border border-border bg-surface p-4">
      <h2 id="info-mail-title" className="flex items-center gap-2 font-semibold">
        <Mail className="h-4 w-4" aria-hidden="true" />
        {ar ? "بريد info@ — للتوجيه" : "info@ mail — to route"}
        <span className="num text-sm text-muted-foreground" data-tabular="true">({formatNumber(rows.length, lang)})</span>
      </h2>
      {q.isError ? (
        <button type="button" onClick={() => void q.refetch()} className="mt-2 text-sm text-destructive underline">
          {ar ? "تعذّر التحميل — أعد المحاولة" : "Could not load — try again"}
        </button>
      ) : null}
      {groups.map(([cat, list]) => (
        <div key={cat} className="mt-3">
          <h3 className="text-xs font-medium text-muted-foreground">{LABEL[cat]?.[ar ? "ar" : "en"] ?? cat}</h3>
          <ul className="mt-1 divide-y divide-border/70">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.subject || (ar ? "(بلا عنوان)" : "(no subject)")}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.from_name || r.from_email} · {new Date(r.received_at).toLocaleString(localeFor(lang), { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{summaryLine(r)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {r.web_link ? (
                    <a href={r.web_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
                      Outlook <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : null}
                  <select
                    aria-label={ar ? "حوّل إلى" : "Forward to"}
                    disabled={busy === r.id || !people.data}
                    defaultValue=""
                    onChange={(e) => {
                      const to = e.target.value;
                      const name = (people.data ?? []).find((p) => p.id === to);
                      e.target.value = "";
                      const ask = ar ? `تحويل هذا البريد إلى ${name?.full_name || name?.email}؟` : `Forward this email to ${name?.full_name || name?.email}?`;
                      if (to && window.confirm(ask)) void act(r.id, () => forwardInfoMail(r.id, to), ar ? "حُوِّل البريد" : "Forwarded");
                    }}
                    className="rounded-md border border-border bg-background px-2 py-1"
                  >
                    <option value="">{ar ? "حوّل إلى…" : "Forward to…"}</option>
                    {(people.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                    ))}
                  </select>
                  <button type="button" disabled={busy === r.id}
                    onClick={() => void act(r.id, () => markInfoMailRfq(r.id), ar ? "أُنشئ طلب في الوارد" : "Request created in the inbox")}
                    className="rounded-md border border-border px-2 py-1">
                    {ar ? "هذا طلب تسعير" : "This is an RFQ"}
                  </button>
                  <button type="button" disabled={busy === r.id}
                    onClick={() => void act(r.id, () => dismissInfoMail(r.id), ar ? "أُغلق" : "Dismissed")}
                    className="rounded-md border border-border px-2 py-1 text-muted-foreground">
                    {ar ? "تجاهل" : "Dismiss"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
```
Check whether `profiles.is_display_account` and `full_name` exist in types.ts (the research says `is_display_account` does, from 20260902…). If the profiles query is blocked by RLS for routers, use whatever existing owner-picker helper the app uses (search `assigned_owner_id` pickers or `useProfiles`) instead.

- [ ] **Step 5: Mount it on the inbox page (`lead-tender-inbox.tsx`).** Import `InfoMailPanel` and `canManageSalesPipeline` from `@/lib/roles`, and `useAuth`, if not already there. Render `{canManageSalesPipeline(roles) ? <InfoMailPanel /> : null}` directly under the `KpiRow`.

- [ ] **Step 6: `SourceEmailPanel.tsx`**

```tsx
// src/components/phc/SourceEmailPanel.tsx
// The email a deal came from, when it arrived at info@ (group 3 part B): who,
// when, the text, attachment names, and the thread in Outlook. Later client
// replies appear in the Correspondence panel below it.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Mail } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { useI18n, localeFor } from "@/lib/i18n";
import { sourceEmailFor } from "@/lib/info-mail-actions";

export function SourceEmailPanel({ opportunityId }: { opportunityId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["source-email", opportunityId], queryFn: () => sourceEmailFor(opportunityId), staleTime: 5 * 60_000 });
  const m = q.data;
  if (!m) return null;
  return (
    <Panel title={ar ? "البريد الأصلي" : "Source email"}>
      <div className="space-y-2 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Mail className="h-4 w-4" aria-hidden="true" />
          {m.subject || (ar ? "(بلا عنوان)" : "(no subject)")}
        </p>
        <p className="text-xs text-muted-foreground">
          {m.from_name || m.from_email} · {new Date(m.received_at).toLocaleString(localeFor(lang), { dateStyle: "medium", timeStyle: "short" })}
        </p>
        {m.attachment_names.length ? (
          <p className="text-xs text-muted-foreground">{(ar ? "المرفقات: " : "Attachments: ") + m.attachment_names.join(", ")}</p>
        ) : null}
        <div className="flex flex-wrap gap-2 text-xs">
          {m.web_link ? (
            <a href={m.web_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
              {ar ? "افتح في Outlook" : "Open in Outlook"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
          {m.body_text ? (
            <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-md border border-border px-2 py-1" aria-expanded={open}>
              {open ? (ar ? "إخفاء النص" : "Hide text") : (ar ? "عرض النص" : "Show email text")}
            </button>
          ) : null}
        </div>
        {open && m.body_text ? <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs" dir="auto">{m.body_text}</pre> : null}
      </div>
    </Panel>
  );
}
```
In `opportunities.$id.tsx`, import it and render `<SourceEmailPanel opportunityId={o.id} />` immediately before the `{/* 7c2. CORRESPONDENCE …*/}` comment and `<DealCorrespondencePanel …/>`.

- [ ] **Step 7: Verify**

```bash
bun run verify 2>&1 | tail -6
```
Expected: pass. Start the dev server with the preview tool if one is configured and look at `/lead-tender-inbox` as a signed-in router (the panel hides itself when empty). If no signed-in session is possible, say so in the report.

- [ ] **Step 8: Commit**

```bash
git add src/components/phc/InfoMailPanel.tsx src/components/phc/SourceEmailPanel.tsx src/routes/_authenticated/lead-tender-inbox.tsx \
  src/components/phc/IntakeReviewPanel.tsx src/routes/_authenticated/opportunities.\$id.tsx src/lib/inbox-actions.ts \
  src/lib/i18n.tsx src/components/phc/NotificationCenter.tsx
git commit -m "feat(info@): router list, source email on the deal, intake chip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CC and @mention in the send window

**Files:**
- Modify: `src/components/phc/EmailComposeModal.tsx`, `src/lib/mail-actions.ts`, `supabase/functions/sales-os-api/handlers/mail.ts`, `src/lib/info-mail.contract.test.ts` (append)

CC already exists in the modal (comma-separated `cc` field) and in `send_email` (`email_cc`). This task adds **@mention** only.

- [ ] **Step 1: Contract test (append)**

```ts
describe("@mentions on a sent email", () => {
  const MAIL = read("supabase/functions/sales-os-api/handlers/mail.ts");
  it("notifies through notify_mentions as the caller, after the email is recorded", () => {
    const insert = MAIL.indexOf('from("activities").insert(');
    const mention = MAIL.indexOf('ctx.asCaller.rpc("notify_mentions"');
    expect(mention).toBeGreaterThan(insert);
  });
  it("mentions are read only after the email is recorded, so they can never reach the recipients", () => {
    const fn = MAIL.slice(MAIL.indexOf("async function send_email"));
    expect(fn.indexOf("payload.mentions")).toBeGreaterThan(fn.indexOf('from("activities").insert('));
  });
});
```

- [ ] **Step 2: `mail-actions.ts`.** Add `mentions?: string[];` to `SendEmailInput`, and forward it in `sendEmail`'s payload as `mentions: input.mentions ?? []`.

- [ ] **Step 3: `send_email` (`handlers/mail.ts`).** After the activity insert (never earlier, so a mention cannot leak into the recipients), read `payload.mentions` as a list of UUID strings (`Array.isArray(payload.mentions) ? payload.mentions.filter((x) => typeof x === "string" && UUID.test(x)).slice(0, 10) : []`, defining `UUID` as in Task 5). After the activity insert succeeds and `opportunityId` is set, add:

```ts
  // @mentions: an in-system note to colleagues who can read the deal — never a
  // copy of the email (they are not recipients). Failure never undoes the send.
  let mentioned = 0;
  if (mentions.length && activity?.id && opportunityId) {
    const { data: n, error: mErr } = await ctx.asCaller.rpc("notify_mentions", { _activity_id: activity.id, _users: mentions });
    if (!mErr && typeof n === "number") mentioned = n;
  }
```
and include `mentioned` in the JSON result. Use the variable names the handler already has (`activity`, `opportunityId`); read it first.

- [ ] **Step 4: The modal (`EmailComposeModal.tsx`).** When `linked?.opportunityId` is set, show a "Mention" field under CC: a multi-select of active colleagues. Reuse the colleague query from `InfoMailPanel` by moving it into `src/lib/info-mail-actions.ts` as `export async function listColleagues(): Promise<Array<{ id: string; full_name: string | null; email: string | null }>>` and using it in both places. Render the chosen people as removable chips. Label: `ar ? "إشارة (تنبيه داخل النظام فقط)" : "Mention (in-system notice only)"`. Pass `mentions: selectedIds` to `sendEmail`. After a successful send with `r.mentioned > 0`, add `ar ? \` · نُبّه ${formatNumber(r.mentioned, lang)}\` : \` · ${formatNumber(r.mentioned, lang)} notified\`` to the success toast. Keep the existing To, CC, Subject and Body behaviour unchanged.

- [ ] **Step 5: Verify and commit**

```bash
deno check --allow-import --config supabase/functions/deno.json supabase/functions/sales-os-api/index.ts
bun test src/lib/info-mail.contract.test.ts && bun run verify 2>&1 | tail -4
git add src/components/phc/EmailComposeModal.tsx src/lib/mail-actions.ts src/lib/info-mail-actions.ts \
  src/components/phc/InfoMailPanel.tsx supabase/functions/sales-os-api/handlers/mail.ts src/lib/info-mail.contract.test.ts
git commit -m "feat(mail): @mention colleagues on a sent email (in-system notice)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Setup guide and docs

**Files:** `docs/info-mailbox-setup.md` (new), `docs/USER_GUIDE.md`, `docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/AI_HANDOFF.md`, `tasks/current.md`

- [ ] **Step 1: `docs/info-mailbox-setup.md`** with exactly these sections:
  1. **What this does.** One paragraph.
  2. **Exchange (Mo, once, ~15 min).** In PowerShell, as an Exchange admin (Organization Management):
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
     **Do not** add Mail.Read or Mail.Send as *Application* permissions in Entra. The Entra grant and the Exchange grant add up, and an Entra grant would reach every mailbox. Changes take 30 minutes to 2 hours to apply (Exchange's cache).
  3. **Sales can open the thread in Outlook.** `Add-MailboxFolderPermission -Identity "info@phc-sa.com:\Inbox" -User <PHC-Sales-Mail, or each rep> -AccessRights Reviewer`. Read-only; this needs a mail-enabled group, so if the group isn't mail-enabled, run it once per rep.
  4. **Turn it on.** `supabase secrets set INFO_MAILBOX=info@phc-sa.com`. The info@ profile in the system must stay **active**: it is the requester the AI usage is counted against (300 a day).
  5. **Check it.** Send a test RFQ to info@ from an outside address. Within about 10 minutes it should appear in Lead & Tender Inbox with the "Email to info@" chip. Run `select last_run_at, last_error from info_mailbox_state;` in the SQL editor.
  6. **Turn it off.** `supabase secrets unset INFO_MAILBOX`; optionally `Remove-ManagementRoleAssignment` for the two assignments.

- [ ] **Step 2: USER_GUIDE.**
  - Section 5, Step 1: one paragraph on "Requests that arrive at info@". The system reads info@ every 5 minutes. A quotation request or RFQ becomes a request in the inbox with location, client RFQ number, estimated value and scope filled in where the email states them, assigned to the client's account owner (or waiting for the sales manager to assign). Everything else waits in **info@ mail — to route** at the top of the inbox page, where a sales manager, BD or sales ops forwards it to a colleague's Outlook, turns it into a request, or dismisses it.
  - Section 7, "Inside an opportunity": a **Source email** panel with **Open in Outlook**. Later client replies to info@ appear under Correspondence and notify whoever entered or owns the project.
  - The send window: **Mention** tells colleagues inside the system; it doesn't copy them on the email. Use **CC** for that.
  - Section 10, a new subsection "### The info@ mailbox (2026-10-23)" with the limits:
    - Needs the Exchange setup in `docs/info-mailbox-setup.md`.
    - A reply from your own Outlook starts a new email "RE: …"; it does not continue the info@ thread in the client's inbox.
    - CVs, invoices and other non-request mail keep only sender, subject, label and one line; the text stays in Outlook.
    - Attachments are listed by name, not stored.
    - The AI sorts; a request it is unsure of (below 70%) waits in the list for a person.
  - Update the footer line.
- [ ] **Step 3: DECISIONS.md** (one line each, dated 2026-10-23):
  - The info@ mailbox is read with app-only access limited to info@ by Exchange RBAC for Applications. There is no Entra Mail permission, so reps' mailboxes stay out of reach.
  - The orchestrator's first service caller is the info@ pass. It is authenticated by the outlook-sync Vault key, runs as the info@ profile, and may only run agents marked `serviceCallable` (today only `info_mail_triage`).
  - Non-request info@ mail never stores its text.
  - An info@ conversation binds to its deal through `info_mail`, not `email_threads`.
- [ ] **Step 4: CHANGELOG, AI_HANDOFF, tasks/current.md.** Add entries in the style of Part A's. State: not deployed; it needs `db push` (two migrations), deploys of `ai-orchestrator`, `outlook-sync` and `sales-os-api`, Mo's Exchange setup and the `INFO_MAILBOX` secret; and it has not been tried against the real mailbox.
- [ ] **Step 5:** `bun test src/lib/arabic-digits.test.ts src/lib/messages.test.ts`, then commit `docs: info@ mailbox — setup guide, user guide, decisions`.

---

### Task 9: Push and open PR B

- [ ] **Step 1:** `bun run verify && bun run test:deno` — all green.
- [ ] **Step 2:** Push as `mophc-sa` (same commands as Part A Task 6) to branch `feat/info-mailbox`.
- [ ] **Step 3:** Open the PR with base `feat/manager-actions` while PR A is open, otherwise `main`. Title: "info@ mailbox: RFQs to sales, the rest routed, source email on the project (group 3, part B)". The body lists what it does, the release order (db push → deploy ai-orchestrator, outlook-sync, sales-os-api → Mo's Exchange setup → `INFO_MAILBOX` → first pass watched → UI), and links to `docs/info-mailbox-setup.md`. End it with the Claude Code line. Switch back to `moalagab`.
- [ ] **Step 4:** Bind the PR with the ccd_pr tools and read its CI. The pgTAP job must pass before anyone asks for review.
