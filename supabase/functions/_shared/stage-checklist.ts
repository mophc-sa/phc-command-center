// =============================================================================
// Stage checklist — "evidence of done" per canonical sales stage.
//
// One definition for the deal page and the daily assistant, so both tick the
// same boxes for the same reasons. Items are AUTO when the system can see the
// evidence (a stakeholder with the right role, a quotation row, a date), and
// MANUAL when only the rep knows (a site visit, a scope review). The checklist
// informs; it never blocks a stage move — the stage gates do that.
//
// Design: docs/superpowers/specs/2026-10-07-stage-playbook-design.md
// =============================================================================

import type { CanonicalStage } from "./stage-canonical.ts";

export const BUYER_TYPES = ["main_contractor", "developer_owner", "consultant", "hotel_operator", "existing_client"] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

export const PREQUAL_STATUSES = ["not_started", "submitted", "under_review", "approved", "needs_completion"] as const;
export type PrequalStatus = (typeof PREQUAL_STATUSES)[number];

/** What the system knows about a deal when it evaluates the checklist. */
export type ChecklistFacts = {
  buyer_type: string | null;
  /** role_code of every stakeholder on the deal. */
  roles: readonly string[];
  /** The account's prequalification_status, null when the deal has no company. */
  prequalification_status: string | null;
  boq_item_count: number;
  quotation_count: number;
  expected_contract_date: string | null;
  contract_value: number | null;
  loss_reason: string | null;
  /** Manual items the rep ticked: item_key → done. */
  manual: Readonly<Record<string, boolean>>;
};

export type ChecklistItem = {
  key: string;
  en: string;
  ar: string;
  /** Present on auto items; absent means manual. */
  auto?: (f: ChecklistFacts) => boolean;
};

const has = (f: ChecklistFacts, role: string) => f.roles.includes(role);

const ITEMS = {
  buyer_type: { key: "buyer_type", en: "Buyer type set (who buys the signage package)", ar: "نوع المشتري محدد (من يشتري حزمة اللوحات)", auto: (f) => !!f.buyer_type },
  decision_maker: { key: "decision_maker", en: "Decision maker identified", ar: "صاحب القرار معروف", auto: (f) => has(f, "decision_maker") },
  procurement: { key: "procurement", en: "Procurement contact identified", ar: "جهة المشتريات معروفة", auto: (f) => has(f, "procurement") },
  tender_file: { key: "tender_file", en: "Tender file complete: BOQ, drawings, specs, sign schedule, latest revision", ar: "ملف المناقصة مكتمل: BOQ والرسومات والمواصفات وجدول اللوحات وآخر إصدار" },
  scope_review: { key: "scope_review", en: "Scope reviewed; sign codes, quantities and materials checked; queries listed", ar: "مراجعة النطاق: الأكواد والكميات والمواد مطابقة، والاستفسارات مسجلة" },
  scope_boundaries: { key: "scope_boundaries", en: "Scope boundaries agreed: design, BIM, civil works, electrical, access, permits", ar: "حدود الأعمال محددة: التصميم وBIM والأعمال المدنية والكهرباء والوصول والتصاريح" },
  site_visit: { key: "site_visit", en: "Site visit done, or confirmed not needed", ar: "زيارة الموقع تمت، أو تأكد أنها غير مطلوبة" },
  boq_priced: { key: "boq_priced", en: "BOQ has priced items", ar: "جدول الكميات فيه بنود مسعّرة", auto: (f) => f.boq_item_count > 0 },
  quotation: { key: "quotation", en: "Quotation issued", ar: "عرض السعر صادر", auto: (f) => f.quotation_count > 0 },
  prequalified: { key: "prequalified", en: "Account prequalification approved", ar: "تأهيل الحساب معتمد", auto: (f) => f.prequalification_status === "approved" },
  why_phc: { key: "why_phc", en: "\"Why PHC\" prepared for this project (references, samples, evidence)", ar: "«لماذا PHC» جاهز لهذا المشروع (مراجع وعينات وأدلة)" },
  evaluation_status: { key: "evaluation_status", en: "Evaluation status, blockers and decision date known", ar: "حالة التقييم والعوائق وموعد القرار معروفة" },
  clarifications: { key: "clarifications", en: "Clarifications and PTC answered", ar: "الاستفسارات وردود PTC مكتملة" },
  changes_approved: { key: "changes_approved", en: "Every discount, alternative or term change approved internally", ar: "كل خصم أو بديل أو تعديل شروط معتمد داخلياً" },
  revised_quote: { key: "revised_quote", en: "Revised quotation issued", ar: "عرض السعر المحدّث صادر" },
  expected_contract: { key: "expected_contract", en: "Expected contract date set", ar: "موعد العقد المتوقع محدد", auto: (f) => !!f.expected_contract_date },
  po_matched: { key: "po_matched", en: "PO / contract matched against the last approved quote; differences resolved", ar: "مطابقة PO/العقد مع آخر عرض معتمد، والاختلافات محسومة" },
  contract_value: { key: "contract_value", en: "Contract value recorded", ar: "قيمة العقد مسجلة", auto: (f) => f.contract_value != null && f.contract_value > 0 },
  handover_meeting: { key: "handover_meeting", en: "Handover meeting held with the projects team", ar: "اجتماع التسليم مع فريق المشاريع تم" },
  handover_file: { key: "handover_file", en: "Handover file delivered: scope, price, assumptions, commitments, payments", ar: "ملف التسليم مُسلَّم: النطاق والسعر والافتراضات والالتزامات والدفعات" },
  account_plan: { key: "account_plan", en: "Account follow-up plan agreed (next packages, collections support)", ar: "خطة متابعة الحساب متفق عليها (الحزم القادمة ودعم التحصيل)" },
  loss_reason: { key: "loss_reason", en: "Loss reason recorded", ar: "سبب الخسارة مسجل", auto: (f) => !!(f.loss_reason ?? "").trim() },
  loss_analysis: { key: "loss_analysis", en: "Win/loss analysis recorded: client's words vs our estimate", ar: "تحليل الخسارة مسجل: إفادة العميل مقابل تقديرنا" },
} satisfies Record<string, ChecklistItem>;

const I = ITEMS;

export const STAGE_CHECKLIST: Readonly<Record<CanonicalStage, readonly ChecklistItem[]>> = {
  rfq_received: [I.buyer_type, I.decision_maker, I.procurement, I.tender_file, I.scope_review, I.scope_boundaries, I.site_visit],
  jih: [I.boq_priced, I.quotation, I.prequalified, I.why_phc],
  jih_bafo: [I.evaluation_status, I.clarifications],
  under_negotiation: [I.changes_approved, I.revised_quote],
  verbally_awarded: [I.expected_contract, I.po_matched],
  contract_received: [I.contract_value, I.handover_meeting],
  contract_signed: [I.contract_value, I.handover_meeting],
  won: [I.handover_file, I.account_plan],
  lost: [I.loss_reason, I.loss_analysis],
  on_hold: [],
};

export const CHECKLIST_ITEM_KEYS: readonly string[] = Object.keys(ITEMS);

export type ChecklistResult = {
  key: string;
  en: string;
  ar: string;
  kind: "auto" | "manual";
  done: boolean;
};

/** The current stage's items with their state. Unknown or no stage → nothing to show. */
export function evaluateChecklist(stage: string | null | undefined, facts: ChecklistFacts): ChecklistResult[] {
  const items = stage && stage in STAGE_CHECKLIST ? STAGE_CHECKLIST[stage as CanonicalStage] : [];
  return items.map((it) => ({
    key: it.key,
    en: it.en,
    ar: it.ar,
    kind: it.auto ? "auto" : "manual",
    done: it.auto ? it.auto(facts) : facts.manual[it.key] === true,
  }));
}

export const EMPTY_FACTS: ChecklistFacts = {
  buyer_type: null, roles: [], prequalification_status: null, boq_item_count: 0, quotation_count: 0,
  expected_contract_date: null, contract_value: null, loss_reason: null, manual: {},
};
