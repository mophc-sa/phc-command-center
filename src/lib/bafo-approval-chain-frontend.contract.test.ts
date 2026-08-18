// Contract tests for the frontend half of the 2026-07-27 BAFO/commercial-
// discount approval chain: roles.ts capability helpers, bafo-actions.ts,
// and BafoPanel's per-step role gating + sent-to-client gating. Static
// source inspection. Run with `bun test src`.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canRequestBafo,
  canReviewBafoCommercial,
  canApproveBafoCost,
  canApproveBafoFinance,
  canApproveBafoFinal,
  isEstimationManager,
} from "@/lib/roles";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
function src(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("roles.ts BAFO capability helpers", () => {
  // Phase 1 governance (PRD 2026-08-12 §111-114). These tests used to assert
  // that `system_admin` passed EVERY step — the "platform-admin override".
  // That override is the defect: one account holding only system_admin could
  // raise a BAFO and approve all four checks on it, so the chain enforced an
  // order rather than four independent judgements. The assertions below now
  // describe the required behaviour, not the behaviour that shipped.

  test("canReviewBafoCommercial: bd_manager or sales_manager", () => {
    expect(canReviewBafoCommercial(["bd_manager"])).toBe(true);
    expect(canReviewBafoCommercial(["sales_manager"])).toBe(true);
    expect(canReviewBafoCommercial(["salesperson"])).toBe(false);
    expect(canReviewBafoCommercial(["estimation_manager"])).toBe(false);
  });

  test("canApproveBafoCost: estimation_manager only", () => {
    expect(canApproveBafoCost(["estimation_manager"])).toBe(true);
    expect(canApproveBafoCost(["bd_manager"])).toBe(false);
    expect(canApproveBafoCost(["finance_manager"])).toBe(false);
  });

  test("canApproveBafoFinance: finance_manager only", () => {
    expect(canApproveBafoFinance(["finance_manager"])).toBe(true);
    expect(canApproveBafoFinance(["estimation_manager"])).toBe(false);
  });

  test("canApproveBafoFinal: executives only (managing_director/general_manager/ceo)", () => {
    expect(canApproveBafoFinal(["managing_director"])).toBe(true);
    expect(canApproveBafoFinal(["general_manager"])).toBe(true);
    expect(canApproveBafoFinal(["ceo"])).toBe(true);
    expect(canApproveBafoFinal(["finance_manager"])).toBe(false);
  });

  test("system_admin ALONE cannot decide any step of the chain", () => {
    const admin = ["system_admin"] as const;
    expect(canReviewBafoCommercial(admin)).toBe(false);
    expect(canApproveBafoCost(admin)).toBe(false);
    expect(canApproveBafoFinance(admin)).toBe(false);
    expect(canApproveBafoFinal(admin)).toBe(false);
  });

  test("system_admin cannot single-handedly complete the whole chain", () => {
    // The property that actually matters: no single role set consisting only
    // of system_admin satisfies every gate. If a future change re-adds the
    // override anywhere, this fails.
    const steps = [canReviewBafoCommercial, canApproveBafoCost, canApproveBafoFinance, canApproveBafoFinal];
    expect(steps.filter((can) => can(["system_admin"])).length).toBe(0);
  });

  test("system_admin PLUS a business role gets exactly that role's authority, and no more", () => {
    // Roles are additive: holding system_admin must neither grant nor remove
    // anything. The authority comes from the business role alone.
    expect(canApproveBafoFinance(["system_admin", "finance_manager"])).toBe(true);
    expect(canApproveBafoCost(["system_admin", "finance_manager"])).toBe(false);
    expect(canApproveBafoFinal(["system_admin", "finance_manager"])).toBe(false);

    expect(canApproveBafoCost(["system_admin", "estimation_manager"])).toBe(true);
    expect(canApproveBafoFinance(["system_admin", "estimation_manager"])).toBe(false);

    expect(canApproveBafoFinal(["system_admin", "general_manager"])).toBe(true);
    expect(canReviewBafoCommercial(["system_admin", "general_manager"])).toBe(false);
  });

  test("holding system_admin changes nothing for a user who already holds the business role", () => {
    for (const role of ["bd_manager", "sales_manager", "estimation_manager", "finance_manager", "general_manager"] as const) {
      expect(canReviewBafoCommercial([role, "system_admin"])).toBe(canReviewBafoCommercial([role]));
      expect(canApproveBafoCost([role, "system_admin"])).toBe(canApproveBafoCost([role]));
      expect(canApproveBafoFinance([role, "system_admin"])).toBe(canApproveBafoFinance([role]));
      expect(canApproveBafoFinal([role, "system_admin"])).toBe(canApproveBafoFinal([role]));
    }
  });

  test("canRequestBafo matches the existing sales-record-creation capability (any sales contributor, not just managers)", () => {
    expect(canRequestBafo(["salesperson"])).toBe(true);
  });

  test("isEstimationManager recognizes only the estimation_manager role", () => {
    expect(isEstimationManager(["estimation_manager"])).toBe(true);
    expect(isEstimationManager(["finance_manager"])).toBe(false);
  });
});

describe("bafo-actions.ts", () => {
  const actionsSrc = src("src/lib/bafo-actions.ts");

  test("BAFO_STEPS is the fixed 4-step order the sequential UI/DB gating both rely on", () => {
    expect(actionsSrc).toMatch(
      /BAFO_STEPS: BafoStep\[\] = \["commercial_review", "cost_approval", "finance_review", "final_approval"\]/,
    );
  });

  test("createBafoRequest requires a signed-in user before inserting (requested_by is NOT NULL, no default)", () => {
    const fnStart = actionsSrc.indexOf("export async function createBafoRequest");
    const fnEnd = actionsSrc.indexOf("\n}\n", fnStart);
    const body = actionsSrc.slice(fnStart, fnEnd);
    expect(body).toMatch(/if \(!uid\) throw new Error/);
  });

  test("markBafoSentToClient only sets sent_to_client_at — the trigger is the real gate rejecting a non-approved request", () => {
    const fnStart = actionsSrc.indexOf("export async function markBafoSentToClient");
    const fnEnd = actionsSrc.indexOf("\n}\n", fnStart);
    const body = actionsSrc.slice(fnStart, fnEnd);
    expect(body).toMatch(/sent_to_client_at: new Date\(\)\.toISOString\(\)/);
  });
});

describe("BafoPanel.tsx", () => {
  const panelSrc = src("src/components/phc/BafoPanel.tsx");

  test("Request BAFO action is gated by canRequestBafo", () => {
    expect(panelSrc).toMatch(/canRequestBafo\(roles\) \? \(/);
  });

  test("each step's decide buttons are gated by canDecideStep, which checks prior-step approval and the step's own role helper", () => {
    expect(panelSrc).toMatch(/if \(!priorStepsApproved \|\| request\[STEP_STATUS_KEY\[step\]\] !== "pending"\) return false;/);
    expect(panelSrc).toMatch(/if \(step === "commercial_review"\) return canReviewBafoCommercial\(roles\);/);
    expect(panelSrc).toMatch(/if \(step === "cost_approval"\) return canApproveBafoCost\(roles\);/);
    expect(panelSrc).toMatch(/if \(step === "finance_review"\) return canApproveBafoFinance\(roles\);/);
    expect(panelSrc).toMatch(/return canApproveBafoFinal\(roles\);/);
  });

  test("Mark Sent to Client is only shown once status is approved and not already sent", () => {
    expect(panelSrc).toMatch(/r\.status === "approved" && !r\.sent_to_client_at \? \(/);
  });
});

describe("opportunities.$id.tsx wiring", () => {
  const routeSrc = src("src/routes/_authenticated/opportunities.$id.tsx");

  test("BafoPanel is imported and mounted under the decision tab", () => {
    expect(routeSrc).toMatch(/import \{ BafoPanel \} from "@\/components\/phc\/BafoPanel";/);
    expect(routeSrc).toMatch(/\{show\("decision"\) && <BafoPanel opportunityId=\{o\.id\} \/>\}/);
  });
});
