# Current Task — PHC Command Center

> بند واحد فعّال. عند اكتماله انقله إلى `completed.md` واسحب التالي من `backlog.md`.

## Objective
دمج ونشر PR #161 (حذف زر "طلب جديد" من Lead & Tender Inbox) — بانتظار موافقة المستخدم الصريحة ("ادمج وانشر").

## Files
- `src/routes/_authenticated/lead-tender-inbox.tsx`
- `src/lib/rfq-actions.ts`
- `src/lib/i18n.tsx`

## Acceptance Criteria
- [x] CI أخضر (باستثناء Dependency audit المعروف/غير المرتبط)
- [ ] دمج PR #161 إلى main
- [ ] لا migrations لهذه الدفعة — لا حاجة لبوابة db push

## Risks
- بيانات CRM حية — أي التزام/نشر يمرّ ببوابة موافقة.

## Done Definition
`bun run verify` ينجح · PR مفتوح · docs/AI_HANDOFF.md محدّث.
