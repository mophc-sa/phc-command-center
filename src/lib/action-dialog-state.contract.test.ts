// PHC Sales OS — Contract test: ActionDialog must not wipe a form in progress.
//
// Field report, 2026-08-05 (Faisal, salesperson): started filling New Intake,
// switched to his email client to copy the RFQ link, came back, and the form
// was empty. He had to start over.
//
// Root cause was a three-part chain, none of which is obvious in isolation:
//
//   1. ActionDialog seeded its inputs in `useEffect(..., [open, fields])`.
//   2. Every caller builds `fields` inline — `fields={newIntakeFields(...)}` —
//      so the array identity changes on every parent render.
//   3. `new QueryClient()` in src/router.tsx takes React Query's default
//      `refetchOnWindowFocus: true`.
//
// So: leaving the window blurred it, returning focused it, React Query
// refetched, the parent re-rendered, `fields` arrived as a new array, the
// effect re-ran, and `setValues(seed)` reset every input to its default.
//
// It affected every dialog in the application, and it only reproduces if you
// leave the window while a dialog is open — which is exactly what a real user
// does when fetching a link, and exactly what internal click-through testing
// does not do.
//
// This repo has no DOM test harness (no testing-library, no .test.tsx files),
// so this is a source-structure test in the same style as the other
// *.contract.test.ts files here. It cannot prove runtime behaviour; it locks
// the two structural properties whose absence caused the bug.
import { test, expect, describe } from "bun:test";

const FILE = "src/components/phc/ActionDialog.tsx";

async function source(): Promise<string> {
  const fs = await import("fs/promises");
  return fs.readFile(FILE, "utf8");
}

/**
 * Source with comments removed. The explanatory comment above the fix quotes the
 * broken dependency array verbatim, so a naive substring search matches the
 * documentation rather than the code. Strip comments and assert on real code.
 */
async function code(): Promise<string> {
  return (await source())
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the seeding effect", () => {
  test("depends on `open` alone — never on `fields`", async () => {
    const src = await code();
    // The exact dependency array that caused the wipe.
    expect(src).not.toContain("[open, fields]");

    // Locate the seeding effect and assert its dependency array.
    const idx = src.indexOf("setValues(seed)");
    expect(idx).toBeGreaterThan(-1);
    const after = src.slice(idx, idx + 400);
    expect(after).toMatch(/\}, \[open\]\)/);
  });

  test("seeds on the rising edge only, not on every render while open", async () => {
    const src = await code();
    // A plain `if (open)` re-seeds whenever the effect runs. The guard must
    // compare against the previous value.
    expect(src).toContain("wasOpen");
    expect(src).toMatch(/if \(open && !wasOpen\.current\)/);
    expect(src).toMatch(/wasOpen\.current = open/);
  });

  test("reads fields through a ref, so their identity cannot trigger a reset", async () => {
    const src = await code();
    expect(src).toContain("fieldsRef");
    expect(src).toMatch(/for \(const f of fieldsRef\.current\)/);
  });
});

describe("callers still hand in freshly-built field arrays", () => {
  // This is the condition that made the bug possible. We are NOT requiring
  // callers to memoise — the fix is deliberately inside ActionDialog so that
  // every current and future caller is safe by default. This test documents
  // that the unstable input is still present, so nobody "fixes" it upstream
  // and assumes the guard below is therefore unnecessary.
  test("newIntakeFields is called inline in the JSX prop", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/routes/_authenticated/lead-tender-inbox.tsx", "utf8");
    expect(src).toMatch(/fields=\{newIntakeFields\(/);
  });

  test("the app relies on React Query's default refetch-on-focus", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/router.tsx", "utf8");
    // If this ever gains explicit defaultOptions, revisit the note above —
    // but the dialog guard should remain regardless, since focus refetching
    // is desirable and the dialog should simply not care.
    expect(src).toContain("new QueryClient(");
  });
});
