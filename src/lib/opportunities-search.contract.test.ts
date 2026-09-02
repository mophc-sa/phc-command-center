// =============================================================================
// The opportunities search box, as a rule rather than a habit.
//
// Reported 2026-09-02: typing in it and pressing Enter "does not work". The
// input was `value={routeSearch.q}` with an `onChange` that navigated —
// navigation is async, so React re-rendered the field from a URL that had not
// caught up and the DOM value was reset mid-word. Enter did nothing because
// there was no form and no key handler.
//
// The URL binding itself is worth keeping: it is what makes a filtered list
// shareable and reachable from a dashboard drilldown. What is guarded here is
// that the INPUT is never bound straight to it again.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { readSource } from "@/lib/source-under-test";

// `.code`, never `.raw` — the comments in that file quote the very binding
// these assertions forbid.
const { code: PAGE } = readSource(
  join(import.meta.dir, "..", "routes", "_authenticated", "opportunities.index.tsx"),
);

describe("the search input is not wired to the router", () => {
  it("shows a local draft, not the route value", () => {
    expect(PAGE).toContain("value={box.draft}");
    expect(PAGE).not.toContain("value={search}");
  });

  it("does not navigate on every keystroke", () => {
    // `onChange={(e) => setSearch(e.target.value)}` was one navigation per
    // character, and the source of the dropped letters.
    expect(PAGE).not.toMatch(/onChange=\{\(e\) => setSearch\(/);
    expect(PAGE).toMatch(/onChange=\{\(e\) => setBox\(/);
  });

  it("handles Enter", () => {
    // The literal complaint. Without this the key does nothing at all.
    expect(PAGE).toMatch(/e\.key === "Enter"/);
    expect(PAGE).toContain("commitSearch(box)");
  });

  it("still lets an external change take over the box", () => {
    // A drilldown arriving with ?q=… must replace what is in the field, or the
    // list and the box disagree about what is being searched.
    expect(PAGE).toContain("onUrlChange(b, search)");
  });

  it("keeps the query in the URL, so a filtered list is still shareable", () => {
    expect(PAGE).toContain("patch({ q: next.committed })");
  });
});
