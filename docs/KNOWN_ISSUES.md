# KNOWN ISSUES — PHC Command Center

> مشاكل معروفة لم تُحَل نهائيًا. تمنع إعادة اكتشافها من الصفر.

---

### Lovable MCP routes على Windows
- **Symptom:** مسارات MCP قد تحتاج إعادة توليد بعد التغيير.
- **Workaround:** أعِد توليدها في Lovable، أو اضبط `ENABLE_LOVABLE_MCP=true` في بيئة لا ينطبق عليها مشكلة مسار Windows.
- **Status:** mitigated
- المرجع: قسم Troubleshooting في `README.md`.

---

### اختبارات DB تتطلب Docker
- **Symptom:** `bun run test:db` يفشل إن لم يكن Docker/Supabase محليًا شغّالًا.
- **Workaround:** شغّل Docker Desktop وتأكد `supabase status` ينجح قبل الاختبار.
- **Status:** by-design

---

### `bun audit` يطبع gzip خامًا بدل تقرير مقروء — يُخفي عمليًا ثغرات high حقيقية
- **Symptom:** `bun run audit:deps` (`bun audit --audit-level=high`, bun 1.3.14) يفشل بـ exit 1 لكن يطبع بايتات gzip مضغوطة غير مقروءة بدل JSON، محليًا وفي CI (فحص "Dependency audit") على حدٍّ سواء. لا أحد يرى السبب الحقيقي من سجل CI بدون `gunzip` يدوي على المخرجات.
- **postcss (مُصلَح 2026-07-26):** `postcss@8.5.15` (GHSA-6g55-p6wh-862q وGHSA-r28c-9q8g-f849، قراءة ملفات/path traversal عبر sourceMappingURL)، يصل عبر `vite → @tailwindcss/vite`. أُصلح بإضافة `"postcss": "^8.5.18"` إلى `package.json`'s `overrides` (يحل إلى `8.5.23` فعليًا) — لا يكسر شيئًا (`postcss` لم يغيّر شكل الـ API بين هذه النُّسخ). `bun run verify` نظيف بالكامل بعده.
- **brace-expansion (مُصلَح 2026-07-27):** كان `brace-expansion@1.1.16` (GHSA-mh99-v99m-4gvg / CVE-2026-14257، DoS عبر تضخّم غير محدود في الطول) يصل عبر `eslint → @eslint/config-array@0.21.2 → minimatch@3.1.5`. أُصلح فعليًا (وليس بـ override) بترقية `eslint` إلى `^10.8.0` (يسحب `@eslint/config-array@^0.23.5` ← `minimatch@^10.2.5` ← `brace-expansion@5.0.8`، النسخة المُرقَّعة). أُزيل override `brace-expansion` القديم من `package.json` (لم يعد لازمًا ويقيّد الحل الطبيعي). تحقَّقنا: `bun pm ls --all` يُظهر `brace-expansion@5.0.8` فعليًا مثبَّتة، و`bun audit --audit-level=high` نظيف (exit 0).
  - **تبعيات أُخرى رُقِّيت معها:** `@eslint/js@^10.0.1`، `eslint-plugin-react-hooks@^7.1.1`، `eslint-plugin-react-refresh@^0.5.3`، `typescript-eslint@^8.65.0` (كلها تدعم eslint 10 كـ peer). Node الحالي `v24.18.0` يفي بمتطلب eslint 10 (`^20.19.0 || ^22.13.0 || >=24`).
  - **قرار تصميم مهم:** `eslint-plugin-react-hooks@7.x`'s `recommended` config يوسّع الفحص من قاعدتين (`rules-of-hooks`, `exhaustive-deps`) إلى حزمة كاملة من قواعد "React Compiler readiness" (`purity`, `set-state-in-effect`, `immutability`, `refs`, ...) كأخطاء عبر الكود بأكمله (~19 خطأ جديد عبر ~15 ملفًا عند التجربة). هذا توسّع نطاق منفصل تمامًا عن إصلاح ثغرة CVE، لذا أبقى `eslint.config.js` مُقيَّدًا صراحةً على نفس القاعدتين القديمتين فقط (`react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`) — تبنّي حزمة القواعد الجديدة قرار منتج/هندسة منفصل يحتاج مراجعة مقصودة، وليس تأثيرًا جانبيًا صامتًا لترقية أمنية. أصلحنا فقط خطأين حقيقيين غير مرتبطين بـ react-hooks (`no-useless-assignment` — متغيرات ميتة في `import-pipeline/index.ts` و`ai-orchestrator.contract.test.ts`، والتي كانت قاعدة جديدة في `@eslint/js@10`).
  - **`bun run verify` نظيف بالكامل بعد الترقية** (typecheck + lint 0 أخطاء + test 497/497 + build).
- **Status:** postcss مُصلَح 2026-07-26. brace-expansion مُصلَح 2026-07-27 عبر ترقية eslint 10.

---

### Data Import: بيانات غير مُطابَقة لعمود كانت تُفقَد بصمت (مُصلَح 2026-07-27)
- **Symptom:** أي عمود في ملف الاستيراد لا يُطابِق حقلًا معروفًا في CRM كان يُفقَد كليًا: (أ) في التدفّق التلقائي (Upload & Auto-Import)، اقتراح AI بتوجيه العمود إلى "Additional Data" كان يُستبعَد صراحةً قبل الحفظ (`data-import.index.tsx`، فلتر `!== EXTRA_DATA_SENTINEL`)؛ (ب) حتى عند اختيار المستخدم يدويًا "Additional Data"، كانت القيمة تُكتب بمفتاح حرفي `__extra::{اسم العمود}` في `mapped_data` دون وجود أي كود يُفكِّك هذا المفتاح لاحقًا (تعليق يشير لدالة `collectExtraData()` غير موجودة إطلاقًا في الكود) — فيصل هذا المفتاح كعمود مباشر غير موجود في جدول الهدف عند `commit_candidates`، فيفشل إدراج الصف بالكامل. أعمدة الهدف (`extra_data jsonb`) كانت موجودة فقط على 3 جداول (companies/contacts/leads) من أصل 10 أنواع كيانات قابلة للاستيراد فعليًا.
- **الإصلاح:**
  1. `commit_candidates` الآن يُفكِّك مفاتيح `__extra::` من `proposed_payload` ويُعيد تجميعها في كائن `extra_data` متداخل بدل تركها كأعمدة حرفية مسطَّحة (`supabase/functions/import-pipeline/index.ts`).
  2. Migration `20260727140000` أضافت عمود `extra_data jsonb` (+ GIN index) لكل الجداول العشرة القابلة للاستيراد (كانت مفقودة على: opportunities, projects, quotations, follow_ups, boqs, rfqs, tenders).
  3. التدفّق التلقائي (`data-import.index.tsx`) لم يعد يستبعد اقتراحات `EXTRA_DATA_SENTINEL`، وأُضيف احتياط دفاعي: أي عمود مصدر لم يقترح له AI أي شيء إطلاقًا (ولا حتى تخطّي) يُعيَّن تلقائيًا لـ `extra_data`؛ وإن فشلت مكالمة AI للتخطيط بالكامل، كل الأعمدة تُوجَّه لـ `extra_data` بدل إفشال الدفعة بالكامل بصفر أعمدة محفوظة.
  4. Migration `20260727150000` أصلحت أيضًا `import_batches_target_entity_check` — كان يسمح بـ 6 من أصل 10 أنواع كيانات فقط (`rfqs`/`tenders`/`follow_ups`/`quotations` مفقودة) — أي دفعة استيراد تستهدف أحد هذه الأربعة كانت تفشل عند الإنشاء مباشرة، قبل أن يبدأ أي شيء.
- **تحقّق:** اختبارات contract جديدة (`import-extra-data.contract.test.ts`) تغطي كل النقاط أعلاه. `bun run verify` نظيف بالكامل.
- **متبقٍّ (فرصة مستقبلية، ليست عطلًا):** وكيلا AI `data_cleanup` وَ`contact_mapping` مبنيّان ومُختبَران بالكامل على مستوى الـ backend لكن بلا أي واجهة مستخدم تستدعيهما (`runDataCleanup`/`runContactMapping` في `import-actions.ts` بلا أي نقطة استدعاء) — فرصة حقيقية لاستخدام أدوات AI جاهزة، لا تطوير وكيل جديد. `relationship_resolver` يكتب مخرجاته في `import_rows.raw_data.__relationship_hints` بدل جدول `import_candidate_links` المُخصَّص لذلك أصلًا — تناقض معماري صغير غير مُصلَح بعد. راجع `docs/ai-orchestrator.md`، قسم "Later agents".
- **Status:** الفقدان الصامت للبيانات مُصلَح بالكامل 2026-07-27. الفرص المذكورة أعلاه متبقية لجلسة مستقبلية مخصَّصة.

---

<!-- انسخ كتلة مشكلة جديدة أعلى هذا السطر -->
