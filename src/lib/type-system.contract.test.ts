// =============================================================================
// One micro-label treatment, and the reason it has to stay one.
//
// `section-label` was already defined in styles.css before this suite existed,
// and almost nothing used it. Counted across the app: **121 places hand-wrote
// `uppercase tracking-[Xem]` instead, using EIGHT different tracking values**
// for the same job — 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22, 0.24em.
//
// No single one of those was wrong. Together they are why the interface looked
// untidy in a way nobody could name: the same idea arrived at eight strengths,
// so a reader could never learn what a small grey label meant.
//
// The second rule here is not cosmetic. **Arabic has no letter case.**
// `text-transform: uppercase` did nothing on half of this bilingual app; all it
// applied was the letter-spacing, which on Arabic script pulls the joins apart
// and makes words harder to read. The design worked in one language and quietly
// degraded the other — and a test is the only thing that will notice, because
// the person writing the next screen is usually looking at the English.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

const SRC = join(import.meta.dir, "..");
const FILES = walk(SRC).map((p) => [p.slice(SRC.length + 1), readFileSync(p, "utf8")] as const);
const CSS = readFileSync(join(SRC, "styles.css"), "utf8");

describe("the micro-label has one definition", () => {
  it("finds the source tree, so an empty pass cannot look like a pass", () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  it("section-label exists and carries no case transform", () => {
    const block = CSS.match(/@utility section-label \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toContain("letter-spacing");
    expect(block).not.toContain("text-transform");
  });

  it("its tracking is a label's, not a headline's", () => {
    const block = CSS.match(/@utility section-label \{[\s\S]*?\n\}/)?.[0] ?? "";
    const em = Number(block.match(/letter-spacing:\s*([\d.]+)em/)?.[1] ?? "1");
    // Above roughly 0.05em the spacing reads as emphasis rather than as a
    // label, and on Arabic it starts breaking the visual join between letters.
    expect(em).toBeLessThanOrEqual(0.05);
  });
});

describe("no screen re-invents it", () => {
  it("the wordmark declares itself instead of being guessed at", () => {
    // `brand-mark` is the one place all-caps is correct, and it exists so the
    // exemption is a decision in the source rather than a pattern this test
    // has to recognise. The first version of this suite tried to spot the
    // wordmark by looking for a token on the same line — and passed three
    // sign-in-screen runs that looked identical in the source, two of which
    // were captions applying uppercase to Arabic.
    const block = CSS.match(/@utility brand-mark \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toContain("text-transform: uppercase");
  });

  it("no component hand-rolls an uppercase micro-label", () => {
    const offenders = FILES.filter(([, src]) => /uppercase\s+tracking-\[/.test(src)).map(([n]) => n);
    expect(offenders).toEqual([]);
  });

  it("arbitrary tracking values have not crept back", () => {
    // Eight values for one idea is what this replaced.
    //
    // 0.3em is allowed and is not a label: it is the one-time-code input on
    // the MFA screens, where wide tracking separates six digits so a person
    // can check what they typed against their authenticator. That is spacing
    // doing a job, which is the distinction this whole rule is about.
    const CODE_FIELD = "0.3";
    const values = new Set<string>();
    for (const [, src] of FILES) {
      for (const m of src.matchAll(/tracking-\[(0\.\d+)em\]/g)) values.add(m[1]);
    }
    expect([...values].sort()).toEqual(["0.02", CODE_FIELD]);
  });
});

describe("Arabic is not an afterthought", () => {
  it("no component applies a case transform at all", () => {
    // A rule about a language, enforced in the language the code is written
    // in: uppercase is a no-op in Arabic, so any screen leaning on it for
    // hierarchy has hierarchy in English only — and the person writing the
    // next screen is usually looking at the English.
    //
    // The wordmark is exempt because it lives in CSS, under `brand-mark`, and
    // is therefore not reachable by this rule at all. That is the point: the
    // exemption is one named place, not a pattern in forty files.
    const offenders: string[] = [];
    for (const [name, src] of FILES) {
      for (const m of src.matchAll(/\buppercase\b/g)) {
        const line = src.slice(0, m.index).split("\n").pop() ?? "";
        offenders.push(`${name}: ${line.trim().slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("case-transforming a data value is not allowed either", () => {
    // `{r.route}` was rendered uppercase in the historical sales table. A
    // label may be styled; a stored value shown to a reader should be what
    // the record holds, or they are not looking at the record.
    for (const [name, src] of FILES) {
      expect([name, /uppercase[^"]*"[^>]*>\{[a-z]/.test(src)]).toEqual([name, false]);
    }
  });
});
