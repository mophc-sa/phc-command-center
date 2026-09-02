// =============================================================================
// The wall board speaks one language.
//
// Asked for on 2026-09-02: "make the language English only, entirely." A screen
// on a wall has one audience and one reading — the bilingual pairs it printed
// (an Arabic line and its English twin, stacked under it) spent space saying
// one thing twice.
//
// What is pinned here is HOW that was done, because the obvious way is worse:
// deleting the Arabic strings would make going back a rewrite. Every bilingual
// branch is left standing and a single constant selects between them.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { readSource } from "@/lib/source-under-test";

const { code: BOARD } = readSource(
  join(import.meta.dir, "..", "routes", "_authenticated", "board.tsx"),
);

describe("one language, chosen in one place", () => {
  it("selects it from a single constant", () => {
    expect(BOARD).toMatch(/const BOARD_LANG: "ar" \| "en" = "en";/);
    expect(BOARD).toContain("const lang = BOARD_LANG;");
  });

  it("declares it at module scope with its union type", () => {
    // A `const lang = "en"` inside the component narrows to the literal, and
    // TypeScript then rejects every `lang === "ar"` comparison in the file as
    // impossible — which would force deleting the other half of every string.
    const at = BOARD.indexOf("const BOARD_LANG");
    const componentAt = BOARD.indexOf("function BoardPage");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(componentAt);
  });

  it("keeps every bilingual branch, so switching back is one value", () => {
    const branches = (BOARD.match(/lang === "ar" \?/g) ?? []).length;
    expect(branches).toBeGreaterThan(50);
  });

  it("no longer prints a label and its translation together", () => {
    // The pattern was: an Arabic heading, then the English underneath in
    // muted text with direction:ltr. Six of them.
    expect(BOARD).not.toMatch(/\{ar\}\s*<\/div>\s*<div className="text-muted-foreground"[^>]*direction: "ltr"[^>]*>\s*\{en\}/);
  });
});

describe("the ticker is sized for a room", () => {
  it("is bigger than the panel text around it", () => {
    // It was 0.76vw — the same size as a table cell, on the one strip that is
    // read from across the room and in motion.
    const m = BOARD.match(/fontSize: "([\d.]+)vw",\n\s*animation: `\$\{lang/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
  });
});

describe("the ranked list looks ranked", () => {
  it("numbers the top opportunities in a coloured badge", () => {
    // A grey digit beside a project name reads as part of the name. The list
    // is ranked, and rank is the reason each row is on it.
    expect(BOARD).toMatch(/background: `var\(--stage-\$\{Math\.min\(i \+ 1, 7\)\}\)`/);
  });
});

describe("the weighted forecast says what it is worth against", () => {
  it("shows a percentage of target only when both halves are real", () => {
    // A percentage of a target nobody set, or of a forecast that could not be
    // computed, is a number with nothing behind it.
    const at = BOARD.indexOf("f={model.weighted}");
    expect(at).toBeGreaterThan(-1);
    const card = BOARD.slice(at, at + 700);
    expect(card).toContain('model.weighted.state === "ok"');
    expect(card).toContain("model.year.target > 0");
    expect(card).toContain("of target");
  });
});

describe("nothing prints Arabic unconditionally", () => {
  it("renders no `{ar}` that ignores the language", () => {
    // The reported symptom: with the board set to English, five KPI titles and
    // the four "needs attention" labels stayed Arabic. Kpi and Need each
    // printed `{ar}` outright — the language constant never reached them.
    expect(BOARD).not.toMatch(/>\{ar\}</);
    expect(BOARD).not.toMatch(/\{ar\}<\/span>/);
  });

  it("routes both card titles through the language", () => {
    const titles = (BOARD.match(/\{lang === "ar" \? ar : en\}/g) ?? []).length;
    expect(titles).toBeGreaterThanOrEqual(4);
  });
});

describe("nothing escapes its box", () => {
  it("clips every card and panel", () => {
    // A wall board has no scrollbar and no reader to drag one, so text that
    // leaves its card is text drawn over the card beside it.
    const cards = BOARD.match(/className="relative flex[^"]*bg-card[^"]*"/g) ?? [];
    for (const c of cards) {
      expect([c, c.includes("overflow-hidden")]).toEqual([c, true]);
      expect([c, c.includes("min-w-0")]).toEqual([c, true]);
    }
    const panels = BOARD.match(/className="flex min-h-0[^"]*bg-card[^"]*"/g) ?? [];
    for (const p of panels) {
      expect([p, p.includes("overflow-hidden")]).toEqual([p, true]);
    }
  });
});

describe("the top opportunities list shows the rest of itself", () => {
  it("scrolls as a seamless loop, not a ping-pong", () => {
    // A share board never runs backwards. Two copies, each pass travelling
    // exactly half the track — measured in a browser at -239.76px against a
    // 240px copy, so the loop closes with no seam.
    expect(BOARD).toContain('className="board-marquee"');
    expect(BOARD).toContain("marquee-up");
    expect(BOARD).toContain("<AutoScroll");
  });

  it("stays still when the list already fits", () => {
    // An idle animation on a static list is movement that means nothing, and
    // on a screen people glance at, movement claims something changed.
    expect(BOARD).toContain("overflow > 8 ?");
    expect(BOARD).toMatch(/seconds > 0 \? \{ animation/);
  });

  it("derives its speed from the content", () => {
    // Six rows at a fixed duration crawl; twenty blur.
    expect(BOARD).toContain("Math.round(copy / 14)");
  });
});
