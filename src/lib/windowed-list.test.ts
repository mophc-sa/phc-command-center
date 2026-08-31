// =============================================================================
// A window that hides rows without saying so is a list that lies by omission.
//
// Someone scrolls to the bottom, sees no more rows, and concludes that is
// everything. Most of what follows is about the counts the UI needs in order
// not to do that.
//
// The hook itself is three lines of useState around these functions; this repo
// carries no React testing library, and adding one to cover a slice() would be
// a dependency bought for a test rather than for the product.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { windowOf, nextLimit, WINDOW_SIZE } from "@/lib/windowed-list";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("it draws a slice and reports the whole", () => {
  it("renders one step and counts what it holds back", () => {
    const w = windowOf(rows(739), WINDOW_SIZE);
    expect(w.visible.length).toBe(WINDOW_SIZE);
    expect(w.total).toBe(739);
    expect(w.hidden).toBe(739 - WINDOW_SIZE);
    expect(w.hasMore).toBe(true);
  });

  it("keeps the order it was given — windowing is not sorting", () => {
    expect(windowOf([9, 8, 7, 6], 2).visible).toEqual([9, 8]);
  });

  it("hides nothing, and offers nothing, when the list already fits", () => {
    const w = windowOf(rows(12), WINDOW_SIZE);
    expect(w.visible.length).toBe(12);
    expect(w.hidden).toBe(0);
    expect(w.hasMore).toBe(false);
  });

  it("handles an empty list without claiming there is more", () => {
    const w = windowOf([], WINDOW_SIZE);
    expect(w.shown).toBe(0);
    expect(w.hidden).toBe(0);
    expect(w.hasMore).toBe(false);
  });

  it("never reports negative hidden, however large the limit", () => {
    // A count below zero would render as "-488 more" on screen.
    expect(windowOf(rows(12), 500).hidden).toBe(0);
    expect(windowOf(rows(12), Number.MAX_SAFE_INTEGER).hidden).toBe(0);
  });

  it("treats a nonsensical limit as none rather than throwing", () => {
    const w = windowOf(rows(10), -5);
    expect(w.shown).toBe(0);
    expect(w.hasMore).toBe(true);
  });
});

describe("extending the window", () => {
  it("adds exactly one step", () => {
    expect(nextLimit(50, 50, 739)).toBe(100);
  });

  it("stops at the end of the list, so repeated presses cannot overshoot", () => {
    expect(nextLimit(50, 50, 60)).toBe(60);
    expect(nextLimit(60, 50, 60)).toBe(60);
  });

  it("never falls below one step, even for a list shorter than one", () => {
    // Clamping to `total` alone would collapse the window to 3 on a 3-row
    // list and then to 3 again — harmless, but it also makes the first step
    // meaningless on an empty list.
    expect(nextLimit(50, 50, 3)).toBe(50);
    expect(nextLimit(50, 50, 0)).toBe(50);
  });
});
