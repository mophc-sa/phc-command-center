// Contract tests for the 2026-07-27 "متطلبات الصلاحيات وعزل بيانات المبيعات"
// batch: finance_manager role, sales data isolation RLS, RFQ fields/
// numbering/Total Value protection, and account delete. Static SQL
// inspection (this repo has no live-DB test harness for RLS). Run with
// `bun test src`.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
function migration(name: string): string {
  return readFileSync(join(repoRoot, "supabase/migrations", name), "utf8");
}

const financeManagerRole = migration("20260727160000_add_finance_manager_role.sql");
const isolation = migration("20260727170000_sales_data_isolation.sql");
const rfqFields = migration("20260727180000_rfq_fields_numbering_total_value.sql");
const deletedStatus = migration("20260727190000_add_deleted_user_status.sql");
const protectDelete = migration("20260727200000_protect_delete_user_status.sql");

test("finance_manager role is added in its own migration (enum-add-value transaction rule)", () => {
  expect(financeManagerRole).toMatch(/ALTER TYPE public\.app_role ADD VALUE IF NOT EXISTS 'finance_manager'/);
});

describe("sales data isolation", () => {
  test("can_view_all_sales_data includes every manager-tier role the client spec names, plus finance_manager/sales_ops for their own job functions, plus viewer (pre-existing full read access, unrestricted by this spec)", () => {
    for (const role of ["system_admin", "managing_director", "general_manager", "ceo", "sales_manager", "bd_manager", "sales_ops", "finance_manager", "viewer"]) {
      expect(isolation).toMatch(new RegExp(`'${role}'`));
    }
  });

  test("salesperson is NOT in can_view_all_sales_data — it is the one role this migration actually restricts", () => {
    const fnStart = isolation.indexOf("CREATE OR REPLACE FUNCTION public.can_view_all_sales_data");
    const fnEnd = isolation.indexOf("$$;", fnStart);
    expect(isolation.slice(fnStart, fnEnd)).not.toMatch(/'salesperson'/);
  });

  test("opportunities/rfqs/tenders/quotations/follow_ups SELECT policies are owner-or-manager scoped", () => {
    const expectations: [string, string][] = [
      ["opportunities", "owner_id"],
      ["rfqs", "sales_owner_id"],
      ["tenders", "tender_owner_id"],
      ["quotations", "owner_id"],
      ["follow_ups", "owner_id"],
    ];
    for (const [table, ownerColumn] of expectations) {
      const policyStart = isolation.indexOf(`ON public.${table}\n  FOR SELECT`);
      expect(policyStart, `${table} SELECT policy not found`).toBeGreaterThan(-1);
      const policyBody = isolation.slice(policyStart, policyStart + 300);
      expect(policyBody).toMatch(new RegExp(`${ownerColumn} = \\(SELECT auth\\.uid\\(\\)\\)`));
      expect(policyBody).toMatch(/can_view_all_sales_data/);
      expect(policyBody).toMatch(/is_active_user/);
    }
  });

  test("companies and contacts SELECT policies are NOT touched — they stay org-wide readable for dedup", () => {
    expect(isolation).not.toMatch(/public\.companies/);
    expect(isolation).not.toMatch(/public\.contacts/);
  });
});

describe("RFQ fields, numbering, Total Value", () => {
  test("adds city, classification, classification_other with a CHECK constraint", () => {
    expect(rfqFields).toMatch(/ADD COLUMN IF NOT EXISTS city text/);
    expect(rfqFields).toMatch(/ADD COLUMN IF NOT EXISTS classification text/);
    expect(rfqFields).toMatch(/ADD COLUMN IF NOT EXISTS classification_other text/);
    expect(rfqFields).toMatch(/CHECK \(classification IS NULL OR classification IN \('jih', 'tender', 'other'\)\)/);
  });

  test("rfq_number gets a UNIQUE constraint and an auto-generation sequence", () => {
    expect(rfqFields).toMatch(/CREATE SEQUENCE IF NOT EXISTS public\.rfq_number_seq/);
    expect(rfqFields).toMatch(/ADD CONSTRAINT rfqs_rfq_number_key UNIQUE \(rfq_number\)/);
    expect(rfqFields).toMatch(/'RFQ-' \|\| to_char\(now\(\), 'YYYY'\) \|\| '-' \|\| lpad\(nextval/);
  });

  test("generate_rfq_number() only checks TG_OP-safe _old_number, never bare OLD, and only discards unauthorized manual values for authenticated end users", () => {
    const fnStart = rfqFields.indexOf("CREATE OR REPLACE FUNCTION public.generate_rfq_number()");
    const fnEnd = rfqFields.indexOf("$$;", fnStart);
    const body = rfqFields.slice(fnStart, fnEnd);
    expect(body).toMatch(/_old_number text := CASE WHEN TG_OP = 'UPDATE' THEN OLD\.rfq_number ELSE NULL END/);
    expect(body).not.toMatch(/[^_]OLD\.rfq_number\b(?!\s*ELSE)/);
    expect(body).toMatch(/auth\.uid\(\) IS NOT NULL/);
    expect(body).toMatch(/can_edit_rfq_number/);
  });

  test("can_edit_rfq_number and can_edit_total_value map to the exact client-specified role sets", () => {
    const rfqNumberFnStart = rfqFields.indexOf("CREATE OR REPLACE FUNCTION public.can_edit_rfq_number");
    const rfqNumberFnEnd = rfqFields.indexOf("$$;", rfqNumberFnStart);
    expect(rfqFields.slice(rfqNumberFnStart, rfqNumberFnEnd)).toMatch(
      /ARRAY\['sales_manager', 'bd_manager', 'system_admin'\]/,
    );

    const totalValueFnStart = rfqFields.indexOf("CREATE OR REPLACE FUNCTION public.can_edit_total_value");
    const totalValueFnEnd = rfqFields.indexOf("$$;", totalValueFnStart);
    expect(rfqFields.slice(totalValueFnStart, totalValueFnEnd)).toMatch(
      /ARRAY\['finance_manager', 'bd_manager', 'system_admin'\]/,
    );
  });

  test("protect_rfq_estimated_value uses TG_OP-safe _old_value and exempts service-role callers (auth.uid() IS NULL)", () => {
    const fnStart = rfqFields.indexOf("CREATE OR REPLACE FUNCTION public.protect_rfq_estimated_value()");
    const fnEnd = rfqFields.indexOf("$$;", fnStart);
    const body = rfqFields.slice(fnStart, fnEnd);
    expect(body).toMatch(/_old_value numeric := CASE WHEN TG_OP = 'UPDATE' THEN OLD\.estimated_value ELSE NULL END/);
    expect(body).toMatch(/auth\.uid\(\) IS NOT NULL/);
    expect(body).toMatch(/RAISE EXCEPTION/);
  });
});

describe("account delete (distinct from suspend)", () => {
  test("'deleted' user_status is added in its own migration", () => {
    expect(deletedStatus).toMatch(/ALTER TYPE public\.user_status ADD VALUE IF NOT EXISTS 'deleted'/);
  });

  test("only system_admin may transition a profile to status = 'deleted', enforced server-side", () => {
    expect(protectDelete).toMatch(/NEW\.status = 'deleted'/);
    expect(protectDelete).toMatch(/ARRAY\['system_admin'\]::public\.app_role\[\]/);
    expect(protectDelete).toMatch(/RAISE EXCEPTION 'Only System Admin may delete an account'/);
  });

  test("route.tsx signs out and redirects for both suspended and deleted status", () => {
    const routeSrc = readFileSync(join(repoRoot, "src/routes/_authenticated/route.tsx"), "utf8");
    expect(routeSrc).toMatch(/profile\.status === "suspended" \|\| profile\.status === "deleted"/);
  });
});
