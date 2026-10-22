import { describe, expect, it } from "bun:test";
import { activeSectionIndex, isOwnedTarget, sectionStepFor, stepFrom, stepTarget } from "@/lib/section-nav";

const key = (k: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe("which key moves between sections", () => {
  it("is Option/Alt with an arrow", () => {
    expect(sectionStepFor(key("ArrowDown", { altKey: true }))).toBe("next");
    expect(sectionStepFor(key("ArrowUp", { altKey: true }))).toBe("prev");
  });

  it("leaves the bare arrows to scroll the page as they always have", () => {
    expect(sectionStepFor(key("ArrowDown"))).toBeNull();
    expect(sectionStepFor(key("ArrowUp"))).toBeNull();
  });

  it("ignores other chords, so ⌥⇧↓ still selects text and ⌘↓ still goes to the end", () => {
    expect(sectionStepFor(key("ArrowDown", { altKey: true, shiftKey: true }))).toBeNull();
    expect(sectionStepFor(key("ArrowDown", { altKey: true, metaKey: true }))).toBeNull();
    expect(sectionStepFor(key("ArrowDown", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(sectionStepFor(key("ArrowLeft", { altKey: true }))).toBeNull();
  });

  it("ignores a key something else already handled, and IME composition", () => {
    expect(sectionStepFor({ ...key("ArrowDown", { altKey: true }), defaultPrevented: true })).toBeNull();
    expect(sectionStepFor({ ...key("ArrowDown", { altKey: true }), isComposing: true })).toBeNull();
  });
});

describe("typing always wins", () => {
  it("keeps the key for text boxes and lists", () => {
    expect(isOwnedTarget({ tagName: "INPUT" })).toBe(true);
    expect(isOwnedTarget({ tagName: "textarea" })).toBe(true);
    expect(isOwnedTarget({ tagName: "SELECT" })).toBe(true);
    expect(isOwnedTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("keeps the key inside dialogs, menus and listboxes", () => {
    expect(isOwnedTarget({ tagName: "BUTTON", closest: (s: string) => (s.includes("dialog") ? {} : null) })).toBe(true);
  });

  it("gives the page a key pressed on the page itself", () => {
    expect(isOwnedTarget({ tagName: "BODY", closest: () => null })).toBe(false);
    expect(isOwnedTarget({ tagName: "A", closest: () => null })).toBe(false);
    expect(isOwnedTarget(null)).toBe(false);
  });
});

describe("where a step lands", () => {
  const tops = [100, 600, 1400, 2000];

  it("knows which section is being read", () => {
    expect(activeSectionIndex(tops, 0)).toBe(0);
    expect(activeSectionIndex(tops, 650)).toBe(1);
    expect(activeSectionIndex(tops, 5000)).toBe(3);
    expect(activeSectionIndex([], 0)).toBe(-1);
  });

  it("goes to the next section, and stops at the last", () => {
    expect(stepTarget(tops, 600, "next")).toBe(2);
    expect(stepTarget(tops, 2000, "next")).toBe(3);
  });

  it("from a section's top, goes to the one before it, and stops at the first", () => {
    expect(stepTarget(tops, 600, "prev")).toBe(0);
    expect(stepTarget(tops, 100, "prev")).toBe(0);
  });

  it("from part-way through a long section, goes back to its own top first", () => {
    expect(stepTarget(tops, 1000, "prev")).toBe(1);
  });

  it("does nothing on a page with no sections", () => {
    expect(stepTarget([], 0, "next")).toBe(-1);
  });
});

describe("pressing again before the page has arrived", () => {
  const tops = [100, 600, 1400, 2000];

  it("counts from the last jump while the scroll is still on its way", () => {
    const last = { index: 1, y: 540, at: 1000 };
    // Still near the top mid-scroll; read from position alone this would aim at 1 again.
    expect(stepFrom(tops, 120, "next", last, 60, 1300)).toBe(2);
  });

  it("counts from the last jump at the foot of the page, where scrolling cannot move", () => {
    const last = { index: 2, y: 1500, at: 0 };
    expect(stepFrom(tops, 1564, "next", last, 1500, 60_000)).toBe(3);
  });

  it("reads the position again once the person has scrolled away", () => {
    const last = { index: 3, y: 1940, at: 0 };
    expect(stepFrom(tops, 664, "next", last, 600, 60_000)).toBe(2);
  });

  it("reads the position when there was no jump yet", () => {
    expect(stepFrom(tops, 664, "next", null, 600, 0)).toBe(2);
  });
});
