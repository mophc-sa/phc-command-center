# PHC Sales OS — Repository Notes

## Deployment Governance
Production deployments (Supabase Edge Functions, database migrations, configuration) are approval-gated and must never be triggered automatically by merging to `main`. See [docs/deployment-governance.md](docs/deployment-governance.md) for the full policy.

## AI Orchestrator
Every AI agent in the system is fronted by a single backend-only Edge Function (`ai-orchestrator`) — never call a provider directly from the frontend, and never add a new Edge Function per agent. See [docs/ai-orchestrator.md](docs/ai-orchestrator.md) for the architecture, agent registry, guardrails, and error codes.

## User Guide — يُحدَّث مع التغيير لا بعده
[docs/USER_GUIDE.md](docs/USER_GUIDE.md) يشرح سير العمل لكل دور. **أي PR يغيّر تدفق المستخدم يُحدِّث الدليل في نفس الـPR** — لا كدفعة لاحقة.

يشمل ذلك: تغيير خطوات الإدخال أو التصنيف أو التحويل · إضافة/حذف/إعادة تسمية مرحلة · تغيير من يملك صلاحية إجراء · إضافة أو نقل صفحة · تغيير ما يظهر على صفحة يفتحها المستخدم · إصلاح قيد مذكور في القسم 10.

**السبب:** بتاريخ 2026-08-06 كان الدليل متأخرًا **سبعة PRs** — يصف تدفقًا من ثلاث خطوات أُلغي، ويسرد قيودًا أُصلحت. دليل يوجّه الناس للالتفاف حول مشكلة محلولة أسوأ من غياب الدليل. الوتيرة هنا أسرع من أي دفعة توثيق لاحقة، فالتحديث داخل الـPR هو الطريقة الوحيدة التي تصمد.

عند التحديث: صحّح القسم المتأثر **وقسم 10 (القيود)** معًا، وحدّث سطر التذييل (التاريخ + الـcommit). النسخة في Obsidian (`1. PROJECTS/PHC/`) تُزامَن من نفس المصدر.

## AI Handoff System (ذاكرة المشروع عبر الجلسات)
المشروع يحتفظ بذاكرته في ملفات، لا في المحادثة. التزم بالبروتوكول التالي:

- **بداية الجلسة:** اقرأ بالترتيب — هذا الملف ← [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) ← [tasks/current.md](tasks/current.md). للسياق الأعمق: [docs/PROJECT.md](docs/PROJECT.md) و[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **نهاية الجلسة:** حدّث [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) و[docs/CHANGELOG.md](docs/CHANGELOG.md)، وانقل المهام المكتملة إلى [tasks/completed.md](tasks/completed.md).
- **القرارات المهمة** تُسجَّل في [docs/DECISIONS.md](docs/DECISIONS.md) (سطر لكل قرار + التاريخ + السبب) لمنع إعادة نقاشها.
- **backlog → current فقط:** لا تبدأ تنفيذ أي بند من [tasks/backlog.md](tasks/backlog.md) قبل نقله إلى [tasks/current.md](tasks/current.md).
- **لا حذف:** المهام تُنقل إلى `completed.md`، لا تُمحى.
- Prompts جاهزة في [prompts/](prompts/): `implement` · `review` · `debug` · `release`.

## gstack (recommended)

This project uses [gstack](https://github.com/garrytan/gstack) for AI-assisted workflows.
Install it for the best experience:

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skills like /qa, /ship, /review, /investigate, and /browse become available after install.
Use /browse for all web browsing. Use ~/.claude/skills/gstack/... for gstack file paths.
