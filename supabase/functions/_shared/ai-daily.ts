import { resolveCanonicalStage } from "./stage-canonical.ts";
import { EMPTY_FACTS, evaluateChecklist } from "./stage-checklist.ts";

type Base = { id: string; updated_at: string };
export type DailyOpportunity = Base & {
  project_name: string;
  stage: string | null;
  sales_stage: string | null;
  next_action: string | null;
  next_action_due: string | null;
  buyer_type?: string | null;
  company_id?: string | null;
  expected_contract_date?: string | null;
  contract_value?: number | null;
  loss_reason?: string | null;
};
/** Stage-checklist facts the handler loads per deal (stage-checklist.ts). */
export type DailyChecklistFacts = {
  stakeholders: { opportunity_id: string; role_code: string | null }[];
  quotations: { related_opportunity_id: string | null }[];
  companies: { id: string; prequalification_status: string | null }[];
  checklistRows: { opportunity_id: string; item_key: string; done: boolean }[];
};
export type DailyFollowup = Base & {
  opportunity_id: string | null;
  due_date: string | null;
  notes: string | null;
  channel: string | null;
};
export type DailyRfq = Base & {
  rfq_number: string;
  opportunity_id: string | null;
  response_due_date: string | null;
  company_id: string | null;
  contact_id: string | null;
  document_url: string | null;
  document_storage_path: string | null;
  estimated_signage_value: number | null;
};
export type DailyBoq = Base & {
  title: string;
  related_opportunity_id: string;
  missing_items: string | null;
  assumptions: string | null;
};
export type DailyBoqItem = {
  id: string;
  boq_id: string;
  sign_type: string;
  quantity: number | null;
  material: string | null;
  unit_rate?: number | null;
};
export type DailySuggestion = {
  source_type: "opportunity" | "follow_up" | "rfq" | "boq" | "checklist";
  source_id: string;
  source_updated_at: string;
  opportunity_id: string | null;
  title: string;
  proposed_task: string;
  due: string | null;
  priority: number;
  reasons: string[];
  gaps: string[];
};
export function buildDailyAssistant(
  input: {
    opportunities: DailyOpportunity[];
    followups: DailyFollowup[];
    rfqs: DailyRfq[];
    boqs: DailyBoq[];
    boqItems: DailyBoqItem[];
    checklist?: DailyChecklistFacts;
  },
  language: "ar" | "en",
  today: string,
) {
  const say = (ar: string, en: string) => (language === "ar" ? ar : en);
  const suggestions: DailySuggestion[] = [];
  const live = input.opportunities.filter((o) => {
    const stage = resolveCanonicalStage(o).stage;
    return stage && !["won", "lost"].includes(stage);
  });
  const names = new Map(live.map((o) => [o.id, o.project_name]));
  const dueRank = (due: string | null) => (!due ? 30 : due < today ? 100 : due === today ? 90 : 50);
  const dueReason = (due: string | null) =>
    !due
      ? say("موعد غير مسجل", "No due date recorded")
      : due < today
        ? say("متأخر عن موعده", "Overdue")
        : due === today
          ? say("مستحق اليوم", "Due today")
          : say("متابعة قادمة", "Upcoming follow-up");
  for (const f of input.followups) {
    if (f.opportunity_id && !names.has(f.opportunity_id)) continue;
    const name = names.get(f.opportunity_id ?? "") || say("متابعة", "Follow-up");
    suggestions.push({
      source_type: "follow_up",
      source_id: f.id,
      source_updated_at: f.updated_at,
      opportunity_id: f.opportunity_id,
      title: name,
      proposed_task: say(
        `متابعة ${name} وتسجيل النتيجة`,
        `Follow up on ${name} and record the outcome`,
      ),
      due: f.due_date,
      priority: dueRank(f.due_date),
      reasons: [dueReason(f.due_date)],
      gaps: !f.notes?.trim()
        ? [say("هدف المتابعة غير موثق", "Follow-up objective is missing")]
        : [],
    });
  }
  for (const o of live) {
    if (o.next_action?.trim()) continue;
    suggestions.push({
      source_type: "opportunity",
      source_id: o.id,
      source_updated_at: o.updated_at,
      opportunity_id: o.id,
      title: o.project_name,
      proposed_task: say(
        `تحديد الخطوة التالية لفرصة ${o.project_name}`,
        `Set the next action for ${o.project_name}`,
      ),
      due: o.next_action_due,
      priority: 40,
      reasons: [say("الفرصة مفتوحة بلا خطوة تالية", "Open opportunity has no next action")],
      gaps: [say("الخطوة التالية والمسؤول والموعد", "Next action, owner and due date")],
    });
  }
  for (const r of input.rfqs) {
    const gaps = [];
    if (!r.company_id) gaps.push(say("الشركة", "Company"));
    if (!r.contact_id) gaps.push(say("جهة التواصل", "Contact"));
    if (!r.response_due_date) gaps.push(say("موعد الرد", "Response deadline"));
    if (!r.document_url && !r.document_storage_path) gaps.push(say("وثيقة RFQ", "RFQ document"));
    if (r.estimated_signage_value == null)
      gaps.push(say("القيمة التقديرية للافتات", "Estimated signage value"));
    if (!gaps.length) continue;
    suggestions.push({
      source_type: "rfq",
      source_id: r.id,
      source_updated_at: r.updated_at,
      opportunity_id: r.opportunity_id,
      title: r.rfq_number,
      proposed_task: say(
        `استكمال نواقص ${r.rfq_number}`,
        `Complete missing RFQ information for ${r.rfq_number}`,
      ),
      due: r.response_due_date,
      priority: Math.max(65, dueRank(r.response_due_date)),
      reasons: [
        say(
          "معلومات لازمة لتجهيز الرد ناقصة",
          "Information needed to prepare a response is missing",
        ),
      ],
      gaps,
    });
  }
  for (const b of input.boqs) {
    const items = input.boqItems.filter((i) => i.boq_id === b.id),
      gaps = [];
    if (!items.length) gaps.push(say("لا توجد بنود مسجلة", "No BOQ items recorded"));
    const incomplete = items.filter(
      (i) =>
        !i.sign_type?.trim() ||
        i.quantity == null ||
        i.quantity <= 0 ||
        !i.material?.trim() ||
        i.unit_rate === null,
    );
    if (incomplete.length)
      gaps.push(
        say(
          `${incomplete.length} بنود تحتاج مراجعة النوع أو الكمية أو المادة أو سعر الوحدة`,
          `${incomplete.length} items need sign type, quantity, material or unit-rate review`,
        ),
      );
    if (b.missing_items?.trim()) gaps.push(b.missing_items);
    if (!gaps.length) continue;
    suggestions.push({
      source_type: "boq",
      source_id: b.id,
      source_updated_at: b.updated_at,
      opportunity_id: b.related_opportunity_id,
      title: b.title,
      proposed_task: say(
        `مراجعة واستكمال جدول الكميات: ${b.title}`,
        `Review and complete BOQ: ${b.title}`,
      ),
      due: null,
      priority: 60,
      reasons: [say("فحص اكتمال البيانات قبل التسعير", "Data completeness check before pricing")],
      gaps,
    });
  }
  // Stage checklist: the missing "evidence of done" of each open deal's current
  // stage, as one proposed task per deal (playbook phase 2, 2026-10-07).
  if (input.checklist) {
    const c = input.checklist;
    const prequal = new Map(c.companies.map((x) => [x.id, x.prequalification_status]));
    for (const o of input.opportunities) {
      const stage = resolveCanonicalStage(o).stage;
      if (!stage || stage === "won" || stage === "lost" || stage === "on_hold") continue;
      const boqIds = input.boqs.filter((b) => b.related_opportunity_id === o.id).map((b) => b.id);
      const items = evaluateChecklist(stage, {
        ...EMPTY_FACTS,
        buyer_type: o.buyer_type ?? null,
        roles: c.stakeholders.filter((s) => s.opportunity_id === o.id).map((s) => s.role_code ?? "").filter(Boolean),
        prequalification_status: o.company_id ? prequal.get(o.company_id) ?? null : null,
        boq_item_count: input.boqItems.filter((i) => boqIds.includes(i.boq_id)).length,
        quotation_count: c.quotations.filter((q) => q.related_opportunity_id === o.id).length,
        expected_contract_date: o.expected_contract_date ?? null,
        contract_value: o.contract_value ?? null,
        loss_reason: o.loss_reason ?? null,
        manual: Object.fromEntries(c.checklistRows.filter((r) => r.opportunity_id === o.id).map((r) => [r.item_key, r.done])),
      });
      const missing = items.filter((i) => !i.done);
      if (!missing.length) continue;
      suggestions.push({
        source_type: "checklist",
        source_id: o.id,
        source_updated_at: o.updated_at,
        opportunity_id: o.id,
        title: o.project_name,
        proposed_task: say(
          `استكمال دليل مرحلة «${stage}» لـ ${o.project_name}: ${missing.map((m) => m.ar).join("؛ ")}`,
          `Complete the ${stage} stage evidence for ${o.project_name}: ${missing.map((m) => m.en).join("; ")}`,
        ),
        due: null,
        priority: 55,
        reasons: [say(`${missing.length} بنود ناقصة في دليل المرحلة الحالية`, `${missing.length} items missing in the current stage's evidence`)],
        gaps: missing.map((m) => (language === "ar" ? m.ar : m.en)),
      });
    }
  }
  suggestions.sort(
    (a, b) =>
      b.priority - a.priority ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      a.source_id.localeCompare(b.source_id),
  );
  return {
    as_of: new Date().toISOString(),
    today,
    language,
    total_suggestions: suggestions.length,
    scope: say(
      "سجلاتك المسموح بها؛ ترتيب إجرائي حسب الموعد والنواقص، وليس احتمال فوز محسوبًا بالذكاء الاصطناعي.",
      "Your permitted records; procedural ranking by due date and gaps, not an AI win probability.",
    ),
    suggestions: suggestions.slice(0, 30),
  };
}
