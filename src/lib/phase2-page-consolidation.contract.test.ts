// Contract test for Phase 2's page consolidation — static source inspection
// verifying /rfq-jih and /boq are redirects (not deleted, so old bookmarks
// don't 404) into /quotations' tabs, and that the sidebar/command palette no
// longer list them as separate primary destinations. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");

function read(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), "utf8");
}

// QA 2026-08-10 (ISSUE-003): these two tests used to assert the redirect
// mechanism itself — `beforeLoad: () => { throw redirect(...) }`. That
// mechanism turned out to be the bug: under the `ssr: false` `_authenticated`
// layout, throwing the redirect during hydration left React's Suspense tree
// unresolved and a direct hit on /boq or /rfq-jih rendered a blank page. The
// assertions now cover the contract that actually matters — the retired route
// still exists and lands on the right /quotations tab — and leave the
// mechanism free to change. See retired-route-redirects.contract.test.ts.

test("/rfq-jih redirects to /quotations?tab=rfq_jih", () => {
  const source = read("src/routes/_authenticated/rfq-jih.tsx");
  expect(source).toMatch(/to="\/quotations"/);
  expect(source).toMatch(/tab: "rfq_jih"/);
  // Not deleted — still exports a Route so old links resolve instead of 404ing.
  expect(source).toMatch(/export const Route = createFileRoute\("\/_authenticated\/rfq-jih"\)/);
});

test("/boq redirects to /quotations?tab=boq", () => {
  const source = read("src/routes/_authenticated/boq.tsx");
  expect(source).toMatch(/to="\/quotations"/);
  expect(source).toMatch(/tab: "boq"/);
  expect(source).toMatch(/export const Route = createFileRoute\("\/_authenticated\/boq"\)/);
});

test("/quotations validates the tab search param with a safe default", () => {
  const source = read("src/routes/_authenticated/quotations.tsx");
  expect(source).toMatch(/validateSearch: \(s: Record<string, unknown>\) => \(\{/);
  expect(source).toMatch(/tab: s\.tab === "rfq_jih".*s\.tab === "boq".*"quotations" as const/);
  expect(source).toMatch(/import \{ QuotationsPanel \} from "@\/components\/phc\/pipeline\/QuotationsPanel";/);
  expect(source).toMatch(/import \{ RfqJihPanel \} from "@\/components\/phc\/pipeline\/RfqJihPanel";/);
  expect(source).toMatch(/import \{ BoqPanel \} from "@\/components\/phc\/pipeline\/BoqPanel";/);
});

test("sidebar no longer lists /rfq-jih or /boq as separate nav items", () => {
  const source = read("src/components/phc/AppShell.tsx");
  expect(source).not.toMatch(/to: "\/rfq-jih"/);
  expect(source).not.toMatch(/to: "\/boq"/);
  // /quotations itself must still be present.
  expect(source).toMatch(/to: "\/quotations"/);
});

test("command palette no longer lists /rfq-jih or /boq as separate destinations", () => {
  const source = read("src/components/phc/CommandPalette.tsx");
  expect(source).not.toMatch(/to: "\/rfq-jih"/);
  expect(source).not.toMatch(/to: "\/boq"/);
  expect(source).toMatch(/to: "\/quotations"/);
});

test("action-center routes 'rfq' related-items to /quotations, not the retired /rfq-jih", () => {
  const source = read("src/routes/_authenticated/action-center.tsx");
  expect(source).toMatch(/rfq: "\/quotations"/);
  expect(source).not.toMatch(/rfq: "\/rfq-jih"/);
});
