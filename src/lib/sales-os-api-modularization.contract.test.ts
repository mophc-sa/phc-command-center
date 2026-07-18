import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHandlerRegistry,
  type HandlerModule,
  type SalesOsHandler,
} from "../../supabase/functions/sales-os-api/contracts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = join(repoRoot, "supabase/functions/sales-os-api");

const expectedByModule = {
  approvals: [
    "decide_approval",
    "request_owner_assignment",
    "request_stage_change",
    "request_tender_conversion",
    "approve_tender_conversion",
  ],
  pipeline: [
    "close_quotation",
    "convert_lead",
    "change_account_owner",
    "assign_owner",
    "update_opportunity_stage",
    "convert_rfq_to_jih",
    "advance_sales_stage",
    "set_win_confidence",
    "advance_tender_stage",
  ],
  intelligence: [
    "accept_recommendation",
    "search_knowledge",
    "index_knowledge",
    "reindex_reference_library",
    "run_lead_scoring",
    "run_duplicate_detection",
    "generate_ai_weekly_report",
    "ai_recommendation_feedback",
    "run_data_cleanup",
    "run_project_radar",
  ],
  automation: [
    "run_protenders_ingest",
    "run_boq_extraction",
    "run_contact_mapping",
    "run_risk_finance",
    "run_smart_followup",
    "run_automations",
  ],
  lifecycle: [
    "archive_record",
    "unarchive_record",
    "request_delete",
    "execute_delete",
    "flag_duplicate",
    "resolve_duplicate_group",
  ],
} as const;

test("all 36 sales-os-api actions exist exactly once in their vertical modules", () => {
  const discovered: string[] = [];
  for (const [moduleName, expected] of Object.entries(expectedByModule)) {
    const source = readFileSync(join(apiRoot, `handlers/${moduleName}.ts`), "utf8");
    const actions = [...source.matchAll(/^async function ([a-zA-Z0-9_]+)\(/gm)].map(
      (match) => match[1],
    );
    const manifest = source.match(/handlers:\s*\{([\s\S]*?)\n\s*\},\n\};/);
    expect(manifest, `${moduleName} manifest not found`).not.toBeNull();
    const registered = [...manifest![1].matchAll(/^\s+([a-zA-Z0-9_]+),$/gm)].map(
      (match) => match[1],
    );
    expect(actions).toEqual(expected);
    expect(registered).toEqual(expected);
    discovered.push(...actions);
    expect(source).not.toContain('from "../index.ts"');
    expect(source).not.toContain("serviceClient()");
  }
  expect(discovered).toHaveLength(36);
  expect(new Set(discovered).size).toBe(36);
});

test("the registry fails fast when modules claim the same action", () => {
  const handler: SalesOsHandler = async () => new Response("ok");
  const first: HandlerModule = { name: "first", handlers: { duplicate: handler } };
  const second: HandlerModule = { name: "second", handlers: { duplicate: handler } };
  expect(() => createHandlerRegistry([first, second])).toThrow(
    "Duplicate sales-os-api action 'duplicate' in module 'second'",
  );
});

test("the registry publishes a stable action inventory", () => {
  const handler: SalesOsHandler = async () => new Response("ok");
  const registry = createHandlerRegistry([
    { name: "one", handlers: { first: handler, second: handler } },
  ]);
  expect(registry.actions).toEqual(["first", "second"]);
  expect(Object.isFrozen(registry.handlers)).toBe(true);
  expect(Object.isFrozen(registry.actions)).toBe(true);
});

test("architecture size limits keep the entrypoint and feature modules focused", () => {
  const entryLines = readFileSync(join(apiRoot, "index.ts"), "utf8").split("\n").length;
  expect(entryLines).toBeLessThanOrEqual(250);
  for (const moduleName of Object.keys(expectedByModule)) {
    const lines = readFileSync(join(apiRoot, `handlers/${moduleName}.ts`), "utf8").split(
      "\n",
    ).length;
    expect(lines, `${moduleName}.ts exceeds 700 lines`).toBeLessThanOrEqual(700);
  }
  for (const supportFile of ["contracts.ts", "router.ts", "shared.ts"]) {
    const lines = readFileSync(join(apiRoot, supportFile), "utf8").split("\n").length;
    expect(lines, `${supportFile} exceeds 700 lines`).toBeLessThanOrEqual(700);
  }
});
