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

## 2026-08-05 (3) — نموذج إدخال واحد يوجّه نفسه
### Changed
- **نموذج واحد فقط لكل ما يدخل النظام** (`NewIntakeDialog`) — مُركَّب في ترويسة `AppShell` وفي صفحة الاستقبال بنفس المكوّن. عند الحفظ يُستنتج التصنيف ويُوجَّه العنصر مباشرة: `jih` ← فرصة في Pipeline (+RFQ وجهة اتصال وشركة ومتابعة ونشاط)، `tender` ← لوحة المناقصات، وبلا نوع/اسم ← يبقى للفرز اليدوي. §25 كلها خلف حفظة واحدة.
- `convertInboxToTender` أصبحت كل معطياتها اختيارية وتشتق الباقي من سجل الاستقبال — نفس شكل مسار الـRFQ، وهو ما يتيح للنموذج الواحد أن يوجّه بلا نافذة ثانية.
### Removed
- **`NewRfqDialog.tsx` ومفاتيحه في i18n** — نموذجان يغطيان نفس الأرض أسوأ من واحد يوجّه نفسه، ونموذج الاستقبال يحمل كل حقول §24 وأكثر. شرط §6 يتحقّق بتركيب النموذج الواحد في الترويسة.
- نسخة قائمة الحقول المحلية من صفحة الاستقبال — المصدر الوحيد الآن `newIntakeFields` داخل `NewIntakeDialog`.

---

## 2026-08-05 (2) — التحويل يُنتج فرصة، ومشروع الإنتاج يُؤجَّل إلى ما بعد الفوز
### Fixed
- **التحويل من الاستقبال كان يُنتج صف RFQ فقط بلا فرصة إطلاقًا** — فلا شيء يظهر في Pipeline → Opportunities بعد التصنيف والتحويل، ولا سجل قابل للتمرحل. `convertInboxToRfq` تستدعي الآن `createRfqWithOpportunity`: فرصة عند `rfq_received` + RFQ مربوط + جهة اتصال + شركة + متابعة + سجل نشاط (§25 بندا 2 و10).
- **حُذف "إنشاء مشروع جديد" من نافذة تحويل RFQ** — مشروع الإنتاج مكانه نهاية دورة الحياة (§29 Awarded → "create project handover")، وtrigger `create_project_from_won_opportunity` يبنيه عند الفوز. **ضرر خفي إضافي:** الـtrigger مشروط بـ`project_id IS NULL`، فإعطاء الفرصة مشروعًا مبكرًا كان يمنع إنشاء مشروعها الصحيح بعد الترسية للأبد.
- الواجهة تنتقل إلى **صفحة الفرصة** بعد التحويل، وعنصر الاستقبال يُشير إليها بدل الـRFQ.
### Changed
- بقي ربط اختياري بمشروع **قائم** في نافذة التحويل لحالة §39 (عدة مقاولين على مشروع واحد).
- `convertInboxToProject` (تصنيف "مشروع" الحقيقي) تنقل القطاع والمصدر من سجل الاستقبال بدل إسقاطهما.

---

## 2026-08-05 — معالجة ملاحظات فيصل الميدانية على تدفق الاستقبال
### Fixed
- **النموذج كان يُمسح بالكامل عند العودة للنافذة** — `ActionDialog` كان يُعيد البذر في `useEffect([open, fields])`، و`fields` تُبنى inline بكل render، وReact Query تُعيد الجلب عند focus. الخروج لنسخ رابط والعودة = فقدان كل ما كُتب. أصاب **كل نوافذ النظام**. أصبح البذر على حافة فتح النافذة فقط.
- **المشروع المُنشأ من نافذة التحويل كان يصل فارغًا** — الاختصار كان يسأل عن الاسم فقط ويُهمل 18 حقلًا عبّأها المستخدم بالاستقبال. `createProjectFromInboxItem` تنقلها كلها وتربط الشركات بمطابقة اسم دقيقة (بلا إنشاء تلقائي).
- **صفوف "تقديمات عاجلة" في My Day كانت جامدة** — تبدو قابلة للنقر بلا رابط. أصبحت تفتح الفرصة (أو لوحة RFQ إن لم تُربط بعد)، وأُصلح عنوان عمود كان يقول "رقم الطلب" عربيًا و"Project Name" إنجليزيًا فوق نفس الخلية.
- **إعادة التصنيف بعد التحويل كانت تُيتّم السجل الناتج** — `markConverted` يستبدل الرابط بلا فحص (§40 تشترط حفظ الأصل). كلا المسارين يرفض الآن برسالة صريحة.
### Added
- **زر "+ طلب جديد" بالترويسة** (§6) — نموذج واحد يُنشئ الشركة وجهة الاتصال والفرصة وسجل RFQ **مربوطًا بها** ومتابعة وسجل نشاط (§25)، بدل أربع شاشات. `createRfqWithOpportunity` كانت مبنية بلا مستدعٍ — رُبطت، وأُضيف `rfqs.opportunity_id` الذي كان مفقودًا.
- **التصنيف يُستنتج من النموذج** (§25.3) عند توفر `project_type` واسم المشروع؛ التصنيف اليدوي يبقى للعناصر الغامضة.
- **`updateInboxItem`** — سجل الاستقبال كان write-once، فلا يمكن تصحيح خطأ إملائي أو تغيير نوع المشروع. أصبح قابلًا للتعديل قبل التحويل.
- **حقل `file_or_url`** — يقبل رابطًا ملصوقًا أو ملفًا مرفوعًا. حقل الدليل كان مسمّى "URL" بينما نوعه رفع ملف فقط، ومصدر RFQ الأشيع بريد إلكتروني (§24 "Email reference").

---

## 2026-08-05 — إصلاح ربط المراحل + التحقق من التواريخ (فرع `fix/stage-wiring-and-date-validation-2026-08-05`)
### Fixed
- **`contract_signed` كانت تختفي من Award & Contract Queue** — الاستعلام كان يسرد 3 مراحل بشكل مباشر ولم يُحدَّث عند إضافة المرحلة (migration 20260716100000). صفقة على بُعد خطوة من الترسية كانت تغيب عن الطابور تمامًا.
- **`sales_stage` كان يبقى NULL** في مسارَي إنشاء من أصل 5 (`createOpportunityForCompany` من صفحة الحساب، وتحويل Lead إلى Opportunity) — السجل يعمل لكنه غير مرئي لأي لوحة JIH. رُصد حيًّا: فرصتان من 4 بالإنتاج.
### Added
- `src/lib/date-bounds.ts` — تحقق مركزي من حدود التواريخ + `min`/`max` على كل حقل `date` في `ActionDialog`. سببه سجل إنتاج حي بتاريخ `275760-07-29` (حد تاريخ JavaScript) كان يُخفي الـRFQ من كل استعلامات المواعيد للأبد.
- `src/lib/stage-canonical.ts` — تحضير refactor توحيد حقل المرحلة (غير مستخدَم بعد، لا تغيير سلوك).
- اختبارات حارسة: تغطية مراحل طابور الترسيات، وعقد يفرض ضبط `sales_stage` في كل `INSERT`.
- `docs/migration/sales-stage-backfill-plan.md` و`docs/migration/automation-idempotency-audit.md` — تخطيط فقط، لا تنفيذ.
- `docs/USER_GUIDE.md` — دليل تشغيلي كامل لسير العمل لكل الأدوار.

---

## 2026-08-04 — "إنشاء جديد" مباشر بنافذة تحويل RFQ (PR #167)
### Added
- حقلا Project/Company بنافذة تحويل RFQ (Lead & Tender Inbox) يدعمان "+ إضافة جديد" مباشرة.

---

## 2026-08-04 — اختبار شامل بالمتصفح + إصلاحات (PR #165)
تفاصيل كاملة في `docs/AI_HANDOFF.md`.
### Added
- `supabase/functions/deno.json` — يصلح تعطُّل `ai-orchestrator` بالتطوير المحلي بالكامل.
### Fixed
- كل استدعاءات AI (9 مواضع) تُظهر الآن رسالة الخطأ الحقيقية بدل رسالة SDK عامة.
- تحذير وصولية (a11y) بكل `ActionDialog` بلا وصف.
- تسمية "CRM" قديمة بصفحة Projects (الصحيح: Production).

---

## 2026-08-04 — توسيع تغطية AI عبر النظام (PR #163)
تفاصيل كاملة في `docs/AI_HANDOFF.md` وَ`docs/ai-orchestrator.md`. 4 وكلاء AI جدد، توحيد KPIs في Agent Activity، وإصلاح خللين حقيقيين كانا يعطِّلان ميزات AI موجودة منذ إطلاقها.
### Added
- وكلاء: `project_job_notes`، `project_budget_variance`، `commercial_risk_assessment` (RFQ/Tender/Quotation/Accounts)، `sales_report_insights`.
### Changed
- `agent-activity.tsx`: شريط KPI منفصل لكل من النظامين (الدفعي القديم + لكل-طلب الجديد) بدل حجب أحدهما.
### Fixed
- "Draft Follow-up" (My Workspace) و"Scan Pipeline" (`project_radar`) كانا معطَّلين بالكامل منذ الإطلاق — شكل طلب خاطئ في كليهما.

---

## 2026-08-04 — حذف زر "طلب جديد" من صندوق الاستقبال (PR #161)
### Changed
- "إدخال جديد" فقط الآن — JIH/Tender يبقيان متاحين بالكامل عبر إدخال جديد ← تصنيف ← تحويل.

---

## 2026-08-03/04 — لوحة مشاريع Production + نقلها لقسم الإنتاج (PR #160)
تفاصيل كاملة في `docs/AI_HANDOFF.md`. `project_number` تلقائي للمشاريع والاستقبال، صورة غلاف، Job Pipeline (Kanban مرن)، Budget، نقل المشاريع لقسم "الإنتاج" مع ربط تلقائي عبر trigger عند فوز الفرصة، Discussion قابل للتعديل/الحذف + منشن، Client Details قابل للتعديل، إصلاح خلل توجيه `/projects/$id`.
### Added
- `projects.project_number`, `inbox_items.project_number` (تلقائي)، `project_job_stages`/`project_jobs` (Kanban)، `project_budget_items`، `navgroup_production`، منشن على Discussion.
### Changed
- المشاريع نُقلت من قسم المبيعات إلى قسم الإنتاج بالتنقّل.
- Discussion على الفرص أصبح قابلاً للتعديل/الحذف (كان سجلاً غير قابل للتغيير).
### Fixed
- `/projects/$id` كانت غير قابلة للوصول إطلاقًا (خلل توجيه TanStack Router سابق).

---

## 2026-07-28 — تدقيق أمني شامل (/cso)
تدقيق أمني على كل مستويات النظام بناءً على طلب المستخدم — الكود، RLS، CI/CD، سلسلة التبعيات، أمان الذكاء الاصطناعي. تفاصيل كاملة في `docs/AI_HANDOFF.md`.
### Fixed
- 3 ثغرات في تبعيات البناء (`@babel/core`، `@hono/node-server`، `esbuild`) — `bun audit` نظيف تمامًا الآن.
- كل GitHub Actions عبر كل الـ workflows مثبَّتة الآن بـ commit SHA بدل tag فقط (حماية من اختراق سلسلة التوريد).
- توثيق قديم في `security-baseline.md` وَ`KNOWN_ISSUES.md` حُدِّث ليعكس إصلاحات سابقة فعلية.
### Added
- `.github/CODEOWNERS` يفرض مراجعة على تغييرات CI/CD وملفات الأمان.
### Security
- لا ثغرات جديدة حقيقية اكتُشفت في RLS أو الكود أو منطق الذكاء الاصطناعي — التدقيق أكَّد أن الحوكمة القائمة (RLS الشامل، تثبيت search_path، عزل الأسرار، حماية حقن أوامر LLM) سليمة وفعّالة.

---

## 2026-07-28 — توسيع ظهور الذكاء الاصطناعي + إصلاح قائمة الفريق
### Added
- ربط وكيلَي `data_cleanup` و`contact_mapping` (مبنيّان مسبقًا، بلا واجهة) بقسم جديد في صفحة تفاصيل دفعة الاستيراد.
- زر تشغيل لـ `opportunity_evaluation` بصفحة تفاصيل الفرصة (لم يكن له أي زر بالتطبيق سابقًا)، مع عرض حالة المراجعة واعتماد/رفض في السياق لكل من `opportunity_evaluation` وَ`risk_finance`.
### Fixed
- `relationship_resolver`: زر "Accept" كان كودًا ميتًا (يقرأ حقلًا لا يُرجعه مخطط مخرجات الوكيل) — استُبدل بحلّ فعلي يُخزِّن في جدول `import_candidate_links` المخصَّص عند الإمكان، أو ملاحظة موسومة بوضوح بدل الصمت.
- `admin-settings`: قائمة الفريق كانت تُخفي أي حساب معلَّق أو محذوف بالكامل (لا فقط زر التفعيل) — اكتُشف عبر بلاغ دعم حقيقي (تعذَّر استعادة حساب مُعلَّق).
### Security
- لا تغيير — كلا الإصلاحين طبقة تطبيق بحتة، بلا migrations.

---

## 2026-07-27 — سلسلة اعتماد BAFO / الخصومات التجارية
أول ميزة مُختارة من مواصفة أكبر بكثير (16 قسمًا، "دور مدير تطوير الأعمال داخل النظام") بعد سؤالين توضيحيين: الإبقاء على نموذج الرؤية المسطّح الحالي (بلا هرمية فريق)، وبناء سلسلة اعتماد BAFO فقط الآن (لوحة تحليلات BD وتتبع المنافسين وقائمة تسليم مؤجَّلة). تفاصيل كاملة في `docs/AI_HANDOFF.md`.
### Added
- دور `estimation_manager` جديد (خطوة اعتماد التكلفة في سلسلة BAFO).
- جدول `bafo_requests`: سلسلة اعتماد ثابتة من 4 خطوات بالترتيب الإلزامي — مراجعة تجارية (bd_manager/sales_manager) ← اعتماد التكلفة (estimation_manager) ← مراجعة مالية (finance_manager) ← اعتماد نهائي (تنفيذي).
- لوحة `BafoPanel` جديدة ضمن تبويب "القرار" بصفحة تفاصيل الفرصة.
### Changed
- —
### Security
- الترتيب الإلزامي للخطوات والصلاحية المطلوبة لكل خطوة مفروضان على مستوى قاعدة البيانات (trigger)، وليس الواجهة فقط.
- لا يمكن ضبط "تم الإرسال للعميل" إلا بعد اكتمال الاعتماد بالكامل (trigger يرفض أي محاولة مبكرة).
- كل قرار خطوة وكل إرسال للعميل يُسجَّل في audit_log.

---

## 2026-07-27 — عزل بيانات المبيعات، دور مالي جديد، ترقيم RFQ، حذف الحساب
تنفيذ مباشر لمستند متطلبات كامل من العميل، بعد قرارين حاسمين معماريًا أُكِّدا مع المستخدم قبل البدء (إضافة دور `finance_manager` جديد؛ عزل الفرص/RFQs/المناقصات فقط — الشركات/جهات الاتصال تبقى مشتركة لمنع تكرار الإدخال). تفاصيل كاملة في `docs/AI_HANDOFF.md`.
### Added
- دور `finance_manager` جديد (صلاحية وحيدة: تعديل Total Value).
- `rfqs`: أعمدة city، classification (+classification_other)، ترقيم تلقائي `RFQ-YYYY-####`.
- حالة حساب جديدة `deleted` — منفصلة تمامًا عن `suspended`، system_admin فقط، حذف منطقي بحت.
### Changed
- RLS: `opportunities`/`rfqs`/`tenders`/`quotations`/`follow_ups` مقصورة الآن على المالك أو الأدوار الإدارية (المندوب وحده يتأثر — `viewer` أُبقي كما كان).
- `/command-center`: حارس مسار جديد يُبعد مندوبًا خالصًا إلى `/my-workspace`.
- تعليق الحساب أصبح يتطلب تأكيدًا (لم يكن يطلب سابقًا).
### Security
- Total Value محمي على مستوى قاعدة البيانات (trigger) وليس الواجهة فقط.
- حذف الحساب محمي بـ trigger يقصره على system_admin، دفاعًا بالعمق فوق فحص الواجهة.
### Fixed during CI
- فحص pgTAP كشف نسيان دور `viewer` من قائمة "يرى كل شيء" — أُصلح قبل الدمج (45/45 pgTAP ناجح).
### Verified
- `bun run verify` نظيف (535/535 اختبار) + `supabase test db` (45/45 pgTAP) + تحقّق مباشر على الإنتاج بعد النشر.

---

## 2026-07-27 — Data Import: إصلاح فقدان البيانات الصامت + صلاحيات system_admin
تنفيذ مباشر بعد طلب المستخدم مراجعة شاملة لصفحة الاستيراد. تفاصيل كاملة في `docs/AI_HANDOFF.md`.
### Fixed
- عمود مستورَد لا يُطابِق حقلًا معروفًا كان يُفقَد صمتًا بالكامل (فُلتِر في التدفّق التلقائي، ومفتاح `__extra::` لم يكن يُفكَّك أبدًا، وأغلب الجداول لم يكن لديها `extra_data` أصلًا). أُصلح على مستوى Edge Function + migration (10 جداول) + التدفّق التلقائي (فلتر محذوف + احتياطان دفاعيّان).
- `import_batches_target_entity_check` كان يمنع 4 من أصل 10 أنواع كيانات قابلة للاستيراد (rfqs/tenders/follow_ups/quotations) من الإنشاء أصلًا.
- `system_admin cannot commit imports` — سُمح لـ system_admin بعمل approve/commit/rollback للاستيراد بقرار صريح من المستخدم.
### Changed
- التدفّق التلقائي (Auto-Import) يستدعي `generate_candidates` تلقائيًا بعد dry-run.
- `docs/ai-orchestrator.md` وثَّق 11 وكيل AI إضافي لم يكونوا موثَّقين (من أصل 14).
### Verified
- `bun run verify` نظيف (510/510 اختبار). Migrations مُطبَّقة ومُتحقَّق منها على الإنتاج. `import-pipeline` Edge Function أُعيد نشرها صراحةً (v33).
### Blocked / Future
- وكيلا AI `data_cleanup`/`contact_mapping` مبنيّان بلا واجهة مستخدم؛ `relationship_resolver` لا يزال يكتب لـ `raw_data` بدل `import_candidate_links`.

---

## 2026-07-27 — دفعة إصلاحات شاملة (9 مشاكل مُبلَّغة + الأشياء المؤجَّلة)
تنفيذ مباشر بموافقة شاملة مسبقة. تفاصيل كاملة في `docs/AI_HANDOFF.md`.
### Fixed
- خطأ "تعذّر إنشاء المسودة" (AI Draft) في متابعات My Day — قيم `channel` غير مدعومة تُطابَق الآن إلى ما يقبله وكيل `smart_followup_draft`.
- Agent Activity كان يقرأ من جدول `agent_runs` المهجور دائمًا الفراغ — أُعيد توجيهه إلى `ai_agent_runs` (البيانات الحقيقية).
- حقول "إضافة جديد" (شركة/مشروع) مفقودة في NewEntryDialog وفورمي المناقصات وجهات الاتصال — أُضيفت.
- بطاقات Projects/Reference Library كانت تُظهر تفاصيل قليلة رغم توفّر بيانات إنتاج حقيقية (verification_status، signage_package_status، source_confidence) — أُبرزت.
- قفل RBAC متكرر (منح sales_manager لحساب المدير الأعلى يمنع تصحيحه ذاتيًا) — migration تصحيحية ثالثة بنفس النمط المُثبَت، ثم **إصلاح جذري** لاحق (الحادثة الرابعة): `protect_last_manager()` كانت تمنع self-revoke لأي دور تجاري (sales_manager/executive) وليس فقط system_admin؛ ضُيِّق النطاق إلى system_admin فقط، مما يُغلق الحادثة نهائيًا دون الحاجة لـ migration يدوية مستقبلًا.
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
