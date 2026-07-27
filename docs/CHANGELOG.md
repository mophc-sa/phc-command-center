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

## 2026-07-27 — دفعة إصلاحات شاملة (9 مشاكل مُبلَّغة + الأشياء المؤجَّلة)
تنفيذ مباشر بموافقة شاملة مسبقة. تفاصيل كاملة في `docs/AI_HANDOFF.md`.
### Fixed
- خطأ "تعذّر إنشاء المسودة" (AI Draft) في متابعات My Day — قيم `channel` غير مدعومة تُطابَق الآن إلى ما يقبله وكيل `smart_followup_draft`.
- Agent Activity كان يقرأ من جدول `agent_runs` المهجور دائمًا الفراغ — أُعيد توجيهه إلى `ai_agent_runs` (البيانات الحقيقية).
- حقول "إضافة جديد" (شركة/مشروع) مفقودة في NewEntryDialog وفورمي المناقصات وجهات الاتصال — أُضيفت.
- بطاقات Projects/Reference Library كانت تُظهر تفاصيل قليلة رغم توفّر بيانات إنتاج حقيقية (verification_status، signage_package_status، source_confidence) — أُبرزت.
- قفل RBAC متكرر (منح sales_manager لحساب المدير الأعلى يمنع تصحيحه ذاتيًا) — migration تصحيحية ثالثة بنفس النمط المُثبَت.
- فجوات توافق الجوال في صفحات أُنشئت بعد فحص 2026-07-14 (جداول overflow-hidden، شبكة عمودين ثابتة داخل dialog، صف KPI غير متسق).
- ثغرة brace-expansion (GHSA-mh99-v99m-4gvg) — أُصلحت فعليًا عبر ترقية eslint 10.x بعد فشل محاولة override سابقة.
### Security
- تصحيح ذاتي فوري: migration إصلاح Agent Activity أضافت سياسة RLS زائدة سمحت مؤقتًا لمستخدمين معلَّقين بقراءة `ai_agent_runs` (السياسة الأصلية `is_active_user()`-gated كانت موجودة أصلًا ولم تُكتشف في الفحص الأول لأنها أُنشئت ديناميكيًا). اكتُشف وصُحِّح خلال دقائق من التحقّق بعد النشر.
### Verified
- `bun run verify` نظيف بالكامل (typecheck + lint 0 أخطاء + 499 اختبار + build). `brace-expansion@5.0.8` مؤكَّد عبر `bun pm ls --all`. تحقّق مباشر لكل تغيير على بيانات الإنتاج الحقيقية عبر `supabase db query --linked` (قراءة فقط) بعد كل migration.
### Blocked
- تعيين أهداف مبيعات Faisal/Abdelrahman — لا حساب لأي منهما في `public.profiles` حاليًا.

---

## 2026-07-26 — Phase 5: مراقبة BOQ/package متغيّر حسب كل مقاول
كانت مطروحة كسؤال تصميم مفتوح من العميل، وليس مواصفة جاهزة. الاكتشاف الرئيسي: نموذج البيانات (`opportunities.project_id` + `opportunities.main_contractor_id` منفصلان) يدعم بالفعل عدّة فرص/مقاولين على نفس المشروع، كل واحدة بتتبّع مستقل تمامًا (مرحلة، حالة باكج، BOQ). الفجوة الفعلية: صفحة تفاصيل المشروع لا تُظهر هذا بوضوح.
### Changed
- لوحة "Opportunities" في صفحة تفاصيل المشروع تُظهر الآن لكل فرصة مرتبطة: اسم المقاول، حالة الباكج (`signage_package_status`)، وحالة BOQ — بجانب المرحلة والقيمة الموجودتين أصلًا. رسالة توضيحية تظهر تلقائيًا عند وجود أكثر من مقاول على نفس المشروع.
### Verified
- تحقّق حي عبر استعلام PostgREST مباشر على قاعدة بيانات محلية (مقاولان اختباريان على نفس المشروع، بحالتَي باكج وBOQ مختلفتين) قبل الالتزام — أُزيلت بيانات الاختبار بعد التأكد. `bun run verify` نظيف.

---

## 2026-07-26 — Phase 4: قائمة مراحل الصفقة (Milestone Checklist) + ملاحظات فنية
تنفيذ مباشر. ميزة جديدة بالكامل (لا يوجد مكافئ سابق في الكود، تأكَّد أثناء Phase 1's brainstorming).
### Added
- جدول `opportunity_milestones` (migration `20260726130000`): 7 عناصر ثابتة (RFQ Recvd، Quotation Sent، Meeting w Management، BAFO Request، Discount Sent، Final Negotiation، Received Contract)، كل عنصر يُعلَّم مستقلًا بغضّ النظر عن `sales_stage` الحالي أو حالة العناصر الأخرى. RLS بنفس نمط stakeholders/evidence_sources (سياسة واحدة موحَّدة، ليست 4 منفصلة).
- عمود `opportunities.technical_notes` (نص حر).
- لوحتان جديدتان في صفحة تفاصيل الفرصة: "Milestone Checklist" (بجانب Evidence)، و"Technical Notes" (ضمن تبويب Assignment).
### Verified
- `bun run verify` نظيف، `bun run test:db` 45/45، `supabase db lint --local` بلا أخطاء.

---

## 2026-07-26 — Phase 3: لوحات منفصلة للمبيعات والإدارة
تنفيذ مباشر بموافقة المستخدم. اتضح أن أغلب البنية التحتية موجودة أصلًا (`sales_targets`, my-workspace.tsx الشخصية) — الفجوة الفعلية كانت في التوجيه فقط.
### Fixed
- مندوبو المبيعات (`salesperson`) كانوا يهبطون على `/command-center` (نفس صفحة الإدارة) بدل لوحتهم الشخصية `/my-workspace` (التي تعرض هدفهم الفردي أصلًا). أصبحوا يهبطون على `/my-workspace` مباشرة.
### Added
- بطاقة KPI جديدة "Team Target" في `/command-center` (لوحة الإدارة) تجمع أهداف كل المندوبين (سنوي، مع fallback شهري) — يحل طلب "الإدارة تشوف الهدف الإجمالي".
### Verified
- `bun run verify` نظيف، 463/463 اختبار.

---

## 2026-07-26 — Phase 2: نقطة إدخال موحّدة + توحيد صفحات الـ pipeline
تنفيذ مباشر بموافقة المستخدم على العمل بشكل مستقل دون توقف للمراجعة بين كل خطوة. التفاصيل الكاملة في PR الخاص بهذه المرحلة.
### Added
- حوار "New Entry" موحَّد (`NewEntryDialog`) يجمع 5 نماذج كانت منفصلة (Intake/Lead/RFQ/Quotation/BOQ) خلف مصنِّف نوع واحد، مربوط بقائمة "+" العائمة الموجودة أصلًا في كل صفحة. توجيه بحت فوق دوال create* الحالية — لا جداول جديدة، لا تغيير في أي حارس أمان قائم.
### Changed
- صفحتا "RFQ & JIH Board" و"BOQ Center" أُلغيتا كصفحتين منفصلتين؛ محتواهما الكامل (بلا أي تغيير سلوكي) أصبح تبويبين داخل صفحة Quotations (التي تبقى الصفحة الوحيدة الناجية، حسب قرار العميل الصريح). الروابط القديمة `/rfq-jih` و`/boq` أصبحت إعادة توجيه لـ `/quotations؟tab=...` بدل الحذف الكامل، حفاظًا على أي رابط محفوظ مسبقًا.
### Verified
- `bun run verify` نظيف، بناء الإنتاج ناجح. فحص QA يدوي تفاعلي مؤجَّل (لا توجد أداة متصفح في هذه الجلسة).

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
