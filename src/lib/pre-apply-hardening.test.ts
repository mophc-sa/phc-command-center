// =============================================================================
// Final pre-apply hardening.
//
// Two correctness defects, both of the same species: a number that looks right
// and is not. One answered "who decides" two different ways; the other computed
// authoritative totals over the first 200 rows of an arbitrarily large book.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows, allComplete, PAGE_SIZE, MAX_ROWS } from "@/lib/fetch-all";
import { decisionMakerState, type StakeholderRow } from "@/lib/stakeholder-roles";
import { buildAttention, dataQuality, type AttentionOpp } from "@/lib/attention";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const TODAY = "2026-08-26";
const opp = (o: Partial<AttentionOpp> & { id: string }): AttentionOpp => ({
  sales_stage: "jih",
  project_name: o.id,
  next_action: "Call",
  next_action_due: "2026-12-01",
  human_win_probability: 50,
  owner_id: "u1",
  client: "ICAD",
  quotation_value: 1_000_000,
  ...o,
});
const sh = (o: Partial<StakeholderRow> & { id: string }): StakeholderRow => ({ ...o });

/** The one question, asked through every consumer that answers it. */
function everyConsumerAgrees(
  stakeholders: StakeholderRow[],
  contractorDecisionMaker: string | null,
): { helper: string; flaggedByAttention: boolean; flaggedByDataQuality: boolean } {
  const o = opp({ id: "x", contractor_decision_maker: contractorDecisionMaker });
  const map = new Map([["x", stakeholders]]);
  const items = buildAttention({
    opportunities: [o],
    stakeholdersByOpp: map,
    activities: [{ id: "m", opportunity_id: "x", activity_type: "meeting", status: "logged", created_at: TODAY }],
    today: TODAY,
  });
  const dq = dataQuality(items, 1);
  return {
    helper: decisionMakerState(stakeholders, contractorDecisionMaker),
    flaggedByAttention: items.some((i) => i.reasons.some((r) => r.kind === "no_decision_maker")),
    flaggedByDataQuality: dq.issues.some((i) => i.kind === "no_decision_maker"),
  };
}

describe("who decides is answered in exactly one place", () => {
  it("a stakeholder holding the role satisfies EVERY consumer", () => {
    // The contradiction this closes: the Relationship panel read stakeholders,
    // Data Quality read one denormalised column, and they disagreed the moment
    // anyone populated role_code.
    const r = everyConsumerAgrees([sh({ id: "1", role_code: "decision_maker" })], null);
    expect(r.helper).toBe("yes");
    expect(r.flaggedByAttention).toBe(false);
    expect(r.flaggedByDataQuality).toBe(false);
  });

  it("the legacy column alone also satisfies every consumer", () => {
    const r = everyConsumerAgrees([], "Eng. Khalid");
    expect(r.helper).toBe("yes");
    expect(r.flaggedByAttention).toBe(false);
    expect(r.flaggedByDataQuality).toBe(false);
  });

  it("readable stakeholders with nobody deciding is flagged by every consumer", () => {
    const r = everyConsumerAgrees([sh({ id: "1", role_code: "technical" })], null);
    expect(r.helper).toBe("no");
    expect(r.flaggedByAttention).toBe(true);
    expect(r.flaggedByDataQuality).toBe(true);
  });

  it("no stakeholders at all is flagged by every consumer", () => {
    const r = everyConsumerAgrees([], null);
    expect(r.helper).toBe("no");
    expect(r.flaggedByAttention).toBe(true);
    expect(r.flaggedByDataQuality).toBe(true);
  });

  it("UNREADABLE legacy text is unknown, and flagged by nobody", () => {
    // "Nobody recorded a role we can read" is not "this deal has no decision
    // maker". Sending a manager to find one they may already have is how a
    // queue loses its reader.
    const r = everyConsumerAgrees([sh({ id: "1", role: "Main Contact" })], null);
    expect(r.helper).toBe("unknown");
    expect(r.flaggedByAttention).toBe(false);
    expect(r.flaggedByDataQuality).toBe(false);
  });

  it("attention no longer reads the column on its own", () => {
    const src = read("src/lib/attention.ts");
    expect(src).toContain("decisionMakerState(");
    // The bare column check that used to live here is gone.
    expect(src).not.toMatch(/if \(!o\.contractor_decision_maker \|\|/);
  });

  it("without stakeholders supplied it still falls back to the column", () => {
    // Callers that have not been given stakeholders must behave exactly as
    // before rather than silently reporting every deal as missing one.
    const [i] = buildAttention({
      opportunities: [opp({ id: "x", contractor_decision_maker: "Khalid" })],
      activities: [{ id: "m", opportunity_id: "x", activity_type: "meeting", status: "logged", created_at: TODAY }],
      today: TODAY,
    });
    expect(i).toBeUndefined(); // fully complete record raises nothing at all
  });
});

// ---- The 200-row cap --------------------------------------------------------

/** A fake PostgREST page source holding `total` rows. */
function pagedSource(total: number) {
  let calls = 0;
  return {
    calls: () => calls,
    make: () => ({
      range: (from: number, to: number) => {
        calls += 1;
        const rows = [];
        for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ id: `r${i}` });
        return Promise.resolve({ data: rows, error: null });
      },
    }),
  };
}

describe("authoritative totals cover the whole permitted dataset", () => {
  it("reads all 49 in one page", async () => {
    const src = pagedSource(49);
    const r = await fetchAllRows<{ id: string }>(src.make);
    expect(r.rows).toHaveLength(49);
    expect(r.complete).toBe(true);
    expect(src.calls()).toBe(1);
  });

  it("reads exactly 200 — the old cap — completely", async () => {
    const r = await fetchAllRows<{ id: string }>(pagedSource(200).make);
    expect(r.rows).toHaveLength(200);
    expect(r.complete).toBe(true);
  });

  it("reads 201 — where the old cap started lying — completely", async () => {
    // Under `.limit(200)` this returned 200 rows and every KPI was computed
    // over them, precisely and wrongly.
    const r = await fetchAllRows<{ id: string }>(pagedSource(201).make);
    expect(r.rows).toHaveLength(201);
    expect(r.complete).toBe(true);
  });

  it("reads 500+ across pages", async () => {
    const src = pagedSource(1_237);
    const r = await fetchAllRows<{ id: string }>(src.make);
    expect(r.rows).toHaveLength(1_237);
    expect(r.complete).toBe(true);
    expect(src.calls()).toBe(Math.ceil(1_237 / PAGE_SIZE));
  });

  it("an exact page-size multiple still terminates and reports complete", async () => {
    // The classic off-by-one: a full final page looks like more data.
    const r = await fetchAllRows<{ id: string }>(pagedSource(PAGE_SIZE).make);
    expect(r.rows).toHaveLength(PAGE_SIZE);
    expect(r.complete).toBe(true);
  });

  it("an empty table is complete, not unknown", async () => {
    const r = await fetchAllRows<{ id: string }>(pagedSource(0).make);
    expect(r.rows).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it("hitting the ceiling reports INCOMPLETE rather than truncating silently", async () => {
    const r = await fetchAllRows<{ id: string }>(pagedSource(9_999_999).make, { maxRows: 1_000 });
    expect(r.rows).toHaveLength(1_000);
    expect(r.complete).toBe(false);
  });

  it("one incomplete source makes the whole set incomplete", async () => {
    // A dashboard where three of four queries finished is not three-quarters
    // right; it is wrong in a way nobody can localise.
    expect(allComplete({ complete: true }, { complete: true })).toBe(true);
    expect(allComplete({ complete: true }, { complete: false })).toBe(false);
  });

  it("a page error surfaces rather than becoming a short page", async () => {
    // Treating a failed page as "the data ran out" would report a partial book
    // as complete — the exact defect, reintroduced through the error path.
    const failing = { range: () => Promise.resolve({ data: null, error: new Error("boom") }) };
    await expect(fetchAllRows(() => failing)).rejects.toThrow("boom");
  });

  it("the ceiling is far above the real book and below a runaway", () => {
    expect(MAX_ROWS).toBeGreaterThan(5_000);
    expect(MAX_ROWS).toBeLessThanOrEqual(50_000);
  });
});

describe("the Command Center caps nothing that feeds a KPI", () => {
  const src = read("src/routes/_authenticated/command-center.tsx");

  it("opportunities, follow-ups, RFQs and quotations are all paged", () => {
    for (const table of ["opportunities", "follow_ups", "rfqs", "quotations", "stakeholders"]) {
      const idx = src.indexOf(`.from("${table}")`);
      expect([table, idx > -1]).toEqual([table, true]);
      // Each of these sits inside a fetchAllRows(...) call.
      expect([table, src.lastIndexOf("fetchAllRows", idx) > -1]).toEqual([table, true]);
    }
  });

  it("no KPI source carries a silent row limit any more", () => {
    // Scoped to each query's OWN chain. A blunt character window would sweep in
    // the neighbouring `.limit(6)` on ai_agent_runs, which is a legitimate
    // "last six runs" list and feeds no total.
    for (const table of ["opportunities", "follow_ups", "rfqs", "quotations", "stakeholders", "stage_transition_history"]) {
      const start = src.indexOf(`.from("${table}")`);
      const rest = src.slice(start);
      const end = rest.indexOf("supabase", 1);
      // Comments stripped: a chain check must read CODE. Twice now a comment
      // describing the removed cap has matched a regex looking for the cap.
      const chain = (end === -1 ? rest : rest.slice(0, end)).replace(/\/\/.*$/gm, "");
      expect([table, /\.limit\(/.test(chain)]).toEqual([table, false]);
    }
    // stage_transition_history was the worst of them: capped AND ordered
    // oldest-first, so growth froze the stalled baselines on ancient rows.
    const th = src.slice(src.indexOf('.from("stage_transition_history")'));
    const thChain = th.slice(0, th.indexOf("supabase", 1)).replace(/\/\/.*$/gm, "");
    expect(/\.limit\(/.test(thChain)).toBe(false);
  });

  it("incompleteness is rendered, not swallowed", () => {
    expect(src).toContain("!data.complete");
    expect(src).toContain("allComplete(");
  });
});

// ---- Defects the browser surfaced while verifying the two above -------------

describe("the dashboard survives its own migration not being applied yet", () => {
  const src = read("src/routes/_authenticated/command-center.tsx");

  it("asks for role_code, and asks again without it if the column is absent", () => {
    // PostgREST answers a select naming an unknown column with 400, which
    // fetchAllRows raises, which rejects the whole Promise.all — a BLANK
    // Command Center for every user until migration 20260915100000 lands.
    // Observed against the live schema, not theorised.
    expect(src).toContain("role_code");
    expect(src).toMatch(/catch[\s\S]{0,200}select\(STAKEHOLDER_COLS\)/);
  });

  it("the fallback select omits ONLY role_code", () => {
    // Dropping any other column would change what the panel can show; dropping
    // role_code alone is exactly the pre-migration reading.
    const cols = src.match(/const STAKEHOLDER_COLS = "([^"]+)"/)![1];
    expect(cols).not.toContain("role_code");
    for (const c of ["id", "opportunity_id", "name", "role", "organization", "last_interaction_at"]) {
      expect([c, cols.includes(c)]).toEqual([c, true]);
    }
  });
});

describe("a KPI tile nests no interactive element inside another", () => {
  const src = read("src/components/phc/KpiTile.tsx");

  it("the tooltip trigger is rendered in exactly one place, and it is not a control", () => {
    // `body` holds the tooltip's <button>. Rendering it inside the tile's own
    // <button>/<Link> is invalid HTML, throws a hydration error on every
    // render, and made "how is this calculated" navigate away instead of
    // explaining. One render site, inside a plain div.
    expect(src.match(/\{body\}/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/pointer-events-none">\{body\}<\/div>/);
  });

  it("the click target is a sibling layer, and it is still labelled", () => {
    // An empty overlay control with no text needs its own accessible name.
    expect(src).toContain("absolute inset-0");
    expect(src).toMatch(/<button type="button" onClick=\{onOpen\} aria-label=\{openLabel\}/);
    expect(src).toMatch(/aria-label=\{openLabel\}\n\s+className=\{layer\}/);
  });
});
