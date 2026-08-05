# Current Task — PHC Command Center

> بند واحد فعّال. عند اكتماله انقله إلى `completed.md` واسحب التالي من `backlog.md`.

## Objective
إصلاح فجوات ربط المراحل + التحقق من التواريخ، وتحضير الأرضية لتوحيد حقل المرحلة —
بناءً على تدقيق حي على الإنتاج (2026-08-05). خمسة بنود بموافقة صريحة من المستخدم:

1. `contract_signed` مفقودة من استعلام Award & Contract Queue.
2. لا تحقق من حدود التواريخ في أي حقل `date` (سجل حي بتاريخ سنة 275760).
3. تحقيق في سبب بقاء `sales_stage = NULL` + اقتراح backfill.
4. تحضير refactor توحيد حقل المرحلة (بلا تغيير القراءات بعد).
5. تدقيق idempotency لمحرك الأتمتة قبل جدولته بـpg_cron.

## Files
- `src/routes/_authenticated/award-queue.tsx` — البند 1
- `src/components/phc/ActionDialog.tsx` — البند 2 (تحقق مركزي)
- `src/lib/opportunity-actions.ts` · `src/lib/inbox-actions.ts` — البند 3
- `src/lib/stage-canonical.ts` (جديد) — البند 4
- `supabase/functions/sales-os-api/handlers/automation.ts` — البند 5

## Acceptance Criteria
- [ ] فرصة في `contract_signed` تظهر في طابور الترسيات وضمن إجماليّه.
- [ ] حقل تاريخ خارج النطاق المعقول يُرفض قبل الحفظ، برسالة واضحة بالعربية والإنجليزية.
- [ ] موثَّق أي مسار إنشاء يترك `sales_stage = NULL`، مع اقتراح backfill بلا تنفيذ على الإنتاج.
- [ ] دالة تحويل canonical بين `stage` و`sales_stage` + اختبارات، بلا تغيير سلوك أي صفحة.
- [ ] تقرير idempotency لكل قاعدة أتمتة: هل تكرار التشغيل يُنشئ تكرارًا؟
- [ ] `bun run verify` نظيف · PR مفتوح.

## Risks
- بيانات CRM حية — أي التزام/نشر يمرّ ببوابة موافقة.
- **لا تعديل على بيانات الإنتاج في هذه الدفعة.** الـbackfill اقتراح موثَّق فقط.
- البند 4 تحضيري فقط — تغيير قراءات command-center/reports دفعة منفصلة.

## Done Definition
`bun run verify` ينجح · PR مفتوح · docs/AI_HANDOFF.md محدّث.
