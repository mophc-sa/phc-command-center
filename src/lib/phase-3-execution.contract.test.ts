// Phase 3 — Tender lifecycle, Tender→JIH, commercial handoff, win probability.
// PRD 2026-08-12 §17-19, §39-40, §47.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMERCIAL_HANDOFF_STATES,
  SALES_SETTABLE_HANDOFF,
  nextSalesStages,
} from "./workflow-actions";
import { nextTenderStages, TENDER_STAGES } from "./tender-actions";
import { canChangeCommercialStage, canApproveCommercialAction, canReviewIntake } from "./roles";

const root = join(import.meta.dir, "../..");
const read = (r: string) => readFileSync(join(root, r), "utf8");
const MIG = read("supabase/migrations/20260818140000_phase_3_execution_foundation.sql");
const SHARED = read("supabase/functions/sales-os-api/shared.ts");

// Built from the public API. Exporting the internal map just to test it would
// widen the module's surface for the test's convenience.
const TENDER_TRANSITIONS: Record<string, string[]> =
  Object.fromEntries(TENDER_STAGES.map((s) => [s, nextTenderStages(s) as string[]]));

describe("tender lifecycle matches the PRD", () => {
  const ORDER = [
    "tender_identified", "tender_under_process", "tender_bafo",
    "award_negotiation", "awarded_to_contractor", "converted_to_jih",
  ];

  test("the full chain is walkable in order", () => {
    let at = ORDER[0];
    for (const next of ORDER.slice(1)) {
      expect(TENDER_TRANSITIONS[at], `${at} cannot reach ${next}`).toContain(next);
      at = next;
    }
  });

  test("converted_to_jih is terminal", () => {
    expect(TENDER_TRANSITIONS.converted_to_jih).toEqual([]);
  });

  test("only an awarded tender may convert", () => {
    for (const [from, tos] of Object.entries(TENDER_TRANSITIONS)) {
      if (from !== "awarded_to_contractor") {
        expect(tos, `${from} must not convert directly`).not.toContain("converted_to_jih");
      }
    }
  });

  test("the contractor / government split survives onto the tender record", () => {
    expect(MIG).toContain("tender_subtype");
    expect(MIG).toContain("'contractor'");
    expect(MIG).toContain("'government'");
  });

  test("the subtype is carried from the intake that created the tender", () => {
    expect(MIG).toContain("i.request_type = 'tender_government'");
    expect(MIG).toContain("i.request_type = 'tender_contractor'");
  });
});

describe("tender award records the winning contractor", () => {
  test("winner, date and evidence all have somewhere to live", () => {
    for (const c of ["winning_contractor_id", "winning_contractor_name", "contractor_award_date", "contractor_award_evidence"]) {
      expect(MIG).toContain(c);
    }
  });

  test("the conversion carries the winner onto the opportunity", () => {
    const fn = SHARED.slice(SHARED.indexOf("export async function executeTenderConversion"));
    expect(fn.slice(0, 2200)).toContain("winning_contractor_id");
    expect(fn.slice(0, 2200)).toContain("main_contractor_id: winner");
  });
});

describe("Tender → JIH preserves history and refuses duplicates", () => {
  const fn = SHARED.slice(SHARED.indexOf("export async function executeTenderConversion"));
  const body = fn.slice(0, 3000);

  test("the new opportunity links back to the tender", () => {
    expect(body).toContain("source_tender_id: tender.id");
  });

  test("the tender keeps its forward link and its stage history", () => {
    expect(body).toContain("converted_opportunity_id: opp.id");
    expect(body).toContain("logTransition");
    // The tender row is updated, never deleted.
    expect(body).not.toMatch(/\.delete\(\)/);
  });

  test("converting the same tender twice is refused", () => {
    expect(body).toContain("already been converted");
  });

  test("the database enforces it too, not just the handler", () => {
    expect(MIG).toContain("uq_opportunities_source_tender");
    expect(MIG).toContain("WHERE source_tender_id IS NOT NULL");
  });

  test("existing converted pairs are back-filled rather than left half-linked", () => {
    expect(MIG).toContain("SET source_tender_id = t.id");
  });

  test("conversion is reachable from the tender record, not only a standalone page", () => {
    // PRD §40: the action lives inside Tender Detail. The old queue page stays
    // for compatibility but must not be the only route.
    expect(TENDER_TRANSITIONS.awarded_to_contractor).toContain("converted_to_jih");
  });
});

describe("commercial handoff is independent of the sales stage", () => {
  test("all nine PRD states are defined", () => {
    expect([...COMMERCIAL_HANDOFF_STATES]).toEqual([
      "with_sales", "waiting_management", "with_commercial", "waiting_vendor",
      "waiting_gm", "final_review", "ready_for_sales", "submitted", "waiting_client",
    ]);
  });

  test("Sales can only set the three that are actually its own", () => {
    expect([...SALES_SETTABLE_HANDOFF]).toEqual(["with_sales", "waiting_management", "with_commercial"]);
    for (const s of ["waiting_vendor", "waiting_gm", "final_review", "submitted"] as const) {
      expect(SALES_SETTABLE_HANDOFF).not.toContain(s);
    }
  });

  test("the column is separate from sales_stage and defaults to with_sales", () => {
    expect(MIG).toContain("commercial_handoff_status text NOT NULL DEFAULT 'with_sales'");
    expect(MIG).not.toMatch(/sales_stage\s*=\s*commercial_handoff/);
  });

  test("winning a deal hands the file to Commercial", () => {
    const apply = SHARED.slice(SHARED.indexOf("export async function applySalesStage"));
    const won = apply.slice(apply.indexOf('toStage === "won"'), apply.indexOf('toStage === "lost"'));
    expect(won).toContain('commercial_handoff_status = "with_commercial"');
  });
});

describe("win probability keeps the AI and the human apart", () => {
  test("the human number has its own columns", () => {
    for (const c of ["human_win_probability", "human_probability_reason", "human_probability_at", "human_probability_by"]) {
      expect(MIG).toContain(c);
    }
  });

  test("it is range-checked", () => {
    expect(MIG).toContain("human_win_probability BETWEEN 0 AND 100");
  });

  test("setting the human value never clears the AI score", () => {
    const src = read("src/lib/workflow-actions.ts");
    const fn = src.slice(src.indexOf("export async function setHumanWinProbability"));
    const body = fn.slice(0, fn.indexOf("export const COMMERCIAL_HANDOFF_STATES"));
    expect(body).toContain("human_win_probability");
    // The AI's fields must not appear in the update payload.
    expect(body).not.toMatch(/score:\s/);
    expect(body).not.toContain("score_reasons:");
    expect(body).not.toContain("scored_at:");
  });

  test("both are auditable — who set it and when", () => {
    const src = read("src/lib/workflow-actions.ts");
    expect(src).toContain("opportunity.human_probability.set");
  });
});

describe("AI stays advisory in execution too", () => {
  test("no agent sets a stage, converts a tender, or records won/lost", () => {
    const reg = read("supabase/functions/_shared/ai-agent-registry.ts");
    // Agents write to ai_agent_outputs for human review; they must not write
    // the commercial columns directly.
    expect(reg).not.toMatch(/update\(\{[^}]*sales_stage/);
    expect(reg).not.toMatch(/update\(\{[^}]*tender_stage/);
    expect(reg).not.toMatch(/converted_opportunity_id:/);
  });

  test("stage changes go through the gated server action only", () => {
    const wf = read("src/lib/workflow-actions.ts");
    expect(wf).toContain('callBackend("advance_sales_stage"');
  });
});

describe("commercial authority is unchanged by Phase 3", () => {
  test("stage changes need a commercial manager, never system_admin alone", () => {
    expect(canChangeCommercialStage(["sales_manager"])).toBe(true);
    expect(canChangeCommercialStage(["general_manager"])).toBe(true);
    expect(canChangeCommercialStage(["system_admin"])).toBe(false);
    expect(canChangeCommercialStage(["salesperson"])).toBe(false);
  });

  test("approvals need a commercial manager, never system_admin alone", () => {
    expect(canApproveCommercialAction(["system_admin"])).toBe(false);
    expect(canApproveCommercialAction(["sales_manager"])).toBe(true);
  });

  test("Phase 2's intake gate is untouched", () => {
    expect(canReviewIntake(["bd_manager"])).toBe(true);
    expect(canReviewIntake(["system_admin"])).toBe(false);
  });
});

describe("the migration is safe", () => {
  test("additive — nothing dropped, deleted or truncated", () => {
    expect(MIG).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|POLICY|TRIGGER)\b/i);
    expect(MIG).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(MIG).not.toMatch(/\bTRUNCATE\b/i);
  });

  test("no enum is altered", () => {
    expect(MIG).not.toMatch(/ALTER\s+TYPE/i);
  });

  test("stage and pipeline_step are still not dropped", () => {
    expect(MIG).not.toMatch(/DROP\s+COLUMN.*\bstage\b/i);
    expect(MIG).not.toMatch(/DROP\s+COLUMN.*pipeline_step/i);
  });

  test("the backfills are guarded so a re-run cannot overwrite real values", () => {
    expect(MIG).toContain("AND o.source_tender_id IS NULL");
    expect(MIG).toContain("AND t.tender_subtype IS NULL");
  });
});

describe("client picker offers exactly the walkable stages", () => {
  test("from jih the user is offered jih_bafo — the stage that used to 409", () => {
    expect(nextSalesStages("jih")).toContain("jih_bafo");
  });
  test("from contract_received the user is offered contract_signed", () => {
    expect(nextSalesStages("contract_received")).toContain("contract_signed");
  });
  test("won offers nothing", () => expect(nextSalesStages("won")).toEqual([]));
});
