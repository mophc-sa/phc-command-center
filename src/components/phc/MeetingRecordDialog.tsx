// Image 27 (Omar's CRM review): record a meeting by hand — notes, attendees,
// decisions, and actions. Saving logs the meeting on the deal and turns each
// action line into a follow-up, so nothing agreed in the room is lost.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { logActivity } from "@/lib/activity-actions";
import { scheduleFollowUp } from "@/lib/opportunity-actions";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { riyadhDay } from "@/lib/riyadh-day";

export function MeetingRecordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();
  const qc = useQueryClient();
  const deals = useQuery({
    queryKey: ["meeting-record-deals", user?.id],
    enabled: open && !!user?.id,
    queryFn: async () =>
      (await supabase.from("opportunities").select("id, project_name").eq("owner_id", user!.id)
        .not("sales_stage", "in", "(won,lost)").neq("stage", "archived").order("project_name").limit(500)).data ?? [],
  });
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={ar ? "سجل الاجتماع" : "Meeting record"}
      submitLabel={ar ? "حفظ الاجتماع والإجراءات" : "Save meeting & actions"}
      fields={[
        { key: "deal", type: "select", label: ar ? "الفرصة" : "Opportunity", required: true, options: (deals.data ?? []).map((d) => ({ value: d.id, label: d.project_name ?? "—" })) },
        { key: "date", type: "date", label: ar ? "التاريخ" : "Date", required: true, defaultValue: riyadhDay() },
        { key: "attendees", type: "text", label: ar ? "الحضور" : "Attendees", required: true },
        { key: "notes", type: "textarea", label: ar ? "الملاحظات" : "Notes", required: true },
        { key: "decisions", type: "textarea", label: ar ? "القرارات" : "Decisions" },
        { key: "actions", type: "textarea", label: ar ? "الإجراءات (سطر لكل إجراء)" : "Actions (one per line)" },
        { key: "due", type: "date", label: ar ? "موعد الإجراءات" : "Actions due" },
      ]}
      onSubmit={async (v) => {
        const actions = (v.actions ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
        if (actions.length && !v.due) { toast.error(ar ? "حدد موعد الإجراءات" : "Set a due date for the actions"); throw new Error("due"); }
        const summary = [
          `${ar ? "الحضور" : "Attendees"}: ${v.attendees}`,
          v.notes,
          v.decisions ? `${ar ? "القرارات" : "Decisions"}: ${v.decisions}` : null,
          actions.length ? `${ar ? "الإجراءات" : "Actions"}:\n- ${actions.join("\n- ")}` : null,
        ].filter(Boolean).join("\n\n");
        try {
          await logActivity({ type: "meeting", summary, opportunityId: v.deal, occurredAt: `${v.date}T12:00:00+03:00` });
          for (const a of actions) await scheduleFollowUp({ opportunityId: v.deal, dueDate: v.due, notes: a });
          toast.success(ar ? `حُفظ الاجتماع و${actions.length} إجراء` : `Meeting saved with ${actions.length} action(s)`);
          qc.invalidateQueries({ queryKey: ["opp-recent-activity", v.deal] });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
          throw e;
        }
      }}
    />
  );
}
