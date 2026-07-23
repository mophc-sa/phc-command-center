# Completed — PHC Command Center

> المهام المكتملة تُنقل إلى هنا (لا تُحذف). الأحدث في الأعلى.

## 2026-07-23 — Pathfinder D1–D6: توحيد التكرار المعماري
- الناتج: 6 حالات تكرار/مخاطر معمارية (من مسح Pathfinder 2026-07-22 + اكتشاف D6 عبر `/investigate`) نُفِّذت كل واحدة في worktree منفصل عبر subagent-driven-development، رُوجعت مرتين (بناء + fresh-eyes مستقلة)، وكل الفجوات المطروحة (اختبار انحدار D4، فحص متصفح يدوي D3/D6، live smoke test لـ D2/D5) أُغلقت، ثم دُمجت جميعها إلى main.
- PRs (بترتيب الدمج): #116 (D1 — توحيد company-name normalization) · #117 (D3 — نقل زر Scan Pipeline) · #118 (D4 — حذف `/team` غير المحمي) · #119 (D2 — helper مشترك لإنشاء leads) · #120 (D5 — توحيد حذف import batches تحت التدفق المحكوم) · #121 (D6 — توحيد حساب KPIs بين اللوحات).
- ملاحظة معلّقة: migration D5 (`20260723120000_extend_delete_allowlist_import_batches.sql`) على main لكن لم تُنشر إلى الإنتاج بعد — تحتاج بوابة الموافقة المنفصلة.

## 2026-07-20 — Data Import → Live CRM (Part 3/3)
- الناتج: التزام المرشّحين المعتمَدين إلى الـ CRM الحي.
- PR: #108 · commit `4c1ffe4`.
