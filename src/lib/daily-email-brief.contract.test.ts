// =============================================================================
// Today's email — made once a day with the person's own session, private to
// them, and never an AI call when there is nothing new.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { briefSince, isFromToday } from "@/components/phc/DailyEmailBrief";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const CARD = read("src/components/phc/DailyEmailBrief.tsx");
const REG = read("supabase/functions/_shared/ai-agent-registry.ts");

describe("once a day, on the person's own visit", () => {
  it("runs only when there is no brief from today, and at most once per visit", () => {
    expect(CARD).toContain("if (!allowed || outputQ.isLoading || outputQ.isError || today || tried.current) return;");
    expect(CARD).toContain("tried.current = true;");
  });

  it("goes through the orchestrator as the caller, for the caller", () => {
    expect(CARD).toContain('runAiAgent({ agent: AGENT, entityType: "my_email", entityId: uid');
    expect(REG).toContain("return entityId === userId");
  });

  it("isFromToday compares calendar days, not 24 hours", () => {
    const now = new Date(2026, 8, 30, 8, 0);
    expect(isFromToday(new Date(2026, 8, 30, 0, 5).toISOString(), now)).toBe(true);
    expect(isFromToday(new Date(2026, 8, 29, 23, 55).toISOString(), now)).toBe(false);
    expect(isFromToday(null, now)).toBe(false);
  });
});

describe("no new email, no AI", () => {
  it("the card checks for new email before calling the orchestrator", () => {
    expect(CARD.indexOf("hasNewClientEmail(uid, briefSince(")).toBeGreaterThan(-1);
    expect(CARD.indexOf("hasNewClientEmail(uid, briefSince(")).toBeLessThan(CARD.indexOf("await runAiAgent("));
  });

  it("the card and the agent use the same window", () => {
    const now = Date.parse("2026-09-30T08:00:00Z");
    expect(briefSince(null, now)).toBe("2026-09-29T08:00:00.000Z");
    expect(briefSince("2026-09-29T20:00:00Z", now)).toBe("2026-09-29T20:00:00.000Z");
    expect(briefSince("2026-09-01T00:00:00Z", now)).toBe("2026-09-23T08:00:00.000Z");
  });

  it("the loader stops before the provider when nothing is new", () => {
    expect(REG).toContain('message: "No new client email since your last brief."');
  });
});

describe("the brief is the person's", () => {
  it("only their mailbox and their deals feed it", () => {
    expect(REG).toContain('.eq("owner_id", userId).in("activity_type", ["email_received", "email_draft"])');
    expect(REG).toContain('.eq("owner_id", userId).limit(500)');
  });
});
