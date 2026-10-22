// Samples and drawings (manager feedback group 5).
// Run with: bun test src/lib/submittals.test.ts
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CLIENT_RESPONSES,
  NEXT_STEPS,
  SUBMITTAL_STEPS,
  firstStep,
  nextSteps,
  responseLabel,
  revisionLabel,
  stepLabel,
  submittalStage,
} from "./submittals";
import { nextFollowUpDate, recurrenceLabel } from "./follow-up-recurrence";

const SQL = readFileSync("supabase/migrations/20261026100000_samples_drawings_reminders.sql", "utf8");

describe("the step order matches the database", () => {
  test("NEXT_STEPS equals submittal_next_steps() line for line", () => {
    const body = SQL.slice(SQL.indexOf("FUNCTION public.submittal_next_steps"), SQL.indexOf("ELSE ARRAY[]::text[]"));
    const fromSql: Record<string, string[]> = {};
    for (const m of body.matchAll(/WHEN '([a-z]+:[a-z_]*)' THEN ARRAY\[([^\]]*)\]/g)) {
      fromSql[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    }
    expect(Object.keys(fromSql).length).toBeGreaterThan(0);
    expect(Object.fromEntries(Object.entries(NEXT_STEPS).map(([k, v]) => [k, [...v]]))).toEqual(fromSql);
  });

  test("the step and response vocabularies equal the CHECK lists", () => {
    const steps = SQL.slice(SQL.indexOf("step         text NOT NULL CHECK"), SQL.indexOf("response     text CHECK"));
    expect(steps.match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)).sort()).toEqual([...SUBMITTAL_STEPS].sort());
    const responses = SQL.slice(SQL.indexOf("response     text CHECK"), SQL.indexOf("-- Who did it"));
    expect(responses.match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)).sort()).toEqual([...CLIENT_RESPONSES].sort());
  });

  test("an item starts with its kind's first step and a new round restarts it", () => {
    expect(nextSteps("sample", null)).toEqual(["requested"]);
    expect(nextSteps("drawing", null)).toEqual(["designer_sent"]);
    expect(nextSteps("sample", "client_response")).toEqual([firstStep("sample")]);
    expect(nextSteps("drawing", "client_response")).toEqual([firstStep("drawing")]);
    expect(nextSteps("sample", "cancelled")).toEqual([]);
    expect(nextSteps("sample", "requested")).toContain("approved");
    expect(nextSteps("sample", "requested")).not.toContain("in_production");
  });
});

describe("labels", () => {
  test("every step and response reads in both languages, Western digits only", () => {
    for (const s of SUBMITTAL_STEPS) {
      for (const lang of ["en", "ar"] as const) {
        expect(stepLabel(s, lang)).not.toBe(s);
        expect(stepLabel(s, lang)).not.toMatch(/[٠-٩]/);
      }
    }
    for (const r of CLIENT_RESPONSES) expect(responseLabel(r, "ar")).not.toMatch(/[٠-٩]/);
    expect(responseLabel("approved_with_comments", "en")).toContain("Code B");
    expect(responseLabel("revise_resubmit", "en")).toContain("Code C");
  });

  test("drawings count from Rev 0, samples from round 1", () => {
    expect(revisionLabel("drawing", 0, "en")).toBe("Rev 0");
    expect(revisionLabel("sample", 0, "en")).toBe("Round 1");
    expect(revisionLabel("sample", 1, "ar")).not.toMatch(/[٠-٩]/);
  });

  test("where an item stands", () => {
    expect(submittalStage("sample", "requested", null)).toBe("awaiting_approval");
    expect(submittalStage("sample", "in_production", null)).toBe("in_production");
    expect(submittalStage("drawing", "sent_to_client", null)).toBe("with_client");
    expect(submittalStage("drawing", "client_response", "approved_with_comments")).toBe("done");
    expect(submittalStage("sample", "client_response", "revise_resubmit")).toBe("needs_action");
    expect(submittalStage("sample", "cancelled", null)).toBe("cancelled");
  });
});

describe("repeating reminders", () => {
  // The same cases were run against next_follow_up_date() in Postgres.
  test("mirrors next_follow_up_date()", () => {
    expect(nextFollowUpDate("2026-01-31", "monthly", "2026-01-31", "2026-01-01")).toBe("2026-02-28");
    expect(nextFollowUpDate("2026-01-31", "monthly", "2026-02-28", "2026-01-01")).toBe("2026-03-31");
    expect(nextFollowUpDate("2024-02-29", "yearly", "2024-02-29", "2024-01-01")).toBe("2025-02-28");
    // Completed late: the next one is not already overdue.
    expect(nextFollowUpDate("2026-01-05", "monthly", "2026-01-05", "2026-04-20")).toBe("2026-05-05");
    expect(nextFollowUpDate("2026-01-05", "none", "2026-01-05", "2026-01-01")).toBeNull();
  });

  test("labels", () => {
    expect(recurrenceLabel("monthly", "en")).toBe("Every month");
    expect(recurrenceLabel(null, "ar")).toBe("مرة واحدة");
  });
});
