// =============================================================================
// Colour was added to the cards. These are the rules it has to keep.
//
// The request was for a dashboard like the reference shots: coloured cards,
// donuts, delta pills. The constraint was the app's own identity — colour in
// the cards, the charts and the numbers, and nowhere else.
//
// Two things get checked here, because both were wrong on the first pass and
// only measurement said so:
//
//   1. A fill that carries meaning clears 3:1 against the surface.
//   2. **Text on a tint of its own hue clears 4.5:1.** `--won` and
//      `--destructive` pass as fills (3.71, 4.35) and fail as 12px labels on an
//      8% tint of themselves (3.40, 3.91). They looked fine; they were not.
//
// The fix was a darker text token, not a paler tint — a pill that fades into
// the card is not a pill.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "@/lib/source-under-test";

const CSS = readFileSync(join(import.meta.dir, "..", "styles.css"), "utf8");

/**
 * oklch(L C H) → sRGB channels, 0-255.
 *
 * Kept separate from luminance on purpose. The first version of this file
 * blended the tint in LUMINANCE space and "proved" that --won cleared 9.1:1 on
 * its own tint. The browser, measured on the real page, said 3.40. Compositing
 * happens in sRGB, so a model that mixes anywhere else is not describing what a
 * reader sees — and a test that confidently confirms a false claim is worse
 * than no test.
 */
function srgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const lin = [
    clamp(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return lin.map((v) => Math.round(gamma(v) * 255)) as [number, number, number];
}

/** Relative luminance of an sRGB triple. */
function luminanceOf(rgb: [number, number, number]): number {
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** `alpha` of `fg` composited over `bg`, in sRGB — as a browser does it. */
function over(fg: [number, number, number], bg: [number, number, number], alpha: number) {
  return fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as [number, number, number];
}

const ratio = (a: number, b: number) => {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

function token(name: string): { L: number; C: number; H: number } | null {
  const m = CSS.match(new RegExp(`\\n\\s*--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
  return m ? { L: +m[1], C: +m[2], H: +m[3] } : null;
}
const rgbOf = (name: string): [number, number, number] => {
  const t = token(name);
  if (!t) throw new Error(`token --${name} not found`);
  return srgb(t.L, t.C, t.H);
};

/** The surface a card sits on. White in this theme. */
const SURFACE: [number, number, number] = [255, 255, 255];
const SURFACE_LUM = luminanceOf(SURFACE);

describe("accent fills carry meaning, so they have to be visible", () => {
  for (const name of ["amber", "won", "info", "destructive"]) {
    it(`--${name} clears 3:1 against the surface`, () => {
      expect([name, +ratio(luminanceOf(rgbOf(name)), SURFACE_LUM).toFixed(2) >= 3]).toEqual([name, true]);
    });
  }
});

describe("text on its own tint is a different question", () => {
  // An 8% tint over white, which is what the pill and chip backgrounds are —
  // composited in sRGB, so the number matches the page.
  const tintLum = (name: string) => luminanceOf(over(rgbOf(name), SURFACE, 0.08));

  it("the on-tint tokens exist at all", () => {
    // They exist because the ordinary ones failed here. Deleting them and
    // reaching for --won again is the regression this guards.
    expect(token("won-on-tint")).not.toBeNull();
    expect(token("destructive-on-tint")).not.toBeNull();
  });

  for (const [text, tint] of [
    ["won-on-tint", "won"],
    ["destructive-on-tint", "destructive"],
  ] as const) {
    it(`--${text} clears 4.5:1 on an 8% ${tint} tint`, () => {
      expect([text, +ratio(luminanceOf(rgbOf(text)), tintLum(tint)).toFixed(2) >= 4.5]).toEqual([text, true]);
    });
  }

  it("the plain tokens would NOT have passed — which is why these exist", () => {
    // Stated as an assertion so the record cannot rot into a comment nobody
    // believes. If a future palette change makes --won pass here, this fails
    // and someone gets to simplify deliberately rather than by accident.
    expect(ratio(luminanceOf(rgbOf("won")), tintLum("won"))).toBeLessThan(4.5);
  });
});

describe("colour stays inside the cards", () => {
  const { code: PILL } = readSource(join(import.meta.dir, "..", "components", "phc", "DeltaPill.tsx"));

  it("the delta pill uses the on-tint tokens, not the fills", () => {
    expect(PILL).toMatch(/text-won-on-tint/);
    expect(PILL).toMatch(/text-destructive-on-tint/);
  });

  it("up is not automatically good", () => {
    // More opportunities is welcome; more losses is not, and one green arrow
    // for both would be worse than no colour. The caller has to say.
    expect(PILL).toMatch(/goodDirection/);
  });

  it("no pill is drawn without a real comparison", () => {
    expect(PILL).toMatch(/if \(!delta \|\| delta\.ratio === null\) return null;/);
  });
});
