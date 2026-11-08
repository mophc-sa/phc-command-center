import { useQuery } from "@tanstack/react-query";
import { getPricingRights } from "@/lib/pricing-actions";

/** What pricing_my_rights() says the caller may do. A GM delegate is known only to SQL. */
export const usePricingRights = () =>
  useQuery({ queryKey: ["pricing-rights"], queryFn: getPricingRights, staleTime: 60_000 });
