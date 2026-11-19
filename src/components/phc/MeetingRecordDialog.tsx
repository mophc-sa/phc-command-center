// Image 27 (Omar's CRM review): record a meeting — notes, attendees,
// decisions and actions. "AI draft notes" organises the rough notes into the
// three fields for the person to edit; nothing is saved until they press Save.
// Saving logs the meeting on the deal and turns each action line into a follow-up.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { logActivity } from "@/lib/activity-actions";
import { scheduleFollowUp } from "@/lib/opportunity-actions";
import { runAiAgent } from "@/lib/ai-orchestrator-actions";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { riyadhDay } from "@/lib/riyadh-day";

const EMPTY = { deal: "", date: "", attendees: "", notes: "", decisions: "", actions: "", due: "" };

export function MeetingRecordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();
  const qc = useQueryClient();
  const [v, setV] = useState({ ...EMPTY, date: riyadhDay() });
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const deals = useQuery({
    queryKey: ["meeting-record-deals", user?.id],
    enabled: open && !!user?.id,
    queryFn: async () =>
      (await supabase.from("opportunities").select("id, project_name").eq("owner_id", user!.id)
        .not("sales_stage", "in", "(won,lost)").neq("stage", "archived").order("project_name").limit(500)).data ?? [],
  });
  const lines = (s: string) => s.split("\n").map((x) => x.trim().replace(/^[-•]\s*/, "")).filter(Boolean);

  async function draft() {
    if (!v.deal || !v.notes.trim()) { toast.error(ar ? "اختر الفرصة واكتب ملاحظاتك أولًا" : "Pick the opportunity and type your rough notes first"); return; }
    setBusy("ai");
    try {
      const r = await runAiAgent({ agent: "meeting_notes_draft", entityType: "opportunities", entityId: v.deal, input: { rough_notes: v.notes, attendees: v.attendees } });
      if (!r.ok) { toast.error(r.message); return; }
      const o = r.result as { notes: string; decisions: string[]; actions: string[] };
      setV((x) => ({ ...x, notes: o.notes, decisions: o.decisions.join("\n"), actions: o.actions.join("\n") }));
      toast.success(ar ? "مسودة جاهزة — راجعها قبل الحفظ" : "Draft ready — review it before saving");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const actions = lines(v.actions);
    if (!v.deal || !v.date || !v.attendees.trim() || !v.notes.trim()) { toast.error(ar ? "الفرصة والتاريخ والحضور والملاحظات مطلوبة" : "Opportunity, date, attendees and notes are required"); return; }
    if (actions.length && !v.due) { toast.error(ar ? "حدد موعد الإجراءات" : "Set a due date for the actions"); return; }
    const summary = [
      `${ar ? "الحضور" : "Attendees"}: ${v.attendees}`,
      v.notes,
      v.decisions.trim() ? `${ar ? "القرارات" : "Decisions"}:\n- ${lines(v.decisions).join("\n- ")}` : null,
      actions.length ? `${ar ? "الإجراءات" : "Actions"}:\n- ${actions.join("\n- ")}` : null,
    ].filter(Boolean).join("\n\n");
    setBusy("save");
    try {
      await logActivity({ type: "meeting", summary, opportunityId: v.deal, occurredAt: `${v.date}T12:00:00+03:00` });
      for (const a of actions) await scheduleFollowUp({ opportunityId: v.deal, dueDate: v.due, notes: a });
      toast.success(ar ? `حُفظ الاجتماع و${actions.length} إجراء` : `Meeting saved with ${actions.length} action(s)`);
      qc.invalidateQueries({ queryKey: ["opp-recent-activity", v.deal] });
      setV({ ...EMPTY, date: riyadhDay() });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const field = "grid gap-1.5";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>{ar ? "سجل الاجتماع" : "Meeting record"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-3">
            <div className={field}>
              <Label htmlFor="mr-deal">{ar ? "الفرصة" : "Opportunity"} *</Label>
              <select id="mr-deal" value={v.deal} onChange={set("deal")} className="min-h-10 rounded-md border border-border bg-background px-3 text-sm">
                <option value="">—</option>
                {(deals.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.project_name ?? "—"}</option>)}
              </select>
            </div>
            <div className={field}><Label htmlFor="mr-date">{ar ? "التاريخ" : "Date"} *</Label><Input id="mr-date" type="date" value={v.date} onChange={set("date")} /></div>
            <div className={field}><Label htmlFor="mr-att">{ar ? "الحضور" : "Attendees"} *</Label><Input id="mr-att" value={v.attendees} onChange={set("attendees")} /></div>
            <div className={field}>
              <div className="flex items-center justify-between">
                <Label htmlFor="mr-notes">{ar ? "الملاحظات" : "Notes"} *</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => void draft()} disabled={busy !== null}>
                  <Sparkles className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{busy === "ai" ? (ar ? "جارٍ الصياغة…" : "Drafting…") : (ar ? "مسودة بالذكاء الاصطناعي" : "AI draft notes")}
                </Button>
              </div>
              <Textarea id="mr-notes" rows={8} value={v.notes} onChange={set("notes")} placeholder={ar ? "اكتب ملاحظاتك كما هي، ثم اطلب المسودة" : "Type your rough notes, then ask for a draft"} />
            </div>
          </div>
          <div className="grid content-start gap-3">
            <div className={field}><Label htmlFor="mr-dec">{ar ? "القرارات (سطر لكل قرار)" : "Decisions (one per line)"}</Label><Textarea id="mr-dec" rows={5} value={v.decisions} onChange={set("decisions")} /></div>
            <div className={field}><Label htmlFor="mr-act">{ar ? "الإجراءات (سطر لكل إجراء — تصبح متابعات)" : "Actions (one per line — each becomes a follow-up)"}</Label><Textarea id="mr-act" rows={5} value={v.actions} onChange={set("actions")} /></div>
            <div className={field}><Label htmlFor="mr-due">{ar ? "موعد الإجراءات" : "Actions due"}</Label><Input id="mr-due" type="date" value={v.due} onChange={set("due")} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ar ? "إلغاء" : "Cancel"}</Button>
          <Button type="button" onClick={() => void save()} disabled={busy !== null}>{busy === "save" ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "حفظ الاجتماع والإجراءات" : "Save meeting & actions")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
