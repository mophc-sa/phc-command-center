import { CANONICAL_STAGES } from "../../stage-canonical";
import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_opportunities",
  title: "List opportunities",
  description: "List opportunities visible to the signed-in user (RLS applies).",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("Max rows to return."),
    sales_stage: z.enum(CANONICAL_STAGES).optional().describe("Optional commercial sales stage."),
    status: z.enum(CANONICAL_STAGES).optional().describe("Legacy alias for sales_stage."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status, sales_stage }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("opportunities")
      .select(
        "id, project_name, client, stage, sales_stage, tier, owner_id, next_action, next_action_due, estimated_value_min, estimated_value_max, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status && sales_stage && status !== sales_stage) return { content: [{ type: "text", text: "Conflicting stage filters" }], isError: true };
    const stage = sales_stage ?? status;
    if (stage) q = q.eq("sales_stage", stage);
    const { data, error } = await q;
    if (error)
      return { content: [{ type: "text", text: "Unable to list opportunities" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { opportunities: data ?? [] },
    };
  },
});
