import type { Lang } from "@/lib/i18n";
import { approvalTypeLabel } from "@/lib/approval-labels";

/**
 * Automation flags (run_sales_automations) store their reason and recommended
 * action as fixed English sentences. This turns each known sentence into the
 * reader's language at display time; anything unrecognised is shown as written.
 * Keep in step with the literals in run_sales_automations.
 */
type Rule = [RegExp, (m: RegExpMatchArray, lang: Lang) => { en: string; ar: string }];

const fixed = (en: string, ar: string): Rule => [new RegExp(`^${en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), () => ({ en, ar })];

const RULES: Rule[] = [
  fixed("RFQ unassigned for 24h", "طلب تسعير بلا مسؤول منذ 24 ساعة"),
  fixed("Assign a sales owner to this RFQ.", "عيّن مسؤول مبيعات لطلب التسعير هذا."),
  fixed("Verbally awarded >14d without contract", "ترسية شفهية منذ أكثر من 14 يومًا دون عقد"),
  fixed("Follow up on the contract and record it once received.", "تابع العقد وسجّله عند استلامه."),
  fixed("Verbal award recorded without evidence", "ترسية شفهية مسجلة دون دليل"),
  fixed("Upload verbal award evidence (email, letter, or call note).", "ارفع دليل الترسية الشفهية (بريد أو خطاب أو ملاحظة مكالمة)."),
  fixed("Contract stage reached without a contract reference number", "وصلت الصفقة لمرحلة العقد دون رقم مرجعي للعقد"),
  fixed("Record the signed contract reference number.", "سجّل الرقم المرجعي للعقد الموقّع."),
  fixed("Tender award expected within 7 days", "ترسية المناقصة متوقعة خلال 7 أيام"),
  fixed("Review the tender and confirm the go/no-go decision.", "راجع المناقصة وأكّد قرار المشاركة من عدمها."),
  fixed("Follow-up due today", "متابعة مستحقة اليوم"),
  fixed("Complete today's scheduled follow-up.", "أكمل متابعة اليوم المجدولة."),
  fixed("Contact the customer immediately and reschedule.", "تواصل مع العميل فورًا وأعد الجدولة."),
  fixed("Important opportunity has no next action set", "فرصة مهمة بلا إجراء تالٍ محدد"),
  fixed("Set the next action and its due date.", "حدّد الإجراء التالي وتاريخ استحقاقه."),
  fixed("Log an activity or reassess the opportunity.", "سجّل نشاطًا أو أعد تقييم الفرصة."),
  fixed("No client call, visit, meeting or sent message has ever been recorded", "لم يُسجَّل أي اتصال أو زيارة أو اجتماع أو رسالة مرسلة للعميل"),
  fixed("Log the last real contact, or record one now.", "سجّل آخر تواصل فعلي، أو سجّل تواصلًا الآن."),
  fixed("Review and decide this approval.", "راجع هذا الاعتماد واتخذ القرار."),
  fixed("Review and decide on this approval request.", "راجع طلب الاعتماد هذا واتخذ القرار."),
  fixed("No follow-up on this quotation in 5+ days", "لا متابعة على عرض السعر هذا منذ 5 أيام أو أكثر"),
  fixed("Follow up with the client on this quotation.", "تابع مع العميل بخصوص عرض السعر هذا."),
  fixed("Follow up with the client on the submitted quotation.", "تابع مع العميل بخصوص عرض السعر المقدَّم."),
  fixed("Prepare and submit the quotation, or hand it back with a reason.", "جهّز عرض السعر وقدّمه، أو أعده مع ذكر السبب."),
  [/^Follow-up overdue since (\d{4}-\d{2}-\d{2})$/, (m) => ({ en: m[0], ar: `متابعة متأخرة منذ ${m[1]}` })],
  [/^Submission due (\d{4}-\d{2}-\d{2}) is waiting on you$/, (m) => ({ en: m[0], ar: `التقديم المستحق في ${m[1]} بانتظارك` })],
  [/^Tier A opportunity with no client contact in (\d+)\+ days$/, (m) => ({ en: m[0], ar: `فرصة من الفئة A بلا تواصل مع العميل منذ ${m[1]}+ يومًا` })],
  [/^Pending (.+) approval$/, (m, lang) => ({ en: `Pending approval: ${approvalTypeLabel(m[1], "en")}`, ar: `بانتظار الاعتماد: ${approvalTypeLabel(m[1], lang === "ar" ? "ar" : "en")}` })],
];

export function localizeFlagText(s: string | null | undefined, lang: Lang): string | null {
  if (s == null) return null;
  const v = s.trim();
  for (const [re, f] of RULES) {
    const m = v.match(re);
    if (m) return f(m, lang)[lang];
  }
  return s;
}
