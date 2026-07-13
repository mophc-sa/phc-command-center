import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveServiceKey, describeResolveServiceKeyReason } from "./service-key-resolver.ts";

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
//
// The API key itself is resolved by service-key-resolver.ts: it prefers the
// new-format SUPABASE_SECRET_KEYS["default"] (sb_secret_...) and falls back
// to the legacy SUPABASE_SERVICE_ROLE_KEY only when the new variable isn't
// set at all — see that module's header comment for the full precedence
// rationale. ai-orchestrator, sales-os-api, and import-pipeline all resolve
// through this single function; none duplicates the parsing logic.
export function serviceClient(): SupabaseClient {
  const resolved = resolveServiceKey((key) => Deno.env.get(key));
  if (!resolved.ok) {
    // Never include the raw SUPABASE_SECRET_KEYS content or any key value —
    // describeResolveServiceKeyReason() returns a stable, non-secret message.
    throw new Error(`[serviceClient] ${describeResolveServiceKeyReason(resolved.reason)}`);
  }
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    resolved.key,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Canonical role type + capability helpers live in ./roles.ts (mirror of
// src/lib/roles.ts). Re-export so existing importers keep working.
export type { AppRole } from "./roles.ts";
export * from "./roles.ts";
import type { AppRole } from "./roles.ts";

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
// every sensitive mutation writes to audit_log). entity_id is nullable in the
// schema — pass null for system-level actions with no single entity (do not
// pass a non-UUID string literal, it fails the column's uuid type check).
//
// Failures are logged (visible in Supabase function logs) and returned to the
// caller, but never thrown: audit() is called after the real business write
// has already succeeded, so throwing here would surface a false failure to
// the caller and risk it retrying — duplicating the business write — over an
// audit-only problem. Logging (instead of silently swallowing, as before)
// is the safe middle ground: the failure is now visible without being able
// to break or duplicate the action it's auditing.
export async function audit(
  svc: SupabaseClient,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  after?: unknown,
  roles?: string[],
) {
  const { error } = await svc.from("audit_log").insert({
    actor_id: actorId,
    actor_type: "user",
    action,
    entity_type: entityType,
    entity_id: entityId,
    after_value: (after ?? null) as never,
    actor_role_snapshot: roles?.length ? roles : null,
  });
  if (error) {
    console.error(
      `[audit] insert failed — action="${action}" entity_type="${entityType}" entity_id="${entityId ?? "null"}":`,
      error,
    );
  }
  return { error };
}
