# Playwright role-matrix test account setup

One-time setup guide for Phase B checklist item 7.
Complete these steps once; CI will exercise all role tests on every PR thereafter.

---

## Overview

Nine dedicated non-production accounts cover every test scenario:

| Account email | Role | Status | GitHub secret (EMAIL / PASSWORD) |
|---|---|---|---|
| pw-system-admin@phc-playwright.test | system_admin | active | TEST_SYSTEM_ADMIN_* |
| pw-managing-director@phc-playwright.test | managing_director | active | TEST_MANAGING_DIRECTOR_* |
| pw-general-manager@phc-playwright.test | general_manager | active | TEST_GENERAL_MANAGER_* |
| pw-sales-manager@phc-playwright.test | sales_manager | active | TEST_SALES_MANAGER_* |
| pw-bd-manager@phc-playwright.test | bd_manager | active | TEST_BD_MANAGER_* |
| pw-salesperson@phc-playwright.test | salesperson | active | TEST_SALESPERSON_* |
| pw-viewer@phc-playwright.test | viewer | active | TEST_VIEWER_* |
| pw-pending@phc-playwright.test | *(none)* | pending_approval | TEST_PENDING_* |
| pw-suspended@phc-playwright.test | *(none)* | suspended | TEST_SUSPENDED_* |

These are **non-production test accounts only** — never real employees, never shared mailboxes.
The `.test` TLD is reserved and will never receive real email.

---

## Step 1 — Create the accounts in Supabase

Go to **Supabase Dashboard → Authentication → Users → Create new user**.
For each of the 9 accounts:

1. Enter the email from the table above.
2. Enter a strong random password (generate with a password manager — 24+ chars).
3. **Disable "Send email confirmation"** (the `.test` domain is unreachable).
4. Click **Create user**.

Repeat for all 9.

---

## Step 2 — Apply the provisioning migration

Once all 9 users are created, apply the migration in **Supabase Dashboard → SQL Editor**:

```
supabase/migrations/20260713150000_playwright_test_accounts.sql
```

Copy-paste the file contents and run it. You should see 9 `NOTICE` lines confirming each account.

Verify with the query at the bottom of the migration file — should return 9 rows with the correct roles and statuses.

---

## Step 3 — Set GitHub Actions secrets

Go to **GitHub → mophc-sa/phc-command-center → Settings → Secrets and variables → Actions**.

Add these secrets (the CI workflow already references them):

| Secret name | Value |
|---|---|
| `TEST_APP_URL` | Deployed app URL, e.g. `https://phc-command-center.lovable.app` |
| `TEST_SYSTEM_ADMIN_EMAIL` | `pw-system-admin@phc-playwright.test` |
| `TEST_SYSTEM_ADMIN_PASSWORD` | *(the password you chose in Step 1)* |
| `TEST_MANAGING_DIRECTOR_EMAIL` | `pw-managing-director@phc-playwright.test` |
| `TEST_MANAGING_DIRECTOR_PASSWORD` | *(password)* |
| `TEST_GENERAL_MANAGER_EMAIL` | `pw-general-manager@phc-playwright.test` |
| `TEST_GENERAL_MANAGER_PASSWORD` | *(password)* |
| `TEST_SALES_MANAGER_EMAIL` | `pw-sales-manager@phc-playwright.test` |
| `TEST_SALES_MANAGER_PASSWORD` | *(password)* |
| `TEST_BD_MANAGER_EMAIL` | `pw-bd-manager@phc-playwright.test` |
| `TEST_BD_MANAGER_PASSWORD` | *(password)* |
| `TEST_SALESPERSON_EMAIL` | `pw-salesperson@phc-playwright.test` |
| `TEST_SALESPERSON_PASSWORD` | *(password)* |
| `TEST_VIEWER_EMAIL` | `pw-viewer@phc-playwright.test` |
| `TEST_VIEWER_PASSWORD` | *(password)* |
| `TEST_PENDING_EMAIL` | `pw-pending@phc-playwright.test` |
| `TEST_PENDING_PASSWORD` | *(password)* |
| `TEST_SUSPENDED_EMAIL` | `pw-suspended@phc-playwright.test` |
| `TEST_SUSPENDED_PASSWORD` | *(password)* |

---

## Step 4 — Trigger CI and verify

Push any commit to a PR (or use **Actions → Run workflow**). The `playwright-smoke` job should now run all role-matrix and auth-guard tests without skipping.

Expected result: all tests pass. If a test fails:
- Check the test account's role and status using the verification query in the migration file.
- Check that `TEST_APP_URL` points to the correct deployed instance.
- Check that the password in the GitHub secret matches what was set in Supabase.

---

## Maintenance notes

- **Never commit passwords** — they live only in GitHub Actions secrets.
- **Never reuse real employee emails** — the `pw-*@phc-playwright.test` namespace is reserved for test accounts.
- If a test account's password needs rotating: update the Supabase user's password in the Dashboard, then update the corresponding GitHub secret.
- The `pw-suspended` account must stay `status = suspended` — if a Playwright run accidentally activates it, re-run the migration to reset it.
- The `pw-pending` account must stay `status = pending_approval` with no role — same rule.
