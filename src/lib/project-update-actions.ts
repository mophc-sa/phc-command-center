// The update log inside each project (manager feedback group 4).
// Table: opportunity_updates (20261022100000). RLS lets the deal's people read
// and post; posting a % or a site stage also moves the deal's construction
// progress or stage, which the database does in a trigger so the two can never
// disagree.
import { supabase } from "@/integrations/supabase/client";
import type { SiteStage, UpdateKind } from "@/lib/project-tracking";

export type ProjectUpdate = {
  id: string;
  opportunity_id: string;
  kind: UpdateKind;
  note: string | null;
  completion_pct: number | null;
  project_stage: SiteStage | null;
  created_by: string | null;
  created_at: string;
  author: { full_name: string | null; email: string | null; sales_code: string | null } | null;
};

export async function listProjectUpdates(opportunityId: string): Promise<ProjectUpdate[]> {
  const { data, error } = await supabase
    .from("opportunity_updates")
    .select("id, opportunity_id, kind, note, completion_pct, project_stage, created_by, created_at")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

  // created_by points at auth.users, which PostgREST cannot embed; the names
  // come from profiles in one extra read.
  const ids = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x))];
  const people = new Map<string, ProjectUpdate["author"]>();
  if (ids.length > 0) {
    const { data: ps } = await supabase.from("profiles").select("id, full_name, email, sales_code").in("id", ids);
    for (const p of ps ?? []) people.set(p.id, { full_name: p.full_name, email: p.email, sales_code: p.sales_code });
  }
  return rows.map((r) => ({
    ...r,
    kind: r.kind as UpdateKind,
    author: r.created_by ? people.get(r.created_by) ?? null : null,
  }));
}

export async function postProjectUpdate(input: {
  opportunityId: string;
  kind: UpdateKind;
  note: string;
  pct: number | null;
  stage: SiteStage | null;
}) {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("opportunity_updates").insert({
    opportunity_id: input.opportunityId,
    kind: input.kind,
    note: input.note.trim() || null,
    completion_pct: input.pct,
    project_stage: input.stage,
    created_by: auth.user?.id ?? null,
  });
  if (error) throw error;
}

export async function deleteProjectUpdate(id: string) {
  const { error, count } = await supabase.from("opportunity_updates").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  // RLS turns a refused delete into "0 rows", not an error.
  if (!count) throw new Error("not_allowed");
}
