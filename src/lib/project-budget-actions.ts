import { supabase } from "@/integrations/supabase/client";

type Uuid = string;

/* ---------------- Project Budget — manual line items ----------------------
   Placeholder ahead of real Finance-module integration (2026-08-03 client
   request: "يتم ربطها بقسم المالية لاحقاً"). Write access already gated
   server-side (RLS) to the same finance-adjacent roles that own
   commercial "Total Value" edits elsewhere — see can_edit_total_value(). */

export type ProjectBudgetItem = {
  id: string;
  project_id: string;
  category: string;
  description: string | null;
  planned_amount: number | null;
  actual_amount: number | null;
  currency: string;
  notes: string | null;
};

export async function listBudgetItems(projectId: Uuid): Promise<ProjectBudgetItem[]> {
  const { data, error } = await supabase
    .from("project_budget_items")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ProjectBudgetItem[];
}

export async function createBudgetItem(input: {
  projectId: Uuid;
  category: string;
  description?: string | null;
  plannedAmount?: number | null;
  actualAmount?: number | null;
  notes?: string | null;
}) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("project_budget_items")
    .insert({
      project_id: input.projectId,
      category: input.category,
      description: input.description ?? null,
      planned_amount: input.plannedAmount ?? null,
      actual_amount: input.actualAmount ?? null,
      notes: input.notes ?? null,
      created_by: userData.user?.id ?? null,
    } as never)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBudgetItem(
  itemId: Uuid,
  patch: Partial<{ category: string; description: string | null; plannedAmount: number | null; actualAmount: number | null; notes: string | null }>,
) {
  const dbPatch: Record<string, unknown> = {};
  if (patch.category !== undefined) dbPatch.category = patch.category;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.plannedAmount !== undefined) dbPatch.planned_amount = patch.plannedAmount;
  if (patch.actualAmount !== undefined) dbPatch.actual_amount = patch.actualAmount;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  const { error } = await supabase.from("project_budget_items").update(dbPatch as never).eq("id", itemId);
  if (error) throw error;
}

export async function deleteBudgetItem(itemId: Uuid) {
  const { error } = await supabase.from("project_budget_items").delete().eq("id", itemId);
  if (error) throw error;
}
