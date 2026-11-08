import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PORTAL_CONFIRMATION, buildSubmission, type PortalLine } from "./supplier-portal";
import { SUPPLIER_ACTIONS } from "../../supabase/functions/_shared/supplier-portal";

// The browser and the database agree on the supplier portal's fixed parts.
const dir = new URL("../../supabase/migrations/", import.meta.url);
const SQL = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("supplier portal contract", () => {
  it("the confirmation the supplier reads is the one the database stores", () => {
    const fn = SQL.slice(SQL.lastIndexOf("CREATE OR REPLACE FUNCTION public.supplier_portal_confirmation("));
    expect(fn).toContain(`WHEN 'en' THEN '${PORTAL_CONFIRMATION.en.replace(/'/g, "''")}'`);
    expect(fn).toContain(`WHEN 'ar' THEN '${PORTAL_CONFIRMATION.ar.replace(/'/g, "''")}'`);
  });

  it("every sales-os-api action the screens call is registered, and a supplier may call only its own", () => {
    const handlers = read("../../supabase/functions/sales-os-api/handlers/supplier-portal.ts");
    const manifest = handlers.match(/handlers:\s*\{([^}]+)\}/)?.[1].split(",").map((s) => s.trim()) ?? [];
    const called = (src: string) => [
      ...[...src.matchAll(/callBackend(?:<[^>]*>)?\(\s*"(supplier_\w+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/action:\s*"(supplier_\w+)"/g)].map((m) => m[1]),
    ];
    const pricer = called(read("./pricing-actions.ts"));
    const supplier = called(read("./supplier-portal-actions.ts"));
    expect(pricer.sort()).toEqual(["supplier_account_create", "supplier_account_password_link"]);
    expect(supplier).toEqual(["supplier_file_download"]);
    for (const a of [...pricer, ...supplier]) expect(manifest).toContain(a);
    expect([...SUPPLIER_ACTIONS]).toEqual(supplier);
    expect(read("./supplier-portal-actions.ts")).not.toMatch(/signedUrl|\burl\b/i);
  });

  it("supplier_portal_invitation never returns a site, a deal or a BOQ id", () => {
    const fn = SQL.slice(SQL.lastIndexOf("CREATE OR REPLACE FUNCTION public.supplier_portal_invitation("));
    const body = fn.slice(0, fn.indexOf("END $$;"));
    expect(body).toContain("'line_id', il.id");
    for (const leak of ["'location'", "'opportunity_id'", "'project_name'", "'boq_line_id'", "'vendor_id'"]) {
      expect(body).not.toContain(leak);
    }
  });

  // The wrappers send exactly the names the edge handlers read from the payload.
  it("each edge action is sent the payload keys its handler reads", () => {
    const handlers = read("../../supabase/functions/sales-os-api/handlers/supplier-portal.ts");
    const readKeys = (action: string): string[] => {
      const from = handlers.indexOf(`async function ${action}(`);
      expect(from).toBeGreaterThan(-1);
      const next = handlers.indexOf("\nasync function ", from + 10);
      const end = next < 0 ? handlers.indexOf("export const", from) : next;
      return [...new Set([...handlers.slice(from, end).matchAll(/payload\.(\w+)/g)].map((m) => m[1]))].sort();
    };
    const sent = (src: string, action: string): string[] => {
      const m = src.match(new RegExp(`"${action}",\\s*(?:payload:\\s*)?\\{([^}]*)\\}`));
      expect(m).not.toBeNull();
      return [...(m?.[1] ?? "").matchAll(/(\w+)\s*(?::|,|$)/g)].map((k) => k[1]).sort();
    };
    const pricer = read("./pricing-actions.ts");
    const supplier = read("./supplier-portal-actions.ts");
    expect(sent(pricer, "supplier_account_create")).toEqual(readKeys("supplier_account_create"));
    expect(sent(pricer, "supplier_account_password_link")).toEqual(readKeys("supplier_account_password_link"));
    expect(sent(supplier, "supplier_file_download")).toEqual(readKeys("supplier_file_download"));
  });

  it("the submission carries the keys supplier_portal_submit reads, and only those", () => {
    const fn = SQL.slice(SQL.lastIndexOf("CREATE OR REPLACE FUNCTION public.supplier_portal_submit("));
    const body = fn.slice(0, fn.indexOf("END $$;"));
    const line = { line_id: "a", line_number: 1, quantity: 1, editable: true, unit_cost: 5 } as PortalLine;
    const r = buildSubmission([line], {}, { lead: "10", payment: "Net 30", valid: "2099-01-01" }, "2026-11-08");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of Object.keys(r.lines[0])) expect(body).toMatch(new RegExp(`['"]${k}['"]|->>'${k}'`));
    for (const k of Object.keys(r.terms)) expect(body).toContain(`'${k}'`);
    expect(Object.keys(r.lines[0]).sort()).toEqual(["line_id", "spec_difference", "unit_cost", "unit_cost_with_screen"]);
    expect(Object.keys(r.terms).sort()).toEqual(["lead_time_days", "payment_terms", "valid_until"]);
    // The line carries its own request line id, never alternate_spec (that is the pricer's entry).
    expect(body).toContain("'spec_difference'");
  });

  it("a PortalLine has exactly the keys the database sends for a line", () => {
    const fn = SQL.slice(SQL.lastIndexOf("CREATE OR REPLACE FUNCTION public.supplier_portal_invitation("));
    const body = fn.slice(0, fn.indexOf("END $$;"));
    const lines = body.slice(body.indexOf("'line_id', il.id"), body.indexOf("ORDER BY bl.line_number"));
    const sent = [...lines.matchAll(/'(\w+)',\s*(?!')/g)].map((m) => m[1]).sort();
    const full: Record<keyof PortalLine, true> = {
      line_id: true, line_number: true, sign_type: true, description: true, dimensions: true, material: true,
      mounting: true, illumination: true, finish: true, quantity: true, unit: true, width_mm: true, height_mm: true,
      has_screen: true, state: true, editable: true, unit_cost: true, unit_cost_with_screen: true, spec_difference: true,
    };
    expect(Object.keys(full).sort()).toEqual(sent);
  });

  it("the notices the pricer reads are the ones the database emits", () => {
    const i18n = read("./i18n.tsx");
    for (const type of ["pricing_supplier_submitted", "pricing_supplier_overdue"]) {
      expect(SQL).toContain(`'${type}'`);
      expect(i18n).toContain(`notif_type_${type}:`);
    }
    expect(SQL).toContain("jsonb_build_object('pricing_file_id'");
  });
});
