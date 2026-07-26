# Backlog — PHC Command Center

> أفكار/مهام غير مجدولة. **لا يبدأ الـ AI تنفيذ أي بند** إلا بعد نقله إلى `current.md`.

- [ ] (غير عاجل — مؤجَّل بقرار 2026-07-23) تنفيذ الفحوصات الوظيفية + UAT على الإنتاج لـ D1/D2/D5 (بعد نشر migration D5 وEdge Functions المتأثرة — القسمان 3 و6 من قائمة التحقق المحفوظة في Obsidian `1. PROJECTS/PHC/PHC Command Center — Post-Deploy Checklist (Jul 23 2026).md`، تحتاج موافقة صريحة لكتابة بيانات اختبار في CRM حي). **لم تُنفَّذ اليوم (2026-07-26) لنفس السبب — تحتاج موافقة صريحة منفصلة.**
- [ ] نشر migration `20260726100000_document_leads_source_owner_id.sql` إلى الإنتاج (توثيقية بحتة — `COMMENT ON COLUMN` فقط، بلا تغيير سكيما) عبر بوابة الموافقة المعتادة.
- [ ] **(أولوية عالية — اكتُشف 2026-07-26)** ترقية `eslint` و`vite`/`@tailwindcss/vite` لإصلاح ثغرتي high حقيقيتين (`brace-expansion`, `postcss`) مخفيتين وراء bug في `bun audit` (يطبع gzip خامًا). تفاصيل كاملة في `docs/KNOWN_ISSUES.md`.
- [ ] مراجعة إعداد GitHub Required status checks: فحص "Dependency audit" أحمر على main حاليًا ولم يمنع دمج PRs — تأكيد إن كان مُدرَجًا فعلًا ضمن الفحوصات المطلوبة (متوقَّع أن يكون، حسب `docs/security/security-baseline.md`).
- [ ] PR #75 (production-dependencies) وPR #76 (development-dependencies): `bun.lock` الذي أنشأه dependabot معطوب (`bun install --frozen-lockfile` يفشل) — يحتاج إعادة توليد يدوية قبل الدمج. لا تُصلح ثغرتي brace-expansion/postcss أعلاه بأي حال.
- [x] ~~مراجعة/دمج 5 PRs من dependabot المفتوحة~~ — دُمجت الثلاثة الآمنة (GitHub Actions: #72, #73, #74) بعد CI أخضر 2026-07-26. #75/#76 مؤجَّلتان (بند منفصل أعلاه، لقطة/lockfile معطوب).
- [x] ~~حسم مصير ملفات Docker غير المتتبَّعة~~ — لم تكن فجوة فعلية: كانت مُلتزَمة بالفعل منذ PR #113 (commit `98220e3`)؛ الملاحظة في ROADMAP.md كانت قديمة/غير دقيقة وصُحِّحت 2026-07-26.
- [x] ~~فتح issue لـ bug اختبارات ai-orchestrator*.contract.test.ts~~ — أُصلح مباشرة 2026-07-26 (لم يعد يحتاج issue منفصل): استبدال `readdirSync().find()` بمسار صريح لكل ملف migration في `ai-orchestrator.contract.test.ts` وai-orchestrator-hardening.contract.test.ts`.
- [x] ~~تأكيد منتج: توسيع مطابقة الأسماء العربية (D1)~~ — قُرِّر ونُفِّذ 2026-07-26: يشمل project_name وmain_contractor. انظر docs/DECISIONS.md.
- [x] ~~تأكيد منتج: leads.source/owner_id (D2)~~ — قُرِّر ووُثِّق 2026-07-26. انظر docs/DECISIONS.md.
- [x] ~~حذف ملفات .handoff/rbac-hardening-sprint8-*~~ — حُذفت 2026-07-26.
- [ ] [[أضف أفكارك هنا]]
