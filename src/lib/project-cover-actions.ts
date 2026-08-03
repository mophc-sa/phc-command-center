import { supabase } from "@/integrations/supabase/client";
import { uploadAttachment } from "@/lib/storage-actions";

type Uuid = string;

const MAX_COVER_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB — a cover photo, not a document
const ALLOWED_COVER_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateProjectCoverFile(file: File): { ok: true } | { ok: false; reason: "file_too_large" | "file_type_not_allowed" } {
  if (file.size > MAX_COVER_IMAGE_BYTES) return { ok: false, reason: "file_too_large" };
  if (file.type && !ALLOWED_COVER_MIME_TYPES.has(file.type)) return { ok: false, reason: "file_type_not_allowed" };
  return { ok: true };
}

// projects.cover_image_path stores a private-bucket storage path, not a
// URL — re-sign on every read so display never depends on a signed URL
// that was already stale by the time it was stored.
export async function getProjectCoverUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("attachments").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function uploadProjectCover(projectId: Uuid, file: File): Promise<string> {
  const check = validateProjectCoverFile(file);
  if (!check.ok) throw new Error(check.reason);
  const { path } = await uploadAttachment(`projects/${projectId}/cover`, file);
  const { error } = await supabase.from("projects").update({ cover_image_path: path } as never).eq("id", projectId);
  if (error) throw error;
  return path;
}

export async function removeProjectCover(projectId: Uuid) {
  const { error } = await supabase.from("projects").update({ cover_image_path: null } as never).eq("id", projectId);
  if (error) throw error;
}
