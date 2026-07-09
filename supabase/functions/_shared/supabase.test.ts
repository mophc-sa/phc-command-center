// Deno test runner (`deno test`), not covered by `bun test ./src` — this repo
// has no existing Deno test harness wired into CI. Run manually with:
//   deno test --allow-read supabase/functions/_shared/supabase.test.ts
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { audit } from "./supabase.ts";

// Minimal duck-typed stand-in for SupabaseClient — audit() only ever calls
// svc.from(table).insert(row), so that's all the fake needs to implement.
function fakeClient(insertResult: { error: unknown }) {
  return {
    from(_table: string) {
      return {
        insert(_row: unknown) {
          return Promise.resolve(insertResult);
        },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("audit() accepts a null entity_id for system-level actions", async () => {
  const svc = fakeClient({ error: null });
  const result = await audit(svc, "actor-1", "automations.run", "system", null, { raised: 9 });
  assertEquals(result.error, null);
});

Deno.test("audit() surfaces (does not throw on) an insert failure", async () => {
  const fakeError = { message: "invalid input syntax for type uuid", code: "22P02" };
  const svc = fakeClient({ error: fakeError });
  const originalError = console.error;
  let loggedArgs: unknown[] | null = null;
  console.error = (...args: unknown[]) => {
    loggedArgs = args;
  };
  try {
    const result = await audit(svc, "actor-1", "automations.run", "system", "not-a-uuid", { raised: 9 });
    // Must not throw, and must return the error rather than swallow it.
    assertEquals(result.error, fakeError);
    assertExists(loggedArgs, "audit() must log the failure instead of silently swallowing it");
  } finally {
    console.error = originalError;
  }
});
