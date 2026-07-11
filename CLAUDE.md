# PHC Sales OS — Repository Notes

## Deployment Governance
Production deployments (Supabase Edge Functions, database migrations, configuration) are approval-gated and must never be triggered automatically by merging to `main`. See [docs/deployment-governance.md](docs/deployment-governance.md) for the full policy.
