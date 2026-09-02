// =============================================================================
// Making a site photo small enough to send.
//
// Reported 2026-09-02: "uploading files takes a long time, and the attached
// files are large." Both halves are the same fact.
//
// The checksum was the obvious suspect and it is innocent: measured in the
// browser, hashing 25MB costs 23ms. What takes the time is the bytes going up
// a mobile connection, and the bytes are mostly photographs.
//
// Measured, not assumed. A 12-megapixel phone photo (4032x3024):
//
//     original, JPEG q0.92        9,818 KB
//     2000px long edge, q0.82     1,319 KB     7.4x
//     1600px long edge, q0.80       812 KB    12.1x
//
// That was synthetic noise, which is the worst case for JPEG — a real site
// photo compresses considerably better. So the numbers above are a floor.
//
// WHAT IS NOT TOUCHED, AND WHY
//
// Only JPEG and WebP. Those are already lossy: the person who took the photo
// accepted loss when the camera saved it, and re-encoding costs a little more
// of the same kind. A PNG is a screenshot or a line drawing — signage drawings
// are exactly that — and re-encoding one either loses crisp edges or grows.
// PDFs, BOQs and contracts go up byte for byte; a contract that is not the file
// that was signed is not a contract.
//
// And nothing is touched below the threshold. Shrinking a 400KB photo saves a
// second nobody notices and costs a detail somebody might need.
// =============================================================================

/** Formats where re-encoding is a small addition to loss already accepted. */
export const COMPRESSIBLE = new Set(["image/jpeg", "image/webp"]);

/** Below this, the saving is not worth the loss. */
export const COMPRESS_MIN_BYTES = 1_500_000;

/** Long edge after downscaling. Generous: signage detail has to survive. */
export const MAX_EDGE = 2000;

export const QUALITY = 0.82;

export function shouldCompress(file: { type: string; size: number }): boolean {
  return COMPRESSIBLE.has(file.type) && file.size >= COMPRESS_MIN_BYTES;
}

/**
 * Target dimensions for an image, preserving aspect ratio.
 *
 * Never enlarges: an image already smaller than the limit keeps its size, so a
 * 1200px photo is not upscaled into a bigger file than it started as.
 */
export function targetSize(w: number, h: number, maxEdge = MAX_EDGE): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge || longest === 0) return { w, h };
  const s = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * Whether the result is worth keeping.
 *
 * Re-encoding can produce a LARGER file — a small graphic, an image already
 * compressed harder than our quality setting. Uploading that would make the
 * reported problem worse while claiming to fix it, so the original wins any tie.
 */
export function worthKeeping(originalBytes: number, compressedBytes: number): boolean {
  return compressedBytes > 0 && compressedBytes < originalBytes;
}

/**
 * Compress if it helps, and return the original if it does not.
 *
 * Every failure path returns the original file rather than throwing. A photo
 * that will not decode, a browser without OffscreenCanvas, a blob that comes
 * back empty — none of those are a reason to refuse an upload the user asked
 * for. Slower is not broken.
 */
export async function compressImage(file: File): Promise<{ file: File; compressed: boolean }> {
  if (!shouldCompress(file)) return { file, compressed: false };
  try {
    const bitmap = await createImageBitmap(file);
    const { w, h } = targetSize(bitmap.width, bitmap.height);
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = (canvas as OffscreenCanvas).getContext("2d");
    if (!ctx) return { file, compressed: false };
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob =
      "convertToBlob" in canvas
        ? await (canvas as OffscreenCanvas).convertToBlob({ type: file.type, quality: QUALITY })
        : await new Promise<Blob | null>((res) =>
            (canvas as HTMLCanvasElement).toBlob(res, file.type, QUALITY),
          );

    if (!blob || !worthKeeping(file.size, blob.size)) return { file, compressed: false };
    // Same name and same type: the record still says what the user attached.
    return {
      file: new File([blob], file.name, { type: file.type, lastModified: file.lastModified }),
      compressed: true,
    };
  } catch {
    return { file, compressed: false };
  }
}
