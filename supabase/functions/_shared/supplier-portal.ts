// =============================================================================
// Supplier accounts at the function boundary (pricing loop PR 3).
//
// A supplier account is external. resolveCaller refuses it in every function
// unless the function opts in (sales-os-api does), and sales-os-api then lets
// it call SUPPLIER_ACTIONS only. Everything else here is a pure helper so the
// rules are tested without a network.
// =============================================================================

import type { AppRole } from "./roles.ts";

/** The sales-os-api actions a supplier account may call. Every other action answers 403. */
export const SUPPLIER_ACTIONS: readonly string[] = ["supplier_file_download"];

export function callerMayUseAction(roles: readonly AppRole[], action: string): boolean {
  return !roles.includes("supplier") || SUPPLIER_ACTIONS.includes(action);
}

/** Trimmed and lower-cased, or null when it is not an email address. */
export function normalizeSupplierEmail(raw: unknown): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  return e.length > 0 && e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

export const DEFAULT_APP_URL = "https://agent.phc-sa.com";

/** The app's origin for links in messages (same setting outlook-connector reads). */
export function appUrl(env: (key: string) => string | undefined): string {
  return (env("APP_URL") ?? DEFAULT_APP_URL).replace(/\/+$/, "");
}

/** Content-Disposition for a supplier download: the neutral name (code-NN.ext) only, safe in a header. */
export function attachmentHeader(name: string): string {
  const n = name || "file";
  return `attachment; filename="${n.replace(/[^A-Za-z0-9._-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}
