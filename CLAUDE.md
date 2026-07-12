# PHC Sales OS — Repository Notes

## Deployment Governance
Production deployments (Supabase Edge Functions, database migrations, configuration) are approval-gated and must never be triggered automatically by merging to `main`. See [docs/deployment-governance.md](docs/deployment-governance.md) for the full policy.

## AI Orchestrator
Every AI agent in the system is fronted by a single backend-only Edge Function (`ai-orchestrator`) — never call a provider directly from the frontend, and never add a new Edge Function per agent. See [docs/ai-orchestrator.md](docs/ai-orchestrator.md) for the architecture, agent registry, guardrails, and error codes.
