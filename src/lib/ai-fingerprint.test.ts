// PHC Sales OS — Sprint 10 idempotency payload-conflict fix: fingerprint
// canonicalization and hashing tests. No live provider/DB calls — pure
// function tests only. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  computeRequestFingerprint,
  resolveEffectiveProviderOverride,
} from "../../supabase/functions/_shared/ai-fingerprint";

const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Canonicalization: stable key ordering
// ---------------------------------------------------------------------------

test("object key order does not affect the fingerprint", async () => {
  const a = await computeRequestFingerprint({ input: { a: 1, b: 2 }, providerOverride: null });
  const b = await computeRequestFingerprint({ input: { b: 2, a: 1 }, providerOverride: null });
  expect(a).toBe(b);
});

test("nested object key order does not affect the fingerprint", async () => {
  const a = await computeRequestFingerprint({
    input: { outer: { x: 1, y: { m: "a", n: "b" } } },
    providerOverride: null,
  });
  const b = await computeRequestFingerprint({
    input: { outer: { y: { n: "b", m: "a" }, x: 1 } },
    providerOverride: null,
  });
  expect(a).toBe(b);
});

// ---------------------------------------------------------------------------
// Arrays: order preserved, elements canonicalized
// ---------------------------------------------------------------------------

test("array element order changes the fingerprint", async () => {
  const a = await computeRequestFingerprint({ input: { list: [1, 2] }, providerOverride: null });
  const b = await computeRequestFingerprint({ input: { list: [2, 1] }, providerOverride: null });
  expect(a).not.toBe(b);
});

test("objects nested inside arrays are canonicalized independent of their own key order", async () => {
  const a = await computeRequestFingerprint({
    input: { list: [{ a: 1, b: 2 }, { c: 3, d: 4 }] },
    providerOverride: null,
  });
  const b = await computeRequestFingerprint({
    input: { list: [{ b: 2, a: 1 }, { d: 4, c: 3 }] },
    providerOverride: null,
  });
  expect(a).toBe(b);
});

// ---------------------------------------------------------------------------
// null vs. absent vs. undefined
// ---------------------------------------------------------------------------

test("an explicit null field differs from an absent field", async () => {
  const withNull = await computeRequestFingerprint({ input: { a: null }, providerOverride: null });
  const absent = await computeRequestFingerprint({ input: {}, providerOverride: null });
  expect(withNull).not.toBe(absent);
});

test("an undefined-valued field is omitted, matching the same input without that key", async () => {
  const withUndefined = await computeRequestFingerprint({
    input: { a: 1, b: undefined },
    providerOverride: null,
  });
  const withoutKey = await computeRequestFingerprint({ input: { a: 1 }, providerOverride: null });
  expect(withUndefined).toBe(withoutKey);
});

// ---------------------------------------------------------------------------
// Digest shape
// ---------------------------------------------------------------------------

test("the fingerprint is always a non-null 64-character lowercase hex string, even for an empty input", async () => {
  const digest = await computeRequestFingerprint({ input: {}, providerOverride: null });
  expect(digest).toMatch(HEX64);
});

test("different semantic input reliably produces a different digest (not a constant/degenerate hash)", async () => {
  const a = await computeRequestFingerprint({ input: { channel: "email" }, providerOverride: null });
  const b = await computeRequestFingerprint({ input: { channel: "whatsapp" }, providerOverride: null });
  expect(a).not.toBe(b);
  expect(a).toMatch(HEX64);
  expect(b).toMatch(HEX64);
});

test("identical semantic input reliably produces the same digest across repeated calls", async () => {
  const a = await computeRequestFingerprint({ input: { channel: "email", tone: "formal" }, providerOverride: null });
  const b = await computeRequestFingerprint({ input: { channel: "email", tone: "formal" }, providerOverride: null });
  expect(a).toBe(b);
});

// ---------------------------------------------------------------------------
// Provider override — must be the EFFECTIVE override, never the raw/ignored one
// ---------------------------------------------------------------------------

test("resolveEffectiveProviderOverride honors the requested provider only when the caller is admin-authorized", () => {
  expect(resolveEffectiveProviderOverride("anthropic", true)).toBe("anthropic");
  expect(resolveEffectiveProviderOverride("anthropic", false)).toBeNull();
  expect(resolveEffectiveProviderOverride(null, true)).toBeNull();
  expect(resolveEffectiveProviderOverride(undefined, true)).toBeNull();
});

test("an authorized admin's different provider override produces a different fingerprint (a materially different request)", async () => {
  const openai = await computeRequestFingerprint({ input: { x: 1 }, providerOverride: "openai" });
  const anthropic = await computeRequestFingerprint({ input: { x: 1 }, providerOverride: "anthropic" });
  expect(openai).not.toBe(anthropic);
});

test("a non-admin caller's raw provider field never reaches the fingerprint — different ignored values still fingerprint identically", async () => {
  // Simulates index.ts: resolveEffectiveProviderOverride() is applied BEFORE
  // computeRequestFingerprint() ever sees the caller's raw request.provider.
  const nonAdminSentOpenai = resolveEffectiveProviderOverride("openai", /* adminOverrideAllowed */ false);
  const nonAdminSentAnthropic = resolveEffectiveProviderOverride("anthropic", /* adminOverrideAllowed */ false);
  const nonAdminSentNothing = resolveEffectiveProviderOverride(null, /* adminOverrideAllowed */ false);

  const a = await computeRequestFingerprint({ input: { x: 1 }, providerOverride: nonAdminSentOpenai });
  const b = await computeRequestFingerprint({ input: { x: 1 }, providerOverride: nonAdminSentAnthropic });
  const c = await computeRequestFingerprint({ input: { x: 1 }, providerOverride: nonAdminSentNothing });
  expect(a).toBe(b);
  expect(b).toBe(c);
});

test("an omitted effective provider override normalizes consistently regardless of whether the caller sent null or nothing", async () => {
  const sentNull = await computeRequestFingerprint({ input: { x: 1 }, providerOverride: null });
  const adminSentNothing = await computeRequestFingerprint({
    input: { x: 1 },
    providerOverride: resolveEffectiveProviderOverride(undefined, true),
  });
  expect(sentNull).toBe(adminSentNothing);
});

// ---------------------------------------------------------------------------
// Never exposes the canonical JSON string — only the digest is a public export
// ---------------------------------------------------------------------------

test("the module's public API returns only a digest — no canonicalize/serialize helper is exported for callers to persist by mistake", async () => {
  const mod = await import("../../supabase/functions/_shared/ai-fingerprint");
  const exportedNames = Object.keys(mod).sort();
  expect(exportedNames).toEqual(["computeRequestFingerprint", "resolveEffectiveProviderOverride"]);
});
