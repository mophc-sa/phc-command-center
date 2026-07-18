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
  name: "list_recommendations",
  title: "List AI recommendations",
  description:
    "List AI recommendations visible to the signed-in user (RLS applies). Optionally filter by status (pending, accepted, dismissed, actioned).",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("Max rows to return."),
    status: z.string().optional().describe("Optional status filter."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("recommendations")
      .select(
        "id, agent_module, confidence_score, recommendation, reason, status, related_company_id, related_lead_id, related_opportunity_id, required_approval_type, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error)
      return { content: [{ type: "text", text: "Unable to list recommendations" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { recommendations: data ?? [] },
    };
  },
});
