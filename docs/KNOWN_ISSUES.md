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
- **@babel/core، @hono/node-server، esbuild (مُصلَحة 2026-07-28):** ثلاث ثغرات جديدة ظهرت من `/cso` (تدقيق أمني شامل): `@babel/core@<=7.29.0` (قراءة ملفات عبر sourceMappingURL)، `@hono/node-server@<2.0.5` (path traversal على Windows في serve-static، عبر `@lovable.dev/mcp-js`)، `esbuild@>=0.27.3 <0.28.1` (قراءة ملفات عبر خادم التطوير على Windows). الثلاثة أدوات بناء/تطوير محليّة فقط (لا تصل لبيئة الإنتاج على Cloudflare Workers)، لكن أُصلحت بنفس نمط `overrides` المُتّبع أعلاه (لا `bun update` عام — كان يُحرِّك 27 حزمة إنتاجية غير مرتبطة كـ React/TanStack/Supabase-js دون داعٍ). أُضيفت 3 قيم `overrides` جديدة (`@babel/core@^7.29.6`، `@hono/node-server@^2.0.5`، `esbuild@^0.28.1`). `bun audit` نظيف تمامًا بعدها (0 ثغرات).
- **Status:** postcss مُصلَح 2026-07-26. brace-expansion مُصلَح 2026-07-27 عبر ترقية eslint 10. الثلاث الجديدة مُصلَحة 2026-07-28.

---

### Data Import: بيانات غير مُطابَقة لعمود كانت تُفقَد بصمت (مُصلَح 2026-07-27)
- **Symptom:** أي عمود في ملف الاستيراد لا يُطابِق حقلًا معروفًا في CRM كان يُفقَد كليًا: (أ) في التدفّق التلقائي (Upload & Auto-Import)، اقتراح AI بتوجيه العمود إلى "Additional Data" كان يُستبعَد صراحةً قبل الحفظ (`data-import.index.tsx`، فلتر `!== EXTRA_DATA_SENTINEL`)؛ (ب) حتى عند اختيار المستخدم يدويًا "Additional Data"، كانت القيمة تُكتب بمفتاح حرفي `__extra::{اسم العمود}` في `mapped_data` دون وجود أي كود يُفكِّك هذا المفتاح لاحقًا (تعليق يشير لدالة `collectExtraData()` غير موجودة إطلاقًا في الكود) — فيصل هذا المفتاح كعمود مباشر غير موجود في جدول الهدف عند `commit_candidates`، فيفشل إدراج الصف بالكامل. أعمدة الهدف (`extra_data jsonb`) كانت موجودة فقط على 3 جداول (companies/contacts/leads) من أصل 10 أنواع كيانات قابلة للاستيراد فعليًا.
- **الإصلاح:**
  1. `commit_candidates` الآن يُفكِّك مفاتيح `__extra::` من `proposed_payload` ويُعيد تجميعها في كائن `extra_data` متداخل بدل تركها كأعمدة حرفية مسطَّحة (`supabase/functions/import-pipeline/index.ts`).
  2. Migration `20260727140000` أضافت عمود `extra_data jsonb` (+ GIN index) لكل الجداول العشرة القابلة للاستيراد (كانت مفقودة على: opportunities, projects, quotations, follow_ups, boqs, rfqs, tenders).
  3. التدفّق التلقائي (`data-import.index.tsx`) لم يعد يستبعد اقتراحات `EXTRA_DATA_SENTINEL`، وأُضيف احتياط دفاعي: أي عمود مصدر لم يقترح له AI أي شيء إطلاقًا (ولا حتى تخطّي) يُعيَّن تلقائيًا لـ `extra_data`؛ وإن فشلت مكالمة AI للتخطيط بالكامل، كل الأعمدة تُوجَّه لـ `extra_data` بدل إفشال الدفعة بالكامل بصفر أعمدة محفوظة.
  4. Migration `20260727150000` أصلحت أيضًا `import_batches_target_entity_check` — كان يسمح بـ 6 من أصل 10 أنواع كيانات فقط (`rfqs`/`tenders`/`follow_ups`/`quotations` مفقودة) — أي دفعة استيراد تستهدف أحد هذه الأربعة كانت تفشل عند الإنشاء مباشرة، قبل أن يبدأ أي شيء.
- **تحقّق:** اختبارات contract جديدة (`import-extra-data.contract.test.ts`) تغطي كل النقاط أعلاه. `bun run verify` نظيف بالكامل.
- ~~**متبقٍّ**: وكيلا AI `data_cleanup` وَ`contact_mapping` بلا واجهة مستخدم؛ `relationship_resolver` يكتب في `raw_data` بدل `import_candidate_links`~~ — **مُصلَح 2026-07-28**. الوكيلان أُضيفا كقسم "Data Quality & Contact Mapping" بصفحة تفاصيل دفعة الاستيراد. `relationship_resolver`'s زر "Accept" اكتُشف أنه كان كودًا ميتًا فعليًا (يقرأ حقلًا لا يُرجعه مخطط مخرجات الوكيل) — استُبدل بـ `acceptResolvedLink()` التي تكتب في `import_candidate_links` عند الإمكان، أو ملاحظة موسومة بوضوح خلاف ذلك. راجع `docs/AI_HANDOFF.md` (PR #148).
- **Status:** الفقدان الصامت للبيانات مُصلَح 2026-07-27. الفرص المذكورة أعلاه مُصلَحة أيضًا 2026-07-28. لا بنود متبقية من هذه المجموعة.

---

### Dependabot لا يكتب `bun.lock` إطلاقًا — كل PR تبعيات npm محجوب منذ 2026-07-26 (مُشخَّص 2026-08-25)
- **Symptom:** كل PR من dependabot لتبعيات npm يفشل في `typecheck-build` وَ`Dependency audit` بـ:
  `error: lockfile had changes, but lockfile is frozen`.
- **التشخيص الصحيح — وتصحيح لما كان مسجَّلًا:** الـbacklog كان يقول إن «`bun.lock` الذي أنشأه dependabot معطوب». **هذا خطأ.** dependabot **لا يُنشئ `bun.lock` إطلاقًا** — تحقَّقنا من ملفات ثلاثة PRs (`gh pr diff --name-only`): #75 و#135 و#183 كلها تُغيّر **`package.json` وحده**. وكل وظائف CI الخمس تُثبِّت بـ`bun install --frozen-lockfile`، فتفشل حتمًا.
- **لماذا هذا أخطر من إزعاج:** التصحيحات الأمنية تصل كـPRs من dependabot. حجبها يعني أن الترقيع الأمني التلقائي **معطَّل فعليًا منذ 26 يوليو**.
- **الإصلاح:** `.github/workflows/dependabot-lockfile.yml` — يعمل على دفعات فروع `dependabot/npm_and_yarn/**`، يشغّل `bun install --lockfile-only` (يحلّ فقط، **لا ينفّذ** أي postinstall من الحزم المُرقّاة) ويلتزم `bun.lock`. **مُثبَت عمليًا:** رفع `globals` في `package.json` وحده ← `--lockfile-only` يُعيد توليد القفل ← `--frozen-lockfile` يقبله.
- **⚠️ قيد معروف في الإصلاح:** الدفع بـ`GITHUB_TOKEN` الافتراضي **لا يُعيد تشغيل** أي workflow (سلوك مقصود من GitHub لمنع الحلقات). القفل يصل الفرع لكن الـrun الأحمر يبقى أحمر حتى يُغلق أحدهم الـPR ويعيد فتحه، أو يُستبدل الـtoken بـPAT/GitHub App.
- **Status:** الـworkflow مُضاف محليًا وغير مدفوع بعد.

---

### الترقيات المعلَّقة: #183 يكسر الكود · #135 محجوب بـtypescript-eslint (فُحصت 2026-08-25)
اختُبر كلاهما فعليًا في worktree معزول على `origin/main`، لا بالتخمين:
- **#183 (production-dependencies) — لا يُدمج بإصلاح القفل وحده.** يقترح أربع قفزات كبرى كاسرة: `@tanstack/react-table` 8→9 · `recharts` 2→3 · `lucide-react` 0→1 · `react-day-picker` 9→10. النتيجة **30 خطأ نوع في 5 ملفات**: `EntityDataGrid.tsx` (`useReactTable`/`getCoreRowModel` أُعيدت تسميتها في v9)، `GitSyncStatus.tsx` (أيقونة `Github` حُذفت من lucide v1)، `calendar.tsx` (`classNames.table` حُذف في v10)، `chart.tsx` وَ`command-center.tsx` (أنواع Tooltip تغيّرت في recharts v3). **يحتاج ترحيلًا مقصودًا، لا دمجًا.**
- **#135 (development-dependencies) — أربعة من خمسة آمنة.** الحاجز الوحيد هو `typescript` ^5.8.3 → ^7.0.2: البناء والاختبارات تمرّ، لكن **`eslint` ينهار كليًا**: `typescript-eslint does not support TS 7.0` (يُتتبَّع في typescript-eslint#10940). **تحقَّقنا:** بتثبيت `typescript` على `^5.8.3` وأخذ الأربعة الباقية (`@lovable.dev/vite-tanstack-config` · `@types/node` · `@vitejs/plugin-react` · `globals`) تصبح البوابات الأربع **خضراء بالكامل** (0 أخطاء · 1694 اختبارًا · build).
- **#182** (توثيق فقط) يفشل في `Dependency audit` وحده لأنه **متأخر 102 commit** — قفله يسبق overrides الأمان (postcss/babel/hono/esbuild). دمج `main` فيه يكفي.
- **#209** (actions/cache) **أخضر بالكامل** وجاهز للدمج.
- **الحسم (2026-08-25):** القفزات الأربع فُصلت إلى أربعة PRs — #219 (lucide) · #220 (react-day-picker) · #221 (recharts) · ~~#222 (react-table)~~. **#222 استُبدل بحذف:** `EntityDataGrid.tsx` (279 سطرًا) لم يستورده أحد قط — أُضيف في PR #59 والـcommit المُنشئ هو الوحيد في التاريخ الذي يذكره. فحُذف المكوّن وأُسقطت `@tanstack/react-table` كليًا. **وأُسقطت معها `@tanstack/react-virtual`** — تبيّن أن مستهلكها الوحيد كان نفس المكوّن، وإبقاؤها كان سيُعيد إنتاج المشكلة ذاتها. بذلك يمكن إغلاق #183.
- **ملاحظة على #220 تستحق التذكّر:** إشعار الإهمال في v9 يقول إن `classNames.table` "أُعيدت تسميتها إلى `UI.MonthGrid`"، لكن مصدر v9 يُظهر أن المُصيّر لا يقرأ أي مفتاح مهمَل — فالمفتاح كان ميتًا، وإعادة تسميته كانت ستُفعّل تنسيقًا لم يُطبَّق قط وتغيّر تخطيط التقويم داخل «ترقية تبعية». الحذف هو ما يحفظ السلوك.
- **Status:** مُشخَّص، لم يُدفع أي شيء.

---

### مسار الـcanary معطَّل — الإنتاج يُنشر بلا فحص صحّة مسبق (رُصد 2026-08-25)
- **Symptom:** ثلاث محاولات `Deploy Cloudflare Worker` بهدف `canary` فشلت يوم 2026-08-24 بنفس السبب:
  > Version … uploaded, but Cloudflare returned no `*.workers.dev` preview URL, so there is no isolated origin to health-check.
- **السبب:** **Preview URLs معطَّلة** للـworker `mophc-sa-phc-command-center`. وهي إعداد منفصل عن نطاق `workers.dev` الفرعي (Cloudflare → Settings → Domains & Routes). **ليست عيبًا برمجيًا** — الرسالة نفسها من PR #212 الذي جعل الـcanary يفشل بصوت عالٍ بدل أن ينجح كذبًا.
- **الأثر الحقيقي:** `target` في الـworkflow خياران متوازيان (`canary` أو `production`)، لا بوابة متسلسلة — الحارس الوحيد للإنتاج هو كتابة `agent.phc-sa.com` يدويًا. فعمليًا: بعد فشل الـcanary ثلاث مرات، نُشر الإنتاج مباشرة (run 32733690720، وظيفة `Deploy production` وحدها بلا أي وظيفة canary). **مسموح بالتصميم، لكن معناه أن كل نشر إنتاج يجري حاليًا بلا فحص صحّة على أصل معزول.**
- **الإصلاح:** تفعيل Preview URLs في لوحة Cloudflare — خطوة واحدة، خارج المستودع، تحتاج وصول المالك.
- **قرار مفتوح (منفصل):** هل يجب أن يكون نجاح الـcanary شرطًا لازمًا قبل الإنتاج بدل كونه خيارًا موازيًا؟
- **Status:** مُشخَّص. يحتاج إجراءً في Cloudflare لا في الكود.

---

<!-- انسخ كتلة مشكلة جديدة أعلى هذا السطر -->
