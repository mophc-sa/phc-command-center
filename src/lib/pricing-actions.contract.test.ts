import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

// Every RPC the screens call exists in a migration with the argument names the
// wrapper sends, and no read selects "*" or a column the role is not granted
// (pricing_file_events, boq_lines, ...). Comments are stripped from the SQL
// first, so a function that is only commented out does not count.
const dir = new URL("../../supabase/migrations/", import.meta.url);
const SQL = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), "utf8").replace(/--[^\n]*/g, ""))
  .join("\n");
const SRC = readFileSync(new URL("./pricing-actions.ts", import.meta.url), "utf8");

/** The latest definition's parameter list: everything between "FUNCTION public.fn(" and RETURNS. */
function signature(fn: string): string | undefined {
  const defs = [...SQL.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS`, "g"))];
  return defs.at(-1)?.[1];
}

describe("pricing-actions", () => {
  const rpcs = [...SRC.matchAll(/call(?:<[^>]*>)?\(\s*"(\w+)"/g)].map((m) => m[1]);
  it("finds the RPC calls", () => expect(rpcs.length).toBeGreaterThan(15));
  it.each([...new Set(rpcs)])("%s is defined in a migration", (fn) => {
    expect(SQL).toMatch(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\(`));
  });

  const calls = [...SRC.matchAll(/call(?:<[^>]*>)?\(\s*"(\w+)",\s*\{([^}]*)\}/g)].map((m) => ({
    fn: m[1],
    keys: [...m[2].matchAll(/(_\w+)\s*:/g)].map((k) => k[1]),
  }));
  it("finds the argument objects", () => expect(calls.length).toBe(rpcs.length));
  it.each(calls.map((c) => [c.fn, c.keys] as const))("%s is sent only parameters it has", (fn, keys) => {
    const sig = signature(fn);
    expect(sig).toBeDefined();
    for (const k of keys) expect(sig ?? "").toMatch(new RegExp(`\\b${k}\\b`));
  });

  it("never selects *", () => {
    expect(SRC).not.toMatch(/\.select\(\s*["'`]\*["'`]/);
    expect(SRC).not.toMatch(/\.select\(\s*\)/);
  });

  // Column grants: boq_lines (unit_price and line_total are cost) and
  // pricing_file_events (cost_note) grant columns by name, never the table.
  const granted = (table: string) =>
    new Set(
      [...SQL.matchAll(new RegExp(`GRANT SELECT \\(([^)]*)\\)\\s+ON public\\.${table} TO authenticated`, "g"))]
        .flatMap((m) => m[1].split(","))
        .map((c) => c.trim())
        .filter(Boolean),
    );
  it("boq_lines are read only through granted columns", () => {
    const list = SRC.match(/const LINE_COLUMNS =\s*"([^"]+)"/)?.[1] ?? "";
    const cols = list.split(",").map((c) => c.trim());
    expect(cols.length).toBeGreaterThan(10);
    const ok = granted("boq_lines");
    expect(ok.size).toBeGreaterThan(15);
    expect(cols.filter((c) => !ok.has(c))).toEqual([]);
    expect(cols).not.toContain("unit_price");
    expect(cols).not.toContain("line_total");
  });
  it("pricing_file_events are read only through granted columns (not cost_note)", () => {
    const list = SRC.match(/from\("pricing_file_events"\)\.select\("([^"]+)"\)/)?.[1] ?? "";
    const cols = list.split(",").map((c) => c.trim());
    expect(cols.length).toBeGreaterThan(5);
    const ok = granted("pricing_file_events");
    expect(ok.size).toBeGreaterThan(5);
    expect(cols.filter((c) => !ok.has(c))).toEqual([]);
    expect(cols).not.toContain("cost_note");
  });
});
