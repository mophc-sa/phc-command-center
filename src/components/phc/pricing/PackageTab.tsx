import type { PricingTabProps } from "@/components/phc/pricing/types";

// Placeholder until the tab's own task replaces this file.
export function PackageTab({ file }: PricingTabProps) {
  return <p className="text-sm text-muted-foreground">{file.state}</p>;
}
