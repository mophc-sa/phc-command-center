import { describe, expect, it } from "bun:test";
import {
  accountMessage, buildSubmission, daysLeft, inviteMessage, isOverdue, portalLink, riyadhToday, supplierGate,
  type PortalLine,
} from "./supplier-portal";

const line = (id: string, over: Partial<PortalLine> = {}): PortalLine => ({
  line_id: id, line_number: 1, sign_type: "Pylon", description: null, dimensions: null, material: null, mounting: null,
  illumination: null, finish: null, quantity: 2, unit: "pcs", width_mm: null, height_mm: null, has_screen: true,
  state: "open", editable: true, unit_cost: null, unit_cost_with_screen: null, spec_difference: null, ...over,
});
const TERMS = { lead: "30", payment: "30% advance", valid: "2099-12-31" };
const TODAY = "2026-11-08";

describe("buildSubmission", () => {
  it("sends every editable line, typed or kept, and the three terms", () => {
    const r = buildSubmission(
      [line("a"), line("b", { unit_cost: 50, spec_difference: "Acrylic" }), line("c", { editable: false, state: "submitted", unit_cost: 9 })],
      { a: { unit_cost: "1,200.5", unit_cost_with_screen: "1500", spec_difference: "  Aluminium  " } },
      TERMS,
      TODAY,
    );
    expect(r).toEqual({
      ok: true,
      lines: [
        { line_id: "a", unit_cost: 1200.5, unit_cost_with_screen: 1500, spec_difference: "Aluminium" },
        { line_id: "b", unit_cost: 50, unit_cost_with_screen: null, spec_difference: "Acrylic" },
      ],
      terms: { lead_time_days: 30, payment_terms: "30% advance", valid_until: "2099-12-31" },
    });
  });
  it("an emptied box sends no price", () => {
    const r = buildSubmission([line("a", { unit_cost: 50 }), line("b", { unit_cost: 9 })], { a: { unit_cost: "" } }, TERMS, TODAY);
    expect(r.ok && r.lines[0].unit_cost).toBe(null);
  });
  it("names every box that needs fixing", () => {
    const r = buildSubmission(
      [line("a"), line("b")],
      { a: { unit_cost: "-5" }, b: { unit_cost: "12 pcs", spec_difference: "x".repeat(501) } },
      { lead: "3.5", payment: " ", valid: "2020-01-01" },
      TODAY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        { key: "a:unit_cost", problem: "range" },
        { key: "b:unit_cost", problem: "not_a_number" },
        { key: "b:spec_difference", problem: "too_long" },
        { key: "lead", problem: "not_integer" },
        { key: "payment", problem: "required" },
        { key: "valid", problem: "past_date" },
      ]);
    }
  });
  it("needs at least one price, a lead time and a date", () => {
    const r = buildSubmission([line("a")], {}, { lead: "", payment: "Net 30", valid: "" }, TODAY);
    expect(!r.ok && r.errors.map((e) => `${e.key}:${e.problem}`)).toEqual(["lines:no_price", "lead:required", "valid:required"]);
  });
  it("accepts Arabic-Indic digits typed by the supplier", () => {
    const r = buildSubmission([line("a")], { a: { unit_cost: "١٢٠" } }, TERMS, TODAY);
    expect(r.ok && r.lines[0].unit_cost).toBe(120);
  });
});

describe("dates", () => {
  it("counts days to the reply-by date, negative when late", () => {
    expect(daysLeft("2026-11-10", TODAY)).toBe(2);
    expect(daysLeft("2026-11-06", TODAY)).toBe(-2);
    expect(isOverdue("2026-11-07", TODAY)).toBe(true);
    expect(isOverdue(TODAY, TODAY)).toBe(false);
  });
  it("today is Riyadh's date, not UTC's", () => {
    expect(riyadhToday(new Date("2026-11-07T22:30:00Z"))).toBe("2026-11-08");
  });
});

describe("messages", () => {
  it("the invite carries the portal link and no project detail", () => {
    const link = portalLink("https://agent.phc-sa.com/", "abc");
    expect(link).toBe("https://agent.phc-sa.com/supplier/abc");
    expect(inviteMessage(link, "en")).toBe(`PHC has sent you a new pricing request. Sign in to the PHC supplier portal to see it: ${link}`);
    expect(inviteMessage(link, "ar")).toContain(link);
    expect(portalLink("https://agent.phc-sa.com")).toBe("https://agent.phc-sa.com/supplier");
  });
  it("the account message has the set-password link and the sign-in page", () => {
    expect(accountMessage("https://x/set", "https://agent.phc-sa.com/auth", "en")).toContain("https://x/set");
    expect(accountMessage("https://x/set", "https://agent.phc-sa.com/auth", "ar")).toContain("https://agent.phc-sa.com/auth");
  });
});

describe("supplierGate", () => {
  const ok = { signedIn: true, status: "active", roles: ["supplier"] as const, aal: { currentLevel: "aal2", nextLevel: "aal2" } };
  it("lets an active supplier with MFA in", () => expect(supplierGate(ok, "/supplier")).toEqual({ redirect: null, signOut: false }));
  it("sends everyone else where they belong", () => {
    expect(supplierGate({ ...ok, signedIn: false }, "/supplier/x").redirect).toEqual({ to: "/auth", search: { next: "/supplier/x" } });
    expect(supplierGate({ ...ok, status: "pending_approval" }, "").redirect).toEqual({ to: "/pending-approval" });
    expect(supplierGate({ ...ok, status: "suspended" }, "")).toEqual({ redirect: { to: "/auth", search: { next: "" } }, signOut: true });
    expect(supplierGate({ ...ok, roles: ["estimation_manager"] }, "").redirect).toEqual({ to: "/" });
    expect(supplierGate({ ...ok, aal: { currentLevel: "aal1", nextLevel: "aal1" } }, "/supplier/x").redirect).toEqual({ to: "/mfa-setup", search: { next: "/supplier/x" } });
    expect(supplierGate({ ...ok, aal: { currentLevel: "aal1", nextLevel: "aal2" } }, "/supplier/x").redirect).toEqual({ to: "/mfa-verify", search: { next: "/supplier/x" } });
    // An unreadable assurance level fails closed.
    expect(supplierGate({ ...ok, aal: null }, "/supplier").redirect).toEqual({ to: "/mfa-verify", search: { next: "/supplier" } });
  });
});
