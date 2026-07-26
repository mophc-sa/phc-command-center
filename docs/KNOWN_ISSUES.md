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

### `bun audit` يطبع gzip خامًا بدل تقرير مقروء — يُخفي عمليًا 2 ثغرة high حقيقية
- **Symptom:** `bun run audit:deps` (`bun audit --audit-level=high`, bun 1.3.14) يفشل بـ exit 1 لكن يطبع بايتات gzip مضغوطة غير مقروءة بدل JSON، محليًا وفي CI (فحص "Dependency audit") على حدٍّ سواء. لا أحد يرى السبب الحقيقي من سجل CI.
- **الاكتشاف الفعلي (بعد `gunzip` يدوي على المخرجات):** main يحمل حاليًا (2026-07-26) ثغرتين **high** حقيقيتين، كلتاهما في devDependencies انتقالية وليستا في번들 الإنتاج المنشور:
  - `brace-expansion@1.1.16` (GHSA-mh99-v99m-4gvg، DoS عبر OOM) — تصل عبر `eslint → @eslint/config-array → minimatch`.
  - `postcss@8.5.15` (GHSA-6g55-p6wh-862q وGHSA-r28c-9q8g-f849، قراءة ملفات/path traversal عبر sourceMappingURL) — تصل عبر `vite → @tailwindcss/vite`.
  - كلاهما أدوات بناء/lint فقط (لا تُشحن أو تُشغَّل في الـ Cloudflare Worker المنشور) — الخطر الفعلي منخفض رغم تصنيف CVSS.
- **الأثر العملي:** فحص "Dependency audit" في CI **أحمر على main نفسه الآن** لأي PR جديد — بوابة الدمج المذكورة في `docs/security/security-baseline.md` معطَّلة فعليًا لهذا الفحص تحديدًا (لم يمنع GitHub دمج PRs #72/#73/#74 لأن قواعد الحماية تطلب فحصين محدَّدين فقط من أصل الفحوصات الظاهرة، وDependency audit ليس من ضمنهما حاليًا — يستحق مراجعة إعداد Required status checks).
- **PRs dependabot #75 (production-dependencies) وَ#76 (development-dependencies) لا تُصلحان هاتين الثغرتين إطلاقًا** (تأكَّدنا بفحص `bun.lock` في كلا الفرعين — نفس نسخ brace-expansion/postcss/esbuild بالضبط) وهما معطوبتان بشكل منفصل: `bun install --frozen-lockfile` يفشل عليهما بـ"lockfile had changes, but lockfile is frozen" — أي أن bun.lock الذي أنشأه dependabot لا يطابق ما يحسبه bun فعليًا (typecheck-build أحمر لهذا السبب، غير متعلق بالثغرات). لا تُدمَج قبل إعادة توليد bun.lock يدويًا عبر `bun install` (بلا frozen) والتحقق الكامل.
- **Workaround/Fix المقترح (لم يُنفَّذ بعد):** ترقية `eslint` إلى نسخة تسحب `@eslint/config-array` أحدث (يحل brace-expansion)، وترقية `vite`/`@tailwindcss/vite` إلى نسخة تسحب postcss > 8.5.17 (يحل الثغرتين الأخريين) — كلاهما ترقية devDependency فقط، تحتاج `bun run verify` كامل بعدها. منفصل عن مشكلة gzip في bun نفسه (يستحق تقرير upstream لـ bun أو ترقية bun).
- **Status:** open — اكتُشف 2026-07-26 أثناء فحص PRs #72-#76.

---

<!-- انسخ كتلة مشكلة جديدة أعلى هذا السطر -->
