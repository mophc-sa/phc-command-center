import { supabase } from "@/integrations/supabase/client";

const BUCKET = "attachments";

/**
 * How long a read link stays valid. Short on purpose: the link is minted when
 * someone opens the file, so it only has to outlive the click. The previous
 * seven-day URL was long enough to be worth storing, which is exactly how it
 * ended up in the database.
 */
const READ_URL_TTL_SECONDS = 60 * 10;

export type UploadedAttachment = {
  /** The durable reference. This is what belongs in the database. */
  path: string;
  /** A short-lived link for immediate display. Never persist this. */
  previewUrl: string | null;
};

/**
 * Upload a file to the private attachments bucket.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This used to return a 7-day signed URL, and three of its four call sites
 * stored that URL in a business column. Those links die a week later and the
 * file becomes unreachable through the UI — silently, because the row still
 * holds a plausible-looking URL. Two production rows already carry one, and one
 * of them is confirmed dead (HTTP 400).
 *
 * A signed URL is a temporary key, not an address. The address is the path, so
 * that is what the caller gets back first and what it should persist. Links are
 * minted at read time by `signAttachment` below.
 *
 * `upsert` is now false. It was true, so uploading a second file whose name
 * collided replaced the first without a word. The path already carries a
 * timestamp, and now a random suffix as well, so a genuine collision is
 * essentially impossible — but if one ever happens the upload fails loudly
 * rather than destroying the earlier file.
 */
export async function uploadAttachment(folder: string, file: File): Promise<UploadedAttachment> {
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  // Timestamp keeps paths sortable and human-readable; the random suffix is
  // what actually guarantees uniqueness when two uploads land in the same
  // millisecond.
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${folder}/${unique}-${safeName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false });
  if (error) throw error;

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.path, READ_URL_TTL_SECONDS);

  return { path: data.path, previewUrl: signed?.signedUrl ?? null };
}

/**
 * Mint a short-lived link for a stored path, at the moment of reading.
 *
 * Returns null rather than throwing when the object is gone or the caller is
 * not allowed to see it — the storage RLS policy decides, and a missing file
 * should render as "unavailable", not crash the page.
 */
export async function signAttachment(
  path: string,
  ttlSeconds: number = READ_URL_TTL_SECONDS,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Resolve whatever a legacy column happens to hold into something openable.
 *
 * The transition leaves four shapes in these columns, and this is the one place
 * that knows about all of them:
 *
 *   a storage path        the new shape — sign it now
 *   our own storage URL   possibly an expired signature; recover the path from
 *                         it and re-sign, which repairs the dead links in place
 *                         without touching the stored value
 *   an external URL       someone's Google Drive link. Hand it back untouched;
 *                         it is not ours to sign and never was.
 *   anything else         production holds `no-reply@raseedinvest.com` in one
 *                         evidence_url. Signing fails and we return null, so
 *                         the UI shows no link — which is the truth. Better
 *                         than rendering an anchor that goes nowhere.
 *
 * `storagePath` is preferred whenever it is present. `legacyUrl` is the
 * fallback and stays in use until the Phase 6 registry replaces both. Note
 * that since this hotfix, ActionDialog writes bare paths into the legacy
 * columns too — so a legacy value is no longer necessarily a URL.
 */
export async function resolveAttachmentUrl(
  storagePath: string | null | undefined,
  legacyUrl?: string | null,
): Promise<string | null> {
  if (storagePath) return signAttachment(storagePath);
  if (!legacyUrl) return null;

  const marker = `/${BUCKET}/`;
  const at = legacyUrl.indexOf(marker);
  if (at >= 0) {
    // Our own storage URL. Strip the host prefix and the signature, then
    // re-sign — this is what makes an already-expired link work again.
    const recovered = legacyUrl.slice(at + marker.length).split("?")[0];
    if (recovered) return signAttachment(recovered);
  }

  // Somebody else's link. Return it as-is rather than pretending we can vouch
  // for it.
  if (/^https?:\/\//i.test(legacyUrl)) return legacyUrl;

  // Not a URL at all, so it is either a bare storage path written by
  // ActionDialog or a value that was never a file reference. Signing tells the
  // two apart without guessing: storage answers for the first and refuses the
  // second.
  return signAttachment(legacyUrl);
}
