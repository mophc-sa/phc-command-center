// =============================================================================
// daily_email_brief context: only the person's own email, open deals first,
// each email once, and always inside the context budget.
// =============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_REGISTRY, loadDailyEmailBriefContext } from "./ai-agent-registry.ts";
import { MAX_CONTEXT_CHARS } from "./ai-guardrails.ts";

type Row = Record<string, unknown>;
const U = "11111111-1111-1111-1111-111111111111";

// Tables answer in the order the loader asks: last brief, deals, mine, on-deals.
function fakeDb(tables: { outputs: Row | null; deals: Row[]; mine: Row[]; onDeals: Row[] }) {
  const queue: Record<string, unknown[]> = {
    ai_agent_outputs: [tables.outputs],
    opportunities: [tables.deals],
    activities: [tables.mine, tables.onDeals],
  };
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) c[m] = () => c;
    const next = () => Promise.resolve({ data: queue[table].length ? queue[table].shift() : [] });
    c.maybeSingle = () => ({ throwOnError: next });
    c.throwOnError = next;
    return c;
  };
  return { from: chain };
}

const mail = (id: string, over: Row = {}): Row => ({
  id, activity_type: "email_received", status: "logged",
  created_at: "2026-09-30T06:00:00Z", occurred_at: "2026-09-30T06:00:00Z",
  summary: `Subject ${id}`, draft_content: "Please send the revised price.", email_from: "buyer@client.com",
  related_opportunity_id: null, ...over,
});
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const DEALS = [
  { id: "open-deal", project_name: "Sidra 1B", sales_stage: "under_negotiation", stage: null },
  { id: "won-deal", project_name: "Old Mall", sales_stage: "won", stage: null },
];

Deno.test("a brief is only ever for the caller's own email", async () => {
  const a = AGENT_REGISTRY.daily_email_brief;
  assertEquals(a.allowedEntityTypes, ["my_email"]);
  assertEquals((await a.checkAccess({} as never, "my_email", U, U, [])).ok, true);
  assertEquals((await a.checkAccess({} as never, "my_email", "someone-else", U, [])).ok, false);
});

Deno.test("open-deal email comes first, sent drafts are not email, each email once", async () => {
  const onOpen = mail(id(1), { related_opportunity_id: "open-deal", occurred_at: "2026-09-29T06:00:00Z" });
  const onWon = mail(id(2), { related_opportunity_id: "won-deal" });
  const loose = mail(id(3));
  const draft = mail(id(4), { activity_type: "email_draft", status: "draft" });
  const r = await loadDailyEmailBriefContext(
    fakeDb({ outputs: null, deals: DEALS, mine: [loose, draft, onOpen], onDeals: [onOpen, onWon] }) as never,
    "my_email", U, { language: "ar" },
  );
  assert(r.ok);
  if (!r.ok) return;
  const ctx = JSON.parse(r.contextText);
  assertEquals(ctx.language, "ar");
  assertEquals(ctx.emails.map((e: Row) => e.id), [id(1), id(3), id(2)]);
  assertEquals(ctx.emails[0].deal, { name: "Sidra 1B", stage: "under_negotiation", open: true });
  assertEquals(r.recordCount, 3);
});

Deno.test("no new client email means no AI call", async () => {
  const r = await loadDailyEmailBriefContext(fakeDb({ outputs: null, deals: [], mine: [], onDeals: [] }) as never, "my_email", U, {});
  assertEquals(r.ok, false);
});

Deno.test("many long emails are cut to 25 and fit the budget", async () => {
  const many = Array.from({ length: 60 }, (_, i) => mail(id(100 + i), { draft_content: "x ".repeat(3000), summary: "S".repeat(300) }));
  const r = await loadDailyEmailBriefContext(fakeDb({ outputs: null, deals: [], mine: many, onDeals: [] }) as never, "my_email", U, {});
  assert(r.ok);
  if (!r.ok) return;
  assert(r.contextText.length <= MAX_CONTEXT_CHARS, `context ${r.contextText.length}`);
  assert(r.recordCount <= 25 && r.recordCount <= AGENT_REGISTRY.daily_email_brief.maxContextRecords);
});
