// Project tracking helpers (manager feedback group 4).
// Run with: bun test src/lib/project-tracking.test.ts
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CONSTRUCTION_STAGES,
  SITE_STAGES,
  SITE_STAGE_LABEL,
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

  test("every kind has both languages, with Western digits only", () => {
    for (const k of UPDATE_KINDS) {
      expect(UPDATE_KIND_LABEL[k].en.length).toBeGreaterThan(0);
      expect(UPDATE_KIND_LABEL[k].ar.length).toBeGreaterThan(0);
      expect(UPDATE_KIND_LABEL[k].ar).not.toMatch(/[٠-٩]/);
    }
  });
});

describe("site stages", () => {
  const enumBlock = (() => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const at = types.indexOf("project_stage: [");
    return types.slice(at, types.indexOf("]", at));
  })();
  const enumValues = enumBlock.match(/"[a-z_]+"/g)?.map((v) => v.slice(1, -1)) ?? [];

  test("the list is the project_stage enum, in its order, less unknown", () => {
    expect([...SITE_STAGES]).toEqual(enumValues.filter((v) => v !== "unknown"));
  });
  test("the migration adds the three construction phases before handover", () => {
    const sql = readFileSync("supabase/migrations/20261026100000_construction_phase_and_deal_code.sql", "utf8");
    for (const v of ["excavation", "structure", "mep_finishing"]) {
      expect(sql).toContain(`ADD VALUE IF NOT EXISTS '${v}'`);
      expect(enumValues.indexOf(v)).toBeGreaterThan(enumValues.indexOf("under_construction"));
      expect(enumValues.indexOf(v)).toBeLessThan(enumValues.indexOf("near_handover"));
    }
  });
  test("every stage has both languages, with Western digits only", () => {
    for (const v of enumValues) {
      const label = SITE_STAGE_LABEL[v as keyof typeof SITE_STAGE_LABEL];
      expect(label.en.length).toBeGreaterThan(0);
      expect(label.ar.length).toBeGreaterThan(0);
      expect(label.ar).not.toMatch(/[٠-٩]/);
    }
  });
  test("construction counts every phase inside it", () => {
    expect([...CONSTRUCTION_STAGES].sort()).toEqual(["excavation", "mep_finishing", "structure", "under_construction"]);
  });
});

describe("validateUpdate", () => {
  test("a plain update needs nothing else", () => {
    expect(validateUpdate({ kind: "po_received", note: "", pct: "" })).toEqual({ ok: true, pct: null, stage: null });
  });
  test("a % is parsed", () => {
    expect(validateUpdate({ kind: "offer_sent", note: "", pct: " 60 " })).toEqual({ ok: true, pct: 60, stage: null });
  });
  test("0 is a real figure, not blank", () => {
    expect(validateUpdate({ kind: "progress_update", note: "", pct: "0" })).toEqual({ ok: true, pct: 0, stage: null });
  });
  test("a progress update needs a % or a stage", () => {
    expect(validateUpdate({ kind: "progress_update", note: "x", pct: "" })).toEqual({ ok: false, reason: "pct_required" });
    expect(validateUpdate({ kind: "progress_update", note: "x", pct: "", stage: "" })).toEqual({ ok: false, reason: "pct_required" });
  });
  test("a stage alone is a progress update", () => {
    expect(validateUpdate({ kind: "progress_update", note: "", pct: "", stage: "structure" })).toEqual({ ok: true, pct: null, stage: "structure" });
  });
  test("a stage rides along with any update", () => {
    expect(validateUpdate({ kind: "site_visit", note: "", pct: "45", stage: "excavation" })).toEqual({ ok: true, pct: 45, stage: "excavation" });
  });
  test("a value outside the list is not a stage", () => {
    expect(validateUpdate({ kind: "site_visit", note: "", pct: "", stage: "digging" })).toEqual({ ok: true, pct: null, stage: null });
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
    sales_stage: "jih", completion_pct: null, project_stage: "unknown", last_activity_at: null, opportunity_updates: [], ...o,
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
  test("carries the site stage, and an unknown one as null", () => {
    const [a, b] = projectProgressItems([
      row("a", { project_stage: "structure", last_activity_at: "2026-10-20T00:00:00Z" }),
      row("b", { last_activity_at: "2026-10-19T00:00:00Z" }),
    ] as never);
    expect(a.siteStage).toBe("structure");
    expect(b.siteStage).toBeNull();
  });
});
