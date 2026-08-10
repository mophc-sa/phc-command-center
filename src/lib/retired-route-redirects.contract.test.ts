import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

// QA 2026-08-10 (ISSUE-003): /boq and /rfq-jih are retired routes kept alive so
// old bookmarks resolve into the /quotations tabs. They redirected with
// `throw redirect(...)` from `beforeLoad`. Both sit under `_authenticated`,
// which is `ssr: false`: the server ships a shell for the original URL and the
// client throws the redirect during hydration, which left React's Suspense
// tree unresolved and rendered a completely blank page. Navigating in-app via
// the tab buttons never took that path, so it only ever broke for someone
// following a saved link.
//
// Verified in a browser against a live session: with the component-based
// redirect, /boq renders the BOQ tab (941 chars, 0 runtime errors); with the
// beforeLoad version still in place, /rfq-jih rendered 0 chars and reported a
// runtime error. src/routes/index.tsx already used the component pattern for
// exactly this reason.

const RETIRED_ROUTES = [
  { file: "src/routes/_authenticated/boq.tsx", tab: "boq" },
  { file: "src/routes/_authenticated/rfq-jih.tsx", tab: "rfq_jih" },
];

/** Both files explain the old beforeLoad approach in prose, so assertions
 *  about the mechanism have to look at code only. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("retired /boq and /rfq-jih routes redirect without blanking the page", () => {
  for (const { file, tab } of RETIRED_ROUTES) {
    describe(file, () => {
      const source = readFileSync(join(root, file), "utf8");

      test("redirects from the component, not from beforeLoad", () => {
        const code = stripComments(source);
        expect(code).toContain("<Navigate");
        expect(code).not.toContain("beforeLoad");
        expect(code).not.toContain("throw redirect");
      });

      test("lands on the matching /quotations tab", () => {
        expect(source).toContain('to="/quotations"');
        expect(source).toContain(`tab: "${tab}"`);
      });

      test("replaces history so Back does not bounce off the retired URL", () => {
        expect(source).toContain("replace");
      });
    });
  }

  test("the /quotations route still accepts both retired tabs", () => {
    const source = readFileSync(join(root, "src/routes/_authenticated/quotations.tsx"), "utf8");
    expect(source).toContain('s.tab === "rfq_jih"');
    expect(source).toContain('s.tab === "boq"');
  });
});
