# PHC Sales OS — Repository Notes

## Deployment Governance
Production deployments (Supabase Edge Functions, database migrations, configuration) are approval-gated and must never be triggered automatically by merging to `main`. See [docs/deployment-governance.md](docs/deployment-governance.md) for the full policy.

## AI Orchestrator
Every AI agent in the system is fronted by a single backend-only Edge Function (`ai-orchestrator`) — never call a provider directly from the frontend, and never add a new Edge Function per agent. See [docs/ai-orchestrator.md](docs/ai-orchestrator.md) for the architecture, agent registry, guardrails, and error codes.

## AI Handoff System (ذاكرة المشروع عبر الجلسات)
المشروع يحتفظ بذاكرته في ملفات، لا في المحادثة. التزم بالبروتوكول التالي:

- **بداية الجلسة:** اقرأ بالترتيب — هذا الملف ← [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) ← [tasks/current.md](tasks/current.md). للسياق الأعمق: [docs/PROJECT.md](docs/PROJECT.md) و[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **نهاية الجلسة:** حدّث [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) و[docs/CHANGELOG.md](docs/CHANGELOG.md)، وانقل المهام المكتملة إلى [tasks/completed.md](tasks/completed.md).
- **القرارات المهمة** تُسجَّل في [docs/DECISIONS.md](docs/DECISIONS.md) (سطر لكل قرار + التاريخ + السبب) لمنع إعادة نقاشها.
- **backlog → current فقط:** لا تبدأ تنفيذ أي بند من [tasks/backlog.md](tasks/backlog.md) قبل نقله إلى [tasks/current.md](tasks/current.md).
- **لا حذف:** المهام تُنقل إلى `completed.md`، لا تُمحى.
- Prompts جاهزة في [prompts/](prompts/): `implement` · `review` · `debug` · `release`.
