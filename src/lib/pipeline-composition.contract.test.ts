// =============================================================================
// The stage ramp and the composition bar: the parts that can be wrong quietly.
//
// A bar chart is the one place a mistake looks like a design choice. A segment
// rendered at the wrong width, a stage rounded to 0%, a fill too pale to see —
// each of those reads as "that is how the data is", and nobody checks a
// picture the way they check a number.
//
// Two of these rules exist because the first draft broke them and only
// measurement caught it:
//
//   · Three of the seven fills failed 3:1 against the surface while a comment
//     in the same file claimed all seven passed. `getComputedStyle` returns raw
//     oklch components, so a contrast check that reads them as RGB produces
//     confident nonsense — 8.68:1 for every slate tone, identically.
//   · A stage holding SAR 137,000 rendered as "0%".
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "@/lib/source-under-test";
import { CANONICAL_FUNNEL_ORDER } from "@/lib/stage-canonical";

const CSS = readFileSync(join(import.meta.dir, "..", "styles.css"), "utf8");
// `.code`, never `.raw` — the comments in that file quote the very strings
// these assertions forbid. See source-under-test.ts.
const { code: COMPONENT } = readSource(
  join(import.meta.dir, "..", "components", "phc", "PipelineComposition.tsx"),
);

// ---- the ramp ---------------------------------------------------------------

/** oklch(L C H) → relative luminance, via the same path a browser takes. */
function oklchToLuminance(L: number, C: number, Hdeg: number): number {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  // linear sRGB
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(bl);
}

const contrast = (a: number, b: number) => {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

function ramp(): Array<{ tone: number; L: number; C: number; H: number }> {
  const out: Array<{ tone: number; L: number; C: number; H: number }> = [];
  for (let i = 1; i <= 7; i++) {
    const m = CSS.match(new RegExp(`--stage-${i}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
    if (m) out.push({ tone: i, L: +m[1], C: +m[2], H: +m[3] });
  }
  return out;
}

describe("the stage ramp", () => {
  const R = ramp();

  it("defines one colour per canonical stage — no more, no fewer", () => {
    expect(R.length).toBe(CANONICAL_FUNNEL_ORDER.length);
  });

  it("every fill clears 3:1 against the surface", () => {
    // The WCAG floor for a graphical object that carries meaning. A segment
    // the reader cannot see is a segment that is not there.
    const white = 1;
    const failing = R.filter((s) => contrast(oklchToLuminance(s.L, s.C, s.H), white) < 3);
    expect(failing.map((s) => s.tone)).toEqual([]);
  });

  it("darkens monotonically within each band, so order is legible without the legend", () => {
    const preAward = R.slice(0, 4).map((s) => s.L);
    const contracted = R.slice(5).map((s) => s.L);
    for (let i = 1; i < preAward.length; i++) expect(preAward[i]).toBeLessThan(preAward[i - 1]);
    for (let i = 1; i < contracted.length; i++) expect(contracted[i]).toBeLessThan(contracted[i - 1]);
  });

  it("changes hue exactly twice: at the handshake, and at the signature", () => {
    // This said ONCE until 2026-09-01, splitting the funnel at stage 5 into
    // "not yet ours" and "committed, still losable". The split was right and is
    // kept; what changed is that a verbal award and a signed contract stopped
    // sharing a band. PIPELINE_BUCKETS already separates them -- one is losable
    // and one is invoiceable -- and a ramp that drew them the same colour was
    // the last place on the board still blurring the two.
    //
    // The rule the original was protecting is unchanged and still enforced
    // below: the hue moves ONLY where something commercial changes. Two
    // boundaries, two changes, and none inside a band.
    const hues = R.map((s) => s.H);
    const changes = hues.slice(1).filter((h, i) => h !== hues[i]).length;
    expect(changes).toBe(2);
    expect(hues[3]).not.toBe(hues[4]); // ترسية شفهية تفارق ما قبلها
    expect(hues[4]).not.toBe(hues[5]); // والعقد يفارق الترسية
    expect(new Set(hues.slice(0, 4)).size).toBe(1); // ولا تغيّر داخل النطاق
    expect(new Set(hues.slice(5)).size).toBe(1);
  });
});

// ---- the component's rules --------------------------------------------------

describe("the composition bar does not lie about small stages", () => {
  it("a stage holding money never renders as 0%", () => {
    // SAR 137,000 in a 63M book is 0.2%. Rounded, it is a stage that looks
    // empty and is not.
    expect(COMPONENT).toMatch(/p > 0 && p < 1/);
    expect(COMPONENT).toMatch(/maximumFractionDigits: 1/);
  });

  it("uses no mirrored comparison operator", () => {
    // "<1%" renders as "1%>" in the Arabic layout — `<` is a mirrored
    // character, so the reader has to know the bidi rules to recover the
    // meaning. A decimal needs no mirroring.
    expect(COMPONENT).not.toContain("<1%");
  });

  it("states what the total leaves out, on the total", () => {
    // A headline figure that silently drops records is the exact failure this
    // dashboard spent a week removing.
    expect(COMPONENT).toMatch(/unvaluedCount/);
    expect(COMPONENT).toMatch(/غير مشمولة|not included/);
  });

  it("segment width comes from the value, not from the count", () => {
    // Sizing by count would draw thirty small deals larger than one large
    // one, which is the opposite of what a value bar is for.
    expect(COMPONENT).toMatch(/flexGrow: s\.value/);
  });
});

describe("colour is never the only carrier", () => {
  it("every legend row writes its own label and figure", () => {
    expect(COMPONENT).toMatch(/\{s\.label\}/);
    expect(COMPONENT).toMatch(/formatCurrency\(s\.value, lang\)/);
  });

  it("the bar is announced as one image with the breakdown in words", () => {
    expect(COMPONENT).toMatch(/role="img"/);
    expect(COMPONENT).toMatch(/aria-label=\{slices/);
  });

  it("the swatches are decorative, because the row already says it", () => {
    expect(COMPONENT).toMatch(/aria-hidden="true"/);
  });
});
