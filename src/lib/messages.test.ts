// =============================================================================
// The engine states facts; the UI states them in a language.
//
// These guard the seam. If a business rule ever migrates into a translation
// file, or an English sentence back into an engine, one of these fails.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatMessage, msg } from "@/lib/messages";
import { strings as dict, AR_LOCALE } from "@/lib/i18n";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const t = (k: string) => (dict as Record<string, { en: string; ar: string }>)[k]?.en ?? k;
const tAr = (k: string) => (dict as Record<string, { en: string; ar: string }>)[k]?.ar ?? k;

describe("formatMessage", () => {
  it("fills slots from params", () => {
    expect(formatMessage(msg("cav_probability_missing", { count: 48 }), t)).toBe(
      "48 open deals have no probability and are excluded rather than assumed",
    );
  });

  it("formats numbers through the caller's formatter, whatever the caller chose", () => {
    // The seam is the point: this module knows the fact, the caller knows how
    // the number should look. Both directions are exercised so the seam cannot
    // quietly stop being a seam.
    //
    // The app's own choice is Western digits in Arabic — see
    // arabic-digits.test.ts, which pins it. Here we only prove the formatter
    // is genuinely pluggable.
    const eastern = formatMessage(msg("cav_probability_missing", { count: 48 }), tAr, (v) =>
      new Intl.NumberFormat("ar-SA-u-nu-arab").format(Number(v)),
    );
    expect(eastern).toContain("٤٨");

    const western = formatMessage(msg("cav_probability_missing", { count: 48 }), tAr, (v) =>
      new Intl.NumberFormat(AR_LOCALE).format(Number(v)),
    );
    expect(western).toContain("48");
    expect(western).not.toContain("٤٨");
  });

  it("leaves an unknown slot visible rather than blanking it", () => {
    // A silently empty sentence is harder to notice than a stray {slot}.
    expect(formatMessage(msg("cav_probability_missing", {}), t)).toContain("{count}");
  });

  it("returns the key when a translation is missing, never an empty card", () => {
    expect(formatMessage(msg("cav_does_not_exist"), t)).toBe("cav_does_not_exist");
  });

  it("passes a paramless message straight through", () => {
    expect(formatMessage(msg("cav_no_target"), t)).toBe("No target has been set for this period");
  });

  it("undefined in, undefined out — an absent caveat renders nothing", () => {
    expect(formatMessage(undefined, t)).toBeUndefined();
  });
});

describe("every message key exists in both languages", () => {
  const KEYS = [
    "cav_no_target", "cav_no_target_achievement", "cav_no_target_gap",
    "cav_probability_missing", "cav_unvalued_contribute_zero", "cav_counted_not_summed",
    "cav_won_undated", "cav_won_undated_outside_period", "cav_lost_undated",
    "cav_predate_outcome_tracking", "cav_nothing_closed", "cav_closed_undated",
    "cav_unclassified_neither", "cav_unclassified_do_not_sum",
    "rsn_follow_up_overdue_one", "rsn_follow_up_overdue_many", "rsn_no_next_action",
    "rsn_no_next_action_date", "rsn_next_action_overdue", "rsn_inactive",
    "rsn_no_engagement_history", "rsn_stalled", "rsn_expected_close_overdue",
    "rsn_closing_soon", "rsn_high_value_low_probability", "rsn_unscored",
    "rsn_no_decision_maker",
  ];

  it("has an Arabic and an English string for each", () => {
    for (const k of KEYS) {
      const entry = (dict as Record<string, { en: string; ar: string }>)[k];
      expect([k, !!entry?.en]).toEqual([k, true]);
      expect([k, !!entry?.ar]).toEqual([k, true]);
    }
  });

  it("the Arabic is actually Arabic, not an English string copied across", () => {
    for (const k of KEYS) {
      const ar = (dict as Record<string, { en: string; ar: string }>)[k].ar;
      expect([k, /[؀-ۿ]/.test(ar)]).toEqual([k, true]);
    }
  });

  it("both languages declare the SAME slots — one fact, two wordings", () => {
    // A template that drops a slot silently loses a number the reader needs;
    // one that invents a slot renders a literal {foo}.
    const slots = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(",");
    for (const k of KEYS) {
      const e = (dict as Record<string, { en: string; ar: string }>)[k];
      expect([k, slots(e.ar)]).toEqual([k, slots(e.en)]);
    }
  });
});

describe("translations carry wording, never business rules", () => {
  const i18nSrc = read("src/lib/i18n.tsx");

  it("no threshold numbers are hardcoded into message templates", () => {
    // "deals idle more than 14 days" in a translation would put the rule in two
    // places, and the Arabic could drift to 21 without anything failing.
    const templates = [...i18nSrc.matchAll(/^\s+(cav_|rsn_)\w+:\s*\{[\s\S]*?\},$/gm)].map((m) => m[0]);
    expect(templates.length).toBeGreaterThan(10);
    for (const tpl of templates) {
      const body = tpl.slice(tpl.indexOf("{"));
      // Digits may appear only inside a slot name, never as a bare number.
      expect([tpl.slice(0, 40), /(?<!\{)\b\d+\b/.test(body)]).toEqual([tpl.slice(0, 40), false]);
    }
  });

  it("no comparison or conditional logic lives in a template", () => {
    const templates = [...i18nSrc.matchAll(/^\s+(cav_|rsn_)\w+:\s*\{[\s\S]*?\},$/gm)].map((m) => m[0]);
    for (const tpl of templates) {
      expect([tpl.slice(0, 40), /[<>]=?|\?|&&|\|\|/.test(tpl.slice(tpl.indexOf("{")))]).toEqual(
        [tpl.slice(0, 40), false],
      );
    }
  });
});

describe("engines emit facts, not sentences", () => {
  it("the KPI engine builds no English caveat prose", () => {
    // Template literals interpolating a count into a sentence are exactly what
    // this refactor removed; a regression would reintroduce untranslated text.
    const src = read("src/lib/sales-kpis.ts");
    const caveatLines = src.split("\n").filter((l) => l.includes("caveat:") || l.includes("caveat\n"));
    for (const line of caveatLines) {
      expect([line.trim().slice(0, 50), /caveat:\s*[`"]/.test(line)]).toEqual([line.trim().slice(0, 50), false]);
    }
  });

  it("the attention engine pushes no English reason prose", () => {
    const src = read("src/lib/attention.ts");
    expect(src).not.toMatch(/push\(\s*"[a-z_]+",\s*[`"]/);
  });
});
