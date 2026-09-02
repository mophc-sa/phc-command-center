import { describe, expect, it } from "bun:test";
import {
  DRAFT_TTL_MS,
  draftAgeMinutes,
  draftKey,
  draftPayload,
  hasContent,
  readDraft,
} from "@/lib/form-draft";

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);

describe("a draft belongs to a person, not a browser", () => {
  it("namespaces the key by user", () => {
    expect(draftKey("u1", "intake")).toBe("phc-draft:u1:intake");
    expect(draftKey("u2", "intake")).not.toBe(draftKey("u1", "intake"));
  });

  it("refuses to store anything for an unknown user", () => {
    // Two salespeople share a laptop. Without a user in the key, one would be
    // offered the other's half-typed client names.
    expect(draftKey(null, "intake")).toBeNull();
    expect(draftKey(undefined, "intake")).toBeNull();
    expect(draftKey("", "intake")).toBeNull();
  });
});

describe("what is worth saving", () => {
  it("keeps only what the user actually typed", () => {
    const defaults = { dateReceived: "2026-09-02", sourceType: "" };
    const values = { dateReceived: "2026-09-02", sourceType: "manual_rfq", companyName: "  " };
    // The seeded date is not evidence of work; the source the user picked is.
    expect(draftPayload(values, defaults)).toEqual({ sourceType: "manual_rfq" });
  });

  it("does not treat an untouched form as having content", () => {
    // Otherwise opening the dialog and closing it leaves a draft to be offered
    // back later, which teaches people to dismiss the offer without reading it.
    expect(draftPayload({ dateReceived: "2026-09-02" }, { dateReceived: "2026-09-02" })).toEqual({});
    expect(hasContent({})).toBe(false);
    expect(hasContent({ a: "   " })).toBe(false);
    expect(hasContent({ a: "x" })).toBe(true);
  });
});

describe("what is worth restoring", () => {
  const store = (values: Record<string, string>, savedAt: number) =>
    JSON.stringify({ values, savedAt });

  it("returns a recent draft", () => {
    const d = readDraft(store({ companyName: "UNIFIED" }, NOW - 60_000), NOW);
    expect(d?.values).toEqual({ companyName: "UNIFIED" });
  });

  it("drops one past its life", () => {
    expect(readDraft(store({ a: "x" }, NOW - DRAFT_TTL_MS - 1), NOW)).toBeNull();
    expect(readDraft(store({ a: "x" }, NOW - DRAFT_TTL_MS + 1000), NOW)).not.toBeNull();
  });

  it("drops one saved in the future", () => {
    // A clock that moved is more likely than time travel, and a draft from
    // "later today" would outlive every expiry check afterwards.
    expect(readDraft(store({ a: "x" }, NOW + 3_600_000), NOW)).toBeNull();
  });

  it("survives corrupted storage rather than throwing", () => {
    // localStorage is shared, editable, and occasionally truncated. A form that
    // cannot open because of it is worse than one that lost a draft.
    for (const raw of [null, "", "{", "null", "[]", '{"values":{}}', '{"savedAt":"x","values":{}}']) {
      expect(readDraft(raw, NOW)).toBeNull();
    }
  });

  it("ignores non-string fields someone put in the store by hand", () => {
    const raw = JSON.stringify({ savedAt: NOW, values: { good: "x", bad: 12, worse: { a: 1 } } });
    expect(readDraft(raw, NOW)?.values).toEqual({ good: "x" });
  });

  it("returns nothing for a draft whose fields are all blank", () => {
    expect(readDraft(store({ a: "", b: "  " }, NOW), NOW)).toBeNull();
  });
});

describe("telling the user how old it is", () => {
  it("counts whole minutes, never negative", () => {
    expect(draftAgeMinutes(NOW - 90_000, NOW)).toBe(1);
    expect(draftAgeMinutes(NOW, NOW)).toBe(0);
    expect(draftAgeMinutes(NOW + 5_000, NOW)).toBe(0);
  });
});
