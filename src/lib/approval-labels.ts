// =============================================================================
// What an approval is called, and whether it is the manager's decision.
//
// Reported 2026-10-19: "Approve should be limited to what really needs the
// manager's decision, like a discount, with clear names." The queue showed raw
// codes ("TENDER TO JIH APPROVAL", "Ai Recommendation") and mixed real
// commercial decisions with routine items — intake triage, AI suggestions,
// discussion mentions, delete requests — that a manager has to scroll past.
//
// The split below only decides where a row is SHOWN. Who may decide it is
// still enforced by the database and decide_approval, unchanged.
// =============================================================================

type Lang = "en" | "ar";
type Label = { en: string; ar: string };

const LABELS: Record<string, Label> = {
  bafo: { en: "Final offer / discount (BAFO)", ar: "عرض نهائي وخصم (BAFO)" },
  discount: { en: "Discount", ar: "اعتماد خصم" },
  below_300k_exception: { en: "Exception: project under SAR 300k", ar: "استثناء: مشروع أقل من 300 ألف" },
  tender_to_jih_approval: { en: "Convert tender to JIH", ar: "تحويل المناقصة إلى JIH" },
  verbal_award_approval: { en: "Confirm verbal award", ar: "تأكيد الترسية الشفهية" },
  contract_approval: { en: "Confirm contract received", ar: "تأكيد استلام العقد" },
  won_approval: { en: "Confirm project won", ar: "تأكيد الفوز بالمشروع" },
  sure_win_approval: { en: "Mark as sure win", ar: "تصنيف كفوز مؤكد" },
  delete_request: { en: "Delete a record", ar: "طلب حذف سجل" },
  owner_assignment: { en: "Assign owner", ar: "تعيين مسؤول" },
  opportunity_stage_change: { en: "Change stage", ar: "تغيير المرحلة" },
  quotation: { en: "Quotation review", ar: "مراجعة عرض السعر" },
  management_review: { en: "Management review (for information)", ar: "مراجعة إدارية (للاطلاع)" },
  escalation: { en: "Escalation", ar: "تصعيد" },
  discussion_review: { en: "Review a discussion", ar: "مراجعة نقاش" },
  discussion_approval: { en: "Sign off a discussion", ar: "موافقة على نقاش" },
  discussion_endorsement: { en: "Endorse a discussion", ar: "تأييد نقاش" },
  ai_recommendation: { en: "AI recommendation", ar: "توصية الذكاء الاصطناعي" },
  intake_review: { en: "Review incoming request", ar: "مراجعة طلب وارد" },
  lead: { en: "Lead", ar: "اعتماد فرصة" },
  outreach: { en: "Outreach", ar: "اعتماد تواصل" },
  boq: { en: "BOQ", ar: "اعتماد BOQ" },
  tender: { en: "Tender", ar: "اعتماد مناقصة" },
  contract: { en: "Contract", ar: "اعتماد عقد" },
  won_lost: { en: "Won / lost", ar: "اعتماد ربح/خسارة" },
  account_ownership: { en: "Account ownership change", ar: "تغيير ملكية حساب" },
};

/**
 * Decisions that are genuinely the commercial manager's: money given away
 * (discount, BAFO, the small-project exception), a tender committed to, and a
 * deal counted as awarded or won. Everything else is routine.
 */
const MANAGER_DECISIONS = new Set([
  "bafo",
  "discount",
  "below_300k_exception",
  "tender_to_jih_approval",
  "verbal_award_approval",
  "contract_approval",
  "won_approval",
]);

const norm = (t: string | null | undefined) => (t ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

export function approvalTypeLabel(type: string | null | undefined, lang: Lang): string {
  const l = LABELS[norm(type)];
  if (l) return l[lang];
  const raw = (type ?? "").replace(/_/g, " ").trim().toLowerCase();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : lang === "ar" ? "اعتماد" : "Approval";
}

export function isManagerDecision(kind: "record" | "bafo" | "intake", type: string | null | undefined): boolean {
  if (kind === "bafo") return true;
  if (kind === "intake") return false;
  return MANAGER_DECISIONS.has(norm(type));
}

const ROLE_LABELS: Record<string, Label> = {
  "executive / sales_manager": { en: "GM or sales manager", ar: "المدير العام أو مدير المبيعات" },
  "bd_manager / sales_manager": { en: "BD or sales manager", ar: "مدير تطوير الأعمال أو مدير المبيعات" },
  "sales_manager / bd_manager": { en: "Sales or BD manager", ar: "مدير المبيعات أو مدير تطوير الأعمال" },
  estimation_manager: { en: "Estimation manager", ar: "مدير التسعير" },
  finance_manager: { en: "Finance manager", ar: "المدير المالي" },
  executive: { en: "General manager", ar: "المدير العام" },
};

export function approvalRoleLabel(role: string, lang: Lang): string {
  return ROLE_LABELS[role]?.[lang] ?? role;
}
