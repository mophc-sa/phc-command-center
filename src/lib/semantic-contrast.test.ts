import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
function luminance(token: string) {
  const match = css.match(new RegExp(`--${token}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
  if (!match) throw new Error(`Missing opaque color token: ${token}`);
  const [L, C, h] = match.slice(1).map(Number);
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + .3963377774*a + .2158037573*b)**3;
  const m = (L - .1055613458*a - .0638541728*b)**3;
  const s = (L - .0894841775*a - 1.291485548*b)**3;
  const rgb = [4.0767416621*l - 3.3077115913*m + .2309699292*s, -1.2684380046*l + 2.6097574011*m - .3413193965*s, -.0041960863*l - .7034186147*m + 1.707614701*s].map(v => Math.max(0, Math.min(1, v)));
  return .2126*rgb[0] + .7152*rgb[1] + .0722*rgb[2];
}
for (const foreground of ["foreground", "muted-foreground", "won", "destructive", "amber-light", "info"]) {
  for (const background of ["background", "surface", "surface-2"]) {
    test(`${foreground} body text meets 4.5:1 on ${background}`, () => {
      const a=luminance(foreground), b=luminance(background);
      expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5);
    });
  }
}
