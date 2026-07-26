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
  name: "recent_agent_runs",
  title: "Recent agent runs",
  description: "Return the most recent agent runs (loop/agent activity) for the signed-in user.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("ai_agent_runs")
      .select(
        "id, agent_key, status, started_at, completed_at, records_scanned, recommendations_created, summary",
      )
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error)
      return { content: [{ type: "text", text: "Unable to list agent runs" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { runs: data ?? [] },
    };
  },
});
