// =============================================================================
// In Arabic, the digits stay Western.
//
// `ar-SA` renders Arabic-Indic digits: SAR 63,407,478 arrives on screen as
// ٦٣٬٤٠٧٬٤٧٨. That is correct Arabic typography and wrong for this business —
// every figure a reader reconciles a number against (the ERP, a supplier
// quotation, a bank statement, a BOQ line) is written in Western digits, so
// they have to transliterate before they can compare. A number nobody can
// compare at a glance is a number nobody checks.
//
// This suite pins the decision in two places, because one without the other
// leaves a hole:
//
//   1. the shared formatter produces the digits we want, and
//   2. no screen quietly bypasses it with a bare "ar" / "ar-SA".
//
// The second is the one that matters over time. There were nineteen such call
// sites before this was introduced, each individually reasonable.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AR_LOCALE, formatCurrency, formatNumber, localeFor } from "@/lib/i18n";

/** U+0660–0669 (Arabic-Indic) and U+06F0–06F9 (Extended, Persian/Urdu). */
const EASTERN = /[٠-٩۰-۹]/;

describe("the shared formatter", () => {
  it("gives Arabic Western digits", () => {
    const out = formatNumber(63_407_478, "ar");
    expect(out).not.toMatch(EASTERN);
    expect(out).toContain("63");
  });

  it("gives English the same digits", () => {
    expect(formatNumber(63_407_478, "en")).not.toMatch(EASTERN);
  });

  it("holds for currency, which is where the biggest numbers live", () => {
    const out = formatCurrency(63_407_478, "ar");
    expect(out).not.toMatch(EASTERN);
    expect(out).toContain("63");
  });

  it("holds across magnitudes, decimals and negatives", () => {
    for (const n of [0, 1, 9, 10, 999, 1_000, 1_234.56, -48, -1_000_000, 2_147_483_647]) {
      const out = formatNumber(n, "ar");
      expect([n, EASTERN.test(out)]).toEqual([n, false]);
    }
  });

  it("still renders a missing number as a dash, not a zero", () => {
    // A dash and a zero are different facts. Changing the numbering system
    // must not quietly change that.
    expect(formatNumber(null, "ar")).toBe("—");
    expect(formatNumber(undefined, "ar")).toBe("—");
  });
});

describe("only the digits changed — Arabic is still Arabic", () => {
  it("month and weekday names stay Arabic, on a Gregorian calendar", () => {
    // This assertion is why the calendar is pinned. Unpinned, the same line
    // yields "27 أغسطس 2026" under Chrome and Node and "14 ربيع الأول 1448 هـ"
    // under Bun — and this app server-renders, so those two engines can be the
    // two halves of one page.
    const d = new Date(Date.UTC(2026, 7, 27));
    const out = d.toLocaleDateString(AR_LOCALE, {
      weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });
    expect(out).not.toMatch(EASTERN);
    expect(out).toMatch(/[ء-ي]/); // Arabic letters present
    expect(out).toContain("2026");
    expect(out).toContain("أغسطس");
  });

  it("the calendar is the same one the English toggle shows", () => {
    // Two languages describing one record must not name two different days.
    const d = new Date(Date.UTC(2026, 7, 27));
    const o = { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" } as const;
    const ar = d.toLocaleDateString(AR_LOCALE, o);
    const en = d.toLocaleDateString("en-GB", o);
    // Compare the values, not the strings: Arabic renders the month as "8"
    // and en-GB as "08". Same day, different zero-padding — which is a
    // formatting choice, not a disagreement about which day it is.
    const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);
    expect(nums(ar)).toEqual(nums(en));
    expect(new Intl.DateTimeFormat(AR_LOCALE).resolvedOptions().calendar).toBe("gregory");
  });

  it("resolves to the Western numbering system on this engine", () => {
    expect(new Intl.NumberFormat(AR_LOCALE).resolvedOptions().numberingSystem).toBe("latn");
  });

  it("localeFor routes each language to its own tag", () => {
    expect(localeFor("ar")).toBe(AR_LOCALE);
    expect(localeFor("en")).toBe("en-US");
    // English is overridable for screens that chose day-first dates…
    expect(localeFor("en", "en-GB")).toBe("en-GB");
    // …and Arabic never is. That is the point of the function.
    expect(localeFor("ar", "en-GB")).toBe(AR_LOCALE);
  });

  it("the tag carries the numbering extension, not a different language", () => {
    expect(AR_LOCALE.startsWith("ar")).toBe(true);
    expect(AR_LOCALE).toContain("-u-nu-latn");
    expect(AR_LOCALE).toContain("-ca-gregory");
  });
});

// ── the guard that has to survive the next screen ────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const SRC = join(import.meta.dir, "..");
const FILES = walk(SRC).map((p) => [p.slice(SRC.length + 1), readFileSync(p, "utf8")] as const);

describe("no screen bypasses the shared formatter", () => {
  it("finds the source tree, so an empty pass cannot look like a pass", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("no Intl or toLocale* call is handed a bare Arabic locale", () => {
    // A bare "ar-SA" is the whole defect: it is not wrong, it is Arabic-Indic,
    // which is exactly what we do not want on these screens.
    // The first argument only. `localeFor(ar ? "ar" : "en")` passes a language
    // KEY through the shared helper and is exactly what we want — the guard
    // must not report it, or it will be silenced rather than obeyed.
    const call =
      /(?:\.toLocaleDateString|\.toLocaleString|\.toLocaleTimeString|Intl\.NumberFormat|Intl\.DateTimeFormat)\(\s*(?!localeFor|AR_LOCALE)[^,)]*"ar(?:-SA)?"/g;
    const offenders: string[] = [];
    for (const [name, src] of FILES) {
      for (const m of src.matchAll(call)) offenders.push(`${name}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no toLocale* call is left to the reader's operating system", () => {
    // An argument-less call follows the machine's locale, so the same build
    // shows Western digits on one laptop and Arabic-Indic on the next. A
    // data-* attribute is exempt: it is not read by a person.
    const offenders: string[] = [];
    for (const [name, src] of FILES) {
      for (const m of src.matchAll(/\.toLocale(?:Date|Time)?String\(\s*\)/g)) {
        const line = src.slice(0, m.index).split("\n").pop() ?? "";
        if (/data-[a-z-]+=/.test(line)) continue;
        offenders.push(`${name}: ${line.trim().slice(0, 70)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no Arabic-Indic digit is typed into a user-facing string", () => {
    // "إغلاق خلال ٣٠ يومًا" was on the Command Center. A hardcoded digit is
    // invisible to every formatter, so it survives any change made here.
    const offenders: string[] = [];
    for (const [name, src] of FILES) {
      for (const m of src.matchAll(/["'`]([^"'`\n]*[٠-٩۰-۹][^"'`\n]*)["'`]/g)) {
        const line = src.slice(0, m.index).split("\n").pop() ?? "";
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // a comment may quote one
        offenders.push(`${name}: ${m[1].slice(0, 50)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
