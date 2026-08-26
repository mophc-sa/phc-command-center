// =============================================================================
// A canonical forbidden action must be refused wherever it appears.
//
// THE GAP THIS CLOSES
// -------------------
// The prose patterns are written for model English — /\bsend\b[^.]{0,20}\be-?mail\b/
// and friends. `\b` cannot match inside `send_email`, because `_` is a word
// character: there is no boundary after "send". An exact-equality check on
// proposedAction covered the bare token, so `send_email` alone was refused —
// but `send_email to the client` matched neither the equality check nor any
// prose pattern.
//
// Measured before the fix, across all 14 canonical actions in four positions:
// 39 of 56 cases leaked. Only change_owner survived, and only by accident of
// its own prose pattern.
//
// This matters now because sales_report_insights.recommended_actions is
// string[], so commentaryFromReportInsights passes the model's own prose as
// proposedAction. The token guard is what stands between that prose and a
// rendered recommendation.
//
// Every case below is GENERATED from AI_FORBIDDEN_ACTIONS. Adding an action to
// that list automatically extends this suite; there is no second list.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  AI_FORBIDDEN_ACTIONS,
  checkRecommendation,
  filterRecommendations,
  type AiRecommendation,
} from "@/lib/sales-ai";

const rec = (s: string): AiRecommendation => ({ id: "r", text: s, proposedAction: s });
const refused = (s: string) => !checkRecommendation(rec(s)).allowed;
const violated = (s: string) => checkRecommendation(rec(s)).violated;

describe("every canonical forbidden token is refused, in every position", () => {
  it("covers the whole authoritative list, not a sample", () => {
    expect(AI_FORBIDDEN_ACTIONS.length).toBeGreaterThanOrEqual(14);
  });

  for (const action of AI_FORBIDDEN_ACTIONS) {
    describe(action, () => {
      it("alone", () => {
        expect([action, refused(action)]).toEqual([action, true]);
        expect(violated(action)).toBe(action);
      });

      it("embedded in prose — the case that leaked", () => {
        const s = `${action} to the client`;
        expect([s, refused(s)]).toEqual([s, true]);
        expect(violated(s)).toBe(action);
      });

      it("surrounded by punctuation", () => {
        const s = `Please do this: ${action}.`;
        expect([s, refused(s)]).toEqual([s, true]);
      });

      it("inside a recommendation sentence", () => {
        const s = `Recommended next step: ${action} to procurement.`;
        expect([s, refused(s)]).toEqual([s, true]);
      });

      it("at the very start and the very end of the string", () => {
        expect([action, refused(`${action} now`)]).toEqual([action, true]);
        expect([action, refused(`The team should ${action}`)]).toEqual([action, true]);
      });

      it("across whitespace and newlines", () => {
        const s = `Next:\n  ${action}\n`;
        expect([s.replace(/\n/g, "\\n"), refused(s)]).toEqual([s.replace(/\n/g, "\\n"), true]);
      });

      it("in upper case — the same instruction, shouted", () => {
        const s = action.toUpperCase();
        expect([s, refused(s)]).toEqual([s, true]);
      });

      it("is caught even when it only appears in `text`, not `proposedAction`", () => {
        const r = { id: "r", text: `We should ${action} tomorrow`, proposedAction: "Call the client" };
        expect([action, checkRecommendation(r).allowed]).toEqual([action, false]);
      });
    });
  }
});

describe("only ACTUAL tokens are refused — no substring matching", () => {
  // A word that merely contains a token is not that token. Rejecting these
  // would make the guard unpredictable, which is its own kind of failure.
  const allowed = [
    "Resend_email was already handled by the team",
    "send_emailing is not a real action",
    "Review the change_owners spreadsheet column",
    "Ask procurement about the boq_reference number",
    "Call the client to confirm the timeline",
    "The BLVD deal is worth SAR 14,402,511",
    "Record the meeting notes in the CRM",
    "Close the loop with the consultant",
  ];
  for (const s of allowed) {
    it(`allows: ${s.slice(0, 46)}`, () => {
      const r = checkRecommendation(rec(s));
      expect([s, r.allowed, r.violated ?? null]).toEqual([s, true, null]);
    });
  }

  it("a word-character on either side means it is not a token occurrence", () => {
    expect(refused("xsend_email")).toBe(false);
    expect(refused("send_emailx")).toBe(false);
    expect(refused("send_email")).toBe(true);
  });
});

describe("multiple tokens, and the reported reason", () => {
  it("a string carrying two forbidden tokens is refused once, deterministically", () => {
    const s = "First record_won, then send_email to the client";
    const r = checkRecommendation(rec(s));
    expect(r.allowed).toBe(false);
    // Reported in AI_FORBIDDEN_ACTIONS order, so the reason never varies run to run.
    expect(r.violated).toBe("record_won");
  });

  it("the reason names the action in readable form", () => {
    const r = checkRecommendation(rec("send_email to the client"));
    expect(r.reason).toContain("send email");
    expect(r.reason).toContain("A person decides this.");
  });
});

describe("natural-language detection still works — nothing was weakened", () => {
  const prose: Array<[string, string]> = [
    ["Send an email to the client confirming the award", "send_email"],
    ["Mark the BLVD deal as won", "record_won"],
    ["Record the deal as lost", "record_lost"],
    ["Reassign the owner to Khalid", "change_owner"],
    ["Approve the BAFO discount", "approve_bafo"],
    ["Move the opportunity to the next stage", "change_sales_stage"],
    ["Set the manager probability to 80%", "change_human_probability"],
    ["Update the target for this quarter", "change_target"],
    ["Issue a project number for this deal", "issue_project_number"],
    ["Validate the BOQ before pricing", "validate_boq"],
    ["Send a whatsapp message to procurement", "send_whatsapp"],
  ];
  for (const [s, expected] of prose) {
    it(`still refuses: ${s.slice(0, 44)}`, () => {
      expect([s, refused(s)]).toEqual([s, true]);
      expect([s, violated(s)]).toEqual([s, expected]);
    });
  }
});

describe("filterRecommendations keeps the innocent", () => {
  it("removes only the offending entries", () => {
    const { allowed, refused: dropped } = filterRecommendations([
      rec("Call the client to confirm the timeline"),
      rec("send_email to the client"),
      rec("Mark the BLVD deal as won"),
      rec("Record a win probability on the ten largest open deals"),
    ]);
    expect(allowed.map((a) => a.text)).toEqual([
      "Call the client to confirm the timeline",
      "Record a win probability on the ten largest open deals",
    ]);
    expect(dropped.map((d) => d.violated).sort()).toEqual(["record_won", "send_email"]);
  });

  it("an empty list stays empty and raises nothing", () => {
    const { allowed, refused: dropped } = filterRecommendations([]);
    expect(allowed).toEqual([]);
    expect(dropped).toEqual([]);
  });
});
