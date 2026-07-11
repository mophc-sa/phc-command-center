// PHC Sales OS — Sprint 10 Safe AI Orchestrator: idempotency/concurrency
// interpretation tests. Run with `bun test src`.
//
// The actual atomic claim runs in Postgres (claim_ai_agent_request() in the
// migration) and cannot be executed here — but every way that RPC can
// respond is enumerated and tested against the real interpretation function
// index.ts actually calls, not a re-implementation of it.
import { test, expect } from "bun:test";
import { interpretClaimRpcResult, type ClaimRpcRow } from "../../supabase/functions/_shared/ai-idempotency";

test("a brand-new claim (or a reclaimed stale/failed one) maps to 'claimed' — only the claimant may call the provider", () => {
  const row: ClaimRpcRow = { claim_id: "claim-1", claimed: true, request_status: "processing", request_output_id: null };
  expect(interpretClaimRpcResult(row, false)).toEqual({ kind: "claimed", claimId: "claim-1" });
});

test("a fresh, still-processing duplicate maps to 'duplicate_processing' — must never trigger a second provider call", () => {
  const row: ClaimRpcRow = { claim_id: "claim-1", claimed: false, request_status: "processing", request_output_id: null };
  expect(interpretClaimRpcResult(row, false)).toEqual({ kind: "duplicate_processing" });
});

test("a completed duplicate with a resolvable output maps to 'duplicate_succeeded' carrying the winner's outputId", () => {
  const row: ClaimRpcRow = { claim_id: "claim-1", claimed: false, request_status: "succeeded", request_output_id: "output-9" };
  expect(interpretClaimRpcResult(row, false)).toEqual({ kind: "duplicate_succeeded", outputId: "output-9" });
});

test("a completed duplicate whose output_id is somehow null still reports 'duplicate_succeeded' (caller decides how to handle a missing output)", () => {
  const row: ClaimRpcRow = { claim_id: "claim-1", claimed: false, request_status: "succeeded", request_output_id: null };
  expect(interpretClaimRpcResult(row, false)).toEqual({ kind: "duplicate_succeeded", outputId: null });
});

test("an RPC-level error maps to 'claim_error' regardless of what row data (if any) came back", () => {
  expect(interpretClaimRpcResult(undefined, true)).toEqual({ kind: "claim_error" });
  const row: ClaimRpcRow = { claim_id: "claim-1", claimed: true, request_status: "processing", request_output_id: null };
  expect(interpretClaimRpcResult(row, true)).toEqual({ kind: "claim_error" });
});

test("a missing row with no RPC error still maps to 'claim_error' rather than silently proceeding", () => {
  expect(interpretClaimRpcResult(null, false)).toEqual({ kind: "claim_error" });
  expect(interpretClaimRpcResult(undefined, false)).toEqual({ kind: "claim_error" });
});

test("an unexpected status value (defensive) is treated as still in progress, never as an invitation to call the provider", () => {
  const row = { claim_id: "claim-1", claimed: false, request_status: "some_future_status", request_output_id: null } as ClaimRpcRow;
  expect(interpretClaimRpcResult(row, false)).toEqual({ kind: "duplicate_processing" });
});
