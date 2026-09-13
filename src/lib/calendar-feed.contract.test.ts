// =============================================================================
// The Outlook calendar feed — the properties a unit test of one function cannot
// see: what each query is filtered by, and that the mirrored rules have not
// drifted from the in-app calendar.
//
// Unit behaviour is in supabase/functions/_shared/calendar-feed.deno-test.ts.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FEED = read("supabase/functions/calendar-feed/index.ts");
const CORE = read("supabase/functions/_shared/calendar-feed.ts");
const HANDLER = read("supabase/functions/sales-os-api/handlers/calendar-feed.ts");

/** The owner column that bounds each source table. */
const OWNER: Record<string, string> = {
  follow_ups: "owner_id",
  opportunities: "owner_id",
  rfqs: "sales_owner_id",
  tasks: "owner_id",
  commitments: "owner_id",
  quotations: "owner_id",
  tenders: "tender_owner_id",
  opportunity_flags: "action_owner_id",
  inbox_items: "assigned_owner_id",
};

describe("a feed shows only what its owner is responsible for", () => {
  // The feed runs as the service role, which bypasses RLS. The owner filter on
  // each query is the whole read boundary, so its absence must fail loudly.
  const sources = [...FEED.matchAll(/svc\.from\("([a-z_]+)"\)\.select\(/g)];
  const bodies = sources.map((m, i) => ({
    table: m[1],
    body: FEED.slice(m.index, i + 1 < sources.length ? sources[i + 1].index : FEED.indexOf("]);", m.index)),
  }));

  it("reads every source table, and no table it has no owner rule for", () => {
    const read = bodies.map((b) => b.table).filter((t) => t !== "calendar_feed_tokens" && t !== "profiles");
    expect(read.sort()).toEqual(Object.keys(OWNER).sort());
  });

  for (const [table, column] of Object.entries(OWNER)) {
    it(`filters ${table} by ${column}`, () => {
      const q = bodies.find((b) => b.table === table);
      expect(q?.body).toContain(`.eq("${column}", uid)`);
    });
  }

  it("leaves out archived and historical rows", () => {
    expect(bodies.find((b) => b.table === "rfqs")?.body).toContain('.is("archived_at", null)');
    expect(bodies.find((b) => b.table === "tenders")?.body).toContain('.is("archived_at", null)');
    expect(bodies.find((b) => b.table === "quotations")?.body).toContain('.eq("is_historical", false)');
  });

  it("serves nothing for a suspended account, and says so the same way as a bad token", () => {
    expect(FEED).toContain('if (profile?.status !== "active") return notFound();');
    expect(FEED.match(/return new Response\("not found"/g) ?? []).toHaveLength(0); // one helper, one answer
    expect(FEED).toContain("if (!link) return notFound();");
  });

  it("refuses to serve a partial feed when any source fails", () => {
    const failed = FEED.indexOf(".some((r) => r.error)");
    expect(failed).toBeGreaterThan(-1);
    expect(failed).toBeLessThan(FEED.indexOf("collectFeedEvents("));
  });

  it("is never cached by a shared proxy", () => {
    expect(FEED).toContain('"Cache-Control": "private');
  });
});

describe("links are managed only by their owner", () => {
  it("keys every link action to the signed-in caller, never to the payload", () => {
    expect(HANDLER).not.toMatch(/\bpayload(\.\w|\[)/);
    expect(HANDLER.match(/ctx\.caller\.userId/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("stores only the hash of a link", () => {
    expect(HANDLER).toContain("token_hash: await hashThreadToken(token)");
    expect(HANDLER).not.toMatch(/token_hash:\s*token\b/);
  });

  it("is deployed without JWT verification, because Outlook cannot send one", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.calendar-feed\]\s*\nverify_jwt = false/);
  });

  it("is type-checked in CI with the other functions", () => {
    expect(read(".github/workflows/ci.yml")).toContain("supabase/functions/calendar-feed/index.ts");
  });

  it("creates a link only from the Outlook dialog", () => {
    const actions = read("src/lib/calendar-feed-actions.ts");
    expect(actions).toContain('callBackend<{ url?: string }>("calendar_feed_create"');
    expect(read("src/components/phc/OutlookCalendarDialog.tsx")).toContain("createCalendarFeed()");
  });
});

describe("the feed and the in-app calendar agree on what is closed", () => {
  const sets = (src: string) =>
    Object.fromEntries(
      [...src.matchAll(/const (DONE_[A-Z_]+|CLOSED_[A-Z_]+) = new Set\((\[[^\]]*\])\)/g)].map((m) => [
        m[1],
        JSON.parse(m[2]),
      ]),
    );

  it("mirrors every closed-state set exactly", () => {
    const app = sets(read("src/lib/calendar.ts"));
    const feed = sets(CORE);
    expect(Object.keys(app).length).toBeGreaterThanOrEqual(6);
    expect(feed).toEqual(app);
  });
});
