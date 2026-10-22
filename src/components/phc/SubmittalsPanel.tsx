// =============================================================================
// Samples and drawings on a deal (manager feedback group 5, 2026-10-19).
//
// Each item shows where it stands and offers only the steps the database will
// accept next (src/lib/submittals.ts mirrors submittal_next_steps). Sales
// records every step, naming who did it: a colleague with a login, or a typed
// name such as Ammar in production. The approval is the manager's: other people
// see that it is waiting, not a button that would be refused.
// =============================================================================
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Paperclip } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n, localeFor } from "@/lib/i18n";
import { personLabel } from "@/lib/person-label";
import { isAssignableTeamMember } from "@/lib/team-members";
import { listTeamMembers } from "@/lib/opportunity-actions";
import {
  CLIENT_RESPONSES,
  STAGE_TONE,
  firstStep,
  isClientResponse,
  isManagerStep,
  kindLabel,
  nextSteps,
  responseLabel,
  revisionLabel,
  stageLabel,
  stepActionLabel,
  stepLabel,
  submittalStage,
  type SubmittalKind,
  type SubmittalStep,
} from "@/lib/submittals";
import {
  createSubmittal,
  listDealFiles,
  listDealSubmittals,
  recordSubmittalStep,
  type StepInput,
  type Submittal,
  type SubmittalStepRow,
} from "@/lib/submittal-actions";

const OTHER = "__other__";
const NO_FILE = "__none__";

type Dialog =
  | { mode: "create"; kind: SubmittalKind }
  | { mode: "step"; item: Submittal; step: SubmittalStep };

export function SubmittalsPanel({
  opportunityId,
  canRecord,
  canApprove,
  currentUserId,
}: {
  opportunityId: string;
  /** The deal's sales people (is_sales_contributor). */
  canRecord: boolean;
  /** Commercial managers (is_commercial_manager): may approve or decline a sample. */
  canApprove: boolean;
  currentUserId: string | null;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});

  const key = ["deal-submittals", opportunityId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => listDealSubmittals(opportunityId) });
  const teamQ = useQuery({ queryKey: ["team"], queryFn: listTeamMembers, enabled: canRecord });
  const filesQ = useQuery({
    queryKey: ["deal-files", opportunityId],
    queryFn: () => listDealFiles(opportunityId),
    enabled: dialog !== null,
  });

  const items = data?.items ?? [];
  const steps = data?.steps ?? [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["all-submittals"] });
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(localeFor(lang), { dateStyle: "medium" });
  const today = new Date().toISOString().slice(0, 10);

  // ---- The step form, shared by "new item" and "next step" ---------------------
  const stepFields = (kind: SubmittalKind, step: SubmittalStep): DialogField[] => {
    const someoneElse = step === "in_production" || step === "designer_sent";
    const fields: DialogField[] = [];
    if (step === "client_response") {
      fields.push({
        key: "response",
        type: "select",
        label: ar ? "رد العميل" : "Client's answer",
        required: true,
        options: CLIENT_RESPONSES.map((r) => ({ value: r, label: responseLabel(r, lang) })),
      });
    }
    if (!isManagerStep(step)) {
      fields.push(
        {
          key: "who",
          type: "select",
          label: ar ? "من قام بها؟" : "Who did it?",
          required: true,
          defaultValue: someoneElse ? OTHER : currentUserId ?? OTHER,
          options: [
            ...(teamQ.data ?? []).filter(isAssignableTeamMember).map((m) => ({
              value: m.id,
              label: personLabel(m) || m.id.slice(0, 8),
            })),
            { value: OTHER, label: ar ? "شخص آخر (اكتب الاسم)" : "Someone else (type the name)" },
          ],
        },
        {
          key: "name",
          type: "text",
          label: ar ? "الاسم" : "Name",
          required: true,
          showWhen: { field: "who", equals: OTHER },
          placeholder:
            step === "in_production"
              ? ar ? "مثال: عمار (الإنتاج)" : "e.g. Ammar (production)"
              : step === "designer_sent"
                ? ar ? "اسم المصمم" : "Designer's name"
                : ar ? "الاسم" : "Name",
        },
      );
    }
    fields.push({
      key: "date",
      type: "date",
      label: ar ? "التاريخ" : "Date",
      required: true,
      defaultValue: today,
    });
    if (step === "designer_sent" || step === "sent_to_client" || step === "client_response") {
      fields.push({
        key: "file",
        type: "select",
        label: ar ? "الملف المرسل (من ملفات الفرصة، اختياري)" : "File sent (from the deal's files, optional)",
        defaultValue: NO_FILE,
        options: [
          { value: NO_FILE, label: ar ? "بدون ملف" : "No file" },
          ...(filesQ.data ?? []).map((f) => ({ value: f.id, label: f.label })),
        ],
      });
    }
    fields.push({
      key: "notes",
      type: "textarea",
      label: ar ? "ملاحظات" : "Notes",
      required: step === "declined" || step === "cancelled",
    });
    void kind;
    return fields;
  };

  const readStep = (step: SubmittalStep, v: Record<string, string>): StepInput => {
    if (v.date && v.date > today) throw new Error(ar ? "لا يمكن أن يكون التاريخ في المستقبل." : "The date cannot be in the future.");
    if (step === "client_response" && !isClientResponse(v.response)) {
      throw new Error(ar ? "اختر رد العميل." : "Choose the client's answer.");
    }
    const other = !v.who || v.who === OTHER;
    if (!isManagerStep(step) && other && !v.name?.trim()) {
      throw new Error(ar ? "اكتب اسم من قام بها." : "Type the name of who did it.");
    }
    return {
      step,
      response: step === "client_response" && isClientResponse(v.response) ? v.response : null,
      actorId: isManagerStep(step) ? currentUserId : other ? null : v.who,
      actorName: !isManagerStep(step) && other ? v.name : null,
      occurredAt: v.date || null,
      notes: v.notes || null,
      documentId: v.file && v.file !== NO_FILE ? v.file : null,
    };
  };

  // The dialog shows a failed save under the form. The database's own messages
  // are "English | Arabic"; show the half in the reader's language.
  const localized = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    const parts = msg.split(" | ");
    return new Error(parts.length === 2 ? parts[ar ? 1 : 0] : msg);
  };

  const whoLabel = (s: SubmittalStepRow) =>
    s.actor_name || personLabel(s.actor) || personLabel(s.recorder) || (ar ? "غير معروف" : "Unknown");

  return (
    <Panel
      title={ar ? "العينات والمخططات" : "Samples and drawings"}
      subtitle={ar ? "كل خطوة: من، متى، وملاحظات" : "Every step: who, when and notes"}
      action={
        canRecord ? (
          <div className="flex gap-1.5">
            {(["sample", "drawing"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setDialog({ mode: "create", kind: k })}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {k === "sample" ? (ar ? "عينة جديدة" : "New sample") : ar ? "مخطط جديد" : "New drawing"}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {isLoading ? null : items.length === 0 ? (
        <EmptyState
          message={
            ar
              ? "لا توجد عينات أو مخططات بعد. سجّل طلب عينة أو مخططًا أرسله المصمم."
              : "No samples or drawings yet. Record a sample request or a drawing from the designer."
          }
        />
      ) : (
        <ul className="grid gap-0 divide-y divide-border/60">
          {items.map((item) => {
            const stage = submittalStage(item.kind, item.current_step, item.client_response);
            const allowed = nextSteps(item.kind, item.current_step);
            const buttons = allowed.filter((s) => !isManagerStep(s) || canApprove);
            const waitingOnManager = allowed.some(isManagerStep) && !canApprove;
            const history = steps.filter((s) => s.submittal_id === item.id);
            const open = !!openHistory[item.id];
            const revisions = [...new Set(history.map((s) => s.revision))].sort((a, b) => b - a);
            return (
              <li key={item.id} className="grid gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="muted">{kindLabel(item.kind, lang)}</StatusPill>
                  <span className="text-sm font-medium text-foreground">{item.title}</span>
                  <span className="num text-xs text-muted-foreground" data-tabular="true">
                    {revisionLabel(item.kind, item.revision, lang)}
                  </span>
                  <StatusPill tone={STAGE_TONE[stage]}>{stageLabel(stage, lang)}</StatusPill>
                </div>
                <p className="text-xs text-muted-foreground">
                  {stepLabel(item.current_step, lang)}
                  {item.client_response ? ` · ${responseLabel(item.client_response, lang)}` : ""}
                  {item.last_step_at ? (
                    <>
                      {" · "}
                      <span className="num" data-tabular="true">{fmtDate(item.last_step_at)}</span>
                    </>
                  ) : null}
                </p>
                {canRecord && (buttons.length > 0 || waitingOnManager) ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {buttons.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDialog({ mode: "step", item, step: s })}
                        className={
                          s === "cancelled" || s === "declined"
                            ? "rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-destructive"
                            : "rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-surface-2"
                        }
                      >
                        {stepActionLabel(s, item.kind, lang)}
                      </button>
                    ))}
                    {waitingOnManager ? (
                      <span className="text-xs text-muted-foreground">
                        {ar ? "بانتظار اعتماد مدير المبيعات" : "Waiting for the sales manager's approval"}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {history.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setOpenHistory((h) => ({ ...h, [item.id]: !open }))}
                    className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    aria-expanded={open}
                  >
                    {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
                    {ar ? `السجل (${history.length})` : `History (${history.length})`}
                  </button>
                ) : null}
                {open ? (
                  <div className="grid gap-3 border-s border-border/70 ps-3">
                    {revisions.map((rev) => (
                      <div key={rev} className="grid gap-1.5">
                        <span className="num text-xs font-medium text-foreground" data-tabular="true">
                          {revisionLabel(item.kind, rev, lang)}
                        </span>
                        <ol className="grid gap-1.5">
                          {history
                            .filter((s) => s.revision === rev)
                            .map((s) => (
                              <li key={s.id} className="grid gap-0.5 text-xs">
                                <span className="text-foreground">
                                  {stepLabel(s.step, lang)}
                                  {s.response ? ` · ${responseLabel(s.response, lang)}` : ""}
                                </span>
                                <span className="text-muted-foreground">
                                  {whoLabel(s)}
                                  {" · "}
                                  <span className="num" data-tabular="true">{fmtDate(s.occurred_at)}</span>
                                </span>
                                {s.document ? (
                                  <span className="flex items-center gap-1 text-muted-foreground">
                                    <Paperclip className="h-3 w-3" />
                                    {s.document.title || s.document.original_filename}
                                  </span>
                                ) : null}
                                {s.notes ? <span className="whitespace-pre-wrap text-foreground">{s.notes}</span> : null}
                              </li>
                            ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.mode === "create" ? (
        <ActionDialog
          key={`create-${dialog.kind}`}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          title={dialog.kind === "sample" ? (ar ? "طلب عينة جديدة" : "Request a new sample") : ar ? "مخطط جديد من المصمم" : "New drawing from the designer"}
          submitLabel={ar ? "حفظ" : "Save"}
          fields={[
            {
              key: "title",
              type: "text",
              label: dialog.kind === "sample" ? (ar ? "ما العينة؟" : "What is the sample?") : ar ? "اسم المخطط" : "Drawing title",
              required: true,
              placeholder:
                dialog.kind === "sample"
                  ? ar ? "مثال: وجه لوحة أكريليك" : "e.g. Acrylic pylon face"
                  : ar ? "مثال: مخطط لوحات الواجهة" : "e.g. Facade signage layout",
            },
            ...stepFields(dialog.kind, firstStep(dialog.kind)),
          ]}
          onSubmit={async (v) => {
            try {
              if (!v.title?.trim()) throw new Error(ar ? "اكتب اسمًا." : "Give it a name.");
              const first = readStep(firstStep(dialog.kind), v);
              await createSubmittal({ opportunityId, kind: dialog.kind, title: v.title }, first);
              toast.success(ar ? "تم الحفظ" : "Saved");
              refresh();
            } catch (e) {
              throw localized(e);
            }
          }}
        />
      ) : null}

      {dialog?.mode === "step" ? (
        <ActionDialog
          key={`step-${dialog.item.id}-${dialog.step}`}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          title={`${stepActionLabel(dialog.step, dialog.item.kind, lang)} — ${dialog.item.title}`}
          submitLabel={ar ? "حفظ" : "Save"}
          destructive={dialog.step === "cancelled" || dialog.step === "declined"}
          fields={stepFields(dialog.item.kind, dialog.step)}
          onSubmit={async (v) => {
            try {
              await recordSubmittalStep(dialog.item.id, readStep(dialog.step, v));
              toast.success(ar ? "تم تسجيل الخطوة" : "Step recorded");
              refresh();
            } catch (e) {
              throw localized(e);
            }
          }}
        />
      ) : null}
    </Panel>
  );
}
