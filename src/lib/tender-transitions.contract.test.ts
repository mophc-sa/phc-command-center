// PHC Sales OS — Contract test: the two tender transition maps must agree.
//
// The frontend decides which stages the picker offers. The backend decides
// which moves it will actually accept. They are two separate literals in two
// separate files, and on 2026-08-05 they had silently diverged:
//
//   frontend  tender_under_process -> [tender_bafo, award_negotiation, ...]
//   backend   tender_under_process -> [award_negotiation, ...]
//   backend   tender_bafo          -> (no key at all)
//
// So the UI offered Tender BAFO, the user picked it, and the backend replied
// 409 "Transition tender_under_process -> tender_bafo is not allowed". Worse,
// a tender that reached that stage by any other route had no outgoing
// transitions defined — a dead end with no legal way out.
//
// The stage was added to the enum by migration 20260716100000 and wired into
// one map only. This test diffs them so the next enum addition cannot repeat it.
import { test, expect, describe } from "bun:test";

/** Extracts a `Record<string, ...>` object literal into a plain JS map. */
function parseTransitionMap(src: string, declaration: string): Record<string, string[]> {
  const start = src.indexOf(declaration);
  if (start === -1) throw new Error(`declaration not found: ${declaration}`);
  const open = src.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  const body = src.slice(open + 1, i - 1);

  const map: Record<string, string[]> = {};
  // Each entry looks like:  key: ["a", "b"],
  for (const m of body.matchAll(/(\w+)\s*:\s*\[([^\]]*)\]/g)) {
    const key = m[1];
    const values = [...m[2].matchAll(/"([^"]+)"/g)].map((v) => v[1]);
    map[key] = values;
  }
  return map;
}

async function maps() {
  const fs = await import("fs/promises");
  const fe = await fs.readFile("src/lib/tender-actions.ts", "utf8");
  const be = await fs.readFile("supabase/functions/sales-os-api/shared.ts", "utf8");
  return {
    frontend: parseTransitionMap(fe, "const TENDER_TRANSITIONS"),
    backend: parseTransitionMap(be, "export const TENDER_TRANSITIONS"),
  };
}

describe("tender transition maps", () => {
  test("both parse to a non-trivial map — the parser itself still works", async () => {
    const { frontend, backend } = await maps();
    expect(Object.keys(frontend).length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(backend).length).toBeGreaterThanOrEqual(6);
  });

  test("they define exactly the same stages", async () => {
    const { frontend, backend } = await maps();
    expect(Object.keys(backend).sort()).toEqual(Object.keys(frontend).sort());
  });

  test("every stage offers exactly the same next steps", async () => {
    const { frontend, backend } = await maps();
    for (const stage of Object.keys(frontend)) {
      expect([stage, [...backend[stage]].sort()]).toEqual([stage, [...frontend[stage]].sort()]);
    }
  });

  test("tender_bafo is reachable and has a way out — the 2026-08-05 defect", async () => {
    const { frontend, backend } = await maps();
    for (const [name, map] of [["frontend", frontend], ["backend", backend]] as const) {
      expect([name, map.tender_under_process.includes("tender_bafo")]).toEqual([name, true]);
      expect([name, map.tender_bafo?.length ?? 0]).not.toEqual([name, 0]);
    }
  });

  test("every stage named as a destination is itself a defined key", async () => {
    // Catches the dead-end shape directly: a stage you can move to but not from.
    const { backend } = await maps();
    for (const [from, tos] of Object.entries(backend)) {
      for (const to of tos) {
        expect([from, to, Object.hasOwn(backend, to)]).toEqual([from, to, true]);
      }
    }
  });

  test("every enum value appears in the map", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/tender-actions.ts", "utf8");
    const listed = [...src.slice(src.indexOf("export const TENDER_STAGES")).matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1])
      .slice(0, 7);
    const { backend } = await maps();
    for (const stage of listed) {
      expect([stage, Object.hasOwn(backend, stage)]).toEqual([stage, true]);
    }
  });
});
