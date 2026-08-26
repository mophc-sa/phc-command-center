// =============================================================================
// The Opportunities KPI strip, as the sales team asked for it (client feedback
// 2026-08-25, slide 4).
//
// The three figures worth guarding are the ones a manager will act on: what is
// still owed against the target, how the open book splits between JIH and
// Tender, and what is sitting unsubmitted. Each has a way of being wrong that
// looks perfectly plausible on screen — a gap that quietly goes negative, a
// classification read off the wrong RFQ, a lost quotation counted as one still
// to be sent.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  classificationOf,
  commercialBookKpis,
  hasSubmittedQuotation,
  pendingSubmissionRows,
  type ClassifiedRow,
} from "@/lib/sales-kpis";

const CTX = { today: "2026-08-25", period: null };

const row = (o: Partial<ClassifiedRow> & { id: string }): ClassifiedRow => ({
  sales_stage: "jih",
  ...o,
});

describe("classification comes off the newest RFQ", () => {
  it("reads the classification when there is exactly one RFQ", () => {
    expect(classificationOf(row({ id: "a", rfqs: [{ classification: "jih" }] }))).toBe("jih");
  });

  it("prefers the newest when an opportunity has more than one", () => {
    // A re-issued tender leaves the old RFQ in place. Reading the first row
    // PostgREST happens to return would make the answer depend on row order.
    const o = row({
      id: "a",
      rfqs: [
        { classification: "tender", created_at: "2026-01-01T00:00:00Z" },
        { classification: "jih", created_at: "2026-06-01T00:00:00Z" },
      ],
    });
    expect(classificationOf(o)).toBe("jih");
  });

  it("is null with no RFQ, an empty embed, or an unset classification", () => {
    expect(classificationOf(row({ id: "a" }))).toBeNull();
    expect(classificationOf(row({ id: "a", rfqs: [] }))).toBeNull();
    expect(classificationOf(row({ id: "a", rfqs: [{ classification: null }] }))).toBeNull();
  });

  it("refuses a value the column's CHECK constraint would not allow", () => {
    expect(classificationOf(row({ id: "a", rfqs: [{ classification: "JIH " }] }))).toBeNull();
  });
});

describe("a quotation counts as submitted once it has left the building", () => {
  it("pre-submission statuses are not submitted", () => {
    for (const status of ["draft", "under_internal_review", "approved_for_submission"]) {
      expect(hasSubmittedQuotation(row({ id: "a", quotations: [{ status }] }))).toBe(false);
    }
  });

  it("submitted, and everything downstream of it, counts", () => {
    for (const status of ["submitted", "follow_up", "negotiation", "revised", "won"]) {
      expect(hasSubmittedQuotation(row({ id: "a", quotations: [{ status }] }))).toBe(true);
    }
  });

  it("a lost or expired quotation is an outcome OF a submission, not one still owed", () => {
    // The tempting reading — "not won, so still to do" — would park closed
    // business permanently in the pending queue.
    expect(hasSubmittedQuotation(row({ id: "a", quotations: [{ status: "lost" }] }))).toBe(true);
    expect(hasSubmittedQuotation(row({ id: "a", quotations: [{ status: "expired" }] }))).toBe(true);
  });

  it("one submitted quotation is enough, even alongside a draft revision", () => {
    const o = row({ id: "a", quotations: [{ status: "draft" }, { status: "submitted" }] });
    expect(hasSubmittedQuotation(o)).toBe(true);
  });

  it("no quotation at all means nothing has been submitted", () => {
    expect(hasSubmittedQuotation(row({ id: "a" }))).toBe(false);
    expect(hasSubmittedQuotation(row({ id: "a", quotations: [] }))).toBe(false);
  });
});

describe("pending for submission", () => {
  it("counts open work with no quotation out", () => {
    const rows = pendingSubmissionRows(
      [row({ id: "a" }), row({ id: "b", quotations: [{ status: "submitted" }] })],
      CTX,
    );
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("excludes closed work, however unquoted", () => {
    // A deal lost before we ever quoted is not a quotation still to be sent.
    const rows = pendingSubmissionRows(
      [row({ id: "a", sales_stage: "lost" }), row({ id: "b", sales_stage: "won" })],
      CTX,
    );
    expect(rows).toEqual([]);
  });

  it("includes a paused deal — on_hold is open, and the quote is still owed", () => {
    const rows = pendingSubmissionRows([row({ id: "a", sales_stage: "on_hold" })], CTX);
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("the strip as a whole", () => {
  const BOOK: ClassifiedRow[] = [
    row({ id: "j1", rfqs: [{ classification: "jih" }] }),
    row({ id: "j2", rfqs: [{ classification: "jih" }], quotations: [{ status: "submitted" }] }),
    row({ id: "t1", rfqs: [{ classification: "tender" }] }),
    row({ id: "t2", rfqs: [{ classification: "tender" }], quotations: [{ status: "won" }] }),
    row({ id: "u1" }),
    row({ id: "va", sales_stage: "verbally_awarded", rfqs: [{ classification: "jih" }] }),
    row({ id: "w1", sales_stage: "won", contract_value: 3_000_000 }),
  ];

  it("splits the open book by classification", () => {
    const k = commercialBookKpis(BOOK, CTX, 10_000_000);
    // j1, j2 and the verbally-awarded JIH — verbally_awarded is an open stage.
    expect(k.jih.value).toBe(3);
    expect(k.tenders.value).toBe(2);
    expect(k.verballyAwarded.value).toBe(1);
  });

  it("names the unclassified records rather than quietly dropping them", () => {
    const k = commercialBookKpis(BOOK, CTX, 10_000_000);
    expect(k.jih.caveat).toEqual({ key: "cav_unclassified_neither", params: { count: 1 } });
  });

  it("need-to-close is the target less what has been won", () => {
    const k = commercialBookKpis(BOOK, CTX, 10_000_000);
    expect(k.achievement.value).toBe(3_000_000);
    expect(k.needToClose.value).toBe(7_000_000);
  });

  it("never reports a negative gap once the target is beaten", () => {
    // "NEED TO CLOSE: -2,000,000" is not a number anyone can act on.
    const k = commercialBookKpis(BOOK, CTX, 1_000_000);
    expect(k.needToClose.value).toBe(0);
  });

  it("shows a dash, not a zero, when no target has been set", () => {
    const k = commercialBookKpis(BOOK, CTX, null);
    expect(k.target.value).toBeNull();
    expect(k.needToClose.value).toBeNull();
    expect(k.target.caveat).toBeTruthy();
  });

  it("the JIH and Tender pending figures sum to the total when all are classified", () => {
    const classified = BOOK.filter((o) => o.id !== "u1");
    const k = commercialBookKpis(classified, CTX, 10_000_000);
    expect((k.jihPending.value ?? 0) + (k.tenderPending.value ?? 0)).toBe(k.pendingForSubmission.value);
    expect(k.pendingForSubmission.caveat).toBeUndefined();
  });

  it("says so when they do not sum, instead of letting the reader assume they do", () => {
    const k = commercialBookKpis(BOOK, CTX, 10_000_000);
    expect((k.jihPending.value ?? 0) + (k.tenderPending.value ?? 0)).toBeLessThan(
      k.pendingForSubmission.value ?? 0,
    );
    expect(k.pendingForSubmission.caveat?.key).toBe("cav_unclassified_do_not_sum");
  });

  it("every figure carries the record ids that produced it", () => {
    const k = commercialBookKpis(BOOK, CTX, 10_000_000);
    for (const kpi of [k.jih, k.tenders, k.verballyAwarded, k.pendingForSubmission]) {
      expect(kpi.recordCount).toBe(kpi.recordIds.length);
      expect(kpi.recordCount).toBe(kpi.value);
    }
  });
});
