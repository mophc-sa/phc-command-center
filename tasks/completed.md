# Completed — PHC Command Center

> المهام المكتملة تُنقل إلى هنا (لا تُحذف). الأحدث في الأعلى.

## 2026-08-04 — حذف زر "طلب جديد" من Lead & Tender Inbox
- الناتج: صفحة الاستقبال أصبحت بمدخل إنشاء واحد ("إدخال جديد") بدل اثنين — JIH/Tender يبقيان متاحين بالكامل عبر إدخال جديد ← تصنيف ← تحويل. حذف `createJihRequestWithOpportunity` غير المستخدَم + مفاتيح i18n يتيمة.
- PR: #161 · مدموج (`71de821`) · لا migrations · Cloudflare Worker منشور. تفاصيل كاملة في `docs/AI_HANDOFF.md`.

## 2026-08-03/04 — لوحة مشاريع Production + نقلها لقسم الإنتاج
- الناتج: `project_number` تلقائي (مشاريع + استقبال)، صورة غلاف، Job Pipeline (Kanban مرن بـ`@dnd-kit`)، Budget، نقل قسم المشاريع من المبيعات إلى الإنتاج مع ربط تلقائي عبر trigger عند فوز الفرصة، Discussion قابل للتعديل/الحذف + منشن، Client Details قابل للتعديل، زر "New Opportunity" من صفحة Account، إصلاح خلل توجيه `/projects/$id` القديم.
- PR: #160 · مدموج (`078484b`) · 4 migrations مطبَّقة على الإنتاج (`lrfdtoexyeghrzynapyn`) · Cloudflare Worker منشور. تفاصيل كاملة في `docs/AI_HANDOFF.md`.
- ملاحظة معلّقة: فحص "Dependency audit" الأمني فشل بعد الدمج — مسبق الوجود وغير مرتبط (تبعيات dev tooling فقط)، يحتاج PR منفصل صغير.

## 2026-07-23 — Pathfinder D1–D6: توحيد التكرار المعماري
- الناتج: 6 حالات تكرار/مخاطر معمارية (من مسح Pathfinder 2026-07-22 + اكتشاف D6 عبر `/investigate`) نُفِّذت كل واحدة في worktree منفصل عبر subagent-driven-development، رُوجعت مرتين (بناء + fresh-eyes مستقلة)، وكل الفجوات المطروحة (اختبار انحدار D4، فحص متصفح يدوي D3/D6، live smoke test لـ D2/D5) أُغلقت، ثم دُمجت جميعها إلى main.
- PRs (بترتيب الدمج): #116 (D1 — توحيد company-name normalization) · #117 (D3 — نقل زر Scan Pipeline) · #118 (D4 — حذف `/team` غير المحمي) · #119 (D2 — helper مشترك لإنشاء leads) · #120 (D5 — توحيد حذف import batches تحت التدفق المحكوم) · #121 (D6 — توحيد حساب KPIs بين اللوحات).
- ملاحظة معلّقة: migration D5 (`20260723120000_extend_delete_allowlist_import_batches.sql`) على main لكن لم تُنشر إلى الإنتاج بعد — تحتاج بوابة الموافقة المنفصلة.

## 2026-07-20 — Data Import → Live CRM (Part 3/3)
- الناتج: التزام المرشّحين المعتمَدين إلى الـ CRM الحي.
- PR: #108 · commit `4c1ffe4`.
