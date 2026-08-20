// =============================================================================
// Guards the caching defaults that make the app usable from Saudi Arabia.
//
// The Supabase project is in ap-northeast-1 (Tokyo). Every data call costs
// ~360ms warm, ~1s cold, and that is not something code can fix. What code
// controls is how often the trip is paid.
//
// Before these defaults existed, `new QueryClient()` took React Query's
// out-of-the-box settings — staleTime 0 and refetchOnWindowFocus true. My
// Workspace issues twenty queries and set no staleTime of its own, so every
// return to the page, and every switch back to the browser tab, re-paid twenty
// round trips. The database is tiny; the latency was the whole problem.
//
// A silent revert here would not fail any other test — the app would simply feel
// slow again — so it is pinned.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const routerRaw = readFileSync(join(root, "src/router.tsx"), "utf8");

// The header comment quotes the OLD defaults it replaced ("retry: 3", "staleTime: 0"),
// so matching against the raw file finds the illness rather than the cure.
const router = routerRaw
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

describe("QueryClient caching defaults", () => {
  it("sets global defaults rather than accepting React Query's", () => {
    expect(router).toContain("defaultOptions");
    expect(router).toMatch(/queries:\s*\{/);
  });

  it("keeps data fresh for at least 30 seconds, so navigation reuses it", () => {
    const m = router.match(/staleTime:\s*([0-9_]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ""))).toBeGreaterThanOrEqual(30_000);
  });

  it("retains unmounted queries so going back to a page is free", () => {
    const m = router.match(/gcTime:\s*([0-9_ *]+)/);
    expect(m).not.toBeNull();
  });

  // Alt-tabbing to email and back should not re-download the application.
  it("does not refetch everything when the tab regains focus", () => {
    expect(router).toMatch(/refetchOnWindowFocus:\s*false/);
  });

  it("still refetches after a dropped connection", () => {
    expect(router).toMatch(/refetchOnReconnect:\s*true/);
  });

  // Three retries with backoff turns a clear failure into a long hang.
  it("retries at most once", () => {
    const m = router.match(/retry:\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(1);
  });

  it("lets route preloading be reused instead of refetched on click", () => {
    const m = router.match(/defaultPreloadStaleTime:\s*([0-9_]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ""))).toBeGreaterThan(0);
  });

  it("explains why, so the next person does not tidy it away", () => {
    expect(routerRaw).toContain("ap-northeast-1");
    expect(routerRaw).toContain("invalidateQueries");
  });
});

describe("sidebar selection is legible", () => {
  const shell = readFileSync(join(root, "src/components/phc/AppShell.tsx"), "utf8");
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  // The active pill was bg-sidebar-accent, which is pure white, sitting on a
  // near-white sidebar — the selected page was effectively unmarked.
  it("the selected nav item uses its own dark token, not the hover wash", () => {
    expect(shell).toContain("bg-sidebar-active");
    expect(shell).toContain("text-sidebar-active-foreground");
    expect(shell).not.toMatch(/active\s*\n?\s*\?\s*"bg-sidebar-accent/);
  });

  it("that token is dark, with a white label", () => {
    const bg = styles.match(/--sidebar-active:\s*oklch\(([0-9.]+)/);
    const fg = styles.match(/--sidebar-active-foreground:\s*oklch\(([0-9.]+)/);
    expect(bg).not.toBeNull();
    expect(fg).not.toBeNull();
    expect(Number(bg![1])).toBeLessThan(0.3);   // near-black
    expect(Number(fg![1])).toBeGreaterThan(0.9); // white
  });

  it("the icon follows the label colour", () => {
    expect(shell).toMatch(/active\s*\n?\s*\?\s*"text-sidebar-active-foreground"/);
  });

  // Hover is used all over the shadcn sidebar; recolouring it would have turned
  // every hover black.
  it("leaves the hover token light", () => {
    expect(styles).toMatch(/--sidebar-accent:\s*oklch\(1 0 0\)/);
  });
});

// ─── Freshness must survive the caching change ───────────────────────────────
// Raising staleTime to 60s removed the safety net that a 0 staleTime provided:
// every page used to refetch on mount, so a query key nobody invalidated still
// came back fresh. Roughly a dozen keys read the opportunities table under
// different names, so the state changes visible on more than one screen now
// have to invalidate broadly or a user's own edit could sit hidden for a minute.

describe("mutations still show the user their own change", () => {
  const readFile = (p: string) => readFileSync(join(root, p), "utf8");

  it("the broad-invalidation helper exists and invalidates everything", () => {
    const s = readFile("src/lib/invalidate-sales.ts");
    expect(s).toMatch(/qc\.invalidateQueries\(\)/);
    expect(s).toContain("staleTime");
  });

  // These four are the paths whose result is visible on other pages: stage
  // advance, RFQ→JIH conversion, approval decisions and intake approval.
  for (const [label, path] of [
    ["stage advance / RFQ conversion", "src/components/phc/pipeline/RfqJihPanel.tsx"],
    ["approval decisions", "src/routes/_authenticated/approvals.tsx"],
    ["intake approval", "src/components/phc/IntakeReviewPanel.tsx"],
    ["opportunity detail actions", "src/routes/_authenticated/opportunities.$id.tsx"],
  ] as const) {
    it(`${label} invalidates across pages`, () => {
      expect(readFile(path)).toContain("invalidateSalesData");
    });
  }

  it("the opportunity page keeps its granular per-record invalidation too", () => {
    const s = readFile("src/routes/_authenticated/opportunities.$id.tsx");
    expect(s).toContain('queryKey: ["opp", id]');
  });
});
