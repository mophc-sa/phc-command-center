# Backlog — PHC Command Center

> أفكار/مهام غير مجدولة. **لا يبدأ الـ AI تنفيذ أي بند** إلا بعد نقله إلى `current.md`.

- [ ] (غير عاجل — مؤجَّل بقرار 2026-07-23) تنفيذ الفحوصات الوظيفية + UAT على الإنتاج لـ D1/D2/D5 (بعد نشر migration D5 وEdge Functions المتأثرة — القسمان 3 و6 من قائمة التحقق المحفوظة في Obsidian `1. PROJECTS/PHC/PHC Command Center — Post-Deploy Checklist (Jul 23 2026).md`، تحتاج موافقة صريحة لكتابة بيانات اختبار في CRM حي). **لم تُنفَّذ اليوم (2026-07-26) لنفس السبب — تحتاج موافقة صريحة منفصلة.**
- [ ] نشر migration `20260726100000_document_leads_source_owner_id.sql` إلى الإنتاج (توثيقية بحتة — `COMMENT ON COLUMN` فقط، بلا تغيير سكيما) عبر بوابة الموافقة المعتادة.
- [x] ~~postcss high CVE (GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849)~~ — أُصلح 2026-07-26 عبر `overrides: { "postcss": "^8.5.18" }` (يحل لـ 8.5.23). `bun run verify` نظيف. لا كسر — postcss لم يغيّر شكل الـ API.
- [ ] **(أولوية عالية — لا يزال مفتوحًا)** brace-expansion high CVE (GHSA-mh99-v99m-4gvg / CVE-2026-14257): **لا يوجد إصلاح آمن بسيط** — جُرِّب override إلى 5.0.8 (النسخة المُرقَّعة الوحيدة) وكسر `bun run lint` فعليًا (`TypeError: expand is not a function`، تغيّر شكل الـ export). الإصلاح الحقيقي الوحيد: ترقية `eslint` إلى **eslint 10.x** (major bump — يسحب `@eslint/config-array@^0.23.5` المتوافق مع brace-expansion الجديد). يحتاج تخطيطًا وتحققًا منفصلَين (توافق plugins، Node engine `^20.19/^22.13/>=24`، احتمال تغييرات flat-config) — راجع مع المستخدم قبل البدء. تفاصيل كاملة في `docs/KNOWN_ISSUES.md`.
- [ ] مراجعة إعداد GitHub Required status checks: فحص "Dependency audit" أحمر على main حاليًا ولم يمنع دمج PRs — تأكيد إن كان مُدرَجًا فعلًا ضمن الفحوصات المطلوبة (متوقَّع أن يكون، حسب `docs/security/security-baseline.md`).
- [ ] PR #75 (production-dependencies) وPR #76 (development-dependencies): `bun.lock` الذي أنشأه dependabot معطوب (`bun install --frozen-lockfile` يفشل) — يحتاج إعادة توليد يدوية قبل الدمج. لا تُصلح ثغرتي brace-expansion/postcss أعلاه بأي حال.
- [x] ~~مراجعة/دمج 5 PRs من dependabot المفتوحة~~ — دُمجت الثلاثة الآمنة (GitHub Actions: #72, #73, #74) بعد CI أخضر 2026-07-26. #75/#76 مؤجَّلتان (بند منفصل أعلاه، لقطة/lockfile معطوب).
- [x] ~~حسم مصير ملفات Docker غير المتتبَّعة~~ — لم تكن فجوة فعلية: كانت مُلتزَمة بالفعل منذ PR #113 (commit `98220e3`)؛ الملاحظة في ROADMAP.md كانت قديمة/غير دقيقة وصُحِّحت 2026-07-26.
- [x] ~~فتح issue لـ bug اختبارات ai-orchestrator*.contract.test.ts~~ — أُصلح مباشرة 2026-07-26 (لم يعد يحتاج issue منفصل): استبدال `readdirSync().find()` بمسار صريح لكل ملف migration في `ai-orchestrator.contract.test.ts` وai-orchestrator-hardening.contract.test.ts`.
- [x] ~~تأكيد منتج: توسيع مطابقة الأسماء العربية (D1)~~ — قُرِّر ونُفِّذ 2026-07-26: يشمل project_name وmain_contractor. انظر docs/DECISIONS.md.
- [x] ~~تأكيد منتج: leads.source/owner_id (D2)~~ — قُرِّر ووُثِّق 2026-07-26. انظر docs/DECISIONS.md.
- [x] ~~حذف ملفات .handoff/rbac-hardening-sprint8-*~~ — حُذفت 2026-07-26.
- [ ] **افتح PR لفرع `fix/phase1-quick-ux-fixes`** (9 مهام مُنفَّذة + إصلاح vendors.tsx جانبي) وراجعه وادمجه.
- [ ] Phase 2 (طلب العميل الشامل): دمج نماذج Intake/RFQ/Quotation/BOQ/Discovery الخمسة في نموذج واحد بمصنِّف نوع، وإلغاء صفحتَي RFQ & JIH Board وBOQ Center (الإبقاء على Quotations فقط) — يحتاج `superpowers:brainstorming` مستقلة قبل البدء. التفاصيل والخيارات في `docs/superpowers/specs/2026-07-26-phase1-quick-fixes-design.md`.
- [ ] Phase 3 (طلب العميل): لوحتا Sales وManagement منفصلتان — تستخدم بنية `sales_targets`/`computeSalespersonMetrics`/`computeManagerMetrics` الموجودة أصلًا في `targets-metrics.ts`.
- [ ] Phase 4 (طلب العميل، ميزة جديدة بالكامل): Evidence checklist (RFQ Recvd/Quotation Sent/Meeting w Management/BAFO/Discount/Final Negotiation/Received Contract كـ checkboxes) + حقل Technical Notes على صفحة الفرصة — لا يوجد حاليًا أي شيء مشابه في الكود، يحتاج تصميم بيانات من الصفر.
- [ ] Phase 5 (طلب العميل، نقاش تصميم مفتوح): كيف يراقب النظام BOQ/package متغيّر حسب كل مقاول ومرحلة مشروع لكل tender مرفوع — سؤال معماري، ليس إصلاحًا.
- [ ] [[أضف أفكارك هنا]]
