// =============================================================================
// Phase 5.1 Package C — RFQ workflow and Sales Execution.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  ageBucketOf,
  buildRfqWorkflow,
  summarizeByAge,
  summarizeByState,
  workflowStateOf,
  type QuotationRow,
  type RfqRow,
} from "@/lib/rfq-workflow";
import { salesExecution } from "@/lib/sales-execution";
import type { OppRow } from "@/lib/sales-kpis";
import type { ActivityRow, AttentionItem } from "@/lib/attention";

const TODAY = "2026-08-26";
const rfq = (o: Partial<RfqRow> & { id: string }): RfqRow => ({
  status: "open",
  received_date: "2026-08-25",
  opportunity_id: `opp-${o.id}`,
  ...o,
});
const quote = (oppId: string, status: string): QuotationRow => ({
  id: `q-${oppId}-${status}`,
  related_opportunity_id: oppId,
  status,
});

describe("RFQ workflow state is derived, never invented", () => {
  it("an explicit terminal status on the RFQ wins — somebody set it", () => {
    for (const status of ["converted", "lost", "on_hold"] as const) {
      expect(workflowStateOf(rfq({ id: "a", status }), [quote("opp-a", "draft")])).toBe(status);
    }
  });

  it("a draft quotation means someone is pricing it", () => {
    expect(workflowStateOf(rfq({ id: "a" }), [quote("opp-a", "draft")])).toBe("pricing");
    expect(workflowStateOf(rfq({ id: "a" }), [quote("opp-a", "under_internal_review")])).toBe("pricing");
  });

  it("a submitted quotation means the client has it", () => {
    expect(workflowStateOf(rfq({ id: "a" }), [quote("opp-a", "submitted")])).toBe("awaiting_client");
    expect(workflowStateOf(rfq({ id: "a" }), [quote("opp-a", "negotiation")])).toBe("awaiting_client");
  });

  it("no quotation at all means nothing has started", () => {
    expect(workflowStateOf(rfq({ id: "a" }), [])).toBe("not_started");
  });

  it("a quotation that closed without the RFQ being updated still left the building", () => {
    // Otherwise a won deal reads as "not started" because nobody tidied the RFQ.
    expect(workflowStateOf(rfq({ id: "a" }), [quote("opp-a", "won")])).toBe("awaiting_client");
  });

  it("another opportunity's quotation is not this RFQ's business", () => {
    expect(workflowStateOf(rfq({ id: "a" }), [quote("opp-other", "submitted")])).toBe("not_started");
  });

  it("an RFQ with no linked opportunity cannot borrow a quotation", () => {
    expect(workflowStateOf(rfq({ id: "a", opportunity_id: null }), [quote("opp-a", "submitted")])).toBe("not_started");
  });
});

describe("RFQ age", () => {
  it("buckets on the documented boundaries", () => {
    expect(ageBucketOf(0)).toBe("0-3");
    expect(ageBucketOf(3)).toBe("0-3");
    expect(ageBucketOf(4)).toBe("4-7");
    expect(ageBucketOf(7)).toBe("4-7");
    expect(ageBucketOf(8)).toBe("8-14");
    expect(ageBucketOf(14)).toBe("8-14");
    expect(ageBucketOf(15)).toBe("15+");
    expect(ageBucketOf(900)).toBe("15+");
  });

  it("is computed from received_date, which is NOT NULL on every row", () => {
    const [w] = buildRfqWorkflow([rfq({ id: "a", received_date: "2026-08-16" })], [], TODAY);
    expect(w.ageDays).toBe(10);
    expect(w.ageBucket).toBe("8-14");
  });

  it("ages only live work — a converted RFQ measures how long ago we won", () => {
    const rows = buildRfqWorkflow(
      [rfq({ id: "a", received_date: "2026-08-01" }), rfq({ id: "b", status: "converted", received_date: "2026-08-01" })],
      [],
      TODAY,
    );
    const buckets = summarizeByAge(rows);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(1);
  });
});

describe("RFQ overdue is a flag, not a state", () => {
  it("fires when the response date passed with nothing submitted", () => {
    const [w] = buildRfqWorkflow([rfq({ id: "a", response_due_date: "2026-08-20" })], [], TODAY);
    expect(w.overdue).toBe(true);
    expect(w.daysOverdue).toBe(6);
  });

  it("an RFQ can be actively priced AND late — collapsing them would hide one", () => {
    const [w] = buildRfqWorkflow(
      [rfq({ id: "a", response_due_date: "2026-08-20" })],
      [quote("opp-a", "draft")],
      TODAY,
    );
    expect(w.state).toBe("pricing");
    expect(w.overdue).toBe(true);
  });

  it("submitted work met its deadline by definition", () => {
    const [w] = buildRfqWorkflow(
      [rfq({ id: "a", response_due_date: "2026-08-20" })],
      [quote("opp-a", "submitted")],
      TODAY,
    );
    expect(w.overdue).toBe(false);
  });

  it("finished work cannot be late", () => {
    const [w] = buildRfqWorkflow([rfq({ id: "a", status: "converted", response_due_date: "2026-08-01" })], [], TODAY);
    expect(w.overdue).toBe(false);
  });

  it("no response date means never overdue — no inferred deadline", () => {
    const [w] = buildRfqWorkflow([rfq({ id: "a", response_due_date: null })], [], TODAY);
    expect(w.overdue).toBe(false);
  });
});

describe("RFQ state roll-up does not double count", () => {
  it("every RFQ lands in exactly one state", () => {
    const rows = buildRfqWorkflow(
      [rfq({ id: "a" }), rfq({ id: "b", status: "converted" }), rfq({ id: "c" })],
      [quote("opp-c", "submitted")],
      TODAY,
    );
    const states = summarizeByState(rows);
    expect(states.reduce((s, x) => s + x.count, 0)).toBe(3);
    expect(new Set(states.flatMap((x) => x.ids)).size).toBe(3);
  });
});

// ---- Sales Execution --------------------------------------------------------

const o = (x: Partial<OppRow> & { id: string; owner_id: string }): OppRow => ({
  sales_stage: "jih",
  ...x,
});

describe("sales execution measures outcomes, not keystrokes", () => {
  const opps = [
    o({ id: "o1", owner_id: "u1", quotation_value: 4_000_000, human_win_probability: 50 }),
    o({ id: "o2", owner_id: "u1", quotation_value: 1_000_000 }),
    o({ id: "o3", owner_id: "u2", sales_stage: "won", contract_value: 2_000_000 }),
  ];

  it("one row per owner who actually carries pipeline", () => {
    const rows = salesExecution({ opportunities: opps, today: TODAY });
    expect(rows.map((r) => r.ownerId)).toEqual(["u1", "u2"]);
  });

  it("weighted is null, not zero, when nothing in the book is scored", () => {
    // A rep whose deals nobody has scored does not have a worthless pipeline.
    const rows = salesExecution({
      opportunities: [o({ id: "x", owner_id: "u3", quotation_value: 5_000_000 })],
      today: TODAY,
    });
    expect(rows[0].weightedPipeline).toBeNull();
    expect(rows[0].unscoredCount).toBe(1);
  });

  it("weights only the scored portion and says what it left out", () => {
    const rows = salesExecution({ opportunities: opps, today: TODAY });
    const u1 = rows.find((r) => r.ownerId === "u1")!;
    expect(u1.weightedPipeline).toBe(2_000_000);
    expect(u1.unscoredCount).toBe(1);
    expect(u1.openPipeline).toBe(5_000_000);
  });

  it("won value counts Won only", () => {
    const rows = salesExecution({ opportunities: opps, today: TODAY });
    expect(rows.find((r) => r.ownerId === "u2")!.wonValue).toBe(2_000_000);
    expect(rows.find((r) => r.ownerId === "u1")!.wonValue).toBe(0);
  });

  it("counts real meetings, not notes or unsent drafts", () => {
    const activities: ActivityRow[] = [
      { id: "a1", opportunity_id: "o1", activity_type: "meeting", status: "logged", created_at: TODAY },
      { id: "a2", opportunity_id: "o1", activity_type: "note", status: "logged", created_at: TODAY },
      { id: "a3", opportunity_id: "o1", activity_type: "email_draft", status: "draft", created_at: TODAY },
    ];
    const rows = salesExecution({ opportunities: opps, activities, today: TODAY });
    expect(rows.find((r) => r.ownerId === "u1")!.meetings).toBe(1);
  });

  it("submitted value counts issued quotations only — a draft never went out", () => {
    const rows = salesExecution({
      opportunities: opps,
      quotations: [
        { id: "q1", related_opportunity_id: "o1", status: "submitted", value: 900_000, issued_date: "2026-08-20" },
        { id: "q2", related_opportunity_id: "o1", status: "draft", value: 500_000, issued_date: null },
      ],
      today: TODAY,
      since: "2026-08-01",
    });
    expect(rows.find((r) => r.ownerId === "u1")!.submittedValue).toBe(900_000);
  });

  it("reuses the attention engine's stalled verdicts rather than recomputing", () => {
    // Two definitions of stalled is how a table and a panel start disagreeing.
    const attention = [{ opportunityId: "o1", stalled: true, value: 4_000_000 }] as unknown as AttentionItem[];
    const rows = salesExecution({ opportunities: opps, attention, today: TODAY });
    expect(rows.find((r) => r.ownerId === "u1")!.stalledValue).toBe(4_000_000);
  });

  it("exposes no per-person call or email counts", () => {
    // Guards the boundary deliberately: this is discipline, not surveillance.
    const rows = salesExecution({ opportunities: opps, today: TODAY });
    const keys = Object.keys(rows[0]);
    expect(keys).not.toContain("calls");
    expect(keys).not.toContain("emails");
    expect(keys).not.toContain("activityCount");
  });

  it("orders by book size, largest first, deterministically", () => {
    const rows = salesExecution({ opportunities: opps, today: TODAY });
    const again = salesExecution({ opportunities: [...opps].reverse(), today: TODAY });
    expect(again.map((r) => r.ownerId)).toEqual(rows.map((r) => r.ownerId));
  });
});

// ---- Corrections found by looking at the rendered screen, 2026-08-26 --------

describe("defects the rendered Command Center exposed", () => {
  it("a per-rep weighted zero resting on unscored deals is null, like the headline", () => {
    // Rendered: "Marie Falome · SAR 0 · SAR 0". The company total had this
    // guard; the per-rep column did not, so the same defect survived one level
    // down where it is harder to notice.
    const rows = salesExecution({
      opportunities: [
        o({ id: "a", owner_id: "u1", quotation_value: 900_000, score: 0 }),
        o({ id: "b", owner_id: "u1", quotation_value: 5_000_000 }),
      ],
      today: TODAY,
    });
    expect(rows[0].weightedPipeline).toBeNull();
  });

  it("an unpriced open book reports no value rather than SAR 0", () => {
    const rows = salesExecution({ opportunities: [o({ id: "a", owner_id: "u1" })], today: TODAY });
    expect(rows[0].openPipeline).toBeNull();
    expect(rows[0].unpricedCount).toBe(1);
  });

  it("a rep with no open deals at all is a real zero", () => {
    const rows = salesExecution({
      opportunities: [o({ id: "a", owner_id: "u1", sales_stage: "won", contract_value: 10 })],
      today: TODAY,
    });
    expect(rows[0].openPipeline).toBe(0);
  });

  it("stalled carries a COUNT, so unpriced stalled work cannot vanish", () => {
    // Rendered: roll-up said "STALLED 4" while every row of the table said "—",
    // because all four stalled deals were unpriced and the column showed value
    // only. The table contradicted the headline above it.
    const attention = [{ opportunityId: "a", stalled: true, value: null }] as unknown as AttentionItem[];
    const rows = salesExecution({
      opportunities: [o({ id: "a", owner_id: "u1" })],
      attention,
      today: TODAY,
    });
    expect(rows[0].stalledCount).toBe(1);
    expect(rows[0].stalledValue).toBe(0);
  });
});
