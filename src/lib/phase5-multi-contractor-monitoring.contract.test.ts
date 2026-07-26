// Contract test for Phase 5 (system-redesign request: "how does the system
// monitor variable BOQ/package per contractor per project stage"). The
// investigation found the data model already supports this — opportunities
// has its own project_id AND main_contractor_id, so multiple opportunities
// (one per competing contractor) can already share one project, each with
// independent stage/package/BOQ tracking. The actual gap was the project
// detail page not surfacing this. Verified live against local Postgres
// during development (two contractors on one project, each with distinct
// signage_package_status and BOQ presence) — this test pins the query shape
// statically. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const source = readFileSync(join(repoRoot, "src/routes/_authenticated/projects.$id.tsx"), "utf8");

test("the linked-opportunities query embeds each opportunity's own main_contractor, not just the project's", () => {
  const selectMatch = source.match(/"(\*, main_contractor:companies!projects_main_contractor_id_fkey[\s\S]*?)"/);
  expect(selectMatch).not.toBeNull();
  const select = selectMatch![1];
  // Two distinct main_contractor embeds: one at project level (projects_...fkey),
  // one nested inside the opportunities embed (opportunities_...fkey) — this is
  // what lets two opportunities on the same project show two different
  // contractor names.
  expect(select).toMatch(/main_contractor:companies!projects_main_contractor_id_fkey/);
  expect(select).toMatch(/opportunities:opportunities!opportunities_project_id_fkey\([\s\S]*?main_contractor:companies!opportunities_main_contractor_id_fkey/);
});

test("the linked-opportunities query embeds each opportunity's own signage_package_status and boqs", () => {
  const selectMatch = source.match(/"(\*, main_contractor:companies!projects_main_contractor_id_fkey[\s\S]*?)"/);
  const select = selectMatch![1];
  const oppEmbedMatch = select.match(/opportunities:opportunities!opportunities_project_id_fkey\(([\s\S]*)\)$/);
  expect(oppEmbedMatch).not.toBeNull();
  const oppEmbed = oppEmbedMatch![1];
  expect(oppEmbed).toMatch(/signage_package_status/);
  expect(oppEmbed).toMatch(/boqs\(status\)/);
});

test("the panel shows a multi-contractor hint only when more than one opportunity is linked", () => {
  expect(source).toMatch(/oppCount > 1 \? \(/);
  expect(source).toMatch(/crm_multi_contractor_hint/);
});

test("each linked opportunity renders its own contractor, package status, and BOQ status pills", () => {
  const start = source.indexOf("{p.opportunities.map((o) => {");
  const end = source.indexOf("</ul>", start);
  const block = source.slice(start, end);
  expect(block).toMatch(/o\.main_contractor\?\.name/);
  expect(block).toMatch(/o\.signage_package_status/);
  expect(block).toMatch(/const boq = o\.boqs\?\.\[0\]/);
});
