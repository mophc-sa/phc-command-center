# Playwright role-matrix test account setup

One-time setup guide for Phase B checklist item 7.
Complete these steps once; CI will exercise all role tests on every PR thereafter.

> **2026-08-02 domain migration**: the `@phc-playwright.test` allowlist
> carve-out was removed from `enforce_signup_email_domain()`
> (`20260802130000_tighten_signup_email_domain_allowlist.sql`) as part of a
> security hardening pass. Existing `pw-*@phc-playwright.test` accounts keep
> working (the trigger only blocks new inserts/email-changes), but must be
> **renamed** to the `pw-*+test@phc-sa.com` addresses below — via Supabase
> Dashboard → Authentication → Users → Edit user → Email, which preserves
> the user id — before the companion migration
> (`20260802130100_playwright_test_accounts_phc_sa_domain.sql`) can
> re-provision their roles. Until renamed, that migration is a harmless
> no-op (`NOTICE`s only). The GitHub Actions `TEST_*_EMAIL` secrets must be
> updated to match at the same time.

## Overview

Ten dedicated non-production accounts cover every test scenario (a 10th,
sales_ops, was added after this doc's original nine-account roster and is
included below):

| Account email | Role | Status | GitHub secret (EMAIL / PASSWORD) |
|---|---|---|---|
| pw-system-admin+test@phc-sa.com | system_admin | active | TEST_SYSTEM_ADMIN_* |
| pw-managing-director+test@phc-sa.com | managing_director | active | TEST_MANAGING_DIRECTOR_* |
| pw-general-manager+test@phc-sa.com | general_manager | active | TEST_GENERAL_MANAGER_* |
| pw-sales-manager+test@phc-sa.com | sales_manager | active | TEST_SALES_MANAGER_* |
| pw-bd-manager+test@phc-sa.com | bd_manager | active | TEST_BD_MANAGER_* |
| pw-sales-ops+test@phc-sa.com | sales_ops | active | TEST_SALES_OPS_* |
| pw-salesperson+test@phc-sa.com | salesperson | active | TEST_SALESPERSON_* |
| pw-viewer+test@phc-sa.com | viewer | active | TEST_VIEWER_* |
| pw-pending+test@phc-sa.com | *(none)* | pending_approval | TEST_PENDING_* |
| pw-suspended+test@phc-sa.com | *(none)* | suspended | TEST_SUSPENDED_* |

These are **non-production test accounts only** — never real employees, never shared mailboxes.
The `+test` sub-address tag makes them easy to filter/identify while staying inside the
`@phc-sa.com` allowlist enforced by `enforce_signup_email_domain()`.

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

Once all 9 users are created (or renamed, per the 2026-08-02 note above), the provisioning
migration applies automatically with every `supabase db push` — no manual SQL Editor step
needed going forward:

```
supabase/migrations/20260802130100_playwright_test_accounts_phc_sa_domain.sql
```

(The original `20260713150000_playwright_test_accounts.sql` is left untouched for history —
migrations are never edited after they've applied to production.)

Re-running it manually in **Supabase Dashboard → SQL Editor** is safe (idempotent) and useful
to confirm provisioning immediately — you should see 9 `NOTICE` lines confirming each account.

---

## Step 3 — Set GitHub Actions secrets

Go to **GitHub → mophc-sa/phc-command-center → Settings → Secrets and variables → Actions**.

Add these secrets (the CI workflow already references them):

| Secret name | Value |
|---|---|
| `TEST_APP_URL` | Deployed app URL, e.g. `https://agent.phc-sa.com` |
| `TEST_SYSTEM_ADMIN_EMAIL` | `pw-system-admin+test@phc-sa.com` |
| `TEST_SYSTEM_ADMIN_PASSWORD` | *(the password you chose in Step 1)* |
| `TEST_MANAGING_DIRECTOR_EMAIL` | `pw-managing-director+test@phc-sa.com` |
| `TEST_MANAGING_DIRECTOR_PASSWORD` | *(password)* |
| `TEST_GENERAL_MANAGER_EMAIL` | `pw-general-manager+test@phc-sa.com` |
| `TEST_GENERAL_MANAGER_PASSWORD` | *(password)* |
| `TEST_SALES_MANAGER_EMAIL` | `pw-sales-manager+test@phc-sa.com` |
| `TEST_SALES_MANAGER_PASSWORD` | *(password)* |
| `TEST_BD_MANAGER_EMAIL` | `pw-bd-manager+test@phc-sa.com` |
| `TEST_BD_MANAGER_PASSWORD` | *(password)* |
| `TEST_SALES_OPS_EMAIL` | `pw-sales-ops+test@phc-sa.com` |
| `TEST_SALES_OPS_PASSWORD` | *(password)* |
| `TEST_SALESPERSON_EMAIL` | `pw-salesperson+test@phc-sa.com` |
| `TEST_SALESPERSON_PASSWORD` | *(password)* |
| `TEST_VIEWER_EMAIL` | `pw-viewer+test@phc-sa.com` |
| `TEST_VIEWER_PASSWORD` | *(password)* |
| `TEST_PENDING_EMAIL` | `pw-pending+test@phc-sa.com` |
| `TEST_PENDING_PASSWORD` | *(password)* |
| `TEST_SUSPENDED_EMAIL` | `pw-suspended+test@phc-sa.com` |
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
- **Never reuse real employee emails** — the `pw-*+test@phc-sa.com` namespace is reserved for test accounts.
- If a test account's password needs rotating: update the Supabase user's password in the Dashboard, then update the corresponding GitHub secret.
- The `pw-suspended` account must stay `status = suspended` — if a Playwright run accidentally activates it, re-run the migration to reset it.
- The `pw-pending` account must stay `status = pending_approval` with no role — same rule.
