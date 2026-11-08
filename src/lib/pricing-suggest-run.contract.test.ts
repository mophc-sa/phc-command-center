import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

// The on-open suggestion check is the record that Propose waits for. It must run once per
// file and round, never refetch by itself, and run only where canSuggestExtras allows.
const SRC = readFileSync(new URL("../components/phc/pricing/SellingPriceTab.tsx", import.meta.url), "utf8");
const start = SRC.indexOf("queryKey: suggestKey");
const block = SRC.slice(SRC.lastIndexOf("useQuery({", start), SRC.indexOf("const suggestStatus", start));

describe("suggest-run query", () => {
  it("is keyed by suggestRunKey, whose key starts with suggest-run", () => {
    expect(start).toBeGreaterThan(0);
    expect(readFileSync(new URL("../components/phc/pricing/types.ts", import.meta.url), "utf8")).toMatch(/\["suggest-run",/);
  });
  it("never retries or refetches by itself", () => {
    expect(block).toMatch(/retry:\s*false/);
    expect(block).toMatch(/staleTime:\s*Infinity/);
    expect(block).toMatch(/refetchOnWindowFocus:\s*false/);
    expect(block).toMatch(/refetchOnReconnect:\s*false/);
  });
  it("is enabled only through canSuggestExtras", () => {
    expect(block).toMatch(/enabled:\s*suggestable/);
    expect(SRC).toMatch(/const suggestable = [^;]*canSuggestExtras\(/);
  });
});
