import { describe, expect, it } from "bun:test";
import {
  initialSearchBox,
  needsCommit,
  onCommit,
  onType,
  onUrlChange,
  type SearchBoxState,
} from "@/lib/search-box";

describe("typing is never interrupted by the router", () => {
  it("keeps every character while a commit is still in flight", () => {
    // The reported bug, as a sequence. The user types "bel", the debounce
    // commits it, and while that navigation is in flight they type "levue".
    // The old code re-rendered the input from the URL and dropped the tail.
    let s = initialSearchBox("");
    for (const ch of "bel") s = onType(s, s.draft + ch);
    s = onCommit(s);                       // we put "bel" in the URL
    for (const ch of "levue") s = onType(s, s.draft + ch);
    s = onUrlChange(s, "bel");             // ...and it arrives back, late
    expect(s.draft).toBe("bellevue");
  });

  it("does not fight itself when the echo arrives before more typing", () => {
    let s = onCommit(onType(initialSearchBox(""), "unified"));
    s = onUrlChange(s, "unified");
    expect(s.draft).toBe("unified");
    expect(s.committed).toBe("unified");
  });
});

describe("a change from outside the box wins", () => {
  it("adopts a drilldown arriving with its own query", () => {
    // A dashboard number links here with `?q=riyadh`. Whatever half-typed text
    // was in the box is not what the user asked for now.
    const s = onUrlChange(onType(initialSearchBox(""), "half typ"), "riyadh");
    expect(s).toEqual({ draft: "riyadh", committed: "riyadh" });
  });

  it("adopts Clear filters emptying the query", () => {
    const s = onUrlChange(onCommit(onType(initialSearchBox(""), "belleview")), "");
    expect(s.draft).toBe("");
  });
});

describe("committing", () => {
  it("reports nothing to do when the draft is already in the URL", () => {
    // Enter pressed twice must not push a second identical history entry.
    const s: SearchBoxState = { draft: "unified", committed: "unified" };
    expect(needsCommit(s)).toBe(false);
    expect(onCommit(s)).toBe(s);
  });

  it("reports work to do as soon as a character differs", () => {
    expect(needsCommit({ draft: "unifie", committed: "unified" })).toBe(true);
  });

  it("commits an empty draft, because clearing the box is a real search", () => {
    const s = onCommit(onType({ draft: "x", committed: "x" }, ""));
    expect(s).toEqual({ draft: "", committed: "" });
  });
});
