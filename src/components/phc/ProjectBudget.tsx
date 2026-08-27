import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canReviewAiOutput } from "@/lib/roles";
import { getLatestAgentOutput, reviewAgentOutput, type AiAgentOutputRow } from "@/lib/ai-review-actions";
import { runAiAgent } from "@/lib/ai-orchestrator-actions";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { EmptyState } from "@/components/phc/EmptyState";
import {
  listBudgetItems,
  createBudgetItem,
  updateBudgetItem,
  deleteBudgetItem,
  type ProjectBudgetItem,
} from "@/lib/project-budget-actions";

export function ProjectBudget({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const itemsQ = useQuery({ queryKey: ["proj-budget", projectId], queryFn: () => listBudgetItems(projectId) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["proj-budget", projectId] });

  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<ProjectBudgetItem | null>(null);

  const items = itemsQ.data ?? [];
  const totalPlanned = items.reduce((s, i) => s + (i.planned_amount ?? 0), 0);
  const totalActual = items.reduce((s, i) => s + (i.actual_amount ?? 0), 0);

  async function handleDelete(item: ProjectBudgetItem) {
    if (!confirm(lang === "ar" ? `حذف "${item.category}"؟` : `Delete "${item.category}"?`)) return;
    try {
      await deleteBudgetItem(item.id);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber/25 bg-amber/[0.06] px-4 py-2.5 text-sm text-amber-light">
        {lang === "ar"
          ? "بيانات ميزانية يدوية مبدئية — سيتم ربطها بقسم المالية لاحقًا."
          : "Manual, preliminary budget data — will be linked to the Finance module later."}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-surface/60 px-4 py-3">
          <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "المخطط" : "Planned"}</div>
          <div className="num mt-1 text-lg font-semibold text-foreground">{formatCurrency(totalPlanned, lang)}</div>
        </div>
        <div className="rounded-lg border border-border/70 bg-surface/60 px-4 py-3">
          <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "الفعلي" : "Actual"}</div>
          <div className="num mt-1 text-lg font-semibold text-foreground">{formatCurrency(totalActual, lang)}</div>
        </div>
      </div>

      {canEdit ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> {lang === "ar" ? "إضافة بند" : "Add line item"}
        </button>
      ) : null}

      {itemsQ.isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "جارٍ التحميل…" : "Loading…"}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={lang === "ar" ? "لا توجد بنود ميزانية بعد" : "No budget line items yet"}
          description={lang === "ar" ? "أضف أول بند لبدء تتبع الميزانية." : "Add the first item to start tracking budget."}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/70">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-surface/60 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-3 py-2 text-start">{lang === "ar" ? "البند" : "Category"}</th>
                <th className="px-3 py-2 text-start">{lang === "ar" ? "الوصف" : "Description"}</th>
                <th className="px-3 py-2 text-end">{lang === "ar" ? "المخطط" : "Planned"}</th>
                <th className="px-3 py-2 text-end">{lang === "ar" ? "الفعلي" : "Actual"}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border/60 bg-surface/40">
                  <td className="px-3 py-2 font-medium text-foreground">{item.category}</td>
                  <td className="px-3 py-2 text-muted-foreground">{item.description ?? "—"}</td>
                  <td className="num px-3 py-2 text-end text-foreground">{item.planned_amount != null ? formatCurrency(item.planned_amount, lang, item.currency) : "—"}</td>
                  <td className="num px-3 py-2 text-end text-foreground">{item.actual_amount != null ? formatCurrency(item.actual_amount, lang, item.currency) : "—"}</td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => setEditItem(item)} className="text-muted-foreground hover:text-foreground" aria-label="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => handleDelete(item)} className="text-muted-foreground hover:text-destructive" aria-label="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 ? <BudgetVariancePanel projectId={projectId} lang={lang} /> : null}

      {canEdit ? (
        <ActionDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          title={lang === "ar" ? "إضافة بند ميزانية" : "Add budget item"}
          submitLabel={lang === "ar" ? "إضافة" : "Add"}
          fields={[
            { key: "category", type: "text", label: lang === "ar" ? "البند" : "Category", required: true },
            { key: "description", type: "textarea", label: lang === "ar" ? "الوصف" : "Description" },
            { key: "plannedAmount", type: "text", label: lang === "ar" ? "المبلغ المخطط" : "Planned amount" },
            { key: "actualAmount", type: "text", label: lang === "ar" ? "المبلغ الفعلي" : "Actual amount" },
            { key: "notes", type: "textarea", label: lang === "ar" ? "ملاحظات" : "Notes" },
          ]}
          onSubmit={async (v) => {
            await createBudgetItem({
              projectId,
              category: v.category,
              description: v.description || null,
              plannedAmount: v.plannedAmount ? Number(v.plannedAmount) : null,
              actualAmount: v.actualAmount ? Number(v.actualAmount) : null,
              notes: v.notes || null,
            });
            setAddOpen(false);
            invalidate();
          }}
        />
      ) : null}

      {canEdit && editItem ? (
        <ActionDialog
          open={!!editItem}
          onOpenChange={(o) => !o && setEditItem(null)}
          title={lang === "ar" ? "تعديل البند" : "Edit item"}
          submitLabel={lang === "ar" ? "حفظ" : "Save"}
          fields={[
            { key: "category", type: "text", label: lang === "ar" ? "البند" : "Category", required: true, defaultValue: editItem.category },
            { key: "description", type: "textarea", label: lang === "ar" ? "الوصف" : "Description", defaultValue: editItem.description ?? "" },
            { key: "plannedAmount", type: "text", label: lang === "ar" ? "المبلغ المخطط" : "Planned amount", defaultValue: editItem.planned_amount != null ? String(editItem.planned_amount) : "" },
            { key: "actualAmount", type: "text", label: lang === "ar" ? "المبلغ الفعلي" : "Actual amount", defaultValue: editItem.actual_amount != null ? String(editItem.actual_amount) : "" },
            { key: "notes", type: "textarea", label: lang === "ar" ? "ملاحظات" : "Notes", defaultValue: editItem.notes ?? "" },
          ]}
          onSubmit={async (v) => {
            await updateBudgetItem(editItem.id, {
              category: v.category,
              description: v.description || null,
              plannedAmount: v.plannedAmount ? Number(v.plannedAmount) : null,
              actualAmount: v.actualAmount ? Number(v.actualAmount) : null,
              notes: v.notes || null,
            });
            setEditItem(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

const VARIANCE_RISK_TONE: Record<string, string> = {
  low: "bg-won/15 text-won",
  medium: "bg-amber-500/15 text-amber-400",
  high: "bg-destructive/15 text-destructive",
};

// project_budget_variance AI agent (2026-08-04) — planned vs. actual
// analysis across this project's line items. Read-only recommendation with
// the same Accept/Reject audit trail as every other agent; nothing here
// writes back to project_budget_items.
function BudgetVariancePanel({ projectId, lang }: { projectId: string; lang: "en" | "ar" }) {
  const { roles } = useAuth();
  const canReview = canReviewAiOutput(roles);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const outputQ = useQuery({
    queryKey: ["ai-output", "projects", projectId, "project_budget_variance"],
    queryFn: () => getLatestAgentOutput("projects", projectId, "project_budget_variance"),
  });

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const result = await runAiAgent({ agent: "project_budget_variance", entityType: "projects", entityId: projectId });
      if (!result.ok) throw new Error(result.message);
      outputQ.refetch();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleDecide(output: AiAgentOutputRow, decision: "accepted" | "rejected") {
    setReviewingId(output.id);
    try {
      await reviewAgentOutput({ outputId: output.id, decision });
      outputQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setReviewingId(null);
    }
  }

  const output = outputQ.data;
  const display = output?.structured_output as any;

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-surface/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          {lang === "ar" ? "تحليل انحراف الميزانية (AI)" : "Budget Variance Analysis (AI)"}
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-2.5 py-1 text-xs font-medium text-amber-light transition-colors hover:bg-amber/20 disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" />
          {running ? (lang === "ar" ? "جارٍ التحليل…" : "Analyzing…") : (lang === "ar" ? "تحليل الآن" : "Analyze now")}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      {display && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            {display.risk_level && (
              <span className={`rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide ${VARIANCE_RISK_TONE[display.risk_level] ?? "bg-muted text-muted-foreground"}`}>
                {display.risk_level}
              </span>
            )}
            {display.overall_variance_pct != null && (
              <span className="text-sm font-medium text-foreground">
                {lang === "ar" ? "الانحراف الإجمالي" : "Overall variance"}: {display.overall_variance_pct > 0 ? "+" : ""}{display.overall_variance_pct}%
              </span>
            )}
          </div>
          {display.narrative && <div className="text-xs text-muted-foreground">{display.narrative}</div>}

          {display.over_budget_categories?.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "فوق الميزانية" : "Over Budget"}</div>
              <ul className="space-y-1">
                {display.over_budget_categories.map((c: any, i: number) => (
                  <li key={i} className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs">
                    <span className="font-medium text-destructive">{c.category}</span>{" "}
                    <span className="text-muted-foreground">({c.variance_pct > 0 ? "+" : ""}{c.variance_pct}%) — {c.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {display.under_budget_categories?.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "تحت الميزانية" : "Under Budget"}</div>
              <ul className="space-y-1">
                {display.under_budget_categories.map((c: any, i: number) => (
                  <li key={i} className="rounded-md border border-won/30 bg-won/10 px-2.5 py-1.5 text-xs">
                    <span className="font-medium text-won">{c.category}</span>{" "}
                    <span className="text-muted-foreground">({c.variance_pct > 0 ? "+" : ""}{c.variance_pct}%) — {c.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {display.recommended_actions?.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "إجراءات موصى بها" : "Recommended Actions"}</div>
              <ul className="space-y-1">
                {display.recommended_actions.map((a: string, i: number) => (
                  <li key={i} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground">{a}</li>
                ))}
              </ul>
            </div>
          )}
          {display.disclaimer && <div className="text-xs italic text-muted-foreground">{display.disclaimer}</div>}

          {output && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs">
              <span className="text-muted-foreground">
                {output.status === "pending_review"
                  ? (lang === "ar" ? "بانتظار المراجعة" : "Pending review")
                  : output.status === "accepted"
                  ? (lang === "ar" ? "تم القبول" : "Accepted")
                  : (lang === "ar" ? "تم الرفض" : "Rejected")}
              </span>
              {output.status === "pending_review" && canReview ? (
                <>
                  <button
                    type="button"
                    disabled={reviewingId === output.id}
                    onClick={() => handleDecide(output, "accepted")}
                    className="rounded-md border border-won/40 bg-won/10 px-2.5 py-1 text-xs font-medium text-won transition-colors hover:bg-won/[0.16] disabled:opacity-50"
                  >
                    {lang === "ar" ? "قبول" : "Accept"}
                  </button>
                  <button
                    type="button"
                    disabled={reviewingId === output.id}
                    onClick={() => handleDecide(output, "rejected")}
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive/90 transition-colors hover:bg-destructive/[0.16] disabled:opacity-50"
                  >
                    {lang === "ar" ? "رفض" : "Reject"}
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
