import { describe, expect, it } from "bun:test";
import { dueForRefresh, KEEPALIVE_MS, keepAlive } from "@/lib/session-keepalive";

const T = 1_800_000_000_000;

describe("when to renew", () => {
  it("renews on the first tick of a session", () => {
    expect(dueForRefresh(null, T)).toBe(true);
  });

  it("waits out the interval, then renews", () => {
    expect(dueForRefresh(T, T + KEEPALIVE_MS - 1)).toBe(false);
    expect(dueForRefresh(T, T + KEEPALIVE_MS)).toBe(true);
  });

  it("renews when the clock has moved backwards", () => {
    // A machine that resyncs its time, or a display that resumed from sleep
    // with a stale clock, must not park the session forever waiting for a
    // moment that already passed.
    expect(dueForRefresh(T, T - 60_000)).toBe(true);
  });

  it("keeps well inside the token's hour", () => {
    // Renewing at 59 minutes leaves no room for a throttled timer to be late,
    // which is the exact condition this exists for.
    expect(KEEPALIVE_MS).toBeLessThan(30 * 60 * 1000);
  });
});

describe("renewing", () => {
  it("reports success", async () => {
    expect(await keepAlive(async () => ({ error: null }))).toBe(true);
  });

  it("reports a refused refresh without throwing", async () => {
    expect(await keepAlive(async () => ({ error: new Error("nope") }))).toBe(false);
  });

  it("survives a refresh that throws", async () => {
    // Offline, DNS gone, the browser asleep mid-request. The next tick tries
    // again; tearing the page down here would sign out a screen for a blip.
    expect(await keepAlive(async () => { throw new Error("offline"); })).toBe(false);
  });
});
