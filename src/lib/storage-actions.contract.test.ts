// =============================================================================
// Guards the attachment storage contract.
//
// The defect being prevented: uploadAttachment returned a 7-day signed URL and
// three of four call sites stored it in a business column. Those links die a
// week later and the file becomes unreachable — silently, because the row still
// holds a plausible-looking URL. Two production rows already carry one and one
// is confirmed dead (HTTP 400).
//
// A regression here fails no other test; files would just quietly stop opening
// a week after upload. So it is pinned.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const HELPER = "src/lib/storage-actions.ts";
const raw = read(HELPER);
// The header explains the OLD behaviour it replaced, so match against code.
const code = raw.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");

describe("uploadAttachment returns a durable reference", () => {
  it("returns a path", () => {
    expect(code).toMatch(/path:\s*data\.path/);
  });

  // The whole point: the caller must not be handed something it is tempted to
  // persist. Naming it previewUrl rather than url is part of that.
  it("names the temporary link previewUrl, not url", () => {
    expect(code).toContain("previewUrl");
    expect(code).not.toMatch(/return \{ path: data\.path, url:/);
  });

  it("no longer mints a multi-day link at upload time", () => {
    expect(code).not.toMatch(/60 \* 60 \* 24 \* 7/);
    const ttl = raw.match(/READ_URL_TTL_SECONDS = ([^;]+);/);
    expect(ttl).not.toBeNull();
    // 10 minutes — long enough to outlive a click, too short to be worth storing.
    expect(ttl![1]).toContain("60 * 10");
  });
});

describe("uploads never silently overwrite", () => {
  it("upsert is false", () => {
    expect(code).toMatch(/upsert:\s*false/);
    expect(code).not.toMatch(/upsert:\s*true/);
  });

  it("the path carries more than a timestamp, so collisions are not a coin flip", () => {
    expect(code).toMatch(/Math\.random\(\)/);
  });
});

describe("links are minted at read time", () => {
  it("exposes signAttachment", () => {
    expect(code).toMatch(/export async function signAttachment/);
  });

  it("exposes resolveAttachmentUrl for the legacy transition", () => {
    expect(code).toMatch(/export async function resolveAttachmentUrl/);
  });

  it("prefers storagePath over the legacy URL", () => {
    expect(code).toMatch(/if \(storagePath\) return signAttachment\(storagePath\)/);
  });

  // Recovering the path from an already-expired URL and re-signing is what
  // repairs the two dead production rows, without editing the stored value.
  it("recovers a path from one of our own expired URLs and re-signs it", () => {
    expect(code).toContain("split(\"?\")[0]");
    expect(code).toMatch(/return signAttachment\(recovered\)/);
  });

  it("hands an external URL back untouched rather than pretending to sign it", () => {
    expect(code).toMatch(/return legacyUrl;/);
  });

  it("returns null instead of throwing when a file is gone or forbidden", () => {
    expect(code).toMatch(/if \(error\) return null/);
  });
});

// A signed URL in a business column is the defect. Every call site must store
// the path.
describe("no call site persists a signed URL", () => {
  const callSites = [
    "src/components/phc/ActionDialog.tsx",
    "src/lib/project-cover-actions.ts",
    "src/lib/opportunity-collab-actions.ts",
  ];

  for (const f of callSites) {
    it(`${f.split("/").pop()} destructures path, never url`, () => {
      const s = read(f);
      const calls = [...s.matchAll(/const \{\s*(\w+)\s*\} = await uploadAttachment/g)].map((m) => m[1]);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c).toBe("path");
    });
  }

  it("evidence uploads write vault_path and leave source_url null", () => {
    const s = read("src/lib/opportunity-collab-actions.ts");
    expect(s).toContain("vault_path: path");
    expect(s).toContain("source_url: null");
  });
});

// The other half of the same defect. Once uploads store a path, a read site
// that still renders the raw column into href produces a dead link — and for
// newly uploaded evidence, no link at all, because source_url is now null.
// Storing the path and rendering it are one change, not two.
describe("no read site renders a stored reference straight into href", () => {
  const readSites = [
    "src/routes/_authenticated/opportunities.$id.tsx",
    "src/components/phc/pipeline/RfqJihPanel.tsx",
  ];

  for (const f of readSites) {
    it(`${f.split("/").pop()} routes attachments through AttachmentLink`, () => {
      const s = read(f);
      expect(s).toContain("AttachmentLink");
      // href={x.document_url} / href={x.source_url} and the multi-line form.
      expect(s).not.toMatch(/href=\{[^}]*\b(document_url|source_url|vault_path)\b/);
    });
  }

  it("resolves on click rather than minting a signature for every row", () => {
    const s = read("src/components/phc/AttachmentLink.tsx");
    expect(s).toMatch(/onClick=\{async/);
    expect(s).toContain("resolveAttachmentUrl");
    // No href until it is used; a real one would be stale by click time.
    expect(s).not.toMatch(/href=\{/);
  });

  it("a reference that resolves to nothing does not render a dead anchor", () => {
    const s = read("src/components/phc/AttachmentLink.tsx");
    expect(s).toMatch(/if \(!url\)/);
    expect(s).toContain("attachment_unavailable");
  });
});

// production holds `no-reply@raseedinvest.com` in one evidence_url, and since
// this hotfix ActionDialog writes bare paths into the same legacy columns. The
// resolver has to tell those apart without guessing.
describe("the resolver handles every shape these columns now hold", () => {
  it("returns an external URL untouched", () => {
    expect(code).toMatch(/if \(\/\^https\?:\\\/\\\/\/i\.test\(legacyUrl\)\) return legacyUrl;/);
  });

  it("treats a non-URL as a path and lets storage decide", () => {
    expect(code).toMatch(/return signAttachment\(legacyUrl\);/);
  });
});
