import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { localizeFlagText } from "./flag-text";

describe("localizeFlagText", () => {
  it("translates fixed and parameterised automation text", () => {
    expect(localizeFlagText("Follow-up due today", "ar")).toBe("متابعة مستحقة اليوم");
    expect(localizeFlagText("Follow-up overdue since 2026-09-05", "ar")).toBe("متابعة متأخرة منذ 2026-09-05");
    expect(localizeFlagText("Submission due 2026-08-14 is waiting on you", "ar")).toBe("التقديم المستحق في 2026-08-14 بانتظارك");
    expect(localizeFlagText("Tier A opportunity with no client contact in 21+ days", "ar")).toBe("فرصة من الفئة A بلا تواصل مع العميل منذ 21+ يومًا");
    expect(localizeFlagText("Pending quotation_approval approval", "ar")).not.toContain("quotation_approval");
    expect(localizeFlagText("Pending quotation_approval approval", "en")).not.toContain("quotation_approval");
  });
  it("keeps English in English and leaves unknown text untouched", () => {
    expect(localizeFlagText("Follow-up due today", "en")).toBe("Follow-up due today");
    expect(localizeFlagText("Chase the client", "ar")).toBe("Chase the client");
    expect(localizeFlagText(null, "ar")).toBeNull();
  });
  it("covers every English literal in the latest run_sales_automations", () => {
    const dir = join(import.meta.dir, "../../supabase/migrations");
    const latest = readdirSync(dir).sort().reverse()
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .find((s) => /FUNCTION public\.run_sales_automations/i.test(s))!;
    const body = latest.slice(latest.search(/FUNCTION public\.run_sales_automations/i));
    const literals = [...body.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
      .filter((s) => /^[A-Z][a-z].* .*[a-z]/.test(s) && s.length > 12);
    const untranslated = literals.filter((s) => !/ $/.test(s) && !s.includes(" is waiting") && localizeFlagText(s, "ar") === s);
    expect(untranslated).toEqual([]);
  });
});
