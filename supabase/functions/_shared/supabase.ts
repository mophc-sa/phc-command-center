import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// Client scoped to the calling user's JWT — RLS applies. Used to resolve the
// caller's identity.
export function userClient(authHeader: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

// Service-role client — bypasses RLS. Only used AFTER the function has done its
// own authorization check in code. This is the backend's privileged actor.
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export type AppRole =
  | "ceo"
  | "sales_manager"
  | "bd_manager"
  | "salesperson"
  | "viewer";

// Resolve the caller: their user id and roles. Throws a 401-style error object
// if the JWT is missing or invalid.
export async function resolveCaller(
  authHeader: string | null,
): Promise<{ userId: string; roles: AppRole[] }> {
  if (!authHeader) throw { status: 401, message: "Missing Authorization header" };
  const uc = userClient(authHeader);
  const { data: userData, error } = await uc.auth.getUser();
  if (error || !userData.user) throw { status: 401, message: "Not authenticated" };
  const svc = serviceClient();
  const { data: roleRows } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  const roles = (roleRows ?? []).map((r: { role: AppRole }) => r.role);
  return { userId: userData.user.id, roles };
}

export function hasAny(roles: AppRole[], allowed: AppRole[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

// Append an audit row using the service client (matches the app's convention:
// every sensitive mutation writes to audit_log).
export async function audit(
  svc: SupabaseClient,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  after?: unknown,
) {
  await svc.from("audit_log").insert({
    actor_id: actorId,
    actor_type: "user",
    action,
    entity_type: entityType,
    entity_id: entityId,
    after_value: (after ?? null) as never,
  });
}
