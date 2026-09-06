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

describe("every figure on the board carries an icon", () => {
  // Lucide components, not emoji. Emoji carry each platform's own colour, so an
  // "amber" card had a red glyph in it and the tinted badge behind it fought
  // whatever the font decided. A Lucide glyph takes `currentColor`, which is
  // the whole point of the badge.
  it("uses components, never emoji", () => {
    expect(BOARD).toContain("type LucideIcon");
    expect(BOARD).not.toMatch(/icon="[^"a-zA-Z]/);
  });

  it("gives all four attention cards one", () => {
    // Asked for on 2026-09-02: "make sure all the icons are added." The panels
    // had them; these four figures were the exception, so the row read as
    // plainer than everything around it.
    const needs = BOARD.match(/<Need\b/g) ?? [];
    const withIcon = BOARD.match(/<Need icon=\{/g) ?? [];
    expect(needs.length).toBe(4);
    expect(withIcon.length).toBe(needs.length);
  });

  it("makes the icon required rather than optional on that card", () => {
    // Optional is how three of four end up with one.
    const at = BOARD.indexOf("function Need({");
    expect(BOARD.slice(at, at + 900)).toMatch(/icon: LucideIcon;/);
  });

  it("gives every panel one", () => {
    const panels = BOARD.match(/<Panel\b/g) ?? [];
    const iconed = BOARD.match(/icon=\{[A-Z]\w+\}/g) ?? [];
    expect(panels.length).toBeGreaterThan(0);
    expect(iconed.length).toBeGreaterThanOrEqual(panels.length);
  });

  it("gives the five 'changed since yesterday' tiles one each", () => {
    const minis = BOARD.match(/<Mini\b/g) ?? [];
    const withIcon = BOARD.match(/<Mini cols=\{5\} icon=\{/g) ?? [];
    expect(minis.length).toBe(5);
    expect(withIcon.length).toBe(5);
  });

  it("draws every icon at one size per role", () => {
    // Asked for in the same breath as the icons themselves, and again on
    // 2026-09-06: "bigger, and with no background". Four icon sizes, each tied
    // to what it labels -- a headline card, a panel header, an attention
    // figure, a movement tile. The fifth match is the gauge, which is a chart.
    //
    // Pinned exactly rather than counted. "At most five" is what let 0.8 and
    // 0.85 coexist for a week: a difference nobody can see and every reader
    // can feel, because it is the drift that makes a grid look hand-placed.
    const sizes = [...new Set((BOARD.match(/h-\[[\d.]+vw\] w-\[[\d.]+vw\]/g) ?? []))];
    expect(sizes.sort()).toEqual([
      // Lexical, not numeric: "1.35" sorts before "1.3v" because '5' < 'v'.
      "h-[1.1vw] w-[1.1vw]",
      "h-[1.35vw] w-[1.35vw]",
      "h-[1.5vw] w-[1.5vw]",
      "h-[1.7vw] w-[1.7vw]",
      "h-[3vw] w-[3vw]",
    ]);
  });
});

describe("no icon sits on a badge, and the rows alternate", () => {
  it("carries no tinted square behind any glyph", () => {
    // Asked for on 2026-09-06: "every icon with no background, and bigger."
    // The badge was doing two jobs -- carrying the tone and separating the
    // glyph from the card -- and on a wall screen only the first is worth the
    // ink. The tone moved onto the glyph itself.
    expect(BOARD).not.toContain("background: TONE[tone].wash, color: TONE[tone].edge");
    expect(BOARD).not.toContain("function badgeStyle(");
    // Nor the dark ground that badge existed to sit on.
    expect(BOARD).not.toContain("board-dark");
    expect(BOARD).not.toContain("DARK_GROUND");
  });

  it("keeps the tone on the glyph, so colour still says which kind of thing", () => {
    // A bare icon that inherits `currentColor` is a grey icon. Every one of
    // them takes the tone's edge explicitly.
    const bare = BOARD.match(/<Icon\b[^>]*\/>/gs) ?? [];
    expect(bare.length).toBeGreaterThan(3);
    for (const m of bare) {
      expect([m.slice(0, 40), /TONE\[tone\]\.edge/.test(m)]).toEqual([m.slice(0, 40), true]);
    }
  });

  it("bands the rows off one shared function", () => {
    // Two grounds, chosen once. Measured: --muted is 1.17:1 against the white
    // card, which reads across a room; --surface-2 is 1.06:1, which is a
    // difference in the stylesheet and not on the screen.
    expect(BOARD).toContain('return band ? "bg-muted" : "bg-card";');
    // And no card paints its own ground behind the helper's back.
    const cards = BOARD.match(/rounded-\[0\.7vw\] border border-border\/70 bg-card/g) ?? [];
    expect(cards.length).toBe(0);
  });

  it("tints the second and fourth rows, and leaves the first and third white", () => {
    // Five KPI cards white, then the attention row tinted, then the three
    // lists white, then the bottom three tinted.
    expect((BOARD.match(/<Panel band /g) ?? []).length).toBe(5);
  });
});
