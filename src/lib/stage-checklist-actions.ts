// =============================================================================
// Stage checklist on a deal: the manual items a rep ticks (set_checklist_item)
// and the buyer type. Auto items are computed from data in the panel.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { BuyerType } from "@/lib/stage-checklist";

export type ChecklistRow = { item_key: string; done: boolean; note: string | null; done_at: string | null };

export async function listChecklist(opportunityId: string): Promise<ChecklistRow[]> {
  const { data, error } = await supabase
    .from("opportunity_checklist" as never)
    .select("item_key, done, note, done_at")
    .eq("opportunity_id", opportunityId);
  if (error) throw error;
  return (data ?? []) as unknown as ChecklistRow[];
}

export async function setChecklistItem(opportunityId: string, itemKey: string, done: boolean, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc("set_checklist_item" as never, {
    _opportunity_id: opportunityId, _item_key: itemKey, _done: done, _note: note ?? null,
  } as never);
  if (error) throw error;
}

export async function setBuyerType(opportunityId: string, buyerType: BuyerType | null): Promise<void> {
  const { error } = await supabase.from("opportunities").update({ buyer_type: buyerType } as never).eq("id", opportunityId);
  if (error) throw error;
}

/** The facts the panel needs beyond the opportunity row and its stakeholders. */
export async function loadChecklistFacts(opportunityId: string, companyId: string | null) {
  const [q, b, c] = await Promise.all([
    supabase.from("quotations").select("id", { count: "exact", head: true }).eq("related_opportunity_id", opportunityId),
    supabase.from("boqs").select("id").eq("related_opportunity_id", opportunityId),
    companyId
      ? supabase.from("companies").select("prequalification_status" as never).eq("id", companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (q.error) throw q.error;
  if (b.error) throw b.error;
  if (c.error) throw c.error;
  const boqIds = (b.data ?? []).map((x) => x.id);
  let boqItemCount = 0;
  if (boqIds.length) {
    const { count, error } = await supabase.from("boq_items").select("id", { count: "exact", head: true }).in("boq_id", boqIds);
    if (error) throw error;
    boqItemCount = count ?? 0;
  }
  return {
    quotation_count: q.count ?? 0,
    boq_item_count: boqItemCount,
    prequalification_status: ((c.data as { prequalification_status?: string } | null)?.prequalification_status) ?? null,
  };
}
