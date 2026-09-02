import { describe, expect, it } from "bun:test";
import {
  COMPRESS_MIN_BYTES,
  MAX_EDGE,
  shouldCompress,
  targetSize,
  worthKeeping,
} from "@/lib/image-compress";

const f = (type: string, size: number) => ({ type, size });

describe("what gets compressed", () => {
  it("compresses a large photo", () => {
    // The measured case: a 12MP phone photo at 9.8MB.
    expect(shouldCompress(f("image/jpeg", 9_818_000))).toBe(true);
    expect(shouldCompress(f("image/webp", 4_000_000))).toBe(true);
  });

  it("never touches a PDF, a BOQ or a contract", () => {
    // A contract that is not the file that was signed is not a contract.
    for (const t of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword",
    ]) {
      expect([t, shouldCompress(f(t, 20_000_000))]).toEqual([t, false]);
    }
  });

  it("leaves PNG alone", () => {
    // A PNG here is a screenshot or a line drawing — signage drawings are
    // exactly that — and re-encoding one either loses crisp edges or grows.
    expect(shouldCompress(f("image/png", 9_000_000))).toBe(false);
  });

  it("leaves a small photo alone", () => {
    // Shrinking a 400KB photo saves a second nobody notices and costs a detail
    // somebody might need.
    expect(shouldCompress(f("image/jpeg", 400_000))).toBe(false);
    expect(shouldCompress(f("image/jpeg", COMPRESS_MIN_BYTES - 1))).toBe(false);
    expect(shouldCompress(f("image/jpeg", COMPRESS_MIN_BYTES))).toBe(true);
  });
});

describe("the target size", () => {
  it("scales the long edge down and keeps the shape", () => {
    expect(targetSize(4032, 3024)).toEqual({ w: 2000, h: 1500 });
    expect(targetSize(3024, 4032)).toEqual({ w: 1500, h: 2000 });
  });

  it("never enlarges", () => {
    // Upscaling a 1200px photo would produce a BIGGER file than it started as,
    // while claiming to be a compression step.
    expect(targetSize(1200, 900)).toEqual({ w: 1200, h: 900 });
    expect(targetSize(MAX_EDGE, MAX_EDGE)).toEqual({ w: MAX_EDGE, h: MAX_EDGE });
  });

  it("survives a degenerate image rather than dividing by zero", () => {
    expect(targetSize(0, 0)).toEqual({ w: 0, h: 0 });
    expect(targetSize(6000, 1).h).toBe(1);
  });
});

describe("keeping the result", () => {
  it("keeps it only when it is genuinely smaller", () => {
    expect(worthKeeping(9_818_000, 1_319_000)).toBe(true);
  });

  it("throws the result away when re-encoding made it bigger", () => {
    // Real: a small graphic, or an image already compressed harder than our
    // quality setting. Uploading that makes the reported problem worse while
    // claiming to fix it.
    expect(worthKeeping(200_000, 260_000)).toBe(false);
    expect(worthKeeping(200_000, 200_000)).toBe(false);
    expect(worthKeeping(200_000, 0)).toBe(false);
  });
});

describe("the size gate and the compressor agree", () => {
  // Read as source rather than executed: validateDocumentFile lives beside a
  // module that touches supabase, and what matters here is the RULE, not a
  // render. The pairing is the whole point — a gate that rejects before the
  // step that would have fixed it is a gate that lies about the limit.
  const fs = require("node:fs") as typeof import("node:fs");
  const SRC = fs.readFileSync(
    require("node:path").join(import.meta.dir, "document-actions.ts"),
    "utf8",
  );

  it("lets a compressible image past the pre-flight size check", () => {
    // A 9.8MB phone photo becomes 753KB. Refusing it for being 9.8MB rejects a
    // file the system can store, and the person holding the phone has no way
    // to shrink it themselves.
    expect(SRC).toContain("if (!shouldCompress(file) && file.size > MAX_DOCUMENT_BYTES)");
  });

  it("re-checks the size after compressing", () => {
    // The pre-flight check let it through on a promise. If compression could
    // not keep that promise, this is where it has to be said — not by the
    // bucket, in a message nobody can read.
    const at = SRC.indexOf("await compressImage(input.file)");
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at, at + 400)).toContain("file.size > MAX_DOCUMENT_BYTES");
  });

  it("hashes and stores the file that was actually uploaded", () => {
    // A checksum of a file nobody kept, or a size_bytes describing the
    // original, would make the registry describe something that is not there.
    expect(SRC).toContain("const checksum = await sha256(file);");
    expect(SRC).toContain("size_bytes: file.size,");
    expect(SRC).toContain("uploadAttachment(folderFor(input.entity), file)");
    expect(SRC).not.toContain("size_bytes: input.file.size,");
  });
});
