# AI Handoff ⭐ — PHC Command Center

> **أهم ملف بعد CLAUDE.md.** يُحدَّث في نهاية كل جلسة. اقرأه أولًا عند بداية أي جلسة/حساب جديد.

## Date
2026-07-21  *(لقطة أولية عند تركيب النظام — حدّثها كل جلسة)*

## Current Branch
`main`

## Last Commit
`4c1ffe4` — feat(data-import): commit approved candidates to live CRM (Part 3/3) (#108) · 2026-07-20

## Current Goal
[[حدّد هدف الجلسة القادمة]]

## Completed (أحدث دفعة)
- Data Import → Live CRM، الأجزاء 1–3 (PR #108).

## In Progress
- RBAC Hardening (Sprint 8): يوجد patch قيد العمل في `.handoff/rbac-hardening-sprint8-wip.patch` وقائمة ملفاته في `.handoff/rbac-hardening-sprint8-files.txt`. **تحقّق: هل دُمج أم يحتاج استئنافًا؟**

## Next Task
- [[اسحب البند التالي من tasks/backlog.md إلى tasks/current.md]]

## Files Modified (شجرة العمل الآن — غير متتبَّعة)
- `Dockerfile`, `docker-compose.yml`, `.dockerignore` (untracked)
- `supabase/.branches/` (untracked)

## Pending Decisions
- هل تُلتزَم ملفات Docker إلى Git أم تبقى محلية؟

## Risks
- بيانات CRM حية: أي التزام/نشر يمرّ ببوابة موافقة (انظر deployment-governance.md).
- المشروع مربوط بـ Lovable — لا تُعِد كتابة تاريخ Git المدفوع (force-push/rebase/amend).

## Commands
```bash
bun run dev            # تشغيل محلي
bun run verify         # typecheck + lint + test + build (البوابة قبل PR)
bun run test:e2e       # Playwright
supabase start && bun run test:db && supabase stop --no-backup   # اختبارات DB
```

## Notes
- Production Supabase: `lrfdtoexyeghrzynapyn` · Legacy (لا تلمسه): `xpoduufwoklvsbuhywsv`.
- Production Worker: `mophc-sa-phc-command-center` على `agent.phc-sa.com`.
