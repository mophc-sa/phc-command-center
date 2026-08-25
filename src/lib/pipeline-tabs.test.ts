import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PIPELINE_TAB,
  PIPELINE_TABS,
  isPipelineTab,
  parsePipelineSearch,
  type PipelineTab,
} from "@/lib/pipeline-tabs";

describe("parsePipelineSearch", () => {
  it("keeps every tab the page can show", () => {
    for (const tab of PIPELINE_TABS) {
      expect(parsePipelineSearch({ tab })).toEqual({ tab });
    }
  });

  it("falls back rather than throwing on anything unrecognised", () => {
    for (const bad of [undefined, null, "", "BOQ", "rfq-jih", 42, {}, ["boq"]]) {
      expect(parsePipelineSearch({ tab: bad })).toEqual({ tab: DEFAULT_PIPELINE_TAB });
    }
  });

  it("is exact, not a prefix or case-insensitive match", () => {
    expect(parsePipelineSearch({ tab: "boq_extra" }).tab).toBe(DEFAULT_PIPELINE_TAB);
    expect(parsePipelineSearch({ tab: "Boq" }).tab).toBe(DEFAULT_PIPELINE_TAB);
  });

  it("ignores unrelated params instead of tripping on them", () => {
    expect(parsePipelineSearch({ tab: "boq", q: "tower", page: 3 })).toEqual({ tab: "boq" });
  });
});

describe("the retired routes land on a tab this page can render", () => {
  // /boq and /rfq-jih redirect here with a hardcoded tab. If either drifts from
  // the parser's vocabulary the bookmark silently lands on Quotations instead
  // of the panel it named, which is what those redirects exist to prevent.
  const REDIRECT_TARGETS: PipelineTab[] = ["boq", "rfq_jih"];

  it("every redirect's tab round-trips", () => {
    for (const tab of REDIRECT_TARGETS) {
      expect(isPipelineTab(tab)).toBe(true);
      expect(parsePipelineSearch({ tab }).tab).toBe(tab);
    }
  });
});
