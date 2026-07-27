// Contract tests for the 2026-07-27 BAFO/commercial-discount approval chain
// batch: estimation_manager role and the bafo_requests table's sequential
// role-gating trigger, audit logging, and RLS. Static SQL inspection (this
// repo has no live-DB test harness for RLS). Run with `bun test src`.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
function migration(name: string): string {
  return readFileSync(join(repoRoot, "supabase/migrations", name), "utf8");
}

const estimationManagerRole = migration("20260727210000_add_estimation_manager_role.sql");
const bafoChain = migration("20260727220000_bafo_approval_chain.sql");

test("estimation_manager role is added in its own migration (enum-add-value transaction rule)", () => {
  expect(estimationManagerRole).toMatch(/ALTER TYPE public\.app_role ADD VALUE IF NOT EXISTS 'estimation_manager'/);
});

describe("bafo_requests table", () => {
  test("has the fixed four step-column groups plus overall status and sent-to-client tracking", () => {
    for (const prefix of ["commercial_review", "cost_approval", "finance_review", "final_approval"]) {
      expect(bafoChain).toMatch(new RegExp(`${prefix}_status text NOT NULL DEFAULT 'pending'`));
      expect(bafoChain).toMatch(new RegExp(`${prefix}_by uuid REFERENCES auth\\.users\\(id\\)`));
      expect(bafoChain).toMatch(new RegExp(`${prefix}_notes text`));
      expect(bafoChain).toMatch(new RegExp(`${prefix}_at timestamptz`));
    }
    expect(bafoChain).toMatch(/status text NOT NULL DEFAULT 'pending' CHECK \(status IN \('pending', 'approved', 'rejected'\)\)/);
    expect(bafoChain).toMatch(/sent_to_client_at timestamptz/);
    expect(bafoChain).toMatch(/sent_to_client_by uuid REFERENCES auth\.users\(id\)/);
  });
});

describe("protect_bafo_step_transitions — role gate + sequential ordering", () => {
  const fnStart = bafoChain.indexOf("CREATE OR REPLACE FUNCTION public.protect_bafo_step_transitions()");
  const fnEnd = bafoChain.indexOf("$$;", fnStart);
  const body = bafoChain.slice(fnStart, fnEnd);

  test("commercial_review step is gated to bd_manager, sales_manager, or system_admin", () => {
    expect(body).toMatch(/ARRAY\['bd_manager','sales_manager','system_admin'\]::public\.app_role\[\]/);
  });

  test("cost_approval step requires commercial_review already approved, and is gated to estimation_manager/system_admin", () => {
    expect(body).toMatch(/IF OLD\.commercial_review_status != 'approved' THEN/);
    expect(body).toMatch(/ARRAY\['estimation_manager','system_admin'\]::public\.app_role\[\]/);
  });

  test("finance_review step requires cost_approval already approved, and is gated to finance_manager/system_admin", () => {
    expect(body).toMatch(/IF OLD\.cost_approval_status != 'approved' THEN/);
    expect(body).toMatch(/ARRAY\['finance_manager','system_admin'\]::public\.app_role\[\]/);
  });

  test("final_approval step requires finance_review already approved, and is gated to executives/system_admin", () => {
    expect(body).toMatch(/IF OLD\.finance_review_status != 'approved' THEN/);
    expect(body).toMatch(/ARRAY\['managing_director','general_manager','ceo','system_admin'\]::public\.app_role\[\]/);
  });

  test("overall status rolls up: any rejected step rejects the whole request, all four approved approves it", () => {
    expect(body).toMatch(/NEW\.status := 'rejected';/);
    expect(body).toMatch(/ELSIF NEW\.final_approval_status = 'approved' THEN/);
    expect(body).toMatch(/NEW\.status := 'approved';/);
  });

  test("sent_to_client_at can only be set once status = 'approved'", () => {
    expect(body).toMatch(/IF NEW\.sent_to_client_at IS NOT NULL AND OLD\.sent_to_client_at IS NULL THEN/);
    expect(body).toMatch(/IF NEW\.status != 'approved' THEN/);
    expect(body).toMatch(/RAISE EXCEPTION 'Cannot mark a BAFO request as sent to client before it is fully approved'/);
  });
});

describe("audit_bafo_step_decision — every step decision and sent-to-client event is logged", () => {
  const fnStart = bafoChain.indexOf("CREATE OR REPLACE FUNCTION public.audit_bafo_step_decision()");
  const fnEnd = bafoChain.indexOf("$$;", fnStart);
  const body = bafoChain.slice(fnStart, fnEnd);

  test("logs a step decision when any of the four step statuses change", () => {
    expect(body).toMatch(/'bafo\.step_decided'/);
  });

  test("logs a distinct event when sent_to_client_at is first set", () => {
    expect(body).toMatch(/'bafo\.sent_to_client'/);
  });
});

describe("RLS", () => {
  test("SELECT policy allows the requester, anyone with can_view_all_sales_data, or any of the four approver roles", () => {
    const policyStart = bafoChain.indexOf('"BAFO requests readable by requester, managers, or approvers"');
    const policyBody = bafoChain.slice(policyStart, policyStart + 700);
    expect(policyBody).toMatch(/requested_by = \(SELECT auth\.uid\(\)\)/);
    expect(policyBody).toMatch(/can_view_all_sales_data/);
    expect(policyBody).toMatch(/'bd_manager','sales_manager','estimation_manager','finance_manager'/);
  });

  test("INSERT policy requires the inserting user to be the requester and a sales contributor", () => {
    const policyStart = bafoChain.indexOf('"BAFO requests insertable by sales contributors"');
    const policyBody = bafoChain.slice(policyStart, policyStart + 300);
    expect(policyBody).toMatch(/requested_by = \(SELECT auth\.uid\(\)\)/);
    expect(policyBody).toMatch(/is_sales_contributor/);
  });

  test("UPDATE policy is broad at the RLS layer — the trigger is the real per-step gate", () => {
    const policyStart = bafoChain.indexOf('"BAFO requests updatable by active users"');
    const policyBody = bafoChain.slice(policyStart, policyStart + 300);
    expect(policyBody).toMatch(/is_active_user/);
  });
});
