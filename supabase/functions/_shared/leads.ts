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

// Only project_name is strongly typed (required for the TS signature and the
// "Unknown" fallback pattern both callers use) — every other column is
// forwarded through as-is, matching import-pipeline's "whatever was mapped is
// written as-is" invariant (see import-pipeline/index.ts's header comment).
// Do not add more named optional fields here: it would silently re-narrow
// the allowlist this type was widened to get away from.
export type LeadInsertPayload = { project_name: string } & Record<string, unknown>;

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
  source: "import" | "protenders",
  roles?: AppRole[],
): Promise<Lead> {
  const { data, error } = await svc
    .from("leads")
    .insert({
      // Spread first, then force the fields below — spread order matters so
      // these two always win over anything a mapped/passed payload set.
      ...payload,
      // The entire point of this helper: no mapped/passed value may ever
      // override these two.
      lead_stage: "detected",
      created_by: actorId,
      // source is the one field that's "as-is if provided, else caller's
      // default" rather than always-forced — an explicit mapped source wins,
      // otherwise fall back to the caller's literal ("import" / "protenders",
      // matching this table's pre-existing documented source vocabulary:
      // supabase/migrations/20260707100030_leads.sql:24).
      source: (payload as Record<string, unknown>).source ?? source,
    })
    .select()
    .single();
  if (error) throw error;

  await audit(svc, actorId, "lead.created", "lead", data.id, data, roles);

  return data as Lead;
}
