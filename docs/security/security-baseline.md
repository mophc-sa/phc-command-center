# Security baseline

This document defines the minimum merge and release gates for PHC Command Center.

## Merge gates

- TypeScript, unit/contract tests, and production build pass.
- Gitleaks finds no committed credential.
- CodeQL has no unresolved high/critical finding introduced by the change.
- Dependency audit has no unresolved high/critical production vulnerability.
- A fresh local Supabase instance applies the complete migration chain.
- Database lint and pgTAP security tests pass.

## Release gates

- The protected `Production Readiness` workflow passes with every dedicated role and account-state credential present.
- Migration preflight identifies the target project as `lrfdtoexyeghrzynapyn` and produces a reviewed pending-migration list.
- A backup/restore point and forward-fix or rollback procedure are recorded.
- Edge Functions are deployed one at a time, by name, after approval.
- Post-deploy probes verify authentication, RLS, critical RPCs, error ingestion, and audit events.

## Security invariants

- `system_admin` has technical authority but no implicit commercial approval authority.
- Browser code uses only a publishable Supabase key.
- Service clients are server-only and every privileged use case performs explicit authorization and audit logging.
- Every Data API RPC requires an explicit role grant in its defining migration;
  new public functions are not executable by application roles by default.
- AI never sends communications, deletes records, commits imports, or mutates live CRM entities directly.
- Hard delete requires prior commercial approval and atomic server-side execution.
- Production CORS is restricted to `CORS_ALLOWED_ORIGIN`; local and preview environments must set their own explicit origin.

## Tracked database-advisor exceptions

- `public.vendors_public` is intentionally a `security_definer` view for the
  current release. It exposes a reviewed, non-sensitive vendor projection to
  signed-in sales users while the base `vendors` table remains manager-only.
  Changing it to `security_invoker` without redesigning the storage boundary
  would either break the sales workflow or expose sensitive base-table
  columns. Replace it with a dedicated safe projection table or an equivalent
  least-privilege boundary before removing this exception.
- Authenticated `security_definer` authorization helpers used inside RLS are
  intentional for now. Moving them to a private schema is a separate migration
  that must preserve every policy dependency and pass the complete role matrix.
- Performance advisor findings for per-row auth evaluation and overlapping
  permissive policies are tracked as performance work; they must be fixed in
  reviewed batches, not mixed into an access-control migration.

## Required GitHub configuration

1. Protect `main` and require `typecheck-build`, `secrets`, `dependencies`, `codeql`, and `supabase` checks.
2. Create a protected environment named `production-readiness`.
3. Store only dedicated non-production test accounts in that environment.
4. Enable GitHub secret scanning and push protection where the plan supports them.
5. Require approval for production environments and keep Supabase auto-deploy disabled.

## Incident minimum

Every critical path must have an owner, alert, containment action, and recovery procedure. Rotate leaked keys immediately; suspend affected accounts; preserve audit evidence; and verify all consumers after rotation.
