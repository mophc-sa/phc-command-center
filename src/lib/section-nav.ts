// =============================================================================
// Jumping between the sections of a long page.
//
// Manager feedback 2026-10-19: "navigate between sections with the arrows, the
// way Apple does it." The deal page is twenty-odd panels deep; scrolling past
// them to reach Follow-ups is the slow part of opening a deal.
//
// Two decisions worth stating:
//
//   1. **⌥↑ / ⌥↓, not the bare arrows.** The bare arrows already scroll the
//      page a line at a time, and people who read with the keyboard rely on
//      that. Taking them over would make the page jump a whole panel for a key
//      that used to nudge it. Alt is the Option key on a Mac keyboard.
//
//   2. **Typing always wins.** In a text box ⌥↑ moves the caret to the start
//      of the paragraph; in a list or menu the arrows belong to the list. The
//      page only answers when the key was pressed on the page itself.
// =============================================================================

export type SectionStep = "next" | "prev";

type KeyLike = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
};

/** What a key press asks the page to do, if anything. */
export function sectionStepFor(e: KeyLike): SectionStep | null {
  if (e.defaultPrevented || e.isComposing) return null;
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key === "ArrowDown") return "next";
  if (e.key === "ArrowUp") return "prev";
  return null;
}

type ElementLike = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
};

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// Widgets that use the arrow keys themselves. A page jump in the middle of a
// listbox would be the page arguing with the control.
const ARROW_OWNERS =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="menubar"],[role="listbox"],' +
  '[role="combobox"],[role="tablist"],[role="slider"],[role="grid"],[role="tree"],[role="radiogroup"]';

/** Whether the key press belongs to whatever has focus rather than to the page. */
export function isOwnedTarget(el: ElementLike | null | undefined): boolean {
  if (!el) return false;
  if (el.tagName && TYPING_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === "function" && el.closest(ARROW_OWNERS)) return true;
  return false;
}

/**
 * The section being read: the last one whose top has passed the reading line.
 * `tops` are document offsets in page order; `line` is scrollY plus the header
 * height and a little air.
 */
export function activeSectionIndex(tops: number[], line: number): number {
  if (tops.length === 0) return -1;
  let active = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= line + 1) active = i;
    else break;
  }
  return active;
}

/**
 * Where a step lands.
 *
 * "Previous" from the middle of a long section goes to that section's own top
 * first, the way a book's "previous chapter" does when you are halfway through
 * one -- otherwise one press would skip back past the section you are in.
 */
export function stepTarget(tops: number[], line: number, step: SectionStep): number {
  if (tops.length === 0) return -1;
  const i = activeSectionIndex(tops, line);
  if (step === "next") return Math.min(i + 1, tops.length - 1);
  const partWay = line - tops[i] > 24;
  if (partWay) return i;
  return Math.max(i - 1, 0);
}

/** Where the last jump went, and where the page was heading for it. */
export type LastJump = { index: number; y: number; at: number };

/**
 * Where a step lands when the previous jump may not have finished.
 *
 * Read from the scroll position alone, a second press during a smooth scroll
 * aims at the section already on its way in, and at the foot of the page --
 * where the last short sections cannot scroll up to the top -- every press
 * aims at the same one. So while the page is still heading for, or sitting at,
 * where the last jump put it, the next step counts from that jump.
 */
export function stepFrom(
  tops: number[],
  line: number,
  step: SectionStep,
  last: LastJump | null,
  scrollY: number,
  now: number,
): number {
  if (tops.length === 0) return -1;
  const inFlight = last && now - last.at < 700;
  const stillThere = last && Math.abs(scrollY - last.y) < 4;
  if (last && (inFlight || stillThere) && last.index < tops.length) {
    return step === "next" ? Math.min(last.index + 1, tops.length - 1) : Math.max(last.index - 1, 0);
  }
  return stepTarget(tops, line, step);
}

/** The index pill is noise on a short page. */
export const MIN_SECTIONS_FOR_INDEX = 4;
