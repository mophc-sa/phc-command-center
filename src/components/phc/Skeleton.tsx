import { cn } from "@/lib/utils";

/**
 * Base skeleton atom — a single pulsing "bone".
 * All skeleton compositions are built from this.
 */
function Bone({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-2", className)}
    />
  );
}

// ─── SkeletonCard ────────────────────────────────────────────────────────────
// Use for: card grids (accounts list, AI recommendations)
// Props: count — number of placeholder cards

export function SkeletonCard({ count = 4, cols = "default" }: { count?: number; cols?: "default" | "2" | "3" }) {
  const grid =
    cols === "2"
      ? "sm:grid-cols-2"
      : cols === "3"
        ? "sm:grid-cols-2 xl:grid-cols-3"
        : "sm:grid-cols-2 xl:grid-cols-4";
  return (
    <div className={cn("grid gap-3", grid)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border/70 bg-surface/60 p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <Bone className="h-2 w-24" />
            <Bone className="h-4 w-4 rounded-full shrink-0" />
          </div>
          <Bone className="mt-4 h-7 w-32" />
          <Bone className="mt-2 h-2.5 w-20" />
        </div>
      ))}
    </div>
  );
}

// ─── SkeletonTable ───────────────────────────────────────────────────────────
// Use for: tables, lists, action queues, kanban fallbacks
// Props: rows — number of placeholder rows

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
      {/* Simulated header */}
      <div className="flex items-center gap-6 border-b border-border/60 px-5 py-3">
        <Bone className="h-2.5 w-28" />
        <Bone className="h-2.5 w-20" />
        <Bone className="h-2.5 w-16" />
        <Bone className="ms-auto h-2.5 w-14" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-t border-border/60 px-5 py-3.5 first:border-t-0"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <Bone className="h-3 w-40" />
          <Bone className="h-3 w-24" />
          <Bone className="h-5 w-16 rounded-full" />
          <Bone className="ms-auto h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

// ─── SkeletonChart ───────────────────────────────────────────────────────────
// Use for: dashboard/reports pages that lead with KPI tiles + chart panels
// Props: kpis — number of KPI cards; charts — number of chart frames

export function SkeletonChart({ kpis = 4, charts = 2 }: { kpis?: number; charts?: number }) {
  const kpiGrid =
    kpis === 4
      ? "sm:grid-cols-2 xl:grid-cols-4"
      : kpis === 3
        ? "sm:grid-cols-3"
        : "sm:grid-cols-2";

  return (
    <div className="space-y-3">
      {/* KPI row */}
      <div className={cn("grid gap-3", kpiGrid)}>
        {Array.from({ length: kpis }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/70 bg-surface/60 p-5">
            <div className="flex items-start justify-between gap-3">
              <Bone className="h-2 w-20" />
              <Bone className="h-4 w-4 rounded-full shrink-0" />
            </div>
            <Bone className="mt-4 h-8 w-28" />
            <Bone className="mt-2 h-2.5 w-16" />
          </div>
        ))}
      </div>
      {/* Chart row */}
      <div className={cn("grid gap-3", charts > 1 ? "lg:grid-cols-2" : "")}>
        {Array.from({ length: charts }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/70 bg-surface/60 p-5">
            <Bone className="mb-1.5 h-3 w-36" />
            <Bone className="mb-4 h-2.5 w-24" />
            <Bone className="h-[240px] w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SkeletonForm ────────────────────────────────────────────────────────────
// Use for: full detail pages (opportunity, account, project detail)
// Renders a page-header placeholder + two-column panel layout

export function SkeletonForm() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Page header */}
      <div className="mb-8">
        <Bone className="mb-3 h-2.5 w-24" />
        <Bone className="h-8 w-72" />
        <Bone className="mt-2.5 h-3 w-96 max-w-full" />
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Main column */}
        <div className="space-y-5">
          {/* Primary panel */}
          <div className="rounded-xl border border-border/70 bg-surface/60 p-5">
            <Bone className="mb-5 h-3 w-28" />
            <div className="grid gap-5 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                  <Bone className="mb-2 h-2 w-16" />
                  <Bone className="h-4 w-40" />
                </div>
              ))}
            </div>
          </div>
          {/* Secondary panel — list style */}
          <div className="rounded-xl border border-border/70 bg-surface/60">
            <div className="border-b border-border/60 px-5 py-4">
              <Bone className="h-3 w-32" />
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-t border-border/60 px-5 py-3.5 first:border-t-0"
              >
                <Bone className="h-4 w-4 rounded-full shrink-0" />
                <Bone className="h-3 w-52" />
                <Bone className="ms-auto h-3 w-14" />
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar column */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-surface/60">
            <div className="border-b border-border/60 px-5 py-4">
              <Bone className="h-3 w-24" />
            </div>
            <div className="px-5 py-4 space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <Bone className="mb-1.5 h-2 w-16" />
                  <Bone className="h-3.5 w-28" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-surface/60 p-5">
            <Bone className="mb-3 h-3 w-20" />
            <Bone className="h-2.5 w-full rounded-full" />
            <Bone className="mt-2 h-2 w-16" />
          </div>
        </div>
      </div>
    </div>
  );
}
