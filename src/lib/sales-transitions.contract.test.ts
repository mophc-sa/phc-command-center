// The sales transition map exists twice — once in the client
// (src/lib/workflow-actions.ts) and once on the server
// (supabase/functions/sales-os-api/shared.ts). The server is the enforcement;
// the client only decides what the picker offers.
//
// They drifted. The client offered `jih_bafo` and `contract_signed`; the
// server had neither, so both answered 409 "Transition ... is not allowed" and
// two of the PRD's canonical stages (§17) were unreachable in production.
//
// This is the same failure that was already found and fixed for TENDER
// transitions — tender-transitions.contract.test.ts exists precisely because
// of it, and its comment describes the identical symptom. The sales maps were
// never given the same guard. This is that guard.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const read = (r: string) => readFileSync(join(root, r), "utf8");

function parseMap(src: string, declaration: string): Record<string, string[]> {
  const start = src.indexOf(declaration);
  if (start === -1) throw new Error(`${declaration} not found`);
  const body = src.slice(start, src.indexOf("};", start));
  const out: Record<string, string[]> = {};
  for (const m of body.matchAll(/^\s{2}([a-z_]+):\s*\[([^\]]*)\]/gm)) {
    out[m[1]] = [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  }
  return out;
}

const CLIENT = parseMap(read("src/lib/workflow-actions.ts"), "const TRANSITIONS: Record<string, SalesStage[]>");
const SERVER = parseMap(read("supabase/functions/sales-os-api/shared.ts"), "export const SALES_TRANSITIONS: Record<string, string[]>");

// PRD 2026-08-12 §17 — the canonical JIH pipeline.
const CANONICAL = [
  "rfq_received", "jih", "jih_bafo", "under_negotiation",
  "verbally_awarded", "contract_received", "contract_signed", "won",
];
const PARALLEL = ["on_hold", "lost"];

describe("client and server sales transition maps agree", () => {
  test("both maps define the same set of stages", () => {
    expect(Object.keys(SERVER).sort()).toEqual(Object.keys(CLIENT).sort());
  });

  test.each(Object.keys(CANONICAL.concat(PARALLEL).reduce((a, k) => ({ ...a, [k]: 1 }), {})))(
    "%s offers exactly the same next stages on both sides",
    (stage) => {
      expect(SERVER[stage] ?? []).toEqual(CLIENT[stage] ?? []);
    },
  );

  test("no stage the client offers is rejected by the server", () => {
    // The precise shape of the bug: a picker option that 409s on click.
    for (const [from, tos] of Object.entries(CLIENT)) {
      for (const to of tos) {
        expect(SERVER[from] ?? [], `client offers ${from} -> ${to}; server does not`).toContain(to);
      }
    }
  });
});

describe("the canonical JIH lifecycle is walkable end to end", () => {
  test("every canonical stage is a key in the server map", () => {
    for (const s of [...CANONICAL, ...PARALLEL]) expect(Object.keys(SERVER)).toContain(s);
  });

  test("there is a path from rfq_received to won through the canonical order", () => {
    // Walk it for real rather than asserting the map's shape.
    let at = "rfq_received";
    const path = [at];
    for (const next of CANONICAL.slice(1)) {
      expect(SERVER[at], `${at} cannot reach ${next}`).toContain(next);
      at = next;
      path.push(at);
    }
    expect(path[path.length - 1]).toBe("won");
    expect(path).toEqual(CANONICAL);
  });

  test("jih_bafo and contract_signed are reachable — the two that were not", () => {
    expect(SERVER.jih).toContain("jih_bafo");
    expect(SERVER.contract_received).toContain("contract_signed");
  });

  test("won and lost are terminal", () => {
    expect(SERVER.won).toEqual([]);
    expect(SERVER.lost).toEqual([]);
  });

  test("on_hold can reactivate to a live stage, and never straight to a terminal one", () => {
    expect(SERVER.on_hold.length).toBeGreaterThan(0);
    expect(SERVER.on_hold).not.toContain("won");
    expect(SERVER.on_hold).not.toContain("lost");
  });

  test("every live stage can be lost or held; terminals cannot", () => {
    for (const s of CANONICAL.filter((x) => x !== "won")) {
      expect(SERVER[s], `${s} must be able to go on hold`).toContain("on_hold");
    }
    for (const s of ["rfq_received", "jih", "jih_bafo", "under_negotiation", "verbally_awarded"]) {
      expect(SERVER[s], `${s} must be able to be lost`).toContain("lost");
    }
  });

  test("invalid transitions are absent — a deal cannot jump the gates", () => {
    expect(SERVER.rfq_received).not.toContain("won");
    expect(SERVER.rfq_received).not.toContain("verbally_awarded");
    expect(SERVER.jih).not.toContain("contract_received");
    expect(SERVER.jih).not.toContain("won");
    expect(SERVER.under_negotiation).not.toContain("won");
    expect(SERVER.verbally_awarded).not.toContain("won");
  });
});

describe("sensitive stage gates stay enforced server-side", () => {
  const SHARED = read("supabase/functions/sales-os-api/shared.ts");

  test("verbal award needs contact, title, expected date and evidence", () => {
    for (const f of ["verbal_award_contact_name", "verbal_award_contact_title", "expected_contract_date"]) {
      expect(SHARED).toContain(f);
    }
    expect(SHARED).toContain("Verbal award evidence is required");
  });

  test("contract received needs a value and a document", () => {
    expect(SHARED).toContain("Missing for contract");
    expect(SHARED).toContain("A signed contract/PO document is required");
  });

  test("lost needs a reason", () => expect(SHARED).toContain("Loss reason is mandatory"));

  test("on hold needs a reason and a review date", () => {
    expect(SHARED).toContain("hold_reason");
    expect(SHARED).toContain("hold_review_date");
  });

  test("verbal award, contract received and won all require manager sign-off", () => {
    const gated = SHARED.slice(SHARED.indexOf("export const SALES_GATED"));
    for (const s of ["verbally_awarded", "contract_received", "won"]) {
      expect(gated.slice(0, 200)).toContain(s);
    }
  });

  test("only Won writes the awarded stage — the number targets are measured on", () => {
    const apply = SHARED.slice(SHARED.indexOf("export async function applySalesStage"));
    const wonBlock = apply.slice(apply.indexOf('toStage === "won"'), apply.indexOf('toStage === "lost"'));
    expect(wonBlock).toContain('patch.stage = "won"');
    // contract_signed must NOT mark the deal won.
    const signedBlock = apply.slice(apply.indexOf('toStage === "contract_signed"'), apply.indexOf('toStage === "won"'));
    expect(signedBlock).not.toContain('patch.stage = "won"');
  });

  test("lost records the stage it died at and, optionally, the competitor", () => {
    expect(SHARED).toContain("lost_at_stage");
    expect(SHARED).toContain("lost_to_competitor");
  });
});
