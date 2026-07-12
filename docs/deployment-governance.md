# PHC AGENT Deployment Governance

## Environment
Production Supabase project:
lrfdtoexyeghrzynapyn

Legacy backend:
xpoduufwoklvsbuhywsv
Must never be modified or deployed to.

## Core Rule
Merging to main must not automatically deploy:
- Supabase Edge Functions
- Database migrations
- Production secrets or configuration

Every production change requires an explicit approval gate.

## Approved Release Flow
1. Feature branch
2. Draft PR
3. Code review
4. CI:
   - typecheck-build
   - playwright-smoke
5. Migration preflight
6. Explicit approval for db push
7. Post-migration verification
8. Explicit approval for Edge Function deploy
9. Controlled UAT
10. Merge to main
11. Post-merge verification

## Database Rules
Never use:
- db reset
- migration repair
- force flags
- destructive cleanup
without explicit approval.

Only apply reviewed pending migrations to:
lrfdtoexyeghrzynapyn

## Edge Function Rules
Deploy only explicitly named functions.
Never deploy all functions as a side effect.
Record:
- function name
- version
- timestamp
- source commit
- project ref

## Privileged Server Keys
Following a legacy `service_role` JWT exposure incident during Sprint 10 (see
the exposure assessment), all privileged server clients resolve their
Supabase API key through a single shared resolver
(`supabase/functions/_shared/service-key-resolver.ts`), never by reading an
environment variable directly:

- **Preferred**: the new-format opaque secret key, `sb_secret_...`, read from
  `SUPABASE_SECRET_KEYS["default"]` — a JSON dictionary Supabase injects
  automatically into every Edge Function's runtime. `ai-orchestrator`,
  `sales-os-api`, and `import-pipeline` all resolve through this same path
  via the shared `serviceClient()` function — none duplicates the parsing.
- **Cloudflare SSR admin client** (`src/integrations/supabase/client.server.ts`):
  Cloudflare Workers has no natural notion of Supabase's JSON-dictionary
  injection, so this client's key must be provided as a **new, server-only
  Worker secret** whose value is an `sb_secret_...` key, stored under the
  same variable name already in use today (`SUPABASE_SERVICE_ROLE_KEY`) to
  avoid unnecessary deployment/config churn — only the *value* changes, not
  the name.
- **`SUPABASE_SERVICE_ROLE_KEY` (legacy JWT) fallback**: temporary and
  deprecated. It is used only when `SUPABASE_SECRET_KEYS` is not set at all
  — never as a silent fallback when the new variable is present but
  misconfigured, which is treated as a hard configuration error instead.
- **Legacy API Keys must not be disabled on the project** until every
  privileged path (all three Edge Functions and the Cloudflare SSR admin
  client) has been confirmed running on the new `sb_secret_` key and passed
  UAT — disabling legacy keys before that would break whichever consumer is
  still on the fallback path.
- **No key value may ever be copied into chat, logs, Git, or command
  output.** Do not run `supabase projects api-keys` (or any equivalent
  command known to print raw key values) except with output redirected
  directly to a file outside version control, immediately followed by
  programmatic extraction and secure deletion — never display the raw
  output in a terminal or tool result.

## Auto-Deploy Policy
Supabase GitHub auto-deploy should remain disabled for production.
GitHub may run CI checks automatically, but production deployment must remain manual and approval-gated.

## Safety Rules
Never:
- touch old backend xpoduufwoklvsbuhywsv
- change user roles without approval
- run run_automations without approval
- cleanup demo/UAT data without approval
- import/commit CRM data without approval
- execute hard-delete RPC during routine UAT

## Rollback
Every release report must include:
- previous function version
- new function version
- migration version
- rollback path
- verification results
