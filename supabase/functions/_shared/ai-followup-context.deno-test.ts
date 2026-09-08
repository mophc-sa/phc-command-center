import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_REGISTRY } from "./ai-agent-registry.ts";

Deno.test("Follow-up context preserves canonical record status and distinct deadlines", async () => {
  const rows: Record<string, Record<string, unknown>> = {
    opportunities: { id: "opp", project_name: "PHC project", stage: "active", sales_stage: "jih", next_action: "Review submission", next_action_due: "2026-09-03", last_activity_at: null },
    follow_ups: { id: "followup", opportunity_id: "opp", due_date: "2026-09-05", status: "pending", channel: "call", notes: "Submission due 2026-09-03" },
  };
  const db = { from(table: string) {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: (_columns: string) => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      maybeSingle: () => ({ throwOnError: async () => ({ data: Object.entries(filters).every(([key,value]) => rows[table][key] === value) ? rows[table] : null, error: null }) }),
    };
    return chain;
  } };
  const result = await AGENT_REGISTRY.smart_followup_draft.loadContext(db as never, "opportunities", "opp", { channel: "internal_note", language: "ar", follow_up_id: "followup" });
  assert(result.ok);
  const context = JSON.parse(result.contextText);
  assertEquals(context.linked_record.type, "opportunity");
  assertEquals(context.linked_record.status, "jih");
  assertEquals(context.linked_record.next_action_due, "2026-09-03");
  assertEquals(context.follow_up.due_date, "2026-09-05");
  assertEquals(context.language, "ar");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(context.current_date));
});
