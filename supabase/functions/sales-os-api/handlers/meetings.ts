// =============================================================================
// The human decision on a Fireflies meeting action item.
//
// Approving one creates a task for the named owner; dismissing one needs a
// reason. The rules (who may decide, owner must be an active person, replay
// returns the first answer) live in decide_meeting_action_item, which tests
// can_review_meetings(auth.uid()) — so it is called with the caller's own
// session, never the service role. Routing it through sales-os-api keeps the
// MFA gate that resolveCaller applies to reviewer roles.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../shared.ts";

const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

async function meeting_action_decision(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { data, error } = await ctx.asCaller.rpc("decide_meeting_action_item", {
    _id: String(payload.itemId ?? ""),
    _action: String(payload.action ?? ""),
    _title: str(payload.title),
    _owner_id: str(payload.ownerId),
    _due_date: str(payload.dueDate),
    _opportunity_id: str(payload.opportunityId),
    _note: str(payload.note),
  });
  if (error) return err(error.message, error.code === "42501" ? 403 : 409);
  return json(data);
}

export const meetingsModule: HandlerModule = {
  name: "meetings",
  handlers: { meeting_action_decision },
};
