// Project tracking helpers (manager feedback group 4).
// Run with: bun test src/lib/project-tracking.test.ts
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import {
  SYSTEM_UPDATE_KIND_LABEL,
  UPDATE_KINDS,
  UPDATE_KIND_LABEL,
  awardedValue,
  projectProgressItems,
  projectWithContractor,
  validateUpdate,
} from "./project-tracking";

describe("update kinds", () => {
  test("match the database CHECK list exactly", () => {
    const sql = readFileSync("supabase/migrations/20261022100000_project_tracking.sql", "utf8");
    const list = sql.slice(sql.indexOf("kind IN ("), sql.indexOf(")),", sql.indexOf("kind IN (")));
    for (const k of UPDATE_KINDS) expect(list).toContain(`'${k}'`);
    expect(list.match(/'[a-z_]+'/g)?.length).toBe(UPDATE_KINDS.length);
  });

  test("the latest CHECK adds only the kinds the system writes (meeting summary, 20261028100000)", () => {
    const sql = readFileSync("supabase/migrations/20261028100000_meetings_phase1.sql", "utf8");
    const at = sql.indexOf("opportunity_updates_kind_check CHECK (kind IN (");
    const list = sql.slice(at, sql.indexOf("));", at));
    const all = [...UPDATE_KINDS, ...Object.keys(SYSTEM_UPDATE_KIND_LABEL)];
    for (const k of all) expect(list).toContain(`'${k}'`);
    expect(list.match(/'[a-z_]+'/g)?.length).toBe(all.length);
    expect(UPDATE_KINDS as readonly string[]).not.toContain("meeting_summary");
  });

  test("every kind has both languages, with Western digits only", () => {
    for (const k of UPDATE_KINDS) {
      expect(UPDATE_KIND_LABEL[k].en.length).toBeGreaterThan(0);
      expect(UPDATE_KIND_LABEL[k].ar.length).toBeGreaterThan(0);
      expect(UPDATE_KIND_LABEL[k].ar).not.toMatch(/[٠-٩]/);
    }
  });
});

describe("validateUpdate", () => {
  test("a plain update needs nothing else", () => {
    expect(validateUpdate({ kind: "po_received", note: "", pct: "" })).toEqual({ ok: true, pct: null });
  });
  test("a % is parsed", () => {
    expect(validateUpdate({ kind: "offer_sent", note: "", pct: " 60 " })).toEqual({ ok: true, pct: 60 });
  });
  test("0 is a real figure, not blank", () => {
    expect(validateUpdate({ kind: "progress_update", note: "", pct: "0" })).toEqual({ ok: true, pct: 0 });
  });
  test("a progress update needs a %", () => {
    expect(validateUpdate({ kind: "progress_update", note: "x", pct: "" })).toEqual({ ok: false, reason: "pct_required" });
  });
  test("other needs a note", () => {
    expect(validateUpdate({ kind: "other", note: "  ", pct: "" })).toEqual({ ok: false, reason: "note_required" });
  });
  test("out of range or non-numeric % is refused", () => {
    expect(validateUpdate({ kind: "offer_sent", note: "", pct: "101" })).toEqual({ ok: false, reason: "pct_invalid" });
    expect(validateUpdate({ kind: "offer_sent", note: "", pct: "6.5" })).toEqual({ ok: false, reason: "pct_invalid" });
    expect(validateUpdate({ kind: "offer_sent", note: "", pct: "abc" })).toEqual({ ok: false, reason: "pct_invalid" });
  });
});

describe("projectWithContractor", () => {
  test("joins name and contractor", () => {
    expect(projectWithContractor("Riyadh Metro", "Al Bawani")).toBe("Riyadh Metro — Al Bawani");
  });
  test("name alone when there is no contractor", () => {
    expect(projectWithContractor("Riyadh Metro", null)).toBe("Riyadh Metro");
    expect(projectWithContractor("Riyadh Metro", "  ")).toBe("Riyadh Metro");
  });
  test("does not repeat a contractor that is the name", () => {
    expect(projectWithContractor("Al Bawani", "al bawani")).toBe("Al Bawani");
  });
  test("contractor alone when the name is missing", () => {
    expect(projectWithContractor(null, "Al Bawani")).toBe("Al Bawani");
  });
});

describe("awardedValue", () => {
  test("the contract value when there is one", () => {
    expect(awardedValue({ contract_value: 900, quotation_value: 1000 })).toBe(900);
  });
  test("the quotation once won, when no contract value", () => {
    expect(awardedValue({ sales_stage: "won", quotation_value: 1000 })).toBe(1000);
    expect(awardedValue({ stage: "won", quotation_value: "1000" })).toBe(1000);
  });
  test("nothing before award", () => {
    expect(awardedValue({ sales_stage: "jih", quotation_value: 1000, estimated_value_max: 2000 })).toBeNull();
  });
});

describe("projectProgressItems", () => {
  const row = (id: string, o: Record<string, unknown>) => ({
    id, project_name: id, main_contractor: null, contractor_company: null, stage: "quotation",
    sales_stage: "jih", completion_pct: null, last_activity_at: null, opportunity_updates: [], ...o,
  });
  test("leaves out won, lost, on-hold and archived deals", () => {
    const items = projectProgressItems([
      row("live", {}),
      row("won", { sales_stage: "won" }),
      row("lost", { sales_stage: "lost" }),
      row("hold", { sales_stage: "on_hold" }),
      row("arch", { stage: "archived" }),
    ] as never);
    expect(items.map((i) => i.id)).toEqual(["live"]);
  });
  test("newest update first, then last activity", () => {
    const items = projectProgressItems([
      row("a", { last_activity_at: "2026-10-18T00:00:00Z" }),
      row("b", { opportunity_updates: [{ kind: "offer_sent", created_at: "2026-10-19T08:00:00Z" }, { kind: "site_visit", created_at: "2026-10-01T00:00:00Z" }] }),
      row("c", { last_activity_at: "2026-10-10T00:00:00Z" }),
    ] as never);
    expect(items.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(items[0].latest?.kind).toBe("offer_sent");
  });
  test("contractor from the linked company first, then the free-text name", () => {
    const [i] = projectProgressItems([row("x", { contractor_company: { name: "Linked Co" }, main_contractor: "Typed Co" })] as never);
    expect(i.contractor).toBe("Linked Co");
  });
  test("keeps unknown progress as null, not 0", () => {
    const [i] = projectProgressItems([row("x", {})] as never);
    expect(i.pct).toBeNull();
  });
});
