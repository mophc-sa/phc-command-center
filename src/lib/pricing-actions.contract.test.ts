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
// The supplier portal's wrappers (PR 3) follow the same rules.
const SRC = ["./pricing-actions.ts", "./supplier-portal-actions.ts", "./contract-terms-actions.ts"]
  .map((f) => readFileSync(new URL(f, import.meta.url), "utf8"))
  .join("\n");
/** RPCs that take no parameter. */
const NO_PARAMS = new Set(["pricing_my_rights", "supplier_portal_invitations"]);

/** The latest definition's parameter list: everything between "FUNCTION public.fn(" and RETURNS. */
function signature(fn: string): string | undefined {
  const defs = [...SQL.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS`, "g"))];
  return defs.at(-1)?.[1];
}

/** Split on commas outside parentheses and quotes. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of text) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** The text from `from` to the first top-level ";" (outside parentheses and quotes). */
function statement(from: number): string {
  let depth = 0;
  let quote = false;
  for (let i = from; i < SQL.length; i++) {
    const ch = SQL[i];
    if (ch === "'") quote = !quote;
    if (quote) continue;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) return SQL.slice(from, i);
  }
  return SQL.slice(from);
}

/** Output column names of the latest definition of a view (its last top-level SELECT list) or table (CREATE TABLE plus ADD COLUMN). */
function relationColumns(rel: string): Set<string> {
  const view = [...SQL.matchAll(new RegExp(`CREATE (?:OR REPLACE )?VIEW public\\.${rel}\\b`, "g"))].at(-1);
  if (view?.index !== undefined) {
    const body = statement(view.index);
    // Find the last SELECT at depth 0 and the FROM that ends its list.
    let depth = 0;
    let quote = false;
    let selectAt = -1;
    let fromAt = -1;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "'") quote = !quote;
      if (quote) continue;
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && /\bSELECT\s/y.test(body.slice(i, i + 7)) && /\W/.test(body[i - 1] ?? " ")) {
        selectAt = i + 6;
        fromAt = -1;
      } else if (depth === 0 && selectAt >= 0 && fromAt < 0 && /^FROM\s/.test(body.slice(i, i + 5)) && /\W/.test(body[i - 1] ?? " ")) fromAt = i;
    }
    const list = body.slice(selectAt, fromAt < 0 ? undefined : fromAt);
    return new Set(
      splitTop(list)
        .map((item) => item.trim().replace(/\s+/g, " "))
        .map((item) => item.match(/\bAS (\w+)$/i)?.[1] ?? item.match(/(\w+)$/)?.[1] ?? "")
        .filter(Boolean),
    );
  }
  const cols = new Set<string>();
  const table = [...SQL.matchAll(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${rel}\\s*\\(`, "g"))].at(-1);
  if (table?.index !== undefined) {
    const body = statement(table.index);
    const inner = body.slice(body.indexOf("(") + 1, body.lastIndexOf(")"));
    for (const item of splitTop(inner)) {
      const first = item.trim().split(/\s+/)[0];
      if (first && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)$/i.test(first)) cols.add(first.replace(/"/g, ""));
    }
  }
  for (const m of SQL.matchAll(new RegExp(`ALTER TABLE (?:IF EXISTS )?(?:ONLY )?public\\.${rel}\\s([\\s\\S]*?);`, "g")))
    for (const a of m[1].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?(\w+)/gi)) cols.add(a[1]);
  return cols;
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

  // Every parameter without a DEFAULT must be sent: a wrapper that forgets one
  // calls a function signature that does not exist (PostgREST 404).
  const requiredParams = (sig: string): string[] =>
    splitTop(sig)
      .filter((p) => !/\bDEFAULT\b|:=|=/i.test(p))
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean);
  it.each(calls.map((c) => [c.fn, c.keys] as const))("%s sends every required parameter", (fn, keys) => {
    const required = requiredParams(signature(fn) ?? "");
    if (!NO_PARAMS.has(fn)) expect(required.length).toBeGreaterThan(0);
    expect(required.filter((r) => !keys.includes(r))).toEqual([]);
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

  // Explicit column lists must exist in the relation they read; a renamed or
  // dropped column would otherwise only fail at runtime.
  describe("selected columns exist in the migrations", () => {
    const named = (name: string) => SRC.match(new RegExp(`const ${name} =\\s*"([^"]+)"`))?.[1] ?? "";
    const reads: [string, string, string][] = [
      ["GRID_COLUMNS", "pricing_selling_grid", named("GRID_COLUMNS")],
      ["QUEUE_COLUMNS", "pricing_queue", named("QUEUE_COLUMNS")],
      ["CATALOG_COLUMNS", "pricing_extras_catalog", named("CATALOG_COLUMNS")],
      ...[...SRC.matchAll(/\.from\("(\w+)"\)\s*\.select\(\s*"([^"]+)"/g)].map((m) => [`select on ${m[1]}`, m[1], m[2]] as [string, string, string]),
    ];
    it("finds the lists", () => expect(reads.length).toBeGreaterThan(8));
    it.each(reads)("%s exists in %s", (_label, rel, list) => {
      expect(list).not.toBe("");
      const have = relationColumns(rel);
      expect(have.size).toBeGreaterThan(2);
      const want = splitTop(list)
        .map((c) => c.trim())
        .filter((c) => c && !c.includes("(") && !c.includes(":"));
      expect(want.filter((c) => !have.has(c))).toEqual([]);
    });
  });
});
