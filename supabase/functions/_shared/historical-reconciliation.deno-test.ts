import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { historicalPromotionModule } from "../sales-os-api/handlers/historical-promotion.ts";
import type { SalesOsContext } from "../sales-os-api/contracts.ts";

const rowId = "10000000-0000-4000-8000-000000000001";
const legacyId = "10000000-0000-4000-8000-000000000002";
function context(roles: string[], rpc: (name: string, args?: unknown) => unknown): SalesOsContext {
  return {
    caller: { userId: rowId, roles },
    get svc() {
      throw Error("service role must not be used");
    },
    asCaller: { rpc, from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) },
  } as unknown as SalesOsContext;
}
Deno.test("historical reconciliation requires leadership before accessing any client", async () => {
  const ctx = context(["system_admin"], () => {
    throw Error("unexpected RPC");
  });
  assertEquals(
    (await historicalPromotionModule.handlers.preview_historical_reconciliation({}, ctx)).status,
    403,
  );
  assertEquals(
    (await historicalPromotionModule.handlers.reconcile_historical_duplicates({}, ctx)).status,
    403,
  );
});
Deno.test("historical reconciliation uses the caller session and pins before-images", async () => {
  const calls: unknown[] = [];
  const ctx = context(["sales_manager"], (name, args) => {
    calls.push({ name, args });
    return Promise.resolve({ data: { archivedIds: [legacyId] }, error: null });
  });
  const expectedLegacy = { [legacyId]: "a".repeat(32) };
  const response = await historicalPromotionModule.handlers.reconcile_historical_duplicates(
    { rowId, expectedLegacy },
    ctx,
  );
  assertEquals(response.status, 200);
  assertEquals(calls, [
    {
      name: "reconcile_historical_legacy",
      args: { _row_id: rowId, _expected_legacy: expectedLegacy },
    },
  ]);
});
Deno.test(
  "historical reconciliation rejects invalid fingerprints and reports preview drift",
  async () => {
    const ctx = context(["sales_manager"], () =>
      Promise.resolve({ data: null, error: { code: "40001", message: "changed since review" } }),
    );
    assertEquals(
      (
        await historicalPromotionModule.handlers.reconcile_historical_duplicates(
          { rowId, expectedLegacy: {} },
          ctx,
        )
      ).status,
      400,
    );
    assertEquals(
      (
        await historicalPromotionModule.handlers.reconcile_historical_duplicates(
          { rowId, expectedLegacy: { [legacyId]: "a".repeat(32) } },
          ctx,
        )
      ).status,
      409,
    );
  },
);
