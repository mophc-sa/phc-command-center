// meeting_notes_draft context (image 27): refuses an empty request, caps the
// rough notes, and sends only the deal's name, client and stage.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_REGISTRY, loadMeetingNotesDraftContext } from "./ai-agent-registry.ts";
import { MeetingNotesDraftOutputSchema } from "./ai-schemas.ts";

const OPP = { id: "opp", project_name: "Riyadh Mall wayfinding", client: "Client Co", sales_stage: "jih", quotation_value: 999 };
function fakeDb(opp: Record<string, unknown> | null) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) c[m] = () => c;
  c.maybeSingle = () => ({ throwOnError: () => Promise.resolve({ data: opp }) });
  return { from: () => c };
}
// deno-lint-ignore no-explicit-any
const run = (opp: Record<string, unknown> | null, input: Record<string, unknown>) => loadMeetingNotesDraftContext(fakeDb(opp) as any, "opportunities", "opp", input);

Deno.test("registered on opportunities as a draft", () => {
  const a = AGENT_REGISTRY.meeting_notes_draft;
  assertEquals(a.allowedEntityTypes, ["opportunities"]);
  assertEquals(a.outputType, "draft");
});

Deno.test("no rough notes, no call", async () => {
  const r = await run(OPP, { rough_notes: "   " });
  assertEquals(r.ok, false);
});

Deno.test("rough notes are capped and money never leaves", async () => {
  const r = await run(OPP, { rough_notes: "x".repeat(10_000), attendees: "Omar, client PM" });
  assert(r.ok);
  if (!r.ok) return;
  const ctx = JSON.parse(r.contextText);
  assertEquals(ctx.rough_notes.length, 4000);
  assertEquals(ctx.deal, { project: "Riyadh Mall wayfinding", client: "Client Co", stage: "jih" });
  assert(!r.contextText.includes("999"));
});

Deno.test("output must be notes + decisions + actions, nothing else", () => {
  assert(MeetingNotesDraftOutputSchema.safeParse({ notes: "n", decisions: [], actions: ["a"], confidence: 0.6 }).success);
  assert(!MeetingNotesDraftOutputSchema.safeParse({ notes: "n", decisions: [], actions: [], confidence: 0.6, send_email: true }).success);
});
