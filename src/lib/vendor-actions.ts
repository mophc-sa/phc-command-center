import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Uuid = string;

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function audit(action: string, entityType: string, entityId: Uuid, after?: unknown) {
  const actor = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: actor,
    actor_type: "user",
    action,
    entity_type: entityType,
    entity_id: entityId,
    after_value: (after ?? null) as never,
  });
}

/* ---------------- Vendors (managers only — enforced by RLS) ---------------- */

export async function createVendor(patch: Database["public"]["Tables"]["vendors"]["Insert"]) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("vendors")
    .insert({ ...patch, created_by: uid })
    .select()
    .single();
  if (error) throw error;
  await audit("vendor.created", "vendor", data.id, data);
  return data;
}

export async function updateVendor(id: Uuid, patch: Database["public"]["Tables"]["vendors"]["Update"]) {
  const { data, error } = await supabase.from("vendors").update(patch).eq("id", id).select().single();
  if (error) throw error;
  await audit("vendor.updated", "vendor", id, patch);
  return data;
}

/* ---------------- Reference Projects ---------------- */

export async function createReferenceProject(
  patch: Database["public"]["Tables"]["reference_projects"]["Insert"],
) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("reference_projects")
    .insert({ ...patch, created_by: uid })
    .select()
    .single();
  if (error) throw error;
  await audit("reference_project.created", "reference_project", data.id, data);
  return data;
}
