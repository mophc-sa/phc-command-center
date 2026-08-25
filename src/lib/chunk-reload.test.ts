import { describe, expect, it } from "bun:test";
import {
  isStaleChunkError,
  shouldAutoReload,
  RELOAD_GUARD_MS,
} from "@/lib/chunk-reload";

describe("isStaleChunkError", () => {
  // The exact error observed on /my-workspace on 2026-08-25 after a redeploy.
  it("recognises the Chrome message", () => {
    expect(
      isStaleChunkError(
        new TypeError(
          "Failed to fetch dynamically imported module: http://localhost:8787/assets/my-workspace-DbTHkG3t.js",
        ),
      ),
    ).toBe(true);
  });

  it("recognises the other engines' wording", () => {
    for (const msg of [
      "error loading dynamically imported module",
      "Importing a module script failed.",
      "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of 'text/html'. That is not a valid JavaScript MIME type.",
    ]) {
      expect(isStaleChunkError(new Error(msg)), msg).toBe(true);
    }
  });

  it("recognises a ChunkLoadError by name alone", () => {
    const e = new Error("boom");
    e.name = "ChunkLoadError";
    expect(isStaleChunkError(e)).toBe(true);
  });

  it("does NOT hijack ordinary application errors", () => {
    for (const e of [
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new Error("`SelectLabel` must be used within `SelectGroup`"),
      new Error("Failed to fetch"), // a plain network call, not a module
      new Error("permission denied for table opportunities"),
    ]) {
      expect(isStaleChunkError(e), String(e.message)).toBe(false);
    }
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 0, "", {}, [], new Error("")]) {
      expect(isStaleChunkError(junk)).toBe(false);
    }
  });
});

describe("shouldAutoReload — recover once, never loop", () => {
  const NOW = 1_770_000_000_000;

  it("reloads when nothing has been tried", () => {
    expect(shouldAutoReload(NOW, null)).toBe(true);
  });

  it("refuses a second reload inside the guard window", () => {
    expect(shouldAutoReload(NOW, String(NOW - 1_000))).toBe(false);
    expect(shouldAutoReload(NOW, String(NOW - RELOAD_GUARD_MS + 1))).toBe(false);
  });

  it("allows a fresh attempt once the window has passed", () => {
    expect(shouldAutoReload(NOW, String(NOW - RELOAD_GUARD_MS - 1))).toBe(true);
  });

  it("treats a corrupt or future stamp as no attempt, not as a block", () => {
    // A blocked user who can never recover is worse than one extra reload.
    expect(shouldAutoReload(NOW, "not-a-number")).toBe(true);
    expect(shouldAutoReload(NOW, String(NOW + 60_000))).toBe(true);
  });
});
