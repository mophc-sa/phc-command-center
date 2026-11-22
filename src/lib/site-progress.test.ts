import { expect, test } from "bun:test";
import { SITE_PROGRESS_STEPS, siteProgressPct } from "./project-tracking";

test("the steps add up to 100 and the percentage follows the ticks", () => {
  expect(SITE_PROGRESS_STEPS.reduce((a, s) => a + s.weight, 0)).toBe(100);
  expect(siteProgressPct([])).toBe(0);
  expect(siteProgressPct(["infrastructure", "concrete"])).toBe(20);
  expect(siteProgressPct(["nope"])).toBe(0);
});
