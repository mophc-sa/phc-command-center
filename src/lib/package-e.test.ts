// =============================================================================
// Package E — stakeholder completeness, and the AI draft/confirm loop.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAKEHOLDER_ROLES,
  decisionMakerState,
  effectiveRole,
  isStakeholderRole,
  normalizeHistoricalRole,
  rolesPresent,
  type StakeholderRow,
} from "@/lib/stakeholder-roles";
import {
  DRAFT_WRITES,
  confirmDraft,
  draftFollowUp,
  draftMeetingBrief,
  draftNextAction,
  groundedDueDate,
  isProposalAllowed,
} from "@/lib/ai-drafts";
import { buildAttention, dataQuality, REASON_CATEGORY, type AttentionOpp } from "@/lib/attention";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const TODAY = "2026-08-26";
const sh = (o: Partial<StakeholderRow> & { id: string }): StakeholderRow => ({ ...o });

// ---- Controlled vocabulary --------------------------------------------------

describe("opportunity roles are a closed vocabulary", () => {
  it("covers exactly the seven the spec names", () => {
    expect([...STAKEHOLDER_ROLES].sort()).toEqual(
      ["decision_maker", "finance", "gatekeeper", "influencer", "other", "procurement", "technical"],
    );
  });

  it("refuses anything outside it", () => {
    expect(isStakeholderRole("chief_vibes_officer")).toBe(false);
    expect(isStakeholderRole("")).toBe(false);
    expect(isStakeholderRole(null)).toBe(false);
    expect(isStakeholderRole("decision_maker")).toBe(true);
  });

  it("the SQL constraint lists the same seven — one vocabulary, not two", () => {
    const sql = read("supabase/migrations/20260915100000_stakeholder_opportunity_roles.sql");
    for (const r of STAKEHOLDER_ROLES) expect([r, sql.includes(`'${r}'`)]).toEqual([r, true]);
  });
});

describe("historical free text is preserved, never rewritten", () => {
  it("reads the obvious phrasings, in both languages", () => {
    expect(normalizeHistoricalRole("Decision Maker")).toBe("decision_maker");
    expect(normalizeHistoricalRole("صانع القرار")).toBe("decision_maker");
    expect(normalizeHistoricalRole("Procurement Manager")).toBe("procurement");
    expect(normalizeHistoricalRole("Technical Consultant")).toBe("technical");
    expect(normalizeHistoricalRole("Finance Director")).toBe("finance");
  });

  it("returns null for text that means nothing to us, rather than guessing", () => {
    // A wrong confident mapping would put "Decision Maker Identified: Yes" on a
    // guess, which is the false completeness this phase exists to remove.
    expect(normalizeHistoricalRole("Main Contact")).toBeNull();
    expect(normalizeHistoricalRole("Site")).toBeNull();
    expect(normalizeHistoricalRole("")).toBeNull();
    expect(normalizeHistoricalRole(null)).toBeNull();
  });

  it("the controlled value wins where both exist", () => {
    expect(effectiveRole(sh({ id: "1", role: "Procurement Manager", role_code: "finance" }))).toBe("finance");
  });

  it("the migration is additive — it drops nothing and rewrites no row", () => {
    const sql = read("supabase/migrations/20260915100000_stakeholder_opportunity_roles.sql");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS role_code/);
    expect(sql).not.toMatch(/DROP COLUMN|ALTER COLUMN role\b|UPDATE public\.stakeholders/);
  });

  it("normalizeHistoricalRole never writes — it only affects display", () => {
    const src = read("src/lib/stakeholder-roles.ts");
    expect(src).not.toMatch(/supabase|\.update\(|\.insert\(/);
  });
});

// ---- Decision maker: three states, not two ---------------------------------

describe("Decision Maker Identified", () => {
  it("yes when a stakeholder holds the role", () => {
    expect(decisionMakerState([sh({ id: "1", role_code: "decision_maker" })])).toBe("yes");
  });

  it("yes when the denormalised column names one", () => {
    expect(decisionMakerState([], "Eng. Khalid")).toBe("yes");
  });

  it("no when people are attached with readable roles and none decides", () => {
    expect(decisionMakerState([sh({ id: "1", role_code: "technical" })])).toBe("no");
  });

  it("no when nobody is attached at all", () => {
    expect(decisionMakerState([])).toBe("no");
  });

  it("UNKNOWN when the only roles are unreadable legacy text", () => {
    // Not "no". Nobody has shown this deal lacks a decision maker; nobody has
    // recorded one in a form we can read. Those are different facts.
    expect(decisionMakerState([sh({ id: "1", role: "Main Contact" })])).toBe("unknown");
  });

  it("reads a legacy role that IS recognisable as a yes", () => {
    expect(decisionMakerState([sh({ id: "1", role: "Decision Maker" })])).toBe("yes");
  });

  it("rolesPresent reports the distinct roles on a deal", () => {
    const roles = rolesPresent([
      sh({ id: "1", role_code: "technical" }),
      sh({ id: "2", role_code: "technical" }),
      sh({ id: "3", role: "Procurement Lead" }),
    ]);
    expect(roles).toEqual(["technical", "procurement"]);
  });
});

// ---- Data Quality integration ----------------------------------------------

describe("relationship completeness feeds Data Quality, not risk", () => {
  const bare: AttentionOpp = {
    id: "a",
    sales_stage: "jih",
    project_name: "a",
    next_action: "Call",
    next_action_due: "2026-12-01",
    human_win_probability: 50,
    owner_id: "u1",
    client: "ICAD",
    quotation_value: 1_000_000,
    contractor_decision_maker: null,
  };

  it("a missing decision maker is a data_quality reason", () => {
    expect(REASON_CATEGORY.no_decision_maker).toBe("data_quality");
  });

  it("…and does NOT make the opportunity At Risk", () => {
    const [item] = buildAttention({
      opportunities: [bare],
      activities: [{ id: "m", opportunity_id: "a", activity_type: "meeting", status: "logged", created_at: TODAY }],
      today: TODAY,
    });
    expect(item.reasons.map((r) => r.kind)).toContain("no_decision_maker");
    expect(item.atRisk).toBe(false);
  });

  it("it reaches the Data Quality report with its records", () => {
    const items = buildAttention({ opportunities: [bare], today: TODAY });
    const dq = dataQuality(items, 1);
    const issue = dq.issues.find((i) => i.kind === "no_decision_maker")!;
    expect(issue.count).toBe(1);
    expect(issue.opportunityIds).toEqual(["a"]);
  });

  it("one opportunity is counted once per issue, however many gaps it has", () => {
    const items = buildAttention({ opportunities: [bare, { ...bare, id: "b" }], today: TODAY });
    const dq = dataQuality(items, 2);
    for (const i of dq.issues) expect([i.kind, new Set(i.opportunityIds).size]).toEqual([i.kind, i.count]);
    expect(dq.affectedOpportunities).toBe(2);
  });
});

// ---- The draft / confirm loop ----------------------------------------------

const item = (over: Partial<ReturnType<typeof buildAttention>[number]> = {}) => {
  const [i] = buildAttention({
    opportunities: [
      {
        id: "d1", sales_stage: "jih", project_name: "Deal One",
        next_action: null, owner_id: "u1", client: "ICAD",
        quotation_value: 2_000_000, human_win_probability: 40,
        contractor_decision_maker: "Khalid",
      },
    ],
    followUps: [{ id: "f", opportunity_id: "d1", due_date: "2026-08-01", status: "scheduled" }],
    activities: [{ id: "m", opportunity_id: "d1", activity_type: "meeting", status: "logged", created_at: TODAY }],
    today: TODAY,
  });
  return { ...i, ...over };
};

describe("a draft is inert until a person confirms it", () => {
  it("drafting writes nothing — the module has no client at all", () => {
    const src = read("src/lib/ai-drafts.ts");
    expect(src).not.toMatch(/from\s+"@\/integrations\/supabase/);
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  it("the only write goes through the app's EXISTING follow-up creator", () => {
    // A second task system would be two places to look when something is
    // missing, and two audit trails to reconcile.
    const src = read("src/lib/ai-drafts.ts");
    expect(src).toContain('import { scheduleFollowUp } from "@/lib/opportunity-actions"');
    // One real call site. The import and the header comment also carry the
    // name, so both are excluded.
    const callSites = src
      .split("\n")
      .filter((l) => /scheduleFollowUp\(/.test(l))
      .filter((l) => !l.startsWith("import") && !l.trimStart().startsWith("//"));
    expect(callSites).toHaveLength(1);
  });

  it("a follow-up draft explains itself from the record's own reasons", () => {
    const d = draftFollowUp(item(), TODAY);
    expect(d.kind).toBe("follow_up");
    expect(d.opportunityId).toBe("d1");
    expect(d.rationale).toContain("follow_up_overdue");
    expect(d.rationale).toContain("no_next_action");
  });

  it("it drafts no message text — nothing is ever composed for sending here", () => {
    expect(draftFollowUp(item(), TODAY).message).toBeNull();
  });

  it("a due date is suggested only where it can be grounded", () => {
    // Already late → today. Otherwise no date, and the user supplies one: an
    // invented deadline would land in a real queue.
    expect(groundedDueDate(item(), TODAY)).toBe(TODAY);
    const noSignal = { ...item(), reasons: [], closingSoon: false };
    expect(groundedDueDate(noSignal, TODAY)).toBeNull();
  });

  it("confirming without a grounded date is refused, not guessed", async () => {
    const d = { ...draftFollowUp(item(), TODAY), dueDate: null };
    const r = await confirmDraft(d);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("no_due_date");
  });
});

describe("meeting briefs and next actions write nothing at all", () => {
  it("both are read-only by declaration", () => {
    expect(DRAFT_WRITES.meeting_brief).toBe("none");
    expect(DRAFT_WRITES.next_action).toBe("none");
    expect(DRAFT_WRITES.follow_up).toBe("follow_up");
  });

  it("confirming a meeting brief is refused rather than silently doing nothing", async () => {
    // A caller that wires the wrong button finds out immediately.
    const r = await confirmDraft(draftMeetingBrief(item()));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("not_writable");
  });

  it("confirming a next-action suggestion is refused too — it stays a recommendation", async () => {
    const r = await confirmDraft(draftNextAction(item()));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("not_writable");
  });

  it("a meeting brief carries the deal's deterministic points, not model prose", () => {
    const b = draftMeetingBrief(item());
    expect(b.headline).toBe("Deal One");
    expect(b.points.length).toBeGreaterThan(0);
  });
});

describe("forbidden actions cannot enter through the draft surface", () => {
  it("reuses the one forbidden-action list rather than growing another", () => {
    expect(read("src/lib/ai-drafts.ts")).toContain("checkRecommendation");
  });

  it("refuses a proposal to send, approve, reassign or close", () => {
    for (const action of ["send_email", "send_whatsapp", "record_won", "change_owner", "approve_bafo"]) {
      expect([action, isProposalAllowed({ id: "x", text: "do it", proposedAction: action })]).toEqual([action, false]);
    }
  });

  it("allows an ordinary human action", () => {
    expect(isProposalAllowed({ id: "x", text: "Call the client", proposedAction: "call" })).toBe(true);
  });
});
