import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { computeStanding, computeTeam, yearOnYear, yearProgress, type BoardOpp } from "./board-metrics";
import { attentionItems, movement, pulseSentences, weightedPipeline, type IntelOpp } from "./board-intel";
import { fetchRequiredRows } from "./fetch-all";

const now = new Date("2026-09-08T09:00:00Z");
const opp = (patch: Partial<IntelOpp>): IntelOpp => ({
  id: "deal", owner_id: null, stage: "quotation", sales_stage: "jih",
  contract_value: null, quotation_value: 100, estimated_value_max: null,
  created_at: "2023-01-01T00:00:00Z", ...patch,
});

describe("board matches the complete commercial book", () => {
  it("retains older and paused work and reconciles team and stage totals including unassigned", () => {
    const data = [opp({ id: "old", owner_id: "rep" }), opp({ id: "paused", sales_stage: "on_hold", quotation_value: 200 }),
      opp({ id: "archive", stage: "archived", quotation_value: 9000 }), opp({ id: "won", stage: "won", sales_stage: "won" })];
    const total = computeStanding(data, now, null);
    const team = computeTeam(data, new Map(), new Map(), now, null, true);
    expect(total.openCount).toBe(2);
    expect(total.openTotal).toBe(300);
    expect(team.reduce((sum, row) => sum + row.open, 0)).toBe(total.openTotal);
    expect(total.composition.reduce((sum, row) => sum + row.count, 0)).toBe(total.openCount);
    expect(team.find((row) => row.ownerId === "unassigned")?.open).toBe(200);
  });

  it("does not turn historical activation or archiving into new business", () => {
    const recent = "2026-09-08T08:00:00Z";
    const data = [opp({ created_at: recent }), opp({ created_at: recent, extra_data: { source: "historical_promotion" } }),
      opp({ created_at: recent, extra_data: { source: "PHC Quotation List 2022-2026" } }),
      opp({ created_at: recent, stage: "archived" }), opp({ created_at: "2027-01-01T00:00:00Z" })];
    expect(movement(data, [], now, 1, { importedSource: "PHC Quotation List 2022-2026" }).newDeals).toBe(1);
  });

  it("dates losses by their outcome, excludes reopened wins and counts completed follow-ups", () => {
    const recent = "2026-09-08T08:00:00Z";
    const result = movement([opp({ won_at: recent }), opp({ stage: "lost", sales_stage: "lost", lost_at: recent })], [], now, 1,
      { followUps: [{ status: "completed", updated_at: recent }, { status: "scheduled", updated_at: recent }] });
    expect(result.won).toBe(0);
    expect(result.lost).toBe(1);
    expect(result.followUpsClosed).toBe(1);
  });

  it("year-to-date wins exclude archived, reopened and future outcomes", () => {
    const data: BoardOpp[] = [opp({ stage: "won", sales_stage: "won", won_at: "2026-04-01" }),
      opp({ stage: "archived", sales_stage: "won", won_at: "2026-04-01" }),
      opp({ won_at: "2026-04-01" }), opp({ stage: "won", sales_stage: "won", won_at: "2027-01-01" })];
    expect(yearOnYear(data, now).thisYear).toBe(100);
    expect(yearProgress(data, 1000, now).won).toBe(100);
  });

  it("completed follow-ups cannot make open deals overdue", () => {
    const attention = attentionItems([opp({})], [{ opportunity_id: "deal", status: "completed", due_date: "2026-09-01" }], now);
    expect(attention.some((item) => item.reasons.includes("followups_overdue"))).toBe(false);
  });

  it("stalled deals are independent of critical count and describe recorded activity", () => {
    const sentences = pulseSentences({ criticalCount: 2, criticalValue: 200, staleCount: 126, staleAfterDays: 10,
      weighted: { state: "no_data", value: null }, target: null, wonYtd: 0 }, "en", String).join(" ");
    expect(sentences).toContain("126 open deals have had no recorded activity in over 10 days");
    expect(sentences).not.toContain("of them");
  });

  it("weights every open stage and refuses absent values or invalid probabilities", () => {
    expect(weightedPipeline([opp({ sales_stage: "on_hold", human_win_probability: 50 })]).value).toBe(50);
    expect(weightedPipeline([opp({ human_win_probability: 50, quotation_value: null })]).state).toBe("no_data");
    expect(weightedPipeline([opp({ human_win_probability: 150 })]).state).toBe("no_data");
  });
});

describe("complete board refresh", () => {
  it("reads beyond the server cap and preserves the last complete snapshot on a later-page error", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const records = Array.from({ length: 1251 }, (_, id) => ({ id }));
    let fail = false;
    const queryFn = () => fetchRequiredRows(() => ({ range: async (from, to) =>
      fail && from >= 500 ? { data: null, error: new Error("connection lost") } : { data: records.slice(from, to + 1), error: null } }));
    const key = ["board", "test-user"];
    const first = await client.fetchQuery({ queryKey: key, queryFn });
    expect(first.data).toHaveLength(1251);
    const timestamp = client.getQueryState(key)?.dataUpdatedAt;
    fail = true;
    await expect(client.fetchQuery({ queryKey: key, queryFn })).rejects.toThrow("connection lost");
    expect(client.getQueryState(key)?.status).toBe("error");
    expect(client.getQueryState(key)?.dataUpdatedAt).toBe(timestamp);
    expect(client.getQueryData(key)).toEqual(first);
    fail = false;
    records.push({ id: 1251 });
    expect((await client.fetchQuery({ queryKey: key, queryFn })).data).toHaveLength(1252);
    expect(client.getQueryState(key)?.status).toBe("success");
    client.clear();
  });
});
