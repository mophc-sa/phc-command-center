import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Panel } from "./Panel";
import { GroundedAiAnswer } from "./GroundedAiAnswer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canCreateSalesRecords } from "@/lib/roles";
import {
  getDailyAssistant,
  approveDailyTask,
  prepareAiMeeting,
  type DailySuggestion,
  type GroundedResult,
} from "@/lib/ai-operations-actions";
export function DailyAssistantPanel() {
  const { lang } = useI18n(),
    { user, roles } = useAuth(),
    qc = useQueryClient();
  const ar = lang === "ar",
    allowed = canCreateSalesRecords(roles);
  const [selected, setSelected] = useState<DailySuggestion | null>(null),
    [title, setTitle] = useState(""),
    [due, setDue] = useState("");
  const [busy, setBusy] = useState<string | null>(null),
    [meeting, setMeeting] = useState<{ answer: GroundedResult; source: DailySuggestion } | null>(
      null,
    );
  const daily = useQuery({
    queryKey: ["ai-daily-assistant", user?.id, lang],
    queryFn: () => getDailyAssistant(lang),
    enabled: !!user && allowed,
    refetchInterval: 60000,
  });
  if (!allowed) return null;
  function review(s: DailySuggestion, text = s.proposed_task) {
    setSelected(s);
    setTitle(text);
    setDue(s.due ?? "");
  }
  async function createTask() {
    if (!selected) return;
    setBusy("task");
    try {
      const r = await approveDailyTask(selected, title, due || null);
      toast.success(
        r.replayed
          ? ar
            ? "المهمة موجودة بالفعل"
            : "Task already exists"
          : ar
            ? "تم إنشاء المهمة المعتمدة"
            : "Approved task created",
      );
      setSelected(null);
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("task") });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  async function prepare(s: DailySuggestion) {
    if (!s.opportunity_id) return;
    setBusy(s.source_id);
    try {
      setMeeting({ answer: await prepareAiMeeting(s.opportunity_id, lang), source: s });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Panel title={ar ? "مساعدي اليومي" : "My daily assistant"}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {ar
            ? "ترتيب المتابعات وفحص نواقص RFQ وBOQ من سجلاتك. تتحدث القائمة كل دقيقة؛ إنشاء المهام وإعداد المسودات يتم بطلبك."
            : "Prioritized follow-ups and RFQ/BOQ gap checks from your records. The list refreshes every minute; tasks and drafts are prepared at your request."}
        </p>
        {daily.isPending ? (
          <p>{ar ? "جارٍ قراءة السجلات…" : "Reading records…"}</p>
        ) : daily.error ? (
          <p role="alert" className="text-destructive">
            {daily.error.message}
            <button onClick={() => daily.refetch()} className="ms-3 underline">
              {ar ? "إعادة المحاولة" : "Retry"}
            </button>
          </p>
        ) : null}
        {daily.data && (
          <>
            <p className="text-xs text-muted-foreground">
              {daily.data.scope} · {new Date(daily.data.as_of).toLocaleTimeString(lang)} ·{" "}
              {daily.data.total_suggestions} {ar ? "اقتراحًا" : "suggestions"}
            </p>
            {!daily.data.suggestions.length && (
              <p>
                {ar
                  ? "لا توجد متابعات أو نواقص مقترحة ضمن سجلاتك الحالية."
                  : "No follow-ups or gap suggestions in your current records."}
              </p>
            )}
            <div className="max-h-[36rem] space-y-3 overflow-auto">
              {daily.data.suggestions.map((s) => (
                <article key={`${s.source_type}:${s.source_id}`} className="rounded-lg border p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h4 className="font-medium">{s.title}</h4>
                    <span className="text-xs text-muted-foreground">
                      {s.source_type} · {s.due ?? (ar ? "بدون موعد" : "No due date")}
                    </span>
                  </div>
                  <p className="text-sm">{s.reasons.join(" · ")}</p>
                  {s.gaps.length > 0 && (
                    <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                      {s.gaps.map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      disabled={!!busy}
                      className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                      onClick={() => review(s)}
                    >
                      {ar ? "مراجعة المهمة المقترحة" : "Review proposed task"}
                    </button>
                    {s.opportunity_id && (
                      <button
                        disabled={!!busy}
                        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                        onClick={() => prepare(s)}
                      >
                        {busy === s.source_id
                          ? ar
                            ? "جارٍ تجهيز الاجتماع…"
                            : "Preparing meeting…"
                          : ar
                            ? "تجهيز اجتماع ومسودة متابعة"
                            : "Prepare meeting and follow-up draft"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {meeting && (
          <GroundedAiAnswer
            answer={meeting.answer}
            onTaskDraft={(text) => review(meeting.source, text)}
          />
        )}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {ar ? "اعتماد المهمة قبل إنشائها" : "Approve task before creation"}
            </DialogTitle>
            <DialogDescription>
              {ar
                ? "راجع العنوان والموعد. تُسند المهمة إليك وترتبط بسجلها الأصلي."
                : "Review the title and due date. The task will be assigned to you and linked to its source."}
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm">
            {ar ? "عنوان المهمة" : "Task title"}
            <textarea
              className="mt-1 w-full rounded border bg-background p-2"
              maxLength={500}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="text-sm">
            {ar ? "الموعد" : "Due date"}
            <input
              className="mt-1 w-full rounded border bg-background p-2"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <button
            disabled={!!busy || !title.trim()}
            onClick={createTask}
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            {busy === "task"
              ? ar
                ? "جارٍ الحفظ…"
                : "Saving…"
              : ar
                ? "اعتماد وإنشاء المهمة"
                : "Approve and create task"}
          </button>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
