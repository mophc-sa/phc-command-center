// =============================================================================
// The policy that decides what an unattended import writes to the CRM.
//
// The policy is "approve everything", chosen deliberately by the owner after
// being shown the trade-off. An earlier version held back needs_review,
// conflict and duplicate; this does not.
//
// That makes ONE property load-bearing: every candidate the pipeline was
// unsure about must still be identifiable after the commit. Without that, a
// wrong merge is indistinguishable from a correct one and the only remedy is
// rolling back the whole batch. Most of what follows tests that, not the
// approval itself.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  AUTO_APPROVE_ACTIONS, AUTO_APPROVE_MIN_CONFIDENCE, LOW_CONFIDENCE_MARK,
  UNCERTAIN_ACTIONS, classifyForAutoApproval,
} from "@/lib/import-actions";

type C = { id: string; proposed_action: string; confidence: number | null };
const c = (id: string, proposed_action: string, confidence: number | null): C =>
  ({ id, proposed_action, confidence });

const ALL_SIX = ["create", "update", "no_change", "needs_review", "conflict", "duplicate"];

describe("everything is approved", () => {
  it("approves all six proposed actions", () => {
    const rows = ALL_SIX.map((a, i) => c(String(i), a, 0.9)) as never;
    const r = classifyForAutoApproval(rows);
    expect(r.approve).toHaveLength(6);
    expect(r.hold).toEqual([]);
  });

  it("approves a duplicate, which the previous policy refused", () => {
    // The behavioural difference the owner asked for, stated as its own test
    // so a future revert is visible rather than incidental.
    const r = classifyForAutoApproval([c("a", "duplicate", 0.2)] as never);
    expect(r.approve).toEqual(["a"]);
    expect(r.hold).toEqual([]);
  });

  it("approves a candidate with no confidence score at all", () => {
    const r = classifyForAutoApproval([c("a", "create", null)] as never);
    expect(r.approve).toEqual(["a"]);
  });

  it("holds nothing at the default floor of zero", () => {
    expect(AUTO_APPROVE_MIN_CONFIDENCE).toBe(0);
    const rows = [c("a", "conflict", 0), c("b", "create", 0.01)] as never;
    expect(classifyForAutoApproval(rows).hold).toEqual([]);
  });
});

describe("the uncertain ones stay findable — the property that makes this survivable", () => {
  it("flags a duplicate and says so in its note", () => {
    const r = classifyForAutoApproval([c("a", "duplicate", 0.95)] as never);
    expect(r.flagged).toEqual(["a"]);
    const note = r.approveGroups.find(([, ids]) => ids.includes("a"))![0];
    expect(note).toContain("UNVERIFIED");
    expect(note).toContain("duplicate");
  });

  it("flags a low-confidence create with the actual score", () => {
    const r = classifyForAutoApproval([c("a", "create", 0.42)] as never);
    expect(r.flagged).toEqual(["a"]);
    expect(r.approveGroups.find(([, ids]) => ids.includes("a"))![0]).toContain("42%");
  });

  it("flags a missing score differently from a low one", () => {
    // Absent is not low, and the note has to say which — a null means
    // something did not run, and that is a different investigation.
    const r = classifyForAutoApproval([c("a", "create", null)] as never);
    expect(r.approveGroups.find(([, ids]) => ids.includes("a"))![0]).toContain("no confidence score");
    expect(r.reasons.noConfidence).toBe(1);
  });

  it("records both reasons when a candidate is uncertain twice over", () => {
    const r = classifyForAutoApproval([c("a", "conflict", 0.3)] as never);
    const note = r.approveGroups.find(([, ids]) => ids.includes("a"))![0];
    expect(note).toContain("conflict");
    expect(note).toContain("30%");
  });

  it("does NOT flag a confident, unambiguous candidate", () => {
    // If everything were flagged the flag would carry no information.
    const r = classifyForAutoApproval([c("a", "create", 0.99)] as never);
    expect(r.flagged).toEqual([]);
    expect(r.approveGroups[0][0]).toBe("Auto-approved: unambiguous");
  });

  it("separates the safe from the unverified into different notes", () => {
    const r = classifyForAutoApproval([
      c("a", "create", 0.99), c("b", "duplicate", 0.99),
    ] as never);
    const notes = r.approveGroups.map(([n]) => n);
    expect(notes).toHaveLength(2);
    expect(notes.some((n) => n.includes("UNVERIFIED"))).toBe(true);
    expect(notes.some((n) => n === "Auto-approved: unambiguous")).toBe(true);
  });
});

describe("the batch is fully accounted for", () => {
  it("never loses or duplicates a row", () => {
    const rows = [
      c("a", "create", 0.9), c("b", "duplicate", 0.9), c("c", "update", null),
      c("d", "no_change", 0.85), c("e", "conflict", 0.2), c("f", "create", 0.4),
    ] as never;
    const r = classifyForAutoApproval(rows);
    expect([...r.approve, ...r.hold].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(new Set([...r.approve, ...r.hold]).size).toBe(6);
  });

  it("every approved id appears in exactly one note group", () => {
    // A row in two groups would be written twice by the bulk update.
    const rows = ALL_SIX.map((a, i) => c(String(i), a, i / 10)) as never;
    const r = classifyForAutoApproval(rows);
    const flat = r.approveGroups.flatMap(([, ids]) => ids);
    expect(flat.sort()).toEqual([...r.approve].sort());
    expect(new Set(flat).size).toBe(flat.length);
  });

  it("an empty batch decides nothing rather than throwing", () => {
    const r = classifyForAutoApproval([]);
    expect(r.approve).toEqual([]);
    expect(r.hold).toEqual([]);
    expect(r.flagged).toEqual([]);
  });
});

describe("a caller can still be stricter than the default", () => {
  it("a raised floor holds the rows below it", () => {
    // The escape hatch, kept so tightening the policy later needs no code
    // change — only a different argument.
    const rows = [c("a", "create", 0.9), c("b", "create", 0.5)] as never;
    const r = classifyForAutoApproval(rows, 0.8);
    expect(r.approve).toEqual(["a"]);
    expect(r.hold).toEqual(["b"]);
  });

  it("a raised floor treats a missing score as zero and holds it", () => {
    const r = classifyForAutoApproval([c("a", "create", null)] as never, 0.5);
    expect(r.hold).toEqual(["a"]);
  });
});

describe("the constants document the decision", () => {
  it("all six actions are auto-approvable", () => {
    expect([...AUTO_APPROVE_ACTIONS].sort()).toEqual([...ALL_SIX].sort());
  });

  it("the uncertain set is the three the pipeline could not decide", () => {
    expect([...UNCERTAIN_ACTIONS].sort()).toEqual(["conflict", "duplicate", "needs_review"]);
  });

  it("the flag threshold is meaningful even though the floor is zero", () => {
    expect(LOW_CONFIDENCE_MARK).toBeGreaterThan(AUTO_APPROVE_MIN_CONFIDENCE);
    expect(LOW_CONFIDENCE_MARK).toBeLessThanOrEqual(1);
  });
});
