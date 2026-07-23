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

## 2026-07-23 — Pathfinder D1–D6: توحيد التكرار المعماري (6 PRs مدموجة)
مسح معماري كامل (Pathfinder، 2026-07-22) كشف 6 حالات تكرار/مخاطر عبر الكود، نُفِّذت كل واحدة في worktree منفصل، رُوجعت مرتين (بناء + مراجعة fresh-eyes مستقلة بعد فتح الـ PR)، ودُمجت جميعها إلى main بالترتيب #116→#117→#118→#119→#120→#121.
### Added
- helper خادم مشترك لإنشاء leads (`insertLeadServerSide`) يوحّد مساري `run_protenders_ingest` وimport `commit_candidates` (PR #119).
- migration لتوسيع قائمة الحذف المحكومة (`execute_approved_record_delete`) لتشمل `import_batches`، بحارس يمنع حذف الدفعات ذات السجلات الملتزمة (PR #120) — **لم يُنشر بعد**، ينتظر بوابة الموافقة.
- اختبار انحدار يقفل حذف `/team.tsx` غير المحمي (PR #118).
### Changed
- توحيد normalization أسماء الشركات العربية في module مشترك (`company-normalize.ts`)، إزالة نسختين مكررتين (PR #116).
- نقل زر Scan Pipeline من `/ai-agents` إلى `/agent-activity` (PR #117).
- توحيد حساب KPIs (JIH الإجمالي، الفرص المُرسّاة) بين لوحتَي المندوب والمدير في `dashboard-helpers.ts` (PR #121) — أصلح أيضًا bug عمود `stage` المفقود من استعلامَي `awardedOpps`.
### Fixed
- إزالة صفحة `/team` غير المحمية (بلا beforeLoad role check) التي كانت تعرض روستر الشركة الكامل لأي مستخدم مسجّل دخول (PR #118، أولوية أمنية).
- حلقة إدراج leads في `run_protenders_ingest` كانت بلا try/catch — فشل صف واحد كان يُسقط الدفعة كاملة (اكتُشف أثناء مراجعة fresh-eyes، أُصلح في PR #119).

---

## 2026-07-20 — Data Import to Live CRM (Part 3/3)
### Added
- التزام المرشّحين المعتمَدين إلى الـ CRM الحي (PR #108).
