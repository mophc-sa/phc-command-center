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
- AI never sends communications, deletes records, commits imports, or mutates live CRM entities directly.
- Hard delete requires prior commercial approval and atomic server-side execution.
- Production CORS is restricted to `CORS_ALLOWED_ORIGIN`; local and preview environments must set their own explicit origin.

## Required GitHub configuration

1. Protect `main` and require `typecheck-build`, `secrets`, `dependencies`, `codeql`, and `supabase` checks.
2. Create a protected environment named `production-readiness`.
3. Store only dedicated non-production test accounts in that environment.
4. Enable GitHub secret scanning and push protection where the plan supports them.
5. Require approval for production environments and keep Supabase auto-deploy disabled.

## Incident minimum

Every critical path must have an owner, alert, containment action, and recovery procedure. Rotate leaked keys immediately; suspend affected accounts; preserve audit evidence; and verify all consumers after rotation.
