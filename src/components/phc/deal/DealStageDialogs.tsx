// Images 22 and 24 (Omar's CRM review): Update stage, Set contractor hold,
// Close as lost / cancelled and Reopen. Every move records a reason and the
// next action with its follow-up date, so no deal leaves a stage without one.
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { fieldsForStage } from "@/components/phc/pipeline/RfqJihPanel";
import { advanceSalesStage, nextSalesStages, type SalesStage } from "@/lib/workflow-actions";
import { scheduleFollowUp } from "@/lib/opportunity-actions";
import { updateOpportunityFigures } from "@/lib/opportunity-collab-actions";
import { LOST_REASONS, ON_HOLD_REASONS, label as presetLabel } from "@/lib/entry-presets";
import { riyadhDay } from "@/lib/riyadh-day";
import type { Lang } from "@/lib/i18n";

type Kind = "hold" | "lost" | "reopen";
// The column the effective date lands in, where the stage has one.
const DATE_FIELD: Partial<Record<SalesStage, string>> = {
  verbally_awarded: "verbal_award_date",
  contract_received: "contract_received_date",
  contract_signed: "contract_signed_date",
};

export function DealStageDialogs({ o, lang, t, moveTo, setMoveTo, stageChoices, closeKind, setCloseKind, onDone }: {
  o: any; lang: Lang; t: (k: never) => string;
  moveTo: SalesStage | null; setMoveTo: (s: SalesStage | null) => void; stageChoices: SalesStage[];
  closeKind: Kind | null; setCloseKind: (k: Kind | null) => void;
  onDone: () => void;
}) {
  const ar = lang === "ar";
  const tt = (k: string) => t(k as never);
  const stageLabel = (s: string) => tt(`sstage_${s}`);
  const today = riyadhDay();
  const next: DialogField[] = [
    { key: "next_action", type: "text", label: ar ? "الإجراء التالي" : "Next action", required: true, defaultValue: o.next_action ?? "" },
    // An old next-action date is not offered: a follow-up starts today or later.
    { key: "follow_up", type: "date", label: ar ? "موعد المتابعة" : "Follow-up", required: true, defaultValue: o.next_action_due && o.next_action_due >= today ? o.next_action_due : "" },
  ];
  // Stage fields are keyed per stage so two stages' "notes" never collide.
  const perStage = (stages: SalesStage[]): DialogField[] =>
    stages.flatMap((s) =>
      fieldsForStage(s, tt, lang)
        .filter((f) => f.key !== "notes")
        .map((f) => ({ ...f, key: `${s}__${f.key}`, showWhen: { field: "to_stage", equals: s } }) as DialogField),
    );
  const pick = (v: Record<string, string>, s: string) =>
    Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith(`${s}__`)).map(([k, x]) => [k.slice(s.length + 2), x]));

  async function run(toStage: SalesStage, v: Record<string, string>, fields: Record<string, unknown>, notes: string | undefined) {
    const { evidence, ...rest } = fields as Record<string, string>;
    // Checked before the stage moves, so a bad date never leaves half a save.
    if (v.follow_up && v.follow_up < today) {
      toast.error(ar ? "موعد المتابعة لا يكون في الماضي" : "The follow-up date cannot be in the past");
      throw new Error("follow_up_in_past");
    }
    try {
      const res: any = await advanceSalesStage({
        opportunityId: o.id, toStage, notes, evidence,
        fields: { ...rest, contract_value: rest.contract_value ? Number(String(rest.contract_value).replace(/[,\s]/g, "")) : undefined },
      });
      if (v.next_action || v.follow_up) {
        await updateOpportunityFigures({ opportunityId: o.id, nextAction: v.next_action || null, nextActionDue: v.follow_up || null });
        if (v.follow_up) await scheduleFollowUp({ opportunityId: o.id, dueDate: v.follow_up, notes: v.next_action || undefined, ownerId: o.owner_id ?? undefined });
      }
      toast.success(res?.pending_approval ? tt("wf_pending_approval") : tt("crm_saved"));
      onDone();
    } catch (e) {
      toast.error(tt("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
      throw e;
    }
  }

  const reopenTo = nextSalesStages("lost");
  return (
    <>
      <ActionDialog
        recordId={moveTo ? o.id : undefined}
        open={!!moveTo}
        onOpenChange={(v) => !v && setMoveTo(null)}
        title={ar ? "تحديث المرحلة" : "Update stage"}
        description={ar ? "المرحلة «موقّع» تتطلب مستند ترسية معتمدًا." : "Signed requires an approved award document."}
        submitLabel={ar ? "حفظ المرحلة" : "Save stage"}
        fields={[
          { key: "to_stage", type: "select", label: ar ? "المرحلة الجديدة" : "New stage", required: true, defaultValue: moveTo ?? undefined, options: stageChoices.map((s) => ({ value: s, label: stageLabel(s) })) },
          { key: "effective", type: "date", label: ar ? "تاريخ السريان" : "Effective date", required: true, defaultValue: today },
          { key: "reason", type: "textarea", label: ar ? "السبب" : "Reason", required: true },
          ...perStage(stageChoices),
          ...next,
        ]}
        onSubmit={async (v) => {
          const s = v.to_stage as SalesStage;
          const f: Record<string, unknown> = pick(v, s);
          if (DATE_FIELD[s]) f[DATE_FIELD[s]!] = v.effective;
          const notes = `${v.reason}${DATE_FIELD[s] ? "" : ` (${ar ? "سريان" : "effective"} ${v.effective})`}`;
          await run(s, v, f, notes);
        }}
      />
      <ActionDialog
        recordId={closeKind === "hold" ? o.id : undefined}
        open={closeKind === "hold"}
        onOpenChange={(v) => !v && setCloseKind(null)}
        title={ar ? "تعليق من المقاول" : "Set contractor hold"}
        description={ar ? "تبقى المرحلة الحالية محفوظة وتعود إليها عند الاستئناف." : "The current stage is kept and offered first when the deal resumes."}
        submitLabel={ar ? "تعليق" : "Set hold"}
        fields={[
          { key: "hold_reason", type: "select", label: ar ? "السبب" : "Reason", required: true, defaultValue: "contractor_hold", options: ON_HOLD_REASONS.map((r) => ({ value: r.value, label: presetLabel(r, lang) })) },
          { key: "hold_review_date", type: "date", label: ar ? "تاريخ المراجعة" : "Review date", required: true },
          { key: "hold_notes", type: "textarea", label: ar ? "ملاحظات" : "Notes" },
        ]}
        onSubmit={async (v) => {
          await run("on_hold", {}, { hold_reason: v.hold_reason, hold_review_date: v.hold_review_date }, v.hold_notes || undefined);
        }}
      />
      <ActionDialog
        recordId={closeKind === "lost" ? o.id : undefined}
        open={closeKind === "lost"}
        onOpenChange={(v) => !v && setCloseKind(null)}
        title={ar ? "إغلاق الفرصة" : "Close opportunity"}
        description={ar ? "تتوقف التذكيرات عند الإغلاق ويبقى السجل محفوظًا." : "Reminders stop when closed. History is kept."}
        submitLabel={ar ? "إغلاق الفرصة" : "Close opportunity"}
        destructive
        fields={[
          { key: "outcome", type: "select", label: ar ? "النتيجة" : "Outcome", required: true, defaultValue: "lost", options: [{ value: "lost", label: ar ? "مفقودة" : "Lost" }, { value: "cancelled", label: ar ? "ملغاة" : "Cancelled" }] },
          { key: "loss_reason", type: "select", label: ar ? "السبب" : "Reason", required: true, showWhen: { field: "outcome", equals: "lost" }, options: LOST_REASONS.filter((r) => r.value !== "client_cancelled").map((r) => ({ value: r.value, label: presetLabel(r, lang) })) },
          { key: "lost_to_competitor", type: "text", label: ar ? "المنافس" : "Competitor", showWhen: { field: "outcome", equals: "lost" } },
          { key: "lost_at", type: "date", label: ar ? "تاريخ القرار" : "Decision date", required: true, defaultValue: today },
          { key: "loss_notes", type: "textarea", label: ar ? "ملاحظات" : "Notes" },
        ]}
        onSubmit={async (v) => {
          await run("lost", {}, {
            loss_reason: v.outcome === "cancelled" ? "client_cancelled" : v.loss_reason,
            lost_to_competitor: v.lost_to_competitor || null, loss_notes: v.loss_notes || null, lost_at: v.lost_at,
          }, undefined);
          // Reminders stop on close; the follow-ups stay on record as cancelled.
          await supabase.from("follow_ups").update({ status: "cancelled" }).eq("opportunity_id", o.id).in("status", ["scheduled", "due", "overdue"]);
        }}
      />
      <ActionDialog
        recordId={closeKind === "reopen" ? o.id : undefined}
        open={closeKind === "reopen"}
        onOpenChange={(v) => !v && setCloseKind(null)}
        title={ar ? "إعادة فتح الفرصة" : "Reopen opportunity"}
        submitLabel={ar ? "إعادة الفتح" : "Reopen"}
        fields={[
          { key: "to_stage", type: "select", label: ar ? "العودة إلى المرحلة" : "Back to stage", required: true, defaultValue: reopenTo.includes(o.lost_at_stage) ? o.lost_at_stage : undefined, options: reopenTo.map((s) => ({ value: s, label: stageLabel(s) })) },
          { key: "reason", type: "textarea", label: ar ? "سبب إعادة الفتح" : "Reason to reopen", required: true },
          ...perStage(reopenTo),
          ...next,
        ]}
        onSubmit={async (v) => {
          const s = v.to_stage as SalesStage;
          await run(s, v, pick(v, s), v.reason);
        }}
      />
    </>
  );
}
