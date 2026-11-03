import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { GM_MOVES, PRICER_MOVES } from "@/lib/pricing";

// The screens decide which buttons to show from PRICER_MOVES / GM_MOVES; the
// database decides what is allowed from pricing_file_transitions. They must agree.
// Comments are stripped first, so a rule that is only commented out does not count.
const read = (file: string) =>
  readFileSync(`supabase/migrations/${file}`, "utf8").replace(/--[^\n]*/g, "");
const SQL = read("20261103110000_pricing_state_machine.sql");

const VIEW = SQL.slice(
  SQL.indexOf("CREATE OR REPLACE VIEW public.pricing_file_transitions"),
  SQL.indexOf(") AS t(from_state"),
);
const ROW =
  /\(\s*'(\w+)'(?:::public\.pricing_file_state)?\s*,\s*'(\w+)'(?:::public\.pricing_file_state)?\s*,\s*'(\w+)'\s*\)/g;
const rows = [...VIEW.matchAll(ROW)].map((m) => ({ from: m[1], to: m[2], who: m[3] }));
const movesFor = (who: string) =>
  rows
    .filter((r) => r.who === who)
    .map((r) => `${r.from}>${r.to}`)
    .sort();

describe("button moves match the SQL transition list", () => {
  it("parses every row of the view", () => {
    // One row per line of the VALUES list: a row the regex missed would show up here.
    const rowLines = VIEW.split("\n").filter((l) => /^\s*\(/.test(l)).length;
    expect(rows.length).toBe(rowLines);
    expect(rows.length).toBeGreaterThan(10);
  });
  it("knows every kind of mover, so a new one is mirrored on purpose", () => {
    expect([...new Set(rows.map((r) => r.who))].sort()).toEqual([
      "gm",
      "pricer",
      "rpc_answer",
      "rpc_needs_info",
      "system",
    ]);
  });
  it("lists exactly the 'pricer' rows", () => {
    const sql = movesFor("pricer");
    expect(sql.length).toBeGreaterThan(5);
    expect(PRICER_MOVES.map(([a, b]) => `${a}>${b}`).sort()).toEqual(sql);
  });
  it("lists exactly the 'gm' rows", () => {
    const sql = movesFor("gm");
    expect(sql.length).toBeGreaterThan(0);
    expect(GM_MOVES.map(([a, b]) => `${a}>${b}`).sort()).toEqual(sql);
  });
});

describe("installation cost has the shape the TypeScript mirror assumes", () => {
  const CALC = read("20261103130000_pricing_calc.sql");
  const fn = CALC.slice(
    CALC.indexOf("FUNCTION public.pricing_installation_cost"),
    CALC.indexOf("REVOKE ALL ON FUNCTION public.pricing_installation_cost"),
  );
  it("adds the scaffold only to a ceiling sign mounted over the height threshold", () => {
    expect(fn).toMatch(
      /_type = 'ceiling' AND r\.height_threshold_m IS NOT NULL\s+AND coalesce\(_mount_height_m,0\) > r\.height_threshold_m THEN r\.scaffold_add/,
    );
  });
  it("does not use the crane add", () => {
    expect(fn).not.toMatch(/crane_add/);
  });
  it("is not rounded", () => {
    expect(fn).not.toMatch(/\bround\s*\(/i);
  });
});

// Mo, 2026-11-03: the GM (Kalas) sets the price and finance (Zayed) reviews it.
// Inside a pricing file, gm_approved belongs to finance reviewing the GM's
// price, never its own proposer's. Each assertion pins one rule of the guard to
// the condition that enforces it, so deleting the rule breaks the test.
const GUARD = read("20261103140000_pricing_gm_sets_zayed_reviews.sql");
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from);
  expect(a).toBeGreaterThanOrEqual(0);
  const b = text.indexOf(to, a);
  expect(b).toBeGreaterThan(a);
  return text.slice(a, b);
};
const refusal = /IF NOT \(([\s\S]*?)\)\s*THEN\s+RAISE EXCEPTION/;
// Slices are taken inside each test, so a deleted rule fails that test by name.
const guardFn = () =>
  between(
    GUARD,
    "FUNCTION public.internal_price_transition_guard",
    "REVOKE ALL ON FUNCTION public.internal_price_transition_guard",
  );

describe("Kalas sets, Zayed reviews", () => {
  const propose = () =>
    between(
      guardFn(),
      "IF OLD.status = 'internal_price_proposed' AND NEW.status = 'gm_pending' THEN",
      "IF NEW.status = 'returned' AND _in_file THEN",
    );
  it("only the final-price authority proposes, and only from the selling build", () => {
    expect(propose()).toMatch(
      /IF NOT public\.can_approve_final_price\(_uid\) THEN\s+RAISE EXCEPTION/,
    );
    expect(propose()).toMatch(/IF _file_state <> 'selling_build' THEN\s+RAISE EXCEPTION/);
    expect(propose()).toMatch(
      /IF public\._pricing_price_has_open_extras\(NEW\.id\) THEN\s+RAISE EXCEPTION/,
    );
  });
  it("in a pricing file the propose step is legal only in the file, never the old commercial route", () => {
    expect(guardFn()).toMatch(
      /\(OLD\.status = 'internal_price_proposed' AND NEW\.status = 'gm_pending' AND _in_file\)/,
    );
    expect(guardFn()).toMatch(
      /\(OLD\.status = 'internal_price_proposed' AND NEW\.status = 'commercial_review' AND NOT _in_file\)/,
    );
    expect(guardFn()).toMatch(
      /\(OLD\.status = 'finance_review' AND NEW\.status = 'gm_pending' AND NOT _in_file\)/,
    );
  });
  const approve = () =>
    between(guardFn(), "IF NEW.status = 'gm_approved' THEN", "IF NEW.status = 'finance_review'");
  const inFile = () =>
    between(approve(), "IF _in_file THEN", "ELSIF NOT public.can_approve_final_price(_uid)");
  const condition = () => inFile().match(refusal)?.[1] ?? "";
  it("finance approves, nobody else", () => {
    expect(condition()).toMatch(/public\.has_role\(_uid, 'finance_manager'::public\.app_role\)/);
  });
  it("finance approves only a price the final-price authority proposed", () => {
    expect(condition()).toMatch(/public\.can_approve_final_price\(OLD\.proposed_by\)/);
  });
  it("and never its own", () => {
    expect(condition()).toMatch(/OLD\.proposed_by IS DISTINCT FROM _uid/);
  });
  it("all three must hold together", () => {
    // AND-joined inside one NOT ( ... ), so failing any one refuses the approval.
    const parts = condition()
      .split(/\bAND\b/)
      .map((p) => p.trim());
    expect(parts.length).toBe(3);
    expect(condition()).not.toMatch(/\bOR\b/);
  });
  it("approves only while the file is in price review", () => {
    expect(inFile()).toMatch(/IF _file_state <> 'price_review' THEN\s+RAISE EXCEPTION/);
  });
  it("outside a pricing file the old rule stays: the authority approves", () => {
    expect(approve()).toMatch(
      /ELSIF NOT public\.can_approve_final_price\(_uid\) THEN\s+RAISE EXCEPTION/,
    );
  });
  it("an approved price is immutable", () => {
    const frozen = between(
      guardFn(),
      "IF OLD.status = 'gm_approved' THEN",
      "IF OLD.status = 'gm_pending' AND (",
    );
    expect(frozen).toMatch(/IF NEW\.status IS DISTINCT FROM OLD\.status THEN\s+RAISE EXCEPTION/);
    expect(frozen).toMatch(/IS DISTINCT FROM \(to_jsonb\(OLD\)[^)]*\)\s+THEN\s+RAISE EXCEPTION/);
    expect(frozen).toMatch(/RETURN OLD;/);
  });
  it("a user cannot insert a price already past draft or proposed", () => {
    const ins = between(
      GUARD,
      "FUNCTION public.internal_price_insert_guard",
      "REVOKE ALL ON FUNCTION public.internal_price_insert_guard",
    );
    expect(ins).toMatch(
      /current_user = 'authenticated'\s+AND NEW\.status NOT IN \('draft','internal_price_proposed'\) THEN\s+RAISE EXCEPTION/,
    );
    expect(GUARD).toMatch(
      /CREATE TRIGGER internal_prices_insert_guard BEFORE INSERT ON public\.internal_prices/,
    );
  });
});
