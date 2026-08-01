import { test, expect } from "bun:test";
import { validateEvidenceFile } from "./opportunity-collab-actions";

function fakeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

test("validateEvidenceFile accepts an allowed type under the size limit", () => {
  const file = fakeFile("evidence.pdf", "application/pdf", 1024 * 1024);
  expect(validateEvidenceFile(file)).toBeNull();
});

test("validateEvidenceFile rejects a file over 25 MB", () => {
  const file = fakeFile("huge.pdf", "application/pdf", 26 * 1024 * 1024);
  expect(validateEvidenceFile(file)).toBe("file_too_large");
});

test("validateEvidenceFile rejects a disallowed MIME type", () => {
  const file = fakeFile("script.exe", "application/x-msdownload", 1024);
  expect(validateEvidenceFile(file)).toBe("file_type_not_allowed");
});

test("validateEvidenceFile allows a file with no reported MIME type (some OS/browser combos omit it)", () => {
  const file = fakeFile("unknown", "", 1024);
  expect(validateEvidenceFile(file)).toBeNull();
});
