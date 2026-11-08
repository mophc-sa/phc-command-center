import type { QueueRow } from "@/lib/pricing-actions";
import type { PricingRights } from "@/lib/pricing-access";

/** Every pricing-file tab gets the file (from pricing_queue), the caller's rights, and a refresh. */
export type PricingTabProps = {
  file: QueueRow;
  rights: PricingRights;
  onChanged: () => void;
  /** Switches to the Cost review tab; absent when the reader cannot open it. */
  goToCost?: () => void;
};

/**
 * Whether the extras suggestions were refreshed for this file and BOQ round. The
 * Selling tab runs it on open; the Extras panel's "Check suggestions" writes a success
 * here. It must not start with "pricing-": onChanged invalidates that prefix and would
 * run the suggestion again on every edit.
 */
export const suggestRunKey = (fileId: string, revisionId: string | null) => ["suggest-run", fileId, revisionId] as const;
