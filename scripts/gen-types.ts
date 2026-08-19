#!/usr/bin/env bun
/**
 * Regenerate src/integrations/supabase/types.ts from the live project, and put
 * the hand-written block back.
 *
 * `supabase gen types` overwrites the file wholesale. The file ends with a
 * block of types that are NOT generated (ImportSplitProposal, AiAgentOutput,
 * AiAgentCallResult) and the generator drops them every single time.
 *
 * That has now happened three times — 2026-08-06, and twice more during the
 * Phase 2 and Phase 3 migrations. Each time typecheck caught it, each time it
 * cost a round trip. The file's own comment warned about it and the warning
 * was not enough, because the warning is only read after the damage.
 *
 * Usage: bun run gen:types
 */
import { $ } from "bun";

const TYPES = "src/integrations/supabase/types.ts";
const MARKER = "// ─── Hand-written additions ─";
const PROJECT_ID = "lrfdtoexyeghrzynapyn";

const before = await Bun.file(TYPES).text();
const markerAt = before.indexOf(MARKER);
if (markerAt === -1) {
  console.error(`✗ ${TYPES} has no hand-written block marker. Refusing to run:`);
  console.error("  either the block was already lost, or the marker changed.");
  console.error("  Restore it from git before regenerating.");
  process.exit(1);
}
const handWritten = before.slice(markerAt);
console.log(`• preserving ${handWritten.split("\n").length} lines of hand-written types`);

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.error("✗ SUPABASE_ACCESS_TOKEN is not set.");
  process.exit(1);
}

const generated = await $`bunx supabase@latest gen types typescript --project-id ${PROJECT_ID}`.text();
if (!generated.includes("export type Database")) {
  console.error("✗ generator produced no Database type — refusing to overwrite.");
  process.exit(1);
}

// Guard against silent loss: the generated file must still contain every table
// the current one does. A shrinking schema is possible but should be deliberate.
const tables = (s: string) => new Set([...s.matchAll(/^ {6}([a-z_]+): \{$/gm)].map((m) => m[1]));
const lost = [...tables(before)].filter((t) => !tables(generated).has(t));
if (lost.length) {
  console.error(`✗ the generated file is missing ${lost.length} table(s) present today: ${lost.join(", ")}`);
  console.error("  Refusing to overwrite. Check you are pointed at the right project.");
  process.exit(1);
}

await Bun.write(TYPES, `${generated.trimEnd()}\n\n${handWritten}`);
console.log(`✓ ${TYPES} regenerated, hand-written block re-appended`);
console.log("  now run: bun run typecheck");
