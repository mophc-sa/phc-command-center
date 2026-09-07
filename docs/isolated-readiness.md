# Isolated role and account tests

The `Isolated Readiness` workflow runs Supabase on the GitHub-hosted runner and
builds the app against its loopback API. It creates 13 synthetic accounts and
five verified TOTP factors with fresh credentials per run. It uses no repository
secrets, production accounts, hosted Supabase project, or paid Supabase plan.
GitHub Actions usage remains subject to the repository's existing quota.

The provisioner rejects every endpoint except `http://127.0.0.1:56321`. Accounts,
sessions, and database volumes are removed on completion. Authentication traces
are not uploaded. The same role/account-state suite must pass without skips.

This is not evidence that production or the canary works. Existing deployment
readiness gates remain in force until a separately verified replacement is
integrated. Do not suspend production test accounts merely because this workflow
has been added: first obtain a passing isolated run, replace all callers that
still use those accounts, and verify the release gates. No production account
was changed while preparing this workflow.
