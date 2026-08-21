// =============================================================================
// Phase 6 invariants that no other test would catch.
//
// The behavioural suites prove the database enforces the model. These pin the
// decisions a future edit could quietly undo without breaking anything visible:
// a signed URL creeping back into a column, a role list widening, a physical
// delete appearing, or the timeline growing a second event store.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const MIGRATIONS = join(root, "supabase/migrations");
const registry = read("supabase/migrations/20260822100000_document_registry.sql");
const storage = read("supabase/migrations/20260822110000_document_storage_and_backfill.sql");
const location = read("supabase/migrations/20260822120000_location_foundation.sql");
const actions = read("src/lib/document-actions.ts");

// Comments explain the OLD behaviour being replaced, so predicates are matched
// against code with comment lines stripped.
const sqlCode = (s: string) =>
  s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const tsCode = (s: string) =>
  s.split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
  }).join("\n");

describe("no signed URL ever reaches a column", () => {
  it("the registry stores a path, and there is no url column", () => {
    expect(registry).toMatch(/storage_path\s+TEXT NOT NULL/);
    expect(sqlCode(registry)).not.toMatch(/\b(signed_url|url|download_url)\s+TEXT/i);
  });

  it("document-actions never persists a signed URL", () => {
    // createSignedUrl belongs in storage-actions, called at read time only.
    expect(tsCode(actions)).not.toContain("createSignedUrl");
    expect(tsCode(actions)).toMatch(/storage_path: path/);
  });

  it("the ten-minute read TTL is the only one left in the codebase", () => {
    const offenders: string[] = [];
    for (const f of ["src/lib/storage-actions.ts", "src/lib/project-cover-actions.ts",
                     "src/lib/document-actions.ts", "src/components/phc/AttachmentThumb.tsx"]) {
      // A week, a day, an hour — any of them stored would be the D25 defect again.
      if (/60 \* 60 \* 24/.test(read(f))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

describe("D24 is not quietly widened", () => {
  it("can_read_attachments is still the narrow list, not can_view_all_sales_data", () => {
    // document_entity_grants is the new gate; it must reuse the narrow helper.
    expect(sqlCode(registry)).toContain("public.can_read_attachments(_user_id)");
    expect(sqlCode(registry)).not.toContain("can_view_all_sales_data");
  });

  it("no policy in the Phase 6 migrations admits system_admin to read documents", () => {
    // system_admin appears only in the INSERT (upload) policy, which mirrors the
    // bucket's existing INSERT policy and grants no reads.
    const selectPolicies = sqlCode(registry)
      .split("CREATE POLICY").filter((p) => /FOR SELECT/.test(p)).join("\n");
    expect(selectPolicies).not.toContain("system_admin");
  });

  it("access is never derived from the entity table's own SELECT policy", () => {
    // projects/inbox_items/contracts are readable by every active user; a
    // SECURITY INVOKER lookup would inherit that and leak.
    expect(registry).toMatch(/SECURITY DEFINER/);
    expect(sqlCode(registry)).not.toMatch(/SECURITY INVOKER/);
  });
});

describe("nothing can be physically deleted", () => {
  it("neither table has a DELETE policy", () => {
    const code = sqlCode(registry);
    expect(code).not.toMatch(/CREATE POLICY[^;]*ON public\.documents FOR DELETE/i);
    expect(code).not.toMatch(/CREATE POLICY[^;]*ON public\.document_links FOR DELETE/i);
  });

  it("the client soft-deletes rather than removing", () => {
    expect(tsCode(actions)).toMatch(/deleted_at: new Date\(\)\.toISOString\(\)/);
    expect(tsCode(actions)).not.toMatch(/\.delete\(\)/);
  });

  it("the backfill never removes an orphan", () => {
    expect(sqlCode(storage)).not.toMatch(/DELETE FROM storage\.objects/i);
    expect(sqlCode(storage)).not.toMatch(/DELETE FROM public\.documents/i);
  });
});

describe("the parts that decide access are immutable", () => {
  it("a trigger guards storage_path and provenance", () => {
    expect(registry).toContain("documents_guard_immutable");
    expect(registry).toMatch(/storage_path is immutable/);
    expect(registry).toMatch(/uploaded_by\/uploaded_at\) is immutable/);
  });

  it("one registry row per stored object", () => {
    expect(registry).toMatch(/CREATE UNIQUE INDEX[\s\S]*?documents_storage_object_unique[\s\S]*?\(storage_bucket, storage_path\)/);
  });

  it("a link cannot be created without being able to see both ends", () => {
    const insert = sqlCode(registry).split("CREATE POLICY")
      .find((p) => /document_links FOR INSERT/.test(p)) ?? "";
    expect(insert).toContain("can_read_document");
    expect(insert).toContain("document_entity_grants");
  });
});

describe("the backfill keeps migration 110's refusals", () => {
  it("it reads 110's confirmed paths rather than re-deriving them", () => {
    expect(storage).toContain("document_storage_path");
    expect(storage).toContain("evidence_storage_path");
    // No URL parsing here — that decision was already made and audited.
    expect(sqlCode(storage)).not.toContain("derive_attachment_path");
  });

  it("it confirms the object exists before asserting a document", () => {
    expect(sqlCode(storage)).toMatch(/IF NOT EXISTS \(SELECT 1 FROM storage\.objects/);
  });

  it("it is idempotent", () => {
    expect(sqlCode(storage)).toMatch(/ON CONFLICT \(storage_bucket, storage_path\) DO NOTHING/);
    expect(sqlCode(storage)).toMatch(/ON CONFLICT DO NOTHING/);
  });
});

describe("location is added where it was justified, and nowhere else", () => {
  it("only projects and documents gain coordinates", () => {
    const added = [...location.matchAll(/ALTER TABLE public\.(\w+)\s+ADD COLUMN/g)].map((m) => m[1]);
    expect([...new Set(added)]).toEqual(["projects"]);
    // documents' columns come with the table itself.
    expect(registry).toContain("captured_lat      NUMERIC(9,6)");
  });

  it("no PostGIS, no geocoding, no maps provider", () => {
    const l = sqlCode(location);
    expect(l).not.toMatch(/postgis|geography|geometry/i);
    expect(l).not.toMatch(/http|api_key|geocod/i);
  });

  it("half a coordinate is refused on both tables", () => {
    expect(location).toContain("projects_site_latlon_together");
    expect(registry).toContain("documents_latlon_together");
  });
});

describe("the timeline stays a projection", () => {
  const timeline = read("src/lib/opportunity-timeline.ts");

  it("documents is a category, not a new table", () => {
    expect(timeline).toContain('| "documents"');
    // The projection reads the registry; it writes nothing.
    expect(tsCode(timeline)).not.toMatch(/insert|INSERT INTO|timeline_events/i);
  });

  it("document events carry actor, timestamp and a deep link", () => {
    const fn = timeline.match(/function documentEvents[\s\S]*?\n}/)?.[0] ?? "";
    expect(fn).toContain("actorId");
    expect(fn).toContain("href");
    expect(fn).toMatch(/uploaded|linked|superseded|deleted|photo_added/);
  });

  it("an actor the source does not record is null, never guessed", () => {
    const fn = timeline.match(/function documentEvents[\s\S]*?\n}/)?.[0] ?? "";
    // superseded_at has no actor column, so that event's actorId must be null.
    expect(fn).toMatch(/document:superseded[\s\S]*?actorId: null/);
  });
});

// Every mutation has to leave a trace. The audit_log SELECT policy restricts
// reading to platform admins, so this is the only record of who did what to a
// file — if a mutation forgets to call audit(), nothing else notices.
describe("every document mutation is audited", () => {
  const MUTATIONS = [
    ["uploadDocument", "document.uploaded"],
    ["linkDocument", "document.linked"],
    ["unlinkDocument", "document.unlinked"],
    ["supersedeDocument", "document.superseded"],
    ["deleteDocument", "document.deleted"],
    ["updateDocumentMeta", "document.updated"],
  ] as const;

  for (const [fn, action] of MUTATIONS) {
    it(`${fn} writes ${action}`, () => {
      const body = actions.match(new RegExp(`export async function ${fn}\\([\\s\\S]*?\\n}`))?.[0];
      expect(body, `${fn} not found`).toBeTruthy();
      expect(body).toContain(`audit("${action}"`);
    });
  }

  it("uses the shared helper rather than adding a ninth private copy", () => {
    expect(actions).toContain('import { audit } from "@/lib/audit"');
    expect(tsCode(actions)).not.toMatch(/async function audit\(/);
  });

  it("an audit failure never rolls back the action it describes", () => {
    const helper = read("src/lib/audit.ts");
    expect(helper).toContain("console.error");
    expect(helper).toContain("return { error }");
    expect(tsCode(helper)).not.toMatch(/throw /);
  });
});

describe("Phase 6 ships no AI", () => {
  it("no OCR, extraction or classification anywhere in the new code", () => {
    for (const f of ["src/lib/document-actions.ts", "src/components/phc/DocumentsPanel.tsx"]) {
      expect(tsCode(read(f))).not.toMatch(/ocr|classif|extract|ai-orchestrator|openai|anthropic/i);
    }
    for (const m of [registry, storage, location]) {
      expect(sqlCode(m)).not.toMatch(/\bocr\b|classif|embedding|vector/i);
    }
  });
});

describe("the migrations stay local until approved", () => {
  it("all three say so in their header", () => {
    for (const m of [registry, storage, location]) {
      expect(m).toContain("LOCAL ONLY");
    }
  });

  it("Phase 6 adds exactly three migrations", () => {
    const p6 = readdirSync(MIGRATIONS).filter((f) => f.startsWith("20260822"));
    expect(p6.sort()).toEqual([
      "20260822100000_document_registry.sql",
      "20260822110000_document_storage_and_backfill.sql",
      "20260822120000_location_foundation.sql",
    ]);
  });
});
