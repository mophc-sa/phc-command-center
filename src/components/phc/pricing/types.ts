import type { QueueRow } from "@/lib/pricing-actions";
import type { PricingRights } from "@/lib/pricing-access";

/** Every pricing-file tab gets the file (from pricing_queue), the caller's rights, and a refresh. */
export type PricingTabProps = { file: QueueRow; rights: PricingRights; onChanged: () => void };
