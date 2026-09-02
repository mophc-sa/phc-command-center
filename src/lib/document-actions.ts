// =============================================================================
// PHC Sales OS — the document registry, client side (Phase 6).
//
// Every file in the system goes through here: uploaded to the private bucket,
// recorded in `documents`, and linked to the record it belongs to. The three
// are one operation as far as callers are concerned, because a file that is
// stored but not registered is invisible to everyone but its uploader, and a
// file that is registered but not linked grants nothing.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ----------------------------------
// It never stores a URL. Read links are minted on click by AttachmentLink, from
// the path, with a ten-minute life (D25). It never physically deletes: there is
// no DELETE policy on either table, so `deleteDocument` writes deleted_at and
// the object stays where it is.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import { compressImage, shouldCompress } from "@/lib/image-compress";
import { uploadAttachment } from "@/lib/storage-actions";
import { audit } from "@/lib/audit";

export type DocumentEntityType =
  | "opportunity" | "rfq" | "tender" | "project"
  | "contract" | "boq" | "quotation" | "inbox_item";

export type DocumentType =
  | "boq" | "drawing" | "contract" | "quotation" | "photo"
  | "award_letter" | "submission" | "correspondence" | "report" | "other";

export type DocumentRecord = {
  id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  checksum: string | null;
  doc_type: DocumentType;
  title: string | null;
  notes: string | null;
  captured_lat: number | null;
  captured_lon: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  deleted_by: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  superseded_by: string | null;
  superseded_at: string | null;
  is_legacy: boolean;
};

export type EntityRef = { type: DocumentEntityType; id: string };

/** 25MB, matching the bucket's own server-side limit. */
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * The bucket enforces its own MIME allowlist server-side — verified live: an
 * upload of `text/plain` is refused with 415. This client-side list exists to
 * fail fast with a readable message, not as the security boundary.
 */
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const PHOTO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isPhoto(d: Pick<DocumentRecord, "mime_type" | "doc_type">): boolean {
  return d.doc_type === "photo" || (!!d.mime_type && PHOTO_MIME_TYPES.has(d.mime_type));
}

export function validateDocumentFile(file: File): string | null {
  // The size check skips images that are about to be compressed. A 9.8MB site
  // photo leaves compressImage at 753KB -- refusing it for being 9.8MB would
  // reject a file this system is perfectly able to store, and the person
  // holding the phone has no way to shrink it themselves.
  //
  // The ceiling still applies to everything else, and to an image so large that
  // even compressed it would not fit: uploadDocument re-checks the compressed
  // size before it sends anything.
  if (!shouldCompress(file) && file.size > MAX_DOCUMENT_BYTES) return "file_too_large";
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) return "file_type_not_allowed";
  return null;
}

/**
 * SHA-256 of the file, hex.
 *
 * Best effort on purpose. SubtleCrypto needs a secure context, so this returns
 * null over plain HTTP rather than throwing — and a null checksum is honest
 * where a fabricated one would be worse than nothing. The column is immutable
 * once written precisely so a later "fix" cannot quietly replace it.
 */
async function sha256(file: File): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * The storage folder for an entity's files.
 *
 * The path no longer carries any authority — the registry decides access, not
 * the prefix — but a UUID-keyed folder still makes the bucket navigable and
 * keeps one record's files together when someone is looking at raw storage.
 */
function folderFor(entity: EntityRef): string {
  return `${entity.type}/${entity.id}`;
}

// ---- Upload ----------------------------------------------------------------

export type UploadDocumentInput = {
  entity: EntityRef;
  file: File;
  docType?: DocumentType;
  title?: string | null;
  notes?: string | null;
  linkRole?: string | null;
  /** Where a photo was taken. Both or neither — the column constraint enforces it. */
  capturedAt?: { lat: number; lon: number } | null;
  /** When set, the new file replaces this one and the old row records that. */
  supersedes?: string | null;
};

export async function uploadDocument(input: UploadDocumentInput): Promise<DocumentRecord> {
  const invalid = validateDocumentFile(input.file);
  if (invalid) throw new Error(invalid);

  const uploadedBy = await currentUserId();
  if (!uploadedBy) throw new Error("not_authenticated");

  // Reported 2026-09-02: uploads take a long time and the files are large.
  // Measured: hashing 25MB costs 23ms, so the checksum is innocent -- what
  // takes the time is bytes on a mobile connection, and the bytes are mostly
  // photographs. A 12MP site photo measured 9,818KB and left here at 753KB,
  // thirteen times smaller, in 125ms. PDFs, BOQs, contracts and PNG drawings
  // are returned untouched; see image-compress.ts for why each.
  const { file } = await compressImage(input.file);
  // Re-checked after, because the pre-flight check let large images through on
  // the promise that this step would shrink them. If it could not, say so here
  // rather than letting the bucket refuse it with a message nobody can read.
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("file_too_large");

  // Hashed AFTER, so the checksum describes the object that is actually
  // stored. A checksum of a file nobody kept is worse than none.
  const checksum = await sha256(file);

  // Storage first. If the registry insert fails afterwards the object is
  // orphaned rather than lost, and the Phase 6 backfill reports orphans — the
  // other order would leave a registry row pointing at nothing, which reads as
  // a working file until someone clicks it.
  const { path } = await uploadAttachment(folderFor(input.entity), file);

  const { data: doc, error } = await supabase
    .from("documents")
    .insert({
      storage_bucket: "attachments",
      storage_path: path,
      original_filename: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      checksum,
      doc_type: input.docType ?? (PHOTO_MIME_TYPES.has(input.file.type) ? "photo" : "other"),
      title: input.title ?? null,
      notes: input.notes ?? null,
      captured_lat: input.capturedAt?.lat ?? null,
      captured_lon: input.capturedAt?.lon ?? null,
      uploaded_by: uploadedBy,
    } as never)
    .select()
    .single();
  if (error) throw error;

  const record = doc as unknown as DocumentRecord;

  const { error: linkError } = await supabase.from("document_links").insert({
    document_id: record.id,
    entity_type: input.entity.type,
    entity_id: input.entity.id,
    link_role: input.linkRole ?? null,
    linked_by: uploadedBy,
  } as never);
  if (linkError) throw linkError;

  await audit("document.uploaded", input.entity.type, input.entity.id, {
    documentId: record.id,
    filename: record.original_filename,
    sizeBytes: record.size_bytes,
    docType: record.doc_type,
  });

  if (input.supersedes) await supersedeDocument(input.supersedes, record.id);

  return record;
}

// ---- Links -----------------------------------------------------------------

/**
 * Attach an existing document to another record.
 *
 * The RLS policy requires that you can already read the document AND already
 * reach the target — without both, linking would be a way to grant yourself
 * access to a file by attaching it to something you own.
 */
export async function linkDocument(documentId: string, entity: EntityRef, linkRole?: string | null) {
  const linkedBy = await currentUserId();
  const { error } = await supabase.from("document_links").insert({
    document_id: documentId,
    entity_type: entity.type,
    entity_id: entity.id,
    link_role: linkRole ?? null,
    linked_by: linkedBy,
  } as never);
  if (error) throw error;
  await audit("document.linked", entity.type, entity.id, { documentId, linkRole: linkRole ?? null });
}

/** Detach, softly. The row stays so "this used to be attached here" survives. */
export async function unlinkDocument(documentId: string, entity: EntityRef) {
  const by = await currentUserId();
  const { error } = await supabase
    .from("document_links")
    .update({ unlinked_by: by, unlinked_at: new Date().toISOString() } as never)
    .eq("document_id", documentId)
    .eq("entity_type", entity.type)
    .eq("entity_id", entity.id)
    .is("unlinked_at", null);
  if (error) throw error;
  await audit("document.unlinked", entity.type, entity.id, { documentId });
}

// ---- Lifecycle -------------------------------------------------------------

export async function supersedeDocument(oldId: string, newId: string) {
  const { error } = await supabase
    .from("documents")
    .update({ superseded_by: newId, superseded_at: new Date().toISOString() } as never)
    .eq("id", oldId);
  if (error) throw error;
  await audit("document.superseded", "document", oldId, { supersededBy: newId });
}

/**
 * Soft delete. The row and the object both stay; the storage policy stops
 * serving the bytes because `storage_object_readable` requires deleted_at to be
 * null. Phase 6 has no physical delete at all.
 */
export async function deleteDocument(documentId: string, reason?: string | null) {
  const by = await currentUserId();
  const { error } = await supabase
    .from("documents")
    .update({ deleted_by: by, deleted_at: new Date().toISOString(), delete_reason: reason ?? null } as never)
    .eq("id", documentId);
  if (error) throw error;
  await audit("document.deleted", "document", documentId, { reason: reason ?? null });
}

export async function updateDocumentMeta(
  documentId: string,
  patch: { title?: string | null; notes?: string | null; doc_type?: DocumentType },
) {
  const { error } = await supabase.from("documents").update(patch as never).eq("id", documentId);
  if (error) throw error;
  await audit("document.updated", "document", documentId, patch);
}

// ---- Reads -----------------------------------------------------------------

export type EntityDocument = DocumentRecord & {
  link_role: string | null;
  linked_at: string;
  /** Resolved from the rows already in hand, not another request. */
  replaced_by_filename: string | null;
};

/**
 * Every live document on one record.
 *
 * ONE QUERY, DELIBERATELY
 * -----------------------
 * The obvious shape — fetch the links, then fetch each document, then fetch
 * each uploader's name — is two round trips plus N more, so a project gallery
 * with twenty photos would issue twenty-two requests. PostgREST resolves the
 * embed server-side, making this a single request whose cost is one index scan
 * on `document_links (entity_type, entity_id) WHERE unlinked_at IS NULL` — the
 * partial index the migration creates for exactly this read.
 *
 * Uploader names are NOT joined here. No table in this schema has a foreign key
 * to `profiles`; the established pattern is one cached `listTeamMembers()` query
 * shared by the whole page, and resolving names from that map costs zero extra
 * requests per document. Adding an FK just to embed would be a schema change in
 * service of a join.
 */
export async function listEntityDocuments(entity: EntityRef): Promise<EntityDocument[]> {
  const { data, error } = await supabase
    .from("document_links")
    .select("link_role, linked_at, documents!inner(*)")
    .eq("entity_type", entity.type)
    .eq("entity_id", entity.id)
    .is("unlinked_at", null)
    .order("linked_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    link_role: string | null;
    linked_at: string;
    documents: DocumentRecord;
  }>;

  const live = rows.filter((r) => r.documents && !r.documents.deleted_at);
  const byId = new Map(live.map((r) => [r.documents.id, r.documents]));

  return live.map((r) => ({
    ...r.documents,
    link_role: r.link_role,
    linked_at: r.linked_at,
    // Null when the replacement is attached elsewhere and the reader cannot
    // see it, which is the honest answer rather than a guessed filename.
    replaced_by_filename: r.documents.superseded_by
      ? (byId.get(r.documents.superseded_by)?.original_filename ?? null)
      : null,
  }));
}

/** The version chain for one document, oldest first. */
export function buildVersionChain(docs: EntityDocument[], documentId: string): EntityDocument[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  // Walk backwards to the head of the chain, then forwards.
  let head = byId.get(documentId);
  if (!head) return [];
  const seen = new Set<string>();
  for (;;) {
    const prev = docs.find((d) => d.superseded_by === head!.id && !seen.has(d.id));
    if (!prev) break;
    seen.add(prev.id);
    head = prev;
  }
  const chain: EntityDocument[] = [];
  let cur: EntityDocument | undefined = head;
  const walked = new Set<string>();
  while (cur && !walked.has(cur.id)) {
    walked.add(cur.id);
    chain.push(cur);
    cur = cur.superseded_by ? byId.get(cur.superseded_by) : undefined;
  }
  return chain;
}

export function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
