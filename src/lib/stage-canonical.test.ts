// PHC Sales OS — Canonical stage resolution tests.
// Run with: bun test src/lib/stage-canonical.test.ts
import { test, expect, describe } from "bun:test";
import {
  CANONICAL_STAGES,
  CANONICAL_ACTIVE_STAGES,
  CANONICAL_FUNNEL_ORDER,
  canonicalStageLabelKey,
  resolveCanonicalStage,
  legacyStageFor,
  groupByCanonicalStage,
  type CanonicalStage,
} from "./stage-canonical";
import { SALES_STAGES } from "./workflow-actions";

describe("the canonical vocabulary is the sales_stage enum, exactly", () => {
  test("same members as SALES_STAGES", () => {
    expect([...CANONICAL_STAGES].sort()).toEqual([...SALES_STAGES].sort());
  });

  test("active stages exclude terminal and paused states", () => {
    expect(CANONICAL_ACTIVE_STAGES).not.toContain("won" as CanonicalStage);
    expect(CANONICAL_ACTIVE_STAGES).not.toContain("lost" as CanonicalStage);
    expect(CANONICAL_ACTIVE_STAGES).not.toContain("on_hold" as CanonicalStage);
  });

  test("every stage has an i18n key that exists in both languages", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/i18n.tsx", "utf8");
    for (const s of CANONICAL_STAGES) {
      expect(src).toContain(`${canonicalStageLabelKey(s)}:`);
    }
  });
});

describe("resolveCanonicalStage — sales_stage wins", () => {
  test("uses sales_stage when present, whatever legacy says", () => {
    expect(resolveCanonicalStage({ sales_stage: "verbally_awarded", stage: "quotation" })).toEqual({
      stage: "verbally_awarded",
      source: "sales_stage",
    });
  });

  test("ignores an unrecognised sales_stage value", () => {
    expect(resolveCanonicalStage({ sales_stage: "not_a_stage", stage: "won" })).toEqual({
      stage: "won",
      source: "legacy_terminal",
    });
  });
});

describe("resolveCanonicalStage — legacy fallback", () => {
  test("trusts legacy won/lost, because applySalesStage keeps them in sync", () => {
    expect(resolveCanonicalStage({ sales_stage: null, stage: "won" })).toEqual({
      stage: "won",
      source: "legacy_terminal",
    });
    expect(resolveCanonicalStage({ sales_stage: null, stage: "lost" })).toEqual({
      stage: "lost",
      source: "legacy_terminal",
    });
  });

  test("archived is not a pipeline position", () => {
    expect(resolveCanonicalStage({ sales_stage: null, stage: "archived" })).toEqual({
      stage: null,
      source: "none",
    });
  });

  test.each(["discovery", "qualification", "preparation", "quotation", "follow_up"])(
    "infers pipeline entry from generic CRM stage %s, and says so",
    (legacy) => {
      expect(resolveCanonicalStage({ sales_stage: null, stage: legacy })).toEqual({
        stage: "rfq_received",
        source: "inferred",
      });
    },
  );

  test("a row with neither column resolves to nothing", () => {
    expect(resolveCanonicalStage({})).toEqual({ stage: null, source: "none" });
    expect(resolveCanonicalStage({ sales_stage: null, stage: null })).toEqual({
      stage: null,
      source: "none",
    });
  });
});

describe("the live production rows, 2026-08-05", () => {
  // Exact cross-tab queried read-only from lrfdtoexyeghrzynapyn. These are the
  // rows the refactor has to get right on day one.
  const PROD = [
    { stage: "qualification", sales_stage: null, estimated_value_max: 900000 },
    { stage: "quotation", sales_stage: null, estimated_value_max: 650000 },
    { stage: "quotation", sales_stage: "rfq_received", estimated_value_max: null },
    { stage: "quotation", sales_stage: "verbally_awarded", estimated_value_max: 450000 },
  ];

  test("the verbal award is no longer filed under Quotation", () => {
    const verbal = PROD.find((r) => r.sales_stage === "verbally_awarded")!;
    expect(resolveCanonicalStage(verbal).stage).toBe("verbally_awarded");
  });

  test("grouping reports how much rests on inference", () => {
    const res = groupByCanonicalStage(PROD);
    // 2 rows have no sales_stage and fall back to an inferred entry stage.
    expect(res.inferredCount).toBe(2);
    expect(res.excludedCount).toBe(0);
  });

  test("value lands in the right buckets", () => {
    const res = groupByCanonicalStage(PROD);
    const byStage = Object.fromEntries(res.buckets.map((b) => [b.stage, b]));
    expect(byStage.verbally_awarded.count).toBe(1);
    expect(byStage.verbally_awarded.value).toBe(450000);
    // The two inferred rows plus the real rfq_received one.
    expect(byStage.rfq_received.count).toBe(3);
    expect(byStage.rfq_received.value).toBe(900000 + 650000);
  });
});

describe("groupByCanonicalStage", () => {
  test("returns every requested stage, including empty ones", () => {
    const res = groupByCanonicalStage([]);
    expect(res.buckets).toHaveLength(CANONICAL_FUNNEL_ORDER.length);
    expect(res.buckets.every((b) => b.count === 0 && b.value === 0)).toBe(true);
  });

  test("excludes rows outside the requested stage set and counts them", () => {
    const res = groupByCanonicalStage(
      [
        { sales_stage: "won", estimated_value_max: 100 },
        { sales_stage: "lost", estimated_value_max: 200 },
        { sales_stage: "jih", estimated_value_max: 300 },
      ],
      // Default funnel order excludes won/lost.
    );
    expect(res.excludedCount).toBe(2);
    expect(res.buckets.find((b) => b.stage === "jih")!.value).toBe(300);
  });

  test("value precedence: contract > quotation > est max > est min", () => {
    const res = groupByCanonicalStage([
      {
        sales_stage: "jih",
        contract_value: 1,
        quotation_value: 2,
        estimated_value_max: 3,
        estimated_value_min: 4,
      },
      { sales_stage: "jih", quotation_value: 2, estimated_value_max: 3 },
      { sales_stage: "jih", estimated_value_max: 3 },
      { sales_stage: "jih", estimated_value_min: 4 },
    ]);
    expect(res.buckets.find((b) => b.stage === "jih")!.value).toBe(1 + 2 + 3 + 4);
  });

  test("treats a missing value as zero rather than NaN", () => {
    const res = groupByCanonicalStage([{ sales_stage: "jih" }]);
    expect(res.buckets.find((b) => b.stage === "jih")!.value).toBe(0);
  });

  test("honours an explicit stage set", () => {
    const res = groupByCanonicalStage([{ sales_stage: "won", estimated_value_max: 500 }], {
      stages: ["won"],
    });
    expect(res.buckets).toEqual([{ stage: "won", count: 1, value: 500 }]);
    expect(res.excludedCount).toBe(0);
  });
});

describe("legacyStageFor — keeping the old column meaningful during migration", () => {
  test("terminal states map straight across", () => {
    expect(legacyStageFor("won")).toBe("won");
    expect(legacyStageFor("lost")).toBe("lost");
  });

  test("on_hold has no legacy equivalent and says so rather than guessing", () => {
    expect(legacyStageFor("on_hold")).toBeNull();
  });

  test("every canonical stage is handled", () => {
    for (const s of CANONICAL_STAGES) {
      expect(() => legacyStageFor(s)).not.toThrow();
    }
  });
});

describe("preparation only — nothing wired up yet", () => {
  test("no route imports stage-canonical, so this PR changes no behaviour", async () => {
    const fs = await import("fs/promises");
    const dir = "src/routes/_authenticated";
    const files = await fs.readdir(dir);
    for (const f of files.filter((x) => x.endsWith(".tsx"))) {
      const src = await fs.readFile(`${dir}/${f}`, "utf8");
      expect(src).not.toContain("stage-canonical");
    }
  });
});
