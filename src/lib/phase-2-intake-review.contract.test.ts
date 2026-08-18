// Phase 2 — Sales Intake & Opportunity Review.
// PRD 2026-08-12 §11-19.
//
// Behaviour, not implementation shape. Where a rule is enforced in SQL the
// test reads the migration, because that is where the guarantee lives — a
// client-side capability check is not a control (Phase 1, D15).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canReviewIntake,
  canCreateSalesRecords,
} from "./roles";
import {
  INTAKE_REQUEST_TYPES,
  INTAKE_REVIEW_STATES,
  trackForRequestType,
  legacyProjectTypeFor,
} from "./inbox-actions";
import {
  missingIntakeFields,
  packageCompleteness,
  suggestRequestType,
  isReviewable,
} from "./intake-assessment";

const root = join(import.meta.dir, "../..");
const read = (r: string) => readFileSync(join(root, r), "utf8");
const MIGRATION = read("supabase/migrations/20260818090000_phase_2_intake_review_gate.sql");
const ACTIONS = read("src/lib/inbox-actions.ts");

describe("request types", () => {
  test("the four PRD types exist", () => {
    expect([...INTAKE_REQUEST_TYPES]).toEqual(["jih", "tender_contractor", "tender_government", "unknown"]);
  });

  test("both tender subtypes route to the tender board; JIH to the opportunity track", () => {
    expect(trackForRequestType("jih")).toBe("jih");
    expect(trackForRequestType("tender_contractor")).toBe("tender");
    expect(trackForRequestType("tender_government")).toBe("tender");
    expect(trackForRequestType("unknown")).toBe("none");
    expect(trackForRequestType(null)).toBe("none");
  });

  test("the legacy project_type column stays derivable, so the old conversion path still works", () => {
    expect(legacyProjectTypeFor("jih")).toBe("jih");
    expect(legacyProjectTypeFor("tender_government")).toBe("tender");
    expect(legacyProjectTypeFor("unknown")).toBe(null);
  });

  test("the migration keeps project_type rather than dropping it", () => {
    expect(MIGRATION).not.toMatch(/DROP\s+COLUMN\s+.*project_type/i);
    expect(MIGRATION).toContain("request_type");
  });
});

describe("the review gate exists and is server-enforced", () => {
  test("the five review states are defined", () => {
    expect([...INTAKE_REVIEW_STATES]).toEqual([
      "pending_review", "approved_for_pricing", "need_information", "monitored", "rejected",
    ]);
  });

  test("a new request lands in pending_review by default", () => {
    expect(MIGRATION).toContain("review_state text NOT NULL DEFAULT 'pending_review'");
  });

  test("saving the intake form no longer converts anything", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function createInboxItemAndRoute"));
    const body = fn.slice(0, fn.indexOf("export async function classifyInboxItem"));
    expect(body).not.toContain("convertInboxToRfq(");
    expect(body).not.toContain("convertInboxToTender(");
  });

  test("approval is the only thing that routes", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function approveIntakeForPricing"));
    const body = fn.slice(0, fn.indexOf("export async function requestIntakeInformation"));
    expect(body).toContain("convertInboxToRfq");
    expect(body).toContain("convertInboxToTender");
  });

  test("approval refuses to convert something already converted", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function approveIntakeForPricing"));
    expect(fn.slice(0, 1600)).toContain("converted_record_id");
  });

  test("a database trigger enforces reviewer authority", () => {
    expect(MIGRATION).toContain("CREATE TRIGGER trg_protect_intake_review");
    expect(MIGRATION).toContain("Only a Sales Manager or BD Manager may decide an intake review");
  });
});

describe("who may decide a review", () => {
  test("Sales Manager alone can", () => expect(canReviewIntake(["sales_manager"])).toBe(true));
  test("BD Manager alone can", () => expect(canReviewIntake(["bd_manager"])).toBe(true));
  test("neither needs the other — they are independent grants", () => {
    expect(canReviewIntake(["sales_manager"])).toBe(canReviewIntake(["bd_manager"]));
  });
  test("executives can", () => {
    expect(canReviewIntake(["general_manager"])).toBe(true);
    expect(canReviewIntake(["managing_director"])).toBe(true);
  });
  test("system_admin ALONE cannot", () => expect(canReviewIntake(["system_admin"])).toBe(false));
  test("salesperson cannot", () => expect(canReviewIntake(["salesperson"])).toBe(false));
  test("viewer cannot", () => expect(canReviewIntake(["viewer"])).toBe(false));

  test("system_admin plus a business role gets exactly that role's authority", () => {
    expect(canReviewIntake(["system_admin", "sales_manager"])).toBe(true);
    expect(canReviewIntake(["system_admin", "viewer"])).toBe(false);
    // Adding system_admin never changes the answer.
    for (const r of ["sales_manager", "bd_manager", "salesperson", "viewer"] as const) {
      expect(canReviewIntake([r, "system_admin"])).toBe(canReviewIntake([r]));
    }
  });

  test("the database helper excludes system_admin too", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.can_review_intake"));
    const arr = fn.slice(0, fn.indexOf("$$;"));
    expect(arr).toContain("sales_manager");
    expect(arr).toContain("bd_manager");
    expect(arr).not.toContain("'system_admin'");
  });

  test("a salesperson can still create a request", () => {
    expect(canCreateSalesRecords(["salesperson"])).toBe(true);
  });
});

describe("Need Information", () => {
  test("carries requirements, comment, responsible and due date", () => {
    for (const col of ["info_required_items", "info_comment", "info_responsible_id", "info_due_date", "info_requested_at"]) {
      expect(MIGRATION).toContain(col);
    }
  });

  test("cannot be raised empty — enforced in SQL", () => {
    expect(MIGRATION).toContain("Need Information requires the missing items or a comment");
  });

  test("resubmission is the requester's move, not gated behind the reviewer role", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.protect_intake_review"));
    const resubmitAt = fn.indexOf("resubmitted_at := now()");
    const gateAt = fn.indexOf("Only a Sales Manager or BD Manager");
    expect(resubmitAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    // The carve-out must come FIRST, or the salesperson who was asked for the
    // missing BOQ cannot hand it back without a manager doing it for them.
    expect(resubmitAt).toBeLessThan(gateAt);
  });

  test("resubmission is counted, so a loop is visible", () => {
    expect(MIGRATION).toContain("resubmit_count");
  });
});

describe("Reject and Monitor", () => {
  test("a rejection without a reason is refused in SQL", () => {
    expect(MIGRATION).toContain("A rejected request must carry a reason");
  });
  test("reject stores the reason", () => expect(MIGRATION).toContain("reject_reason"));
  test("monitor is a state, not a conversion", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function monitorIntake"));
    const body = fn.slice(0, fn.indexOf("export async function rejectIntake"));
    expect(body).toContain('"monitored"');
    expect(body).not.toContain("convertInbox");
  });
});

describe("audit trail", () => {
  test("every decision writes an audit entry", () => {
    for (const a of [
      "intake.review.approved",
      "intake.review.information_requested",
      "intake.review.resubmitted",
      "intake.review.monitored",
      "intake.review.rejected",
    ]) {
      expect(ACTIONS).toContain(a);
    }
  });

  test("the trigger stamps who decided and when", () => {
    expect(MIGRATION).toContain("NEW.reviewed_by := _uid");
    expect(MIGRATION).toContain("NEW.reviewed_at := now()");
  });
});

describe("intake data completeness (deterministic, no model needed)", () => {
  const full = {
    request_type: "jih" as const, project_name: "Tower A", company_name: "ACME",
    contact_name: "Sara", deadline: "2026-09-01", location: "Riyadh", scope: "Signage",
    assigned_owner_id: "u1", main_contractor: "BuildCo",
    has_boq: true, has_drawings: true, has_specs: true,
  };

  test("a complete request has nothing missing and scores 100", () => {
    expect(missingIntakeFields(full)).toEqual([]);
    expect(packageCompleteness(full)).toBe(100);
  });

  test("an empty request is not reviewable and flags the blocking gaps", () => {
    const missing = missingIntakeFields({});
    const blocking = missing.filter((m) => m.blocking).map((m) => m.key);
    expect(blocking).toContain("project");
    expect(blocking).toContain("client");
    expect(blocking).toContain("request_type");
    expect(blocking).toContain("contact");
    expect(isReviewable({})).toBe(false);
    expect(packageCompleteness({})).toBeLessThan(50);
  });

  test("a government tender must name the entity; a JIH need not", () => {
    const gov = missingIntakeFields({ ...full, request_type: "tender_government", owner_entity: null });
    expect(gov.some((m) => m.key === "owner_entity" && m.blocking)).toBe(true);
    expect(missingIntakeFields(full).some((m) => m.key === "owner_entity")).toBe(false);
  });

  test("any contact channel satisfies the contact requirement", () => {
    for (const c of [{ contact_name: "S" }, { email: "s@x.com" }, { phone: "0555" }]) {
      expect(missingIntakeFields({ ...full, contact_name: null, email: null, phone: null, ...c })
        .some((m) => m.key === "contact")).toBe(false);
    }
  });

  test("completeness is monotonic — adding a document never lowers the score", () => {
    const without = packageCompleteness({ ...full, has_boq: false });
    expect(packageCompleteness(full)).toBeGreaterThan(without);
  });
});

describe("request-type suggestion (a suggestion, never a decision)", () => {
  test("a stated type is echoed back, not second-guessed", () => {
    expect(suggestRequestType({ request_type: "tender_government" }).suggestion).toBe("tender_government");
  });
  test("owner entity and no contractor reads as a pre-award tender", () => {
    expect(suggestRequestType({ owner_entity: "RCRC" }).suggestion).toBe("tender_government");
  });
  test("a named contractor reads as JIH", () => {
    expect(suggestRequestType({ main_contractor: "BuildCo" }).suggestion).toBe("jih");
  });
  test("nothing to go on stays unknown rather than guessing", () => {
    expect(suggestRequestType({}).suggestion).toBe("unknown");
  });
  test("approval routes on the stored type, not the suggestion", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function approveIntakeForPricing"));
    expect(fn.slice(0, 1800)).not.toContain("suggestRequestType");
  });
});

describe("AI stays advisory", () => {
  test("no AI call decides, converts or changes a review state", () => {
    const panel = read("src/components/phc/IntakeReviewPanel.tsx");
    expect(panel).not.toContain("runAiAgent");
    // Nothing in the action layer lets a model set the state either.
    const fn = ACTIONS.slice(ACTIONS.indexOf("// ── Phase 2 — Opportunity Review gate"));
    expect(fn).not.toContain("runAiAgent");
  });
});

describe("the migration is safe to apply", () => {
  test("additive — nothing dropped or deleted", () => {
    expect(MIGRATION).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|POLICY)\b/i);
    expect(MIGRATION).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(MIGRATION).not.toMatch(/\bTRUNCATE\b/i);
  });

  test("it does not touch the inbox_status enum", () => {
    expect(MIGRATION).not.toMatch(/ALTER\s+TYPE\s+public\.inbox_status/i);
  });

  test("the backfill only describes rows, never moves a converted one backwards", () => {
    expect(MIGRATION).toContain("WHERE review_state = 'pending_review'");
    expect(MIGRATION).toContain("WHEN status = 'converted'            THEN 'approved_for_pricing'");
  });
});
