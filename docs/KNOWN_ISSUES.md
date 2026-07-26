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
- **brace-expansion (لا يزال مفتوحًا — لا يوجد إصلاح آمن بسيط):** `brace-expansion@1.1.16` (GHSA-mh99-v99m-4gvg / CVE-2026-14257، نُشرت 2026-07-24 — قبل يومين فقط من اكتشافها هنا — DoS عبر تضخّم غير محدود في الطول)، يصل عبر `eslint → @eslint/config-array@0.21.2 → minimatch@3.1.5`.
  - **جُرِّب فعليًا (2026-07-26) وفشل:** إضافة override `"brace-expansion": "^5.0.8"` (النسخة الوحيدة المُرقَّعة فعليًا حسب الـ advisory الرسمي — `vulnerable_version_range: "<= 5.0.7"`, `first_patched_version: "5.0.8"`, بلا استثناء لأي نسخة 2.x/3.x/4.x وسيطة) **يكسر `bun run lint` بالكامل**: `TypeError: expand is not a function`. السبب: بين 1.x و5.x غيّرت `brace-expansion` شكل الـ export ثلاث مرات (1.x/2.x = دالة قابلة للاستدعاء مباشرة؛ 4.x = `{ default: fn }` بأسلوب ESM؛ 5.x = `{ expand: fn }` بتصدير مسمّى) — `minimatch@3.1.5` (الذي يستخدمه `@eslint/config-array@0.21.2` الحالي) يستدعيها بأسلوب 1.x/2.x القديم فقط، فينهار مع 5.0.8.
  - **لا يوجد إصلاح وسيط:** تأكَّدنا تجريبيًا (`node -e "require('brace-expansion')"`) أن 2.0.2 لا يزال بالشكل القديم المتوافق، **لكنه غير مُرقَّع** (الـ advisory يشمله صراحة ضمن `<=5.0.7`) — فلا توجد نسخة تجمع التوافق مع minimatch القديم والترقيع معًا.
  - **الإصلاح الحقيقي الوحيد:** ترقية `eslint` إلى إصدار يسحب `@eslint/config-array@^0.23.5` (يسحب `minimatch@^10.2.4` ← `brace-expansion@^5.0.5`، متوافق مع الـ API الجديد). eslint حتى أحدث 9.x (`9.39.5`) لا يزال مثبَّتًا على `@eslint/config-array: ^0.21.2` (لن يلتقط 0.23.x بسبب قاعدة caret على نسخ 0.x) — **الترقية تتطلب eslint 10.x تحديدًا (تغيير major)**. تأكَّدنا أن `typescript-eslint@8.59.0` (المُثبَّتة حاليًا) تدعم eslint 10 كـ peer (`^8.57.0 || ^9.0.0 || ^10.0.0`)، لكن eslint 10 يتطلّب Node `^20.19.0 || ^22.13.0 || >=24` ولم تُتحقَّق توافقية بقية الـ plugins (`eslint-config-prettier`, `eslint-plugin-prettier`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`) ولا تغييرات flat-config المحتملة. **يستحق مهمة ترقية eslint منفصلة ومُختبَرة بعناية، وليس إصلاحًا سريعًا** — راجع مع المستخدم قبل البدء.
- **الأثر العملي:** فحص "Dependency audit" في CI **أحمر على main نفسه** لأي PR جديد بسبب brace-expansion المتبقية — بوابة الدمج المذكورة في `docs/security/security-baseline.md` معطَّلة فعليًا لهذا الفحص تحديدًا (لم يمنع GitHub دمج PRs #72/#73/#74 لأن قواعد الحماية تطلب فحصين محدَّدين فقط، وDependency audit ليس من ضمنهما حاليًا — يستحق مراجعة إعداد Required status checks).
- **PRs dependabot #75 (production-dependencies) وَ#76 (development-dependencies) لا تُصلحان أيًا من الثغرتين إطلاقًا** (تأكَّدنا بفحص `bun.lock` في كلا الفرعين) وهما معطوبتان بشكل منفصل: `bun install --frozen-lockfile` يفشل عليهما بـ"lockfile had changes, but lockfile is frozen". لا تُدمَج قبل إعادة توليد bun.lock يدويًا عبر `bun install` (بلا frozen) والتحقق الكامل.
- **Status:** postcss مُصلَح 2026-07-26. brace-expansion لا يزال open — يحتاج قرار/تخطيط لترقية eslint 10 كمهمة منفصلة.

---

<!-- انسخ كتلة مشكلة جديدة أعلى هذا السطر -->
