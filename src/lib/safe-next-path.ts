/**
 * The `next` redirect target, only if it stays on `origin`.
 *
 * Refuses any control character or backslash in the raw string: browsers strip
 * tabs and newlines and read `\` as `/`, so "/\t/evil" or "/\\evil" would leave
 * the site. Then resolves against `origin` and requires the same origin.
 * Returns pathname + search + hash, or undefined.
 */
export function safeNextPath(next: unknown, origin: string): string | undefined {
  if (typeof next !== "string" || !next.startsWith("/")) return undefined;
  for (let i = 0; i < next.length; i++) {
    const c = next.charCodeAt(i);
    if (c < 0x20 || c === 0x5c) return undefined;
  }
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  return url.pathname + url.search + url.hash;
}

/** Origin for checks that run outside the browser (route search validation during SSR). */
export function currentOrigin(): string {
  return typeof window === "undefined" ? "https://agent.phc-sa.com" : window.location.origin;
}
