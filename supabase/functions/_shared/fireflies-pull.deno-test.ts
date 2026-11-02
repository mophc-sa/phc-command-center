// =============================================================================
// Pulling meetings by a salesperson's own Fireflies key: which keys are
// accepted, how far back a pull looks, how Fireflies' answers are read, and
// what the scheduled pull does with each connected account.
// =============================================================================

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  firefliesAccount,
  type MeetingStore,
  pullSince,
  readApiKey,
  recentTranscripts,
  runScheduledPull,
  sameAccount,
  storeTranscripts,
} from "./fireflies-pull.ts";
import type { FirefliesTranscript } from "./fireflies.ts";

const NOW = Date.parse("2026-10-22T09:00:00Z");
const DAY = 86_400_000;

const reply = (status: number, body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

const MEETING: FirefliesTranscript = {
  id: "01K8ABC",
  title: "Sidra site meeting",
  dateString: "2026-10-21T08:00:00Z",
  organizer_email: "rep@phc-sa.com",
  participants: ["rep@phc-sa.com"],
  summary: { short_summary: "Drawings due", action_items: "**Rep**\nSend drawings (01:10)" },
};

function fakeStore(duplicates: string[] = [], fail = false) {
  const calls: Array<{ _meeting: Record<string, unknown>; _items: unknown }> = [];
  const store: MeetingStore = {
    rpc(_fn, args) {
      calls.push(args as { _meeting: Record<string, unknown>; _items: unknown });
      const id = (args._meeting as { provider_meeting_id: string }).provider_meeting_id;
      return Promise.resolve(fail ? { data: null, error: { message: "x" } } : { data: { duplicate: duplicates.includes(id) }, error: null });
    },
  };
  return { store, calls };
}

Deno.test("an API key is one token of sane length", () => {
  assertEquals(readApiKey("  3f2c9a1e-7b4d-4c1a-9e2f-0123456789ab \n"), "3f2c9a1e-7b4d-4c1a-9e2f-0123456789ab");
  assertEquals(readApiKey("short"), null);
  assertEquals(readApiKey("has a space in the middle of it"), null);
  assertEquals(readApiKey("x".repeat(201)), null);
  assertEquals(readApiKey(42), null);
  assertEquals(readApiKey(undefined), null);
});

Deno.test("a key is accepted only for the caller's own Fireflies account", () => {
  assert(sameAccount("Faisal@PHC-SA.com ", "faisal@phc-sa.com"));
  assertFalse(sameAccount("info@phc-sa.com", "faisal@phc-sa.com"), "the company account is not yours");
  assertFalse(sameAccount("", ""), "no email matches nothing");
  assertFalse(sameAccount(null, "faisal@phc-sa.com"));
});

Deno.test("a pull looks back a day before the last success, at most two weeks", () => {
  assertEquals(pullSince(null, NOW), new Date(NOW - 14 * DAY).toISOString(), "first pull: two weeks");
  assertEquals(pullSince(new Date(NOW - 2 * 3600_000).toISOString(), NOW), new Date(NOW - 2 * 3600_000 - DAY).toISOString());
  assertEquals(pullSince(new Date(NOW - 40 * DAY).toISOString(), NOW), new Date(NOW - 14 * DAY).toISOString(), "a long gap is capped");
  assertEquals(pullSince("not a date", NOW), new Date(NOW - 14 * DAY).toISOString());
});

Deno.test("Fireflies' answer about whose key it is", async () => {
  const ok = await firefliesAccount("k".repeat(20), reply(200, { data: { user: { email: "rep@phc-sa.com", name: "Rep" } } }));
  assertEquals(ok, { ok: true, value: { email: "rep@phc-sa.com", name: "Rep" } });

  assertEquals(await firefliesAccount("k".repeat(20), reply(401, {})), { ok: false, reason: "unauthorized" });
  assertEquals(
    await firefliesAccount("k".repeat(20), reply(200, { data: null, errors: [{ message: "Invalid API key", extensions: { code: "auth_failed" } }] })),
    { ok: false, reason: "unauthorized" },
    "a bad key reported inside a 200",
  );
  assertEquals(await firefliesAccount("k".repeat(20), reply(500, {})), { ok: false, reason: "upstream" });
  assertEquals(await firefliesAccount("k".repeat(20), () => Promise.reject(new Error("network"))), { ok: false, reason: "upstream" });
  assertEquals(await firefliesAccount("k".repeat(20), reply(200, { data: { user: null } })), { ok: false, reason: "unauthorized" });
});

Deno.test("recent meetings are filtered to the ones worth storing, and the key goes only in the header", async () => {
  let seen: RequestInit | undefined;
  const r = await recentTranscripts("secret-key-0123456789", new Date(NOW - DAY).toISOString(), (_url, init) => {
    seen = init;
    return Promise.resolve(new Response(JSON.stringify({ data: { transcripts: [MEETING, { id: "empty", summary: null }] } }), { status: 200 }));
  });
  assert(r.ok);
  assertEquals(r.value.map((t) => t.id), ["01K8ABC"]);
  assertEquals((seen?.headers as Record<string, string>).Authorization, "Bearer secret-key-0123456789");
  assertFalse(String(seen?.body).includes("secret-key"), "the key is not in the request body");
});

Deno.test("storing marks whose account a meeting came from and counts duplicates", async () => {
  const { store, calls } = fakeStore(["dup"]);
  const r = await storeTranscripts(store, [MEETING, { ...MEETING, id: "dup" }], [{ id: "u-rep", email: "rep@phc-sa.com", full_name: "Rep" }], "u-rep");
  assertEquals(r, { ok: true, value: { found: 2, added: 1, already: 1 } });
  assertEquals(calls[0]._meeting.connected_user_id, "u-rep");

  const company = fakeStore();
  await storeTranscripts(company.store, [MEETING], [], null);
  assertFalse("connected_user_id" in company.calls[0]._meeting, "the company account marks nobody");

  assertEquals(await storeTranscripts(fakeStore([], true).store, [MEETING], [], null), { ok: false, reason: "store" });
});

Deno.test("the scheduled pull goes through every connected account and marks refused keys", async () => {
  const { store, calls } = fakeStore();
  const marks: Array<[string, string, string | null]> = [];
  const keys: Record<string, string> = { good: "good-key-0123456789", bad: "bad-key-0123456789" };
  const report = await runScheduledPull({
    store,
    connections: () => Promise.resolve([
      { user_id: "good", last_synced_at: null },
      { user_id: "bad", last_synced_at: null },
      { user_id: "gone", last_synced_at: null },
    ]),
    apiKey: (u) => Promise.resolve(keys[u] ?? null),
    members: () => Promise.resolve([]),
    mark: (u, s, e) => {
      marks.push([u, s, e]);
      return Promise.resolve();
    },
    fetch: (_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth.includes("bad")
        ? Promise.resolve(new Response("{}", { status: 401 }))
        : Promise.resolve(new Response(JSON.stringify({ data: { transcripts: [MEETING] } }), { status: 200 }));
    },
    now: () => NOW,
  });
  assertEquals(report, { accounts: 3, pulled: 1, added: 1, failed: 1, reconnect: 1 });
  assertEquals(calls.length, 1);
  assertEquals(calls[0]._meeting.connected_user_id, "good");
  assertEquals(marks, [["good", "active", null], ["bad", "needs_reconnect", "Fireflies refused the API key"]]);
});

Deno.test("the scheduled pull stops at its time budget and does nothing without connections", async () => {
  let t = NOW;
  const { store } = fakeStore();
  const report = await runScheduledPull({
    store,
    connections: () => Promise.resolve([{ user_id: "a", last_synced_at: null }, { user_id: "b", last_synced_at: null }]),
    apiKey: () => Promise.resolve("key-0123456789abcdef"),
    members: () => Promise.resolve([]),
    mark: () => Promise.resolve(),
    fetch: () => {
      t += 60_000; // each account takes a minute
      return Promise.resolve(new Response(JSON.stringify({ data: { transcripts: [] } }), { status: 200 }));
    },
    now: () => t,
    budgetMs: 45_000,
  });
  assertEquals(report.pulled, 1, "the second account waits for the next run");

  let membersRead = false;
  const idle = await runScheduledPull({
    store,
    connections: () => Promise.resolve([]),
    apiKey: () => Promise.resolve(null),
    members: () => {
      membersRead = true;
      return Promise.resolve([]);
    },
    mark: () => Promise.resolve(),
  });
  assertEquals(idle.accounts, 0);
  assertFalse(membersRead);
});
