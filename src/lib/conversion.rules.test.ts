// PHC RFQ/Tender -> JIH conversion rules. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  evaluateConversion,
  reviewFromRecord,
  SIGNAGE_VALUE_THRESHOLD,
  type ConversionReview,
} from "../../supabase/functions/_shared/conversion";

function passing(over: Partial<ConversionReview> = {}): ConversionReview {
  return {
    project_stage_suitable: true,
    package_not_closed: true,
    estimated_signage_value: 500000,
    contact_plan_ready: true,
    main_contractor_confirmed: true,
    signage_package_status: "confirmed",
    signage_package_confidence: "high",
    conversion_reason: "Awarded to a target main contractor with an open signage package.",
    ...over,
  };
}

test("a fully-satisfied review above threshold is OK", () => {
  expect(evaluateConversion(passing())).toEqual({ ok: true, blocked: [], requiresException: false });
});

test("value exactly at the threshold passes", () => {
  const d = evaluateConversion(passing({ estimated_signage_value: SIGNAGE_VALUE_THRESHOLD }));
  expect(d.ok).toBe(true);
});

test("below-threshold value (all else passing) requires an exception, not a block", () => {
  const d = evaluateConversion(passing({ estimated_signage_value: 120000 }));
  expect(d).toEqual({ ok: false, blocked: [], requiresException: true });
});

test("each failed gate produces its reason code", () => {
  expect(evaluateConversion(passing({ project_stage_suitable: false })).blocked).toContain("project_stage_not_suitable");
  expect(evaluateConversion(passing({ package_not_closed: false })).blocked).toContain("package_closed");
  expect(evaluateConversion(passing({ contact_plan_ready: false })).blocked).toContain("contact_plan_missing");
  expect(evaluateConversion(passing({ main_contractor_confirmed: false })).blocked).toContain("main_contractor_not_confirmed");
  expect(evaluateConversion(passing({ signage_package_status: "no_package_identified" })).blocked).toContain("signage_package_not_suitable");
  expect(evaluateConversion(passing({ signage_package_confidence: "low" })).blocked).toContain("signage_confidence_low");
  expect(evaluateConversion(passing({ conversion_reason: "  " })).blocked).toContain("conversion_reason_missing");
});

test("a missing value is a hard block, not an exception", () => {
  const d = evaluateConversion(passing({ estimated_signage_value: null }));
  expect(d.requiresException).toBe(false);
  expect(d.blocked).toContain("signage_value_missing");
});

test("hard blocks take precedence over the exception path", () => {
  const d = evaluateConversion(passing({ estimated_signage_value: 100000, contact_plan_ready: false }));
  expect(d.requiresException).toBe(false);
  expect(d.blocked).toContain("contact_plan_missing");
});

test("reviewFromRecord prefers override answers, falls back to stored columns", () => {
  const rec = {
    project_stage_suitable: true,
    package_not_closed: true,
    estimated_signage_value: 400000,
    contact_plan_ready: false,
    signage_package_status: "likely",
    signage_package_confidence: "medium",
    conversion_reason: "stored reason",
  };
  const review = reviewFromRecord(rec, { contact_plan_ready: "yes" }, /* mainContractorPresent */ true);
  expect(review.contact_plan_ready).toBe(true); // override wins
  expect(review.main_contractor_confirmed).toBe(true); // from presence signal
  expect(review.estimated_signage_value).toBe(400000);
  expect(evaluateConversion(review).ok).toBe(true);
});
