// src/lib/approvals-loader.ts
// =============================================================================
// The BAFO half of the approvals read, shared by the approvals page and the
// manager's "Approve" card so the two never drift. approvals-center.ts stays
// pure (no Supabase client); the fetch lives here.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import { fromBafo, type BafoRowIn, type UnifiedApproval } from "@/lib/approvals-center";

const BAFO_LIMIT = 200;

/**
 * Newest BAFO requests with their project names, mapped to the unified shape.
 * Returns the raw rows too: the approvals page needs them to resolve which
 * step is live.
 *
 * `pendingOnly` drops finished requests in SQL, so a pending request is never
 * pushed out of the window by more than BAFO_LIMIT historical ones.
 * bafo_requests.status is CHECK (pending | approved | rejected), kept in sync
 * with the four step columns by protect_bafo_step_transitions().
 */
export async function fetchBafoApprovals(
  opts: { pendingOnly?: boolean } = {},
): Promise<{ rows: BafoRowIn[]; list: UnifiedApproval[] }> {
  const base = supabase.from("bafo_requests").select("*");
  const filtered = opts.pendingOnly ? base.not("status", "in", "(approved,rejected)") : base;
  const { data, error } = await filtered.order("created_at", { ascending: false }).limit(BAFO_LIMIT);
  if (error) throw error;

  const rows = (data ?? []) as unknown as BafoRowIn[];
  // One lookup for the project names the rows point at.
  const oppIds = [...new Set(rows.map((b) => b.opportunity_id).filter(Boolean) as string[])];
  const names = new Map<string, string | null>();
  if (oppIds.length) {
    // Names are a label, not the data: if this lookup fails the rows still show,
    // with the label falling back. Only the bafo_requests read above is fatal.
    const { data: opps, error: oppError } = await supabase.from("opportunities").select("id, project_name").in("id", oppIds);
    if (!oppError) for (const o of opps ?? []) names.set(o.id, o.project_name);
  }

  return { rows, list: rows.map((b) => fromBafo(b, b.opportunity_id ? names.get(b.opportunity_id) : null)) };
}
