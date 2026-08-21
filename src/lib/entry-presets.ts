// =============================================================================
// PHC Sales OS — structured data entry (Phase 5).
//
// Structured first, free text second. A value gets a structured field when it
// is repeated, will be filtered on, will feed a KPI, or will drive governance —
// because those are the things that break when the value arrives as prose. When
// the content is genuinely open ("what the consultant said"), free text is the
// honest representation and a dropdown would just force people to lie.
//
// Every list here keeps an `other` escape with a notes field, so the taxonomy
// never blocks recording something real that it failed to anticipate.
//
// Bilingual by construction: an option carries both labels, so the Arabic UI is
// not a translation layer bolted on afterwards.
//
// Pure data + pure helpers. See entry-presets.test.ts.
// =============================================================================

export type PresetOption = {
  value: string;
  en: string;
  ar: string;
  /** When true, the UI must collect a note — the value alone says nothing. */
  requiresNote?: boolean;
};

export function label(o: PresetOption, lang: "en" | "ar"): string {
  return lang === "ar" ? o.ar : o.en;
}

export function findOption(list: PresetOption[], value: string): PresetOption | undefined {
  return list.find((o) => o.value === value);
}

/** True when choosing this value obliges the form to collect a note. */
export function requiresNote(list: PresetOption[], value: string): boolean {
  return findOption(list, value)?.requiresNote === true;
}

// ---- Intake checklists (PRD §26) -------------------------------------------
// These mirror the columns Phase 2 already added to inbox_items (has_boq,
// has_drawings, has_specs). The extra items are captured as a list rather than
// three more booleans, so adding a document type later is data, not a migration.

export const DOCUMENTS_RECEIVED: PresetOption[] = [
  { value: "boq", en: "BOQ", ar: "جدول الكميات" },
  { value: "drawings", en: "Drawings", ar: "المخططات" },
  { value: "specifications", en: "Specifications", ar: "المواصفات" },
  { value: "rfq_invitation", en: "RFQ / Invitation", ar: "طلب عرض سعر / دعوة" },
  { value: "scope_of_work", en: "Scope of Work", ar: "نطاق العمل" },
  { value: "client_reference", en: "Client Reference", ar: "مرجع العميل" },
  { value: "other", en: "Other", ar: "أخرى", requiresNote: true },
];

/**
 * The three that map to real columns. Anything else is stored in the list only,
 * so the checkbox UI and the Phase 2 schema cannot fall out of step.
 */
export const DOCUMENT_COLUMN_MAP: Record<string, "has_boq" | "has_drawings" | "has_specs"> = {
  boq: "has_boq",
  drawings: "has_drawings",
  specifications: "has_specs",
};

export function documentsToColumns(selected: string[]): {
  has_boq: boolean;
  has_drawings: boolean;
  has_specs: boolean;
} {
  return {
    has_boq: selected.includes("boq"),
    has_drawings: selected.includes("drawings"),
    has_specs: selected.includes("specifications"),
  };
}

/** Mirrors INTAKE_REQUEST_TYPES in inbox-actions.ts — kept as options for the UI. */
export const REQUEST_TYPES: PresetOption[] = [
  { value: "jih", en: "JIH", ar: "JIH" },
  { value: "tender_contractor", en: "Contractor Tender", ar: "مناقصة مقاول" },
  { value: "tender_government", en: "Government Tender", ar: "مناقصة حكومية" },
  { value: "unknown", en: "Unknown", ar: "غير محدد" },
];

export const MISSING_INFORMATION: PresetOption[] = [
  { value: "boq", en: "BOQ", ar: "جدول الكميات" },
  { value: "drawings", en: "Drawings", ar: "المخططات" },
  { value: "specifications", en: "Specifications", ar: "المواصفات" },
  { value: "deadline", en: "Deadline", ar: "الموعد النهائي" },
  { value: "client_contact", en: "Client Contact", ar: "جهة اتصال العميل" },
  { value: "scope_clarification", en: "Scope Clarification", ar: "توضيح النطاق" },
  { value: "commercial_information", en: "Commercial Information", ar: "معلومات تجارية" },
  { value: "other", en: "Other", ar: "أخرى", requiresNote: true },
];

export const INTAKE_PRIORITY: PresetOption[] = [
  { value: "normal", en: "Normal", ar: "عادي" },
  { value: "high", en: "High", ar: "مرتفع" },
  { value: "urgent", en: "Urgent", ar: "عاجل" },
];

// ---- Lost reasons (PRD §28) -------------------------------------------------
// These feed lostByReason() in sales-kpis, so they must be a closed set —
// free-text reasons cannot be grouped, and a loss analysis built on prose is
// just a list of sentences.

export const LOST_REASONS: PresetOption[] = [
  { value: "price", en: "Price", ar: "السعر" },
  { value: "competitor", en: "Competitor", ar: "منافس", requiresNote: true },
  { value: "client_cancelled", en: "Client Cancelled", ar: "إلغاء من العميل" },
  { value: "scope_changed", en: "Scope Changed", ar: "تغيّر النطاق" },
  { value: "budget_unavailable", en: "Budget Unavailable", ar: "عدم توفر الميزانية" },
  { value: "no_response", en: "No Response", ar: "لا يوجد رد" },
  { value: "technical_non_compliance", en: "Technical Non-compliance", ar: "عدم مطابقة فنية" },
  { value: "timing_delivery", en: "Timing / Delivery", ar: "التوقيت / التسليم" },
  { value: "internal_decision", en: "Internal Decision", ar: "قرار داخلي" },
  { value: "other", en: "Other", ar: "أخرى", requiresNote: true },
];

// ---- On hold (PRD §29) ------------------------------------------------------

export const ON_HOLD_REASONS: PresetOption[] = [
  { value: "waiting_client", en: "Waiting Client", ar: "بانتظار العميل" },
  { value: "budget", en: "Budget", ar: "الميزانية" },
  { value: "design_pending", en: "Design Pending", ar: "التصميم قيد الإعداد" },
  { value: "consultant_approval", en: "Consultant Approval", ar: "اعتماد الاستشاري" },
  { value: "scope_clarification", en: "Scope Clarification", ar: "توضيح النطاق" },
  { value: "internal_decision", en: "Internal Decision", ar: "قرار داخلي" },
  { value: "tender_delay", en: "Tender Delay", ar: "تأخر المناقصة" },
  { value: "other", en: "Other", ar: "أخرى", requiresNote: true },
];

// ---- Opportunity update presets (PRD §27) -----------------------------------

/**
 * A quick update prefills the note and suggests a next action. It never writes
 * a business fact on its own: `suggestedStage` is a *suggestion* the form shows,
 * and the stage still moves through advanceSalesStage with all its gates. A
 * preset that silently advanced a stage would route around Phase 3 governance.
 */
export type UpdatePreset = {
  value: string;
  en: string;
  ar: string;
  noteEn: string;
  noteAr: string;
  nextActionEn: string | null;
  nextActionAr: string | null;
  /** Purely advisory — shown to the user, never applied automatically. */
  suggestedStage?: string;
  /** Records contact happened, so the follow-up cadence can be updated. */
  logsContact?: boolean;
};

export const UPDATE_PRESETS: UpdatePreset[] = [
  {
    value: "client_contacted", en: "Client contacted", ar: "تم التواصل مع العميل",
    noteEn: "Contacted the client.", noteAr: "تم التواصل مع العميل.",
    nextActionEn: "Await client response", nextActionAr: "انتظار رد العميل", logsContact: true,
  },
  {
    value: "follow_up_sent", en: "Follow-up sent", ar: "تم إرسال متابعة",
    noteEn: "Follow-up sent to the client.", noteAr: "تم إرسال متابعة للعميل.",
    nextActionEn: "Await client response", nextActionAr: "انتظار رد العميل", logsContact: true,
  },
  {
    value: "meeting_completed", en: "Meeting completed", ar: "تم عقد الاجتماع",
    noteEn: "Meeting completed with the client.", noteAr: "تم عقد اجتماع مع العميل.",
    nextActionEn: "Send meeting summary", nextActionAr: "إرسال ملخص الاجتماع", logsContact: true,
  },
  {
    value: "waiting_client_response", en: "Waiting client response", ar: "بانتظار رد العميل",
    noteEn: "Waiting on the client to respond.", noteAr: "بانتظار رد من العميل.",
    nextActionEn: "Follow up if no reply", nextActionAr: "متابعة في حال عدم الرد",
  },
  {
    value: "boq_received", en: "BOQ received", ar: "تم استلام جدول الكميات",
    noteEn: "BOQ received from the client.", noteAr: "تم استلام جدول الكميات من العميل.",
    nextActionEn: "Register the BOQ and start pricing", nextActionAr: "تسجيل جدول الكميات وبدء التسعير",
  },
  {
    value: "drawings_received", en: "Drawings received", ar: "تم استلام المخططات",
    noteEn: "Drawings received.", noteAr: "تم استلام المخططات.",
    nextActionEn: "Review the drawings", nextActionAr: "مراجعة المخططات",
  },
  {
    value: "specs_received", en: "Specifications received", ar: "تم استلام المواصفات",
    noteEn: "Specifications received.", noteAr: "تم استلام المواصفات.",
    nextActionEn: "Review the specifications", nextActionAr: "مراجعة المواصفات",
  },
  {
    value: "pricing_requested", en: "Pricing requested", ar: "تم طلب التسعير",
    noteEn: "Pricing requested from Commercial.", noteAr: "تم طلب التسعير من القسم التجاري.",
    nextActionEn: "Await pricing", nextActionAr: "انتظار التسعير",
  },
  {
    value: "bafo_requested", en: "BAFO requested", ar: "تم طلب أفضل عرض نهائي",
    noteEn: "BAFO requested by the client.", noteAr: "طلب العميل أفضل عرض نهائي.",
    nextActionEn: "Raise a BAFO approval request", nextActionAr: "رفع طلب اعتماد BAFO",
    suggestedStage: "jih_bafo",
  },
  {
    value: "verbal_award_received", en: "Verbal award received", ar: "تم استلام ترسية شفهية",
    noteEn: "Client confirmed a verbal award.", noteAr: "أكد العميل الترسية شفهياً.",
    nextActionEn: "Record the evidence and chase the contract", nextActionAr: "تسجيل الإثبات ومتابعة العقد",
    suggestedStage: "verbally_awarded",
  },
  {
    value: "contract_expected", en: "Contract expected", ar: "العقد متوقع",
    noteEn: "Client indicated the contract is on its way.", noteAr: "أفاد العميل بأن العقد في طريقه.",
    nextActionEn: "Chase the contract document", nextActionAr: "متابعة وثيقة العقد",
  },
  {
    value: "on_hold", en: "On hold", ar: "معلّق",
    noteEn: "Placed on hold.", noteAr: "تم تعليق الفرصة.",
    nextActionEn: "Set a review date", nextActionAr: "تحديد تاريخ للمراجعة",
    suggestedStage: "on_hold",
  },
  {
    value: "no_response", en: "No response", ar: "لا يوجد رد",
    noteEn: "No response from the client.", noteAr: "لا يوجد رد من العميل.",
    nextActionEn: "Escalate or reschedule the follow-up", nextActionAr: "تصعيد أو إعادة جدولة المتابعة",
  },
];

export type PresetFill = {
  note: string;
  nextAction: string | null;
  suggestedStage: string | null;
  logsContact: boolean;
};

/**
 * What a preset puts in the form. The user reviews and can edit every field
 * before saving — this prefills, it does not submit.
 */
export function applyUpdatePreset(value: string, lang: "en" | "ar"): PresetFill | null {
  const p = UPDATE_PRESETS.find((x) => x.value === value);
  if (!p) return null;
  return {
    note: lang === "ar" ? p.noteAr : p.noteEn,
    nextAction: lang === "ar" ? p.nextActionAr : p.nextActionEn,
    suggestedStage: p.suggestedStage ?? null,
    logsContact: p.logsContact === true,
  };
}

// ---- Validation -------------------------------------------------------------

export type PresetValidation = { ok: true } | { ok: false; error: string; errorAr: string };

/**
 * A selection is complete when anything requiring a note has one. Enforced here
 * rather than per-form so every caller applies the same rule — "Other" with no
 * explanation is the single most common way a structured field decays into
 * noise.
 */
export function validateSelection(
  list: PresetOption[],
  value: string | null,
  note: string | null | undefined,
): PresetValidation {
  if (!value) {
    return { ok: false, error: "Please choose an option.", errorAr: "الرجاء اختيار أحد الخيارات." };
  }
  const opt = findOption(list, value);
  if (!opt) {
    return { ok: false, error: "That option is not recognised.", errorAr: "الخيار غير معروف." };
  }
  if (opt.requiresNote && (!note || note.trim() === "")) {
    return {
      ok: false,
      error: `“${opt.en}” needs a short explanation.`,
      errorAr: `«${opt.ar}» يحتاج إلى توضيح مختصر.`,
    };
  }
  return { ok: true };
}

/** Multi-select variant, for the checklists. */
export function validateMultiSelection(
  list: PresetOption[],
  values: string[],
  note: string | null | undefined,
): PresetValidation {
  for (const v of values) {
    if (requiresNote(list, v)) return validateSelection(list, v, note);
  }
  const unknown = values.filter((v) => !findOption(list, v));
  if (unknown.length > 0) {
    return { ok: false, error: "That option is not recognised.", errorAr: "الخيار غير معروف." };
  }
  return { ok: true };
}
