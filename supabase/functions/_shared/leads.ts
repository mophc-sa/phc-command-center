// =============================================================================
// Server-side lead creation — single source of truth for both the Data Import
// Pipeline (import-pipeline's commit_candidates) and the Protenders auto-lead
// path (sales-os-api's run_protenders_ingest). Both used to write directly to
// `leads` with a raw insert, skipping two guarantees the browser's
// createLead() (src/lib/lead-actions.ts) always provides: an explicit
// lead_stage, and a 'lead.created' audit_log row. This module restores parity.
// =============================================================================

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { audit } from "./supabase.ts";
import type { AppRole } from "./roles.ts";

// Same role composition as _shared/roles.ts's canManageSalesPipeline
// (executive + sales_manager + bd_manager/sales_ops) — kept as its own
// array here because roles.ts does not currently export that array directly,
// only the canManageSalesPipeline(roles) predicate built from it.
export const CAN_CREATE_LEAD_ROLES: AppRole[] = [
  "managing_director", "general_manager", "ceo",
  "sales_manager",
  "bd_manager", "sales_ops",
];

export interface Lead {
  id: string;
  project_name: string;
  source: string;
  source_url: string | null;
  location: string | null;
  main_contractor_guess: string | null;
  lead_stage: string;
  owner_id: string | null;
  created_by: string | null;
}

export interface LeadInsertPayload {
  project_name: string;
  source_url?: string | null;
  location?: string | null;
  main_contractor_guess?: string | null;
  estimated_value?: number | null;
  owner_id?: string | null;
}

// sales-os-api's handlers exclusively use boolean predicate functions
// (canManageSalesPipeline, canApproveCommercialAction, etc. from
// _shared/roles.ts) — never hasAny(roles, array) directly, confirmed by
// reading every handler in supabase/functions/sales-os-api/handlers/.
// Export a predicate here too, matching that convention, so Task 1's
// automation.ts call site swaps one predicate call for another rather than
// introducing hasAny into a file that has never used it.
export function canCreateLead(roles: AppRole[] | undefined | null): boolean {
  return !!roles && roles.some((r) => CAN_CREATE_LEAD_ROLES.includes(r));
}

// Mirrors src/lib/lead-actions.ts's createLead(): explicit lead_stage,
// created_by = actor, then a 'lead.created' audit row via the same shared
// audit() both edge functions already use for their other audit calls.
// No role check here — callers already gate entry with CAN_CREATE_LEAD_ROLES
// (or an equal-or-narrower existing check); this is a pure write helper.
export async function insertLeadServerSide(
  svc: SupabaseClient,
  payload: LeadInsertPayload,
  actorId: string,
  source: "import" | "protenders_ingest",
  roles?: AppRole[],
): Promise<Lead> {
  const { data, error } = await svc
    .from("leads")
    .insert({
      project_name: payload.project_name,
      source,
      source_url: payload.source_url ?? null,
      location: payload.location ?? null,
      main_contractor_guess: payload.main_contractor_guess ?? null,
      estimated_value: payload.estimated_value ?? null,
      lead_stage: "detected",
      owner_id: payload.owner_id ?? null,
      created_by: actorId,
    })
    .select()
    .single();
  if (error) throw error;

  await audit(svc, actorId, "lead.created", "lead", data.id, data, roles);

  return data as Lead;
}
