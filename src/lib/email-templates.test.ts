// Email template + mailto helpers. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  buildEmailDraft,
  buildMailtoUrl,
  isValidEmail,
  validateEmailDraft,
  MAILTO_MAX_LENGTH,
  type EmailContext,
} from "./email-templates";

const base: EmailContext = {
  recipientName: "Ahmed",
  recipientEmail: "ahmed@example.com",
  companyName: "Al Rajhi Construction",
  projectName: "Riyadh Metro Depot",
  ownerName: "Mohammed",
  lang: "en",
};

test("opportunity_follow_up subject references the project", () => {
  const d = buildEmailDraft("opportunity_follow_up", { ...base, opportunityName: "Metro Signage" });
  expect(d.subject).toContain("Riyadh Metro Depot");
  expect(d.body).toContain("Ahmed");
  expect(d.body).toContain("PHC");
});

test("tender_clarification asks the mandatory package questions", () => {
  const d = buildEmailDraft("tender_clarification", { ...base, tenderName: "NEOM Tender 12" });
  expect(d.subject).toContain("NEOM Tender 12");
  expect(d.body).toMatch(/signage|wayfinding/i);
  expect(d.body).toMatch(/BOQ/);
  expect(d.body).toMatch(/deadline/i);
});

test("contractor_introduction avoids overclaiming", () => {
  const d = buildEmailDraft("contractor_introduction", base);
  expect(d.body).toMatch(/wayfinding|signage/i);
  expect(d.body).not.toMatch(/awarded|winner|guaranteed/i);
});

test("missing_information lists the requested fields", () => {
  const d = buildEmailDraft("missing_information", { ...base, missingFields: ["Signage BOQ", "Site contact"] });
  expect(d.body).toContain("Signage BOQ");
  expect(d.body).toContain("Site contact");
});

test("arabic template renders with RTL greeting", () => {
  const d = buildEmailDraft("opportunity_follow_up", { ...base, lang: "ar" });
  expect(d.body).toContain("مرحباً");
  expect(d.body).toContain("PHC");
});

test("ai recommendation is surfaced at the top when provided", () => {
  const d = buildEmailDraft("opportunity_follow_up", { ...base, aiRecommendation: "Push for site meeting this week." });
  expect(d.body.indexOf("AI recommendation")).toBeLessThan(d.body.indexOf("Hi Ahmed"));
});

test("buildMailtoUrl encodes newlines, spaces and non-ascii safely", () => {
  const url = buildMailtoUrl({
    to: "ahmed@example.com",
    cc: ["cc1@example.com", "cc2@example.com"],
    subject: "Follow-up on Riyadh Metro Depot & tender #12",
    body: "Line one\nLine two — done.",
  });
  expect(url.startsWith("mailto:")).toBe(true);
  expect(url).toContain("ahmed%40example.com");
  expect(url).toContain("cc=cc1%40example.com%2Ccc2%40example.com");
  expect(url).toContain("%20"); // spaces encoded
  expect(url).toContain("%0A"); // newline encoded
  expect(url).toContain("%26"); // & inside subject encoded
});

test("isValidEmail is strict-ish", () => {
  expect(isValidEmail("a@b.co")).toBe(true);
  expect(isValidEmail("")).toBe(false);
  expect(isValidEmail(null)).toBe(false);
  expect(isValidEmail("not-an-email")).toBe(false);
  expect(isValidEmail("a@b")).toBe(false);
});

test("validateEmailDraft blocks missing recipient", () => {
  const r = validateEmailDraft({ to: "", subject: "s", body: "b" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("missing_recipient");
});

test("validateEmailDraft blocks invalid recipient", () => {
  const r = validateEmailDraft({ to: "nope", subject: "s", body: "b" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("invalid_recipient");
});

test("validateEmailDraft blocks empty subject and body", () => {
  const r = validateEmailDraft({ to: "a@b.co", subject: "", body: "" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("empty_content");
});

test("validateEmailDraft flags oversized mailto for the fallback copy path", () => {
  const big = "x".repeat(MAILTO_MAX_LENGTH * 2);
  const r = validateEmailDraft({ to: "a@b.co", subject: "s", body: big });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.truncated).toBe(true);
});
