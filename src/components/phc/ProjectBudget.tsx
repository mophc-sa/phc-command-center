import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n, formatCurrency } from "@/lib/i18n";
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
      <div className="rounded-lg border border-amber/25 bg-amber/[0.06] px-4 py-2.5 text-[12px] text-amber-light">
        {lang === "ar"
          ? "بيانات ميزانية يدوية مبدئية — سيتم ربطها بقسم المالية لاحقًا."
          : "Manual, preliminary budget data — will be linked to the Finance module later."}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-surface/60 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "المخطط" : "Planned"}</div>
          <div className="num mt-1 text-lg font-semibold text-foreground">{formatCurrency(totalPlanned, lang)}</div>
        </div>
        <div className="rounded-lg border border-border/70 bg-surface/60 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "الفعلي" : "Actual"}</div>
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
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/60 bg-surface/60 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
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
