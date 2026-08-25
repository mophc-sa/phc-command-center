import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const server = readFileSync(join(root, "src/server.ts"), "utf8");
const code = server.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// =============================================================================
// Measured on production 2026-08-25, before this change:
//
//   GET /                     (no cache-control header at all)
//   GET /assets/styles-*.css  cache-control: public, max-age=31536000, immutable
//
// The assets were right. The document that names them was left to heuristic
// caching, so a browser kept serving the pre-deploy HTML with pre-deploy chunk
// hashes. Those 404, the route dies, and the recovery cannot help because its
// reload returns that same cached document. That is the "A new version was
// released" screen appearing over and over instead of fixing itself.
// =============================================================================

describe("the document is always revalidated", () => {
  it("sets no-cache on HTML", () => {
    expect(code).toContain('headers.set("Cache-Control", "no-cache, must-revalidate")');
  });

  it("scopes it to HTML so hashed assets keep their immutable year", () => {
    expect(code).toContain('contentType.includes("text/html")');
    expect(code).not.toMatch(/max-age=0[^)]*assets/i);
  });

  it("applies on the path every response goes through", () => {
    // withSecurityHeaders wraps the SSR response, the h3-error response and the
    // catastrophic-failure response. Hanging the cache header off it is what
    // makes this true of every page rather than of one route.
    expect(code).toContain("withCacheHeaders(response, headers)");
    expect(code.match(/withSecurityHeaders\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  // no-store would also stop the staleness, and would throw away the 304s that
  // keep navigation fast. Revalidation is the cheaper correct answer.
  it("revalidates rather than refusing to store", () => {
    expect(code).not.toContain("no-store");
  });
});
