// =============================================================================
// Project updates — the dated log inside each project (manager feedback group 4,
// 2026-10-19: "an update log inside each project, e.g. offer sent, PO received,
// awaiting payment").
//
// The construction % and the site's stage (design, excavation, structure, ...)
// live here too. Neither is edited on its own: each moves when someone posts an
// update that reports it, so every figure on the home page has a dated entry and
// a name behind it.
// =============================================================================
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { CompletionBar } from "@/components/phc/CompletionBar";
import { useI18n, localeFor } from "@/lib/i18n";
import { personLabel } from "@/lib/person-label";
import {
  UPDATE_KINDS,
  UPDATE_KIND_LABEL,
  isUpdateKind,
  siteStageLabel,
  siteStageOptions,
  updateKindLabel,
  validateUpdate,
} from "@/lib/project-tracking";
import { deleteProjectUpdate, listProjectUpdates, postProjectUpdate } from "@/lib/project-update-actions";

const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_TONE: Partial<Record<string, "positive" | "attention" | "neutral">> = {
  po_received: "positive",
  contract_signed: "positive",
  payment_received: "positive",
  awaiting_payment: "attention",
  awaiting_client: "attention",
};

export function ProjectUpdatesPanel({
  opportunityId,
  completionPct,
  siteStage,
  canPost,
  canModerate,
  currentUserId,
  onChanged,
}: {
  opportunityId: string;
  /** The deal's construction progress, 0-100, or null when nobody has said. */
  completionPct: number | null;
  /** The site's stage (opportunities.project_stage); `unknown` or null when nobody has said. */
  siteStage: string | null;
  /** The deal's people: owner and pipeline operators. */
  canPost: boolean;
  /** Pipeline operators may remove any entry; authors only their own, same day. */
  canModerate: boolean;
  currentUserId: string | null;
  /** The deal row changes too (completion %, site stage, last activity). */
  onChanged: () => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const key = ["opp-updates", opportunityId];
  const { data: rows = [], isLoading } = useQuery({ queryKey: key, queryFn: () => listProjectUpdates(opportunityId) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    onChanged();
  };

  const stageKnown = !!siteStage && siteStage !== "unknown";
  const kindOptions = UPDATE_KINDS.map((k) => ({ value: k, label: UPDATE_KIND_LABEL[k][lang] }));

  return (
    <Panel
      title={ar ? "تحديثات المشروع" : "Project updates"}
      subtitle={ar ? "مرحلة الموقع ونسبة إنجازه وآخر ما حدث في المشروع" : "Site stage, construction progress and what happened last"}
      action={
        canPost ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {ar ? "إضافة تحديث" : "Post update"}
          </button>
        ) : undefined
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="grid gap-1.5">
            <span className="text-xs tracking-[0.02em] text-muted-foreground">
              {ar ? "مرحلة الموقع" : "Site stage"}
            </span>
            <span className="text-sm font-medium text-foreground">
              {stageKnown ? siteStageLabel(siteStage, lang) : "—"}
            </span>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs tracking-[0.02em] text-muted-foreground">
              {ar ? "نسبة إنجاز الموقع" : "Construction progress"}
            </span>
            <CompletionBar pct={completionPct} />
          </div>
        </div>

        {isLoading ? null : rows.length === 0 ? (
          <EmptyState
            message={
              ar
                ? "لا توجد تحديثات بعد. أضف أول تحديث، مثل: تم إرسال العرض."
                : "No updates yet. Post the first one, e.g. Offer sent."
            }
          />
        ) : (
          <ol className="grid gap-0 divide-y divide-border/60">
            {rows.map((u) => {
              const mine = !!currentUserId && u.created_by === currentUserId;
              const fresh = Date.now() - new Date(u.created_at).getTime() < DAY_MS;
              const removable = canModerate || (mine && fresh);
              return (
                <li key={u.id} className="flex items-start gap-3 py-2.5">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={KIND_TONE[u.kind] ?? "neutral"}>
                        {updateKindLabel(u.kind, lang)}
                      </StatusPill>
                      {u.project_stage ? (
                        <span className="text-xs font-medium text-foreground">{siteStageLabel(u.project_stage, lang)}</span>
                      ) : null}
                      {u.completion_pct !== null ? (
                        <span className="num text-xs font-medium text-foreground" data-tabular="true">
                          {ar ? `الإنجاز ${u.completion_pct}%` : `Progress ${u.completion_pct}%`}
                        </span>
                      ) : null}
                    </div>
                    {u.note ? <p className="whitespace-pre-wrap text-sm text-foreground">{u.note}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {personLabel(u.author) || (ar ? "غير معروف" : "Unknown")}
                      {" · "}
                      <span className="num" data-tabular="true">
                        {new Date(u.created_at).toLocaleString(localeFor(lang), { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    </p>
                  </div>
                  {removable ? (
                    <button
                      type="button"
                      aria-label={ar ? "حذف التحديث" : "Delete update"}
                      className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        if (!window.confirm(ar ? "حذف هذا التحديث؟" : "Delete this update?")) return;
                        try {
                          await deleteProjectUpdate(u.id);
                          refresh();
                        } catch {
                          toast.error(ar ? "تعذّر الحذف. يمكن حذف التحديث في نفس اليوم فقط." : "Could not delete. Updates can only be removed the same day.");
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title={ar ? "إضافة تحديث للمشروع" : "Post a project update"}
        submitLabel={ar ? "حفظ التحديث" : "Save update"}
        fields={[
          { key: "kind", type: "select", label: ar ? "ما الذي حدث؟" : "What happened?", required: true, options: kindOptions },
          {
            key: "stage",
            type: "select",
            label: ar ? "مرحلة الموقع الآن (اختياري)" : "Site stage now (optional)",
            options: siteStageOptions(lang),
          },
          {
            key: "pct",
            type: "text",
            label: ar ? "نسبة إنجاز الموقع الجديدة (اختياري)" : "New construction progress % (optional)",
            placeholder: completionPct === null ? "0-100" : String(completionPct),
          },
          { key: "note", type: "textarea", label: ar ? "ملاحظة" : "Note" },
        ]}
        onSubmit={async (v) => {
          if (!isUpdateKind(v.kind)) throw new Error(ar ? "اختر نوع التحديث." : "Choose what happened.");
          const check = validateUpdate({ kind: v.kind, note: v.note ?? "", pct: v.pct ?? "", stage: v.stage ?? "" });
          if (!check.ok) {
            throw new Error(
              check.reason === "note_required"
                ? ar ? "اكتب ملاحظة تشرح التحديث." : "Add a note saying what the update is."
                : check.reason === "pct_required"
                  ? ar ? "تحديث الإنجاز يحتاج إلى نسبة أو مرحلة." : "A progress update needs a % or a stage."
                  : ar ? "النسبة رقم صحيح من 0 إلى 100." : "The % must be a whole number from 0 to 100.",
            );
          }
          await postProjectUpdate({ opportunityId, kind: v.kind, note: v.note ?? "", pct: check.pct, stage: check.stage });
          toast.success(ar ? "تم حفظ التحديث" : "Update saved");
          refresh();
        }}
      />
    </Panel>
  );
}
