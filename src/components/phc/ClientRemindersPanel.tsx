// =============================================================================
// Reminders about a client (manager feedback group 5, 2026-10-19: "client
// follow-up reminders on a specific date, or repeating monthly or yearly").
//
// They are follow-ups whose subject is the company rather than a deal, so they
// appear on the Follow-ups page, in My Workspace and in the day's tasks like any
// other, and notify their owner on the day. Completing a repeating one schedules
// the next in the database; stopping it ends the series.
// =============================================================================
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, localeFor } from "@/lib/i18n";
import { personLabel } from "@/lib/person-label";
import { isAssignableTeamMember } from "@/lib/team-members";
import { completeFollowUp, listTeamMembers, scheduleFollowUp } from "@/lib/opportunity-actions";
import { isRecurrence, nextFollowUpDate, recurrenceLabel, recurrenceOptions } from "@/lib/follow-up-recurrence";

type Reminder = {
  id: string;
  due_date: string;
  status: string;
  notes: string | null;
  channel: string | null;
  owner_id: string | null;
  recurrence: string;
  recurrence_anchor: string | null;
};

export function ClientRemindersPanel({
  companyId,
  canAdd,
  currentUserId,
}: {
  companyId: string;
  /** The sales team (is_sales_contributor). */
  canAdd: boolean;
  currentUserId: string | null;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [doneFor, setDoneFor] = useState<Reminder | null>(null);

  const key = ["client-reminders", companyId];
  const { data: rows = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("follow_ups")
        .select("id, due_date, status, notes, channel, owner_id, recurrence, recurrence_anchor")
        .eq("company_id", companyId)
        .is("opportunity_id", null)
        .in("status", ["scheduled", "due", "overdue"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Reminder[];
    },
  });
  const teamQ = useQuery({ queryKey: ["team"], queryFn: listTeamMembers, enabled: canAdd });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["all-followups"] });
    qc.invalidateQueries({ queryKey: ["workspace"] });
  };

  const today = new Date().toISOString().slice(0, 10);
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(localeFor(lang), { dateStyle: "medium" });
  const people = new Map((teamQ.data ?? []).map((m) => [m.id, m]));

  return (
    <Panel
      title={ar ? "تذكيرات متابعة العميل" : "Client reminders"}
      subtitle={ar ? "في تاريخ محدد، أو كل شهر، أو كل سنة" : "On a date, every month or every year"}
      action={
        canAdd ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {ar ? "إضافة تذكير" : "Add reminder"}
          </button>
        ) : undefined
      }
    >
      {isLoading ? null : rows.length === 0 ? (
        <EmptyState
          message={ar ? "لا توجد تذكيرات قادمة لهذا العميل." : "No upcoming reminders for this client."}
        />
      ) : (
        <ul className="grid gap-0 divide-y divide-border/60">
          {rows.map((r) => {
            const overdue = r.due_date < today;
            const repeating = r.recurrence !== "none";
            const after = repeating
              ? nextFollowUpDate(r.recurrence_anchor ?? r.due_date, r.recurrence, r.due_date, today)
              : null;
            const owner = r.owner_id ? people.get(r.owner_id) : null;
            return (
              <li key={r.id} className="flex items-start gap-3 py-2.5">
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={overdue ? "danger" : r.due_date === today ? "attention" : "neutral"}>
                      <span className="num" data-tabular="true">{fmt(r.due_date)}</span>
                    </StatusPill>
                    <span className="text-xs text-muted-foreground">{recurrenceLabel(r.recurrence, lang)}</span>
                    {owner ? <span className="text-xs text-muted-foreground">· {personLabel(owner)}</span> : null}
                  </div>
                  {r.notes ? <p className="whitespace-pre-wrap text-sm text-foreground">{r.notes}</p> : null}
                  {after ? (
                    <p className="text-xs text-muted-foreground">
                      {ar ? "التالي بعد الإنجاز: " : "Next one when done: "}
                      <span className="num" data-tabular="true">{fmt(after)}</span>
                    </p>
                  ) : null}
                </div>
                {canAdd ? (
                  <div className="flex shrink-0 gap-3 text-xs">
                    <button type="button" onClick={() => setDoneFor(r)} className="text-amber-light hover:underline">
                      {ar ? "تمت" : "Done"}
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        const q = repeating
                          ? ar ? "إيقاف هذا التذكير المتكرر نهائيًا؟" : "Stop this repeating reminder for good?"
                          : ar ? "إلغاء هذا التذكير؟" : "Cancel this reminder?";
                        if (!window.confirm(q)) return;
                        const { error, count } = await supabase
                          .from("follow_ups")
                          .update({ status: "cancelled" }, { count: "exact" })
                          .eq("id", r.id);
                        if (error || !count) {
                          toast.error(ar ? "تعذّر الإلغاء." : "Could not cancel.");
                          return;
                        }
                        refresh();
                      }}
                    >
                      {repeating ? (ar ? "إيقاف" : "Stop") : ar ? "إلغاء" : "Cancel"}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ActionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={ar ? "تذكير متابعة للعميل" : "Client follow-up reminder"}
        submitLabel={ar ? "حفظ" : "Save"}
        fields={[
          { key: "due", type: "date", label: ar ? "التاريخ" : "Date", required: true, defaultValue: today },
          { key: "repeat", type: "select", label: ar ? "التكرار" : "Repeat", options: recurrenceOptions(lang), defaultValue: "none" },
          {
            key: "owner",
            type: "select",
            label: ar ? "من يُذكَّر" : "Who to remind",
            required: true,
            defaultValue: currentUserId ?? "",
            options: (teamQ.data ?? []).filter(isAssignableTeamMember).map((m) => ({
              value: m.id,
              label: personLabel(m) || m.id.slice(0, 8),
            })),
          },
          {
            key: "notes",
            type: "textarea",
            label: ar ? "ما المطلوب؟" : "What is it for?",
            required: true,
            placeholder: ar ? "مثال: زيارة سنوية لمدير المشتريات" : "e.g. Annual visit to the procurement manager",
          },
        ]}
        onSubmit={async (v) => {
          if (v.due < today) throw new Error(ar ? "اختر تاريخًا اليوم أو بعده." : "Pick today or a later date.");
          await scheduleFollowUp({
            companyId,
            dueDate: v.due,
            notes: v.notes,
            ownerId: v.owner || undefined,
            recurrence: isRecurrence(v.repeat) ? v.repeat : "none",
          });
          toast.success(ar ? "تم حفظ التذكير" : "Reminder saved");
          refresh();
        }}
      />

      <ActionDialog
        open={!!doneFor}
        onOpenChange={(v) => !v && setDoneFor(null)}
        title={ar ? "تمت المتابعة" : "Follow-up done"}
        description={
          doneFor && doneFor.recurrence !== "none"
            ? ar ? "سيُجدول التذكير التالي تلقائيًا." : "The next reminder is scheduled automatically."
            : undefined
        }
        submitLabel={ar ? "حفظ" : "Save"}
        fields={[{ key: "outcome", type: "textarea", label: ar ? "ماذا حدث؟" : "What happened?", required: true }]}
        onSubmit={async (v) => {
          await completeFollowUp({ followUpId: doneFor!.id, opportunityId: null, outcome: v.outcome });
          toast.success(ar ? "تم التسجيل" : "Recorded");
          refresh();
        }}
      />
    </Panel>
  );
}
