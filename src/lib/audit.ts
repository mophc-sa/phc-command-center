import { supabase } from "@/integrations/supabase/client";

/**
 * Append one row to the audit log.
 *
 * This same twelve-line function is currently redefined privately in eight
 * modules under src/lib. Phase 6 does not refactor those — rewriting eight
 * working call sites to prove a point is not worth the regression risk — but it
 * does not add a ninth copy either. New code imports this one.
 *
 * Failures are logged and returned, never thrown: an audit write that fails
 * must not roll back the action it was describing. A missing audit row is a
 * gap in the record; a thrown error here would be a lost upload.
 */
export async function audit(
  action: string,
  entityType: string,
  entityId: string | null,
  after?: unknown,
  before?: unknown,
) {
  const { data } = await supabase.auth.getUser();
  const { error } = await supabase.from("audit_log").insert({
    actor_id: data.user?.id ?? null,
    actor_type: "user",
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_value: (before ?? null) as never,
    after_value: (after ?? null) as never,
  });
  if (error) console.error(`audit(${action}) failed:`, error.message);
  return { error };
}
