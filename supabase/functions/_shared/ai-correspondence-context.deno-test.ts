// =============================================================================
// deal_correspondence_summary context: which emails the AI sees, in what order,
// and that it always fits the orchestrator's context budget.
// =============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_REGISTRY, loadDealCorrespondenceContext } from "./ai-agent-registry.ts";
import { MAX_CONTEXT_CHARS } from "./ai-guardrails.ts";

type Row = Record<string, unknown>;

function fakeDb(opp: Row | null, activities: Row[]) {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = () => ({ throwOnError: () => Promise.resolve({ data: result }) });
    c.throwOnError = () => Promise.resolve({ data: result });
    return c;
  };
  return { from: (t: string) => chain(t === "opportunities" ? opp : activities) };
}

const OPP = { id: "opp", project_name: "Riyadh Mall wayfinding", client: "Client Co", sales_stage: "jih", stage: null };
const email = (i: number, over: Row = {}): Row => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  activity_type: "email_received",
  status: "logged",
  occurred_at: `2026-09-${String(10 + i).padStart(2, "0")}T08:00:00Z`,
  summary: `Subject ${i}`,
  draft_content: "Please send the revised BOQ. ".repeat(40),
  email_from: "buyer@client.com",
  ...over,
});

Deno.test("the agent is registered for opportunities only, with its own reader check", () => {
  const a = AGENT_REGISTRY.deal_correspondence_summary;
  assertEquals(a.allowedEntityTypes, ["opportunities"]);
  assertEquals(a.outputType, "recommendation");
  assert(a.maxContextRecords >= 16);
});

Deno.test("unsent drafts are not correspondence; the rest is oldest first", async () => {
  // Rows arrive newest first, as the query orders them.
  const rows = [email(3), email(2, { activity_type: "email_draft", status: "draft" }), email(1, { activity_type: "email_draft", status: "sent" })];
  const r = await loadDealCorrespondenceContext(fakeDb(OPP, rows) as never, "opportunities", "opp", { language: "ar" });
  assert(r.ok);
  if (!r.ok) return;
  const ctx = JSON.parse(r.contextText);
  assertEquals(ctx.language, "ar");
  assertEquals(ctx.emails.map((e: Row) => e.subject), ["Subject 1", "Subject 3"]);
  assertEquals(ctx.emails.map((e: Row) => e.direction), ["phc_to_client", "client_to_phc"]);
  assertEquals(r.recordCount, 3);
});

Deno.test("a deal with no email is refused rather than summarised from nothing", async () => {
  const r = await loadDealCorrespondenceContext(fakeDb(OPP, []) as never, "opportunities", "opp", {});
  assertEquals(r.ok, false);
});

Deno.test("fifteen long emails still fit the context budget", async () => {
  const rows = Array.from({ length: 15 }, (_, i) => email(15 - i, { draft_content: "x ".repeat(5000), summary: "S".repeat(300) }));
  const r = await loadDealCorrespondenceContext(fakeDb(OPP, rows) as never, "opportunities", "opp", {});
  assert(r.ok);
  if (!r.ok) return;
  assert(r.contextText.length <= MAX_CONTEXT_CHARS, `context ${r.contextText.length} chars`);
  assert(r.recordCount <= AGENT_REGISTRY.deal_correspondence_summary.maxContextRecords);
});
