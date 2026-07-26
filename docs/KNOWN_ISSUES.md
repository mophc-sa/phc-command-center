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

<!-- انسخ كتلة مشكلة جديدة أعلى هذا السطر -->
