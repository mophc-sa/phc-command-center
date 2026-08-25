// =============================================================================
// Recovering from a stale build.
//
// Every route in this app is a lazily imported chunk whose filename carries a
// content hash. Deploying changes those hashes. A browser tab that was open
// across the deploy still holds the OLD bundle, so the first navigation to a
// route it has not visited yet asks for a chunk that no longer exists:
//
//   TypeError: Failed to fetch dynamically imported module:
//     https://…/assets/my-workspace-DbTHkG3t.js
//
// This is not a server fault and it is not recoverable by retrying, because
// the dead URL is baked into the JavaScript already running. The root error
// boundary offered "Try again" — router.invalidate() + reset() — which
// re-attempts the same URL and fails identically, every time. Observed on
// 2026-08-25: the page stayed broken and the only way out was a manual
// browser reload, which nothing on screen suggested.
//
// A reload fetches the new index.html and the new hashes, and the user lands
// where they were going.
// =============================================================================

/** Messages browsers use when a lazily imported chunk cannot be fetched. */
const STALE_CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i, // Safari
  // Chrome when a proxy or SPA fallback serves index.html for a .js request.
  // Matched on the prefix, not on the MIME sentence: the wording around it
  // differs by engine and version ("That is not…" vs "is not…").
  /failed to load module script/i,
  /\bchunkloaderror\b/i,
];

export function isStaleChunkError(error: unknown): boolean {
  if (!error) return false;
  const parts: string[] = [];
  if (typeof error === "string") parts.push(error);
  else if (typeof error === "object") {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    for (const v of [e.name, e.message, e.stack]) if (typeof v === "string") parts.push(v);
  }
  const text = parts.join(" ");
  if (!text) return false;
  return STALE_CHUNK_PATTERNS.some((re) => re.test(text));
}

export const RELOAD_MARKER_KEY = "phc-stale-chunk-reload";

/**
 * One automatic reload, never a loop.
 *
 * If reloading does NOT fix it — a genuinely missing asset, an offline cache,
 * a proxy serving HTML for .js — reloading again would spin forever and the
 * user would never see an error they could act on. So the attempt is stamped,
 * and a second failure inside the window falls through to the message.
 */
export const RELOAD_GUARD_MS = 30_000;

export function shouldAutoReload(now: number, marker: string | null): boolean {
  if (!marker) return true;
  const at = Number(marker);
  if (!Number.isFinite(at)) return true;
  // A stamp from the future means a clock change, not a recent attempt.
  if (at > now) return true;
  return now - at > RELOAD_GUARD_MS;
}

/**
 * A reload that cannot be answered from cache.
 *
 * location.reload() revalidates nothing on its own. Before the document
 * started sending `Cache-Control: no-cache` it could return the very same
 * stale HTML that caused the failure — the recovery would fire, land on the
 * identical page, fail again, and the loop guard would stop it at the "new
 * version" message with the user no better off.
 *
 * The header is the real fix. This is the belt: a one-shot cache-busting
 * parameter guarantees a fresh document even from a CDN edge or a browser
 * that ignores the header, and it is stripped from the URL bar afterwards so
 * nobody bookmarks it.
 */
export const CACHE_BUST_PARAM = "__v";

export function bustedUrl(href: string, stamp: number): string {
  const url = new URL(href);
  url.searchParams.set(CACHE_BUST_PARAM, String(stamp));
  return url.toString();
}

/** True when this load came from a cache-busting reload we triggered. */
export function isBustedUrl(href: string): boolean {
  return new URL(href).searchParams.has(CACHE_BUST_PARAM);
}

/** The same URL without our parameter, for putting back in the address bar. */
export function cleanUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(CACHE_BUST_PARAM);
  return url.toString();
}
