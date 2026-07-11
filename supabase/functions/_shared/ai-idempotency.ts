// =============================================================================
// PHC Sales OS — Sprint 10: Safe AI Orchestrator — idempotency (pure, no I/O).
//
// The atomic concurrency-claim itself (Required Fix 2) runs entirely inside
// Postgres — claim_ai_agent_request() in the migration — because only a
// single SQL statement's row-level locking can make "at most one caller
// wins" actually atomic. What CAN be unit-tested outside a live database is
// the interpretation of that RPC's result: given the row Postgres returned
// (or an RPC-level error), what should the orchestrator do next? Splitting
// this mapping out of index.ts (which is Deno-only and untestable under
// `bun test`) into its own portable module means every branch — claimed,
// a fresh in-flight duplicate, a completed duplicate (with or without a
// resolvable output), and an RPC failure — has a real, executable test
// instead of relying on reading the SQL alone.
// =============================================================================

export type ClaimRpcRow = {
  claim_id: string;
  claimed: boolean;
  request_status: string;
  request_output_id: string | null;
};

export type ClaimOutcome =
  | { kind: "claimed"; claimId: string }
  | { kind: "duplicate_processing" }
  | { kind: "duplicate_succeeded"; outputId: string | null }
  | { kind: "claim_error" };

// `rpcErrored` covers a transport/DB-level failure calling the RPC itself
// (network issue, permission problem, etc.) — distinct from a normal,
// successful RPC call that simply reports "not claimed."
export function interpretClaimRpcResult(row: ClaimRpcRow | null | undefined, rpcErrored: boolean): ClaimOutcome {
  if (rpcErrored || !row) return { kind: "claim_error" };
  if (row.claimed) return { kind: "claimed", claimId: row.claim_id };
  if (row.request_status === "succeeded") return { kind: "duplicate_succeeded", outputId: row.request_output_id };
  // Any non-succeeded, non-claimed status (in practice always "processing"
  // and not stale — a stale or failed prior claim would have been reclaimed
  // by the RPC itself, coming back with claimed=true) means a genuinely
  // in-flight duplicate: never proceed to call the provider for it.
  return { kind: "duplicate_processing" };
}
