import { supabase } from "@/integrations/supabase/client";

export type AppRole = "ceo" | "sales_manager" | "bd_manager" | "viewer";

export const ALL_ROLES: AppRole[] = ["ceo", "sales_manager", "bd_manager", "viewer"];

export type TeamMember = {
  id: string;
  email: string | null;
  full_name: string | null;
  roles: AppRole[];
};

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function audit(action: string, entityId: string, after: unknown) {
  const actor = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: actor,
    actor_type: "user",
    action,
    entity_type: "user_role",
    entity_id: entityId,
    after_value: after as never,
  });
}

export async function listTeam(): Promise<TeamMember[]> {
  const [{ data: profiles, error: pErr }, { data: rolesRows, error: rErr }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").order("full_name", { ascending: true, nullsFirst: false }),
    supabase.from("user_roles").select("user_id, role"),
  ]);
  if (pErr) throw pErr;
  if (rErr) throw rErr;
  const byUser = new Map<string, AppRole[]>();
  for (const r of rolesRows ?? []) {
    const arr = byUser.get(r.user_id) ?? [];
    arr.push(r.role as AppRole);
    byUser.set(r.user_id, arr);
  }
  return (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    roles: byUser.get(p.id) ?? [],
  }));
}

export async function grantRole(userId: string, role: AppRole) {
  const { data, error } = await supabase
    .from("user_roles")
    .insert({ user_id: userId, role })
    .select()
    .single();
  if (error) throw error;
  await audit("role.granted", userId, { role });
  return data;
}

export async function revokeRole(userId: string, role: AppRole) {
  const { error } = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role", role);
  if (error) throw error;
  await audit("role.revoked", userId, { role });
}
