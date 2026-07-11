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
