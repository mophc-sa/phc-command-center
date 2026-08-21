import { supabase } from "@/integrations/supabase/client";
import { signAttachment, uploadAttachment } from "@/lib/storage-actions";

type Uuid = string;

const MAX_COVER_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB — a cover photo, not a document
const ALLOWED_COVER_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateProjectCoverFile(file: File): { ok: true } | { ok: false; reason: "file_too_large" | "file_type_not_allowed" } {
  if (file.size > MAX_COVER_IMAGE_BYTES) return { ok: false, reason: "file_too_large" };
  if (file.type && !ALLOWED_COVER_MIME_TYPES.has(file.type)) return { ok: false, reason: "file_type_not_allowed" };
  return { ok: true };
}

// projects.cover_image_path stores a private-bucket storage path, not a URL —
// re-signed on every read so display never depends on a link that was already
// stale by the time it was stored.
//
// This used to mint its own seven-day signature. Nothing stored it, so it was
// never the D25 defect, but it left a second TTL in the codebase contradicting
// the ten-minute one — and the next person to copy an example would have had a
// coin flip over which was current. It now goes through the same helper as
// everything else.
export async function getProjectCoverUrl(path: string | null): Promise<string | null> {
  return signAttachment(path ?? "");
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
