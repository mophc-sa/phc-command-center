// Review 2026-11-14: the native confirm box is unstyled, ignores RTL and shows
// the hostname as its title. Every confirmation goes through confirmAction
// (src/components/phc/ConfirmHost.tsx); only its own no-host fallback may call
// window.confirm. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });

test("no native confirm outside ConfirmHost", () => {
  const offenders = walk(root)
    .filter((p) => !p.endsWith("ConfirmHost.tsx"))
    .filter((p) => /(^|[^.\w])confirm\(|window\.confirm\(/.test(readFileSync(p, "utf8")))
    .map((p) => relative(root, p));
  expect(offenders).toEqual([]);
});

test("ConfirmHost is mounted at the root", () => {
  expect(readFileSync(join(root, "routes/__root.tsx"), "utf8")).toContain("<ConfirmHost />");
});
