# DECISIONS — سجل قرارات PHC Command Center

> الأحدث في الأعلى. لا تحذف قرارًا — إن تغيّر، أضِف قرارًا جديدًا يشير إليه.
> القرارات أدناه مستخلَصة من الحالة القائمة للمستودع (يوليو 2026) — راجعها وصحّح أي تفصيل.

---

## 2026-08-05 — D6: مرحلة البداية لأي فرصة جديدة هي `rfq_received` وليست `jih`
**القرار:** كل مسار يُنشئ فرصة يضبط `sales_stage = 'rfq_received'`. يشمل ذلك المسارين اللذين كانا يتركانه `NULL` قبل PR #169: `createOpportunityForCompany` (زر New Opportunity بصفحة الحساب) و`convert_lead_to_opportunity`. **لا يُستخدم `jih` كمرحلة إنشاء إطلاقًا** — يُوصَل إليها فقط بانتقال صريح من `rfq_received`.

**السبب:** محسوم بمواصفة العميل (وثيقة إعادة تصميم لوحة المبيعات، 46 قسمًا) — ليس اجتهادًا:
- **§4.2** أول مرحلة في مسار JIH اسمها حرفيًا **"New JIH RFQ"** (ومقابلها "New Tender RFQ" في مسار المناقصات). أي أن الفرصة تبدأ عند الـRFQ، لا بعده.
- **§25** "When a new RFQ is saved, automatically: … 2. Create the opportunity. 3. Classify it as Tender or JIH." — إنشاء الفرصة **نتيجة** لحفظ RFQ.
- **§33** "The Business Development module must track opportunities **before an RFQ is received**" ثم "**When an RFQ is received**, convert the BD lead into an RFQ" — النشاط السابق للـRFQ مكانه وحدة BD كـ`lead`، لا كفرصة. فتحويل Lead إلى فرصة يقع **لحظة** استلام الـRFQ، أي عند `rfq_received` بالضبط.

بعبارة أخرى: بحسب المواصفة **لا توجد فرصة قبل وجود RFQ**، فلا يصح أن تُولد فرصة عند `jih` — تلك مرحلة تالية تعني أن العمل التقديري/الفني بدأ فعلًا.

**كيف يُستخدم:** مفروض باختبار عقد `src/lib/opportunity-sales-stage.contract.test.ts` الذي يحلّل جسم كل `INSERT` في المواقع الخمسة ويسقط إن أغفل أحدها العمود أو استخدم قيمة أخرى. لا تُعِد فتح هذا كسؤال منتج — الجواب في المواصفة نصًّا.

**ملاحظة مترتبة (لم تُنفَّذ):** بحسب نفس المنطق، زر "New Opportunity" بصفحة الحساب يُنشئ فرصة بلا RFQ مقابل — وهو ما لا تعرّفه المواصفة. إمّا أن يُطلب RFQ ضمن نفس التدفق، أو يُعاد تصنيفه كـBD lead. بند مفتوح في `tasks/backlog.md`.

## 2026-07-26 — D2: توسيع مفردات leads.source وترك owner_id فارغًا مقصود
**القرار:** `leads.source = 'import'` قيمة رسمية معتمَدة الآن إلى جانب `protenders | external | manual` الأصلية (`20260707100030_leads.sql`). كما أن ترك `owner_id` فارغًا (`NULL`) عند إنشاء leads من الخادم (commit_candidates وrun_protenders_ingest) **مقصود** — لا يُعيَّن مالك افتراضي تلقائيًا، والتعيين يتم لاحقًا من قِبل مستخدم بشري.
**السبب:** توثيق فقط لسلوك قائم فعليًا في `_shared/leads.ts::insertLeadServerSide()` منذ PR #119 — لا حاجة لتغيير الكود أو البيانات.
**كيف يُستخدم:** موثَّق أيضًا عبر `COMMENT ON COLUMN` في migration `20260726100000_document_leads_source_owner_id.sql` (توثيقية بحتة، بلا تغيير سكيما). لا تُعِد فتح هذا كسؤال منتج معلّق.

## 2026-07-26 — D1: توسيع مطابقة الأسماء العربية لتشمل project_name وmain_contractor
**القرار:** مطابقة التكرار (duplicate detection) في `import-pipeline` (`compareSignals()`، `_shared/import-dedup.ts`) تُوسَّع لتقارن `main_contractor` أيضًا (بجانب `company_name` وproject_name الموجودَين مسبقًا)، باستخدام نفس `normalizeCompanyName()` الموحَّدة من D1. كانت `DedupSignals.main_contractor` مُعرَّفة في النوع ومُمرَّرة من `import-pipeline/index.ts` لكن لم تُقارَن فعليًا — فجوة صامتة أُغلقت الآن.
**السبب:** `duplicates.ts` (محرك كشف التكرار العام) كان يقارن الحقول الثلاثة (name/project_name/contractor_name) بالفعل؛ `import-dedup.ts` (مسار الاستيراد) كان متأخرًا وناقصًا لحقل واحد فقط.
**كيف يُستخدم:** موثَّق باختبار جديد في `src/lib/import-dedup.test.ts` ("main_contractor match is detected"). confidence=0.65، reason_code=`same_main_contractor`، suggested_action=`needs_manual_review` — أقل من project_name (0.7) عمدًا لأن اسم المقاول وحده أضعف إشارة تكرار من اسم المشروع.

## 2026-07-23 — تأجيل الفحوصات الوظيفية وUAT بعد نشر D1/D2/D5
**القرار:** بعد نشر migration D5 وEdge Functions المتأثرة (`import-pipeline`, `sales-os-api`) إلى الإنتاج، تأجيل الفحوصات الوظيفية وUAT (تتطلّب كتابة بيانات اختبار في CRM حي) — غير عاجلة، تُنفَّذ لاحقًا وليس فورًا.
**السبب:** الـ preflight وفحوصات الصحة الآلية (migration lint نظيف، نسخ Edge Functions صحيحة، 401 متوقَّع على الطلبات غير المصادَقة) كانت كافية لتأكيد أن النشر لم يكسر شيئًا. المستخدم قرّر أن الفحص العميق بمستخدمين حقيقيين ليس أولوية فورية.
**كيف يُستخدم:** لا تُعِد افتراض أن هذا البند "معلّق بشكل حرج" في جلسات لاحقة — هو في `tasks/backlog.md` بانتظار وقت مناسب، وليس حاجزًا أمام أي عمل آخر.

## 2026-07 — النشر مبوّب بموافقة بشرية
**القرار:** لا نشر تلقائي لموارد Supabase أو Cloudflare عند دمج `main`؛ النشر عبر GitHub Actions dispatch يدوي داخل بيئة `production-cloudflare` المحمية.
**السبب:** حماية بيانات CRM الحية ومنع نشر غير مقصود. المرجع: `docs/deployment-governance.md`.

## 2026-07 — بوابة AI واحدة (ai-orchestrator)
**القرار:** كل وكلاء AI خلف Edge Function واحدة backend-only. ممنوع الاستدعاء المباشر من الـ frontend أو إضافة Edge Function لكل وكيل.
**السبب:** توحيد الحُرّاس (guardrails)، منع تسريب المفاتيح، ونقطة تحكم واحدة. المرجع: `docs/ai-orchestrator.md`.

## 2026-07 — عزل مشروعَي Supabase
**القرار:** الإنتاج على `lrfdtoexyeghrzynapyn` فقط؛ المشروع القديم `xpoduufwoklvsbuhywsv` لا يُعدَّل إطلاقًا.
**السبب:** فصل صارم يمنع الكتابة على بيانات قديمة/حساسة.

## 2026-07 — Cloudflare Workers مع إبقاء Lovable fallback
**القرار:** الإنتاج على Cloudflare Worker `mophc-sa-phc-command-center`؛ يبقى `lovable-fallback` واستضافة Lovable متاحين حتى تنجح إصدارتان إنتاجيتان متتاليتان في Production Readiness.
**السبب:** انتقال آمن دون انقطاع.

## 2026-07 — Bun كمدير حزم/تشغيل
**القرار:** Bun 1.3.14 (`bun.lock`, `bunfig.toml`) بدل npm/pnpm.
**السبب:** سرعة وتوحيد بيئة التطوير والاختبار.

---

<!-- انسخ كتلة قرار جديدة أعلى هذا السطر -->
