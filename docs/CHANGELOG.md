# CHANGELOG — PHC Command Center

> الأحدث في الأعلى. مبني على [Keep a Changelog](https://keepachangelog.com).
> ملاحظة: السجل التاريخي الكامل في Git؛ هذا الملف يلتقط المعالم من الآن فصاعدًا.

## [Unreleased]
### Added
- نظام AI Handoff (docs/ + tasks/ + prompts/) لحفظ ذاكرة المشروع عبر الجلسات.
### Changed
-
### Fixed
-

---

## 2026-07-26 — Phase 1: إصلاحات UX سريعة ومنخفضة المخاطر
تنفيذ المرحلة الأولى من طلب تعديلات شامل من العميل (مصمَّم عبر brainstorming → spec → plan → تنفيذ مباشر بعد توقف subagent عن العمل بسبب حد الإنفاق الشهري). التفاصيل الكاملة في `docs/superpowers/specs/2026-07-26-phase1-quick-fixes-design.md` و`docs/superpowers/plans/2026-07-26-phase1-quick-ux-fixes.md`.
### Added
- حقول جديدة في نموذج Intake (`lead-tender-inbox.tsx`): Client Type، Project Type، Project Number، RFQ From، Date Received؛ وتحويل Scope وLocation من نص حر إلى قوائم منسدلة ثابتة (migration جديدة على `inbox_items`).
- `contacts.confidence_level` (High/Medium/Low) يحل محل الحقل الرقمي `confidence_score` في نموذج جهات الاتصال (migration جديدة، بيانات تاريخية مُرحَّلة تلقائيًا حسب حدود 70/40).
- قدرة "creatable select" جديدة في `ActionDialog` (خيار "+ إضافة جديد" داخل أي قائمة منسدلة)، مُفعَّلة الآن في قائمة اختيار المشروع بنموذج New RFQ.
- رسائل توضيحية بعد الإنشاء (RFQ وIntake) تُبيّن للمستخدم أين يجد السجل الذي أضافه.
- لوحة "View Details" على بطاقات RFQ في لوحة RFQ & JIH Board.
### Changed
- حُذف قسم "Recent" من الشريط الجانبي (ميزة Cmd+K "Recent" وقسم "Pinned" لم يتأثرا).
### Fixed
- **(اكتُشف أثناء العمل، غير مرتبط بـ Phase 1)** صفحة Vendors كانت تحاول كتابة `reference_prices`/`internal_rating` مباشرة في جدول `vendors` رغم أن migration من أسبوع مضى (`20260719120000`) نقلت هذين الحقلين إلى `vendors_private` — كان سيفشل أي حفظ لمورّد جديد بقيمة في أحد الحقلين. اكتُشف فقط لأن `types.ts` الملتزم كان قديمًا ولم يعكس هذا التغيير. أُصلح: `createVendor` يبقى يكتب في `vendors` فقط، وأُضيفت `upsertVendorPrivateData()` جديدة تكتب في `vendors_private` (بوابة RLS: مديرو خط الأنابيب فقط)، والحقلان في النموذج أصبحا يظهران للمديرين فقط.
### Verified
- `bun run verify` (typecheck + lint + test + build) نظيف بالكامل.
- `bun run test:db` (pgTAP): 45/45 ناجحة على قاعدة بيانات محلية جديدة.
- `supabase db lint --local`: بلا أخطاء.

---

## 2026-07-26 — إصلاحات متابعة بعد فحص شامل للنظام
### Added
- كشف تكرار في `import-pipeline` (`compareSignals()`) يقارن الآن `main_contractor` أيضًا (بجانب company_name وproject_name)، مستخدمًا نفس `normalizeCompanyName()` الموحَّدة — كانت `DedupSignals.main_contractor` معرَّفة وممرَّرة لكن غير مقارَنة فعليًا (فجوة صامتة من D1). قرار موثَّق في `docs/DECISIONS.md`.
- Migration توثيقية بحتة (`20260726100000_document_leads_source_owner_id.sql`، `COMMENT ON COLUMN` فقط) تُثبِّت `leads.source = 'import'` كقيمة رسمية وتوثِّق أن ترك `owner_id` فارغًا عند إنشاء leads من الخادم مقصود — لم تُنشَر بعد (بانتظار بوابة الموافقة المعتادة).
### Fixed
- 4 ملفات contract test فاشلة لـ `ai-orchestrator`/`service-key-resolver` بسبب `readdirSync(migrationsDir).find(f => f.includes("ai_orchestrator"))` يختار ملف migration خاطئ (ترتيب القراءة غير مضمون عبر 3 ملفات تطابق نفس الاستبدال الجزئي) — استُبدل بمسار صريح لكل ملف، مطابقًا للنمط المستخدم أصلًا في اختبار idempotency-fingerprint.
### Changed
- دُمجت 3 PRs من dependabot (`actions/upload-artifact` #72، `gitleaks-action` #73، `actions/checkout` #74) بعد تحقّق CI أخضر.
- حُذفت ملفات `.handoff/rbac-hardening-sprint8-*` (قديمة، منجزة عبر مسار آخر) وworktree `d1-normalize-company-name` المحلي (مدموج بالكامل، لا عمل فريد فيه).
- صُحِّحت ملاحظة قديمة/غير دقيقة في `docs/ROADMAP.md` تدّعي أن ملفات Docker غير متتبَّعة — كانت مُلتزَمة بالفعل منذ PR #113.
### Discovered (غير مُصلَح بعد — انظر `docs/KNOWN_ISSUES.md`)
- `bun audit` (v1.3.14) يطبع gzip خامًا غير مقروء بدل تقرير، مما أخفى ثغرتين **high** حقيقيتين على main: `brace-expansion` (عبر eslint) وpostcss (عبر vite) — كلاهما devDependency انتقالية غير مشحونة للإنتاج. فحص "Dependency audit" في CI أحمر على main حاليًا لهذا السبب.
- PRs dependabot #75/#76 (dependency bumps) معطوبتان بشكل منفصل (`bun install --frozen-lockfile` يفشل) ولا تُصلحان الثغرتين أعلاه إطلاقًا — لم تُدمَجا.

---

## 2026-07-23 — Pathfinder D1–D6: توحيد التكرار المعماري (6 PRs مدموجة)
مسح معماري كامل (Pathfinder، 2026-07-22) كشف 6 حالات تكرار/مخاطر عبر الكود، نُفِّذت كل واحدة في worktree منفصل، رُوجعت مرتين (بناء + مراجعة fresh-eyes مستقلة بعد فتح الـ PR)، ودُمجت جميعها إلى main بالترتيب #116→#117→#118→#119→#120→#121.
### Added
- helper خادم مشترك لإنشاء leads (`insertLeadServerSide`) يوحّد مساري `run_protenders_ingest` وimport `commit_candidates` (PR #119).
- migration لتوسيع قائمة الحذف المحكومة (`execute_approved_record_delete`) لتشمل `import_batches`، بحارس يمنع حذف الدفعات ذات السجلات الملتزمة (PR #120) — **نُشرت إلى الإنتاج 2026-07-23** عبر `supabase db push --linked` بعد preflight نظيف.
- اختبار انحدار يقفل حذف `/team.tsx` غير المحمي (PR #118).
### Changed
- توحيد normalization أسماء الشركات العربية في module مشترك (`company-normalize.ts`)، إزالة نسختين مكررتين (PR #116).
- نقل زر Scan Pipeline من `/ai-agents` إلى `/agent-activity` (PR #117).
- توحيد حساب KPIs (JIH الإجمالي، الفرص المُرسّاة) بين لوحتَي المندوب والمدير في `dashboard-helpers.ts` (PR #121) — أصلح أيضًا bug عمود `stage` المفقود من استعلامَي `awardedOpps`.
### Fixed
- إزالة صفحة `/team` غير المحمية (بلا beforeLoad role check) التي كانت تعرض روستر الشركة الكامل لأي مستخدم مسجّل دخول (PR #118، أولوية أمنية).
- حلقة إدراج leads في `run_protenders_ingest` كانت بلا try/catch — فشل صف واحد كان يُسقط الدفعة كاملة (اكتُشف أثناء مراجعة fresh-eyes، أُصلح في PR #119).

### Deployed (2026-07-23 ~13:35 UTC)
- migration `20260723120000_extend_delete_allowlist_import_batches.sql` مُطبَّقة على `lrfdtoexyeghrzynapyn` (preflight نظيف، lint نظيف بعد التطبيق).
- `import-pipeline` v31→v32، `sales-os-api` v38→v39 — فحص صحة (401 غير مصادَق، متوقَّع) ناجح على كليهما. `ai-orchestrator`/`error-ingest` لم يُنشرا (بلا تغيير، مؤكَّد v26/v10).
- الفحوصات الوظيفية وUAT على الإنتاج متبقية يدويًا (قائمة التحقق في Obsidian).

---

## 2026-07-20 — Data Import to Live CRM (Part 3/3)
### Added
- التزام المرشّحين المعتمَدين إلى الـ CRM الحي (PR #108).
