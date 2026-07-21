# ARCHITECTURE — PHC Command Center

> نظرة تقنية مختصرة. المراجع العميقة: [ai-orchestrator.md](ai-orchestrator.md) · [deployment-governance.md](deployment-governance.md).

## Data Flow
```text
Browser UI
  -> Supabase publishable client + RLS
  -> authenticated TanStack server functions
  -> OAuth-protected read-only MCP tools

Supabase
  -> Postgres migrations, RLS, approval RPCs, audit log
  -> sales-os-api · import-pipeline · ai-orchestrator · error-ingest

External
  -> AI providers through ai-orchestrator ONLY
  -> Cloudflare Worker runtime
  -> Lovable project synchronization
```

## Frontend
TanStack Start + React. المتصفح لا يستلم service key أبدًا (يستخدم publishable client + RLS).

## Backend
TanStack server functions (authenticated) + Supabase Edge Functions.

## Database — Supabase / Postgres
- **Production project:** `lrfdtoexyeghrzynapyn`
- **Legacy project (NEVER modify):** `xpoduufwoklvsbuhywsv`
- RLS + approval RPCs + audit log. الاختبارات عبر pgTAP على نسخة Supabase محلية معزولة.

## Edge Functions
`sales-os-api` · `import-pipeline` · `ai-orchestrator` · `error-ingest`.

## AI
كل وكلاء AI خلف Edge Function واحدة backend-only (`ai-orchestrator`). ممنوع استدعاء مزوّد مباشرة من الـ frontend، وممنوع إضافة Edge Function لكل وكيل. التفاصيل: [ai-orchestrator.md](ai-orchestrator.md).

## Authentication & Permissions
Supabase Auth + RLS. سلطة الموافقة التجارية منفصلة عن `system_admin`. عمل RBAC الأخير موثّق في `.handoff/rbac-hardening-sprint8-*`.

## Deploy / Runtime
Cloudflare Worker `mophc-sa-phc-command-center` على `agent.phc-sa.com`. النشر يدوي مبوّب بموافقة (GitHub Actions dispatch من `main`، بيئة `production-cloudflare` المحمية). دمج `main` **لا** ينشر موارد Supabase. التفاصيل: [deployment-governance.md](deployment-governance.md).

## CI Gates
- `CI`: typecheck · unit/contract tests · build · smoke E2E اختياري.
- `Security`: Gitleaks · dependency audit · CodeQL · migration replay · db lint · pgTAP.
- `Production Readiness`: يدوي، بيئة محمية، مصفوفة أدوار/حالات حسابات إلزامية.
