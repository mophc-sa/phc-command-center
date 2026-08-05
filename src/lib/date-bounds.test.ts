// PHC Sales OS — Date bounds validation unit tests.
// Run with: bun test src/lib/date-bounds.test.ts
import { test, expect, describe } from "bun:test";
import {
  validateDateBounds,
  dateBoundsErrorKey,
  maxAllowedDate,
  MIN_DATE,
  MAX_YEARS_AHEAD,
} from "./date-bounds";

const TODAY = new Date("2026-08-05T00:00:00Z");

describe("the live defect this guards against", () => {
  // rfqs.response_due_date on RFQ-2026-0001, found in production 2026-08-05.
  test("rejects the six-digit year produced by an overflowing date input", () => {
    const res = validateDateBounds("275760-07-29", { today: TODAY });
    expect(res).toEqual({ ok: false, reason: "malformed" });
  });

  test("the rejection maps to a message telling the user to check the year", () => {
    const res = validateDateBounds("2202-01-01", { today: TODAY });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(dateBoundsErrorKey(res.reason)).toBe("dialog_date_too_late");
  });
});

describe("well-formedness", () => {
  test.each([
    ["275760-07-29", "six-digit year"],
    ["20260805", "no separators"],
    ["05-08-2026", "day first"],
    ["2026-8-5", "unpadded month and day"],
    ["not a date", "free text"],
  ])("rejects %s (%s)", (value) => {
    const res = validateDateBounds(value, { today: TODAY });
    expect(res.ok).toBe(false);
  });

  test("rejects a calendar-invalid date that still matches the shape", () => {
    expect(validateDateBounds("2026-02-31", { today: TODAY })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(validateDateBounds("2026-13-01", { today: TODAY })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  test("accepts a real leap day", () => {
    expect(validateDateBounds("2028-02-29", { today: TODAY })).toEqual({ ok: true });
  });
});

describe("empty values are the required-flag's business, not ours", () => {
  test.each([["", "empty string"], [null, "null"], [undefined, "undefined"]])(
    "treats %p (%s) as valid",
    (value) => {
      expect(validateDateBounds(value as string | null | undefined, { today: TODAY })).toEqual({
        ok: true,
      });
    },
  );
});

describe("range", () => {
  test("accepts today", () => {
    expect(validateDateBounds("2026-08-05", { today: TODAY })).toEqual({ ok: true });
  });

  test("accepts a plausible historical record", () => {
    expect(validateDateBounds("2019-03-14", { today: TODAY })).toEqual({ ok: true });
  });

  test("accepts a long but plausible construction timeline", () => {
    expect(validateDateBounds("2032-12-01", { today: TODAY })).toEqual({ ok: true });
  });

  test("rejects before the absolute floor", () => {
    expect(validateDateBounds("1989-12-31", { today: TODAY })).toEqual({
      ok: false,
      reason: "too_early",
    });
  });

  test("accepts exactly the floor", () => {
    expect(validateDateBounds(MIN_DATE, { today: TODAY })).toEqual({ ok: true });
  });

  test("rejects beyond the ceiling", () => {
    expect(validateDateBounds("2099-01-01", { today: TODAY })).toEqual({
      ok: false,
      reason: "too_late",
    });
  });

  test("accepts exactly the ceiling", () => {
    expect(validateDateBounds(maxAllowedDate(TODAY), { today: TODAY })).toEqual({ ok: true });
  });

  test("honours explicit overrides", () => {
    const opts = { min: "2026-01-01", max: "2026-12-31", today: TODAY };
    expect(validateDateBounds("2026-06-01", opts)).toEqual({ ok: true });
    expect(validateDateBounds("2025-12-31", opts)).toEqual({ ok: false, reason: "too_early" });
    expect(validateDateBounds("2027-01-01", opts)).toEqual({ ok: false, reason: "too_late" });
  });
});

describe("maxAllowedDate", () => {
  test("is MAX_YEARS_AHEAD years from today", () => {
    expect(maxAllowedDate(TODAY)).toBe(`${2026 + MAX_YEARS_AHEAD}-08-05`);
  });

  test("returns a four-digit-year ISO date that passes its own validator", () => {
    expect(maxAllowedDate(TODAY)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(validateDateBounds(maxAllowedDate(TODAY), { today: TODAY }).ok).toBe(true);
  });
});

describe("wired into the dialog layer", () => {
  test("ActionDialog validates date fields and sets native bounds", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/components/phc/ActionDialog.tsx", "utf8");
    expect(src).toContain("validateDateBounds");
    expect(src).toContain("dateBoundsErrorKey");
    // Native min/max on the input, so the picker itself cannot reach a bad year.
    expect(src).toContain("maxAllowedDate()");
    expect(src).toContain("MIN_DATE");
  });

  test("every error reason has an i18n key defined in both languages", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/i18n.tsx", "utf8");
    for (const key of ["dialog_date_invalid", "dialog_date_too_early", "dialog_date_too_late"]) {
      expect(src).toContain(`${key}: { en:`);
      expect(src.slice(src.indexOf(`${key}: { en:`))).toMatch(/^[^\n]*ar: "/);
    }
  });
});
