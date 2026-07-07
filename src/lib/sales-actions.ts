import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Uuid = string;
export type QuotationStatus = Database["public"]["Enums"]["quotation_status"];
export type BoqStatus = Database["public"]["Enums"]["boq_status"];

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function audit(
  action: string,
  entityType: string,
  entityId: Uuid,
  before?: unknown,
  after?: unknown,
) {
  const actor = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: actor,
    actor_type: "user",
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_value: (before ?? null) as never,
    after_value: (after ?? null) as never,
  });
}

/* ---------------- Quotations ---------------- */

export async function createQuotation(input: {
  opportunityId: Uuid;
  quoteNumber: string;
  value?: number | null;
  issuedDate?: string | null;
  validUntil?: string | null;
  boqId?: Uuid | null;
  notes?: string;
}) {
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from("quotations")
    .insert({
      related_opportunity_id: input.opportunityId,
      quote_number: input.quoteNumber,
      value: input.value ?? null,
      issued_date: input.issuedDate ?? null,
      valid_until: input.validUntil ?? null,
      boq_id: input.boqId ?? null,
      notes: input.notes ?? null,
      status: "draft",
      owner_id: created_by,
      created_by,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("quotation.created", "quotation", data.id, null, data);
  return data;
}

// Won/Lost require a reason — a Sales OS rule: no closed deal without a written reason.
export async function updateQuotationStatus(input: {
  quotationId: Uuid;
  opportunityId: Uuid;
  status: QuotationStatus;
  reason?: string;
}) {
  if ((input.status === "won" || input.status === "lost") && !input.reason) {
    throw new Error("A win/loss reason is required to close a quotation.");
  }
  const { data: before } = await supabase
    .from("quotations")
    .select("status")
    .eq("id", input.quotationId)
    .maybeSingle();
  const { data, error } = await supabase
    .from("quotations")
    .update({
      status: input.status,
      win_loss_reason: input.reason ?? undefined,
      last_follow_up_at:
        input.status === "follow_up" ? new Date().toISOString() : undefined,
    })
    .eq("id", input.quotationId)
    .select()
    .single();
  if (error) throw error;
  await audit(
    "quotation.status_changed",
    "quotation",
    input.quotationId,
    before ? { status: before.status } : null,
    { status: input.status, reason: input.reason ?? null },
  );

  // Keep the opportunity stage in sync with commercial reality.
  const stageMap: Partial<Record<QuotationStatus, Database["public"]["Enums"]["opportunity_stage"]>> = {
    submitted: "follow_up",
    won: "won",
    lost: "lost",
  };
  const nextStage = stageMap[input.status];
  if (nextStage) {
    await supabase
      .from("opportunities")
      .update({ stage: nextStage })
      .eq("id", input.opportunityId);
    await audit("opportunity.stage_changed", "opportunity", input.opportunityId, null, {
      stage: nextStage,
      notes: `Auto-synced from quotation ${input.status}`,
    });
  }
  return data;
}

export async function reviseQuotation(input: {
  quotationId: Uuid;
  opportunityId: Uuid;
  newValue?: number | null;
  notes?: string;
}) {
  const { data: prev, error: prevErr } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", input.quotationId)
    .single();
  if (prevErr) throw prevErr;
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from("quotations")
    .insert({
      related_opportunity_id: prev.related_opportunity_id,
      quote_number: prev.quote_number,
      version: prev.version + 1,
      value: input.newValue ?? prev.value,
      boq_id: prev.boq_id,
      valid_until: prev.valid_until,
      notes: input.notes ?? null,
      status: "draft",
      owner_id: prev.owner_id,
      created_by,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase
    .from("quotations")
    .update({ status: "revised" })
    .eq("id", input.quotationId);
  await audit("quotation.revised", "quotation", data.id, { version: prev.version }, data);
  return data;
}

/* ---------------- BOQs ---------------- */

export async function createBoq(input: {
  opportunityId: Uuid;
  title: string;
  status: BoqStatus;
  source?: string;
  sourceConfidence?: "high" | "medium" | "low";
  assumptions?: string;
  missingItems?: string;
  estimatedValue?: number | null;
  notes?: string;
}) {
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from("boqs")
    .insert({
      related_opportunity_id: input.opportunityId,
      title: input.title,
      status: input.status,
      source: input.source ?? null,
      source_confidence: input.sourceConfidence ?? "low",
      assumptions: input.assumptions ?? null,
      missing_items: input.missingItems ?? null,
      estimated_value: input.estimatedValue ?? null,
      notes: input.notes ?? null,
      created_by,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("boq.created", "boq", data.id, null, data);
  return data;
}

export async function updateBoqStatus(input: {
  boqId: Uuid;
  status: BoqStatus;
  notes?: string;
}) {
  const { data: before } = await supabase
    .from("boqs")
    .select("status")
    .eq("id", input.boqId)
    .maybeSingle();
  const { data, error } = await supabase
    .from("boqs")
    .update({ status: input.status, notes: input.notes ?? undefined })
    .eq("id", input.boqId)
    .select()
    .single();
  if (error) throw error;
  await audit(
    "boq.status_changed",
    "boq",
    input.boqId,
    before ? { status: before.status } : null,
    { status: input.status },
  );
  return data;
}

export async function addBoqItem(input: {
  boqId: Uuid;
  signType: string;
  size?: string;
  material?: string;
  quantity?: number | null;
  location?: string;
  unitRate?: number | null;
  sellingPrice?: number | null;
}) {
  const { data, error } = await supabase
    .from("boq_items")
    .insert({
      boq_id: input.boqId,
      sign_type: input.signType,
      size: input.size ?? null,
      material: input.material ?? null,
      quantity: input.quantity ?? null,
      location: input.location ?? null,
      unit_rate: input.unitRate ?? null,
      selling_price: input.sellingPrice ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("boq.item_added", "boq", input.boqId, null, data);
  return data;
}

/* ---------------- Sales Targets ---------------- */

export async function upsertSalesTarget(input: {
  userId: Uuid;
  periodType: "monthly" | "quarterly";
  periodStart: string; // YYYY-MM-DD (first day of period)
  salesTarget: number;
  pipelineTarget: number;
  quotationTarget: number;
  activityTarget: number;
  reactivationTarget?: number;
  notes?: string;
}) {
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from("sales_targets")
    .upsert(
      {
        user_id: input.userId,
        period_type: input.periodType,
        period_start: input.periodStart,
        sales_target: input.salesTarget,
        pipeline_target: input.pipelineTarget,
        quotation_target: input.quotationTarget,
        activity_target: input.activityTarget,
        reactivation_target: input.reactivationTarget ?? 0,
        notes: input.notes ?? null,
        created_by,
      },
      { onConflict: "user_id,period_type,period_start" },
    )
    .select()
    .single();
  if (error) throw error;
  await audit("sales_target.set", "sales_target", data.id, null, data);
  return data;
}
