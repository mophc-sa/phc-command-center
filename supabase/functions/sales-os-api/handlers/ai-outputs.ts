import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err, canReviewAiOutput } from "../shared.ts";

const VALID_DECISIONS = new Set(["accepted", "rejected"]);

// Records a human decision on an ai_agent_outputs row. Pure audit trail —
// no side effect on any other table. Accept/reject only, and only once:
// the .eq("status", "pending_review") guard means a second call on an
// already-decided row updates 0 rows, which this treats as a 404 rather
// than silently overwriting a prior reviewer's decision.
async function review_ai_agent_output(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canReviewAiOutput(caller.roles)) {
    return err("AI output review authority required", 403);
  }
  const outputId = String(payload.outputId ?? "");
  const decision = String(payload.decision ?? "");
  if (!outputId) return err("outputId is required");
  if (!VALID_DECISIONS.has(decision)) return err("decision must be 'accepted' or 'rejected'");

  const svc = ctx.svc;
  const nowIso = new Date().toISOString();
  const { data, error } = await svc
    .from("ai_agent_outputs")
    .update({
      status: decision,
      reviewed_by: caller.userId,
      reviewed_at: nowIso,
      review_decision: decision,
    })
    .eq("id", outputId)
    .eq("status", "pending_review")
    .select()
    .single();

  if (error || !data) {
    return err("Output not found, or already reviewed by someone else", 404);
  }

  await auditLog(
    svc,
    caller.userId,
    "ai_output.reviewed",
    "ai_agent_output",
    outputId,
    { agent_key: data.agent_key, decision },
    caller.roles,
  );

  return json({ ok: true, output: data });
}

export const aiOutputsModule: HandlerModule = {
  name: "ai-outputs",
  handlers: {
    review_ai_agent_output,
  },
};
