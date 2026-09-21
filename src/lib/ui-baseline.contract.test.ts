// =============================================================================
// Interface rules that a review keeps re-finding, so a test holds them instead.
//
// Each one comes from the 2026-09-20 interface audit, and each failed at least
// once in production code before this file existed.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(name) && !name.includes(".test.")) out.push(rel);
  }
  return out;
}
const SRC = walk("src").map((p) => [p, read(p)] as const);

describe("text stays legible", () => {
  it("never fades a text colour token with an opacity modifier", () => {
    // Measured: muted-foreground at 80% is 3.8:1 on a white card, and every
    // lighter step is worse. Even at 85% it cannot reach the 4.5:1 that body
    // text needs, so the fix is the base token, not a bigger number.
    const offenders = SRC.flatMap(([p, s]) =>
      [...s.matchAll(/text-(?:muted-foreground|destructive|won|amber-light|amber|structural|foreground)\/\d{1,3}\b/g)].map(
        (m) => `${p}: ${m[0]}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps disabled controls above the readable floor", () => {
    // foreground at 50% is 3.45:1; at 60% it is 4.76:1 on a card and 4.6:1 on
    // the page. A disabled control still has to be readable to be understood.
    const offenders = SRC.flatMap(([p, s]) =>
      [...s.matchAll(/disabled:opacity-(\d{1,3})/g)]
        .filter((m) => Number(m[1]) < 60)
        .map((m) => `${p}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("Arabic reads as this business writes numbers", () => {
  it("never passes the bare language tag to a locale formatter", () => {
    // `"ar"` alone gives Arabic-Indic digits and can give a Hijri calendar.
    // localeFor() pins ar-SA-u-nu-latn-ca-gregory, which is what every invoice,
    // bank statement and ERP screen in this company uses.
    const offenders = SRC.flatMap(([p, s]) =>
      [...s.matchAll(/toLocale(?:Date|Time)?String\(\s*lang\s*[),]/g)].map((m) => `${p}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("controls say what they are", () => {
  it("gives every filter dropdown an accessible name", () => {
    // A SelectTrigger renders only its value, so without a name a screen
    // reader announces "All types" and never the word "Type".
    const offenders = SRC.flatMap(([p, s]) =>
      [...s.matchAll(/<SelectTrigger(\s[^>]*)?>/g)]
        .filter((m) => !/aria-label|\bid=/.test(m[0]))
        .map(() => p),
    );
    expect(offenders).toEqual([]);
  });

  it("reports the pressed state of the filter pills", () => {
    // These groups show their selection with a background colour only.
    for (const file of [
      "src/routes/_authenticated/action-center.tsx",
      "src/routes/_authenticated/sales-management.tsx",
    ]) {
      const s = read(file);
      const pills = [...s.matchAll(/<button[^>]*className=\{pill\(/g)].length;
      const pressed = [...s.matchAll(/aria-pressed=\{[^}]*\}[^>]*className=\{pill\(/g)].length;
      expect([file, pressed]).toEqual([file, pills]);
    }
  });
});

describe("a page stylesheet never redefines a shared utility", () => {
  it("leaves Tailwind's type scale alone", () => {
    // `.executive-command .text-xs { font-size: .875rem }` made one class mean
    // two sizes depending on the route. Page-specific sizing is a component
    // prop (KpiTile size="lead"), not a scoped override.
    const css = read("src/styles/command-center.css");
    expect(css).not.toMatch(/\.(text|bg|border|p|m|gap)-[a-z0-9-]+\s*\{/);
  });
});
