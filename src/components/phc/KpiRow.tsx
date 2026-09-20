// =============================================================================
// The row of numbers a page opens with.
//
// Twelve pages wrote this grid by hand, and they disagreed: two, four or five
// columns on a wide screen, and one page asked for four columns starting at
// 640px, which put four metrics side by side on a phone. A dashboard should
// have the same silhouette wherever you land, so the shape lives here.
//
// Four is the default because that is what the KPI engine produces most often;
// `columns` exists for the pages that genuinely have three or five.
// =============================================================================

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const COLUMNS: Record<3 | 4 | 5, string> = {
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
};

export function KpiRow({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  /** How many metrics sit side by side on a wide screen. Never more on a phone. */
  columns?: 3 | 4 | 5;
  className?: string;
}) {
  return <div className={cn("mb-6 grid gap-3", COLUMNS[columns], className)}>{children}</div>;
}
