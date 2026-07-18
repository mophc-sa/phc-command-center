# PHC Command Center

Internal bilingual sales command center for PHC Wayfinding Signs. The application uses TanStack Start, React, Supabase/Postgres, Supabase Edge Functions, and Cloudflare Workers.

## Safety boundary

- The production Supabase project is `lrfdtoexyeghrzynapyn`.
- Never modify the legacy project `xpoduufwoklvsbuhywsv`.
- Migrations and Edge Functions are deployed manually after explicit approval. Merging `main` does not deploy Supabase resources.
- Never place service keys, production credentials, or real employee passwords in Git, logs, screenshots, or chat.

See [deployment governance](docs/deployment-governance.md) before any release.

## Prerequisites

- Bun `1.3.14`
- Docker Desktop for local Supabase database tests
- Supabase CLI for `test:db`
- A local `.env.local` copied from `.env.example`

## Local setup

```powershell
Copy-Item ".env.example" ".env.local"
bun install --frozen-lockfile
bun run dev
```

Fill only publishable/local values in `.env.local`. Privileged keys belong in the server secret store, never in a `VITE_*` variable.

## Verification

```powershell
bun run typecheck
bun run lint
bun run test
bun run build
```

Run the complete local application gate with `bun run verify`.

Database verification runs against an isolated local Supabase instance:

```powershell
supabase start
bun run test:db
supabase stop --no-backup
```

The ordinary Playwright suite skips roles without credentials. The manual `Production Readiness` workflow first verifies that every dedicated test credential is present and fails instead of skipping.

## Architecture

```text
Browser UI
  -> Supabase publishable client + RLS
  -> authenticated TanStack server functions
  -> OAuth-protected read-only MCP tools

Supabase
  -> Postgres migrations, RLS, approval RPCs, audit log
  -> sales-os-api, import-pipeline, ai-orchestrator, error-ingest

External
  -> AI providers through ai-orchestrator only
  -> Cloudflare Worker runtime
  -> Lovable project synchronization
```

The browser never receives a service key. Commercial approval authority is separate from `system_admin`. AI outputs are recommendations or drafts and must not directly mutate live CRM records.

## CI gates

- `CI`: typecheck, unit/contract tests, production build, optional smoke E2E.
- `Security`: Gitleaks, dependency audit, CodeQL, local migration replay, database lint, pgTAP security tests.
- `Production Readiness`: manual, protected environment, mandatory role/account-state E2E matrix.

## Troubleshooting

- Missing Supabase variables: copy `.env.example` to `.env.local` and provide the publishable values.
- Database tests unavailable: confirm Docker is running and `supabase status` succeeds.
- MCP routes changed: regenerate them in Lovable or set `ENABLE_LOVABLE_MCP=true` in an environment where the upstream Windows path issue does not apply.
- Production release questions: stop and follow `docs/deployment-governance.md`; do not infer approval.
