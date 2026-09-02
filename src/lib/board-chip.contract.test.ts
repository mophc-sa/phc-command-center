// =============================================================================
// The pulse and the forecast draw the same chip. This is what stops them
// drifting apart again.
//
// They already did once. Both grids were written `flex-1`, so each stretched to
// whatever height its own panel had spare: 85px against 117px, and a 32.6px
// figure against 27.8px. Same width, same padding, same radius -- and visibly
// different boxes sitting side by side.
//
// The fix was one component and one set of constants. What is guarded here is
// that neither panel goes back to sizing its own row.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "@/lib/source-under-test";

// `.code`, never `.raw` -- the comments below quote "flex-1" and "CHIP_ROW_H",
// which is exactly the trap source-under-test.ts exists to close.
const { code: BOARD } = readSource(
  join(import.meta.dir, "..", "routes", "_authenticated", "board.tsx"),
);

describe("the two chip grids stay the same size", () => {
  it("declares the chip height and type scale exactly once each", () => {
    for (const name of ["CHIP_ROW_H", "CHIP_KICKER_H", "CHIP_FIGURE", "CHIP_LABEL", "CHIP_NOTE"]) {
      const declarations = BOARD.match(new RegExp(`const ${name} =`, "g")) ?? [];
      expect([name, declarations.length]).toEqual([name, 1]);
    }
  });

  it("declares the chip row in exactly one place", () => {
    // Identical rows would pass a per-row check and still drift, because
    // nothing forces the next edit to touch them all. There is one row.
    //
    // The column count became a prop on 2026-09-02, when "changed since
    // yesterday" went to five tiles to match the reference design. The HEIGHT
    // did not, which is the property that kept the three panels level -- so
    // that is what is still pinned here.
    const rows = BOARD.match(/<div\s+className="grid shrink-0 gap-\[[\d.]+vw\]"[\s\S]{0,220}?>/g) ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain("height: CHIP_ROW_H");
    expect(rows[0]).toContain("gridTemplateColumns");
    // `flex-1` is precisely how they diverged: it hands the row whatever the
    // panel has left, which is a different number in each panel.
    expect(rows[0]).not.toContain("flex-1");
  });

  it("routes the chip panels through ChipRow, and every chip through Chip", () => {
    // Alignment came from the kicker slot and the row living in one component.
    // A panel that hand-rolls either one goes back to starting 26px lower.
    //
    // Two, not three: the forecast panel stopped using chips on 2026-09-02.
    // The reference design shows three plain figures there, and it is right --
    // 30 / 60 / 90 is read as one series, and three bordered boxes read as
    // three separate facts.
    expect((BOARD.match(/<ChipRow\b/g) ?? []).length).toBe(2);
    expect((BOARD.match(/<Chip\b(?!Row)/g) ?? []).length).toBe(2);
    // The inset ring is the chip's own chrome; nothing outside Chip draws it.
    expect((BOARD.match(/inset 0 0 0 1px/g) ?? []).length).toBe(1);
    // The kicker slot is what holds the three rows level; one declaration.
    expect((BOARD.match(/height: CHIP_KICKER_H/g) ?? []).length).toBe(1);
  });

  it("sizes every chip figure from the constant, never a literal", () => {
    const figures = BOARD.match(/fontSize: CHIP_FIGURE/g) ?? [];
    expect(figures.length).toBeGreaterThanOrEqual(2);
  });
});

describe("every colour class on the board resolves to a real token", () => {
  // `text-amber-deep` was written in seven places and the token behind it never
  // existed. Tailwind does not warn -- an unknown utility emits nothing, the
  // text inherits the foreground, and the page looks plausible. It was found
  // only by reading a computed colour in the browser and seeing oklch(0.2 …)
  // where amber should have been.
  //
  // Nothing else here can catch that class of defect: it type-checks, it
  // builds, and it renders. So the check is source-level and mechanical.
  const CSS = readFileSync(join(import.meta.dir, "..", "styles.css"), "utf8");

  /** Tailwind utilities that are alignment/size/wrapping, not colour. */
  const NOT_COLOUR = /^(start|end|center|left|right|justify|balance|pretty|wrap|nowrap|clip|ellipsis|xs|sm|base|lg|\d?xl|\[)/;

  it("names no text-* colour that styles.css never defines", () => {
    const used = [...new Set([...BOARD.matchAll(/\btext-([a-z][a-z0-9-]*)\b/g)].map((m) => m[1]))]
      .filter((n) => !NOT_COLOUR.test(n) && n !== "white" && n !== "black");
    expect(used.length).toBeGreaterThan(4);
    const undefined_ = used.filter((n) => !CSS.includes(`--color-${n}:`));
    expect(undefined_).toEqual([]);
  });

  it("names no bg-* colour that styles.css never defines", () => {
    const used = [...new Set([...BOARD.matchAll(/\bbg-([a-z][a-z0-9-]*)(?:\/\d+)?\b/g)].map((m) => m[1]))]
      .filter((n) => !["white", "black", "transparent", "clip", "cover", "contain", "center", "none"].includes(n));
    const undefined_ = used.filter((n) => !CSS.includes(`--color-${n}:`));
    expect(undefined_).toEqual([]);
  });
});

describe("no chip line is reserved with nothing in it", () => {
  it("renders no non-breaking-space filler", () => {
    // A blank line still occupies its height, so the ink above it stops early
    // and the chip's content reads as sitting high -- measured at 11.5px above
    // its neighbours' on the "new deals" tile, against 0.9px everywhere else.
    // Every line either says something true or is not rendered.
    // Narrowly: a nbsp used AS a line's content. The wire joins its headlines
    // with nbsp separators, which is that character doing its actual job.
    expect(BOARD).not.toMatch(/\?\?\s*"\\u00a0"/);
    expect(BOARD).not.toMatch(/[:?]\s*"\\u00a0"\s*[},)]/);
    expect(BOARD).not.toMatch(/&nbsp;/);
  });
});

describe("the number sits on the left in both languages", () => {
  it("reverses the row in Arabic, and only in Arabic", () => {
    // A plain `row` puts the first flex child on the READING edge, which is the
    // right in Arabic -- so the same markup that reads correctly in English put
    // every number on the wrong side of every chip. Measured in the browser
    // before this line existed: everyFigureOnTheLeft: false, all nine.
    expect(BOARD).toMatch(/flexDirection:\s*lang === "ar" \? "row-reverse" : "row"/);
  });

  it("gives the number column a fixed width rather than letting it shrink to fit", () => {
    // "5" and "237" are different widths. Sized per chip, the text column would
    // start at three different x positions across a row of three.
    expect(BOARD).toMatch(/width: CHIP_FIGURE_W/);
    expect((BOARD.match(/const CHIP_FIGURE_W =/g) ?? []).length).toBe(1);
  });
});
