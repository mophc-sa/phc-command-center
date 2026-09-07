# Isolated role and account tests

The `Isolated Readiness` workflow runs Supabase on the GitHub-hosted runner and
builds the app against its loopback API. It creates 13 synthetic accounts and
five verified TOTP factors with fresh credentials per run. It uses no repository
secrets, production accounts, hosted Supabase project, or paid Supabase plan.
GitHub Actions usage remains subject to the repository's existing quota.

The provisioner rejects every endpoint except `http://127.0.0.1:56321`. Accounts,
sessions, and database volumes are removed on completion. Authentication traces
are not uploaded. The same role/account-state suite must pass without skips.

Production Readiness requires this isolated suite and then runs eleven deployed
public login / unauthenticated-route checks. Neither job reads production test
credentials. CI smoke also no longer reads TEST_* repository secrets. Canary
identity is still checked before and after the deployed check, and production
release evidence requires CI, Security and Isolated Readiness for the same main
SHA plus a matching canary receipt and successful readiness workflow.

Limits: these checks do not certify authenticated journeys against production's
actual data/configuration. The isolated suite tests the migrated schema from the
release commit. Production migration parity and a real-user smoke check remain
part of release acceptance. No production account should be retired until this
workflow change is merged and its replacement readiness run succeeds.
