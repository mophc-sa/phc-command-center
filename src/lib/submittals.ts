// =============================================================================
// Samples and drawings sent to the client (manager feedback group 5, 2026-10-19).
//
// "Sample tracking per project: sales request → approval → manufacturing by
// Ammar → received → sent to client → client response (Code B / Code C /
// rejected / approved with comments)", and "drawings: the designer sends →
// sales sends to the client → approved, or comments returned; revisions kept."
//
// Both are one model: an item (deal_submittals) and an append-only log of its
// steps (deal_submittal_steps). The database enforces the order below in
// submittal_next_steps() (20261026100000); NEXT_STEPS mirrors it so the screen
// only offers what will be accepted, and submittals.test.ts fails if they drift.
// =============================================================================

type Lang = "en" | "ar";
type Label = { en: string; ar: string };

export const SUBMITTAL_KINDS = ["sample", "drawing"] as const;
export type SubmittalKind = (typeof SUBMITTAL_KINDS)[number];

export const SUBMITTAL_STEPS = [
  "requested",
  "approved",
  "declined",
  "in_production",
  "received",
  "designer_sent",
  "sent_to_client",
  "client_response",
  "cancelled",
] as const;
export type SubmittalStep = (typeof SUBMITTAL_STEPS)[number];

export const CLIENT_RESPONSES = ["approved", "approved_with_comments", "revise_resubmit", "rejected"] as const;
export type ClientResponse = (typeof CLIENT_RESPONSES)[number];

/** Keyed by `${kind}:${current step or ""}`, exactly as the SQL CASE is. */
export const NEXT_STEPS: Record<string, readonly SubmittalStep[]> = {
  "sample:": ["requested"],
  "sample:requested": ["approved", "declined", "cancelled"],
  "sample:approved": ["in_production", "cancelled"],
  "sample:in_production": ["received", "cancelled"],
  "sample:received": ["sent_to_client", "cancelled"],
  "sample:sent_to_client": ["client_response", "cancelled"],
  "sample:client_response": ["requested"],
  "sample:declined": ["requested"],
  "drawing:": ["designer_sent"],
  "drawing:designer_sent": ["sent_to_client", "cancelled"],
  "drawing:sent_to_client": ["client_response", "cancelled"],
  "drawing:client_response": ["designer_sent"],
};

export function nextSteps(kind: SubmittalKind, current: string | null): readonly SubmittalStep[] {
  return NEXT_STEPS[`${kind}:${current ?? ""}`] ?? [];
}

export function firstStep(kind: SubmittalKind): SubmittalStep {
  return kind === "sample" ? "requested" : "designer_sent";
}

/** Only commercial managers record these (is_commercial_manager in the database). */
export function isManagerStep(step: SubmittalStep): boolean {
  return step === "approved" || step === "declined";
}

export function isSubmittalKind(v: unknown): v is SubmittalKind {
  return typeof v === "string" && (SUBMITTAL_KINDS as readonly string[]).includes(v);
}
export function isSubmittalStep(v: unknown): v is SubmittalStep {
  return typeof v === "string" && (SUBMITTAL_STEPS as readonly string[]).includes(v);
}
export function isClientResponse(v: unknown): v is ClientResponse {
  return typeof v === "string" && (CLIENT_RESPONSES as readonly string[]).includes(v);
}

const KIND_LABEL: Record<SubmittalKind, Label> = {
  sample: { en: "Sample", ar: "عينة" },
  drawing: { en: "Drawing", ar: "مخطط" },
};

const STEP_LABEL: Record<SubmittalStep, Label> = {
  requested: { en: "Requested by sales", ar: "طلب من المبيعات" },
  approved: { en: "Approved by manager", ar: "اعتمدها المدير" },
  declined: { en: "Declined by manager", ar: "رفضها المدير" },
  in_production: { en: "In production", ar: "قيد التصنيع" },
  received: { en: "Received from production", ar: "استُلمت من الإنتاج" },
  designer_sent: { en: "Sent by designer", ar: "أرسله المصمم" },
  sent_to_client: { en: "Sent to client", ar: "أُرسلت للعميل" },
  client_response: { en: "Client responded", ar: "رد العميل" },
  cancelled: { en: "Cancelled", ar: "أُلغيت" },
};

/** What the button says when this is the next thing to record. */
const STEP_ACTION: Record<SubmittalStep, Label> = {
  requested: { en: "Request sample", ar: "طلب عينة" },
  approved: { en: "Approve", ar: "اعتماد" },
  declined: { en: "Decline", ar: "رفض" },
  in_production: { en: "Production started", ar: "بدأ التصنيع" },
  received: { en: "Received from production", ar: "تم الاستلام من الإنتاج" },
  designer_sent: { en: "Designer sent drawing", ar: "أرسل المصمم المخطط" },
  sent_to_client: { en: "Sent to client", ar: "أُرسل للعميل" },
  client_response: { en: "Record client response", ar: "تسجيل رد العميل" },
  cancelled: { en: "Cancel", ar: "إلغاء" },
};

const RESPONSE_LABEL: Record<ClientResponse, Label> = {
  approved: { en: "Approved (Code A)", ar: "معتمد (Code A)" },
  approved_with_comments: { en: "Approved with comments (Code B)", ar: "معتمد مع ملاحظات (Code B)" },
  revise_resubmit: { en: "Revise and resubmit (Code C)", ar: "يُعدَّل ويُعاد تقديمه (Code C)" },
  rejected: { en: "Rejected", ar: "مرفوض" },
};

export const kindLabel = (k: string, lang: Lang) => (isSubmittalKind(k) ? KIND_LABEL[k][lang] : k);
export const stepLabel = (s: string | null, lang: Lang) =>
  s === null ? (lang === "ar" ? "لم تبدأ" : "Not started") : isSubmittalStep(s) ? STEP_LABEL[s][lang] : s;
export const stepActionLabel = (s: SubmittalStep, kind: SubmittalKind, lang: Lang) =>
  s === "requested" && kind === "sample" ? STEP_ACTION.requested[lang] : STEP_ACTION[s][lang];
export const responseLabel = (r: string | null, lang: Lang) =>
  r && isClientResponse(r) ? RESPONSE_LABEL[r][lang] : "";

/** Drawings are counted from Rev 0, as on the title block; samples from round 1. */
export function revisionLabel(kind: string, revision: number, lang: Lang): string {
  if (kind === "drawing") return lang === "ar" ? `مراجعة ${revision}` : `Rev ${revision}`;
  return lang === "ar" ? `الجولة ${revision + 1}` : `Round ${revision + 1}`;
}

/** Where an item stands, for the list filters and the pill's tone. */
export type SubmittalStage = "awaiting_approval" | "in_production" | "with_client" | "done" | "needs_action" | "cancelled";

export function submittalStage(kind: string, step: string | null, response: string | null): SubmittalStage {
  switch (step) {
    case "requested":
      return "awaiting_approval";
    case "approved":
    case "in_production":
    case "received":
      return "in_production";
    case "designer_sent":
    case "sent_to_client":
      return "with_client";
    case "client_response":
      return response === "approved" || response === "approved_with_comments" ? "done" : "needs_action";
    case "declined":
      return "needs_action";
    case "cancelled":
      return "cancelled";
    default:
      return kind === "drawing" ? "with_client" : "needs_action";
  }
}

const STAGE_LABEL: Record<SubmittalStage, Label> = {
  awaiting_approval: { en: "Awaiting approval", ar: "بانتظار الاعتماد" },
  in_production: { en: "In production", ar: "في الإنتاج" },
  with_client: { en: "With the client", ar: "لدى العميل" },
  done: { en: "Approved by client", ar: "اعتمدها العميل" },
  needs_action: { en: "Needs a new round", ar: "تحتاج جولة جديدة" },
  cancelled: { en: "Cancelled", ar: "ملغاة" },
};
export const stageLabel = (s: SubmittalStage, lang: Lang) => STAGE_LABEL[s][lang];

export const STAGE_TONE: Record<SubmittalStage, "positive" | "attention" | "neutral" | "muted" | "danger"> = {
  awaiting_approval: "attention",
  in_production: "neutral",
  with_client: "neutral",
  done: "positive",
  needs_action: "danger",
  cancelled: "muted",
};
