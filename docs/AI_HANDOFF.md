# AI Handoff ⭐ — PHC Command Center

> **أهم ملف بعد CLAUDE.md.** يُحدَّث في نهاية كل جلسة. اقرأه أولًا عند بداية أي جلسة/حساب جديد.

## Date
2026-07-26  *(محدَّثة — Phase 1-5 مدموجة **ومنشورة للإنتاج بالكامل**: الواجهة تلقائيًا عبر auto-deploy، و4 migrations بموافقة صريحة)*

## 🚀 تقرير النشر إلى الإنتاج — 2026-07-26 ~20:15 UTC
نُفِّذ بعد طلب صريح من المستخدم ("انشر و deploy جميع التغييرات اللي تمت").

**اكتشاف مهم قبل البدء:** `deploy-cloudflare.yml` يحتوي `on: push: branches: [main]` — الواجهة الأمامية (Cloudflare Worker) **تُنشَر تلقائيًا عند كل merge إلى main**، وهذا لا يخالف `docs/deployment-governance.md` (الذي يمنع auto-deploy لـ migrations/Edge Functions/secrets فقط، وليس الواجهة). تأكَّد عبر `gh run list --workflow=deploy-cloudflare.yml`: كل الدمجات الستة اليوم (Phase 1-5 + تحديث التوثيق) نُشرت تلقائيًا بنجاح فور الدمج — **الواجهة كانت منشورة بالفعل قبل هذا الطلب**.

**المتبقي فعليًا: 4 migrations معلَّقة** (migrations لا تُنشَر تلقائيًا حسب نفس الحوكمة). نُفِّذت بالترتيب الكامل من `docs/deployment-governance.md`:
1. Migration preflight (GitHub Actions run [30218558200](https://github.com/mophc-sa/phc-command-center/actions/runs/30218558200)) — ناجح، 4 migrations معلّقة فقط، `db lint --linked` نظيف قبل التطبيق.
2. `supabase db push --linked --dry-run` — تأكيد القائمة المتوقَّعة بالضبط (4 ملفات، لا شيء إضافي).
3. `supabase db push --linked` — تطبيق فعلي، نجاح كامل.

**Migrations المطبَّقة على `lrfdtoexyeghrzynapyn`:**
| Migration | المحتوى | المخاطرة |
|---|---|---|
| `20260726100000_document_leads_source_owner_id.sql` | توثيقية بحتة (`COMMENT ON COLUMN`) | صفر |
| `20260726110000_inbox_items_intake_fields.sql` | 5 أنواع ENUM + 7 أعمدة جديدة قابلة للـ NULL على `inbox_items` | إضافية بحتة |
| `20260726120000_contacts_confidence_level.sql` | نوع ENUM جديد + عمود جديد + تعبئة تلقائية (backfill) من `confidence_score` | إضافية، `UPDATE` وحيد على عمود جديد فقط |
| `20260726130000_opportunity_milestone_checklist.sql` | جدول جديد `opportunity_milestones` + عمود `opportunities.technical_notes` | إضافية بحتة |

**تحقّق ما بعد التطبيق:**
- `supabase migration list --linked`: تطابق Local/Remote كامل لكل الـ 78 migration.
- `supabase db lint --linked --level warning`: نظيف، بلا أخطاء.
- تحقّق مباشر (قراءة فقط) عبر `supabase db query --linked`: الجدول والأعمدة الجديدة موجودة فعليًا؛ توزيع `confidence_level` على جهات الاتصال الثلاثين الحالية = NULL بالكامل (متوقَّع ومنطقي — لا أحد منهم كان له `confidence_score` أصلًا).
- فحص صحة الموقع المباشر: `https://agent.phc-sa.com/auth` → 307 (سليم)، `https://agent.phc-sa.com/` → 200 (سليم).
- **لا Edge Functions تأثرت** — لا شيء في `supabase/functions/` تغيّر خلال Phase 1-5، فلا حاجة لإعادة نشرها.

**مسار التراجع (Rollback):** لا يوجد down-migration جاهزة (سياسة هذا المستودع). التراجع اليدوي إن لزم:
- `20260726100000`: `COMMENT ON COLUMN public.leads.source IS NULL; COMMENT ON COLUMN public.leads.owner_id IS NULL;` (استعادة الحالة السابقة، بلا مخاطرة).
- `20260726110000`: `ALTER TABLE public.inbox_items DROP COLUMN client_type, DROP COLUMN project_type, ...` (كل الأعمدة السبعة) ثم `DROP TYPE` للأنواع الخمسة — آمن لأن لا كود حاليًا (بعد هذا النشر) يعتمد على غيابها إلا الواجهة الجديدة نفسها (ستفشل الكتابة لهذه الحقول فقط، لا كسر عام).
- `20260726120000`: `ALTER TABLE public.contacts DROP COLUMN confidence_level;` ثم `DROP TYPE public.contact_confidence_level;` — `confidence_score` الأصلي لم يُمَس، صفر فقدان بيانات.
- `20260726130000`: `DROP TABLE public.opportunity_milestones;` (يُسقط كل الـ CASCADE من `opportunities` تلقائيًا لأن العلاقة بالاتجاه الصحيح)، ثم `ALTER TABLE public.opportunities DROP COLUMN technical_notes;` ثم `DROP TYPE public.opportunity_milestone;`.
- **لا تُنفَّذ أي من عمليات التراجع أعلاه إلا بموافقة صريحة منفصلة** — كلها آمنة نظريًا لكنها تدميرية (DROP)، ولا داعي لها ما لم يظهر عطل فعلي.

---

## Current Branch
`main` — كل شيء مدموج. لا فرع عمل نشط حاليًا.

## Last Commit
`e6905a9` — feat(phase5): surface per-contractor package/BOQ status on the project detail page (#131) — مدمج على main.

## Current Goal
**لا يوجد — دورة الـ 5 مراحل (Phase 1-5) من طلب العميل الشامل مكتملة بالكامل: مصمَّمة، منفَّذة، مراجَعة، مدموجة.** ابدأ الجلسة القادمة بتحديد هدف جديد في `tasks/current.md`. ملخص المراحل الخمس (كل التفاصيل في `docs/CHANGELOG.md` وPRs #127-#131):
- **Phase 1** (PR #127): إصلاحات UX سريعة — حقول Intake جديدة، `contacts.confidence_level`، creatable-select، رسائل توضيحية، حذف Recent من الشريط الجانبي.
- **Phase 2** (PR #128): حوار "New Entry" موحَّد (5 نماذج → واحد بمصنِّف نوع) + إلغاء صفحتي RFQ & JIH Board وBOQ Center (أصبحتا تبويبين داخل Quotations، والروابط القديمة redirect لا حذف).
- **Phase 3** (PR #129): مندوبو المبيعات يهبطون على `/my-workspace` (لوحتهم الشخصية، كانت موجودة أصلًا) بدل `/command-center`؛ بطاقة "Team Target" مجمَّعة جديدة للإدارة.
- **Phase 4** (PR #130): ميزة جديدة بالكامل — جدول `opportunity_milestones` (7 عناصر ثابتة) + `opportunities.technical_notes`، بلوحتين جديدتين في صفحة الفرصة.
- **Phase 5** (PR #131): اكتُشف أن نموذج البيانات يدعم أصلًا عدّة مقاولين/فرص على نفس المشروع (`opportunities.project_id` + `main_contractor_id` منفصلان) — أُضيف عرض اسم المقاول + حالة الباكج + حالة BOQ لكل فرصة مرتبطة في صفحة تفاصيل المشروع.

**تنفيذ بلا subagents:** الـ subagent الأول في Phase 1 توقف بسبب "monthly spend limit" — المستخدم طلب إكمال كل شيء (Phase 1 تكملةً، ثم Phase 2-5 بالكامل) تنفيذًا مباشرًا بدون subagents وبدون توقف للمراجعة بين الخطوات ("لا ترجع لي في كل مرة... نفذ الان"). كل مرحلة: commit على فرع منفصل → push → PR → انتظار CI → مراجعة ذاتية للـ diff الكامل → دمج → المرحلة التالية.

**فحوصات وظيفية/QA تفاعلي:** مؤجَّلة لكل المراحل الخمس — لا توجد أداة متصفح في هذه الجلسة. Migrations الجديدة (Phase 4) لم تُنشَر للإنتاج بعد (بانتظار البوابة المعتادة).

## Completed (2026-07-26) — Phase 1: إصلاحات UX سريعة (spec → plan → تنفيذ)
طُلبت تعديلات شاملة من العميل (لقطات شاشة معلَّقة + نص عربي)، عولجت عبر `superpowers:brainstorming` (اكتشفت تناقضًا بين النص واللقطات حُلّ بسؤال المستخدم، واكتُشف أن نظامي Intake منفصلين — `lead-tender-inbox`/`discovery` — موجودان أصلًا) ثم `superpowers:writing-plans` (خطة من 10 مهام). التنفيذ بدأ بـ subagent-driven-development لكن **الـ subagent الأول توقف بسبب "monthly spend limit"** — المستخدم اختار إكمال التنفيذ مباشرة (بدون subagents) لبقية المهام.
- **9 مهام مُنفَّذة ومُلتزَمة** (commits `5a50f04`..`a309579` على `fix/phase1-quick-ux-fixes`): حقول Intake جديدة (Client Type/Project Type/Project Number/RFQ From/Date Received + Scope/Location كقوائم منسدلة)، `contacts.confidence_level` (High/Medium/Low يحل محل رقم مئوي)، قدرة "creatable select" جديدة في `ActionDialog` + تفعيلها في منتقي مشروع RFQ، رسائل توضيحية بعد الإنشاء، لوحة View Details على بطاقات RFQ، حذف قسم Recent من الشريط الجانبي.
- **⚠️ اكتشاف جانبي أثناء العمل (غير مرتبط بـ Phase 1، أُصلح بموافقة المستخدم في commit منفصل `052024a`):** صفحة Vendors كانت تكتب `reference_prices`/`internal_rating` مباشرة في `vendors` رغم أن migration من أسبوع (`20260719120000`) نقلتهما إلى `vendors_private` — كان سيفشل حفظ أي مورّد جديد بقيمة في أحدهما. اكتُشف فقط لأن `types.ts` الملتزم كان قديمًا (لم يُعاد توليده منذ ذلك الـ migration). أُصلح بـ `upsertVendorPrivateData()` جديدة + قصر الحقلين على المديرين في النموذج.
- **تحقّق كامل:** `bun run verify` نظيف، `bun run test:db` 45/45 pgTAP، `supabase db lint --local` بلا أخطاء. لم تُنشَر أي migration للإنتاج (توثيقية/إضافية بحتة، بانتظار البوابة المعتادة).
- **درسان تقنيان مهمان لهذه الجلسة:** (1) `supabase gen types typescript --local` يطبع سطر "Connecting to db 5432" على stdout — يجب فلترته (`grep -v "^Connecting to db"`) قبل الحفظ في `types.ts` وإلا يفسد الملف. (2) `types.ts` يحتوي كتلة أنواع مُضافة يدويًا آخر الملف (`ImportSplitProposal`/`AiAgentOutput`/`AiAgentCallResult`، معلَّمة "not yet in auto-generated schema") — أي إعادة توليد كاملة يجب أن تُبقي هذه الكتلة (خذها من git history إن أُعيد التوليد لاحقًا).

## Completed (2026-07-26) — فحص شامل للنظام + معالجة الفجوات المفتوحة
طُلب فحص شامل ("ما ينقص النظام؟")، ثم معالجة كل ما ظهر بالترتيب حسب الأهمية. القرارات الحقيقية (D1/D2 أدناه، ملفات Docker، دمج dependabot) طُلبت من المستخدم صراحة عبر أسئلة موجَّهة قبل التنفيذ — لم تُفترَض.
- **بق مُصلَح:** 4 ملفات contract test فاشلة (`ai-orchestrator.contract.test.ts`, `ai-orchestrator-hardening.contract.test.ts`, وملفان آخران متأثران بنفس الجذر) — السبب: `readdirSync(migrationsDir).find(f => f.includes("ai_orchestrator"))` يطابق 3 ملفات migration مختلفة، وترتيب `readdirSync` غير مضمون فيختار الملف الخطأ. أُصلح باستبدال المسار الصريح الكامل (نفس نمط `ai-orchestrator-idempotency-fingerprint.contract.test.ts` الصحيح أصلًا). `bun test src`: 438/438 ناجحة. `bun run verify`: نظيف بالكامل.
- **D1 (قرار مستخدم):** توسيع مطابقة التكرار العربية في `import-dedup.ts::compareSignals()` لتقارن `main_contractor` أيضًا (كانت معرَّفة في `DedupSignals` وممرَّرة من `import-pipeline/index.ts` لكن غير مقارَنة أبدًا — فجوة صامتة). اختبار جديد مضاف. التفاصيل والسبب في `docs/DECISIONS.md` (2026-07-26).
- **D2 (قرار مستخدم):** `leads.source = 'import'` قيمة رسمية الآن، وترك `owner_id` فارغًا عند إنشاء leads من الخادم مقصود — موثَّق في تعليقات `_shared/leads.ts` وmigration جديدة توثيقية بحتة (`20260726100000_document_leads_source_owner_id.sql`، `COMMENT ON COLUMN` فقط) **لم تُنشَر بعد** (بانتظار بوابة الموافقة المعتادة — لا تنشرها بدون موافقة صريحة منفصلة).
- **تنظيف:** حُذفت `.handoff/rbac-hardening-sprint8-*` (قديمة، مؤكَّدة غير منطبقة سابقًا). أُزيل worktree `d1-normalize-company-name` المحلي بعد تأكيد أنه مدموج بالكامل وملفاته غير المتتبَّعة مطابقة حرفيًا لنسخة main. صُحِّحت ملاحظة قديمة خاطئة في `docs/ROADMAP.md` (ملفات Docker كانت مُلتزَمة بالفعل منذ PR #113، وليست فجوة).
- **Dependabot:** دُمجت 3 PRs آمنة (#72 upload-artifact، #73 gitleaks-action، #74 checkout) بعد `gh pr update-branch` + CI أخضر بالكامل. PR #75/#76 (dependency bumps) **لم تُدمَجا** — `bun install --frozen-lockfile` يفشل عليهما (lockfile الذي أنشأه dependabot لا يطابق ما يحسبه bun)، ولا تُصلحان الاكتشاف التالي أصلًا.
- **⚠️ اكتشاف جديد أثناء الفحص (غير مُصلَح — أولوية عالية):** `bun audit` يطبع gzip خامًا غير مقروء بدل تقرير (bug في bun 1.3.14 نفسه، محليًا وفي CI)، مما أخفى ثغرتين **high** حقيقيتين موجودتين على main حاليًا: `brace-expansion` (عبر eslint) وpostcss (عبر vite) — كلاهما devDependency انتقالية لا تُشحَن للإنتاج، لكن فحص "Dependency audit" في CI أحمر على main نفسه بسببهما الآن. تفاصيل كاملة + خطة إصلاح مقترحة في `docs/KNOWN_ISSUES.md`.

## 🚀 تقرير النشر إلى الإنتاج — 2026-07-23 ~13:35 UTC
نُفِّذ بعد موافقة صريحة من المستخدم وتحقّق نظيف من الـ migration preflight (GitHub Actions run [30011068082](https://github.com/mophc-sa/phc-command-center/actions/runs/30011068082) — ناجح، migration واحدة معلّقة فقط، لا أخطاء schema).

**Migration:**
- `20260723120000_extend_delete_allowlist_import_batches.sql` — مُطبَّقة على `lrfdtoexyeghrzynapyn` عبر `supabase db push --linked`.
- تحقّق ما بعد التطبيق: `supabase migration list --linked` يُظهر تطابق Local/Remote الكامل، و`supabase db lint --linked` نظيف.

**Edge Functions (فقط اللتان تغيّرتا — لم يُنشر غيرهما):**
| Function | نسخة قبل | نسخة بعد | فحص صحة |
|---|---|---|---|
| `import-pipeline` | 31 | **32** | `curl` غير مصادَق → 401 (صحي) |
| `sales-os-api` | 38 | **39** | `curl` غير مصادَق → 401 (صحي) |
| `ai-orchestrator` | 26 | 26 (بلا تغيير، مؤكَّد) | — |
| `error-ingest` | 10 | 10 (بلا تغيير، مؤكَّد) | — |

**مسار التراجع (Rollback):** إن لزم التراجع عن الدوال، أعد نشر الإصدار السابق عبر Supabase Dashboard (Functions → Deployments → السحب لنسخة 31/38) أو `git checkout` للـ commit السابق ثم `supabase functions deploy`. للـ migration: لا يوجد down-migration جاهزة — التراجع اليدوي هو `CREATE OR REPLACE FUNCTION execute_approved_record_delete` بإعادة النسخة السابقة من commit `9a79e6c^` (قبل D5)، لا `db reset`/`migration repair` مطلقًا حسب سياسة الأمان.

**غير المُنفَّذ عمدًا (يحتاج تنفيذ يدوي):** الفحوصات الوظيفية (قسم 3 في قائمة التحقق) وUAT (قسم 6) — كلاهما يستلزم كتابة بيانات اختبار حقيقية إلى CRM الحي، وهذا يحتاج موافقة صريحة منفصلة حسب "Safety Rules" في deployment-governance.md ("import/commit CRM data without approval"). قائمة التحقق الكاملة محفوظة في Obsidian: `1. PROJECTS/PHC/PHC Command Center — Post-Deploy Checklist (Jul 23 2026).md`.

## Completed (أحدث دفعة) — إغلاق الفجوات المتبقية من مراجعات fresh-eyes
- **D4 (PR #118)**: أُضيف اختبار انحدار (`security-baseline.contract.test.ts`، commit `71dde38`) يقفل حذف `/team.tsx` وحماية `admin-settings.tsx` — تحقّق عبر negative control (إعادة إنشاء team.tsx مؤقتًا، تأكيد فشل الاختبار، ثم إزالته وتأكيد نجاحه).
- **D2 (PR #119)**: تشغيل فعلي (live smoke test) لكلا مساري `insertLeadServerSide` على Supabase محلي حقيقي (وليس source-contract فقط):
  - `run_protenders_ingest`: تأكيد أن try/catch (من إصلاح المراجعة السابقة) يعزل الصفوف الفاشلة صحيحًا، leads_created/leads_failed دقيقة، lead_stage='detected'، source='protenders'، audit_log مسجَّل.
  - `commit_candidates` (مسار leads): تأكيد أن الحقل الكامل (بما فيه research_notes، إصلاح المراجعة السابقة) يُمرَّر كاملًا، وaudit_log مسجَّل.
  - نُشرت كتعليق متابعة على PR #119.
- **D5 (PR #120)**: تشغيل فعلي كامل لتدفق الحذف المحكوم (request_delete→decide_approval→execute_delete) لسيناريوهين:
  - المسار السعيد: cascade ذري كامل (batch/files/rows→0)، فصل الأدوار الثلاثي مؤكَّد (sales_manager مرفوض من التنفيذ)، audit_log صحيح.
  - المسار المحروس: دفعة بها import_record_links ملتزمة → execute_delete يرفض بالضبط برسالة الخطأ المتوقعة من إصلاح المراجعة، والبيانات تبقى سليمة، execution_status='skipped'.
  - نُشرت كتعليق متابعة على PR #120.
- ملاحظة بنية تحتية مكتشفة: edge runtime المحلي (`supabase_edge_runtime_lrfdtoexyeghrzynapyn`) مربوط bind-mount بمجلد `supabase/functions` الخاص بـ worktree D1 فقط (أول واحد شُغِّل فيه `supabase start`) — لاختبار كود Edge Function من فرع آخر، يلزم نسخ الملفات مؤقتًا إلى D1 ثم `docker restart` (الـ runtime يخزّن الكود المُصرَّف ولا يعيد التحميل تلقائيًا). أُعيد D1 لحالته النظيفة بعد الاختبار.

## Completed (أحدث دفعة) — جولة مراجعة PR مستقلة (fresh-eyes review)
بعد فتح كل الـ 6 PRs، طلب المستخدم مراجعة مستقلة (subagent بلا أي سياق سابق عن كيفية بناء كل PR) لكل واحد، ونُشرت كتعليقات مراجعة فعلية على GitHub (`gh pr review --comment`). النتائج:
- **PR #116 (D1)**: ✅ Approve. لا ملاحظات Critical/Important. ملاحظتان Minor (توسّع مطابقة الأسماء العربية ليشمل project_name/contractor_name أيضًا — يستحق تأكيد منتج؛ فرق سطر واحد في عدّ الأسطر بوصف الـ PR).
- **PR #117 (D3)**: ✅ Approve with comments. لا ملاحظات Critical/Important. الفحص اليدوي عبر المتصفح لا يزال غير منجز (Chrome extension).
- **PR #118 (D4)**: ⚠️ Approve with comments. لا ملاحظات Critical/Important. يُنصَح بإضافة اختبار انحدار للحماية الأمنية (غير موجود حاليًا).
- **PR #119 (D2)**: ⚠️ Approve with comments. **وجدت Important حقيقي**: حلقة إدراج leads في run_protenders_ingest لم يكن لها try/catch — فشل صف واحد وسط 5 كان سيُسقط سجل التدقيق الكامل للدفعة ويُرجع 500 دون تسجيل ما نجح. **أُصلح فورًا** (commit `247feb1`): كل إدراج الآن محاط بـ try/catch، والاستجابة تُبلغ leads_created/leads_failed الفعليين بدل افتراض نجاح الكل. تحقّق typecheck/deno check/الاختبار القائم بعد الإصلاح.
- **PR #120 (D5)**: ⚠️ Approve with comments. **وجدت Important حقيقي**: تعليق الـ migration يدّعي "كل جدول يشير لـ import_batches لديه ON DELETE CASCADE" — خطأ؛ 4 أعمدة (على جداول CRM حية: import_source_profiles، account_interactions، quotation_updates، sales_actuals_monthly) هي ON DELETE SET NULL. تحقّقتُ بنفسي: **لا يوجد أي كود تطبيق يكتب على هذه الأعمدة الأربعة حاليًا** (grep شامل نظيف) — أثر أمني حالي = صفر، مجرد schema غير مُفعَّل لميزة لم تُبنَ بعد. **أُصلح** (commit `9a79e6c`): تصحيح التعليق فقط + ملاحظة لمراجعة الحارس (guard) إذا بدأت ميزة مستقبلية بملء هذه الأعمدة خارج مسار import_record_links.
- **PR #121 (D6)**: ✅ Approve with comments. لا ملاحظات Critical/Important — تحقّق المراجع المستقل من كل قيمة KPI سطرًا بسطر (بما فيها إعادة التحقق من إصلاح عمود stage الحرج) وأكّد صحتها. **وجدت Minor**: computeQuotationWinRatePct بلا اختبار وحدة مباشر لمعامل emptyValue (السلوك الوحيد الجديد في الدالة). **أُصلح** (commit `877db1a`): 3 حالات اختبار جديدة (61/61 ناجحة). الفحص اليدوي عبر المتصفح لا يزال غير منجز — **مُوصى به بقوة نظرًا لتأثير الـ PR على أرقام حقيقية**، وليس مجرد شكلية.

## Completed (الدفعة السابقة — بناء الـ 6 PRs)
- **PR #121**: توحيد KPI (Pathfinder D6) — لم يكن finding مؤكدًا، اكتُشف عبر `/investigate` هذه الجلسة: my-workspace.tsx يعرض رقمًا مختلفًا لنفس بطاقة KPI حسب دور المستخدم. اكتُشف bug إضافي أثناء التنفيذ (عمود stage مفقود من الاستعلام).
- **PR #120**: توحيد حذف import batches (Pathfinder D5) — الأعمق بحثًا. يتضمّن migration جديدة (لم تُنشر بعد — النشر منفصل وبوابة موافقة).
- **PR #119**: helper مشترك لإنشاء leads من الخادم (Pathfinder D2).
- **PR #118**: حذف صفحة `/team` غير المحمية (Pathfinder D4، أولوية أمنية).
- **PR #117**: نقل زر Scan Pipeline (Pathfinder D3).
- **PR #116**: توحيد company-name normalization (Pathfinder D1).
- PR #115/#114/#112/#113: migration preflight، AI Agent Outputs Review UI، RBAC + Docker محلي.
- **Pathfinder** (مسح معماري كامل، 2026-07-22): كل البنود الستة (D1–D6) الآن مُنفَّذة عبر PRs مفتوحة، ومراجَعة مستقلة مرتين. التفاصيل الأصلية في `PATHFINDER-2026-07-22/`.

## In Progress
- ⚠️ push إلى GitHub يحتاج حساب `gh` النشط = `mophc-sa` (وليس `moalagab`) — تم التبديل عبر `gh auth switch --user mophc-sa`، يبقى نشطًا ما لم يُبدَّل.
- متبقٍ (غير عاجل — قرار 2026-07-23): فحوصات وظيفية + UAT على الإنتاج — انظر `docs/DECISIONS.md`.
- **(أولوية عالية، لم تُصلَح بعد)** ثغرة `brace-expansion` الحقيقية المخفية وراء bug `bun audit` (تحتاج ترقية eslint 10.x major — انظر `docs/KNOWN_ISSUES.md`). postcss نفس المشكلة أُصلحت (PR #126).
- ✅ (مكتمل 2026-07-26 ~20:15 UTC) الواجهة منشورة تلقائيًا (auto-deploy)، و4 migrations المعلَّقة (D2 + Phase 1×2 + Phase 4) طُبِّقت على الإنتاج بنجاح — انظر تقرير النشر أعلاه.
- فحوصات وظيفية/QA تفاعلي يدوي لكل من Phase 1-5 (لا توجد أداة متصفح في الجلسات الأخيرة) — يستحق جلسة QA مخصَّصة قبل أي إعلان "جاهز للإنتاج" كامل بمعنى تفاعلي، رغم أن الكود والسكيما منشوران فعليًا الآن.

## Next Task
- QA تفاعلي يدوي شامل لكل الميزات الجديدة (Phase 1-5) على الإنتاج الحي — لم يُنفَّذ بعد رغم أن كل شيء منشور، لا توجد أداة متصفح متاحة حتى الآن.
- **(أولوية عالية)** إصلاح ثغرة `brace-expansion` (يحتاج ترقية eslint 10.x — مهمة مخطَّطة منفصلة، راجع `docs/KNOWN_ISSUES.md`).
- بيانات: تعيين أهداف فعلية لـ Faisal وAbdelrahman (10M لكل) في `sales_targets` — لم تُنفَّذ، تحتاج تأكيد هوية المستخدمين الفعليين أولًا.
- طبيعي: اختر بند جديد من `tasks/backlog.md` وانقله إلى `tasks/current.md` عند بدء الجلسة القادمة.

## Files Modified (شجرة العمل الآن)
- لا شيء غير مدموج — كل فروع Phase 1-5 دُمجت ({fix/phase1-quick-ux-fixes, feat/phase2-unified-entry-point, feat/phase3-role-dashboards, feat/phase4-milestone-checklist, feat/phase5-multi-contractor-monitoring} حُذفت بعد الدمج).
- `.claude/` (untracked)
- `PATHFINDER-2026-07-22/` (untracked — نتائج المسح المعماري)
- `docs/superpowers/plans/2026-07-22-company-name-normalization-unification.md`، `2026-07-22-scan-pipeline-relocation.md`، `2026-07-23-remove-team-page.md`، `2026-07-23-shared-lead-insert-helper.md`، `2026-07-23-import-batch-delete-unification.md`، `2026-07-23-dashboard-kpi-consistency.md` (untracked — من قبل جلسة Phase 1، لا تزال غير مُلتزَمة)

## Pending Decisions
- لا يوجد حاليًا — كل غموض Phase 1-5 حُسم عبر أسئلة للمستخدم أثناء البرينستورمنغ (انظر spec) أو بقرار تنفيذ مباشر صريح من المستخدم. القرارات المعلَّقة من الجلسات السابقة (D1/D2/Docker/rbac-hardening) كلها محسومة.
- بيانات: تعيين أهداف فعلية لـ Faisal وAbdelrahman (10M لكل منهم) في `sales_targets` — لم تُنفَّذ، تحتاج تأكيد هوية المستخدمين الفعليين أولًا (انظر `tasks/backlog.md`).

## Risks
- بيانات CRM حية: أي التزام/نشر يمرّ ببوابة موافقة (انظر deployment-governance.md).
- المشروع مربوط بـ Lovable — لا تُعِد كتابة تاريخ Git المدفوع (force-push/rebase/amend).
- فحص "Dependency audit" في CI أحمر على main حاليًا (انظر `docs/KNOWN_ISSUES.md`) — لا تفترض أنه أخضر عند فتح PR جديد.

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
