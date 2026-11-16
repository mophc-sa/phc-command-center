// The reason drill-down must never leak an i18n key such as "src_rfq_received"
// or "src_2026-08-01": t() returns the key itself when there is no entry.
import { describe, expect, it } from "bun:test";
import { attentionParam } from "@/components/phc/NeedsAttentionPanel";
import { strings } from "@/lib/i18n";

const t = (k: string) => (strings as Record<string, { en: string }>)[k]?.en ?? k;

describe("attentionParam", () => {
  it("never emits src_ for unknown values", () => {
    for (const v of ["Manager probability", "rfq_received", "2026-08-01", "whatever", "SLA", "baseline"]) {
      expect([v, attentionParam(v, t, "en").startsWith("src_")]).toEqual([v, false]);
    }
  });

  it("translates known sources, stages and dates", () => {
    expect(attentionParam("SLA", t, "en")).toBe(strings.src_sla.en);
    expect(attentionParam("baseline", t, "en")).toBe(strings.src_baseline.en);
    expect(attentionParam("rfq_received", t, "en")).not.toBe("rfq_received");
    expect(attentionParam("2026-08-01", t, "en")).toContain("2026");
    expect(attentionParam("2026-08-01", t, "en")).not.toBe("2026-08-01");
    expect(attentionParam("Manager probability", t, "en")).toBe("Manager probability");
  });
});
