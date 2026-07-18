import { supabase } from "@/integrations/supabase/client";

const BUCKET = "attachments";

// Upload a file to the private attachments bucket and return a long-lived
// signed URL (7 days) plus the storage path. Store the path if you need to
// re-sign later; store the URL for immediate display/links.
export async function uploadAttachment(folder: string, file: File): Promise<{ path: string; url: string | null }> {
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${folder}/${Date.now()}-${safeName}`;
  const { data, error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) throw error;
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(data.path, 60 * 60 * 24 * 7);
  return { path: data.path, url: signed?.signedUrl ?? null };
}
