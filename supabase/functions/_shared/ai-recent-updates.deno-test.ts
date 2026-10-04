// =============================================================================
// smart_followup_draft with recent_updates: the deal's latest happenings, newest
// first, unsent drafts left out, and the deal's readers (not only its owner).
// =============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_REGISTRY, loadDealRecentUpdates, RECENT_UPDATES_MAX } from "./ai-agent-registry.ts";

type Row = Record<string, unknown>;
const OPP = "22222222-2222-2222-2222-222222222222";

function fakeDb(tables: Record<string, Row[]>) {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) c[m] = () => c;
    c.throwOnError = () => Promise.resolve({ data: tables[table] ?? [] });
    return c;
  };
  return { from: chain };
}

Deno.test("newest first, stage changes mixed in, unsent drafts are not events", async () => {
  const r = await loadDealRecentUpdates(fakeDb({
    activities: [
      { activity_type: "email_received", status: "logged", occurred_at: "2026-10-03T09:00:00Z", summary: "Re: price", draft_content: "Please revise the price." },
      { activity_type: "email_draft", status: "draft", occurred_at: "2026-10-04T09:00:00Z", summary: "unsent", draft_content: null },
      { activity_type: "email_draft", status: "sent", occurred_at: "2026-10-01T09:00:00Z", summary: "Quotation sent", draft_content: null },
    ],
    stage_transition_history: [{ from_stage: "qualified", to_stage: "quotation_sent", notes: null, created_at: "2026-10-02T08:00:00Z" }],
    quotations: [{ quote_number: "Q-104", status: "sent", value: 120000, currency: "SAR", issued_date: "2026-10-01", valid_until: "2026-10-31", created_at: "2026-10-01T08:00:00Z" }],
    commitments: [{ description: "Send revised price", direction: "we_owe_client", due_date: "2026-10-06" }],
  }) as never, OPP);
  assertEquals(r.events.map((e) => e.kind), ["email_from_client", "stage_change", "email_to_client"]);
  assert(r.events[0].text.includes("revise the price"));
  assertEquals(r.quotation?.number, "Q-104");
  assertEquals(r.commitments, [{ who: "PHC owes the client", what: "Send revised price", due: "2026-10-06" }]);
});

Deno.test("a quiet deal has no events and no quotation", async () => {
  const r = await loadDealRecentUpdates(fakeDb({}) as never, OPP);
  assertEquals(r, { events: [], quotation: null, commitments: [] });
});

Deno.test("never more than the cap, and the whole context fits the agent's record budget", async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    activity_type: "call", status: "logged", occurred_at: `2026-09-${String(10 + i).padStart(2, "0")}T09:00:00Z`, summary: "x ".repeat(500), draft_content: null,
  }));
  const r = await loadDealRecentUpdates(fakeDb({ activities: many, commitments: Array(5).fill({ description: "d", direction: "client_owes_us", due_date: null }) }) as never, OPP);
  assertEquals(r.events.length, RECENT_UPDATES_MAX);
  assert(r.events.every((e) => e.text.length <= 350));
  assert(1 + r.events.length + 1 + r.commitments.length <= AGENT_REGISTRY.smart_followup_draft.maxContextRecords);
});
