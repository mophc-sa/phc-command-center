import { test, expect } from "bun:test";
import { renderTemplate, normalizePhone, isValidWhatsAppPhone, buildWaMeUrl } from "./whatsapp-templates";

test("renderTemplate substitutes known {{vars}} and blanks unknown/empty ones", () => {
  const out = renderTemplate("Hi {{contact_name}}, re {{record_name}} and {{missing}}.", {
    contact_name: "Sara",
    record_name: "NEOM Wayfinding",
  });
  expect(out).toBe("Hi Sara, re NEOM Wayfinding and .");
});

test("normalizePhone — +966 international format passes through unchanged", () => {
  const r = normalizePhone("+966501234567");
  expect(r).toEqual({ digits: "966501234567", valid: true, wasLocalSaudiFormat: false });
});

test("normalizePhone — bare 966 international format passes through unchanged", () => {
  const r = normalizePhone("966501234567");
  expect(r).toEqual({ digits: "966501234567", valid: true, wasLocalSaudiFormat: false });
});

test("normalizePhone — 05 local Saudi format is converted to international", () => {
  const r = normalizePhone("0501234567");
  expect(r).toEqual({ digits: "966501234567", valid: true, wasLocalSaudiFormat: true });
});

test("normalizePhone — 9-digit Saudi mobile without leading zero is converted to international", () => {
  const r = normalizePhone("501234567");
  expect(r).toEqual({ digits: "966501234567", valid: true, wasLocalSaudiFormat: true });
});

test("normalizePhone — formatting characters (spaces, dashes, parens) are stripped before matching", () => {
  expect(normalizePhone("+966 50 123 4567")).toEqual({ digits: "966501234567", valid: true, wasLocalSaudiFormat: false });
  expect(normalizePhone("05-0123-4567")).toEqual({ digits: "966501234567", valid: true, wasLocalSaudiFormat: true });
});

test("normalizePhone — too-short / empty numbers are invalid", () => {
  expect(normalizePhone("123")).toEqual({ digits: "123", valid: false, wasLocalSaudiFormat: false });
  expect(normalizePhone("")).toEqual({ digits: "", valid: false, wasLocalSaudiFormat: false });
  expect(normalizePhone(null)).toEqual({ digits: "", valid: false, wasLocalSaudiFormat: false });
  expect(normalizePhone(undefined)).toEqual({ digits: "", valid: false, wasLocalSaudiFormat: false });
});

test("normalizePhone — non-Saudi international numbers pass through as-is if long enough", () => {
  const r = normalizePhone("+14155552671"); // US number, unrelated to KSA shortcuts
  expect(r).toEqual({ digits: "14155552671", valid: true, wasLocalSaudiFormat: false });
});

test("isValidWhatsAppPhone matches normalizePhone().valid for all four documented KSA formats", () => {
  expect(isValidWhatsAppPhone("+966501234567")).toBe(true);
  expect(isValidWhatsAppPhone("966501234567")).toBe(true);
  expect(isValidWhatsAppPhone("0501234567")).toBe(true);
  expect(isValidWhatsAppPhone("501234567")).toBe(true);
  expect(isValidWhatsAppPhone("12345")).toBe(false);
  expect(isValidWhatsAppPhone("")).toBe(false);
});

test("buildWaMeUrl normalizes all four KSA input formats to the same international link", () => {
  const expected = "https://wa.me/966501234567?text=Hi%20there!";
  expect(buildWaMeUrl("+966501234567", "Hi there!")).toBe(expected);
  expect(buildWaMeUrl("966501234567", "Hi there!")).toBe(expected);
  expect(buildWaMeUrl("0501234567", "Hi there!")).toBe(expected);
  expect(buildWaMeUrl("501234567", "Hi there!")).toBe(expected);
});

test("buildWaMeUrl encodes the message text safely (spaces, punctuation, newlines)", () => {
  const url = buildWaMeUrl("+966501234567", "Hi, following up on Project A?\nAny update?");
  expect(url).toBe(
    "https://wa.me/966501234567?text=Hi%2C%20following%20up%20on%20Project%20A%3F%0AAny%20update%3F",
  );
});

test("buildWaMeUrl omits the text param for an empty message", () => {
  const url = buildWaMeUrl("+966501234567", "   ");
  expect(url).toBe("https://wa.me/966501234567");
});
