# PROJECT — PHC Command Center (PHC Sales OS)

## Vision
مركز قيادة مبيعات داخلي ثنائي اللغة (عربي/إنجليزي) لشركة **PHC Wayfinding Signs** — يوحّد الـ CRM والعمليات ووكلاء الذكاء الاصطناعي في نظام واحد محكوم.

## Goals
- إدارة دورة المبيعات (leads → candidates → live CRM) مع بوابات موافقة بشرية.
- استخراج/استيراد بيانات العملاء عبر import-pipeline مع مراجعة قبل الالتزام بالـ CRM الحي.
- تشغيل وكلاء AI كـ "توصيات ومسودات" لا تعدّل سجلات CRM الحية مباشرة.

## Users
فريق PHC الداخلي — أدوار مبيعات + جهات موافقة تجارية (Commercial approval authority منفصلة عن `system_admin`).

## Modules
- Sales OS API (`sales-os-api`)
- Data Import Pipeline (`import-pipeline`)
- AI Orchestrator (`ai-orchestrator`) — البوابة الوحيدة لكل مزوّدي AI
- Error Ingestion (`error-ingest`)
- RBAC / صلاحيات على مستوى الصفوف (RLS)

## Business Rules
- المتصفح لا يستلم أبدًا service key.
- سلطة الموافقة التجارية منفصلة عن `system_admin`.
- مخرجات AI توصيات/مسودات — لا تُطبّق تلقائيًا على CRM الحي.
- ثنائية اللغة إلزامية في الواجهة.

## Tech Stack
TanStack Start · React · Supabase/Postgres · Supabase Edge Functions · Cloudflare Workers · Bun 1.3.14. التفاصيل في [ARCHITECTURE.md](ARCHITECTURE.md) و[CLAUDE.md](../CLAUDE.md).

## Current Status
نشط على `main`. آخر إنجاز: التزام المرشّحين المعتمَدين إلى CRM الحي (data-import Part 3/3, PR #108). انظر [AI_HANDOFF.md](AI_HANDOFF.md).
