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

describe("one table, one density", () => {
  const RAW_TABLE = /<table\b/;

  it("no page hand-rolls its own table", () => {
    // Seventeen did, and two lists of the same kind of record could differ by a
    // third in row height. The primitive owns density, direction and semantics.
    const offenders = SRC.filter(([p, s]) => p !== "src/components/ui/table.tsx" && RAW_TABLE.test(s)).map(
      ([p]) => p,
    );
    expect(offenders).toEqual([]);
  });

  it("the primitive defaults a column header to scope=col", () => {
    const table = read("src/components/ui/table.tsx");
    expect(table).toContain('scope={scope ?? "col"}');
  });

  it("the primitive aligns by direction, not by side", () => {
    const table = read("src/components/ui/table.tsx").replace(/\/\/[^\n]*/g, "");
    expect(table).not.toMatch(/text-(left|right)\b/);
    expect(table).toContain("text-start");
  });
});

describe("a page's metrics row is the same shape everywhere", () => {
  it("no route hand-writes the KPI grid", () => {
    // One page asked for four columns from 640px up, which put four metrics
    // side by side on a phone.
    const offenders = SRC.filter(
      ([p, s]) => p.startsWith("src/routes") && /grid gap-3 sm:grid-cols-(?:2 (?:xl|lg):grid-cols-[45]|[34])/.test(s),
    ).map(([p]) => p);
    expect(offenders).toEqual([]);
  });
});

describe("focus is always visible", () => {
  it("never removes the outline without putting a ring back", () => {
    const offenders = SRC.flatMap(([p, s]) =>
      [...s.matchAll(/className=(?:"[^"]*"|\{`[^`]*`\})/g)]
        .filter((m) => m[0].includes("focus:outline-none") && !m[0].includes("ring"))
        .map(() => p),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the interface mirrors for Arabic", () => {
  it("never pins a side with a physical class", () => {
    // ms/me/ps/pe and start-/end- flip with the language; ml/mr/pl/pr and
    // left-/right- do not. Tables used to align half their headers each way.
    const offenders = SRC.flatMap(([p, s]) =>
      [...s.matchAll(/className=(?:"[^"]*"|\{`[^`]*`\})/g)]
        .filter((m) => !/\b(rtl|ltr):/.test(m[0]))
        .flatMap((m) => [
          ...(m[0].match(/(?<![\w:./-])(ml|mr|pl|pr)-(?:\d|px|auto|\[)/g) ?? []),
          ...(m[0].match(/(?<![\w:./-])(left|right)-(?:\d|px|auto|full|\[)/g) ?? []),
          ...(m[0].match(/(?<![\w:./-])text-(?:left|right)(?![\w-])/g) ?? []),
        ])
        .map((cls) => `${p}: ${cls}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("nothing is said in colour alone", () => {
  it("pairs every status dot with words", () => {
    // Each of these is a 6px amber circle that was the only marker of unread,
    // AI-derived, or needs-attention.
    for (const file of [
      "src/components/phc/ExecutiveBrief.tsx",
      "src/components/phc/NotificationCenter.tsx",
      "src/components/phc/MetricTile.tsx",
    ]) {
      const s = read(file);
      const dots = (s.match(/rounded-full bg-amber\b/g) ?? []).length;
      const labels = (s.match(/className="sr-only"/g) ?? []).length;
      expect([file, labels >= dots]).toEqual([file, true]);
    }
  });
});

describe("text has a floor", () => {
  it("never sets type below the 12px the scale starts at", () => {
    const offenders = SRC.flatMap(([p, s]) =>
      [...s.matchAll(/text-\[(\d+)px\]/g)]
        .filter((m) => Number(m[1]) < 12)
        .map((m) => `${p}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the wall board readable on a small window", () => {
    // Bare vw sizes fell under 10px below ~1100px wide.
    const board = read("src/routes/_authenticated/board.tsx");
    expect(board).not.toMatch(/fontSize: "[\d.]+vw"/);
    expect(board).toMatch(/fontSize: "clamp\(\d+px, [\d.]+vw, \d+px\)"/);
  });
});

describe("the project board is operable without a mouse", () => {
  it("registers a keyboard sensor for drag and drop", () => {
    const kanban = read("src/components/phc/ProjectKanban.tsx");
    expect(kanban).toContain("useSensor(KeyboardSensor");
    expect(kanban).toContain("coordinateGetter: sortableKeyboardCoordinates");
  });
});
