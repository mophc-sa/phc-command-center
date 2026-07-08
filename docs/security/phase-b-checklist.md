# Phase B checklist — do NOT execute until every item is confirmed

Phase A shipped the enum additions, the audit-log extension, error reporting
scaffolding, and Playwright role-matrix scaffolding. Phase B does the actual
role migration and cannot proceed until real accounts exist.

## 0. Prerequisites

- [ ] Confirm PR reviewer for the role migration
- [ ] Freeze commercial changes during rollout window
- [ ] Take a database snapshot / note the current backup point

## 1. Provision the six missing accounts

Invite each user via Lovable Cloud → Backend → Users → Invite. Do NOT
create fake users or shared mailboxes.

- [ ] mbassem@phc-sa.com — Bassem Kallas (Managing Director)
- [ ] ahmad@phc-sa.com — Ahmad Kallas (General Manager)
- [ ] omar@phc-sa.com — Omar Kallas (Sales Manager)
- [ ] marie@phc-sa.com — Marie Falome (Business Development Manager)
- [ ] a.jarrah@phc-sa.com — Abdelrahman Jarrah (Salesperson)
- [ ] fisal@phc-sa.com — Faisal Abdulkadhar (Salesperson)

Verification query (must return 7 rows including moalagab):

```sql
SELECT email, full_name FROM public.profiles
WHERE email IN (
  'moalagab@phc-sa.com','mbassem@phc-sa.com','ahmad@phc-sa.com',
  'omar@phc-sa.com','marie@phc-sa.com','a.jarrah@phc-sa.com',
  'fisal@phc-sa.com'
);
```

## 2. Assign new roles (single reviewed migration)

- [ ] Insert one `user_roles` row per user mapping to the correct new role
- [ ] Update `profiles.full_name` where needed to match display titles

## 3. Revoke Mohammed's legacy commercial roles

Only after step 2 succeeds:

- [ ] Insert `user_roles(user_id, role) = (Mohammed, 'system_admin')`
- [ ] Delete rows where `user_id = Mohammed AND role IN ('ceo','sales_manager','bd_manager','viewer')`
- [ ] Verify `protect_last_manager` does not block — a real managing_director/sales_manager must exist first

## 4. Migrate commercial guards from `ceo` to `managing_director` / `general_manager`

Files/functions to update in the same migration:

- [ ] `public.protect_company_owner` — allow `managing_director`, `general_manager`, `sales_manager`
- [ ] `public.protect_opportunity_owner` — same
- [ ] `public.protect_last_manager` — protect `managing_director`, `general_manager`, `sales_manager` (keep `ceo` for backward compatibility until step 6)
- [ ] `audit_log` SELECT policy — replace `ceo` with `managing_director`/`general_manager`
- [ ] Any RLS policy that references `'ceo'::app_role` — audit with:
  ```sql
  SELECT schemaname, tablename, policyname, qual, with_check
  FROM pg_policies WHERE qual LIKE '%ceo%' OR with_check LIKE '%ceo%';
  ```

## 5. Application-code guard sweep

- [ ] `rg -n "'ceo'" src/` → update every `hasRole("ceo")` / `hasAnyRole([...,'ceo'])` to include the new roles
- [ ] Ensure `system_admin` is NOT added to any commercial guard
- [ ] Update sidebar visibility rules to hide commercial groups for `system_admin`

## 6. Legacy `ceo` cleanup (only when all guards migrated)

- [ ] Confirm zero `user_roles.role = 'ceo'` rows
- [ ] Confirm zero code/policy references remain
- [ ] Decide: keep `ceo` enum value dormant, or plan a subsequent migration to drop it (requires recreating the enum type)

## 7. Playwright role matrix (non-production test accounts)

- [ ] Create 7 dedicated NON-production test accounts (never real employees)
- [ ] Store their credentials in GitHub Actions secrets (never in git):
      TEST_<ROLE>_EMAIL, TEST_<ROLE>_PASSWORD
- [ ] Trigger CI and verify every role test passes (no skips)

## 8. Error reporting verification

- [ ] Confirm production build routes exceptions through `reportError`
- [ ] Trigger a controlled error and verify: no emails/phones/tokens in payload
- [ ] Confirm dev/preview do NOT forward to production reporting

## 9. Publish gate

- [ ] `bunx tsgo --noEmit` clean
- [ ] `bun run build` clean
- [ ] Playwright role matrix green across all 7 roles
- [ ] Audit log shows real actor_role_snapshot values on new mutations
- [ ] Manual smoke as `system_admin`: confirm no approve/escalate/award controls appear
- [ ] Go / no-go sign-off recorded in PR description
