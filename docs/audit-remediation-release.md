# Audit remediation release — 2026-09-07

The branch closes the reproducible code defects in audit F01–F16. It is a coordinated
DB/Edge/frontend release, not a claim that the production deployment has already changed.
Base: `ec89d123ba9953a3f37de75a96e0f67fdbe9773b`.

| Findings | Implementation | Verification |
|---|---|---|
| F01–F03 | Profile administrative guard, active-role predicates, restrictive session policies, shared Edge account/MFA checks | SQL inactive/AAL1/AAL2/bootstrap assertions; HTTP boundary tests |
| F04–F05 | Initial pending approval state, immutable reviewed terms/scope/receipts | Direct SQL bypass attempts and positive first approval |
| F06 | Central batch authorization, file/batch/object-path binding, caller-scoped Storage and historical dedup reads | All nine actions reject foreign batch; own report succeeds |
| F07/F15 | Vendor SheetJS 0.20.3, lock integrity, bounded sheet read, RFC CSV parser, excluded-sheet warning | Real XLSX Arabic/newline round-trip; CSV malformed and escaping cases |
| F08 | Locked `convert_lead_atomic`, caller JWT, audit within transaction | Failed review leaves no orphan; retry creates one opportunity |
| F09 | `commit_import_batch_atomic`, unique candidate receipts, snapshots, `rollback_import_batch_atomic` | Injected receipt/finalization failure, retry, restored updates, conflict preservation |
| F10–F11 | Complete ordered pagination; full candidate-set validation; explicit unavailable metrics | 1501-row Edge and 1201-row dashboard tests, limits/errors rejected |
| F12 | Four Edge entrypoints checked; normalized contact path no invalid error shape | Deno check and tests |
| F13 | Matching commercial capabilities and documented BD executor in SQL | Every additive role combination; DB executor still demands approval |
| F14 | Validated canonical sales_stage input and legacy alias | MCP query tested with and without stage |
| F16 | Security merge checks, exact false-positive fingerprints, strict readiness, SHA-bound release receipts | Full-history Gitleaks; readiness/evidence regression tests; GitHub checks |

## Deployment sequence

Follow `docs/deployment-governance.md`. This document is a reviewable deployment package,
not authorization to run remote migrations or change production traffic.

1. Review/merge the PR after required CI/Security checks succeed. Capture the actual main
   release SHA. Confirm backup/PITR and current migration history for `lrfdtoexyeghrzynapyn`.
2. Apply, in order, the four new migrations:
   - `20260928100000_audit_access_boundaries.sql`
   - `20260928110000_audit_atomic_operations.sql`
   - `20260928120000_audit_delete_capability_parity.sql`
   - `20260928130000_notifications_explicit_read_grant.sql`
3. Deploy the named Edge Functions from that same SHA: `sales-os-api`, `ai-orchestrator`,
   and `import-pipeline`. The first two share the changed caller-resolution boundary.
   `error-ingest` is checked but needs no separate release for this patch.
4. Upload the Cloudflare canary. Run Production Readiness on its canary URL from the same
   main SHA. It checks CI/Security success and that the current canary receipt matches.
   It rechecks the receipt after the suite, and publishes readiness evidence only on success.
5. Dispatch production cutover with the explicit domain confirmation. The new gate refuses
   failed security, another SHA's canary, or readiness older than the latest canary upload.
6. Verify pending/suspended denial, AAL1 denial and AAL2 access; submit a normal approval,
   try a small synthetic import with a deliberate invalid candidate, repeat the commit, and
   verify the receipt count. Use test records/accounts, then inspect real service logs.

## Readiness configuration

The protected `production-readiness` environment runs a required isolated
role/account/MFA job and then deployed public login and unauthenticated guards.
Credentials are generated only on the disposable runner. No TEST_* production
account secrets are required. Canary receipts still bind the tests to the release
SHA. See `docs/isolated-readiness.md` for the replacement and its limits.

## Limits and rollback

- Live authenticated journeys and production SQL/Edge parity require the protected test
  credentials and explicit release execution; local fixtures cannot certify those environments.
- Existing imports have no invented before-images. Legacy receipts require manual review.
  A conflicting/blocked rollback remains committed/retryable and reports unresolved records.
- Contact normalization remains the existing shared implementation. Bad candidate writes
  fail independently, while a failure to record final batch state aborts the transaction.
- Keep all new receipts/snapshots during rollback. Restore an earlier Worker/Edge version
  only after confirming RPC compatibility. Do not drop columns, rewrite migration history,
  reset account status, remove MFA boundaries, or replay completed imports as a rollback.
- Reverse a newly imported update only through snapshot/conflict checking. A production
  schema regression needs a reviewed forward repair migration; data recovery uses the
  captured backup/PITR if a reviewed repair is insufficient.
- Existing lint warnings and large legacy UI modules remain technical debt. This patch does
  not replace the business architecture or claim full penetration-test coverage.

## Recorded local verification and repository configuration

- `bun run verify`: 2,656 tests passed; typecheck/build passed; lint 0 errors,
  147 pre-existing warnings.
- All 160 migrations replayed in an isolated local Postgres; 948 behavioral/pgTAP checks
  passed, including 40 new regression assertions. The harness also checks SQL exit status
  and a complete TAP plan.
- Deno checked all four entrypoints with an isolated dependency config and frozen lock;
  13 tests passed, including an actual XLSX round-trip and mocked HTTP auth/ownership checks.
- `bun audit --audit-level=high` passed. Gitleaks 8.30.1 scanned the full repository history
  and found no leaks after the 13 exact verified false-positive fingerprints.
- GitHub Protect Main ruleset 18672203 was updated and read back: required checks are
  typecheck-build, playwright-smoke, Secret scan, Dependency audit, CodeQL, and Supabase
  migrations and database tests. Existing review count and other settings were preserved.
- Read-only checks of repository and production-readiness secret names found 11 missing:
  CEO/FINANCE_MANAGER/ESTIMATION_MANAGER EMAIL and PASSWORD pairs, plus the five TOTP
  secrets listed above. No secret values were read or changed. Until provisioned, live
  readiness deliberately fails rather than silently skipping those accounts.

## Disposable readiness without a hosted test project

`Isolated Readiness` creates a runner-local Supabase instance, 13 temporary users and
five verified MFA factors. See `docs/isolated-readiness.md`. This avoids a Supabase
upgrade and exposes missing default grants on a clean schema. The deployed public boundary checks remain separate; authenticated production journeys
require real-user release acceptance. Retire test accounts only after the replacement
workflow has passed on main.
